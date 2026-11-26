import { COMMON_IPC } from './ipc/common'
import { ASSISTANT_IPC } from './ipc/assistant'
import { TEAM_IPC } from './ipc/team'
import { INTEGRATIONS_IPC } from './ipc/integrations'

/**
 * Tên kênh IPC — dùng chung main/preload để không gõ sai. Mỗi mảng thêm kênh vào file của mình trong `ipc/`
 * (test `ipc.test.ts` chặn trùng tên).
 */
export const IPC = {
  ...COMMON_IPC,
  ...ASSISTANT_IPC,
  ...TEAM_IPC,
  ...INTEGRATIONS_IPC
} as const

export { COMMON_IPC, ASSISTANT_IPC, TEAM_IPC, INTEGRATIONS_IPC }
