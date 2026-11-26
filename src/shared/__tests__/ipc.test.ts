import { describe, expect, it } from 'vitest'
import { ASSISTANT_IPC, COMMON_IPC, INTEGRATIONS_IPC, IPC, TEAM_IPC } from '../ipc'
import beforeSplit from './ipc-channels.before-split.json'

const groups = { COMMON_IPC, ASSISTANT_IPC, TEAM_IPC, INTEGRATIONS_IPC }

describe('kênh IPC tách theo nhóm', () => {
  it('không khoá nào nằm ở hai nhóm (spread sẽ lặng lẽ ghi đè)', () => {
    const owner = new Map<string, string>()
    for (const [group, channels] of Object.entries(groups)) {
      for (const key of Object.keys(channels)) {
        expect(owner.get(key), `${key} có ở ${owner.get(key)} và ${group}`).toBeUndefined()
        owner.set(key, group)
      }
    }
    expect(Object.keys(IPC)).toHaveLength(owner.size)
  })

  it('không hai khoá nào dùng chung một tên kênh', () => {
    const seen = new Map<string, string>()
    for (const [key, channel] of Object.entries(IPC)) {
      expect(
        seen.get(channel),
        `kênh '${channel}' trùng: ${seen.get(channel)} và ${key}`
      ).toBeUndefined()
      seen.set(channel, key)
    }
  })

  it('mọi kênh có từ trước khi tách vẫn còn và giữ nguyên tên (kênh mới không cần thêm vào file json)', () => {
    const current: Record<string, string> = IPC
    for (const [key, channel] of Object.entries(beforeSplit)) {
      expect(current[key], key).toBe(channel)
    }
  })
})
