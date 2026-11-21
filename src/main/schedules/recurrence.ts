import {
  CATCH_UP_GRACE_MS,
  SCHEDULE_ON_TIME_MS,
  type Recurrence,
  type ScheduleRunTrigger
} from '@shared/schedules'

/** Theo giờ máy ("HH:MM" của ngày chứa `day`). setHours lo luôn đổi giờ mùa hè (VN không có, máy khác có thể có). */
function atTime(day: Date, time: string): number {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Lần hẹn đầu tiên SAU `after` (không tính đúng `after`); null = không còn (lịch một lần đã qua). */
export function nextOccurrence(rec: Recurrence, after: number): number | null {
  switch (rec.kind) {
    case 'once':
      return rec.at > after ? rec.at : null
    case 'daily': {
      const today = atTime(new Date(after), rec.time)
      return today > after ? today : atTime(new Date(after + DAY_MS), rec.time)
    }
    case 'weekly': {
      for (let i = 0; i <= 7; i++) {
        const day = new Date(after + i * DAY_MS)
        if (!rec.days.includes(day.getDay())) continue
        const t = atTime(day, rec.time)
        if (t > after) return t
      }
      return null
    }
    case 'hourly': {
      const start = new Date(after)
      start.setMinutes(0, 0, 0)
      // Tối đa 2 ngày tới là chắc chắn gặp một mốc (khung giờ luôn có ít nhất một giờ).
      for (let i = 0; i <= 48; i++) {
        const d = new Date(start)
        d.setHours(start.getHours() + i)
        const h = d.getHours()
        if (d.getTime() > after && h >= rec.from && h < rec.to && (h - rec.from) % rec.every === 0) return d.getTime()
      }
      return null
    }
  }
}

/** Các lần hẹn trong khoảng (from, to] — tối đa `cap` lần (đủ để đếm "bỏ lỡ N lượt"). */
export function occurrencesBetween(rec: Recurrence, from: number, to: number, cap = 500): number[] {
  const out: number[] = []
  let t = nextOccurrence(rec, from)
  while (t !== null && t <= to && out.length < cap) {
    out.push(t)
    t = nextOccurrence(rec, t)
  }
  return out
}

export type DuePlan =
  | { action: 'run'; trigger: Exclude<ScheduleRunTrigger, 'manual'>; scheduledFor: number; missed: number; next: number | null }
  | { action: 'miss'; scheduledFor: number; missed: number; next: number | null }

/**
 * Lịch tới giờ (`dueAt` ≤ `now`): chạy đúng giờ, chạy bù MỘT lần, hay ghi "bỏ lỡ".
 * - Trễ ≤ 5 phút → đúng giờ.
 * - Trễ hơn (máy tắt / ngủ / app đóng): mốc hẹn gần nhất đã qua còn trong hạn bù (12 giờ một lần, 6 giờ hằng ngày /
 *   tuần, theo giờ không bù) và lịch bật "Chạy bù" → chạy bù 1 lần; nhiều lượt lỡ gộp lại (`missed`).
 * - Không thì ghi bỏ lỡ. Lần hẹn tiếp theo luôn tính từ `now` (không chạy dồn).
 */
export function planDue(rec: Recurrence, dueAt: number, now: number, catchUp: boolean): DuePlan {
  const passed = [dueAt, ...occurrencesBetween(rec, dueAt, now)]
  const latest = passed[passed.length - 1]
  const next = nextOccurrence(rec, now)
  if (now - latest <= SCHEDULE_ON_TIME_MS)
    return { action: 'run', trigger: 'on_time', scheduledFor: latest, missed: passed.length - 1, next }
  if (catchUp && now - latest <= CATCH_UP_GRACE_MS[rec.kind])
    return { action: 'run', trigger: 'catch_up', scheduledFor: latest, missed: passed.length, next }
  return { action: 'miss', scheduledFor: latest, missed: passed.length, next }
}

/** Đầu ngày (giờ máy) chứa `t` — đếm giới hạn số lần chạy mỗi ngày. */
export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Đầu ngày hôm sau — hết hạn mức thì tạm dừng tới mốc này. */
export function startOfNextDay(t: number): number {
  const d = new Date(startOfDay(t))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}
