import {
  SCHEDULE_DAILY_RUNS,
  SCHEDULE_FAILURES_PAUSE,
  SCHEDULE_QUEUE_MAX_MS,
  SCHEDULE_RUN_TIMEOUT_MS,
  SCHEDULE_WAKE_DELAY_MS,
  type Schedule,
  type ScheduleRunReason,
  type ScheduleRunStatus,
  type ScheduleRunTrigger,
  type SchedulesSettings,
  type SchedulesStatus
} from '@shared/schedules'
import { nextOccurrence, planDue, startOfDay, startOfNextDay } from './recurrence'
import type { ScheduleRepository } from './repository'

/** Kết quả một lượt chat theo lịch (ChatService.runScheduled). */
export type RunOutcome = { status: 'done' | 'error' | 'aborted'; error: string | null; toolCount: number }

export type RunHandle = { conversationId: string; done: Promise<RunOutcome>; abort(): void }

/** Báo người dùng (thông báo Windows hoặc trong app — index.ts quyết định). Không bao giờ chứa nội dung trả lời. */
export type ScheduleNotice =
  | { kind: 'finished'; scheduleId: string; name: string; status: ScheduleRunStatus; reason: ScheduleRunReason | null; conversationId: string | null }
  | { kind: 'paused'; scheduleId: string; name: string; reason: 'failures' }
  | { kind: 'pausedAll'; reason: 'hotkey' | 'quota' }
  | { kind: 'dailyLimit' }

export const RUN_HOLDER = 'schedule-run'

export type SchedulerDeps = {
  repo: ScheduleRepository
  now(): number
  getSettings(): SchedulesSettings
  setSettings(value: SchedulesSettings): void
  /** Tài khoản có lịch chạy lần trước (đổi tài khoản → không tính bỏ lỡ). */
  getLastOwner(): string | null
  setLastOwner(owner: string): void
  /** Tạo cuộc trò chuyện + bắt đầu lượt chat CHỈ ĐỌC theo quyền của lịch. Lỗi ném ra = lần chạy lỗi. */
  startRun(schedule: Schedule, owner: string): RunHandle
  folderExists(path: string): boolean
  killSwitch: { arm(holder: string): boolean; disarm(holder: string): void }
  notify(notice: ScheduleNotice): void
  /** Báo sync `schedules` (+ `conversations` khi có cuộc mới). */
  changed(conversations?: boolean): void
  log: { info(msg: string): void; warn(msg: string): void }
}

type Pending = {
  scheduleId: string
  owner: string
  trigger: ScheduleRunTrigger
  scheduledFor: number
  missed: number
  queuedAt: number
}

type Running = {
  runId: string
  scheduleId: string
  owner: string
  conversationId: string
  startedAt: number
  handle: RunHandle
  /** Lý do dừng do app / người dùng (null = tự kết thúc). */
  stop: { status: 'timeout' | 'aborted'; reason: ScheduleRunReason | null } | null
  /** Máy ngủ trong lúc chạy. */
  slept: boolean
  noHotkey: boolean
}

const QUOTA = /usage limit|rate.?limit|hit your limit|limit reached|quota|out of (extra )?usage/i
const CLI_MISSING = /^(not_installed|not_logged_in)$/

/**
 * Bộ hẹn giờ của lịch hẹn. Chỉ chạy khi app mở; CHỈ lịch của tài khoản đang đăng nhập, và chỉ sau khi renderer báo
 * tài khoản (trước đó chưa biết chủ dữ liệu). Mỗi lúc một lần chạy; lịch khác tới giờ thì xếp hàng.
 * Đồng hồ / bộ đếm giờ truyền vào → test (và e2e với đồng hồ giả) tua được thời gian.
 */
export class Scheduler {
  private owner: string | null = null
  private holdUntil = 0
  private pending: Pending[] = []
  private running: Running | null = null
  /** Đã báo "hết lượt hôm nay" cho ngày này. */
  private limitNoticeDay = 0
  private ticking = false

  constructor(private readonly deps: SchedulerDeps) {}

  /** Mở app: dòng "đang chạy" cũ (app tắt giữa chừng) → đã dừng; chờ 2 phút rồi mới chạy. */
  start(): void {
    const n = this.deps.repo.markInterrupted()
    if (n) this.deps.log.info(`Lịch hẹn: ${n} lần chạy bị gián đoạn khi app tắt`)
    this.holdUntil = this.deps.now() + SCHEDULE_WAKE_DELAY_MS
  }

