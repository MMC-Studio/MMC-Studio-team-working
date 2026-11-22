import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { commandDecisionSchema, commandsSettingsSchema, type CommandsSettings, type CommandsStatus } from '@shared/commands'
import type { CommandService } from '../commands/service'
import type { HandleFn } from './register'

export type CommandsIpcDeps = {
  handle: HandleFn
  service: CommandService
  status(): Promise<CommandsStatus>
  setSettings(value: CommandsSettings): void
}

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
  handle(IPC.commandsRespond, commandDecisionSchema, (d) => deps.service.respond(d), { changes: 'approvals' })
}
