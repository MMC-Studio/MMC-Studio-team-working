import type { ToolEvent } from '@shared/types'

/** Tool của app có tiền tố `mcp__mmc__` — bỏ đi để tra tên dịch (`tools.<tên>`). */
export const appToolKey = (name: string): string => name.replace(/^mcp__mmc__/, '')

export type ToolCount = { name: string; count: number }

/** Đếm số lần dùng từng công cụ, giữ thứ tự xuất hiện đầu tiên. */
export function countTools(events: ToolEvent[]): ToolCount[] {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.name, (counts.get(e.name) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count }))
}

const DETAIL_KEYS = ['file_path', 'notebook_path', 'path', 'pattern', 'query', 'url', 'command', 'description'] as const

/** File / từ khoá / lệnh… kèm theo lần gọi (nếu có) để hiện khi mở danh sách. */
export function toolDetail(event: ToolEvent): string | null {
  const input = event.input
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const str = (key: string): string | null => {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  // Tìm kiếm có từ khoá: hiện từ khoá, kèm thư mục nếu có. Còn lại: giá trị đầu tiên tìm thấy.
  const pattern = str('pattern')
  const parts = pattern
    ? [pattern, str('path')].filter((p): p is string => !!p)
    : [DETAIL_KEYS.map(str).find((v) => v !== null) ?? null].filter((p): p is string => !!p)
  if (parts.length === 0) return null
  const text = parts.join(' · ').replace(/\s+/g, ' ')
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

export type ToolActivity = 'reading' | 'searching' | 'editing' | 'running' | 'web' | 'working'

/** Loại việc của công cụ đang chạy → dòng "Đang đọc file…", "Đang tìm…". */
export function toolActivity(name: string): ToolActivity {
  switch (name) {
    case 'Read':
    case 'NotebookRead':
      return 'reading'
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'searching'
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'editing'
    case 'Bash':
    case 'PowerShell':
      return 'running'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    default:
      return 'working'
  }
}
