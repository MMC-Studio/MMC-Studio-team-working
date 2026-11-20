import { z } from 'zod'

/**
 * Dự án cá nhân: hướng dẫn + file ngữ cảnh luôn gửi kèm trợ lý trong mọi cuộc trò chuyện của dự án.
 * Chỉ trên máy, theo tài khoản (khác "Dự án team" trên Supabase).
 */

export const PROJECT_NAME_MAX = 80
export const PROJECT_DESCRIPTION_MAX = 300
/** Hướng dẫn luôn gửi đầy đủ (không bao giờ bị cắt) nên giới hạn ngay lúc nhập. */
export const PROJECT_INSTRUCTIONS_MAX = 4_000
/**
 * Phần "Dự án" trong system prompt (hướng dẫn + file ngữ cảnh) tối đa bấy nhiêu ký tự — cộng thêm vào giới hạn
 * chung của prompt, chỉ ở cuộc trò chuyện thuộc dự án. Lớn hơn → mỗi tin tốn thêm hạn mức.
 */
export const PROJECT_PROMPT_CHARS = 16_000
export const PROJECT_FILE_MAX_BYTES = 512 * 1024
export const PROJECT_MAX_FILES = 20

export type Project = {
  id: string
  name: string
  description: string
  instructions: string
  pinned: boolean
  fileCount: number
  createdAt: number
  updatedAt: number
}

/**
 * File ngữ cảnh đưa vào prompt thế nào: đầy đủ / bị cắt bớt / chỉ gửi tên (hết chỗ).
 * Hiện cho người dùng biết ở cột phải trang dự án.
 */
export type ProjectFileUsage = 'full' | 'clipped' | 'omitted'

export type ProjectFile = {
  id: string
  name: string
  size: number
  /** Số ký tự nội dung. */
  chars: number
  usage: ProjectFileUsage
  createdAt: number
}

export type ProjectDetail = Project & {
  files: ProjectFile[]
  /** Số ký tự phần dự án trong prompt (≤ PROJECT_PROMPT_CHARS). */
  promptChars: number
}

/** Hộp xác nhận xoá dự án ghi rõ những gì sẽ mất / được giữ. */
export type ProjectDeleteInfo = { files: number; memories: number; conversations: number }

export type ProjectFileRejectReason = 'not_text' | 'too_large' | 'too_many' | 'unreadable'
export type ProjectAddFilesResult = {
  added: number
  rejected: { name: string; reason: ProjectFileRejectReason }[]
}

export const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX)

export const projectCreateSchema = z.object({
  name: projectNameSchema,
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).default('')
})

export const projectUpdateSchema = z.object({
  id: z.uuid(),
  name: projectNameSchema.optional(),
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).optional(),
  instructions: z.string().max(PROJECT_INSTRUCTIONS_MAX).optional(),
  pinned: z.boolean().optional()
})
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>
