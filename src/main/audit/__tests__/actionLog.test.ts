import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('dọn mục quá 90 ngày', () => {
    const log = repo()
    log.add({ conversationId: null, kind: 'command', target: 'cũ', decision: 'approved' })
    clock += ACTION_LOG_RETENTION_MS + 1
    log.add({ conversationId: null, kind: 'command', target: 'mới', decision: 'approved' })
    expect(log.prune()).toBe(1)
    expect(log.list().map((r) => r.target)).toEqual(['mới'])
  })
})
