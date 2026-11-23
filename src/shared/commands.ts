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

/**
 * A2 — chạy Unity / Blender. Chương trình do NGƯỜI DÙNG tự chọn (hộp chọn file, không lấy từ PATH), bật riêng từng
 * phần mềm, mặc định tắt. Chạy code tuỳ ý (script C# của dự án, script Python) — app không giới hạn được việc chương
 * trình đó làm, nên luôn hỏi từng lần và chỉ có khi cuộc có quyền SỬA thư mục.
 */
export const APP_PROGRAMS = ['unity', 'blender'] as const
export type AppProgram = (typeof APP_PROGRAMS)[number]
/** Tên file chương trình phải đúng (không phân biệt hoa thường). */
export const APP_EXE_NAMES: Record<AppProgram, string> = { unity: 'Unity.exe', blender: 'blender.exe' }
export const APP_TIMEOUT_DEFAULT_MIN = 10
export const APP_TIMEOUT_MAX_MIN = 30
/** Script Blender lớn hơn → từ chối (thẻ phải hiện TRỌN script, không cắt). */
export const BLENDER_SCRIPT_MAX = 64 * 1024
export const BLENDER_SCRIPT_ARGS_MAX = 20
/** Phần CUỐI log gửi lại trợ lý (lỗi build / traceback nằm ở cuối). */
export const APP_LOG_TAIL_MAX = 64 * 1024
/** Giữ file log chạy Unity / Blender bao lâu (như nhật ký thao tác). */
export const APP_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export type AppSetting = { enabled: boolean; path: string | null }
export type AppsSettings = Record<AppProgram, AppSetting>
export const DEFAULT_APPS_SETTINGS: AppsSettings = { unity: { enabled: false, path: null }, blender: { enabled: false, path: null } }
const appSettingSchema = z.object({ enabled: z.boolean(), path: z.string().max(1000).nullable() })
export const appsSettingsSchema = z.object({ unity: appSettingSchema, blender: appSettingSchema })
export const appProgramSchema = z.enum(APP_PROGRAMS)
export const appToggleSchema = z.object({ program: appProgramSchema, enabled: z.boolean() })
export const appChooseSchema = z.object({ program: appProgramSchema })

/** Trạng thái một phần mềm trong Cài đặt: đường dẫn đã chọn + phiên bản đọc được (null = không đọc được). */
export type AppStatus = AppSetting & { version: string | null; missing: boolean }
export const DEFAULT_COMMANDS_SETTINGS: CommandsSettings = { gitEnabled: false }
export const commandsSettingsSchema = z.object({ gitEnabled: z.boolean() })

/** Trạng thái hiện trong Cài đặt: git tìm thấy ở đâu (null = không có / quá cũ). */
export type CommandsStatus = {
  settings: CommandsSettings
  git: { path: string; version: string } | { error: 'not_found' | 'too_old'; version?: string }
  apps: Record<AppProgram, AppStatus>
}

/** Kết quả chọn chương trình: lỗi = file không đúng tên (vd chọn Unity Hub.exe thay vì Unity.exe). */
export type AppChooseResult = { status: CommandsStatus } | { error: 'wrong_name'; expected: string } | { canceled: true }

/** Thẻ duyệt "Chạy lệnh" — `argv` là ĐÚNG những gì app sẽ chạy (kể cả các cờ an toàn app tự thêm). */
export type CommandApprovalRequest = {
  id: string
  conversationId: string
  program: 'git' | AppProgram
  /** Lệnh dễ đọc: `git status --short -- .` (không có cờ an toàn app thêm). */
  display: string
  /** Đường dẫn chương trình + toàn bộ tham số thật. */
  executable: string
  argv: string[]
  cwd: string
  timeoutMs: number
  /** Một câu trợ lý giải thích vì sao cần chạy. */
  reason: string
  /** Chỉ Unity / Blender: những gì người dùng cần thấy trước khi cho chạy code tuỳ ý. */
  app?: AppRunInfo
}

export type AppRunInfo = {
  /** File C# (Unity) / Python (Blender) trợ lý đã sửa (được duyệt) trong cuộc này, đường dẫn tương đối. */
  editedFiles: string[]
  /** Blender: TRỌN nội dung script sẽ chạy (≤ BLENDER_SCRIPT_MAX). */
  script?: { path: string; content: string }
  /** Unity: phiên bản dự án (= phiên bản Unity.exe đã chọn — đã kiểm khớp trước khi hỏi). */
  version?: string
  /** File log đầy đủ (trong thư mục dữ liệu app, không trong dự án). */
  logPath: string
}

/** Một lần chạy Unity / Blender — hiện trong khung chat (đang chạy: đồng hồ + Dừng; xong: kết quả + Mở log). */
export type CommandRun = {
  id: string
  conversationId: string
  program: AppProgram
  display: string
  startedAt: number
  timeoutMs: number
  logPath: string
  state: 'running' | 'done' | 'failed' | 'timeout' | 'stopped'
  exitCode: number | null
  endedAt: number | null
}

export const commandRunIdSchema = z.object({ id: z.string().min(1).max(100) })

export const commandDecisionSchema = z.object({
  id: z.string().min(1).max(100),
  approve: z.boolean(),
  feedback: z.string().trim().max(2000).optional()
})
export type CommandDecision = z.infer<typeof commandDecisionSchema>
