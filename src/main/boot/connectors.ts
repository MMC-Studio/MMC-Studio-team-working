import { join } from 'node:path'
import { app, net, safeStorage, shell } from 'electron'
import { OAUTH_REDIRECT_URL } from '@shared/appConfig'
import {
  DEFAULT_GMAIL_SETTINGS,
  DEFAULT_TELEGRAM_SETTINGS,
  gmailSettingsSchema,
  telegramSettingsSchema,
  type GmailSettings,
  type TelegramSettings
} from '@shared/connectors'
import { IPC } from '@shared/ipc'
import { RateLimiter } from '../agents/rateLimiter'
import { DraftApprovals } from '../connectors/approvals'
import { FakeGmailBackend } from '../connectors/gmail/fake'
import { gmailTokenFileName, GoogleGmailBackend } from '../connectors/gmail/google'
import { GmailService } from '../connectors/gmail/service'
import { FakeTelegramBackend } from '../connectors/telegram/fake'
import { GramJsBackend } from '../connectors/telegram/gramjs'
import { TelegramService } from '../connectors/telegram/service'
import { OAuthLoopback } from '../services/oauthLoopback'
import { SecretStore } from '../services/secrets'
import type { Approvals } from './approvals'
import type { BootEnv, LateRefs } from './context'
import type { Core } from './core'

/** Gmail / Telegram (GĐ 4) + thẻ duyệt nháp. */
export function createConnectors(env: BootEnv, core: Core, approvalsPart: Approvals, late: LateRefs) {
  const { log, userData, getWindow } = env
  const { settings, recordAction } = core
  const { approvalHub, flashForApproval, tools } = approvalsPart

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
    log,
    record: recordAction
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
    emit: (status) => getWindow()?.webContents.send(IPC.gmailStatusEvent, status),
    log,
    restrictAccounts: (conversationId) => gmailRestrict.get(conversationId) ?? null,
    // Lần chạy theo lịch có quyền soạn nháp → thẻ hoãn duyệt (deferred được tạo ở boot/schedules.ts).
    deferDraft: (conversationId) => late.deferred.draftSink(conversationId)
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
    emit: (status) => getWindow()?.webContents.send(IPC.telegramStatusEvent, status),
    log,
    deferDraft: (conversationId) => late.deferred.draftSink(conversationId)
  })
  telegram.registerTools(tools)
  app.on('before-quit', () => void telegramBackend.cancelLogin())

  return { draftApprovals, gmailRestrict, getGmailSettings, gmail, telegram }
}

export type Connectors = ReturnType<typeof createConnectors>
