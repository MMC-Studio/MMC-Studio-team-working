import {
  HOURLY_STEPS,
  NO_GRANTS,
  type Recurrence,
  type Schedule,
  type ScheduleGrants,
  type ScheduleInput,
  type ScheduleKind,
  type ScheduleModel,
  type ScheduleNoticeEvent,
  type ScheduleRun
} from '@shared/schedules'

export const SCHEDULES_ROUTE = '/scheduled'
export const schedulePath = (id: string): string => `${SCHEDULES_ROUTE}/${id}`

type T = (key: string, opts?: Record<string, unknown>) => string

const pad = (n: number): string => String(n).padStart(2, '0')

/** "Hằng ngày lúc 08:00", "Thứ 2, Thứ 6 lúc 17:00", "Mỗi 3 giờ (08:00–20:00)", "Một lần: 21/11 08:00". */
export function recurrenceText(r: Recurrence, t: T, locale: string): string {
  switch (r.kind) {
    case 'once':
      return t('recurrence.onceAt', {
        when: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(r.at)
      })
    case 'daily':
      return t('recurrence.dailyAt', { time: r.time })
    case 'weekly':
      return r.days.length === 7
        ? t('recurrence.dailyAt', { time: r.time })
        : t('recurrence.weeklyAt', { days: r.days.map((d) => t(`days.short.${d}`)).join(', '), time: r.time })
    case 'hourly':
      return t(r.every === 1 ? 'recurrence.hourly' : 'recurrence.everyHours', { n: r.every, from: `${pad(r.from)}:00`, to: `${pad(r.to % 24)}:00` })
  }
}

/** Lần chạy tới: "Hôm nay 08:00", "Ngày mai 08:00", "T2 23/11 17:00". */
export function nextRunText(at: number | null, now: number, t: T, locale: string): string | null {
  if (at === null) return null
  const d = new Date(at)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = (x: number): number => new Date(x).setHours(0, 0, 0, 0)
  const diff = Math.round((day(at) - day(now)) / 86_400_000)
  if (diff === 0) return t('next.today', { time })
  if (diff === 1) return t('next.tomorrow', { time })
  return t('next.other', { date: new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(at), time })
}

/** Dòng trạng thái của lịch trên danh sách. */
export function scheduleState(s: Schedule, paused: boolean): 'running' | 'off' | 'failures' | 'project_deleted' | 'done' | 'paused' | 'on' {
  if (s.lastStatus === 'running') return 'running'
  if (!s.enabled) return s.pausedReason ?? 'off'
  return paused ? 'paused' : 'on'
}

/** Nhãn của một dòng nhật ký: trạng thái + lý do (bỏ lỡ N lượt, chạy bù, ghi chú không có phím dừng…). */
export function runText(run: ScheduleRun, t: T): string {
  const parts = [t(`runStatus.${run.status}`)]
  if (run.trigger === 'catch_up') parts.push(t('runTrigger.catch_up'))
  if (run.trigger === 'manual') parts.push(t('runTrigger.manual'))
  if (run.missed > 0) parts.push(t('runMissed', { count: run.missed }))
  if (run.reason) parts.push(t(`runReason.${run.reason}`, { detail: run.detail ?? '' }))
  else if (run.status === 'error' && run.detail) parts.push(run.detail)
  return parts.join(' · ')
}

/** Ô nhập của hộp tạo / sửa lịch (chữ thô; đổi sang ScheduleInput lúc lưu). */
export type ScheduleForm = {
  name: string
  prompt: string
  kind: ScheduleKind
  /** "YYYY-MM-DDTHH:MM" (ô datetime-local). */
  onceAt: string
  time: string
  days: number[]
  every: (typeof HOURLY_STEPS)[number]
  from: number
  to: number
  projectId: string | null
  grants: ScheduleGrants
  model: ScheduleModel
  catchUp: boolean
}

