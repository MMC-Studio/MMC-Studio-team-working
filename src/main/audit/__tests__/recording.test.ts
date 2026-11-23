import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpApprovalRequest, McpServerInfo } from '@shared/agents'
import type { DraftApprovalRequest } from '@shared/connectors'
import type { DeferredCard } from '@shared/deferred'
import { NO_GRANTS, type ScheduleGrants } from '@shared/schedules'
import type { CodeApprovalRequest } from '@shared/types'
import { CodeApprovals } from '../../code/approvals'
import { DraftApprovals, draftTarget } from '../../connectors/approvals'
import { openDatabase } from '../../db/client'
import { ConversationRepository } from '../../db/repositories'
import { McpApprovals } from '../../mcpClient/approvals'
import { McpServerStore } from '../../mcpClient/store'
import { DeferredService } from '../../schedules/deferred'
import { ScheduleRepository } from '../../schedules/repository'
import { AppToolRegistry } from '../../tools/registry'
import type { ActionLogEntry } from '../actionLog'

/** Mỗi đường duyệt (sửa file, MCP, nháp, hoãn duyệt) ghi đúng một dòng nhật ký cho mỗi kết cục — không chép nội dung. */

const log = { info: vi.fn(), warn: vi.fn() }

describe('CodeApprovals → nhật ký sửa file', () => {
  let root: string
  let entries: ActionLogEntry[]
  let requests: CodeApprovalRequest[]
  let approvals: CodeApprovals
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mmc-rec-'))
    writeFileSync(join(root, 'a.txt'), 'xin chao\n')
    entries = []
    requests = []
    approvals = new CodeApprovals({
      writableRoot: (id) => (id === 'c1' ? root : null),
      emit: (r) => requests.push(r),
      log,
      record: (e) => entries.push(e)
    })
  })
  afterEach(() => {
    approvals.stop()
    rmSync(root, { recursive: true, force: true })
  })
  const edit = (path = 'a.txt') => ({ file_path: path, old_string: 'xin chao', new_string: 'xin chào' })

  it('Đồng ý / Từ chối / hết hạn / dừng lượt — mỗi lần một dòng, chỉ đường dẫn tương đối', async () => {
    const a = approvals.decide('c1', 'Edit', edit())
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    approvals.respond(requests[0].id, true)
    await a
    const b = approvals.decide('c1', 'Edit', edit())
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    approvals.respond(requests[1].id, false, 'đừng sửa')
    await b
    // Hết hạn: thẻ riêng có hạn 30 ms (không đua với waitFor của các thẻ trên).
    const quick = new CodeApprovals({ writableRoot: () => root, emit: () => {}, log, record: (e) => entries.push(e), timer: { idleMs: 30 } })
    await quick.decide('c1', 'Edit', edit())
    quick.stop()
    const d = approvals.decide('c1', 'Edit', edit())
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    approvals.cancelConversation('c1')
    await d
    expect(entries.map((e) => [e.kind, e.target, e.decision, e.conversationId])).toEqual([
      ['file_edit', 'a.txt', 'approved', 'c1'],
      ['file_edit', 'a.txt', 'rejected', 'c1'],
      ['file_edit', 'a.txt', 'timeout', 'c1'],
      ['file_edit', 'a.txt', 'stopped', 'c1']
    ])
    // Không chép nội dung / góp ý.
    expect(JSON.stringify(entries)).not.toContain('xin ch')
    expect(JSON.stringify(entries)).not.toContain('đừng sửa')
  })

  it('app chặn trước khi hỏi (ngoài thư mục / tắt quyền sửa) → blocked kèm mã lý do, không có thẻ', async () => {
    await approvals.decide('c1', 'Edit', edit('../ngoai.txt'))
    await approvals.decide('khac', 'Write', { file_path: 'b.txt', content: 'x' })
    expect(requests).toHaveLength(0)
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'file_edit', target: '../ngoai.txt', decision: 'blocked', detail: 'outside_project' }),
      expect.objectContaining({ kind: 'file_edit', target: 'b.txt', decision: 'blocked', detail: 'write_disabled', conversationId: 'khac' })
    ])
  })

  it('ghi nhật ký lỗi → việc duyệt vẫn chạy bình thường', async () => {
    const broken = new CodeApprovals({
      writableRoot: () => root,
      emit: (r) => requests.push(r),
      log,
      record: () => {
        throw new Error('db hỏng')
      }
    })
    const p = broken.decide('c1', 'Edit', edit())
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    broken.respond(requests[0].id, true)
    expect(await p).toEqual({ allow: true })
    broken.stop()
  })
})

