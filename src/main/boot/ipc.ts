import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, dialog, Notification, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { APP_NAME } from '@shared/appConfig'
import { parseArtifactBlocks } from '@shared/artifacts'
import { APP_EXE_NAMES, type AppProgram, type AppStatus } from '@shared/commands'
import { stripExpressTags } from '@shared/expressive'
import { IPC } from '@shared/ipc'
import { DEFAULT_UPDATE_SETTINGS, updateSettingsSchema, type UpdateSettings, idSchema } from '@shared/schemas'
import { completeText } from '../ai/AIProvider'
import { loadSkill } from '../ai/skills'
import { agentHttpServer } from '../agents/httpServer'
import { AgentHub, agentSettingsSchema, DEFAULT_AGENT_SETTINGS, storedClientSchema } from '../agents/hub'
import { agentPrompt, agentSystemPrompt } from '../agents/prompt'
import { AgentExchangeRepository, LOCAL_OWNER } from '../db/repositories'
import { TimeRepository } from '../db/timeRepository'
import { registerActionLogIpc } from '../ipc/actionLog'
import { registerAgentsIpc } from '../ipc/agents'
import { registerAppIpc } from '../ipc/app'
import { registerArtifactsIpc } from '../ipc/artifacts'
import { registerCommandsIpc } from '../ipc/commands'
import { registerComputerIpc } from '../ipc/computer'
import { registerConnectorsIpc } from '../ipc/connectors'
import { registerExpressiveIpc } from '../ipc/expressive'
import { registerPluginStoreIpc } from '../ipc/pluginStore'
import { registerPrivacyIpc } from '../ipc/privacy'
import { registerProjectsIpc } from '../ipc/projects'
import { createHandle, registerIpc } from '../ipc/register'
import { registerSchedulesIpc } from '../ipc/schedules'
import { registerSkillsIpc } from '../ipc/skills'
import { registerTeamIpc } from '../ipc/team'
import { registerVoiceIpc } from '../ipc/voice'
import { registerWorkIpc } from '../ipc/work'
import { cancelEverywhere, PrivacyService } from '../privacy/service'
import { AttachmentStore } from '../services/attachments'
import { electronClipboard, fakeClipboard } from '../services/electronClipboard'
import { electronImages } from '../services/electronImages'
import { OAuthLoopback } from '../services/oauthLoopback'
import { SavedAccountStore } from '../services/savedAccounts'
import { createElectronUpdater } from '../services/updater'
import { learnStyle } from '../skills/style'
import { UpdateController } from '../update/controller'
import type { Chat, ChatDeps } from './chat'
import { devOverride, resourcePath, type BootEnv, type LateRefs } from './context'
import type { Schedules } from './schedules'

export interface IpcDeps extends ChatDeps {
  chat: Chat
  schedules: Schedules
}

