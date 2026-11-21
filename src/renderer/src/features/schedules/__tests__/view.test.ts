import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { NO_GRANTS, type Schedule, type ScheduleRun } from '@shared/schedules'
import type { Conversation } from '@shared/types'
import { buildSidebar } from '@renderer/features/chat/sidebarTree'
import { buildPalette } from '@renderer/features/chat/search/paletteResults'
import vi from '../i18n/vi.json'
import { emptyForm, formFromSchedule, formToInput, nextRunText, noticeText, recurrenceText, runText, scheduleState } from '../view'

let t: (k: string, o?: Record<string, unknown>) => string
beforeAll(async () => {
  const i = i18next.createInstance()
  await i.init({ lng: 'vi', resources: { vi: { schedules: vi } }, defaultNS: 'schedules', interpolation: { escapeValue: false } })
  t = (k, o) => i.t(k, o)
})

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()

const schedule = (patch: Partial<Schedule> = {}): Schedule => ({
  id: 's1',
  name: 'Sáng',
  prompt: 'Tóm tắt thư',
  recurrence: { kind: 'daily', time: '08:00' },
  projectId: null,
  grants: NO_GRANTS,
  model: 'default',
  catchUp: true,
  enabled: true,
  pausedReason: null,
  skipNext: false,
  nextRunAt: null,
  lastRunAt: null,
  lastStatus: null,
  consecutiveFailures: 0,
  origin: 'user',
  unseen: 0,
  pending: 0,
  createdAt: 0,
  updatedAt: 0,
  ...patch
})

describe('chữ hiển thị', () => {
  it('giờ hẹn', () => {
    expect(recurrenceText({ kind: 'daily', time: '08:00' }, t, 'vi')).toBe('Hằng ngày lúc 08:00')
    expect(recurrenceText({ kind: 'weekly', days: [1, 5], time: '17:00' }, t, 'vi')).toBe('T2, T6 lúc 17:00')
    expect(recurrenceText({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '07:00' }, t, 'vi')).toBe('Hằng ngày lúc 07:00')
    expect(recurrenceText({ kind: 'hourly', every: 3, from: 8, to: 24 }, t, 'vi')).toBe('Mỗi 3 giờ (08:00–00:00)')
    expect(recurrenceText({ kind: 'hourly', every: 1, from: 8, to: 22 }, t, 'vi')).toBe('Mỗi giờ (08:00–22:00)')
  })

  it('lần tới: hôm nay / ngày mai / ngày khác', () => {
    const now = at(2026, 11, 21, 7)
    expect(nextRunText(at(2026, 11, 21, 8), now, t, 'vi')).toBe('hôm nay 08:00')
    expect(nextRunText(at(2026, 11, 22, 8), now, t, 'vi')).toBe('ngày mai 08:00')
    expect(nextRunText(at(2026, 11, 25, 8), now, t, 'vi')).toMatch(/08:00$/)
    expect(nextRunText(null, now, t, 'vi')).toBeNull()
  })

  it('dòng nhật ký: trạng thái + chạy bù + bỏ lỡ + lý do', () => {
    const run = (p: Partial<ScheduleRun>): ScheduleRun => ({
      id: 'r',
      scheduleId: 's1',
      scheduledFor: 0,
      startedAt: 0,
      finishedAt: 0,
      status: 'done',
      trigger: 'on_time',
      reason: null,
      detail: null,
      missed: 0,
      conversationId: null,
      toolCount: 0,
      seenAt: null,
      ...p
    })
    expect(runText(run({ trigger: 'catch_up', missed: 3 }), t)).toBe('Xong · chạy bù · bỏ lỡ 3 lượt')
    expect(runText(run({ status: 'error', reason: 'folder_missing', detail: 'C:\\du-an' }), t)).toBe('Lỗi · Không tìm thấy thư mục C:\\du-an')
    expect(runText(run({ status: 'skipped', reason: 'daily_limit' }), t)).toBe('Bỏ qua · đã đủ số lần chạy hôm nay')
    expect(runText(run({ status: 'error', reason: 'error', detail: 'boom' }), t)).toBe('Lỗi · boom')
  })

  it('thông báo chỉ có tên lịch + trạng thái', () => {
    expect(noticeText({ kind: 'finished', text: '', inApp: true, name: 'Sáng', status: 'done' }, t)).toBe('Lịch hẹn "Sáng" đã chạy xong.')
    expect(noticeText({ kind: 'finished', text: '', inApp: true, name: 'Sáng', status: 'error', reason: 'folder_missing' }, t)).toContain('không tìm thấy thư mục')
    expect(noticeText({ kind: 'pausedAll', text: '', inApp: true, reason: 'hotkey' }, t)).toContain('dừng khẩn cấp')
  })

  it('trạng thái dòng lịch', () => {
    expect(scheduleState(schedule(), false)).toBe('on')
    expect(scheduleState(schedule(), true)).toBe('paused')
    expect(scheduleState(schedule({ enabled: false, pausedReason: 'failures' }), false)).toBe('failures')
    expect(scheduleState(schedule({ enabled: false }), false)).toBe('off')
    expect(scheduleState(schedule({ lastStatus: 'running' }), false)).toBe('running')
  })
})

