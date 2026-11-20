import { Mail } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { ConnectorsRedirect } from '../plugins/components/Redirects'
import en from './i18n/en.json'
import vi from './i18n/vi.json'
import { setupConnectors } from './store'

/** Gmail / Telegram cá nhân (thử nghiệm, mặc định tắt): chỉ đọc + soạn nháp. Giao diện ở trang Plugin; `/connectors` chỉ chuyển hướng. */
export const connectorsFeature: FeatureDefinition = {
  id: 'connectors',
  titleKey: 'title',
  icon: Mail,
  route: '/connectors',
  roles: [],
  component: ConnectorsRedirect,
  i18n: { vi, en },
  nav: false,
  // Thẻ duyệt nháp nằm trong khung chat (features/chat/approvals).
  setup: setupConnectors
}
