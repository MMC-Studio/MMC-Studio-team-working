import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/client'
import { ConversationRepository } from '../../db/repositories'
import { ActionLogRepository } from '../actionLog'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

describe('ActionLogRepository.editedFiles (A2: file vừa sửa trong cuộc)', () => {
  let handle: ReturnType<typeof openDatabase>
  let owner: string
  let clock: number
  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    owner = 'u1'
    clock = 1_000
  })
  afterEach(() => handle.close())

  it('chỉ file được đồng ý / tự duyệt, đúng cuộc, đúng tài khoản, đúng đuôi; lần sửa gần nhất', () => {
    const convs = new ConversationRepository(handle.db, () => owner)
    const a = convs.create('free').id
    const b = convs.create('free').id
    const log = new ActionLogRepository(handle.db, () => owner, () => clock)
    const edit = (conversationId: string, target: string, decision: 'approved' | 'rejected' | 'auto' | 'blocked'): void => {
      clock += 10
      log.add({ conversationId, kind: 'file_edit', target, decision })
    }
    edit(a, 'Assets/Editor/Build.cs', 'approved')
    edit(a, 'Assets/Scripts/Player.CS', 'auto')
    edit(a, 'Assets/Scripts/Enemy.cs', 'rejected')
    edit(a, 'Assets/Library.cs', 'blocked')
    edit(a, 'tools/export.py', 'approved')
    edit(b, 'Assets/Other.cs', 'approved')
    log.add({ conversationId: a, kind: 'command', target: 'git diff -- Assets/X.cs', decision: 'approved' })
    edit(a, 'Assets/Editor/Build.cs', 'approved')
    const last = clock
    owner = 'u2'
    log.add({ conversationId: a, kind: 'file_edit', target: 'Assets/Hidden.cs', decision: 'approved' })
    owner = 'u1'

    expect(log.editedFiles(a, ['.cs'])).toEqual([
      { path: 'Assets/Editor/Build.cs', at: last },
      { path: 'Assets/Scripts/Player.CS', at: 1_020 }
    ])
    expect(log.editedFiles(a, ['.py']).map((f) => f.path)).toEqual(['tools/export.py'])
    expect(log.editedFiles(b, ['.cs']).map((f) => f.path)).toEqual(['Assets/Other.cs'])
  })
})
