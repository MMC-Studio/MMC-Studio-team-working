import { z } from 'zod'

/**
 * Lịch hẹn: trợ lý tự chạy một lời nhắn theo giờ hẹn, KHI APP ĐANG MỞ (không chạy nền, không chặn máy ngủ).
 * Mỗi lần chạy là một cuộc trò chuyện mới; quyền chốt lúc tạo lịch và lần chạy (7a) CHỈ ĐỌC.
 * Các con số là giới hạn bản beta — nâng lên dễ hơn hạ xuống.
 */

export const SCHEDULE_NAME_MAX = 80
export const SCHEDULE_PROMPT_MAX = 4_000
export const SCHEDULE_MAX = 20
export const SCHEDULE_MAX_ENABLED = 10
/** Tổng số lần chạy mỗi ngày trên máy (mọi lịch, mọi tài khoản, tính cả chạy bù và "Chạy ngay"). */
export const SCHEDULE_DAILY_RUNS = 8
export const SCHEDULE_RUN_TIMEOUT_MS = 10 * 60 * 1000
/** `--max-turns` của CLI: số bước (lượt gọi tool) tối đa trong một lần chạy. */
export const SCHEDULE_MAX_TURNS = 25
/** Lịch tới giờ khi lịch khác đang chạy thì xếp hàng; chờ quá lâu thì bỏ lượt. */
export const SCHEDULE_QUEUE_MAX_MS = 30 * 60 * 1000
/** Lỗi liền bấy nhiêu lần → tự tạm dừng lịch. */
export const SCHEDULE_FAILURES_PAUSE = 3
/** Trễ không quá mốc này vẫn tính là đúng giờ (app vừa mở / máy vừa thức, vòng kiểm tra 30 giây…). */
export const SCHEDULE_ON_TIME_MS = 5 * 60 * 1000
/** Sau khi mở app / máy thức dậy: chờ bấy nhiêu rồi mới chạy (mạng, CLI kịp sẵn sàng). */
export const SCHEDULE_WAKE_DELAY_MS = 2 * 60 * 1000
export const SCHEDULE_RUNS_KEEP = 200
export const SCHEDULE_RUNS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
export const HOURLY_STEPS = [1, 2, 3, 4, 6, 12] as const

/**
 * Tool một lần chạy theo lịch được dùng — danh sách CHO PHÉP: tool mới thêm vào app sau này mặc định KHÔNG có ở đây.
 * Không bao giờ: điều khiển máy (screenshot, cửa sổ, cây UI, log app), MCP ngoài, xin quyền thư mục, đề xuất lịch,
 * Edit/Write/Bash, soạn nháp (7b sẽ thêm dạng đề xuất hoãn).
 */
export const SCHEDULE_CLI_TOOLS = ['Read', 'Grep', 'Glob'] as const
export const SCHEDULE_APP_TOOLS = ['gmail_search', 'gmail_read', 'telegram_chats', 'telegram_read'] as const

export type ScheduleKind = 'once' | 'daily' | 'weekly' | 'hourly'

/** `time` = "HH:MM" giờ máy. `days`: 0 = Chủ nhật … 6 = Thứ bảy. Theo giờ: mốc `from` ≤ giờ < `to` (0–24). */
export type Recurrence =
  | { kind: 'once'; at: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'hourly'; every: (typeof HOURLY_STEPS)[number]; from: number; to: number }

/** Chạy bù tối đa một lần nếu trễ không quá mốc này (theo giờ: không bù, chờ lượt kế). */
export const CATCH_UP_GRACE_MS: Record<ScheduleKind, number> = {
  once: 12 * 60 * 60 * 1000,
  daily: 6 * 60 * 60 * 1000,
  weekly: 6 * 60 * 60 * 1000,
  hourly: 0
}

/** Quyền chốt lúc tạo lịch. Lúc chạy lấy phần chung với quyền đang bật trong app. */
export type ScheduleGrants = {
  /** Thư mục được ĐỌC (Read/Grep/Glob). */
  folder: string | null
  /** Id tài khoản Gmail được đọc. */
  gmailAccounts: string[]
  /** Đọc Telegram (theo danh sách chat được phép của Telegram). */
  telegram: boolean
}

export const NO_GRANTS: ScheduleGrants = { folder: null, gmailAccounts: [], telegram: false }

export type ScheduleModel = 'default' | 'cheap'

