import {
  addedGrants,
  SCHEDULE_MAX,
  SCHEDULE_MAX_ENABLED,
  type Schedule,
  type ScheduleInput,
  type ScheduleRun,
  type ScheduleSaveError,
  type ScheduleSaveResult
} from '@shared/schedules'
import { nextOccurrence } from './recurrence'
import type { ScheduleRepository } from './repository'
import type { Scheduler } from './scheduler'

export class ScheduleError extends Error {
  constructor(readonly code: ScheduleSaveError | 'folder_not_found' | 'gmail_account_not_found' | 'disabled') {
    super(code)
  }
}

export type ScheduleServiceDeps = {
  repo: ScheduleRepository
  scheduler: Pick<Scheduler, 'forget' | 'tick'>
  now(): number
  /** Thư mục có thật trên máy (lúc lưu lịch). */
  isDirectory(path: string): boolean
  /** Tài khoản Gmail đã kết nối: id → tên gọi (hiện trong hộp xác nhận quyền). */
  gmailAccounts(): { id: string; label: string }[]
}

/**
 * Tạo / sửa / bật tắt / xoá lịch hẹn của tài khoản đang đăng nhập. Quyền MỚI (thư mục, tài khoản Gmail, Telegram)
 * — lúc tạo hay lúc sửa — chỉ được lưu khi người dùng đã xác nhận (`confirmed`); bỏ bớt quyền thì lưu thẳng.
 */
export class ScheduleService {
  constructor(private readonly deps: ScheduleServiceDeps) {}

  list(): Schedule[] {
    return this.deps.repo.list()
  }

  get(id: string): Schedule | null {
    return this.deps.repo.get(id)
  }

  runs(scheduleId: string | null, limit: number): ScheduleRun[] {
    return this.deps.repo.runs(scheduleId, limit)
  }

  private validate(input: ScheduleInput): void {
    if (input.projectId && !this.deps.repo.ownsProject(input.projectId)) throw new ScheduleError('project_not_found')
    if (input.recurrence.kind === 'once' && input.recurrence.at <= this.deps.now()) throw new ScheduleError('once_past')
    if (input.grants.folder && !this.deps.isDirectory(input.grants.folder)) throw new ScheduleError('folder_not_found')
    const known = new Set(this.deps.gmailAccounts().map((a) => a.id))
    if (input.grants.gmailAccounts.some((id) => !known.has(id))) throw new ScheduleError('gmail_account_not_found')
  }

  /** `origin = 'assistant'`: lịch trợ lý đề xuất, người dùng đã bấm tạo trên thẻ duyệt (luôn không có quyền nào). */
  save(input: { id?: string; input: ScheduleInput; confirmed: boolean }, origin: 'user' | 'assistant' = 'user'): ScheduleSaveResult {
    const prev = input.id ? this.deps.repo.get(input.id) : null
    if (input.id && !prev) throw new ScheduleError('not_found')
    this.validate(input.input)
    const labels = new Map(this.deps.gmailAccounts().map((a) => [a.id, a.label]))
    const added = addedGrants(prev?.grants ?? null, input.input.grants, (id) => labels.get(id) ?? id)
    if (added.length && !input.confirmed) return { status: 'confirm', added }
    const next = nextOccurrence(input.input.recurrence, this.deps.now())
    if (!prev) {
      const { total, enabled } = this.deps.repo.count()
      if (total >= SCHEDULE_MAX) throw new ScheduleError('limit_total')
      if (enabled >= SCHEDULE_MAX_ENABLED) throw new ScheduleError('limit_enabled')
      const created = this.deps.repo.create(input.input, origin, next)
      this.deps.scheduler.tick()
      return { status: 'saved', schedule: created }
    }
    this.deps.scheduler.forget(prev.id)
    const updated = this.deps.repo.edit(prev.id, input.input, prev.enabled ? next : prev.nextRunAt)
    if (!updated) throw new ScheduleError('not_found')
    this.deps.scheduler.tick()
    return { status: 'saved', schedule: updated }
  }

  /** Bật lại → lần hẹn tới tính từ bây giờ (giờ đã qua lúc tắt không tính bỏ lỡ), bỏ đếm lỗi. */
  setEnabled(id: string, enabled: boolean): Schedule {
    const s = this.deps.repo.get(id)
    if (!s) throw new ScheduleError('not_found')
    if (enabled && !s.enabled && this.deps.repo.count().enabled >= SCHEDULE_MAX_ENABLED) throw new ScheduleError('limit_enabled')
    const next = enabled ? nextOccurrence(s.recurrence, this.deps.now()) : null
    if (enabled && next === null) throw new ScheduleError('once_past')
    if (!enabled) this.deps.scheduler.forget(id)
    const updated = this.deps.repo.setEnabled(id, enabled, next)
    if (!updated) throw new ScheduleError('not_found')
    if (enabled) this.deps.scheduler.tick()
    return updated
  }

  /** "Bỏ qua lần tới" (bấm lại để huỷ bỏ qua). */
  setSkipNext(id: string, skip: boolean): Schedule {
    const s = this.deps.repo.get(id)
    if (!s) throw new ScheduleError('not_found')
    this.deps.repo.patch(id, { skipNext: skip })
    return { ...s, skipNext: skip }
  }

  /** Xoá lịch: nhật ký xoá theo, cuộc trò chuyện đã tạo GIỮ LẠI (thành cuộc thường). Đang chạy thì dừng. */
  remove(id: string): boolean {
    this.deps.scheduler.forget(id, true)
    return this.deps.repo.remove(id)
  }

  markSeen(conversationId: string): boolean {
    return this.deps.repo.markSeen(conversationId)
  }
}
