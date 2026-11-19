import { z } from 'zod'
import type { DraftApprovalRequest } from './connectors'
import type { CodeApprovalRequest, FolderAccessRequest } from './types'

/** Không trả lời sau 10 phút (tính lại sau mỗi câu trả lời của "Hỏi lại") → coi như từ chối. */
export const APPROVAL_IDLE_MS = 10 * 60 * 1000
/**
 * Giới hạn tổng cho MỖI BẢN, kể cả khi đang hỏi đáp. Mỗi bản là một lần Claude CLI chờ quyết định riêng; "Yêu cầu
 * sửa" → bản mới lại có đủ 30 phút để đọc.
 */
export const APPROVAL_MAX_MS = 30 * 60 * 1000
/**
 * Số câu hỏi tối đa cho CẢ CHUỖI các bản của một đề xuất (mỗi câu là một lần gọi Claude, kèm lịch sử ngày càng dài).
 */
export const APPROVAL_MAX_QUESTIONS = 10
export const APPROVAL_QUESTION_MAX = 2000
export const APPROVAL_FEEDBACK_MAX = 2000

export type ApprovalQa = {
  question: string
  /** Câu trả lời (đang stream thì là phần đã nhận); lỗi thì là mã lỗi. */
  answer: string
  status: 'answering' | 'done' | 'error'
  /** Trợ lý thấy câu này thực chất là yêu cầu sửa → giao diện hiện nút "Gửi câu này như Yêu cầu sửa" (người dùng tự bấm). */
  suggestRevision?: boolean
}

/** Dòng trợ lý thêm cuối câu trả lời khi câu hỏi thực chất là yêu cầu sửa (app gỡ đi trước khi hiện). */
export const REVISION_HINT_MARKER = '[[yeu-cau-sua]]'

/**
 * Gỡ dấu `[[yeu-cau-sua]]` khỏi câu trả lời (kể cả phần dấu còn dở dang ở cuối khi đang stream).
 * `suggest` = câu trả lời có dấu.
 */
export function splitRevisionHint(text: string): { text: string; suggest: boolean } {
  const suggest = text.includes(REVISION_HINT_MARKER)
  let out = text.split(REVISION_HINT_MARKER).join('')
  // Đang stream: "…[[yeu-c" ở cuối — ẩn phần có thể là đầu của dấu.
  const tail = /\[(\[[a-z-]*)?$/.exec(out)
  if (tail && REVISION_HINT_MARKER.startsWith(tail[0])) out = out.slice(0, tail.index)
  return { text: out.trimEnd(), suggest }
}

export type ApprovalRequest = CodeApprovalRequest | FolderAccessRequest | DraftApprovalRequest

/** Một bản cũ của cùng đề xuất (chỉ để xem): nội dung, hỏi đáp và yêu cầu sửa đã khép lại bản đó. */
export type ApprovalPastVersion<R extends ApprovalRequest = ApprovalRequest> = {
  version: number
  request: R
  qa: ApprovalQa[]
  /** "Yêu cầu sửa" của người dùng sau bản này. */
  revision: string
}

/**
 * Thẻ đang chờ người dùng duyệt, hiện trong khung chat của đúng cuộc trò chuyện. Các bản của cùng một đề xuất
 * ("Yêu cầu sửa" → bản 2, 3…) nằm chung một thẻ: `history` là các bản cũ, `request` / `qa` là bản mới nhất.
 */
export type ApprovalCard = {
  id: string
  conversationId: string
  createdAt: number
  qa: ApprovalQa[]
  /** 1 = đề xuất đầu; người dùng bấm "Yêu cầu sửa" → đề xuất mới cùng loại trong lượt đó là bản 2, 3… */
  version: number
  /** Id chung của cả chuỗi các bản (= id của bản 1) — giao diện giữ nguyên một thẻ qua các bản. */
  chainId: string
  /** Đã bấm "Yêu cầu sửa" với nội dung này, đang chờ trợ lý làm bản tiếp theo (không duyệt / hỏi được nữa). */
  revising: string | null
} & (
  | { kind: 'code'; request: CodeApprovalRequest; history: ApprovalPastVersion<CodeApprovalRequest>[] }
  | { kind: 'folder'; request: FolderAccessRequest; history: ApprovalPastVersion<FolderAccessRequest>[] }
  | { kind: 'draft'; request: DraftApprovalRequest; history: ApprovalPastVersion<DraftApprovalRequest>[] }
)

/** Số câu đã hỏi trong cả chuỗi (các bản cũ + bản hiện tại). */
export const questionCount = (card: Pick<ApprovalCard, 'qa' | 'history'>): number =>
  card.qa.length + card.history.reduce((n, v) => n + v.qa.length, 0)

/** Phần câu trả lời vừa nhận (stream) — dữ liệu đầy đủ vẫn lấy qua `approvals:list`. */
export type ApprovalDelta = { id: string; index: number; answer: string }

export type ApprovalAskResult = { status: 'started' | 'expired' | 'busy' | 'limit' }

export const approvalAskSchema = z.object({
  id: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(APPROVAL_QUESTION_MAX)
})

export const feedbackSchema = z.string().trim().max(APPROVAL_FEEDBACK_MAX).optional()
