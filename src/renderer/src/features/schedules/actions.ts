import type { Schedule } from '@shared/schedules'
import { api } from '@renderer/lib/api'
import { optimistic } from '@renderer/lib/sync'
import { useSchedules } from './store'

/** Thao tác trên một lịch — dùng chung ở danh sách và đầu trang chi tiết. Đổi ngay trên giao diện (lạc quan). */
export function scheduleActions(id: string) {
  const store = useSchedules
  const patchLocal = (p: Partial<Schedule>): (() => void) => {
    const before = store.getState().schedules
    store.setState({ schedules: before.map((s) => (s.id === id ? { ...s, ...p } : s)) })
    return () => store.setState({ schedules: before })
  }
  return {
    runNow: async (): Promise<boolean> => {
      let undo = (): void => {}
      const r = await optimistic({
        topic: 'schedules',
        apply: () => (undo = patchLocal({ lastStatus: 'running' })),
        rollback: () => undo(),
        save: async () => ((await api.schedules.runNow(id)) ? true : { error: 'run_now_failed' })
      })
      return r !== null
    },
    skipNext: async (skip: boolean): Promise<void> => {
      let undo = (): void => {}
      await optimistic({
        topic: 'schedules',
        apply: () => (undo = patchLocal({ skipNext: skip })),
        rollback: () => undo(),
        save: async () => {
          const r = await api.schedules.skipNext(id, skip)
          return r.status === 'error' ? { error: r.error } : r
        }
      })
    },
    remove: async (): Promise<void> => {
      const before = store.getState().schedules
      await optimistic({
        topic: 'schedules',
        apply: () => store.setState({ schedules: before.filter((s) => s.id !== id) }),
        rollback: () => store.setState({ schedules: before }),
        save: () => api.schedules.remove(id)
      })
    }
  }
}

/** Nút "Dừng" lần đang chạy — ẩn băng "đang chạy" ngay, lỗi thì hiện lại. */
export async function stopRunning(): Promise<void> {
  const store = useSchedules
  const status = store.getState().status
  if (!status) return
  await optimistic({
    topic: 'schedules',
    apply: () => store.setState({ status: { ...status, running: null } }),
    rollback: () => store.setState({ status }),
    save: () => api.schedules.stop()
  })
}