  /** Máy thức dậy: lần đang chạy quá giờ (máy ngủ giữa chừng) → dừng; chờ 2 phút rồi mới chạy lượt mới / chạy bù. */
  resume(): void {
    this.holdUntil = this.deps.now() + SCHEDULE_WAKE_DELAY_MS
    if (this.running) this.running.slept = true
    this.tick()
  }

  /**
   * Renderer báo tài khoản. Tài khoản khác với lần trước có lịch chạy → thời gian đó KHÔNG tính bỏ lỡ: chỉ tính lại
   * lần hẹn tới từ bây giờ (không chạy bù hàng loạt).
   */
  setAccount(owner: string): void {
    if (this.owner === owner) return
    if (this.running && this.running.owner !== owner) this.stopRunning('aborted', 'user_stop')
    this.pending = this.pending.filter((p) => p.owner === owner)
    this.owner = owner
    if (this.deps.getLastOwner() !== owner) {
      this.reschedule(owner)
      this.deps.setLastOwner(owner)
    }
    this.deps.changed()
    this.tick()
  }

  /** Tính lại lần hẹn tới của mọi lịch đang bật từ bây giờ (đổi tài khoản, bật lại sau khi tạm dừng / tắt tính năng). */
  private reschedule(owner: string): void {
    const now = this.deps.now()
    for (const s of this.deps.repo.enabledFor(owner)) {
      const next = nextOccurrence(s.recurrence, now)
      // Lịch một lần đã qua giờ trong lúc không chạy được → tắt (không chạy bù, không tính bỏ lỡ).
      if (next === null) this.deps.repo.patch(s.id, { enabled: false, nextRunAt: null })
      else if (next !== s.nextRunAt) this.deps.repo.patch(s.id, { nextRunAt: next })
    }
  }

  private active(settings = this.deps.getSettings()): boolean {
    return settings.enabled && !settings.pausedAll && !(settings.pausedUntil && settings.pausedUntil > this.deps.now())
  }

  /** Vòng kiểm tra (30 giây, khi máy thức, khi có thay đổi). Không làm mới giao diện — chỉ báo khi trạng thái đổi. */
  tick(): void {
    if (this.ticking) return
    this.ticking = true
    try {
      this.checkRunning()
      this.liftQuotaPause()
      const owner = this.owner
      if (!owner || !this.active()) return
      const now = this.deps.now()
      if (now < this.holdUntil) return
      this.collectDue(owner, now)
      if (!this.running) this.startNext(now)
    } finally {
      this.ticking = false
    }
  }

  private checkRunning(): void {
    const r = this.running
    if (!r || r.stop) return
    if (this.deps.now() - r.startedAt > SCHEDULE_RUN_TIMEOUT_MS) this.stopRunning('timeout', r.slept ? 'slept' : null)
  }

  /** Hết hạn mức → tạm dừng tới đầu ngày hôm sau; tới mốc thì tự chạy lại (giờ đã qua trong lúc dừng không tính bỏ lỡ). */
  private liftQuotaPause(): void {
    const s = this.deps.getSettings()
    if (!s.pausedUntil || s.pausedUntil > this.deps.now()) return
    this.deps.setSettings({ ...s, pausedUntil: null, pauseReason: s.pausedAll ? s.pauseReason : null })
    if (this.owner) this.reschedule(this.owner)
    this.deps.changed()
  }

  private collectDue(owner: string, now: number): void {
    let changed = false
    for (const s of this.deps.repo.due(owner, now)) {
      if (this.pending.some((p) => p.scheduleId === s.id) || this.running?.scheduleId === s.id) continue
      const plan = planDue(s.recurrence, s.nextRunAt!, now, s.catchUp)
      const doneOnce = plan.next === null
      changed = true
      if (s.skipNext) {
        this.deps.repo.insertRun({ scheduleId: s.id, scheduledFor: plan.scheduledFor, status: 'skipped', trigger: 'on_time', reason: 'skip_next', finishedAt: now })
        this.deps.repo.patch(s.id, { skipNext: false, nextRunAt: plan.next, ...(doneOnce ? { enabled: false, pausedReason: 'done' } : {}) })
        continue
      }
      if (plan.action === 'miss') {
        this.deps.repo.insertRun({ scheduleId: s.id, scheduledFor: plan.scheduledFor, status: 'missed', trigger: 'on_time', missed: plan.missed, finishedAt: now })
        this.deps.repo.patch(s.id, { nextRunAt: plan.next, lastStatus: 'missed', ...(doneOnce ? { enabled: false, pausedReason: 'done' } : {}) })
        continue
      }
      this.pending.push({ scheduleId: s.id, owner, trigger: plan.trigger, scheduledFor: plan.scheduledFor, missed: plan.missed, queuedAt: now })
      // Lần hẹn tới tính từ bây giờ (không chạy dồn); lịch một lần giữ nguyên tới khi chạy xong.
      if (!doneOnce) this.deps.repo.patch(s.id, { nextRunAt: plan.next })
      else this.deps.repo.patch(s.id, { nextRunAt: null })
    }
    if (changed) this.deps.changed()
  }

