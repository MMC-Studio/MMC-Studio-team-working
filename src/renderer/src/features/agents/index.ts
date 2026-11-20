import { Network } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { AgentsOverlay } from './components/AgentsOverlay'
import { AgentsRedirect } from '../plugins/components/Redirects'
import en from './i18n/en.json'
import vi from './i18n/vi.json'
import { setupAgents } from './store'

/** Kết nối agent + MCP client (thử nghiệm, mặc định tắt). Giao diện ở trang Plugin; `/agents` chỉ chuyển hướng. Giữ module vì overlay duyệt agent / tool MCP. */
export const agentsFeature: FeatureDefinition = {
  id: 'agents',
  titleKey: 'title',
  icon: Network,
  route: '/agents',
  roles: [],
  component: AgentsRedirect,
  i18n: { vi, en },
  nav: false,
  setup: setupAgents,
  overlay: AgentsOverlay
}
