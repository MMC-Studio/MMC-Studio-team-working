import { useParams } from 'react-router'
import { PluginDetail } from './PluginDetail'
import { PluginsPage } from './PluginsPage'

/** `/plugins` → danh sách; `/plugins/<mục>/…` → trang cấu hình của mục đó. */
export function PluginsRoute() {
  const path = (useParams()['*'] ?? '').split('/').filter(Boolean)
  return path.length ? <PluginDetail key={path.join('/')} path={path} /> : <PluginsPage />
}
