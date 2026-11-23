import { z } from 'zod'
import { IPC } from '@shared/ipc'
import {
  appChooseSchema,
  appToggleSchema,
  commandDecisionSchema,
  commandRunIdSchema,
  commandsSettingsSchema,
  type AppChooseResult,
  type AppProgram,
  type CommandsSettings,
  type CommandsStatus
} from '@shared/commands'
import type { AppRunService } from '../commands/apps/service'
import type { CommandService } from '../commands/service'
import type { HandleFn } from './register'

export type CommandsIpcDeps = {
  handle: HandleFn
  service: CommandService
  appRuns: AppRunService
  status(): Promise<CommandsStatus>
  setSettings(value: CommandsSettings): void
  /** Bật / tắt một phần mềm (đường dẫn giữ nguyên). */
  setAppEnabled(program: AppProgram, enabled: boolean): void
  /** Mở hộp chọn file chương trình (main tự mở — renderer không bao giờ gửi đường dẫn). */
  chooseApp(program: AppProgram): Promise<{ path: string } | { error: 'wrong_name'; expected: string } | { canceled: true }>
  openLog(path: string): Promise<void>
}

const conversationSchema = z.object({ conversationId: z.string().min(1).max(100) })

export function registerCommandsIpc(deps: CommandsIpcDeps): void {
  const { handle } = deps
  handle(IPC.commandsStatus, z.undefined(), () => deps.status())
  handle(
    IPC.commandsSetSettings,
    commandsSettingsSchema,
    async (s) => {
      deps.setSettings(s)
      // Tắt → từ chối thẻ đang chờ + dừng lệnh đang chạy.
      if (!s.gitEnabled) deps.service.stopAll('Người dùng đã tắt chạy lệnh git.')
      return deps.status()
    },
    { changes: 'commands' }
  )
  handle(
    IPC.commandsSetApp,
    appToggleSchema,
    async ({ program, enabled }) => {
      deps.setAppEnabled(program, enabled)
      if (!enabled) {
        // Tắt → từ chối thẻ đang chờ + dừng Unity / Blender đang chạy của riêng phần mềm đó.
        deps.service.cancelProgram(program, `Người dùng đã tắt chạy ${program === 'unity' ? 'Unity' : 'Blender'}.`)
        deps.appRuns.stopAll(program)
      }
      return deps.status()
    },
    { changes: 'commands' }
  )
  handle(
    IPC.commandsChooseApp,
    appChooseSchema,
    async ({ program }): Promise<AppChooseResult> => {
      const r = await deps.chooseApp(program)
      if ('path' in r) {
        // Đổi chương trình → thẻ đang chờ (hiện chương trình cũ) không còn đúng.
        deps.service.cancelProgram(program, 'Người dùng đã đổi chương trình trong Cài đặt.')
        return { status: await deps.status() }
      }
      return r
    },
    { changes: 'commands' }
  )
  handle(IPC.commandsRespond, commandDecisionSchema, (d) => deps.service.respond(d), { changes: 'approvals' })
  handle(IPC.commandsRuns, conversationSchema, ({ conversationId }) => deps.appRuns.list(conversationId))
  handle(IPC.commandsStopRun, commandRunIdSchema, ({ id }) => deps.appRuns.stop(id), { changes: 'commandRuns' })
  handle(IPC.commandsDismissRun, commandRunIdSchema, ({ id }) => deps.appRuns.dismiss(id), { changes: 'commandRuns' })
  handle(IPC.commandsOpenRunLog, commandRunIdSchema, async ({ id }) => {
    // Chỉ mở file log của một lần chạy app đã biết (không nhận đường dẫn từ renderer).
    const path = deps.appRuns.logPathOf(id)
    if (!path) return false
    await deps.openLog(path)
    return true
  })
}
