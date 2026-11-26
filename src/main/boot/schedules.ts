import { statSync } from 'node:fs'
import { app, dialog, Menu, nativeImage, Notification, powerMonitor, Tray, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { APP_NAME } from '@shared/appConfig'
import { IPC } from '@shared/ipc'
import { completeText } from '../ai/AIProvider'
import { explainSystemPrompt } from '../approvals/explain'
import { DeferredService, deferredExplainPrompt } from '../schedules/deferred'
import { scheduleNoticeText } from '../schedules/notice'
import { startScheduledRun } from '../schedules/runner'
import { Scheduler, type ScheduleNotice } from '../schedules/scheduler'
import { ScheduleService } from '../schedules/service'
import { AppTray, closeAction, trayIconBitmap } from '../tray'
import type { Chat, ChatDeps } from './chat'
import type { BootEnv, LateRefs } from './context'

export interface SchedulesDeps extends ChatDeps {
  chat: Chat
  /** Đánh dấu đang thoát thật (biến `quitting` trong index.ts) — đóng cửa sổ không ẩn xuống khay nữa. */
  setQuitting: () => void
}

/** Scheduler, lịch hẹn, thẻ hoãn duyệt, khay, xử lý nút X. */
export function createSchedules(env: BootEnv, deps: SchedulesDeps, late: LateRefs) {
  const { log, workspaceDir, getWindow } = env
  const { db, getOwner, conversations, settings, sync, recordAction, accountScope } = deps.core
  const { tools } = deps.approvals
  const { killSwitch } = deps.computer
  const { gmailRestrict, getGmailSettings, gmail, telegram } = deps.connectors
  const { getProvider } = deps.content
  const { fakeClock, now, getSchedulesSettings, setSchedulesSettings, scheduleRepo } = deps.commands
  const { chat } = deps.chat
  const { setQuitting } = deps

  const showWindow = (): void => {
    const mainWindow = getWindow()
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  // Báo kết quả lần chạy: cửa sổ đang hiện + đang được chọn → báo trong app; không thì thông báo Windows (bấm → mở
  // đúng cuộc). Chỉ có tên lịch + trạng thái, KHÔNG có nội dung trả lời (thông báo có thể hiện trên màn hình khoá).
  const showScheduleNotice = (n: ScheduleNotice): void => {
    const mainWindow = getWindow()
    const body = scheduleNoticeText(n)
    const conversationId = n.kind === 'finished' ? n.conversationId : null
    const inApp = !!mainWindow && mainWindow.isVisible() && mainWindow.isFocused()
    mainWindow?.webContents.send(IPC.schedulesNotice, { ...n, text: body, inApp })
    // e2e (đồng hồ giả): không bật thông báo Windows thật.
    if (inApp || fakeClock || !Notification.isSupported()) return
    const note = new Notification({ title: APP_NAME, body })
    note.on('click', () => {
      showWindow()
      getWindow()?.webContents.send(IPC.schedulesOpen, { conversationId, scheduleId: 'scheduleId' in n ? n.scheduleId : null })
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
  late.scheduleService = scheduleService
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
    log,
    record: recordAction
  })
  late.deferred = deferred
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
        setQuitting()
        app.quit()
      }
    }
  })
  function syncTray(): void {
    const s = getSchedulesSettings()
    tray.sync(s.enabled && s.trayOnClose)
  }
  syncTray()
  /** Bấm X: ẩn xuống khay / hỏi / thoát (index.ts gọi khi chưa thoát thật). */
  const onWindowClose = (event: Electron.Event, win: BrowserWindow): void => {
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
      setQuitting()
      app.quit()
    }
  }
  scheduler.start()
  const scheduleTimer = setInterval(() => scheduler.tick(), 30_000)
  app.on('before-quit', () => clearInterval(scheduleTimer))
  powerMonitor.on('resume', () => scheduler.resume())

  return { scheduler, scheduleService, deferred, syncTray, onWindowClose }
}

export type Schedules = ReturnType<typeof createSchedules>
