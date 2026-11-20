import type { AgentServerStatus, McpServerInfo } from '@shared/agents'
import type { GmailStatus, TelegramStatus } from '@shared/connectors'
import { STYLE_SKILL, type SkillInfo } from '@shared/skills'
import { matchesAllWords } from '@shared/text'

/**
 * Trang Plugin gom MỘT chỗ mọi thứ cài / kết nối thêm cho trợ lý: skill, Gmail, Telegram, MCP server, kết nối agent.
 * Hàm ở đây thuần (không gọi IPC) để test được: dựng danh sách từ trạng thái các store, lọc theo tab / trạng thái / ô tìm.
 */

export const PLUGINS_ROUTE = '/plugins'

export type PluginTab = 'all' | 'connectors' | 'skills'
export type PluginStatusFilter = 'all' | 'on' | 'off' | 'attention'
export type PluginType = 'gmail' | 'telegram' | 'agents' | 'mcp' | 'skill' | 'builtinSkill'

export type PluginItem = {
  /** Khoá duy nhất trên trang (vd `gmail`, `mcp:<id>`, `skill:<tên>`). */
  key: string
  type: PluginType
  kind: 'connector' | 'skill'
  name: string
  /** Mô tả một dòng (skill: description; kết nối: lấy từ i18n theo `type`). */
  description: string
  enabled: boolean
  /** Cần người dùng làm gì đó (Gmail hết hạn, Telegram chưa đăng nhập xong, agent chờ duyệt / lỗi). */
  attention: boolean
  /** Dữ liệu cho dòng phụ "loại · nguồn" (số tài khoản, lệnh MCP, nơi cài skill…). */
  meta: { accounts?: number; clients?: number; connected?: boolean; source?: string }
  /** Trang chi tiết (cấu hình). */
  href: string
  /** Bật/tắt được ở menu ⋯ (skill có sẵn luôn bật → không). */
  toggleable: boolean
  /** Gỡ được ở menu ⋯ (skill người dùng, MCP server) — qua hộp xác nhận. Tài khoản Gmail / đăng xuất Telegram: ở trang chi tiết, bấm hai lần. */
  removable: boolean
  /** Bật cần qua hộp cảnh báo (giống chữ cảnh báo cạnh công tắc cũ). */
  confirmEnable: boolean
}

export type PluginSources = {
  skills: SkillInfo[] | null
  gmail: GmailStatus | null
  telegram: TelegramStatus | null
  agents: AgentServerStatus | null
  mcp: McpServerInfo[] | null
}

export type PluginGroups = {
  /** Đã cài / đã cấu hình / đang bật. */
  yours: PluginItem[]
  /** Skill đi kèm app (luôn bật, chỉ xem). */
  builtin: PluginItem[]
  /** App hỗ trợ sẵn nhưng chưa dùng. */
  suggestions: PluginItem[]
}

const connector = (
  type: 'gmail' | 'telegram' | 'agents',
  name: string,
  enabled: boolean,
  attention: boolean,
  meta: PluginItem['meta']
): PluginItem => ({
  key: type,
  type,
  kind: 'connector',
  name,
  description: '',
  enabled,
  attention,
  meta,
  href: `${PLUGINS_ROUTE}/${type}`,
  toggleable: true,
  removable: false,
  confirmEnable: true
})

/** Dựng các nhóm từ trạng thái hiện có. Nguồn chưa tải (null) thì bỏ qua — trang tự cập nhật khi có. */
export function buildPlugins(src: PluginSources): PluginGroups {
  const yours: PluginItem[] = []
  const suggestions: PluginItem[] = []
  const builtin: PluginItem[] = []

  if (src.gmail) {
    const g = src.gmail
    const item = connector('gmail', 'Gmail', g.enabled, g.enabled && g.accounts.some((a) => a.connection === 'expired'), {
      accounts: g.accounts.length
    })
    ;(g.enabled || g.accounts.length > 0 ? yours : suggestions).push(item)
  }
  if (src.telegram) {
    const tg = src.telegram
    const connected = tg.connection === 'connected'
    const item = connector('telegram', 'Telegram', tg.enabled, tg.enabled && !connected, { connected })
    ;(tg.enabled || connected ? yours : suggestions).push(item)
  }
  if (src.agents) {
    const a = src.agents
    const item = connector('agents', '', a.enabled, a.enabled && (!!a.error || a.pending.length > 0), {
      clients: a.clients.length
    })
    ;(a.enabled || a.clients.length > 0 ? yours : suggestions).push(item)
  }
  for (const s of src.mcp ?? []) {
    yours.push({
      key: `mcp:${s.id}`,
      type: 'mcp',
      kind: 'connector',
      name: s.name,
      description: '',
      enabled: s.enabled,
      attention: false,
      meta: { source: s.type === 'stdio' ? [s.command, ...s.args].filter(Boolean).join(' ') : (s.url ?? '') },
      href: `${PLUGINS_ROUTE}/mcp?id=${s.id}`,
      toggleable: true,
      removable: true,
      confirmEnable: false
    })
  }
  for (const s of src.skills ?? []) {
    if (s.source === 'user' && s.name === STYLE_SKILL) continue // my-style ở Cài đặt › Trợ lý của bạn
    const user = s.source === 'user'
    const item: PluginItem = {
      key: `${user ? 'skill' : 'builtin'}:${s.name}`,
      type: user ? 'skill' : 'builtinSkill',
      kind: 'skill',
      name: s.name,
      description: s.description,
      enabled: user ? s.enabled : true,
      attention: false,
      meta: { source: s.origin },
      href: `${PLUGINS_ROUTE}/skill/${user ? 'user' : 'builtin'}/${encodeURIComponent(s.name)}`,
      toggleable: user,
      removable: user,
      confirmEnable: false
    }
    ;(user ? yours : builtin).push(item)
  }
  return { yours, builtin, suggestions }
}

export type PluginQuery = { tab: PluginTab; status: PluginStatusFilter; text: string }

/** Lọc một nhóm theo tab (Kết nối / Skill), trạng thái và ô tìm (không dấu, mọi từ phải khớp). */
export function filterPlugins(items: PluginItem[], q: PluginQuery, label: (item: PluginItem) => string): PluginItem[] {
  return items.filter((item) => {
    if (q.tab === 'connectors' && item.kind !== 'connector') return false
    if (q.tab === 'skills' && item.kind !== 'skill') return false
    if (q.status === 'on' && !item.enabled) return false
    if (q.status === 'off' && item.enabled) return false
    if (q.status === 'attention' && !item.attention) return false
    return !q.text.trim() || matchesAllWords(label(item), q.text)
  })
}
