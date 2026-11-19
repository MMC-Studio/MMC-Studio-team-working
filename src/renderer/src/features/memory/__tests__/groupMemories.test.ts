import { describe, expect, it } from 'vitest'
import type { MemoryCategory } from '@shared/schemas'
import type { Memory } from '@shared/types'
import { groupMemories } from '../groupMemories'

const mem = (id: string, category: string): Memory =>
  ({ id, category: category as MemoryCategory, content: id }) as unknown as Memory

describe('gom trí nhớ theo loại', () => {
  it('theo thứ tự nhóm cố định, bỏ nhóm rỗng, giữ thứ tự trong nhóm', () => {
    const groups = groupMemories([mem('a', 'skill'), mem('b', 'preference'), mem('c', 'skill'), mem('d', 'other')])
    expect(groups.map((g) => g.category)).toEqual(['preference', 'skill', 'other'])
    expect(groups[1].items.map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('loại lạ (dữ liệu cũ) → "Khác"; danh sách rỗng → không nhóm nào', () => {
    expect(groupMemories([mem('x', 'cu'), mem('y', 'other')])).toEqual([
      { category: 'other', items: [mem('x', 'cu'), mem('y', 'other')] }
    ])
    expect(groupMemories([])).toEqual([])
  })
})
