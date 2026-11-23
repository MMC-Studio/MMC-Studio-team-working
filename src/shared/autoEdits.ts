import { z } from 'zod'

/**
 * Tự duyệt sửa file trong một phiên (PR C): người dùng bấm "Đồng ý, và không hỏi lại trong phiên này" → trong phiên,
 * Edit / Write của trợ lý trong thư mục cuộc được duyệt không qua thẻ. App giữ bản gốc của mỗi file (lần sửa ĐẦU TIÊN
 * trong phiên) trên đĩa để "Hoàn tác tất cả" — kể cả sau khi phiên kết thúc / tắt app / crash, tới 7 ngày.
 */

/** Phiên dài tối đa (tính từ lúc bật, không gia hạn). */
export const AUTO_EDIT_SESSION_MS = 2 * 60 * 60 * 1000
/** Số file khác nhau tối đa được tự duyệt trong một phiên; file thứ 51 trở đi → thẻ như thường. */
export const AUTO_EDIT_MAX_FILES = 50
/** Sau khi phiên kết thúc, còn hoàn tác được trong bao lâu (bản gốc bị dọn lúc mở app). */
export const AUTO_EDIT_UNDO_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Vì sao phiên kết thúc: tắt (bấm Tắt / Thu hồi), hết 2 giờ, bỏ quyền sửa, gỡ / đổi thư mục, Ctrl+Alt+Q, app đóng
 * (kể cả crash — phát hiện lúc mở lại), bấm Hoàn tác tất cả.
 */
export const AUTO_EDIT_END_REASONS = ['stopped', 'expired', 'write_off', 'folder', 'kill_switch', 'app_closed', 'undo'] as const
export type AutoEditEndReason = (typeof AUTO_EDIT_END_REASONS)[number]

/**
 * Vì sao một lần sửa vẫn phải hỏi (không có nút tự duyệt trên thẻ / phiên đang bật mà vẫn hiện thẻ):
 * risky = file có thể dẫn tới chạy lệnh (lý do cụ thể đi kèm), shrink = file còn ít hơn ½ so với bản gốc đầu phiên,
 * too_large = file > 2 MB (không giữ được bản gốc), hard_link = file có nhiều hard link, limit = phiên đã đủ 50 file.
 */
export const AUTO_EDIT_ASK_REASONS = ['risky', 'shrink', 'too_large', 'hard_link', 'limit'] as const
export type AutoEditAskReason = (typeof AUTO_EDIT_ASK_REASONS)[number]

/** Gắn vào thẻ sửa file: có hiện nút "Đồng ý, và không hỏi lại" không; nếu không thì vì sao. */
export type AutoEditOffer =
  | { offer: true }
  | { offer: false; reason: AutoEditAskReason; detail?: string; sessionActive: boolean }

export type AutoEditFile = {
  path: string
  /** File do trợ lý tạo mới trong phiên → hoàn tác = xoá. */
  isNewFile: boolean
  /** Lần tự duyệt gần nhất. */
  at: number
  /** Số lần sửa file này trong phiên. */
  edits: number
}

export type AutoEditSession = {
  id: string
  conversationId: string
  /** Tên cuộc lúc xem (cuộc đã xoá → null). */
  title: string | null
  root: string
  startedAt: number
  /** Hết hạn tự duyệt (startedAt + 2 giờ). */
  endsAt: number
  /** null = đang tự duyệt. */
  endedAt: number | null
  endReason: AutoEditEndReason | null
  /** Hoàn tác được tới lúc này (chỉ khi đã kết thúc: endedAt + 7 ngày). */
  undoUntil: number | null
  /** File còn bản gốc để hoàn tác (đã hoàn tác thì không còn trong danh sách). */
  files: AutoEditFile[]
  /** Tổng số file khác nhau đã tự duyệt trong phiên (tính giới hạn 50, kể cả file đã hoàn tác). */
  counted: number
}

/** Kết quả "Hoàn tác tất cả". */
export type AutoEditUndoResult = {
  /** Đã khôi phục bản gốc (hoặc xoá file trợ lý tạo). */
  restored: string[]
  /** File bị sửa thêm sau lần tự duyệt cuối → KHÔNG ghi đè; người dùng chọn ghi đè (gửi lại `overwrite`) hoặc bỏ qua. */
  conflicts: string[]
  /** Không khôi phục được và không ghi đè được (đường dẫn giờ đi ra ngoài thư mục, có hard link, lỗi ghi). */
  failed: { path: string; reason: 'link_outside' | 'hard_link' | 'io' }[]
}

const idSchema = z.string().min(1).max(100)
export const autoEditSessionIdSchema = z.object({ sessionId: idSchema })
export const autoEditUndoSchema = z.object({
  sessionId: idSchema,
  /** Đường dẫn trong danh sách xung đột người dùng chọn ghi đè (lần bấm thứ hai). */
  overwrite: z.array(z.string().min(1).max(1000)).max(1000).default([])
})
export type AutoEditUndoInput = z.input<typeof autoEditUndoSchema>
