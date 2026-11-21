import { dialog, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { idSchema } from '@shared/schemas'
import {
  scheduleProposalDecisionSchema,
  scheduleRunsQuerySchema,
  scheduleSaveSchema,
  type SchedulesSettings
} from '@shared/schedules'
import type { ScheduleProposals } from '../schedules/proposals'
import type { Scheduler } from '../schedules/scheduler'
import { ScheduleError, type ScheduleService } from '../schedules/service'
import type { HandleFn, HandleOptions } from './register'

export type SchedulesIpcDeps = {
  handle: HandleFn
  service: ScheduleService
  scheduler: Scheduler
  proposals: ScheduleProposals
  getSettings(): SchedulesSettings
  setSettings(value: SchedulesSettings): void
  /** Đổi lựa chọn "ẩn xuống khay khi đóng" → tạo / gỡ biểu tượng khay. */
  trayChanged(): void
  getWindow(): BrowserWindow | null
  /** Chỉ e2e: hộp chọn thư mục giả. */
  fakeFolder?: () => string | null
  /** Chỉ e2e (đồng hồ giả): tua đồng hồ, giả máy thức dậy, nhấn phím dừng. */
  test?: { advance(ms: number): void; resume(): void; hotkey(): void }
}

const S = { changes: 'schedules' } as const
const SC: HandleOptions = { changes: ['schedules', 'conversations'] }

/** Lỗi biết trước → `{ status: 'error', error }` (giao diện hiện bằng i18n); lỗi khác ném ra như thường. */
function guard<T>(fn: () => T): T | { status: 'error'; error: string } {
  try {
    return fn()
  } catch (err) {
    if (err instanceof ScheduleError) return { status: 'error', error: err.code }
    throw err
  }
}

const featureSchema = z.object({
  enabled: z.boolean().optional(),
  /** Lần đầu bật: người dùng đã tick "Tôi hiểu". */
  acknowledged: z.literal(true).optional(),
  trayOnClose: z.boolean().optional()
})

export function registerSchedulesIpc(deps: SchedulesIpcDeps): void {
  const { handle, service, scheduler } = deps

  handle(IPC.schedulesList, z.undefined(), () => service.list())
  handle(IPC.schedulesStatus, z.undefined(), () => scheduler.status())
  handle(IPC.schedulesRuns, scheduleRunsQuerySchema, ({ scheduleId, limit }) => service.runs(scheduleId, limit))

  handle(IPC.schedulesSave, scheduleSaveSchema, (input) => guard(() => service.save(input)), S)
  handle(
    IPC.schedulesSetEnabled,
    z.object({ id: idSchema, enabled: z.boolean() }),
    ({ id, enabled }) => guard(() => ({ status: 'saved' as const, schedule: service.setEnabled(id, enabled) })),
    S
  )
  handle(
    IPC.schedulesSkipNext,
    z.object({ id: idSchema, skip: z.boolean() }),
    ({ id, skip }) => guard(() => ({ status: 'saved' as const, schedule: service.setSkipNext(id, skip) })),
    S
  )
  // Xoá lịch: cuộc trò chuyện đã tạo giữ lại (thành cuộc thường) → báo cả hai mục.
  handle(IPC.schedulesRemove, idSchema, (id) => service.remove(id), SC)
  handle(IPC.schedulesRunNow, idSchema, (id) => scheduler.runNow(id), SC)
  handle(IPC.schedulesStop, z.undefined(), () => scheduler.stopCurrent(), S)
  handle(IPC.schedulesMarkSeen, idSchema, (conversationId) => service.markSeen(conversationId), S)

  // Bật lần đầu phải kèm "Tôi hiểu" (hộp cảnh báo); tắt → dừng lần đang chạy, huỷ thẻ đề xuất lịch đang chờ.
  handle(
    IPC.schedulesSetFeature,
    featureSchema,
    (input) => {
      const current = deps.getSettings()
      if (input.enabled && !current.acknowledged && !input.acknowledged) throw new Error('acknowledge_required')
      const next: SchedulesSettings = {
        ...current,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.acknowledged ? { acknowledged: true } : {}),
        ...(input.trayOnClose !== undefined ? { trayOnClose: input.trayOnClose, trayAsked: true } : {})
      }
      deps.setSettings(next)
      if (input.enabled !== undefined && input.enabled !== current.enabled) {
        scheduler.setEnabled(input.enabled)
        if (!input.enabled) deps.proposals.cancelAll()
      }
      if (input.trayOnClose !== undefined || input.enabled !== undefined) deps.trayChanged()
      return scheduler.status()
    },
    S
  )
  handle(IPC.schedulesPauseAll, z.boolean(), (paused) => {
    scheduler.setPausedAll(paused)
    deps.trayChanged()
    return scheduler.status()
  }, S)

  // Renderer không tự gõ đường dẫn: main mở hộp chọn thư mục, trả về thư mục người dùng chọn.
  handle(IPC.schedulesPickFolder, z.undefined(), async () => {
    if (deps.fakeFolder) return deps.fakeFolder()
    const win = deps.getWindow()
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  handle(IPC.schedulesRespondProposal, scheduleProposalDecisionSchema, (decision) => deps.proposals.respond(decision), {
    changes: ['approvals', 'schedules']
  })

  if (deps.test) {
    const t = deps.test
    handle(IPC.schedulesTestAdvance, z.number().int().min(0).max(30 * 24 * 60 * 60 * 1000), (ms) => t.advance(ms), SC)
    handle(IPC.schedulesTestResume, z.undefined(), () => t.resume(), SC)
    handle(IPC.schedulesTestHotkey, z.undefined(), () => t.hotkey(), SC)
  }
}
