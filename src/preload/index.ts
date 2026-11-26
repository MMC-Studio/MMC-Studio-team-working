import { contextBridge } from 'electron'
import type { TeamWorkingApi } from '@shared/types'
import { commonApi } from './api/common'
import { assistantApi } from './api/assistant'
import { teamApi } from './api/team'
import { integrationsApi } from './api/integrations'

/**
 * Chỉ expose các hàm có tên rõ ràng — renderer không bao giờ chạm ipcRenderer trực tiếp.
 * Mỗi nhóm một file trong `api/` (chung / A / B / C).
 */
const api: TeamWorkingApi = {
  ...commonApi,
  ...assistantApi,
  ...teamApi,
  ...integrationsApi
}

contextBridge.exposeInMainWorld('api', api)