/** createHandle + mọi lệnh gọi register…Ipc; cùng các dịch vụ chỉ IPC dùng (cập nhật, agent, quyền & riêng tư). */
export function createIpc(env: BootEnv, deps: IpcDeps, late: LateRefs) {
  const { log, userData, workspaceDir, getWindow } = env
  const {
    db,
    conversations,
    conversationGroups,
    projectRepo,
    projects,
    messages,
    memories,
    suggestions,
    settings,
    sync,
    actionLog,
    accountScope,
    secrets
  } = deps.core
  const { mcpStore, mcpApprovals, mcpReviews, approvalHub, autoEdits, approvals, extraFolders, folderAccess } = deps.approvals
  const { actionsDir, sidecarInstaller, sidecarClient, killSwitch, computer } = deps.computer
  const { draftApprovals, gmail, telegram } = deps.connectors
  const { giphyUserKey, expressive, voiceInstaller, voiceClient, voice } = deps.media
  const { artifacts, artifactThemes, fakeChat, getProvider, skillsDir, skillStore, pluginStore, memory } = deps.content
  const {
    fakeClock,
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
  } = deps.commands
  const { chat } = deps.chat
  const { scheduler, scheduleService, deferred, syncTray } = deps.schedules

  const handle = createHandle(
    (event: IpcMainInvokeEvent) => event.sender === getWindow()?.webContents,
    log,
    sync
  )
  registerIpc({
    conversations,
    revalidateExtraDirs: (id) => extraFolders.revalidate(id),
    groups: conversationGroups,
    messages,
    memories,
    suggestions,
    settings,
    account: accountScope,
    chat,
    resolveMedia: (ref) => expressive.resolve(ref),
    fakeCli: !!fakeChat,
    hasRecording: (id) => voice.hasRecording(id),
    memory,
    attachments: new AttachmentStore(join(workspaceDir, 'attachments'), electronImages),
    // Clipboard giả chỉ cho test e2e ở bản chưa đóng gói — không bao giờ có trong bản phát hành.
    clipboard:
      !app.isPackaged && process.env.MMC_FAKE_CLIPBOARD_DIR
        ? fakeClipboard(process.env.MMC_FAKE_CLIPBOARD_DIR)
        : electronClipboard,
    secrets,
    log,
    getWindow,
    handle
  })
  const oauth = new OAuthLoopback()
  app.on('before-quit', () => oauth.cancel())
  registerTeamIpc({
    handle,
    oauth,
    accounts: new SavedAccountStore(join(userData, 'secrets'), safeStorage),
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    getWindow,
    getProvider,
    loadSkill: (name) => loadSkill(skillsDir, name),
    workspaceDir,
    log
  })
  const getUpdateSettings = (): UpdateSettings =>
    settings.get('update', updateSettingsSchema, DEFAULT_UPDATE_SETTINGS)
  const updates = new UpdateController({
    updater: createElectronUpdater({
      isPackaged: app.isPackaged,
      // Chỉ bản chưa đóng gói (dev/e2e) mới đọc cấu hình cập nhật từ biến môi trường.
      devConfigPath: app.isPackaged ? undefined : process.env.MMC_UPDATE_CONFIG,
      log
    }),
    getSettings: getUpdateSettings,
    getSkipped: () => settings.get('updateSkipped', z.string().nullable(), null),
    setSkipped: (version) => settings.set('updateSkipped', version),
    emit: (state) => getWindow()?.webContents.send(IPC.updateState, state),
    beforeInstall: async () => {
      if (!(await chat.stopAll(5_000)))
        log.warn('Vẫn còn lượt chat chưa dừng hẳn khi cài bản cập nhật')
    },
    log
  })
  app.on('before-quit', () => updates.stop())
  registerAppIpc({
    handle,
    log,
    updates,
    settings,
    getUpdateSettings,
    getProvider,
    loadSkill: (name) => loadSkill(skillsDir, name),
    workspaceDir
  })
  handle(IPC.accountSet, idSchema.nullable(), (uid) => {
    // Phiên chat đang chạy thuộc tài khoản cũ → dừng trước khi đổi phạm vi dữ liệu.
    if ((uid ?? LOCAL_OWNER) !== accountScope.current) chat.abortAll()
    const result = accountScope.set(uid)
    if (result.claimed) log.info('Đã giao trí nhớ tạo trước khi đăng nhập cho tài khoản đầu tiên')
    memory.emitCount()
    // Lịch hẹn chỉ chạy cho tài khoản đang đăng nhập — và chỉ sau khi biết tài khoản là ai.
    scheduler.setAccount(result.owner)
    return result
  })
  const agentExchanges = new AgentExchangeRepository(db)
  agentExchanges.onChange = () => sync.changed('agentExchanges')
  const stale = agentExchanges.markInterrupted()
  if (stale) log.info(`Kết nối agent: đánh dấu ${stale} việc bị gián đoạn`)
  const agentHub = new AgentHub({
    getSettings: () => settings.get('agents', agentSettingsSchema, DEFAULT_AGENT_SETTINGS),
    setSettings: (value) => settings.set('agents', value),
    getClients: () => settings.get('agentClients', z.array(storedClientSchema), []),
    setClients: (list) => settings.set('agentClients', list),
    exchanges: agentExchanges,
    killSwitch,
    serverFactory: (hub) => agentHttpServer(hub, () => accountScope.getAssistant().name, log),
    // Trả lời agent khác: KHÔNG tool, KHÔNG trí nhớ/hồ sơ người dùng, không lưu session CLI.
    answer: async ({ agentName, request, kind, title }, signal) => {
      // Chỉ bản chưa đóng gói + MMC_FAKE_AGENT_ANSWER (test e2e): không gọi Claude thật.
      if (!app.isPackaged && process.env.MMC_FAKE_AGENT_ANSWER)
        return `Mizuki (giả lập) đã nhận: ${request.slice(0, 200)}`
      const result = await completeText(
        getProvider(),
        {
          prompt: agentPrompt(agentName, request, kind, title),
          systemPrompt: agentSystemPrompt(accountScope.getAssistant().name),
          mode: 'free',
          cwd: workspaceDir,
          ephemeral: true
        },
        signal
      )
      if ('error' in result) throw new Error(result.error)
      // Agent khác chỉ nhận chữ thường: không bao giờ có thẻ biểu cảm.
      return stripExpressTags(parseArtifactBlocks(result.text).text)
    },
    emitStatus: (status) => getWindow()?.webContents.send(IPC.agentsStatusEvent, status),
    emitNotice: (notice) => {
      getWindow()?.webContents.send(IPC.agentsNoticeEvent, notice)
      if (notice.kind === 'stopped' && Notification.isSupported()) {
        new Notification({ title: APP_NAME, body: 'Đã ngắt mọi kết nối agent.' }).show()
      }
    },
    log
  })
  app.on('before-quit', () => {
    mcpApprovals.cancelAll()
    void agentHub.shutdown()
  })
  registerAgentsIpc({
    handle,
    hub: agentHub,
    mcp: mcpStore,
    mcpApprovals,
    mcpReviews,
    bridge: {
      exe: process.execPath,
      script: resourcePath('mizuki-mcp-bridge.cjs', 'resources/mizuki-mcp-bridge.cjs')
    }
  })
  registerProjectsIpc({
    handle,
    repo: projectRepo,
    service: projects,
    getWindow,
    // e2e: MMC_FAKE_PROJECT_FILES="đường dẫn 1|đường dẫn 2" thay hộp thoại chọn file.
    fakePick: devOverride('MMC_FAKE_PROJECT_FILES') ? () => devOverride('MMC_FAKE_PROJECT_FILES')!.split('|') : undefined
  })
  registerSkillsIpc({
    handle,
    store: skillStore,
    userDir: join(app.getPath('userData'), 'skills'),
    getWindow,
    learnStyle: () =>
      learnStyle({
        conversations,
        messages,
        getProvider,
        loadSkill: (name) => loadSkill(skillsDir, name),
        existingNotes: () => skillStore.styleNotes(),
        workspaceDir,
        log
      }),
    // Chọn gói skill không qua hộp thoại — chỉ cho e2e ở bản chưa đóng gói.
    // MMC_FAKE_SKILL_PICK = file chứa đường dẫn gói (test ghi lại trước mỗi lần chọn).
    fakePick:
      !app.isPackaged && process.env.MMC_FAKE_SKILL_PICK
        ? () => readFileSync(process.env.MMC_FAKE_SKILL_PICK!, 'utf8').trim()
        : undefined
  })
  registerExpressiveIpc({ handle, expressive, giphyKey: giphyUserKey })
  registerPluginStoreIpc({ handle, service: pluginStore })
  registerArtifactsIpc({ handle, service: artifacts, themes: artifactThemes, getWindow, log, templatesDir: join(skillsDir, 'artifacts', 'templates') })
  registerVoiceIpc({
    handle,
    voice,
    installer: voiceInstaller,
    // Đang đọc → Ctrl+Alt+Q dừng đọc (dùng chung phím dừng khẩn cấp; app khác giữ phím thì vẫn có Esc).
    setSpeaking: (on) => (on ? killSwitch.arm('voice') : killSwitch.disarm('voice'))
  })
  registerComputerIpc({
    handle,
    computer,
    logsDir: actionsDir,
    sidecar: sidecarInstaller,
    stopSidecar: () => {
      sidecarClient.stop()
      voiceClient.stop()
    }
  })
  registerConnectorsIpc({ handle, gmail, telegram, approvals: draftApprovals, hub: approvalHub })
  registerActionLogIpc({ handle, repo: actionLog })
  registerCommandsIpc({
    handle,
    service: commandService,
    appRuns,
    status: async () => {
      const apps = getAppsSettings()
      const appStatus = async (program: AppProgram): Promise<AppStatus> => {
        const s = apps[program]
        if (!s.path) return { ...s, version: null, missing: false }
        const missing = !existsSync(s.path)
        const version = missing ? null : program === 'unity' ? await exeVersions.unity(s.path) : await exeVersions.blender(s.path)
        return { ...s, version, missing }
      }
      return {
        settings: getCommandsSettings(),
        git: await gitReady,
        apps: { unity: await appStatus('unity'), blender: await appStatus('blender') }
      }
    },
    setSettings: (value) => void settings.set('commands', value),
    setAppEnabled: (program, enabled) => {
      const apps = getAppsSettings()
      // Chưa chọn chương trình thì không bật được.
      settings.set('commandApps', { ...apps, [program]: { ...apps[program], enabled: enabled && !!apps[program].path } })
    },
    chooseApp: async (program) => {
      const expected = APP_EXE_NAMES[program]
      // Hộp chọn file giả chỉ cho e2e ở bản chưa đóng gói — không bao giờ có trong bản phát hành.
      const fake = app.isPackaged ? undefined : process.env[program === 'unity' ? 'MMC_FAKE_UNITY_EXE' : 'MMC_FAKE_BLENDER_EXE']
      let path: string | null
      if (fake !== undefined) path = fake || null
      else {
        const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: expected, extensions: ['exe'] }] }
        const mainWindow = getWindow()
        const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
        path = picked.canceled ? null : (picked.filePaths[0] ?? null)
      }
      if (!path) return { canceled: true }
      if (basename(path).toLowerCase() !== expected.toLowerCase()) return { error: 'wrong_name', expected }
      const apps = getAppsSettings()
      settings.set('commandApps', { ...apps, [program]: { enabled: apps[program].enabled, path } })
      return { path }
    },
    openLog: async (path) => {
      const err = await shell.openPath(path)
      if (err) log.warn(`Mở log lỗi: ${err}`)
    }
  })
  // ---- Quyền & riêng tư (B2): quyền đang cấp + thu hồi. ----
  /** Thu hồi mọi thứ đang chờ / đang chạy của một cuộc (dùng chung cho "Gỡ thư mục" và trang Quyền & riêng tư). */
  const cancelConversationAccess = (conversationId: string): void =>
    cancelEverywhere([approvals, mcpApprovals, draftApprovals, folderAccess, scheduleProposals, commandService, appRuns], conversationId, (m) =>
      log.warn(m)
    )
  late.cancelConversationAccess = cancelConversationAccess
  const privacy = new PrivacyService({
    foldersInUse: () => conversations.withFolder(),
    getConversation: (id) => conversations.get(id),
    clearFolder: (id) => {
      void autoEdits.end(id, 'folder')
      // setCwd(null) gỡ luôn mọi thư mục phụ (D).
      conversations.setCwd(id, null)
    },
    removeExtraFolder: (id, path) => void extraFolders.remove(id, path),
    cancelConversation: cancelConversationAccess,
    abortTurn: (id) => chat.abortConversation(id),
    schedules: () => scheduleRepo.list(),
    getSchedule: (id) => scheduleRepo.get(id),
    setScheduleGrants: (id, grants) => void scheduleRepo.setGrants(id, grants),
    stopSchedule: (id) => scheduler.forget(id, true),
    revokeDeferred: (id, scope) => deferred.revokeForSchedule(id, scope),
    gmailLabel: (id) => {
      const a = gmail.status().accounts.find((x) => x.id === id)
      return a ? (a.label ? `${a.label} (${a.email})` : a.email) : null
    },
    status: () => {
      const g = gmail.status()
      const tg = telegram.status()
      const agents = agentHub.status()
      return {
        git: { enabled: getCommandsSettings().gitEnabled },
        apps: { unity: { enabled: getAppsSettings().unity.enabled }, blender: { enabled: getAppsSettings().blender.enabled } },
        gmail: { enabled: g.enabled, accounts: g.accounts.filter((a) => a.enabled).map((a) => ({ email: a.email, label: a.label })) },
        telegram: { enabled: tg.enabled, account: tg.connection === 'connected' && tg.account ? tg.account.name : null },
        agents: { enabled: agents.enabled, clients: agents.clients.filter((c) => c.approved).map((c) => c.name) },
        mcp: mcpStore.list().map((s) => ({ name: s.name, enabled: s.enabled, alwaysAllow: s.alwaysAllow }))
      }
    },
    log
  })
  registerPrivacyIpc({ handle, service: privacy })
  const fakeFolder = app.isPackaged ? undefined : process.env.MMC_FAKE_FOLDER
  registerSchedulesIpc({
    handle,
    service: scheduleService,
    scheduler,
    proposals: scheduleProposals,
    deferred,
    getSettings: getSchedulesSettings,
    setSettings: setSchedulesSettings,
    trayChanged: syncTray,
    getWindow,
    // Hộp chọn thư mục giả chỉ cho e2e ở bản chưa đóng gói (dùng chung biến với quyền thư mục).
    fakeFolder: fakeFolder !== undefined ? () => fakeFolder || null : undefined,
    test: fakeClock
      ? {
          advance: (ms) => {
            advanceClock(ms)
            scheduler.tick()
          },
          // Máy ngủ `ms` rồi thức dậy: đồng hồ nhảy trước, bộ hẹn giờ chỉ biết khi có sự kiện resume.
          sleep: (ms) => {
            advanceClock(ms)
            scheduler.resume()
          },
          hotkey: () => killSwitch.trigger()
        }
      : undefined
  })
  registerWorkIpc({
    handle,
    conversations,
    settings,
    time: new TimeRepository(db),
    approvals,
    revokeFolder: (id) => void privacy.revokeFolder(id),
    writeRevoked: (id) => {
      for (const p of ['unity', 'blender'] as const) commandService.cancelProgram(p, 'Người dùng đã bỏ quyền sửa thư mục.', id)
      appRuns.cancelConversation(id)
    },
    folderAccess,
    autoEdits,
    extraFolders,
    abortTurn: (id) => chat.abortConversation(id),
    hub: approvalHub,
    memory,
    getProvider,
    loadSkill: (name) => loadSkill(skillsDir, name),
    workspaceDir,
    getWindow,
    log
  })

  return { updates, agentHub }
}
