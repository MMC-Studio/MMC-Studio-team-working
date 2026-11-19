import type { MemoryCategory } from '@shared/schemas'
import type { Memory } from '@shared/types'

/** Thứ tự nhóm trên trang Trí nhớ: thứ trợ lý dùng nhiều nhất lên đầu, "Khác" cuối. */
export const MEMORY_GROUP_ORDER: MemoryCategory[] = ['preference', 'project', 'goal', 'skill', 'deadline', 'other']

/** Số mục hiện sẵn trong mỗi nhóm; còn lại nằm sau "Xem thêm". */
export const MEMORIES_SHOWN = 5

export type MemoryGroup = { category: MemoryCategory; items: Memory[] }

/** Gom trí nhớ theo loại (giữ thứ tự trong từng nhóm), bỏ nhóm rỗng. Loại lạ → "Khác". */
export function groupMemories(memories: Memory[]): MemoryGroup[] {
  const buckets = new Map<MemoryCategory, Memory[]>()
  for (const m of memories) {
    const cat = MEMORY_GROUP_ORDER.includes(m.category) ? m.category : 'other'
    const list = buckets.get(cat)
    if (list) list.push(m)
    else buckets.set(cat, [m])
  }
  return MEMORY_GROUP_ORDER.flatMap((category) => {
    const items = buckets.get(category)
    return items ? [{ category, items }] : []
  })
}
