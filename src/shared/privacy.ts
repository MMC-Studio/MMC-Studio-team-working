import { z } from 'zod'

/** Cài đặt → Quyền & riêng tư: quyền trợ lý đang có (B2). Chỉ đọc + thu hồi; cấp quyền vẫn ở chỗ cũ. */

/** Một cuộc trò chuyện đang có thư mục (đọc, hoặc đọc + sửa). */
export type PrivacyFolderGrant = {
  conversationId: string
  title: string
  path: string
  write: boolean
}

/**
 * Một quyền của lịch hẹn. `folder` = đọc thư mục (thu hồi thì mất luôn quyền đề xuất sửa), `folderWrite` = đề xuất sửa
 * file (hoãn duyệt), `gmail:<id>` = đọc một tài khoản Gmail, `telegram` = đọc Telegram, `drafts` = soạn nháp (hoãn duyệt).
 */
export const scheduleGrantKeySchema = z.union([
  z.enum(['folder', 'folderWrite', 'telegram', 'drafts']),
  z.string().regex(/^gmail:[\w.@+-]{1,200}$/)
])
export type ScheduleGrantKey = z.infer<typeof scheduleGrantKeySchema>

export type PrivacyScheduleGrant = {
  scheduleId: string
  name: string
  enabled: boolean
  grants: { key: ScheduleGrantKey; kind: 'folder' | 'folderWrite' | 'gmail' | 'telegram' | 'drafts'; label: string }[]
}

/** Toàn bộ trạng thái trang (mỗi phần đọc từ nơi lưu gốc; tab hỏi lại theo các mục sync sẵn có). */
export type PrivacyStatus = {
  folders: PrivacyFolderGrant[]
  schedules: PrivacyScheduleGrant[]
  /** Công tắc chung "Chạy lệnh git (chỉ đọc)" — chỉ hiện trạng thái, đổi ở Khả năng. */
  git: { enabled: boolean }
  /** Gmail / Telegram / agent / MCP: chỉ hiện trạng thái, quản lý ở trang Plugin. */
  gmail: { enabled: boolean; accounts: { email: string; label: string }[] }
  telegram: { enabled: boolean; account: string | null }
  agents: { enabled: boolean; clients: string[] }
  mcp: { name: string; enabled: boolean; alwaysAllow: string[] }[]
}

export const revokeFolderSchema = z.object({ conversationId: z.string().min(1).max(100) })
export const revokeScheduleGrantSchema = z.object({ scheduleId: z.string().min(1).max(100), key: scheduleGrantKeySchema })
