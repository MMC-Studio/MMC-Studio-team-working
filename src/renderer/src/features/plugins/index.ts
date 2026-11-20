import { Plug } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { PluginsRoute } from './components/PluginsRoute'
import en from './i18n/en.json'
import vi from './i18n/vi.json'
import { PLUGINS_ROUTE } from './model'
import { setupPlugins } from './store'

/**
 * Trang Plugin: MỘT chỗ quản lý skill, Gmail, Telegram, MCP server, kết nối agent (cài, bật / tắt, gỡ, cấu hình).
 * Mở từ thanh bên chat (không có trên thanh biểu tượng). `/connectors`, `/agents` cũ chuyển hướng về đây.
 */
export const pluginsFeature: FeatureDefinition = {
  id: 'plugins',
  titleKey: 'title',
  icon: Plug,
  route: `${PLUGINS_ROUTE}/*`,
  roles: [],
  component: PluginsRoute,
  i18n: { vi, en },
  nav: false,
  setup: setupPlugins
}