  private startNext(now: number): void {
    while (!this.running && this.pending.length) {
      this.pending.sort((a, b) => a.scheduledFor - b.scheduledFor)
      const p = this.pending.shift()!
      const s = this.deps.repo.get(p.scheduleId, p.owner)
      // Lịch đã bị xoá / tắt trong lúc chờ (Chạy ngay thì vẫn chạy dù lịch đang tắt).
      if (!s || (!s.enabled && p.trigger !== 'manual')) continue
      const base = { scheduleId: s.id, scheduledFor: p.scheduledFor, trigger: p.trigger, missed: p.missed }
      if (now - p.queuedAt > SCHEDULE_QUEUE_MAX_MS) {
        this.record(s, { ...base, status: 'skipped', reason: 'queue_timeout' })
        continue
      }
      if (this.deps.repo.startedSince(startOfDay(now)) >= SCHEDULE_DAILY_RUNS) {
        this.record(s, { ...base, status: 'skipped', reason: 'daily_limit' })
        if (this.limitNoticeDay !== startOfDay(now)) {
          this.limitNoticeDay = startOfDay(now)
          this.deps.notify({ kind: 'dailyLimit' })
        }
        continue
      }
      if (s.grants.folder && !this.deps.folderExists(s.grants.folder)) {
        this.record(s, { ...base, status: 'error', reason: 'folder_missing', detail: s.grants.folder, startedAt: now })
        this.afterFailure(s, 'error', 'folder_missing', null)
        continue
      }
      this.launch(s, p, now)
    }
  }

  /** Ghi một dòng nhật ký đã kết thúc (bỏ qua / lỗi trước khi chạy). */
  private record(
    s: Schedule,
    run: { scheduleId: string; scheduledFor: number; trigger: ScheduleRunTrigger; missed: number; status: ScheduleRunStatus; reason: ScheduleRunReason; detail?: string; startedAt?: number }
  ): void {
    const now = this.deps.now()
    this.deps.repo.insertRun({ ...run, finishedAt: now })
    this.deps.repo.patch(s.id, { lastStatus: run.status, ...(run.startedAt ? { lastRunAt: now } : {}) })
    this.finishOnce(s)
    this.deps.changed()
  }

  /** Lịch một lần: đã tới lượt (chạy / bỏ qua / lỗi) → tắt, ghi "đã xong". */
  private finishOnce(s: Schedule): void {
    if (s.recurrence.kind === 'once') this.deps.repo.patch(s.id, { enabled: false, pausedReason: 'done', nextRunAt: null })
  }

