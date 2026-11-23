import { z } from 'zod'
import type { ApprovalQa } from './approvals'

/**
 * Hoãn duyệt (Lịch hẹn 7b): lần chạy theo lịch KHÔNG dừng chờ người — đề xuất sửa file / nháp được ghi lại thành thẻ,
 * người dùng duyệt khi quay lại. Thẻ lưu DB (tắt app không mất), hết hạn sau 7 ngày.
 */

export const DEFERRED_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Mỗi lần chạy đề xuất tối đa bấy nhiêu file, mỗi file tối đa bấy nhiêu byte (UTF-8). */
export const PROPOSE_MAX_FILES = 20
export const PROPOSE_MAX_BYTES = 256 * 1024
export const DEFERRED_QUESTIONS_MAX = 10

/** revoked = người dùng thu hồi quyền của lịch (Cài đặt → Quyền & riêng tư) khi thẻ còn chờ — không duyệt được nữa. */
export type DeferredStatus = 'pending' | 'done' | 'expired' | 'revised' | 'revoked'

/** Một file trong "Bộ thay đổi": diff từ bản gốc (lúc đề xuất lần đầu) tới bản cuối. */
export type DeferredFile = {
  /** Đường dẫn tương đối trong thư mục (dấu /). */
  path: string
  isNew: boolean
  patch: string
  added: number
  removed: number
  /** Số lần trợ lý đề xuất lại file này trong lần chạy (Bản 2, 3…). */
  versions: number
  status: 'pending' | 'applied' | 'rejected' | 'conflict' | 'error'
  /** Lý do không ghi được (mã → i18n) + chi tiết. */
  error: DeferredFileError | null
}

export type DeferredFileError =
  | 'changed'
  | 'exists'
  | 'no_permission'
  | 'outside'
  | 'protected'
  | 'too_large'
  | 'write_failed'

export type DeferredDraft = {
  service: 'gmail' | 'telegram'
  /** Gmail: tài khoản lưu nháp. */
  account: { id: string; email: string; label: string } | null
  /** Người nhận (Gmail: email; Telegram: tên chat) — hiện TO, RÕ trên thẻ. */
  recipients: string[]
  /** Người nhận chưa từng liên lạc (không có thư nào từ / tới địa chỉ này) → cảnh báo. */
  unknownRecipients: string[]
  subject: string | null
  body: string
  /** Trả lời thư (tiêu đề thư gốc). */
  replyTo: string | null
  /** Lỗi lần bấm Đồng ý gần nhất (vd Gmail hết hạn đăng nhập) — thẻ vẫn chờ. */
  error: string | null
}

type CardBase = {
  id: string
  conversationId: string
  scheduleId: string | null
  scheduleName: string | null
  status: DeferredStatus
  qa: ApprovalQa[]
  createdAt: number
  expiresAt: number
}

export type DeferredCard =
  | (CardBase & { kind: 'changeset'; folder: string; files: DeferredFile[] })
  | (CardBase & { kind: 'draft'; draft: DeferredDraft })

export const deferredFilesSchema = z.object({
  id: z.uuid(),
  /** Bỏ trống = mọi file đang chờ ("Đồng ý tất cả" — CHỈ cho file, không có cho nháp). */
  paths: z.array(z.string().min(1).max(1000)).max(50).optional()
})

export const deferredDraftSchema = z.object({
  id: z.uuid(),
  /** Nội dung người dùng sửa trước khi tạo nháp. */
  body: z.string().max(20_000).optional()
})

export const deferredAskSchema = z.object({ id: z.uuid(), question: z.string().trim().min(1).max(2000) })
export const deferredReviseSchema = z.object({ id: z.uuid(), note: z.string().trim().min(1).max(2000) })

/** Kết quả bấm trên thẻ; lỗi biết trước → mã (i18n). */
export type DeferredActionResult = { status: 'ok'; card: DeferredCard } | { status: 'error'; error: string }
