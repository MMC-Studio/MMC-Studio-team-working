import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_LOG_RETENTION_MS } from '@shared/actionLog'
import { openDatabase } from '../../db/client'
import { ConversationRepository } from '../../db/repositories'
import { ActionLogRepository } from '../actionLog'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

describe('ActionLogRepository', () => {
  let handle: ReturnType<typeof openDatabase>
  let owner: string
  let clock: number
  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    owner = 'u1'
    clock = Date.now()
  })
  afterEach(() => handle.close())

  const repo = (): ActionLogRepository => new ActionLogRepository(handle.db, () => owner, () => clock)

  it('ghi theo tài khoản, mới nhất trước; chỉ tên lệnh, cắt chuỗi dài', () => {
    const log = repo()
    log.add({ conversationId: null, kind: 'command', target: 'git status -- .', decision: 'approved', exitCode: 0, durationMs: 12 })
    clock += 1000
    log.add({ conversationId: null, kind: 'command', target: 'x'.repeat(5000), decision: 'blocked', detail: 'y'.repeat(2000) })
    owner = 'u2'
    log.add({ conversationId: null, kind: 'command', target: 'git log', decision: 'rejected' })
    owner = 'u1'
    const rows = log.list()
    expect(rows.map((r) => r.decision)).toEqual(['blocked', 'approved'])
    expect(rows[0].target).toHaveLength(1000)
    expect(rows[0].detail).toHaveLength(500)
    expect(rows[1]).toMatchObject({ exitCode: 0, durationMs: 12, kind: 'command' })
  })

  it('xoá cuộc trò chuyện → nhật ký vẫn còn (conversation_id = null)', () => {
    const conv = new ConversationRepository(handle.db, () => owner).create('free')
    const log = repo()
    log.add({ conversationId: conv.id, kind: 'command', target: 'git status', decision: 'approved' })
    new ConversationRepository(handle.db, () => owner).remove(conv.id)
    expect(log.list()).toEqual([expect.objectContaining({ conversationId: null, target: 'git status' })])
  })

  it('query: lọc loại / cuộc / chữ không dấu, phân trang + tổng, tên cuộc, danh sách cuộc; tài khoản khác không thấy', () => {
    const convs = new ConversationRepository(handle.db, () => owner)
    const a = convs.create('free')
    convs.setAutoTitle(a.id, 'Dự án Unity', 'fixed')
    const b = convs.create('free')
    const log = repo()
    const add = (conversationId: string, kind: 'command' | 'file_edit' | 'mcp' | 'draft', target: string): void => {
      clock += 1000
      log.add({ conversationId, kind, target, decision: 'approved' })
    }
    add(a.id, 'command', 'git status -- .')
    add(a.id, 'file_edit', 'Assets/Người chơi.cs')
    add(b.id, 'mcp', 'notion/search')
    add(b.id, 'draft', 'Gmail → ban@example.com')
    owner = 'u2'
    log.add({ conversationId: null, kind: 'command', target: 'git log', decision: 'rejected' })
    owner = 'u1'

    const all = log.query()
    expect(all.total).toBe(4)
    expect(all.items.map((i) => i.kind)).toEqual(['draft', 'mcp', 'file_edit', 'command'])
    expect(all.items[2]).toMatchObject({ conversationId: a.id, conversationTitle: 'Dự án Unity' })
    expect(all.conversations.map((c) => c.id)).toEqual([b.id, a.id])

    expect(log.query({ kind: 'mcp' }).items.map((i) => i.target)).toEqual(['notion/search'])
    expect(log.query({ conversationId: a.id }).total).toBe(2)
    // Không dấu, mọi từ phải khớp.
    expect(log.query({ search: 'nguoi CHOI' }).items.map((i) => i.target)).toEqual(['Assets/Người chơi.cs'])
    expect(log.query({ search: 'git unity' }).total).toBe(0)

    const page = log.query({ limit: 3 })
    expect(page.items).toHaveLength(3)
    expect(page.total).toBe(4)
    expect(log.query({ limit: 3, offset: 3 }).items.map((i) => i.kind)).toEqual(['command'])
    expect(log.query({ search: 'a', limit: 1 })).toMatchObject({ total: expect.any(Number), items: [expect.anything()] })

    // Xoá cuộc → dòng còn, tên cuộc null, không còn trong danh sách cuộc.
    convs.remove(a.id)
    const after = log.query({ kind: 'command' })
    expect(after.items[0]).toMatchObject({ conversationId: null, conversationTitle: null })
    expect(log.query().conversations.map((c) => c.id)).toEqual([b.id])
  })

  it('báo đổi (sync) mỗi lần ghi và khi dọn được mục', () => {
    const log = repo()
    const changed = vi.fn()
    log.onChange = changed
    log.add({ conversationId: null, kind: 'command', target: 'x', decision: 'approved' })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(log.prune()).toBe(0)
    expect(changed).toHaveBeenCalledTimes(1)
    clock += ACTION_LOG_RETENTION_MS + 1
    log.prune()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('dọn mục quá 90 ngày', () => {
    const log = repo()
    log.add({ conversationId: null, kind: 'command', target: 'cũ', decision: 'approved' })
    clock += ACTION_LOG_RETENTION_MS + 1
    log.add({ conversationId: null, kind: 'command', target: 'mới', decision: 'approved' })
    expect(log.prune()).toBe(1)
    expect(log.list().map((r) => r.target)).toEqual(['mới'])
  })
})