const localInput = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function emptyForm(now: number, projectId: string | null = null): ScheduleForm {
  const inHour = new Date(now)
  inHour.setHours(inHour.getHours() + 1, 0, 0, 0)
  return {
    name: '',
    prompt: '',
    kind: 'daily',
    onceAt: localInput(inHour.getTime()),
    time: '08:00',
    days: [1, 2, 3, 4, 5],
    every: 1,
    from: 8,
    to: 22,
    projectId,
    grants: NO_GRANTS,
    model: 'default',
    catchUp: true
  }
}

export function formFromSchedule(s: Schedule, now: number): ScheduleForm {
  const base = emptyForm(now, s.projectId)
  const r = s.recurrence
  return {
    ...base,
    name: s.name,
    prompt: s.prompt,
    kind: r.kind,
    onceAt: r.kind === 'once' ? localInput(r.at) : base.onceAt,
    time: r.kind === 'daily' || r.kind === 'weekly' ? r.time : base.time,
    days: r.kind === 'weekly' ? r.days : base.days,
    every: r.kind === 'hourly' ? r.every : base.every,
    from: r.kind === 'hourly' ? r.from : base.from,
    to: r.kind === 'hourly' ? r.to : base.to,
    grants: s.grants,
    model: s.model,
    catchUp: s.catchUp
  }
}

/** Ô nhập → dữ liệu lưu; thiếu / sai → mã lỗi (i18n `form.errors.<mã>`). */
export function formToInput(f: ScheduleForm): ScheduleInput | { error: 'name' | 'prompt' | 'onceAt' | 'days' | 'window' } {
  if (!f.name.trim()) return { error: 'name' }
  if (!f.prompt.trim()) return { error: 'prompt' }
  let recurrence: Recurrence
  switch (f.kind) {
    case 'once': {
      const at = new Date(f.onceAt).getTime()
      if (!f.onceAt || Number.isNaN(at)) return { error: 'onceAt' }
      recurrence = { kind: 'once', at }
      break
    }
    case 'daily':
      recurrence = { kind: 'daily', time: f.time }
      break
    case 'weekly':
      if (f.days.length === 0) return { error: 'days' }
      recurrence = { kind: 'weekly', days: [...f.days].sort((a, b) => a - b), time: f.time }
      break
    case 'hourly':
      if (f.to <= f.from) return { error: 'window' }
      recurrence = { kind: 'hourly', every: f.every, from: f.from, to: f.to }
      break
  }
  return {
    name: f.name.trim(),
    prompt: f.prompt.trim(),
    recurrence,
    projectId: f.projectId,
    grants: f.grants,
    model: f.model,
    // Theo giờ không bao giờ chạy bù (giữ lựa chọn khi đổi kiểu lịch qua lại).
    catchUp: f.kind === 'hourly' ? false : f.catchUp
  }
}

/** Có quyền nào không (hiện dòng "Chỉ đọc: …" / "Không có quyền thêm"). */
export const hasGrants = (g: ScheduleGrants): boolean => !!g.folder || g.gmailAccounts.length > 0 || g.telegram

/** Chữ của một thông báo (i18n) — chỉ tên lịch + trạng thái, không có nội dung trả lời. */
export function noticeText(e: ScheduleNoticeEvent, t: T): string {
  const name = e.name ?? ''
  switch (e.kind) {
    case 'finished':
      if (e.status === 'done') return e.pending ? t('notice.donePending', { name, count: e.pending }) : t('notice.done', { name })
      if (e.status === 'timeout') return t('notice.timeout', { name })
      if (e.status === 'aborted') return t('notice.aborted', { name })
      if (e.reason === 'folder_missing') return t('notice.folderMissing', { name })
      if (e.reason === 'quota') return t('notice.quotaRun', { name })
      if (e.reason === 'cli_missing') return t('notice.cliMissing', { name })
      return t('notice.error', { name })
    case 'paused':
      return t('notice.pausedFailures', { name })
    case 'pausedAll':
      return t(e.reason === 'quota' ? 'notice.pausedQuota' : 'notice.pausedHotkey')
    case 'dailyLimit':
      return t('notice.dailyLimit')
  }
}
