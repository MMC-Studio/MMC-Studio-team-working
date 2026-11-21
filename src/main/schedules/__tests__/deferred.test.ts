import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFERRED_TTL_MS, PROPOSE_MAX_FILES, type DeferredCard } from '@shared/deferred'
import { NO_GRANTS, type ScheduleGrants } from '@shared/schedules'
import { openDatabase } from '../../db/client'
import { ConversationRepository } from '../../db/repositories'
import { AppToolRegistry } from '../../tools/registry'
import { DeferredService, deferredExplainPrompt, type DraftPayload } from '../deferred'
import { ScheduleRepository } from '../repository'
import { scheduledPrompt } from '../runner'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

describe('DeferredService — hoãn duyệt', () => {
  let handle: ReturnType<typeof openDatabase>
  let folder: string
  let clock: number
  let grants: ScheduleGrants
  let registry: AppToolRegistry
  let deferred: DeferredService
  let conv: string
  let scheduleId: string
  let createDraft: ReturnType<typeof vi.fn>
  let revise: ReturnType<typeof vi.fn>

  const make = (): DeferredService =>
    new DeferredService({
      db: handle.db,
      getOwner: () => 'u1',
      now: () => clock,
      scheduleGrants: () => grants,
      createDraft: createDraft as never,
      answer: async (_card, q) => ({ text: `Trả lời: ${q}` }),
      revise: revise as never,
      changed: () => {},
      log: { info: () => {}, warn: () => {} }
    })

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    folder = mkdtempSync(join(tmpdir(), 'mmc-deferred-'))
    writeFileSync(join(folder, 'a.txt'), 'dòng 1\ndòng 2\n')
    clock = Date.now()
    grants = { ...NO_GRANTS, folder, folderWrite: true, drafts: true }
    const schedules = new ScheduleRepository(handle.db, () => 'u1')
    scheduleId = schedules.create(
      { name: 'S', prompt: 'p', recurrence: { kind: 'daily', time: '08:00' }, projectId: null, grants, model: 'default', catchUp: true },
      'user',
      null
    ).id
    conv = new ConversationRepository(handle.db, () => 'u1').createForSchedule({ owner: 'u1', scheduleId, title: 'S', projectId: null, cwd: folder }).id
    createDraft = vi.fn(async () => {})
    revise = vi.fn(() => 'queued')
    registry = new AppToolRegistry()
    deferred = make()
    deferred.registerTools(registry)
    deferred.begin(conv, { owner: 'u1', scheduleId, runId: 'run1', folder, folderWrite: true, drafts: true })
  })
  afterEach(() => {
    handle.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const propose = (path: string, content: string) => registry.call('propose_file_change', { path, content }, { conversationId: conv })
  const text = (r: { content: { type: string; text?: string }[] }): string => r.content.map((c) => c.text ?? '').join('')
  const changeset = (): Extract<DeferredCard, { kind: 'changeset' }> => deferred.list(conv).find((c) => c.kind === 'changeset') as never

  it('sửa cùng file 3 lần → MỘT thẻ, diff từ bản gốc tới bản 3; read_proposed trả bản mới nhất; file trên đĩa chưa đổi', async () => {
    await propose('a.txt', 'dòng 1\nbản 1\n')
    await propose('a.txt', 'dòng 1\nbản 2\n')
    expect(text(await propose(join(folder, 'a.txt'), 'dòng 1\nbản 3\n'))).toContain('(bản 3)')
    const card = changeset()
    expect(deferred.list(conv)).toHaveLength(1)
    expect(card.files).toHaveLength(1)
    expect(card.files[0]).toMatchObject({ path: 'a.txt', versions: 3, isNew: false, added: 1, removed: 1, status: 'pending' })
    expect(card.files[0].patch).toContain('-dòng 2')
    expect(card.files[0].patch).toContain('+bản 3')
    expect(text(await registry.call('read_proposed', { path: 'a.txt' }, { conversationId: conv }))).toContain('bản 3')
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('dòng 1\ndòng 2\n')
  })

  it('Đồng ý tất cả (chỉ file) → ghi đúng nội dung, tạo được file mới trong thư mục con, thẻ xong', async () => {
    await propose('a.txt', 'mới\n')
    await propose('src/b.ts', 'export {}\n')
    const r = await deferred.approveFiles(changeset().id)
    expect(r.status).toBe('ok')
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('mới\n')
    expect(readFileSync(join(folder, 'src', 'b.ts'), 'utf8')).toBe('export {}\n')
    expect(changeset()).toMatchObject({ status: 'done' })
    // Không còn file tạm.
    expect(readdirSync(folder).filter((f) => f.endsWith('.mmc-tmp'))).toEqual([])
  })

  it('file trên đĩa đổi sau khi đề xuất → KHÔNG ghi, báo "đã thay đổi"; file mới đã có người tạo → không ghi đè', async () => {
    await propose('a.txt', 'đề xuất\n')
    await propose('c.txt', 'mới\n')
    writeFileSync(join(folder, 'a.txt'), 'người dùng sửa\n')
    writeFileSync(join(folder, 'c.txt'), 'người dùng tạo\n')
    await deferred.approveFiles(changeset().id)
    const files = changeset().files
    expect(files.find((f) => f.path === 'a.txt')).toMatchObject({ status: 'conflict', error: 'changed' })
    expect(files.find((f) => f.path === 'c.txt')).toMatchObject({ status: 'conflict', error: 'exists' })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('người dùng sửa\n')
    expect(readFileSync(join(folder, 'c.txt'), 'utf8')).toBe('người dùng tạo\n')
    expect(changeset().status).toBe('pending')
  })

  it('gỡ quyền đề xuất sửa (hoặc đổi thư mục) trước khi Đồng ý → không ghi', async () => {
    await propose('a.txt', 'x\n')
    grants = { ...grants, folderWrite: false }
    await deferred.approveFiles(changeset().id)
    expect(changeset().files[0]).toMatchObject({ status: 'error', error: 'no_permission' })
    grants = { ...grants, folderWrite: true, folder: join(folder, 'khac') }
    await deferred.approveFiles(changeset().id)
    expect(changeset().files[0].error).toBe('no_permission')
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('dòng 1\ndòng 2\n')
  })

  it('từ chối từng file; đồng ý file còn lại → thẻ xong', async () => {
    await propose('a.txt', 'x\n')
    await propose('d.txt', 'y\n')
    deferred.rejectFiles(changeset().id, ['a.txt'])
    await deferred.approveFiles(changeset().id, ['d.txt'])
    expect(changeset().files.map((f) => f.status)).toEqual(['rejected', 'applied'])
    expect(changeset().status).toBe('done')
    expect(existsSync(join(folder, 'd.txt'))).toBe(true)
  })

  it('chặn ngoài thư mục, file bảo vệ / nhị phân, quá 20 file', async () => {
    expect((await propose('../ngoai.txt', 'x')).isError).toBe(true)
    expect((await propose('.git/config', 'x')).isError).toBe(true)
    expect((await propose('anh.png', 'x')).isError).toBe(true)
    for (let i = 0; i < PROPOSE_MAX_FILES; i++) expect((await propose(`f${i}.txt`, 'x')).isError).toBeUndefined()
    expect(text(await propose('f99.txt', 'x'))).toContain(`tối đa ${PROPOSE_MAX_FILES} file`)
  })

  it('ngoài lần chạy (hoặc lịch không có quyền sửa) → không có tool', async () => {
    deferred.end(conv)
    expect(registry.available({ conversationId: conv })).toEqual([])
    deferred.begin(conv, { owner: 'u1', scheduleId, runId: 'run2', folder, folderWrite: false, drafts: false })
    expect(registry.available({ conversationId: conv })).toEqual([])
    expect(deferred.draftSink(conv)?.({ draft: { service: 'telegram', account: null, recipients: ['A'], unknownRecipients: [], subject: null, body: 'b', replyTo: null }, to: [], replyToId: null, chatId: '1' })).toContain('không được soạn nháp')
    expect(deferred.draftSink('khac')).toBeNull()
  })

  it('thẻ lưu DB: tắt app (service mới) vẫn còn; quá 7 ngày → hết hạn, không duyệt được', async () => {
    await propose('a.txt', 'x\n')
    const again = make()
    expect(again.list(conv)).toHaveLength(1)
    clock += DEFERRED_TTL_MS + 1
    expect(again.list(conv)[0].status).toBe('expired')
    expect(await again.approveFiles(changeset().id)).toEqual({ status: 'error', error: 'expired' })
    expect(again.pendingCount()).toBe(0)
  })

  const draft = (service: 'gmail' | 'telegram' = 'gmail'): string => {
    const sink = deferred.draftSink(conv)!
    sink({
      draft: {
        service,
        account: service === 'gmail' ? { id: 'acc1', email: 'ban@x.com', label: 'Trường' } : null,
        recipients: ['la@ngoai.com'],
        unknownRecipients: ['la@ngoai.com'],
        subject: 'Chào',
        body: 'Nội dung',
        replyTo: null
      },
      to: ['la@ngoai.com'],
      replyToId: null,
      chatId: null
    })
    return deferred.list(conv).filter((c) => c.kind === 'draft').at(-1)!.id
  }

  it('nháp: mỗi nháp một thẻ, người nhận lạ được đánh dấu, duyệt TỪNG nháp (sửa được nội dung)', async () => {
    const a = draft()
    const b = draft()
    expect(deferred.list(conv).filter((c) => c.kind === 'draft')).toHaveLength(2)
    const card = deferred.list(conv).find((c) => c.id === a) as Extract<DeferredCard, { kind: 'draft' }>
    expect(card.draft).toMatchObject({ recipients: ['la@ngoai.com'], unknownRecipients: ['la@ngoai.com'] })
    await deferred.approveDraft(a, 'Nội dung đã sửa')
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect((createDraft.mock.calls[0] as [DraftPayload, string])[1]).toBe('Nội dung đã sửa')
    deferred.rejectDraft(b)
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(deferred.pendingCount()).toBe(0)
  })

  it('nháp: tạo lỗi (vd Gmail hết hạn) → thẻ vẫn chờ, ghi lỗi; lịch mất quyền soạn nháp → không tạo', async () => {
    const id = draft()
    createDraft.mockRejectedValueOnce(new Error('gmail_expired'))
    await deferred.approveDraft(id)
    const card = deferred.list(conv).find((c) => c.id === id) as Extract<DeferredCard, { kind: 'draft' }>
    expect(card).toMatchObject({ status: 'pending', draft: { error: 'gmail_expired' } })
    grants = { ...grants, drafts: false }
    await deferred.approveDraft(id)
    expect(createDraft).toHaveBeenCalledTimes(1)
  })

  it('Hỏi → câu trả lời lưu trên thẻ; Yêu cầu sửa → lượt mới cùng cuộc, thẻ khép lại', async () => {
    await propose('a.txt', 'x\n')
    const id = changeset().id
    deferred.ask(id, 'Sửa để làm gì?')
    await vi.waitFor(() => expect(changeset().qa[0]).toMatchObject({ status: 'done', answer: 'Trả lời: Sửa để làm gì?' }))
    expect(deferredExplainPrompt(changeset(), 'tiếp')).toContain('BỘ THAY ĐỔI')
    expect(deferred.revise(id, 'Đổi tên biến').status).toBe('ok')
    expect(revise).toHaveBeenCalledWith(expect.objectContaining({ scheduleId, conversationId: conv, note: 'Đổi tên biến' }))
    expect(changeset().status).toBe('revised')
  })

  it('prompt lần chạy: có quyền đề xuất → hướng dẫn dùng propose_file_change; không có → chỉ đọc', () => {
    expect(scheduledPrompt({ name: 'S', prompt: 'p' }, clock, [], { folderWrite: true, drafts: true })).toContain('propose_file_change')
    expect(scheduledPrompt({ name: 'S', prompt: 'p' }, clock, [])).toContain('Chỉ ĐỌC')
  })
})

