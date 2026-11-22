import { z } from 'zod'

/**
 * Chạy lệnh theo danh sách cho phép (A1: chỉ git đọc). Trợ lý gọi tool `run_command` với tham số có cấu trúc; app
 * tự dựng lệnh, hỏi người dùng TỪNG LẦN (thẻ duyệt hiện nguyên lệnh), rồi tự chạy — không qua shell, không qua Bash
 * của Claude CLI. Mặc định tắt.
 */

export const GIT_SUBCOMMANDS = ['status', 'diff', 'log', 'show', 'branch'] as const
export type GitSubcommand = (typeof GIT_SUBCOMMANDS)[number]

/** Hạn mỗi lần chạy git. */
export const GIT_TIMEOUT_MS = 60_000
/** Phần output (stdout) gửi lại trợ lý; phần dài hơn bị cắt (giữ PHẦN ĐẦU — với git phần đầu có ích hơn). */
export const COMMAND_OUTPUT_MAX = 64 * 1024
export const COMMAND_STDERR_MAX = 4 * 1024
/** Đọc tối đa ngần này từ tiến trình rồi ngắt (đủ để biết tổng đã bị cắt). */
export const COMMAND_CAPTURE_MAX = 256 * 1024
export const COMMAND_ARGS_MAX = 30
export const COMMAND_PATHS_MAX = 20
export const COMMAND_ARG_CHARS = 200

export type CommandsSettings = { gitEnabled: boolean }
export const DEFAULT_COMMANDS_SETTINGS: CommandsSettings = { gitEnabled: false }
export const commandsSettingsSchema = z.object({ gitEnabled: z.boolean() })

/** Trạng thái hiện trong Cài đặt: git tìm thấy ở đâu (null = không có / quá cũ). */
export type CommandsStatus = {
  settings: CommandsSettings
  git: { path: string; version: string } | { error: 'not_found' | 'too_old'; version?: string }
}

/** Thẻ duyệt "Chạy lệnh" — `argv` là ĐÚNG những gì app sẽ chạy (kể cả các cờ an toàn app tự thêm). */
export type CommandApprovalRequest = {
  id: string
  conversationId: string
  program: 'git'
  /** Lệnh dễ đọc: `git status --short -- .` (không có cờ an toàn app thêm). */
  display: string
  /** Đường dẫn chương trình + toàn bộ tham số thật. */
  executable: string
  argv: string[]
  cwd: string
  timeoutMs: number
  /** Một câu trợ lý giải thích vì sao cần chạy. */
  reason: string
}

export const commandDecisionSchema = z.object({
  id: z.string().min(1).max(100),
  approve: z.boolean(),
  feedback: z.string().trim().max(2000).optional()
})
export type CommandDecision = z.infer<typeof commandDecisionSchema>
