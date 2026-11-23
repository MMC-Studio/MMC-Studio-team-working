import { z } from 'zod'

/** Nhật ký thao tác (bảng `action_log`, chỉ trên máy). */
export const ACTION_LOG_KINDS = ['command', 'file_edit', 'mcp', 'draft'] as const
export type ActionLogKind = (typeof ACTION_LOG_KINDS)[number]
/**
 * approved / rejected = người dùng bấm; timeout = hết hạn chờ; stopped = dừng lượt / Ctrl+Alt+Q / tắt tính năng;
 * blocked = app tự chặn (tham số / đường dẫn không hợp lệ) trước khi hỏi; auto = chạy không qua thẻ (MCP "luôn cho
 * phép"; PR C: tự duyệt sửa file).
 */
export const ACTION_LOG_DECISIONS = ['approved', 'rejected', 'timeout', 'stopped', 'blocked', 'auto'] as const
export type ActionLogDecision = (typeof ACTION_LOG_DECISIONS)[number]
/** Giữ nhật ký bao lâu. */
export const ACTION_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
/** Số dòng mỗi lần tải (bấm "Xem thêm" tải tiếp). */
export const ACTION_LOG_PAGE = 50

export const actionLogQuerySchema = z.object({
  kind: z.enum(ACTION_LOG_KINDS).nullable().default(null),
  /** null = mọi cuộc. */
  conversationId: z.string().max(100).nullable().default(null),
  /** Tìm theo tên lệnh / file / tool (không dấu, mọi từ phải khớp). */
  search: z.string().max(200).default(''),
  /** "Xem thêm" tăng dần số dòng (vẫn hỏi từ đầu) → danh sách luôn đúng khi có dòng mới chen lên đầu. */
  limit: z.number().int().min(1).max(2000).default(ACTION_LOG_PAGE),
  offset: z.number().int().min(0).default(0)
})
export type ActionLogQuery = z.input<typeof actionLogQuerySchema>

export type ActionLogItem = {
  id: string
  at: number
  kind: ActionLogKind
  target: string
  decision: ActionLogDecision
  exitCode: number | null
  durationMs: number | null
  detail: string | null
  /** Mọi thao tác đều ghi kèm cuộc; null = cuộc đó đã bị xoá (FK set null, nhật ký vẫn giữ). */
  conversationId: string | null
  conversationTitle: string | null
}

export type ActionLogPage = {
  items: ActionLogItem[]
  /** Tổng số dòng khớp bộ lọc (để biết còn "Xem thêm" không). */
  total: number
  /** Các cuộc có trong nhật ký (cho ô lọc theo cuộc), mới nhất trước. */
  conversations: { id: string; title: string }[]
}
