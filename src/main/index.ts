import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  Notification,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from 'electron'
import { is } from '@electron-toolkit/utils'
import { z } from 'zod'
import { APP_NAME, LEGACY_USER_DATA_DIR, OAUTH_REDIRECT_URL } from '@shared/appConfig'
import {
  DEFAULT_GMAIL_SETTINGS,
  DEFAULT_TELEGRAM_SETTINGS,
  gmailSettingsSchema,
  telegramSettingsSchema,
  type GmailSettings,
  type TelegramSettings
} from '@shared/connectors'
import { IPC } from '@shared/ipc'
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  updateSettingsSchema,
  type UpdateSettings,
  aiSettingsSchema,
  computerUseSettingsSchema,
  DEFAULT_COMPUTER_USE_SETTINGS,
  idSchema,
  type AiProviderId,
  chatOrganizeSettingsSchema,
  DEFAULT_CHAT_ORGANIZE_SETTINGS
} from '@shared/schemas'
import type { AIProvider } from './ai/AIProvider'
import { AnthropicApiProvider } from './ai/AnthropicApiProvider'
import { ClaudeCliProvider } from './ai/ClaudeCliProvider'
import { loadModeSkill, loadSkill } from './ai/skills'
import { backupBeforeUpgrade } from './db/backup'
import { openDatabase } from './db/client'
import {
  AgentExchangeRepository,
  LOCAL_OWNER,
  ConversationGroupRepository,
  ConversationRepository,
  MemoryRepository,
  MessageRepository,
  SettingsRepository,
  SuggestionRepository
} from './db/repositories'
import { CodeApprovals } from './code/approvals'
import { ConversationOrganizer } from './chat/organizer'
import { completeText } from './ai/AIProvider'
import { agentHttpServer } from './agents/httpServer'
import {
  AgentHub,
  agentSettingsSchema,
  DEFAULT_AGENT_SETTINGS,
  storedClientSchema
} from './agents/hub'
import { agentPrompt, agentSystemPrompt } from './agents/prompt'
import { KillSwitch } from './computer/killSwitch'
import { registerAgentsIpc } from './ipc/agents'
import { McpApprovals } from './mcpClient/approvals'
import { McpProxy } from './mcpClient/proxy'
import { probeAuth } from './mcpClient/review'
import { McpReviews } from './mcpClient/reviews'
import { McpServerStore } from './mcpClient/store'
import { ActionLog } from './computer/actionLog'
import { electronCapture, fakeCapture } from './computer/electronCapture'
import { ComputerUseService } from './computer/service'
import { pythonCommand, SidecarClient } from './sidecar/client'
import { SidecarInstaller } from './sidecar/installer'
import { extractZip, runProcess } from './sidecar/process'
import { registerComputerIpc } from './ipc/computer'
import { ToolBridge } from './tools/bridge'
import { AppToolRegistry, combineToolSets } from './tools/registry'
import { TimeRepository } from './db/timeRepository'
import { registerAppIpc } from './ipc/app'
import { createHandle, registerIpc } from './ipc/register'
import { StateSync } from './services/stateSync'
import { createElectronUpdater } from './services/updater'
import { UpdateController } from './update/controller'
import { registerTeamIpc } from './ipc/team'
import { registerWorkIpc } from './ipc/work'
import { ApprovalHub } from './approvals/hub'
import { explainPrompt, explainSystemPrompt } from './approvals/explain'
import { OAuthLoopback } from './services/oauthLoopback'
import { RateLimiter } from './agents/rateLimiter'
import { DraftApprovals } from './connectors/approvals'
import { FolderAccessRequests } from './code/folderAccess'
import { FakeGmailBackend } from './connectors/gmail/fake'
import { gmailTokenFileName, GoogleGmailBackend } from './connectors/gmail/google'
import { GmailService } from './connectors/gmail/service'
import { FakeTelegramBackend } from './connectors/telegram/fake'
import { GramJsBackend } from './connectors/telegram/gramjs'
import { TelegramService } from './connectors/telegram/service'
import { registerConnectorsIpc } from './ipc/connectors'
import { AccountScope } from './memory/accountScope'
import { MemoryService } from './memory/memoryService'
import { AttachmentStore } from './services/attachments'
import { electronClipboard, fakeClipboard } from './services/electronClipboard'
import { electronImages } from './services/electronImages'
import { ChatService } from './services/chatService'
import { createLogger } from './services/logger'
import { SavedAccountStore } from './services/savedAccounts'
import { SecretStore } from './services/secrets'
import { FakeChatProvider } from './ai/FakeChatProvider'
import { ARTIFACT_SCHEME, handleArtifactRequest } from './artifacts/protocol'
import { ArtifactService } from './artifacts/service'
import { registerArtifactsIpc } from './ipc/artifacts'
import { BUILTIN_THEMES, parseArtifactBlocks, themeSchema, type Theme } from '@shared/artifacts'
import { registerVoiceIpc } from './ipc/voice'
import { VoiceInstaller } from './voice/installer'
import { VoiceService, voiceSkillPrompt } from './voice/service'
import { DEFAULT_VOICE_SETTINGS, STT_MODELS, voiceSettingsSchema } from '@shared/voice'
import { affinityStatsSchema } from './expressive/affinity'
import { GiphyClient, readEnvKey } from './expressive/giphy'
import { ExpressiveService } from './expressive/service'
import { StickerLibrary } from './expressive/stickers'
import { registerExpressiveIpc } from './ipc/expressive'
import { registerSkillsIpc } from './ipc/skills'
import { registerProjectsIpc } from './ipc/projects'
import { ProjectRepository } from './projects/repository'
import { ProjectService } from './projects/service'
import { SkillStore } from './skills/store'
import { learnStyle } from './skills/style'
import { DEFAULT_SKILLS_SETTINGS, skillsSettingsSchema } from '@shared/skills'
import { DEFAULT_SCHEDULES_SETTINGS, schedulesSettingsSchema, type SchedulesSettings } from '@shared/schedules'
import { registerSchedulesIpc } from './ipc/schedules'
import { registerCommandsIpc } from './ipc/commands'
import { CommandService } from './commands/service'
import { findGit, probeGit, type GitInfo } from './commands/gitEnv'
import { ActionLogRepository } from './audit/actionLog'
import { commandsSettingsSchema, DEFAULT_COMMANDS_SETTINGS, type CommandsSettings } from '@shared/commands'
import { registerPluginStoreIpc } from './ipc/pluginStore'
import { GitHubClient } from './pluginStore/github'
import { installedSchema, loadDefaultSources, PluginStoreService, userSourcesSchema } from './pluginStore/service'
import { ScheduleProposals } from './schedules/proposals'
import { ScheduleRepository } from './schedules/repository'
import { startScheduledRun } from './schedules/runner'
import { Scheduler, type ScheduleNotice } from './schedules/scheduler'
import { ScheduleService } from './schedules/service'
import { scheduleNoticeText } from './schedules/notice'
import { DeferredService, deferredExplainPrompt } from './schedules/deferred'
import { AppTray, closeAction, trayIconBitmap } from './tray'
import {
  DEFAULT_EXPRESSIVE_SETTINGS,
  expressiveSettingsSchema,
  mediaRefSchema,
  EMPTY_RECENT,
  recentStoreSchema,
  stripExpressTags
} from '@shared/expressive'

