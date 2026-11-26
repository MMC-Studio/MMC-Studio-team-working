import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { IPC } from '@shared/ipc'
import { ActionLogRepository, type ActionLogEntry } from '../audit/actionLog'
import { backupBeforeUpgrade } from '../db/backup'
import { openDatabase } from '../db/client'
import {
  LOCAL_OWNER,
  ConversationGroupRepository,
  ConversationRepository,
  MemoryRepository,
  MessageRepository,
  SettingsRepository,
  SuggestionRepository
} from '../db/repositories'
import { AccountScope } from '../memory/accountScope'
import { ProjectRepository } from '../projects/repository'
import { ProjectService } from '../projects/service'
import { SecretStore } from '../services/secrets'
import { StateSync } from '../services/stateSync'
import { resourcePath, type BootEnv } from './context'

/** Sao lưu + DB, các repository, đồng bộ trạng thái, nhật ký thao tác, khoá bí mật. */
export async function createCore(env: BootEnv) {
  const { log, userData, getWindow } = env
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
  const sync = new StateSync((topics) => getWindow()?.webContents.send(IPC.syncChanged, topics))
  settings.onChange = (key) => sync.settingsChanged(key)
  // Nhật ký thao tác cần quyền (lệnh, sửa file, MCP, nháp) — chỉ trên máy, theo tài khoản, giữ 90 ngày.
  const actionLog = new ActionLogRepository(db, getOwner)
  actionLog.onChange = () => sync.changed('actionLog')
  const recordAction = (entry: ActionLogEntry): void => {
    try {
      actionLog.add(entry)
    } catch (err) {
      log.warn(`Ghi nhật ký thao tác lỗi: ${String(err)}`)
    }
  }
  scope = new AccountScope({ memories, conversations, settings })
  const accountScope = scope
  const interrupted = messages.markInterrupted()
  if (interrupted) log.info(`Đánh dấu ${interrupted} tin nhắn bị gián đoạn`)

  const secrets = new SecretStore(join(userData, 'secrets'), safeStorage)

  return {
    db,
    getOwner,
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
    recordAction,
    accountScope,
    secrets
  }
}

export type Core = Awaited<ReturnType<typeof createCore>>