  private launch(s: Schedule, p: Pending, now: number): void {
    const run = this.deps.repo.insertRun({
      scheduleId: s.id,
      scheduledFor: p.scheduledFor,
      status: 'running',
      trigger: p.trigger,
      missed: p.missed,
      startedAt: now
    })
    // Phím dừng chỉ giữ TRONG LÚC chạy (không chiếm Ctrl+Alt+Q cả ngày khi app nằm khay). Không đăng ký được
    // (app khác giữ phím) vẫn chạy: lần chạy chỉ đọc, còn nút dừng trong app / khay.
    const armed = this.deps.killSwitch.arm(RUN_HOLDER)
    let handle: RunHandle
    try {
      handle = this.deps.startRun(s, p.owner)
    } catch (err) {
      if (armed) this.deps.killSwitch.disarm(RUN_HOLDER)
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log.warn(`Lịch hẹn "${s.name}": không bắt đầu được (${message})`)
      this.deps.repo.updateRun(run.id, { status: 'error', reason: 'error', detail: message, finishedAt: this.deps.now() })
      this.deps.repo.patch(s.id, { lastRunAt: now, lastStatus: 'error' })
      this.finishOnce(s)
      this.afterFailure(s, 'error', 'error', null)
      return
    }
    this.deps.repo.updateRun(run.id, { conversationId: handle.conversationId, ...(armed ? {} : { reason: 'no_hotkey' as const }) })
    this.deps.repo.patch(s.id, { lastRunAt: now, lastStatus: 'running' })
    this.running = {
      runId: run.id,
      scheduleId: s.id,
      owner: p.owner,
      conversationId: handle.conversationId,
      startedAt: now,
      handle,
      stop: null,
      slept: false,
      noHotkey: !armed
    }
    this.deps.log.info(`Lịch hẹn "${s.name}": bắt đầu (${p.trigger})`)
    this.deps.changed(true)
    void handle.done
      .catch((err: unknown): RunOutcome => ({ status: 'error', error: err instanceof Error ? err.message : String(err), toolCount: 0 }))
      .then((outcome) => this.finish(s, outcome))
  }

  private finish(s: Schedule, outcome: RunOutcome): void {
    const r = this.running
    if (!r || r.scheduleId !== s.id) return
    this.running = null
    if (!r.noHotkey) this.deps.killSwitch.disarm(RUN_HOLDER)
    let status: ScheduleRunStatus
    let reason: ScheduleRunReason | null = r.noHotkey ? 'no_hotkey' : null
    let detail: string | null = null
    if (r.stop) {
      status = r.stop.status
      reason = r.stop.reason
    } else if (outcome.status === 'done') status = 'done'
    else if (outcome.status === 'aborted') {
      status = 'aborted'
      reason = 'user_stop'
    } else {
      status = 'error'
      detail = outcome.error
      reason = outcome.error && CLI_MISSING.test(outcome.error) ? 'cli_missing' : outcome.error && QUOTA.test(outcome.error) ? 'quota' : 'error'
    }
    const now = this.deps.now()
    this.deps.repo.updateRun(r.runId, { status, reason, detail, finishedAt: now, toolCount: outcome.toolCount })
    this.deps.repo.patch(s.id, { lastStatus: status })
    this.finishOnce(s)
    this.deps.log.info(`Lịch hẹn "${s.name}": ${status}${reason ? ` (${reason})` : ''}`)
    if (reason === 'quota') {
      // Hết hạn mức Claude: tạm dừng MỌI lịch tới hôm sau (không tính là lỗi của lịch này).
      const settings = this.deps.getSettings()
      this.deps.setSettings({ ...settings, pausedUntil: startOfNextDay(now), pauseReason: settings.pausedAll ? settings.pauseReason : 'quota' })
      this.deps.notify({ kind: 'pausedAll', reason: 'quota' })
    } else if (status === 'error' || status === 'timeout') this.afterFailure(s, status, reason, r.conversationId)
    else this.deps.repo.patch(s.id, { consecutiveFailures: 0 })
    const fresh = this.deps.repo.get(s.id, r.owner)
    this.deps.notify({ kind: 'finished', scheduleId: s.id, name: s.name, status, reason, conversationId: r.conversationId })
    if (fresh && fresh.consecutiveFailures >= SCHEDULE_FAILURES_PAUSE && fresh.pausedReason === 'failures')
      this.deps.notify({ kind: 'paused', scheduleId: s.id, name: s.name, reason: 'failures' })
    this.deps.changed(true)
    this.tick()
  }

  /** Lỗi / hết giờ liền 3 lần (kể cả "không tìm thấy thư mục") → tự tạm dừng lịch. */
  private afterFailure(s: Schedule, status: ScheduleRunStatus, reason: ScheduleRunReason | null, conversationId: string | null): void {
    const fresh = this.deps.repo.get(s.id, this.deps.repo.ownerOf(s.id) ?? undefined)
    const failures = (fresh?.consecutiveFailures ?? s.consecutiveFailures) + 1
    const pause = failures >= SCHEDULE_FAILURES_PAUSE
    this.deps.repo.patch(s.id, { consecutiveFailures: failures, ...(pause ? { enabled: false, pausedReason: 'failures' } : {}) })
    if (pause) this.deps.log.warn(`Lịch hẹn "${s.name}": lỗi ${failures} lần liền → tạm dừng`)
    // Lỗi trước khi chạy (không có cuộc trò chuyện) cũng báo cho người dùng biết.
    if (!conversationId) {
      this.deps.notify({ kind: 'finished', scheduleId: s.id, name: s.name, status, reason, conversationId: null })
      if (pause) this.deps.notify({ kind: 'paused', scheduleId: s.id, name: s.name, reason: 'failures' })
    }
  }