// Phải chạy trước mọi thứ dùng userData (single-instance lock, log, safeStorage, DB). Không module nào
// được đọc app.getPath('userData') lúc import, vì import chạy trước dòng này.
// Test e2e dùng thư mục dữ liệu riêng để không đụng dữ liệu thật của người dùng; còn lại giữ thư mục
// cũ sau khi đổi productName (mặc định Electron sẽ chuyển sang %APPDATA%/<productName>).
// Artifact chạy ở origin riêng (mmc-artifact://) — tách khỏi app, iframe sandbox không same-origin.
protocol.registerSchemesAsPrivileged([{ scheme: 'mmc-artifact', privileges: { standard: true, secure: true } }])

app.setPath(
  'userData',
  process.env.TEAM_WORKING_USER_DATA || join(app.getPath('appData'), LEGACY_USER_DATA_DIR)
)

// Micro giả (tiếng bíp) cho test e2e giọng nói — chỉ bản chưa đóng gói.
if (!app.isPackaged && process.env.MMC_FAKE_VOICE === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

/** Tài nguyên đóng gói (extraResources) khi đã build, thư mục nguồn khi dev. */
function resourcePath(packaged: string, dev: string): string {
  return app.isPackaged ? join(process.resourcesPath, packaged) : join(app.getAppPath(), dev)
}

const log = createLogger(join(app.getPath('userData'), 'logs'))
let mainWindow: BrowserWindow | null = null
/** Đang thoát thật (menu khay "Thoát", cài bản cập nhật, Windows tắt máy…) — đóng cửa sổ không ẩn xuống khay nữa. */
let quitting = false
app.on('before-quit', () => {
  quitting = true
})
/** Bấm X: ẩn xuống khay / hỏi / thoát — gán trong bootstrap (cần cài đặt lịch hẹn). */
let onWindowClose: ((event: Electron.Event, win: BrowserWindow) => void) | null = null

process.on('uncaughtException', (err) =>
  log.error(`uncaughtException: ${err.stack ?? err.message}`)
)
process.on('unhandledRejection', (reason) => log.error(`unhandledRejection: ${String(reason)}`))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Tự đọc câu trả lời (giọng nói) không cần bấm chuột trước.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('close', (event) => {
    if (!quitting) onWindowClose?.(event, win)
  })

  // Link ngoài mở bằng trình duyệt; không cho mở cửa sổ mới hay điều hướng khỏi app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  const workspaceDir = join(userData, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })

  const dbFile = join(userData, 'team-working.db')
  // Lần đầu chạy phiên bản mới (sau khi cập nhật): sao lưu DB trước khi migration chạy.
  await backupBeforeUpgrade({
    dbFile,
    backupDir: join(userData, 'backups'),
    version: app.getVersion(),
    log
  })
  const { db, close } = openDatabase(dbFile, resourcePath('migrations', 'src/main/db/migrations'))
  app.on('will-quit', close)

  // Dữ liệu cá nhân (chat, trí nhớ, hồ sơ, trợ lý) theo tài khoản đang đăng nhập (renderer báo qua account:set).
  let scope: AccountScope | null = null
  const getOwner = (): string => scope?.current ?? LOCAL_OWNER
  const conversations = new ConversationRepository(db, getOwner)
  const conversationGroups = new ConversationGroupRepository(db, getOwner)
  const projectRepo = new ProjectRepository(db, getOwner)
  const projects = new ProjectService({ repo: projectRepo, projectOf: (id) => conversations.get(id)?.projectId ?? null })
  const messages = new MessageRepository(db)
  const memories = new MemoryRepository(db, getOwner)
  const suggestions = new SuggestionRepository(db, getOwner)
  const settings = new SettingsRepository(db)
  // Đồng bộ trạng thái toàn app: mọi thay đổi (IPC có `changes`, ghi settings, việc nền) → sync:changed.
  const sync = new StateSync((topics) => mainWindow?.webContents.send(IPC.syncChanged, topics))
  settings.onChange = (key) => sync.settingsChanged(key)
  scope = new AccountScope({ memories, conversations, settings })
  const accountScope = scope
  const interrupted = messages.markInterrupted()
  if (interrupted) log.info(`Đánh dấu ${interrupted} tin nhắn bị gián đoạn`)

  const secrets = new SecretStore(join(userData, 'secrets'), safeStorage)

  // MCP server người dùng thêm (Mizuki dùng như tool) — mỗi lần gọi tool phải được duyệt.
  const mcpStore = new McpServerStore(
    {
      get: () => settings.get('mcpServers', z.array(z.any()), []),
      set: (list) => settings.set('mcpServers', list)
    },
    join(userData, 'secrets'),
    safeStorage
  )
  const mcpApprovals = new McpApprovals({
    store: mcpStore,
    emit: (req) => mainWindow?.webContents.send(IPC.mcpApprovalEvent, req),
    log
  })
  // MCP server HTTP cài từ kho plugin (8b): CLI đi qua proxy cục bộ — header bí mật chỉ tới đúng tên miền đã duyệt,
  // danh sách tool đổi → tự tắt server. Dùng fetch của Node (redirect: 'manual' trả đúng mã 3xx để kiểm tên miền).
  const mcpFetch = (url: string, init: RequestInit): Promise<Response> => fetch(url, init)
  const mcpProxy = new McpProxy({
    target: (id) => mcpStore.proxyTarget(id),
    toolsChanged: (id) => {
      mcpStore.markToolsChanged(id)
      sync.changed('mcpServers')
    },
    fetch: mcpFetch,
    log
  })
  await mcpProxy.start()
  app.on('before-quit', () => mcpProxy.stop())
  const mcpReviews = new McpReviews({ store: mcpStore, fetch: mcpFetch, log })

  // Mọi thẻ chờ duyệt (sửa file, quyền thư mục, nháp) hiện trong khung chat + "Hỏi lại": gọi Claude MỘT lần riêng,
  // cùng model đang chat, KHÔNG tool, không resume session → lượt CLI đang chờ duyệt không bị đụng.
  const approvalHub = new ApprovalHub({
    changed: () => sync.changed('approvals'),
    delta: (d) => mainWindow?.webContents.send(IPC.approvalsDelta, d),
    answer: async (card, question, onText, signal) => {
      const recent = messages
        .recent(card.conversationId, 10)
        .filter((m) => !m.recalledAt)
        .map((m) => ({ role: m.role, content: m.content }))
      let text = ''
      for await (const event of getProvider().chat(
        {
          prompt: explainPrompt(card, recent, question),
          systemPrompt: explainSystemPrompt(accountScope.getAssistant().name),
          mode: 'free',
          cwd: workspaceDir,
          ephemeral: true
        },
        signal
      )) {
        if (event.type === 'text') onText((text += event.delta))
        else if (event.type === 'error') return { error: event.message }
      }
      return text.trim() ? {} : { error: 'empty_answer' }
    },
    log
  })
  // Có thẻ mới mà app đang ở cửa sổ khác → nháy biểu tượng để người dùng duyệt.
  const flashForApproval = (): void => {
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true)
  }

  // Chế độ Code: mỗi lần Claude muốn sửa file, app hiện diff để người dùng duyệt.
  const approvals = new CodeApprovals({
    writableRoot: (id) => {
      const conv = conversations.get(id)
      return conv && conv.codeWrite && conv.cwd ? conv.cwd : null
    },
    emit: (request) => {
      approvalHub.add({ id: request.id, conversationId: request.conversationId, kind: 'code', request }, () => approvals.touch(request.id))
      flashForApproval()
    },
    closed: (id) => approvalHub.remove(id),
    mcpApproval: (conversationId, toolName, input) =>
      mcpApprovals.request(conversationId, toolName, input),
    log
  })
  await approvals.start()
  app.on('before-quit', () => approvals.stop())
  const permissionScript = resourcePath('permission-mcp.cjs', 'resources/permission-mcp.cjs')

  // Tool của app cho Claude (MCP `mmc`): hiện có chụp màn hình (điều khiển máy tính — chỉ xem).
  const tools = new AppToolRegistry()
  const toolBridge = new ToolBridge(tools)
  await toolBridge.start()
  app.on('before-quit', () => toolBridge.stop())
  const appToolsScript = resourcePath('app-tools-mcp.cjs', 'resources/app-tools-mcp.cjs')

  // Trợ lý tự xin quyền thư mục (mọi chế độ): người dùng tự chọn thư mục trong hộp thoại mới có quyền.
  const folderAccess = new FolderAccessRequests({
    getConversation: (id) => conversations.get(id),
    pickFolder: async (suggested) => {
      // Hộp chọn thư mục giả chỉ cho e2e ở bản chưa đóng gói — không bao giờ có trong bản phát hành.
      const fake = app.isPackaged ? undefined : process.env.MMC_FAKE_FOLDER
      if (fake !== undefined) return fake || null
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory'],
        ...(suggested && existsSync(suggested) ? { defaultPath: suggested } : {})
      }
      const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      return picked.canceled ? null : (picked.filePaths[0] ?? null)
    },
    grant: (id, path, write) => {
      approvals.cancelConversation(id)
      const conv = conversations.setCwd(id, path)
      return conv && write ? conversations.setCodeWrite(id, true) : conv
    },
    emit: (event) => {
      if ('closed' in event) return approvalHub.remove(event.id)
      approvalHub.add({ id: event.id, conversationId: event.conversationId, kind: 'folder', request: event }, () => folderAccess.touch(event.id))
      flashForApproval()
    },
    log
  })
  folderAccess.registerTools(tools)
  app.on('before-quit', () => folderAccess.cancelAll())

  const actionsDir = join(userData, 'logs', 'computer-use')
  const actions = new ActionLog(actionsDir)
  void actions
    .prune()
    .catch((err: Error) => log.warn(`Không dọn được log điều khiển máy tính: ${err.message}`))
  // Màn hình giả chỉ cho bản chưa đóng gói (test e2e) — không bao giờ có trong bản phát hành.
  const fakeScreen = app.isPackaged ? undefined : process.env.MMC_FAKE_SCREEN

  // Python sidecar (đọc cửa sổ / cây UI): chỉ tải khi người dùng bấm cài, nằm trong thư mục dữ liệu app.
  const devOverride = (name: string): string | undefined =>
    app.isPackaged ? undefined : process.env[name] || undefined
  const sidecarInstaller = new SidecarInstaller({
    root: join(userData, 'sidecar'),
    requirementsFile: resourcePath(
      'sidecar/requirements.txt',
      'resources/sidecar/requirements.txt'
    ),
    uvUrl: devOverride('MMC_SIDECAR_UV_URL'),
    fetch: (url, init) => net.fetch(url, init),
    run: runProcess,
    extractZip,
    emit: (state) => mainWindow?.webContents.send(IPC.sidecarStateEvent, state),
    log
  })
  void sidecarInstaller.refresh()
  const sidecarScript = resourcePath(
    'sidecar/desktop_server.py',
    'resources/sidecar/desktop_server.py'
  )
  const sidecarClient = new SidecarClient({
    command: () =>
      sidecarInstaller.state.state === 'installed'
        ? pythonCommand(sidecarInstaller.paths.venvPython, sidecarScript)
        : null,
    log
  })
  app.on('before-quit', () => {
    sidecarClient.stop()
    sidecarInstaller.cancel()
  })
  const appLogRoot = devOverride('MMC_APP_LOG_ROOT')
  let lastStopAt = 0
  const killSwitch = new KillSwitch(globalShortcut)
  const computer = new ComputerUseService({
    killSwitch,
    getSettings: () =>
      settings.get('computerUse', computerUseSettingsSchema, DEFAULT_COMPUTER_USE_SETTINGS),
    setSettings: (value) => settings.set('computerUse', value),
    shortcuts: globalShortcut,
    capture: fakeScreen ? fakeCapture(fakeScreen) : electronCapture,
    actions,
    abortChats: () => chat.abortAll(),
    revokeToolSessions: () => toolBridge.rotateToken(),
    emit: (status) => {
      mainWindow?.webContents.send(IPC.computerStatusEvent, status)
      // Người dùng thường đang ở app khác (Blender, Unity…) khi bấm phím dừng → báo bằng thông báo Windows.
      if (status.lastStop && status.lastStop.at !== lastStopAt) {
        lastStopAt = status.lastStop.at
        if (Notification.isSupported()) {
          new Notification({
            title: APP_NAME,
            body: 'Đã dừng khẩn cấp: trợ lý ngừng xem màn hình, mọi phản hồi đang chạy đã dừng.'
          }).show()
        }
      }
    },
    log,
    sidecar: {
      installed: () => sidecarInstaller.state.state === 'installed',
      call: (method, params) => sidecarClient.call(method, params),
      stop: () => sidecarClient.stop()
    },
    toDip: (rect) => screen.screenToDipRect(null, rect),
    // Thư mục log giả chỉ cho bản chưa đóng gói (test e2e).
    logRoots: appLogRoot ? { localAppData: appLogRoot, temp: join(appLogRoot, 'Temp') } : undefined
  })
  computer.registerTools(tools)
  app.on('will-quit', () => globalShortcut.unregisterAll())

  // Gmail / Telegram (GĐ 4): chỉ đọc + soạn nháp, mặc định tắt. Mỗi người tự tạo OAuth client / api_id;
  // secret, token, session chỉ nằm trên máy (DPAPI). Bản giả chỉ cho e2e ở bản chưa đóng gói.
  const secretsDir = join(userData, 'secrets')
  const draftApprovals = new DraftApprovals({
    emit: (event) => {
      if ('closed' in event) return approvalHub.remove(event.id)
      const { conversationId, ...request } = event
      approvalHub.add({ id: request.id, conversationId, kind: 'draft', request }, () => draftApprovals.touch(request.id))
      flashForApproval()
    },
    log
  })
  const connectorLimiter = new RateLimiter(() => 60)
  // Lần chạy theo lịch hẹn: cuộc trò chuyện → tài khoản Gmail lịch được đọc (chỉ trong lúc chạy).
  const gmailRestrict = new Map<string, readonly string[]>()
  const gmailOAuth = new OAuthLoopback()
  app.on('before-quit', () => {
    gmailOAuth.cancel()
    draftApprovals.cancelAll()
  })
  const gmailClientSecret = new SecretStore(secretsDir, safeStorage, 'gmail-client-secret.bin')
  const getGmailSettings = (): GmailSettings => settings.get('gmail', gmailSettingsSchema, DEFAULT_GMAIL_SETTINGS)
  const gmail = new GmailService({
    getSettings: getGmailSettings,
    setSettings: (value) => settings.set('gmail', value),
    backend:
      !app.isPackaged && process.env.MMC_FAKE_GMAIL === '1'
        ? new FakeGmailBackend()
        : new GoogleGmailBackend({
            fetch: (url, init) => net.fetch(url, init),
            openExternal: (url) => shell.openExternal(url),
            waitForCode: (open) => gmailOAuth.waitForCode(open),
            cancelWait: () => gmailOAuth.cancel(),
            redirectUri: OAUTH_REDIRECT_URL,
            clientId: () => getGmailSettings().clientId,
            clientSecret: () => gmailClientSecret.get(),
            // Mỗi tài khoản một file token. Tài khoản chuyển từ bản một-tài-khoản giữ file cũ → không phải đăng nhập lại.
            tokens: (accountId) => new SecretStore(secretsDir, safeStorage, gmailTokenFileName(accountId))
          }),
    clientSecret: gmailClientSecret,
    approvals: draftApprovals,
    limiter: connectorLimiter,
    emit: (status) => mainWindow?.webContents.send(IPC.gmailStatusEvent, status),
    log,
    restrictAccounts: (conversationId) => gmailRestrict.get(conversationId) ?? null,
    // Lần chạy theo lịch có quyền soạn nháp → thẻ hoãn duyệt (deferred được tạo ở phần Lịch hẹn bên dưới).
    deferDraft: (conversationId) => deferred.draftSink(conversationId)
  })
  gmail.registerTools(tools)
  const telegramApiHash = new SecretStore(secretsDir, safeStorage, 'telegram-api-hash.bin')
  const getTelegramSettings = (): TelegramSettings =>
    settings.get('telegram', telegramSettingsSchema, DEFAULT_TELEGRAM_SETTINGS)
  const telegramBackend =
    !app.isPackaged && process.env.MMC_FAKE_TELEGRAM === '1'
      ? new FakeTelegramBackend()
      : new GramJsBackend({
          apiId: () => getTelegramSettings().apiId,
          apiHash: () => telegramApiHash.get(),
          session: new SecretStore(secretsDir, safeStorage, 'telegram-session.bin'),
          appVersion: app.getVersion(),
          log
        })
  const telegram = new TelegramService({
    getSettings: getTelegramSettings,
    setSettings: (value) => settings.set('telegram', value),
    backend: telegramBackend,
    apiHash: telegramApiHash,
    approvals: draftApprovals,
    limiter: connectorLimiter,
    emit: (status) => mainWindow?.webContents.send(IPC.telegramStatusEvent, status),
    log,
    deferDraft: (conversationId) => deferred.draftSink(conversationId)
  })
  telegram.registerTools(tools)
  app.on('before-quit', () => void telegramBackend.cancelLogin())

  // Chat biểu cảm: GIF/sticker GIPHY (key: .env khi dev, hoặc người dùng dán — mã hoá DPAPI), sticker local, độ thân thiết trên máy.
  const giphyUserKey = new SecretStore(join(userData, 'secrets'), safeStorage, 'giphy-api-key.bin')
  // .env chỉ đọc ở bản chưa đóng gói (không có tiền tố VITE_ → không bao giờ nằm trong bộ cài).
  const giphyEnvKey = app.isPackaged
    ? null
    : 'GIPHY_API_KEY' in process.env // biến môi trường (kể cả rỗng, dùng trong test) được ưu tiên hơn file .env
      ? process.env.GIPHY_API_KEY || null
      : readEnvKey(join(app.getAppPath(), '.env'))
  const giphyKeySource = (): 'env' | 'user' | null =>
    giphyUserKey.has() ? 'user' : giphyEnvKey ? 'env' : null
  const giphy = new GiphyClient({
    getKey: () => giphyUserKey.get() ?? giphyEnvKey,
    fetch: (url) => net.fetch(url),
    baseUrl: devOverride('MMC_GIPHY_BASE')
  })
  const stickers = new StickerLibrary(
    resourcePath('stickers', 'resources/stickers'),
    join(userData, 'stickers')
  )
  stickers.ensureUserDir()
  const expressive = new ExpressiveService({
    getSettings: () =>
      settings.get('expressive', expressiveSettingsSchema, DEFAULT_EXPRESSIVE_SETTINGS),
    setSettings: (value) => settings.set('expressive', value),
    getStats: () => settings.get('expressiveStats', affinityStatsSchema.nullable(), null),
    setStats: (value) => settings.set('expressiveStats', value),
    getFavorites: () => settings.get('expressiveFavorites', z.array(mediaRefSchema), []),
    setFavorites: (list) => settings.set('expressiveFavorites', list),
    getRecent: () => settings.get('expressiveRecent', recentStoreSchema, EMPTY_RECENT),
    setRecent: (value) => settings.set('expressiveRecent', value),
    giphy,
    giphyKeySource,
    stickers,
    loadSkill: () => loadSkill(resourcePath('assistant-skills', 'assistant-skills'), 'expressive'),
    log
  })
  // Giọng nói: tiến trình Python riêng (voice_server.py) trong venv của sidecar; gói + model chỉ tải khi người dùng bấm.
  const fakeVoice = !app.isPackaged && process.env.MMC_FAKE_VOICE === '1'
  const voiceInstallerReal = new VoiceInstaller({
    modelsDir: join(userData, 'voice-models'),
    sidecar: () => ({ installed: sidecarInstaller.state.state === 'installed', paths: sidecarInstaller.paths }),
    requirements: {
      packages: resourcePath('sidecar/requirements-voice.txt', 'resources/sidecar/requirements-voice.txt'),
      cuda: resourcePath('sidecar/requirements-cuda.txt', 'resources/sidecar/requirements-cuda.txt')
    },
    fetch: (url, init) => net.fetch(url, init),
    run: runProcess,
    emit: (state) => mainWindow?.webContents.send(IPC.voicePackEvent, state),
    log
  })
  // Test e2e (bản chưa đóng gói + MMC_FAKE_VOICE): coi như đã cài, chép lời / đọc giả lập — không cần Python.
  const voiceInstaller = fakeVoice
    ? Object.assign(Object.create(voiceInstallerReal) as VoiceInstaller, {
        installed: async () => Object.fromEntries(['packages', 'piper', ...STT_MODELS].map((k) => [k, true]).concat([['cuda', false]]))
      })
    : voiceInstallerReal
  const voiceScript = resourcePath('sidecar/voice_server.py', 'resources/sidecar/voice_server.py')
  const voiceClient = new SidecarClient({
    command: () => (sidecarInstaller.state.state === 'installed' ? pythonCommand(sidecarInstaller.paths.venvPython, voiceScript) : null),
    log,
    timeoutMs: 120_000
  })
  app.on('before-quit', () => voiceClient.stop())
  // 2 giây im lặng (8 kHz, 16-bit) cho đọc giả lập — đủ dài để test thấy trạng thái "đang đọc".
  const SILENT_WAV = (() => {
    const data = 16_000 * 2
    const b = Buffer.alloc(44 + data)
    b.write('RIFF', 0)
    b.writeUInt32LE(36 + data, 4)
    b.write('WAVEfmt ', 8)
    b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20)
    b.writeUInt16LE(1, 22)
    b.writeUInt32LE(8_000, 24)
    b.writeUInt32LE(16_000, 28)
    b.writeUInt16LE(2, 32)
    b.writeUInt16LE(16, 34)
    b.write('data', 36)
    b.writeUInt32LE(data, 40)
    return b.toString('base64')
  })()
  const voice = new VoiceService({
    getSettings: () => settings.get('voice', voiceSettingsSchema, DEFAULT_VOICE_SETTINGS),
    setSettings: (value) => settings.set('voice', value),
    installer: voiceInstaller,
    sidecarInstalled: () => fakeVoice || sidecarInstaller.state.state === 'installed',
    call: fakeVoice
      ? (async (method: string) =>
          method === 'stt' ? { text: 'xin chào Mizuki, giọng nói giả lập' } : { audio: SILENT_WAV, mime: 'audio/wav' }) as never
      : (method, params, timeoutMs) => voiceClient.call(method, params, timeoutMs),
    stop: () => voiceClient.stop(),
    recordingsDir: join(workspaceDir, 'voice'),
    detectGpu: async () => {
      const r = await runProcess('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
        env: {},
        signal: new AbortController().signal,
        timeoutMs: 5_000
      }).catch(() => null)
      const [name, mb] = r?.code === 0 ? r.stdout.trim().split('\n')[0].split(',').map((s) => s.trim()) : []
      return name ? { name, vramMb: Number(mb) || 0 } : null
    },
    assistantName: () => accountScope.getAssistant().name,
    log
  })
  const pruneRecordings = (): void =>
    void voice.prune().then((n) => n && log.info(`Giọng nói: xoá ${n} ghi âm cũ hơn 7 ngày`))
  pruneRecordings()
  setInterval(pruneRecordings, 6 * 60 * 60 * 1000).unref()
  // Micro: chỉ cửa sổ chính, chỉ âm thanh (không camera). Quyền khác giữ như mặc định của Electron.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission !== 'media') return callback(true)
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    callback(wc === mainWindow?.webContents && types.length > 0 && types.every((t) => t === 'audio'))
  })
  killSwitch.onStop(() => mainWindow?.webContents.send(IPC.voiceStopEvent))

  // Artifact: lưu theo hội thoại; theme slide = có sẵn + file JSON người dùng thêm + theme của skill đang bật.
  const artifacts = new ArtifactService({
    db,
    ownsConversation: (id) => !!conversations.get(id),
    ownedConversations: () => conversations.list().map((c) => ({ id: c.id, title: c.title })),
    onChange: () => sync.changed('artifacts')
  })
  const themesDir = join(userData, 'artifact-themes')
  const artifactThemes = (): Theme[] => {
    const extra: Theme[] = []
    for (const f of existsSync(themesDir) ? readdirSync(themesDir) : []) {
      if (!f.endsWith('.json')) continue
      try {
        extra.push(themeSchema.parse(JSON.parse(readFileSync(join(themesDir, f), 'utf8'))))
      } catch (err) {
        log.warn(`Theme artifact ${f} không hợp lệ: ${(err as Error).message}`)
      }
    }
    // Theme từ skill người dùng đang bật (themes/*.json trong thư mục skill).
    extra.push(...skillStore.themesSync())
    return [...extra.filter((t) => !BUILTIN_THEMES.some((b) => b.id === t.id)), ...BUILTIN_THEMES]
  }
  const artifactLibDir = resourcePath('artifact-runtime', 'out/artifact-runtime')
  protocol.handle(ARTIFACT_SCHEME, (req) => handleArtifactRequest(req.url, { service: artifacts, libDir: artifactLibDir, themes: artifactThemes }))

  // Claude giả chỉ cho test e2e ở bản chưa đóng gói.
  const fakeChat =
    !app.isPackaged && process.env.MMC_FAKE_CHAT === '1' ? new FakeChatProvider(
          (name, input, conversationId) => tools.call(name, input, { conversationId }),
          (conversationId, toolName, input) => approvals.decide(conversationId, toolName, input),
          process.env.MMC_FAKE_CLI_SESSIONS === '1',
          (conversationId) => mcpStore.forCli((id) => mcpProxy.endpoint(id), conversationId)
        )
      : null

  const providers: Record<AiProviderId, AIProvider> = {
    'claude-cli': new ClaudeCliProvider(
      log,
      () => ({
        electronPath: process.execPath,
        script: permissionScript,
        url: approvals.url,
        token: approvals.token
      }),
      () => ({
        electronPath: process.execPath,
        script: appToolsScript,
        url: toolBridge.url,
        token: toolBridge.token
      }),
      (conversationId) => mcpStore.forCli((id) => mcpProxy.endpoint(id), conversationId)
    ),
    'anthropic-api': new AnthropicApiProvider(() => secrets.get())
  }
  const getProvider = (): AIProvider =>
    fakeChat ?? providers[settings.get('ai', aiSettingsSchema, DEFAULT_AI_SETTINGS).provider]

  const skillsDir = resourcePath('assistant-skills', 'assistant-skills')
  const skillStore = new SkillStore({
    builtinDir: skillsDir,
    userDir: join(app.getPath('userData'), 'skills'),
    getSettings: () => settings.get('skills', skillsSettingsSchema, DEFAULT_SKILLS_SETTINGS),
    setSettings: (value) => settings.set('skills', value),
    log,
    pluginSkills: () => pluginStore.skillFiles()
  })
  // Kho plugin online (8a): GitHub KHÔNG token; chỉ skill bằng chữ, cài theo commit SHA. Máy chủ GitHub giả chỉ cho
  /** Gỡ / đổi URL MCP server từ kho: huỷ thẻ duyệt đang chờ của server, dừng lượt chat đang nạp server đó. */
  const stopStoreServer = (id: string, name: string): void => {
    mcpApprovals.cancelServer(name)
    for (const c of mcpStore.conversationsUsing(id)) chat.abortConversation(c)
  }
  // e2e ở bản chưa đóng gói (MMC_FAKE_GITHUB = địa chỉ máy chủ giả).
  const fakeGithub = devOverride('MMC_FAKE_GITHUB')
  const pluginStore = new PluginStoreService({
    github: new GitHubClient(
      (url, init) => net.fetch(url, init),
      Date.now,
      fakeGithub ? { api: `${fakeGithub}/api`, raw: `${fakeGithub}/raw`, codeload: `${fakeGithub}/codeload` } : undefined
    ),
    dir: join(userData, 'plugins'),
    defaultSources: fakeGithub && process.env.MMC_FAKE_PLUGIN_SOURCES
      ? loadDefaultSources(process.env.MMC_FAKE_PLUGIN_SOURCES)
      : loadDefaultSources(resourcePath('plugin-sources.json', 'resources/plugin-sources.json')),
    getUserSources: () => settings.get('pluginSources', userSourcesSchema, []),
    setUserSources: (list) => void settings.set('pluginSources', list),
    getInstalled: () => settings.get('pluginsInstalled', installedSchema, []),
    setInstalled: (list) => void settings.set('pluginsInstalled', list),
    takenSkillNames: () => skillStore.takenNames(),
    forgetSkills: (names) => skillStore.forget(names),
    mcp: {
      forPlugin: (key) => mcpStore.forPlugin(key),
      syncPlugin: (plugin, decls) => {
        const before = mcpStore.forPlugin(plugin.key)
        const dropped = before.filter((s) => !decls.some((d) => d.server === s.server))
        const moved = before.filter((s) => decls.some((d) => d.server === s.server && (d.url !== s.url || d.host !== s.host)))
        for (const s of [...dropped, ...moved]) stopStoreServer(s.id, s.name)
        const names = mcpStore.syncPlugin(plugin, decls)
        sync.changed('mcpServers')
        return names
      },
      removePlugin: (key) => {
        for (const s of mcpStore.forPlugin(key)) stopStoreServer(s.id, s.name)
        mcpStore.removePlugin(key)
        sync.changed('mcpServers')
      }
    },
    probe: (url) => probeAuth(mcpFetch, url),
    allowLocalHttp: devOverride('MMC_FAKE_MCP_LOCAL') === '1',
    changed: () => sync.changed('pluginStore', 'skills'),
    now: Date.now,
    log
  })
  const memory = new MemoryService({
    conversations,
    messages,
    memories,
    suggestions,
    settings,
    getProvider,
    loadSkill: (name) => loadSkill(skillsDir, name),
    workspaceDir,
    emit: (payload) => mainWindow?.webContents.send(IPC.memoryEvent, payload),
    log,
    getOwner,
    getProject: (id) => projectRepo.get(id)
  })
  // Tiêu đề ngắn + gợi ý nhóm cho cuộc trò chuyện mới (từ khoá ngay; model rẻ sau lượt trả lời đầu).
  const organizer = new ConversationOrganizer({
    conversations,
    groups: conversationGroups,
    messages,
    getProvider,
    getSettings: () => settings.get('chatOrganize', chatOrganizeSettingsSchema, DEFAULT_CHAT_ORGANIZE_SETTINGS),
    workspaceDir,
    log,
    changed: () => sync.changed('conversations')
  })
  // ---- Lịch hẹn (PR 7a): chỉ chạy khi app mở, lần chạy CHỈ ĐỌC, mặc định tắt. ----
  // Đồng hồ giả chỉ cho e2e ở bản chưa đóng gói (MMC_FAKE_CLOCK=1): test tua giờ qua IPC.
  const fakeClock = !app.isPackaged && process.env.MMC_FAKE_CLOCK === '1'
  let clockOffset = 0
  const now = (): number => Date.now() + clockOffset
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
        const r = scheduleService.save({ input, confirmed: true }, 'assistant')
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
  const actionLog = new ActionLogRepository(db, getOwner)
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
    log: (entry) => {
      try {
        actionLog.add(entry)
      } catch (err) {
        log.warn(`Ghi nhật ký thao tác lỗi: ${String(err)}`)
      }
    },
    killSwitch,
    logger: log
  })
  commandService.registerTools(tools)
  killSwitch.onStop(() => commandService.stopAll())
  app.on('before-quit', () => commandService.stopAll('App đang đóng.'))
  const legacyTitles = organizer.fixLegacyTitles()
  if (legacyTitles) log.info(`Sửa ${legacyTitles} tiêu đề chat dạng lệnh tạo artifact`)
  const chat = new ChatService({
    conversations,
    messages,
    getProvider,
    getAssistant: () => accountScope.getAssistant(),
    getMemoryContext: (query, conversationId) => memory.contextFor(query, conversationId),
    projectPromptFor: (conversationId) => projects.promptFor(conversationId),
    loadModeSkill: (mode) => loadModeSkill(skillsDir, mode),
    userSkillsFor: (text, opts) => skillStore.promptFor(text, opts),
    workspaceDir,
    emit: (payload) => mainWindow?.webContents.send(IPC.chatEvent, payload),
    log,
    onFirstMessage: (conversationId, text) => organizer.onFirstMessage(conversationId, text),
    onRunEnd: (conversationId) => {
      // Thứ tự (cập nhật lúc trả lời xong) trên thanh bên.
      sync.changed('conversations')
      void organizer.afterRun(conversationId).catch((e: unknown) => log.warn(`Đặt tiêu đề tự động lỗi: ${String(e)}`))
      approvals.cancelConversation(conversationId)
      mcpApprovals.cancelConversation(conversationId)
      mcpStore.endRun(conversationId)
      draftApprovals.cancelConversation(conversationId)
      folderAccess.cancelConversation(conversationId)
      scheduleProposals.cancelConversation(conversationId)
      commandService.cancelConversation(conversationId)
      approvalHub.endRun(conversationId)
    },
    appToolsFor: (conversationId) =>
      combineToolSets([
        folderAccess.toolsFor(conversationId),
        computer.toolsFor(),
        gmail.toolsFor(),
        telegram.toolsFor(),
        scheduleProposals.toolsFor(),
        commandService.toolsFor(conversationId)
      ]),
    expressive,
    voicePrompt: async (tease) => {
      const skill = await loadSkill(skillsDir, 'voice')
      return skill ? voiceSkillPrompt(skill, tease) : ''
    },
    artifacts: {
      prompt: async () => {
        const skill = await loadSkill(skillsDir, 'artifacts')
        return skill ? `## Artifact\n${skill}\nTheme slide có sẵn: ${artifactThemes().map((t) => t.id).join(', ')}.` : ''
      },
      contextFor: (id) => artifacts.contextFor(id),
      applyReply: (id, raw) => artifacts.applyReply(id, raw)
    }
  })
  app.on('before-quit', () => chat.abortAll())

  const showWindow = (): void => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  // Báo kết quả lần chạy: cửa sổ đang hiện + đang được chọn → báo trong app; không thì thông báo Windows (bấm → mở
  // đúng cuộc). Chỉ có tên lịch + trạng thái, KHÔNG có nội dung trả lời (thông báo có thể hiện trên màn hình khoá).
  const showScheduleNotice = (n: ScheduleNotice): void => {
    const body = scheduleNoticeText(n)
    const conversationId = n.kind === 'finished' ? n.conversationId : null
    const inApp = !!mainWindow && mainWindow.isVisible() && mainWindow.isFocused()
    mainWindow?.webContents.send(IPC.schedulesNotice, { ...n, text: body, inApp })
    // e2e (đồng hồ giả): không bật thông báo Windows thật.
    if (inApp || fakeClock || !Notification.isSupported()) return
    const note = new Notification({ title: APP_NAME, body })
    note.on('click', () => {
      showWindow()
      mainWindow?.webContents.send(IPC.schedulesOpen, { conversationId, scheduleId: 'scheduleId' in n ? n.scheduleId : null })
    })
    note.show()
  }
  const isDirectory = (path: string): boolean => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
  const scheduler = new Scheduler({
    repo: scheduleRepo,
    now,
    getSettings: getSchedulesSettings,
    setSettings: setSchedulesSettings,
    getLastOwner: () => settings.get('schedulesLastOwner', z.string().nullable(), null),
    setLastOwner: (owner) => void settings.set('schedulesLastOwner', owner),
    startRun: (schedule, owner, revision, runId) =>
      startScheduledRun(
        schedule,
        owner,
        {
          createConversation: (input) => conversations.createForSchedule(input),
          runChat: (conversationId, turn) => chat.runScheduled(conversationId, turn),
          abortChat: (requestId) => chat.abort(requestId),
          gmailTools: (ids, drafts) => gmail.toolsFor({ accounts: ids, drafts }),
          telegramTools: (drafts) => telegram.toolsFor({ drafts }),
          restrictTools: (conversationId, names) => tools.restrict(conversationId, names),
          restrictGmail: (conversationId, ids) => {
            if (ids) gmailRestrict.set(conversationId, ids)
            else gmailRestrict.delete(conversationId)
          },
          beginDeferred: (conversationId, ctx) => deferred.begin(conversationId, ctx),
          endDeferred: (conversationId) => deferred.end(conversationId),
          now
        },
        revision,
        runId
      ),
    pendingCount: (owner) => deferred.pendingCount(owner),
    pendingForRun: (runId) => deferred.pendingForRun(runId),
    folderExists: isDirectory,
    killSwitch,
    notify: showScheduleNotice,
    changed: (withConversations) => {
      sync.changed('schedules')
      // Lần chạy bắt đầu / xong: cuộc mới, hoặc tin mới trong cuộc đang mở (lượt Yêu cầu sửa) → khung chat tải lại.
      if (withConversations) sync.changed('conversations', 'messages')
      syncTray()
    },
    log
  })
  const scheduleService = new ScheduleService({
    repo: scheduleRepo,
    scheduler,
    now,
    isDirectory,
    gmailAccounts: () => getGmailSettings().accounts.map((a) => ({ id: a.id, label: a.label }))
  })
  // Thẻ hoãn duyệt (7b): đề xuất sửa file / nháp của lần chạy theo lịch — người dùng duyệt sau, lưu DB, hết hạn 7 ngày.
  const deferred = new DeferredService({
    db,
    getOwner,
    now,
    scheduleGrants: (id) => scheduleRepo.get(id)?.grants ?? null,
    createDraft: (payload, body) =>
      payload.draft.service === 'gmail' ? gmail.createDeferredDraft(payload, body) : telegram.createDeferredDraft(payload, body),
    answer: async (card, question, signal) => {
      const result = await completeText(
        getProvider(),
        {
          prompt: deferredExplainPrompt(card, question),
          systemPrompt: explainSystemPrompt(accountScope.getAssistant().name),
          mode: 'free',
          cwd: workspaceDir,
          ephemeral: true
        },
        signal
      )
      return 'error' in result ? result : { text: result.text }
    },
    revise: (input) =>
      scheduler.runRevision(input.scheduleId, { conversationId: input.conversationId, note: input.note, summary: input.summary }),
    changed: () => {
      sync.changed('deferred')
      sync.changed('schedules')
    },
    log
  })
  deferred.registerTools(tools)
  app.on('before-quit', () => deferred.cancelAll())
  // Ctrl+Alt+Q / nút dừng khẩn cấp: CHỈ khi đang có lần chạy → dừng + tạm dừng mọi lịch.
  killSwitch.onStop(() => scheduler.emergencyStop())
  const tray = new AppTray({
    create: (icon) => new Tray(icon),
    icon: () => nativeImage.createFromBitmap(trayIconBitmap(32), { width: 32, height: 32 }),
    buildMenu: (template) => Menu.buildFromTemplate(template),
    state: () => ({ pausedAll: getSchedulesSettings().pausedAll, running: scheduler.busy }),
    actions: {
      open: showWindow,
      setPausedAll: (paused) => {
        scheduler.setPausedAll(paused)
        syncTray()
      },
      stopRun: () => void scheduler.stopCurrent(),
      quit: () => {
        quitting = true
        app.quit()
      }
    }
  })
  function syncTray(): void {
    const s = getSchedulesSettings()
    tray.sync(s.enabled && s.trayOnClose)
  }
  syncTray()
  onWindowClose = (event, win) => {
    const s = getSchedulesSettings()
    const action = closeAction(s)
    if (action === 'quit') return
    event.preventDefault()
    if (action === 'hide') return win.hide()
    // Lần đầu bấm X khi đang có lịch hẹn: nhắc một lần, người dùng chọn ẩn xuống khay hay thoát.
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: APP_NAME,
      message: 'Lịch hẹn sẽ không chạy khi app đã thoát.',
      detail: 'Ẩn xuống khay (góc phải thanh tác vụ) để lịch hẹn vẫn chạy? Đổi lại được trong Cài đặt → Khả năng → Lịch hẹn.',
      buttons: ['Ẩn xuống khay', 'Thoát'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    setSchedulesSettings({ ...s, closeHintShown: true, trayAsked: true, trayOnClose: choice === 0 })
    syncTray()
    if (choice === 0) win.hide()
    else {
      quitting = true
      app.quit()
    }
  }
  scheduler.start()
  const scheduleTimer = setInterval(() => scheduler.tick(), 30_000)
  app.on('before-quit', () => clearInterval(scheduleTimer))
  powerMonitor.on('resume', () => scheduler.resume())

  const handle = createHandle(
    (event: IpcMainInvokeEvent) => event.sender === mainWindow?.webContents,
    log,
    sync
  )
  const getWindow = (): BrowserWindow | null => mainWindow
  registerIpc({
    conversations,
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
    emit: (state) => mainWindow?.webContents.send(IPC.updateState, state),
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
    emitStatus: (status) => mainWindow?.webContents.send(IPC.agentsStatusEvent, status),
    emitNotice: (notice) => {
      mainWindow?.webContents.send(IPC.agentsNoticeEvent, notice)
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
  registerCommandsIpc({
    handle,
    service: commandService,
    status: async () => ({ settings: getCommandsSettings(), git: await gitReady }),
    setSettings: (value) => void settings.set('commands', value)
  })
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
            clockOffset += ms
            scheduler.tick()
          },
          // Máy ngủ `ms` rồi thức dậy: đồng hồ nhảy trước, bộ hẹn giờ chỉ biết khi có sự kiện resume.
          sleep: (ms) => {
            clockOffset += ms
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
    folderAccess,
    hub: approvalHub,
    memory,
    getProvider,
    loadSkill: (name) => loadSkill(skillsDir, name),
    workspaceDir,
    getWindow,
    log
  })

  mainWindow = createWindow()
  // Bắt đầu kiểm tra khi giao diện đã tải (renderer cũng tự hỏi getState lúc mở nên không lỡ trạng thái).
  mainWindow.webContents.once('did-finish-load', () => {
    updates.start()
    void agentHub.restore()
  })
  log.info(`Khởi động ${APP_NAME} ${app.getVersion()}`)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    // Đang nằm khay (cửa sổ ẩn) → hiện lại.
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.setAppUserModelId('com.phanduongthien.teamworking')
  void app.whenReady().then(async () => {
    try {
      await bootstrap()
    } catch (err) {
      const message = (err as Error).stack ?? String(err)
      log.error(`Khởi động thất bại: ${message}`)
      dialog.showErrorBox(APP_NAME, `${(err as Error).message}\n\nLog: ${log.file}`)
      app.quit()
    }
  })
  app.on('window-all-closed', () => app.quit())
}