/** Lịch bị app tự tắt vì: lỗi liền 3 lần / dự án bị xoá / lịch một lần đã chạy xong. null = người dùng tự tắt. */
export type SchedulePauseReason = 'failures' | 'project_deleted' | 'done'

export type Schedule = {
  id: string
  name: string
  prompt: string
  recurrence: Recurrence
  projectId: string | null
  grants: ScheduleGrants
  model: ScheduleModel
  catchUp: boolean
  enabled: boolean
  pausedReason: SchedulePauseReason | null
  /** Bỏ qua lần hẹn tới (một lần). */
  skipNext: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: ScheduleRunStatus | null
  consecutiveFailures: number
  /** Trợ lý đề xuất (người dùng đã bấm tạo) hay người dùng tự tạo. */
  origin: 'user' | 'assistant'
  /** Số lần chạy chưa xem. */
  unseen: number
  createdAt: number
  updatedAt: number
}

export type ScheduleRunStatus = 'running' | 'done' | 'error' | 'timeout' | 'aborted' | 'missed' | 'skipped'
export type ScheduleRunTrigger = 'on_time' | 'catch_up' | 'manual'

/**
 * Mã lý do (hiện bằng i18n). Lỗi CLI không biết trước → `error` + chữ gốc trong `detail`.
 * folder_missing · daily_limit · queue_timeout · quota · paused · skip_next · slept · no_hotkey (chỉ ghi chú) ·
 * hotkey · user_stop · cli_missing · interrupted (app tắt giữa lúc chạy)
 */
export type ScheduleRunReason =
  | 'folder_missing'
  | 'daily_limit'
  | 'queue_timeout'
  | 'quota'
  | 'skip_next'
  | 'slept'
  | 'no_hotkey'
  | 'hotkey'
  | 'user_stop'
  | 'cli_missing'
  | 'interrupted'
  | 'error'

export type ScheduleRun = {
  id: string
  scheduleId: string
  scheduledFor: number
  startedAt: number | null
  finishedAt: number | null
  status: ScheduleRunStatus
  trigger: ScheduleRunTrigger
  reason: ScheduleRunReason | null
  /** Chữ gốc của lỗi / đường dẫn thư mục không tìm thấy. */
  detail: string | null
  /** Số lượt hẹn bị bỏ lỡ được gộp vào dòng này. */
  missed: number
  conversationId: string | null
  toolCount: number
  seenAt: number | null
}

/** Cài đặt chung (trên máy, mọi tài khoản dùng chung như điều khiển máy tính). */
export type SchedulesSettings = {
  enabled: boolean
  /** Lần đầu bật đã tick "Tôi hiểu". */
  acknowledged: boolean
  /** "Tạm dừng tất cả". */
  pausedAll: boolean
  pauseReason: 'user' | 'hotkey' | 'quota' | null
  /** Hết hạn mức: tự chạy lại từ mốc này. */
  pausedUntil: number | null
  /** Đóng cửa sổ → ẩn xuống khay thay vì thoát. */
  trayOnClose: boolean
  /** Đã hỏi "Ẩn xuống khay khi đóng?" chưa. */
  trayAsked: boolean
  /** Đã nhắc "Lịch hẹn sẽ không chạy khi app đã thoát" lúc bấm X. */
  closeHintShown: boolean
}

export const DEFAULT_SCHEDULES_SETTINGS: SchedulesSettings = {
  enabled: false,
  acknowledged: false,
  pausedAll: false,
  pauseReason: null,
  pausedUntil: null,
  trayOnClose: false,
  trayAsked: false,
  closeHintShown: false
}

export const schedulesSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  acknowledged: z.boolean().default(false),
  pausedAll: z.boolean().default(false),
  pauseReason: z.enum(['user', 'hotkey', 'quota']).nullable().default(null),
  pausedUntil: z.number().nullable().default(null),
  trayOnClose: z.boolean().default(false),
  trayAsked: z.boolean().default(false),
  closeHintShown: z.boolean().default(false)
})