  private stopRunning(status: 'timeout' | 'aborted', reason: ScheduleRunReason | null): void {
    const r = this.running
    if (!r || r.stop) return
    r.stop = { status, reason }
    r.handle.abort()
  }

  // ---- Người dùng ----

  /** "Chạy ngay": xếp hàng như lượt hẹn (vẫn tính giới hạn trong ngày, vẫn chỉ đọc). */
  runNow(scheduleId: string): boolean {
    const owner = this.owner
    if (!owner || !this.deps.getSettings().enabled) return false
    const s = this.deps.repo.get(scheduleId, owner)
    if (!s || this.running?.scheduleId === s.id || this.pending.some((p) => p.scheduleId === s.id)) return false
    const now = this.deps.now()
    this.pending.push({ scheduleId: s.id, owner, trigger: 'manual', scheduledFor: now, missed: 0, queuedAt: now })
    if (!this.running) this.startNext(now)
    this.deps.changed()
    return true
  }

  /** Nút "Dừng" (trang Lịch hẹn, khay, đầu cuộc trò chuyện). */
  stopCurrent(): boolean {
    if (!this.running) return false
    this.stopRunning('aborted', 'user_stop')
    return true
  }

  /** Ctrl+Alt+Q (hoặc nút dừng khẩn cấp): CHỈ khi đang có lần chạy → dừng + tạm dừng mọi lịch. */
  emergencyStop(): void {
    if (!this.running) return
    this.stopRunning('aborted', 'hotkey')
    this.setPausedAll(true, 'hotkey')
    this.deps.notify({ kind: 'pausedAll', reason: 'hotkey' })
  }

  /** "Tạm dừng tất cả" / "Tiếp tục": tạm dừng thì dừng luôn lần đang chạy; tiếp tục → giờ đã qua không tính bỏ lỡ. */
  setPausedAll(paused: boolean, reason: 'user' | 'hotkey' = 'user'): SchedulesSettings {
    const s = this.deps.getSettings()
    const next: SchedulesSettings = paused
      ? { ...s, pausedAll: true, pauseReason: reason }
      : { ...s, pausedAll: false, pauseReason: null, pausedUntil: null }
    this.deps.setSettings(next)
    if (paused) {
      this.pending = []
      this.stopRunning('aborted', reason === 'hotkey' ? 'hotkey' : 'user_stop')
    } else if (this.owner) {
      this.reschedule(this.owner)
      this.tick()
    }
    this.deps.changed()
    return next
  }

  /** Bật / tắt cả tính năng. Tắt → dừng lần đang chạy, bỏ hàng chờ. Bật lại → tính lại lần hẹn tới từ bây giờ. */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.pending = []
      this.stopRunning('aborted', 'user_stop')
    } else if (this.owner) this.reschedule(this.owner)
    this.deps.changed()
    if (enabled) this.tick()
  }

  /** Lịch bị tắt / xoá / sửa → bỏ khỏi hàng chờ (lần đang chạy thì để chạy xong, trừ khi xoá). */
  forget(scheduleId: string, stop = false): void {
    this.pending = this.pending.filter((p) => p.scheduleId !== scheduleId)
    if (stop && this.running?.scheduleId === scheduleId) this.stopRunning('aborted', 'user_stop')
  }

  isRunning(conversationId: string): boolean {
    return this.running?.conversationId === conversationId
  }

  status(): SchedulesStatus {
    const now = this.deps.now()
    const r = this.running
    return {
      settings: this.deps.getSettings(),
      running: r && r.owner === this.owner ? { runId: r.runId, scheduleId: r.scheduleId, conversationId: r.conversationId, startedAt: r.startedAt } : null,
      today: this.deps.repo.startedSince(startOfDay(now)),
      dailyLimit: SCHEDULE_DAILY_RUNS,
      unseen: this.owner ? this.deps.repo.unseen(this.owner) : 0
    }
  }

  /** Lần chạy đang diễn ra (cho thanh khay). */
  get busy(): boolean {
    return this.running !== null
  }
}
