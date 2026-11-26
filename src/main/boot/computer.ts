import { join } from 'node:path'
import { app, globalShortcut, net, Notification, screen } from 'electron'
import { APP_NAME } from '@shared/appConfig'
import { IPC } from '@shared/ipc'
import { computerUseSettingsSchema, DEFAULT_COMPUTER_USE_SETTINGS } from '@shared/schemas'
import { ActionLog } from '../computer/actionLog'
import { electronCapture, fakeCapture } from '../computer/electronCapture'
import { KillSwitch } from '../computer/killSwitch'
import { ComputerUseService } from '../computer/service'
import { pythonCommand, SidecarClient } from '../sidecar/client'
import { SidecarInstaller } from '../sidecar/installer'
import { extractZip, runProcess } from '../sidecar/process'
import type { Approvals } from './approvals'
import { devOverride, resourcePath, type BootEnv, type LateRefs } from './context'
import type { Core } from './core'

/** Python sidecar, phím dừng khẩn cấp, điều khiển máy tính. */
export function createComputer(env: BootEnv, core: Core, approvalsPart: Approvals, late: LateRefs) {
  const { log, userData, getWindow } = env
  const { settings } = core
  const { tools, toolBridge } = approvalsPart

  const actionsDir = join(userData, 'logs', 'computer-use')
  const actions = new ActionLog(actionsDir)
  void actions
    .prune()
    .catch((err: Error) => log.warn(`Không dọn được log điều khiển máy tính: ${err.message}`))
  // Màn hình giả chỉ cho bản chưa đóng gói (test e2e) — không bao giờ có trong bản phát hành.
  const fakeScreen = app.isPackaged ? undefined : process.env.MMC_FAKE_SCREEN

  // Python sidecar (đọc cửa sổ / cây UI): chỉ tải khi người dùng bấm cài, nằm trong thư mục dữ liệu app.
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
    emit: (state) => getWindow()?.webContents.send(IPC.sidecarStateEvent, state),
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
    abortChats: () => late.chat.abortAll(),
    revokeToolSessions: () => toolBridge.rotateToken(),
    emit: (status) => {
      getWindow()?.webContents.send(IPC.computerStatusEvent, status)
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

  return { actionsDir, sidecarInstaller, sidecarClient, killSwitch, computer }
}

export type Computer = ReturnType<typeof createComputer>
