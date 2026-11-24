import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { extraFolderRefSchema, revokeFolderSchema, revokeScheduleGrantSchema } from '@shared/privacy'
import type { PrivacyService } from '../privacy/service'
import type { HandleFn } from './register'

export type PrivacyIpcDeps = { handle: HandleFn; service: PrivacyService }

/**
 * Cài đặt → Quyền & riêng tư. Đọc gom từ nơi lưu gốc (trang nghe các mục sync sẵn có, không có mục riêng); thu hồi
 * báo đúng các mục bị đổi để mọi nơi (thanh thư mục, trang Lịch hẹn, thẻ duyệt) cập nhật theo.
 */
export function registerPrivacyIpc(deps: PrivacyIpcDeps): void {
  const { handle, service } = deps
  handle(IPC.privacyStatus, z.undefined(), () => service.status())
  handle(IPC.privacyRevokeFolder, revokeFolderSchema, ({ conversationId }) => service.revokeFolder(conversationId), {
    changes: ['conversations', 'approvals']
  })
  handle(IPC.privacyRevokeExtraFolder, extraFolderRefSchema, ({ conversationId, path }) => service.revokeExtraFolder(conversationId, path), {
    changes: ['conversations', 'approvals']
  })
  handle(IPC.privacyRevokeScheduleGrant, revokeScheduleGrantSchema, ({ scheduleId, key }) => !!service.revokeScheduleGrant(scheduleId, key), {
    changes: ['schedules', 'deferred']
  })
}