export type SchedulesStatus = {
  settings: SchedulesSettings
  /** Lần đang chạy (null = không có). */
  running: { runId: string; scheduleId: string; conversationId: string; startedAt: number } | null
  /** Số lần đã chạy hôm nay / giới hạn. */
  today: number
  dailyLimit: number
  /** Tổng số lần chạy chưa xem (tài khoản hiện tại) — số trên mục "Lịch hẹn" ở thanh bên. */
  unseen: number
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const recurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.number().int().positive() }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME) }),
  z.object({
    kind: z.literal('weekly'),
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
    time: z.string().regex(TIME)
  }),
  z
    .object({
      kind: z.literal('hourly'),
      every: z.number().int().refine((n) => (HOURLY_STEPS as readonly number[]).includes(n)),
      from: z.number().int().min(0).max(23),
      to: z.number().int().min(1).max(24)
    })
    .refine((r) => r.to > r.from, { message: 'window' })
]) as unknown as z.ZodType<Recurrence>

export const scheduleGrantsSchema = z.object({
  folder: z.string().trim().min(1).max(1000).nullable(),
  gmailAccounts: z.array(z.string().min(1).max(100)).max(20).transform((a) => [...new Set(a)]),
  telegram: z.boolean()
})

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(SCHEDULE_NAME_MAX),
  prompt: z.string().trim().min(1).max(SCHEDULE_PROMPT_MAX),
  recurrence: recurrenceSchema,
  projectId: z.uuid().nullable(),
  grants: scheduleGrantsSchema,
  model: z.enum(['default', 'cheap']),
  catchUp: z.boolean()
})
export type ScheduleInput = z.infer<typeof scheduleInputSchema>

export const scheduleSaveSchema = z.object({
  /** Có id = sửa lịch có sẵn. */
  id: z.uuid().optional(),
  input: scheduleInputSchema,
  /** Người dùng đã xem và đồng ý các quyền MỚI (hộp xác nhận). */
  confirmed: z.boolean().default(false)
})

/** Quyền thêm so với trước (tạo mới: mọi quyền) — phải qua hộp xác nhận. */
export type ScheduleGrantChange =
  | { kind: 'folder'; path: string }
  | { kind: 'gmail'; accountId: string; label: string }
  | { kind: 'telegram' }

export type ScheduleSaveResult =
  | { status: 'saved'; schedule: Schedule }
  | { status: 'confirm'; added: ScheduleGrantChange[] }

export type ScheduleSaveError = 'limit_total' | 'limit_enabled' | 'project_not_found' | 'once_past' | 'not_found'

/** Quyền MỚI của `next` so với `prev` (null = tạo mới). Bỏ bớt quyền thì không cần hỏi. */
export function addedGrants(
  prev: ScheduleGrants | null,
  next: ScheduleGrants,
  gmailLabel: (id: string) => string = (id) => id
): ScheduleGrantChange[] {
  const out: ScheduleGrantChange[] = []
  if (next.folder && next.folder !== prev?.folder) out.push({ kind: 'folder', path: next.folder })
  for (const id of next.gmailAccounts)
    if (!prev?.gmailAccounts.includes(id)) out.push({ kind: 'gmail', accountId: id, label: gmailLabel(id) })
  if (next.telegram && !prev?.telegram) out.push({ kind: 'telegram' })
  return out
}

/** Trợ lý đề xuất lịch (thẻ duyệt): luôn chỉ đọc, không quyền thư mục / Gmail / Telegram. */
export type ScheduleProposalRequest = {
  id: string
  name: string
  prompt: string
  recurrence: Recurrence
  projectId: string | null
  projectName: string | null
  model: ScheduleModel
}

export const scheduleProposalDecisionSchema = z.object({
  id: z.string().min(1).max(100),
  approve: z.boolean(),
  feedback: z.string().trim().max(2000).optional()
})
export type ScheduleProposalDecision = z.infer<typeof scheduleProposalDecisionSchema>

export type ScheduleErrorResult = { status: 'error'; error: string }

/** main → renderer: bấm thông báo Windows → mở cuộc của lần chạy (hoặc trang của lịch). */
export type ScheduleOpenEvent = { conversationId: string | null; scheduleId: string | null }

/** main → renderer: kết quả / sự kiện của lịch hẹn (`inApp` = cửa sổ đang mở → hiện ngay trong app). */
export type ScheduleNoticeEvent = {
  kind: 'finished' | 'paused' | 'pausedAll' | 'dailyLimit'
  text: string
  inApp: boolean
  scheduleId?: string
  name?: string
  conversationId?: string | null
  status?: ScheduleRunStatus
  reason?: ScheduleRunReason | 'failures' | 'hotkey' | 'quota' | null
}

export const scheduleRunsQuerySchema = z.object({ scheduleId: z.uuid().nullable(), limit: z.number().int().min(1).max(200).default(50) })
