import type { CommonApi } from './api/common'
import type { AssistantApi } from './api/assistant'
import type { TeamApi } from './api/team'
import type { IntegrationsApi } from './api/integrations'

export * from './api/common'
export * from './api/assistant'
export * from './api/team'
export * from './api/integrations'

/**
 * API có kiểu mà preload expose tại `window.api`. Mỗi nhóm một file trong `api/` (chung / A / B / C);
 * thêm namespace mới vào file của mảng mình. Trùng tên namespace giữa hai nhóm → lỗi typecheck.
 */
export interface TeamWorkingApi extends CommonApi, AssistantApi, TeamApi, IntegrationsApi {}