describe('ô nhập ↔ dữ liệu lưu', () => {
  it('thiếu tên / lời nhắn / ngày → mã lỗi; theo giờ không bao giờ chạy bù', () => {
    const f = emptyForm(at(2026, 11, 21, 7))
    expect(formToInput(f)).toEqual({ error: 'name' })
    expect(formToInput({ ...f, name: 'A' })).toEqual({ error: 'prompt' })
    expect(formToInput({ ...f, name: 'A', prompt: 'B', kind: 'weekly', days: [] })).toEqual({ error: 'days' })
    expect(formToInput({ ...f, name: 'A', prompt: 'B', kind: 'hourly', from: 10, to: 9 })).toEqual({ error: 'window' })
    expect(formToInput({ ...f, name: ' A ', prompt: 'B', kind: 'hourly', every: 2 })).toMatchObject({
      name: 'A',
      recurrence: { kind: 'hourly', every: 2, from: 8, to: 22 },
      catchUp: false
    })
    expect(formToInput({ ...f, name: 'A', prompt: 'B', kind: 'once', onceAt: '2026-11-21T09:30' })).toMatchObject({ recurrence: { kind: 'once', at: at(2026, 11, 21, 9, 30) } })
  })

  it('sửa lịch: ô nhập lấy lại đúng giờ / quyền / model', () => {
    const s = schedule({ recurrence: { kind: 'weekly', days: [1, 3], time: '17:30' }, model: 'cheap', grants: { folder: 'C:\\a', gmailAccounts: ['x'], telegram: true, folderWrite: false, drafts: false } })
    const f = formFromSchedule(s, at(2026, 11, 21))
    expect(f).toMatchObject({ kind: 'weekly', days: [1, 3], time: '17:30', model: 'cheap', grants: s.grants })
    expect(formToInput(f)).toMatchObject({ recurrence: { kind: 'weekly', days: [1, 3], time: '17:30' }, grants: s.grants })
  })
})

describe('cuộc do lịch hẹn tạo', () => {
  const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
    id,
    title: id,
    mode: 'free',
    pinned: false,
    cwd: null,
    codeWrite: false,
    groupId: null,
    parentId: null,
    suggestedGroupId: null,
    projectId: null,
    scheduleId: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  })

  it('không hiện ở thanh bên (trừ khi người dùng ghim)', () => {
    const sections = buildSidebar([conv('a'), conv('lich', { scheduleId: 's1' }), conv('ghim', { scheduleId: 's1', pinned: true })], [])
    const ids = sections.flatMap((s) => s.rows.map((r) => r.conversation.id))
    expect(ids).toEqual(['ghim', 'a'])
  })

  it('Ctrl+K tab Lịch hẹn: lịch + cuộc do lịch tạo; tab Tất cả có lịch', () => {
    const conversations = [conv('a'), conv('lich', { scheduleId: 's1' })]
    const scheduled = buildPalette({ tab: 'scheduled', query: 'sáng', conversations: [conv('lich', { scheduleId: 's1', title: 'Sáng · 21/11' })], artifacts: [], schedules: [schedule()] })
    expect(scheduled[0].items.map((i) => i.kind)).toEqual(expect.arrayContaining(['schedule', 'conversation']))
    const all = buildPalette({ tab: 'all', query: 'sang', conversations, artifacts: [], schedules: [schedule()] })
    expect(all[0].items.some((i) => i.kind === 'schedule')).toBe(true)
  })
})
