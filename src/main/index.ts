import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, protocol, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { APP_NAME, LEGACY_USER_DATA_DIR } from '@shared/appConfig'
import { createApprovals } from './boot/approvals'
import { createChat } from './boot/chat'
import { createCommands } from './boot/commands'
import { createComputer } from './boot/computer'
import { createConnectors } from './boot/connectors'
import { createContent } from './boot/content'
import type { BootEnv, LateRefs } from './boot/context'
import { createCore } from './boot/core'
import { createIpc } from './boot/ipc'
import { createMedia } from './boot/media'
import { createSchedules } from './boot/schedules'
import { createLogger } from './services/logger'

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

/**
 * Tạo mọi dịch vụ rồi đăng ký mọi IPC. Mỗi mảng một file trong `boot/`; thứ tự gọi dưới đây chính là thứ tự
 * khởi tạo và thứ tự `before-quit` (mỗi file đăng ký `before-quit` ngay cạnh dịch vụ của nó) — đừng đổi.
 * commands → chat → schedules: ChatService cần dịch vụ lệnh, Scheduler lại cần ChatService.
 */
async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  const workspaceDir = join(userData, 'workspace')
  mkdirSync(workspaceDir, { recursive: true })
  const env: BootEnv = { log, userData, workspaceDir, getWindow: () => mainWindow }
  // Dịch vụ tạo ở phần sau mà phần trước gọi tới lúc chạy — mỗi file gán mục của mình ngay khi tạo xong.
  const late = {} as LateRefs

  const core = await createCore(env)
  const approvals = await createApprovals(env, core, late)
  const computer = createComputer(env, core, approvals, late)
  const connectors = createConnectors(env, core, approvals, late)
  const media = createMedia(env, core, computer)
  const content = createContent(env, core, approvals, late)
  const commands = createCommands(env, core, approvals, computer, late)
  const parts = { core, approvals, computer, connectors, media, content, commands }
  const chat = createChat(env, parts, late)
  const schedules = createSchedules(
    env,
    {
      ...parts,
      chat,
      setQuitting: () => {
        quitting = true
      }
    },
    late
  )
  onWindowClose = schedules.onWindowClose
  const { updates, agentHub } = createIpc(env, { ...parts, chat, schedules }, late)

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
