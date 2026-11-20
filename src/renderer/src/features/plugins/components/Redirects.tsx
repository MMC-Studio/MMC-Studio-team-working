import { Navigate } from 'react-router'
import { PLUGINS_ROUTE } from '../model'

/** Trang cũ `/agents` (Kết nối agent + MCP) → trang Plugin. Link cũ (thông báo, thẻ trong chat) vẫn chạy. */
export function AgentsRedirect() {
  return <Navigate to={`${PLUGINS_ROUTE}/agents`} replace />
}

/** Trang cũ `/connectors` (Gmail & Telegram) → trang Plugin, tab Kết nối. */
export function ConnectorsRedirect() {
  return <Navigate to={`${PLUGINS_ROUTE}?tab=connectors`} replace />
}
