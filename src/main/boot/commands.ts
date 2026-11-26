import { spawn as spawnProcess, type SpawnOptions } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import {
  appsSettingsSchema,
  commandsSettingsSchema,
  DEFAULT_APPS_SETTINGS,
  DEFAULT_COMMANDS_SETTINGS,
  type AppsSettings,
  type CommandsSettings
} from '@shared/commands'
import { DEFAULT_SCHEDULES_SETTINGS, schedulesSettingsSchema, type SchedulesSettings } from '@shared/schedules'
import { pruneLogs } from '../commands/apps/runner'
import { AppRunService } from '../commands/apps/service'
import { ExeVersions } from '../commands/apps/version'
import { findGit, probeGit, type GitInfo } from '../commands/gitEnv'
import { CommandService } from '../commands/service'
import { ScheduleProposals } from '../schedules/proposals'
import { ScheduleRepository } from '../schedules/repository'
import type { Approvals } from './approvals'
import type { Computer } from './computer'
import type { BootEnv, LateRefs } from './context'
import type { Core } from './core'

/** Đề xuất lịch hẹn (đồng hồ + cài đặt lịch dùng chung), chạy lệnh git, chạy Unity / Blender. */
export function createCommands(env: BootEnv, core: Core, approvalsPart: Approvals, computerPart: Computer, late: LateRefs) {
  const { log, userData } = env
  const { db, getOwner, conversations, projectRepo, settings, sync, actionLog, recordAction } = core
  const { approvalHub, flashForApproval, tools, autoEdits } = approvalsPart
  const { killSwitch } = computerPart

  // ---- Lịch hẹn (PR 7a): chỉ chạy khi app mở, lần chạy CHỈ ĐỌC, mặc định tắt. ----
  // Đồng hồ giả chỉ cho e2e ở bản chưa đóng gói (MMC_FAKE_CLOCK=1): test tua giờ qua IPC.
  const fakeClock = !app.isPackaged && process.env.MMC_FAKE_CLOCK === '1'
  let clockOffset = 0
  const now = (): number => Date.now() + clockOffset
  /** Chỉ test e2e (đồng hồ giả) gọi qua IPC schedules. */
  const advanceClock = (ms: number): void => {
    clockOffset += ms
  }
  const getSchedulesSettings = (): SchedulesSettings =>
    settings.get('schedules', schedulesSettingsSchema, DEFAULT_SCHEDULES_SETTINGS)
  const setSchedulesSettings = (value: SchedulesSettings): void => void settings.set('schedules', value)
  const scheduleRepo = new ScheduleRepository(db, getOwner)
  const scheduleProposals = new ScheduleProposals({
    enabled: () => getSchedulesSettings().enabled,
    projectOf: (conversationId) => {
      const id = conversations.get(conversationId)?.projectId
      const project = id ? projectRepo.get(id) : null
      return project ? { id: project.id, name: project.name } : null
    },
    create: (input) => {
      try {
        const r = late.scheduleService.save({ input, confirmed: true }, 'assistant')
        sync.changed('schedules')
        return r.status === 'saved' ? { ok: true } : { ok: false, error: 'confirm_required' }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    emit: (event) => {
      if ('closed' in event) return approvalHub.remove(event.id)
      const { conversationId, ...request } = event
      approvalHub.add({ id: request.id, conversationId, kind: 'schedule', request }, () => scheduleProposals.touch(request.id))
      flashForApproval()
    },
    log
  })
  scheduleProposals.registerTools(tools)
  app.on('before-quit', () => scheduleProposals.cancelAll())
  // ---- Chạy lệnh theo danh sách cho phép (A1: git chỉ đọc), mặc định tắt, duyệt từng lần, ghi nhật ký. ----
  try {
    const pruned = actionLog.prune()
    if (pruned) log.info(`Nhật ký thao tác: dọn ${pruned} mục quá 90 ngày`)
  } catch (err) {
    log.warn(`Dọn nhật ký thao tác lỗi: ${String(err)}`)
  }
  const getCommandsSettings = (): CommandsSettings => settings.get('commands', commandsSettingsSchema, DEFAULT_COMMANDS_SETTINGS)
  // git tìm theo đường dẫn tuyệt đối trong PATH (không bao giờ trong thư mục dự án), kiểm một lần lúc mở app.
  let gitInfo: GitInfo | null = null
  const gitReady = probeGit(findGit(process.env.PATH)).then((info) => {
    gitInfo = info
    log.info(`git cho chạy lệnh: ${'error' in info ? info.error : `${info.path} (${info.version})`}`)
    return info
  })
  const commandService = new CommandService({
    settings: getCommandsSettings,
    git: () => gitInfo,
    folderOf: (conversationId) => conversations.get(conversationId)?.cwd ?? null,
    emit: (event) => {
      if ('closed' in event) return approvalHub.remove(event.id)
      approvalHub.add({ id: event.id, conversationId: event.conversationId, kind: 'command', request: event }, () =>
        commandService.touch(event.id)
      )
      flashForApproval()
    },
    log: recordAction,
    killSwitch,
    logger: log
  })
  commandService.registerTools(tools)
  killSwitch.onStop(() => commandService.stopAll())
  app.on('before-quit', () => commandService.stopAll('App đang đóng.'))
  // ---- A2: chạy Unity / Blender (chương trình người dùng tự chọn), mặc định tắt, chỉ khi cuộc có quyền SỬA thư mục. ----
  const getAppsSettings = (): AppsSettings => settings.get('commandApps', appsSettingsSchema, DEFAULT_APPS_SETTINGS)
  const appRunLogsDir = join(userData, 'logs', 'runs')
  void pruneLogs(appRunLogsDir)
    .then((n) => n && log.info(`Log chạy Unity / Blender: dọn ${n} file quá 90 ngày`))
    .catch((err: unknown) => log.warn(`Dọn log chạy Unity / Blender lỗi: ${String(err)}`))
  const exeVersions = new ExeVersions()
  // Tiến trình giả chỉ cho e2e ở bản chưa đóng gói (không có Unity / Blender trên máy CI) — không bao giờ có trong bản phát hành.
  const fakeAppRunner = app.isPackaged ? undefined : process.env.MMC_FAKE_APP_RUNNER
  const appRuns = new AppRunService({
    settings: getAppsSettings,
    folderOf: (conversationId) => conversations.get(conversationId)?.cwd ?? null,
    canWrite: (conversationId) => !!conversations.get(conversationId)?.codeWrite,
    editedFiles: (conversationId, exts) => actionLog.editedFiles(conversationId, exts),
    versions: exeVersions,
    logsDir: appRunLogsDir,
    request: (req) => commandService.request(req),
    log: recordAction,
    runsChanged: () => sync.changed('commandRuns'),
    killSwitch,
    logger: log,
    ...(fakeAppRunner
      ? {
          spawn: (exe: string, argv: string[], options: SpawnOptions) =>
            spawnProcess(process.execPath, [fakeAppRunner, exe, ...argv], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
        }
      : {})
  })
  appRuns.registerTools(tools)
  killSwitch.onStop(() => appRuns.stopAll())
  killSwitch.onStop(() => void autoEdits.endAll('kill_switch'))
  app.on('before-quit', () => appRuns.stopAll())

  return {
    fakeClock,
    now,
    advanceClock,
    getSchedulesSettings,
    setSchedulesSettings,
    scheduleRepo,
    scheduleProposals,
    getCommandsSettings,
    gitReady,
    commandService,
    getAppsSettings,
    exeVersions,
    appRuns
  }
}

export type Commands = ReturnType<typeof createCommands>
