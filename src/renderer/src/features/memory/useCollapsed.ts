import { useState } from 'react'

/** Trạng thái thu gọn của một mục — chỉ là cách xem trên máy này, lưu localStorage (không vào DB). */
export function useCollapsed(key: string, initial = false): [boolean, (v: boolean) => void] {
  const storageKey = `mmc.memory.collapsed.${key}`
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === null ? initial : saved === '1'
    } catch {
      return initial
    }
  })
  return [
    collapsed,
    (v) => {
      setCollapsed(v)
      try {
        if (v === initial) localStorage.removeItem(storageKey)
        else localStorage.setItem(storageKey, v ? '1' : '0')
      } catch {
        // Không lưu được (chế độ riêng tư…) → vẫn đổi trong phiên này.
      }
    }
  ]
}
