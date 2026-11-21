import { create } from 'zustand'
import type { Schedule, SchedulesStatus } from '@shared/schedules'
import { api } from '@renderer/lib/api'
import { coalesce, onSync, optimistic } from '@renderer/lib/sync'

type SchedulesState = {
  schedules: Schedule[]
  status: SchedulesStatus | null
  loaded: boolean
  reload(): Promise<void>
  /** Bật / tắt một lịch — hiện ngay, lỗi (vd quá 10 lịch đang bật) thì hoàn tác + báo. */
  toggle(id: string, enabled: boolean, onError?: (code: string) => void): Promise<void>
  pauseAll(paused: boolean): Promise<void>
  /** Bật / tắt tính năng (đã tick "Tôi hiểu" từ trước) hoặc đổi "ẩn xuống khay khi đóng" — hiện ngay, lỗi thì hoàn tác. */
  setFeature(patch: { enabled?: boolean; trayOnClose?: boolean }): Promise<void>
}

/**
 * Lịch hẹn của tài khoản đang đăng nhập + trạng thái chung (đang chạy, số lần hôm nay, số chưa xem). Dùng chung cho
 * trang Lịch hẹn, số trên thanh bên, Cài đặt, trang dự án, Ctrl+K. Tự tải lại khi main báo `schedules`.
 */
export const useSchedules = create<SchedulesState>((set, get) => {
  const load = coalesce(async () => {
    const [schedules, status] = await Promise.all([api.schedules.list(), api.schedules.status()])
    set({ schedules, status, loaded: true })
  })
  return {
    schedules: [],
    status: null,
    loaded: false,
    reload: () => load(),
    async toggle(id, enabled, onError) {
      const before = get().schedules
      await optimistic({
        topic: 'schedules',
        apply: () => set({ schedules: before.map((s) => (s.id === id ? { ...s, enabled, pausedReason: null } : s)) }),
        rollback: () => set({ schedules: before }),
        save: async () => {
          const r = await api.schedules.setEnabled(id, enabled)
          return r.status === 'error' ? { error: r.error } : r
        },
        onError
      })
    },
    async setFeature(patch) {
      const status = get().status
      if (!status) return
      await optimistic({
        topic: 'schedules',
        apply: () => set({ status: { ...status, settings: { ...status.settings, ...patch } } }),
        rollback: () => set({ status }),
        save: () => api.schedules.setFeature(patch)
      })
    },
    async pauseAll(paused) {
      const status = get().status
      if (!status) return
      await optimistic({
        topic: 'schedules',
        apply: () => set({ status: { ...status, settings: { ...status.settings, pausedAll: paused }, running: paused ? null : status.running } }),
        rollback: () => set({ status }),
        save: () => api.schedules.pauseAll(paused)
      })
    }
  }
})

/** Nạp lúc mở app + mỗi khi có thay đổi (kể cả từ việc nền: lần chạy xong, thông báo…). */
export function setupSchedules(): () => void {
  void useSchedules.getState().reload()
  return onSync(['schedules', 'conversations'], () => void useSchedules.getState().reload())
}
