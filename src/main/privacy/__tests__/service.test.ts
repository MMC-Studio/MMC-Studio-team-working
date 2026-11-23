import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpApprovalRequest, McpServerInfo } from '@shared/agents'
import type { DraftApprovalRequest } from '@shared/connectors'
import { NO_GRANTS, type ScheduleGrants } from '@shared/schedules'
import type { CodeApprovalRequest } from '@shared/types'
import { CodeApprovals } from '../../code/approvals'
import { DraftApprovals } from '../../connectors/approvals'
import { openDatabase } from '../../db/client'
import { ConversationRepository } from '../../db/repositories'
import { McpApprovals } from '../../mcpClient/approvals'
import { McpServerStore } from '../../mcpClient/store'
import { DeferredService } from '../../schedules/deferred'
import { ScheduleRepository } from '../../schedules/repository'
import { AppToolRegistry } from '../../tools/registry'
import { cancelEverywhere, PrivacyService, type PrivacyDeps } from '../service'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')
const log = { info: vi.fn(), warn: vi.fn() }
const STATUS = {
  git: { enabled: false },
  gmail: { enabled: false, accounts: [] },
  telegram: { enabled: false, account: null },
  agents: { enabled: false, clients: [] },
  mcp: []
}

/**
 * Dựng PrivacyService trên DB thật (cuộc, lịch, thẻ hoãn duyệt) + các dịch vụ duyệt thật (sửa file, MCP, nháp) để kiểm
 * "thu hồi = huỷ mọi thẻ đang chờ + dừng việc đang chạy" từ đầu tới cuối.
 */
