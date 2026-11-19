import { z } from 'zod'
import type { DraftApprovalRequest } from './connectors'
import type { CodeApprovalRequest, FolderAccessRequest } from './types'

/** Không trả lời sau 10 phút (tính lại sau mỗi câu trả lời của "Hỏi lại") → coi như từ chối. */
export const APPROVAL_IDLE_MS = 10 * 60 * 1000
/** Giới hạn tổng cho mỗi thẻ, kể cả khi đang hỏi đáp. */
export const APPROVAL_MAX_MS = 30 * 60 * 1000
/** Số câu "Hỏi lại" tối đa cho một thẻ (mỗi câu là một lần gọi Claude). */
export const APPROVAL_MAX_QUESTIONS = 10
export const APPROVAL_QUESTION_MAX = 2000
export const APPROVAL_FEEDBACK_MAX = 2000

export type ApprovalQa = {
  question: string
  /** Câu trả lời (đang stream thì là phần đã nhận); lỗi thì là mã lỗi. */
  answer: string
  status: 'answering' | 'done' | 'error'
}

/** Thẻ đang chờ người dùng duyệt, hiện trong khung chat của đúng cuộc trò chuyện. */
export type ApprovalCard = {
  id: string
  conversationId: string
  createdAt: number
  qa: ApprovalQa[]
  /** 1 = đề xuất đầu; người dùng bấm "Yêu cầu sửa" → đề xuất mới cùng loại trong lượt đó là bản 2, 3… */
  version: number
  /** Yêu cầu sửa của người dùng mà bản này làm theo (null với bản 1). */
  revisionNote: string | null
} & (
  | { kind: 'code'; request: CodeApprovalRequest }
  | { kind: 'folder'; request: FolderAccessRequest }
  | { kind: 'draft'; request: DraftApprovalRequest }
)

/** Phần câu trả lời vừa nhận (stream) — dữ liệu đầy đủ vẫn lấy qua `approvals:list`. */
export type ApprovalDelta = { id: string; index: number; answer: string }

export type ApprovalAskResult = { status: 'started' | 'expired' | 'busy' | 'limit' }

export const approvalAskSchema = z.object({
  id: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(APPROVAL_QUESTION_MAX)
})

export const feedbackSchema = z.string().trim().max(APPROVAL_FEEDBACK_MAX).optional()
