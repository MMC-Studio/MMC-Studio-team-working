import { IPC } from '@shared/ipc'
import { actionLogQuerySchema } from '@shared/actionLog'
import type { ActionLogRepository } from '../audit/actionLog'
import type { HandleFn } from './register'

export type ActionLogIpcDeps = { handle: HandleFn; repo: Pick<ActionLogRepository, 'query'> }

/** Chỉ đọc: trang nhật ký xem / lọc. Ghi là việc của các dịch vụ duyệt (không có IPC ghi / xoá từ renderer). */
export function registerActionLogIpc(deps: ActionLogIpcDeps): void {
  deps.handle(IPC.actionLogList, actionLogQuerySchema, (q) => deps.repo.query(q))
}
