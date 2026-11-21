import { describe, expect, it } from 'vitest'
import { nextOccurrence, occurrencesBetween, planDue, startOfDay, startOfNextDay } from '../recurrence'

/** Giờ máy (local) — test không phụ thuộc múi giờ của máy chạy. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()
const H = 60 * 60 * 1000
const MIN = 60 * 1000

describe('nextOccurrence', () => {
  it('một lần: còn trong tương lai thì trả về, đã qua → null', () => {
    const t = at(2026, 11, 21, 9)
    expect(nextOccurrence({ kind: 'once', at: t }, t - 1)).toBe(t)
    expect(nextOccurrence({ kind: 'once', at: t }, t)).toBeNull()
  })

  it('hằng ngày: hôm nay nếu chưa tới giờ, không thì ngày mai', () => {
    const r = { kind: 'daily' as const, time: '08:30' }
    expect(nextOccurrence(r, at(2026, 11, 21, 7))).toBe(at(2026, 11, 21, 8, 30))
    expect(nextOccurrence(r, at(2026, 11, 21, 8, 30))).toBe(at(2026, 11, 22, 8, 30))
    // Cuối tháng → sang tháng sau.
    expect(nextOccurrence(r, at(2026, 11, 30, 9))).toBe(at(2026, 12, 1, 8, 30))
  })

  it('hằng tuần: ngày kế tiếp trong danh sách (0 = Chủ nhật)', () => {
    // 21/11/2026 là Thứ bảy.
    expect(new Date(at(2026, 11, 21)).getDay()).toBe(6)
    const r = { kind: 'weekly' as const, days: [1, 5], time: '17:00' }
    expect(nextOccurrence(r, at(2026, 11, 21, 10))).toBe(at(2026, 11, 23, 17)) // Thứ hai
    expect(nextOccurrence(r, at(2026, 11, 23, 17))).toBe(at(2026, 11, 27, 17)) // Thứ sáu
    // Chỉ Thứ bảy, đã qua giờ hôm nay → tuần sau.
    expect(nextOccurrence({ kind: 'weekly', days: [6], time: '09:00' }, at(2026, 11, 21, 10))).toBe(at(2026, 11, 28, 9))
  })

  it('theo giờ: chỉ trong khung giờ, cách đều từ giờ bắt đầu', () => {
    const r = { kind: 'hourly' as const, every: 3 as const, from: 8, to: 20 }
    expect(nextOccurrence(r, at(2026, 11, 21, 7, 59))).toBe(at(2026, 11, 21, 8))
    expect(nextOccurrence(r, at(2026, 11, 21, 8))).toBe(at(2026, 11, 21, 11))
    expect(nextOccurrence(r, at(2026, 11, 21, 17, 1))).toBe(at(2026, 11, 22, 8)) // 20h nằm ngoài khung
    expect(nextOccurrence({ kind: 'hourly', every: 1, from: 0, to: 24 }, at(2026, 11, 21, 23, 30))).toBe(at(2026, 11, 22, 0))
  })
})

describe('planDue', () => {
  const daily = { kind: 'daily' as const, time: '08:00' }

  it('trễ ≤ 5 phút → chạy đúng giờ, lần tới tính từ bây giờ', () => {
    const due = at(2026, 11, 21, 8)
    const plan = planDue(daily, due, due + 3 * MIN, true)
    expect(plan).toEqual({ action: 'run', trigger: 'on_time', scheduledFor: due, missed: 0, next: at(2026, 11, 22, 8) })
  })

  it('máy tắt 3 giờ: hằng ngày còn trong hạn bù 6 giờ → chạy bù một lần', () => {
    const due = at(2026, 11, 21, 8)
    expect(planDue(daily, due, due + 3 * H, true)).toMatchObject({ action: 'run', trigger: 'catch_up', missed: 1 })
    // Tắt "Chạy bù" → bỏ lỡ.
    expect(planDue(daily, due, due + 3 * H, false)).toMatchObject({ action: 'miss', missed: 1 })
    // Quá 6 giờ → bỏ lỡ.
    expect(planDue(daily, due, due + 7 * H, true)).toMatchObject({ action: 'miss', missed: 1 })
  })

  it('lỡ nhiều ngày: gộp lại, chỉ bù MỘT lần cho mốc gần nhất', () => {
    const due = at(2026, 11, 18, 8)
    const now = at(2026, 11, 21, 10) // 2 giờ sau mốc hôm nay
    const plan = planDue(daily, due, now, true)
    expect(plan).toMatchObject({ action: 'run', trigger: 'catch_up', scheduledFor: at(2026, 11, 21, 8), missed: 4 })
    expect(plan.next).toBe(at(2026, 11, 22, 8))
  })

  it('một lần: bù trong 12 giờ; theo giờ: không bao giờ bù', () => {
    const t = at(2026, 11, 21, 8)
    expect(planDue({ kind: 'once', at: t }, t, t + 11 * H, true)).toMatchObject({ action: 'run', trigger: 'catch_up', next: null })
    expect(planDue({ kind: 'once', at: t }, t, t + 13 * H, true)).toMatchObject({ action: 'miss', next: null })
    const hourly = { kind: 'hourly' as const, every: 1 as const, from: 0, to: 24 }
    expect(planDue(hourly, t, t + 30 * MIN, true)).toMatchObject({ action: 'miss', missed: 1 })
    // Lỡ 2 mốc nhưng mốc mới nhất vừa tới → chạy mốc đó, ghi 2 mốc bị lỡ.
    expect(planDue(hourly, t, t + 2 * H + MIN, true)).toMatchObject({ action: 'run', trigger: 'on_time', scheduledFor: t + 2 * H, missed: 2 })
  })
})

describe('tiện ích', () => {
  it('occurrencesBetween có giới hạn số lần', () => {
    const hourly = { kind: 'hourly' as const, every: 1 as const, from: 0, to: 24 }
    expect(occurrencesBetween(hourly, at(2026, 11, 21), at(2026, 11, 22), 5)).toHaveLength(5)
  })
  it('đầu ngày / đầu ngày hôm sau theo giờ máy', () => {
    expect(startOfDay(at(2026, 11, 21, 15, 20))).toBe(at(2026, 11, 21))
    expect(startOfNextDay(at(2026, 11, 30, 23))).toBe(at(2026, 12, 1))
  })
})