describe('PrivacyService', () => {
  let handle: ReturnType<typeof openDatabase>
  let folder: string
  let mcpDir: string
  let owner: string
  let convs: ConversationRepository
  let scheduleRepo: ScheduleRepository
  let deferred: DeferredService
  let registry: AppToolRegistry
  let code: CodeApprovals
  let codeCards: CodeApprovalRequest[]
  let mcp: McpApprovals
  let mcpCards: McpApprovalRequest[]
  let drafts: DraftApprovals
  let draftCards: DraftApprovalRequest[]
  /** Giả lệnh git đang chạy của từng cuộc (CommandService có test riêng cho phần dừng tiến trình). */
  let runningCommands: Set<string>
  let aborted: string[]
  let stopped: string[]
  let service: PrivacyService

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    folder = mkdtempSync(join(tmpdir(), 'mmc-privacy-'))
    writeFileSync(join(folder, 'a.txt'), 'xin chao\n')
    mcpDir = mkdtempSync(join(tmpdir(), 'mmc-privacy-mcp-'))
    owner = 'u1'
    convs = new ConversationRepository(handle.db, () => owner)
    scheduleRepo = new ScheduleRepository(handle.db, () => owner)
    deferred = new DeferredService({
      db: handle.db,
      getOwner: () => owner,
      now: () => Date.now(),
      scheduleGrants: (id) => scheduleRepo.get(id)?.grants ?? null,
      createDraft: async () => {},
      answer: async () => ({ text: '' }),
      revise: () => 'queued',
      changed: () => {},
      log
    })
    registry = new AppToolRegistry()
    deferred.registerTools(registry)
    codeCards = []
    code = new CodeApprovals({ writableRoot: (id) => convs.get(id)?.cwd ?? null, emit: (r) => codeCards.push(r), log })
    let servers: McpServerInfo[] = []
    const store = new McpServerStore(
      { get: () => servers, set: (l) => void (servers = l as McpServerInfo[]) },
      mcpDir,
      { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
    )
    store.save({ name: 'notion', type: 'stdio', command: 'x', args: [], env: {}, enabled: true })
    mcpCards = []
    mcp = new McpApprovals({ store, emit: (r) => void mcpCards.push(r), log })
    draftCards = []
    drafts = new DraftApprovals({ emit: (e) => void (!('closed' in e) && draftCards.push(e)), log })
    runningCommands = new Set()
    aborted = []
    stopped = []
    const commands = { cancelConversation: (id: string) => void runningCommands.delete(id) }
    const deps: PrivacyDeps = {
      foldersInUse: () => convs.withFolder(),
      getConversation: (id) => convs.get(id),
      clearFolder: (id) => void convs.setCwd(id, null),
      cancelConversation: (id) => cancelEverywhere([code, mcp, drafts, commands], id, log.warn),
      abortTurn: (id) => void aborted.push(id),
      schedules: () => scheduleRepo.list(),
      getSchedule: (id) => scheduleRepo.get(id),
      setScheduleGrants: (id, g) => void scheduleRepo.setGrants(id, g),
      stopSchedule: (id) => void stopped.push(id),
      revokeDeferred: (id, scope) => deferred.revokeForSchedule(id, scope),
      gmailLabel: (id) => (id === 'acc1' ? 'Công việc (me@example.com)' : null),
      status: () => STATUS,
      log
    }
    service = new PrivacyService(deps)
  })
  afterEach(() => {
    code.stop()
    handle.close()
    rmSync(folder, { recursive: true, force: true })
    rmSync(mcpDir, { recursive: true, force: true })
  })

  const makeSchedule = (grants: Partial<ScheduleGrants>): { scheduleId: string; conv: string } => {
    const g = { ...NO_GRANTS, folder, ...grants }
    const scheduleId = scheduleRepo.create(
      { name: 'Báo cáo sáng', prompt: 'p', recurrence: { kind: 'daily', time: '08:00' }, projectId: null, grants: g, model: 'default', catchUp: true },
      'user',
      null
    ).id
    const conv = convs.createForSchedule({ owner, scheduleId, title: 'S', projectId: null, cwd: g.folder }).id
    deferred.begin(conv, { owner, scheduleId, runId: 'r1', folder: g.folder, folderWrite: g.folderWrite, drafts: g.drafts })
    return { scheduleId, conv }
  }

  it('liệt kê cuộc có thư mục (đọc / đọc + sửa), chỉ của tài khoản hiện tại', () => {
    const a = convs.create('free')
    convs.setCwd(a.id, folder)
    const b = convs.create('code')
    convs.setCwd(b.id, folder)
    convs.setCodeWrite(b.id, true)
    convs.create('free')
    owner = 'u2'
    convs.setCwd(convs.create('free').id, folder)
    owner = 'u1'
    const folders = service.status().folders
    expect(folders.map((f) => [f.conversationId, f.write])).toEqual(
      expect.arrayContaining([
        [a.id, false],
        [b.id, true]
      ])
    )
    expect(folders).toHaveLength(2)
  })

  it('thu hồi thư mục: huỷ MỌI thẻ đang chờ của cuộc (sửa file, MCP, nháp), dừng lệnh + lượt đang chạy, gỡ thư mục; cuộc khác không bị đụng', async () => {
    const conv = convs.create('code')
    convs.setCwd(conv.id, folder)
    convs.setCodeWrite(conv.id, true)
    const other = convs.create('code')
    convs.setCwd(other.id, folder)
    const edit = code.decide(conv.id, 'Edit', { file_path: 'a.txt', old_string: 'xin chao', new_string: 'xin chào' })
    const tool = mcp.request(conv.id, 'mcp__notion__search', {})
    const otherTool = mcp.request(other.id, 'mcp__notion__search', {})
    const draft = drafts.request(conv.id, { service: 'telegram', target: 'Nhóm', subject: null, body: 'b', replyTo: null })
    runningCommands.add(conv.id)
    runningCommands.add(other.id)
    await vi.waitFor(() => expect(codeCards).toHaveLength(1))
    expect(mcpCards).toHaveLength(2)
    expect(draftCards).toHaveLength(1)

    expect(service.revokeFolder(conv.id)).toBe(true)
    expect(await edit).toMatchObject({ allow: false })
    expect(await tool).toMatchObject({ allow: false })
    expect(await draft).toMatchObject({ approve: false })
    expect(runningCommands).toEqual(new Set([other.id]))
    expect(aborted).toEqual([conv.id])
    expect(convs.get(conv.id)).toMatchObject({ cwd: null, codeWrite: false })
    // Cuộc khác giữ nguyên: thư mục còn, thẻ MCP vẫn chờ.
    expect(convs.get(other.id)?.cwd).toBe(folder)
    let otherSettled = false
    void otherTool.then(() => (otherSettled = true))
    await new Promise((r) => setTimeout(r, 20))
    expect(otherSettled).toBe(false)
    expect(service.status().folders.map((f) => f.conversationId)).toEqual([other.id])
    mcp.cancelAll()
  })

  it('thu hồi thư mục: cuộc không có thư mục / của tài khoản khác → false, không huỷ gì', () => {
    const conv = convs.create('free')
    runningCommands.add(conv.id)
    expect(service.revokeFolder(conv.id)).toBe(false)
    owner = 'u2'
    const foreign = convs.create('free')
    convs.setCwd(foreign.id, folder)
    owner = 'u1'
    expect(service.revokeFolder(foreign.id)).toBe(false)
    expect(runningCommands.size).toBe(1)
    expect(aborted).toEqual([])
  })

  it('quyền lịch: liệt kê theo từng quyền (lịch không quyền bị ẩn), tên tài khoản Gmail', () => {
    const { scheduleId } = makeSchedule({ folderWrite: true, gmailAccounts: ['acc1'], telegram: true, drafts: true })
    makeSchedule({ folder: null })
    expect(service.status().schedules).toEqual([
      {
        scheduleId,
        name: 'Báo cáo sáng',
        enabled: true,
        grants: [
          { key: 'folder', kind: 'folder', label: folder },
          { key: 'folderWrite', kind: 'folderWrite', label: folder },
          { key: 'gmail:acc1', kind: 'gmail', label: 'Công việc (me@example.com)' },
          { key: 'telegram', kind: 'telegram', label: 'Telegram' },
          { key: 'drafts', kind: 'drafts', label: '' }
        ]
      }
    ])
  })

  it('thu hồi thư mục của lịch: mất cả đề xuất sửa, dừng lần đang chạy, thẻ sửa file còn chờ → "revoked"; thẻ nháp không đụng', async () => {
    const { scheduleId, conv } = makeSchedule({ folderWrite: true, drafts: true })
    await registry.call('propose_file_change', { path: 'a.txt', content: 'mới\n' }, { conversationId: conv })
    deferred.draftSink(conv)!({
      draft: { service: 'telegram', account: null, recipients: ['Nhóm'], unknownRecipients: [], subject: null, body: 'b', replyTo: null },
      to: [],
      replyToId: null,
      chatId: '1'
    })
    service.revokeScheduleGrant(scheduleId, 'folder')
    expect(scheduleRepo.get(scheduleId)?.grants).toMatchObject({ folder: null, folderWrite: false, drafts: true })
    expect(stopped).toEqual([scheduleId])
    const cards = deferred.list(conv)
    expect(cards.find((c) => c.kind === 'changeset')?.status).toBe('revoked')
    expect(cards.find((c) => c.kind === 'draft')?.status).toBe('pending')
    // Thẻ đã thu hồi không duyệt được nữa.
    expect((await deferred.approveFiles(cards.find((c) => c.kind === 'changeset')!.id)).status).toBe('error')
  })

  it('thu hồi từng quyền: Gmail một tài khoản / Telegram / nháp — chỉ đóng thẻ nháp đúng loại', () => {
    const { scheduleId, conv } = makeSchedule({ gmailAccounts: ['acc1', 'acc2'], telegram: true, drafts: true })
    const sink = deferred.draftSink(conv)!
    const draft = (service: 'gmail' | 'telegram', account: string | null) =>
      sink({
        draft: {
          service,
          account: account ? { id: account, email: `${account}@x`, label: account } : null,
          recipients: ['A'],
          unknownRecipients: [],
          subject: null,
          body: 'b',
          replyTo: null
        },
        to: [],
        replyToId: null,
        chatId: service === 'telegram' ? '1' : null
      })
    draft('gmail', 'acc1')
    draft('gmail', 'acc2')
    draft('telegram', null)
    const status = (): string[] =>
      deferred
        .list(conv)
        .filter((c) => c.kind === 'draft')
        .map((c) => c.status)
        .sort()

    service.revokeScheduleGrant(scheduleId, 'gmail:acc1')
    expect(scheduleRepo.get(scheduleId)?.grants.gmailAccounts).toEqual(['acc2'])
    expect(status()).toEqual(['pending', 'pending', 'revoked'])
    service.revokeScheduleGrant(scheduleId, 'telegram')
    expect(scheduleRepo.get(scheduleId)?.grants.telegram).toBe(false)
    expect(status()).toEqual(['pending', 'revoked', 'revoked'])
    service.revokeScheduleGrant(scheduleId, 'drafts')
    expect(scheduleRepo.get(scheduleId)?.grants.drafts).toBe(false)
    expect(status()).toEqual(['revoked', 'revoked', 'revoked'])
    expect(stopped).toEqual([scheduleId, scheduleId, scheduleId])
  })

  it('lịch của tài khoản khác / không tồn tại → null, không đổi gì', () => {
    const { scheduleId } = makeSchedule({ telegram: true })
    owner = 'u2'
    expect(service.revokeScheduleGrant(scheduleId, 'telegram')).toBeNull()
    owner = 'u1'
    expect(scheduleRepo.get(scheduleId)?.grants.telegram).toBe(true)
    expect(stopped).toEqual([])
  })

  it('cancelEverywhere: một dịch vụ lỗi không chặn các dịch vụ còn lại', () => {
    const calls: string[] = []
    const warn = vi.fn()
    cancelEverywhere(
      [
        { cancelConversation: () => calls.push('a') },
        {
          cancelConversation: () => {
            throw new Error('hỏng')
          }
        },
        { cancelConversation: () => calls.push('c') }
      ],
      'c1',
      warn
    )
    expect(calls).toEqual(['a', 'c'])
    expect(warn).toHaveBeenCalledOnce()
  })
})