describe('McpApprovals → nhật ký MCP', () => {
  let dir: string
  let list: McpServerInfo[]
  let store: McpServerStore
  let entries: ActionLogEntry[]
  let emitted: McpApprovalRequest[]
  let approvals: McpApprovals
  const crypto = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mmc-rec-mcp-'))
    list = []
    store = new McpServerStore({ get: () => list, set: (l) => void (list = l as McpServerInfo[]) }, dir, crypto)
    store.save({ name: 'notion', type: 'stdio', command: 'x', args: [], env: {}, enabled: true })
    entries = []
    emitted = []
    approvals = new McpApprovals({ store, emit: (r) => void emitted.push(r), log, record: (e) => entries.push(e) })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('một lần / luôn cho phép / từ chối / hết hạn / dừng — tên server/tool, không tham số', async () => {
    const run = async (respond: (id: string) => void): Promise<void> => {
      const n = emitted.length
      const p = approvals.request('c1', 'mcp__notion__search', { q: 'GDD bí mật' })
      await vi.waitFor(() => expect(emitted).toHaveLength(n + 1))
      respond(emitted[n].id)
      await p
    }
    await run((id) => approvals.respond(id, 'once'))
    await run((id) => approvals.respond(id, 'always'))
    await run((id) => approvals.respond(id, 'deny'))
    await new McpApprovals({ store, emit: () => {}, log, record: (e) => entries.push(e), timeoutMs: 30 }).request('c1', 'mcp__notion__search', {})
    await run(() => approvals.cancelConversation('c1'))
    expect(entries.map((e) => [e.kind, e.target, e.decision, e.detail ?? null])).toEqual([
      ['mcp', 'notion/search', 'approved', null],
      ['mcp', 'notion/search', 'approved', 'always_allow_set'],
      ['mcp', 'notion/search', 'rejected', null],
      ['mcp', 'notion/search', 'timeout', null],
      ['mcp', 'notion/search', 'stopped', null]
    ])
    expect(JSON.stringify(entries)).not.toContain('GDD')
  })

  it('tool lạ → blocked; CLI tự chạy tool "luôn cho phép" → auto; tool của app (mcp__mmc__) không ghi', async () => {
    await approvals.request('c1', 'mcp__la__x', {})
    approvals.recordAuto('c1', 'mcp__notion__search')
    approvals.recordAuto('c1', 'mcp__mmc__screenshot')
    approvals.recordAuto('c1', 'Read')
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'mcp', target: 'la/x', decision: 'blocked', detail: 'unknown_server' }),
      expect.objectContaining({ kind: 'mcp', target: 'notion/search', decision: 'auto', conversationId: 'c1' })
    ])
  })
})

describe('DraftApprovals → nhật ký nháp', () => {
  it('ghi dịch vụ + tài khoản + người nhận; không tiêu đề, không nội dung; sửa nội dung → detail edited', async () => {
    const entries: ActionLogEntry[] = []
    const events: (DraftApprovalRequest | { id: string; closed: true })[] = []
    const approvals = new DraftApprovals({ emit: (e) => events.push(e), log, record: (e) => entries.push(e) })
    const account = { id: 'a1', email: 'me@example.com', label: 'Công việc' }
    const last = (): DraftApprovalRequest => events.filter((e): e is DraftApprovalRequest => !('closed' in e)).at(-1)!
    const draft = { service: 'gmail' as const, target: 'ban@example.com', subject: 'Tiêu đề kín', body: 'Nội dung kín', replyTo: null, account }
    const a = approvals.request('c1', draft)
    approvals.respond({ id: last().id, approve: true, body: 'Nội dung đã sửa' })
    await a
    const b = approvals.request('c1', { ...draft, service: 'telegram', target: 'Nhóm dự án', account: undefined })
    approvals.respond({ id: last().id, approve: false })
    await b
    const c = approvals.request('c1', draft)
    approvals.cancelAccount('a1')
    await c
    expect(entries.map((e) => [e.kind, e.target, e.decision, e.detail ?? null])).toEqual([
      ['draft', 'Gmail (me@example.com) → ban@example.com', 'approved', 'edited'],
      ['draft', 'Telegram → Nhóm dự án', 'rejected', null],
      ['draft', 'Gmail (me@example.com) → ban@example.com', 'stopped', 'account_disabled']
    ])
    expect(JSON.stringify(entries)).not.toMatch(/kín|đã sửa/)
    expect(draftTarget({ service: 'telegram', target: 'X' })).toBe('Telegram → X')
  })
})

