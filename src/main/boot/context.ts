import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { AIProvider } from '../ai/AIProvider'
import type { DeferredService } from '../schedules/deferred'
import type { ScheduleService } from '../schedules/service'
import type { ChatService } from '../services/chatService'
import type { Logger } from '../services/logger'

/** Tài nguyên đóng gói (extraResources) khi đã build, thư mục nguồn khi dev. */
export function resourcePath(packaged: string, dev: string): string {
  return app.isPackaged ? join(process.resourcesPath, packaged) : join(app.getAppPath(), dev)
}

/** Biến môi trường chỉ đọc ở bản chưa đóng gói (dev / e2e). */
export const devOverride = (name: string): string | undefined =>
  app.isPackaged ? undefined : process.env[name] || undefined

/** Thứ mọi phần khởi tạo cần: log, thư mục dữ liệu, cửa sổ chính (có thể chưa tạo). */
export interface BootEnv {
  log: Logger
  userData: string
  workspaceDir: string
  getWindow: () => BrowserWindow | null
}

/**
 * Dịch vụ tạo ở phần sau nhưng được phần trước gọi tới — chỉ lúc chạy (người dùng thao tác, lượt chat…),
 * không bao giờ lúc khởi tạo. Trước khi tách file, đây là closure tham chiếu biến khai báo phía dưới trong
 * cùng bootstrap(); bootstrap() gán từng mục ngay sau khi tạo xong.
 */
export interface LateRefs {
  getProvider: () => AIProvider
  chat: ChatService
  deferred: DeferredService
  scheduleService: ScheduleService
  cancelConversationAccess: (conversationId: string) => void
}