describe('DeferredService → nhật ký hoãn duyệt (lịch hẹn)', () => {
  const migrations = join(__dirname, '..', '..', 'db', 'migrations')
  let handle: ReturnType<typeof openDatabase>
  let folder: string
  let grants: ScheduleGrants
  let entries: ActionLogEntry[]
  let deferred: DeferredService
  let registry: AppToolRegistry
  let conv: string
  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    folder = mkdtempSync(join(tmpdir(), 'mmc-rec-def-'))
    writeFileSync(join(folder, 'a.txt'), 'cũ\n')
    grants = { ...NO_GRANTS, folder, folderWrite: true, drafts: true }
    const scheduleId = new ScheduleRepository(handle.db, () => 'u1').create(
      { name: 'S', prompt: 'p', recurrence: { kind: 'daily', time: '08:00' }, projectId: null, grants, model: 'default', catchUp: true },
      'user',
      null
    ).id
    conv = new ConversationRepository(handle.db, () => 'u1').createForSchedule({ owner: 'u1', scheduleId, title: 'S', projectId: null, cwd: folder }).id
    entries = []
    deferred = new DeferredService({
      db: handle.db,
      getOwner: () => 'u1',
      now: () => Date.now(),
      scheduleGrants: () => grants,
      createDraft: async () => {},
      answer: async () => ({ text: '' }),
      revise: () => 'queued',
      changed: () => {},
      log,
      record: (e) => entries.push(e)
    })
    registry = new AppToolRegistry()
    deferred.registerTools(registry)
    deferred.begin(conv, { owner: 'u1', scheduleId, runId: 'r1', folder, folderWrite: true, drafts: true })
  })
  afterEach(() => {
    handle.close()
    rmSync(folder, { recursive: true, force: true })
  })
  const card = (kind: DeferredCard['kind']): DeferredCard => deferred.list(conv).find((c) => c.kind === kind)!

  it('file: đồng ý / từ chối / không còn quyền; nháp: đồng ý / từ chối — detail "deferred", kèm cuộc', async () => {
    await registry.call('propose_file_change', { path: 'a.txt', content: 'mới\n' }, { conversationId: conv })
    await registry.call('propose_file_change', { path: 'b.txt', content: 'b\n' }, { conversationId: conv })
    await registry.call('propose_file_change', { path: 'c.txt', content: 'c\n' }, { conversationId: conv })
    await deferred.approveFiles(card('changeset').id, ['a.txt'])
    deferred.rejectFiles(card('changeset').id, ['b.txt'])
    grants = { ...grants, folderWrite: false }
    await deferred.approveFiles(card('changeset').id, ['c.txt'])
    const sink = deferred.draftSink(conv)!
    const d = { service: 'telegram' as const, account: null, recipients: ['Nhóm'], unknownRecipients: [], subject: null, body: 'kín', replyTo: null }
    sink({ draft: d, to: [], replyToId: null, chatId: '1' })
    await deferred.approveDraft(card('draft').id)
    sink({ draft: d, to: [], replyToId: null, chatId: '1' })
    deferred.rejectDraft(deferred.list(conv).find((c) => c.kind === 'draft' && c.status === 'pending')!.id)
    expect(entries.map((e) => [e.kind, e.target, e.decision, e.detail, e.conversationId])).toEqual([
      ['file_edit', 'a.txt', 'approved', 'deferred', conv],
      ['file_edit', 'b.txt', 'rejected', 'deferred', conv],
      ['file_edit', 'c.txt', 'blocked', 'deferred: no_permission', conv],
      ['draft', 'Telegram → Nhóm', 'approved', 'deferred', conv],
      ['draft', 'Telegram → Nhóm', 'rejected', 'deferred', conv]
    ])
  })
})
