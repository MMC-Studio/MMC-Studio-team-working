import { describe, expect, it } from 'vitest'
import type { AgentServerStatus, McpServerInfo } from '@shared/agents'
import type { GmailStatus, TelegramStatus } from '@shared/connectors'
import type { SkillInfo } from '@shared/skills'
import { buildPlugins, filterPlugins, type PluginSources } from '../model'

const skill = (name: string, source: 'user' | 'builtin', enabled = true): SkillInfo => ({
  name,
  description: `mô tả ${name}`,
  source,
  enabled,
  files: ['SKILL.md'],
  themes: []
})
const gmail = (extra: Partial<GmailStatus> = {}): GmailStatus => ({
  enabled: false,
  configured: false,
  adding: false,
  testingMode: false,
  clientId: null,
  accounts: [],
  ...extra
})
const telegram = (extra: Partial<TelegramStatus> = {}): TelegramStatus =>
  ({ enabled: false, configured: false, connection: 'disconnected', account: null, connectedAt: null, mode: 'allow', allow: [], block: [], apiId: null, ...extra }) as TelegramStatus
const agents = (extra: Partial<AgentServerStatus> = {}): AgentServerStatus =>
  ({ enabled: false, running: false, url: null, port: 0, error: null, armed: false, limits: { perHour: 20, concurrency: 1 }, clients: [], pending: [], ...extra }) as AgentServerStatus
const mcp = (id: string, enabled = true): McpServerInfo => ({
  id,
  name: `srv-${id}`,
  type: 'stdio',
  command: 'npx',
  args: ['x'],
  url: null,
  enabled,
  secretKeys: [],
  alwaysAllow: [],
  origin: null
})
const src = (extra: Partial<PluginSources> = {}): PluginSources => ({
  skills: [skill('bao-cao', 'user'), skill('my-style', 'user'), skill('study-tutor', 'builtin')],
  gmail: gmail(),
  telegram: telegram(),
  agents: agents(),
  mcp: [],
  ...extra
})

describe('buildPlugins', () => {
  it('chưa bật gì: skill người dùng ở "Của bạn" (bỏ my-style), skill có sẵn riêng, kết nối ở Gợi ý', () => {
    const g = buildPlugins(src())
    expect(g.yours.map((x) => x.key)).toEqual(['skill:bao-cao'])
    expect(g.builtin.map((x) => x.key)).toEqual(['builtin:study-tutor'])
    expect(g.suggestions.map((x) => x.key)).toEqual(['gmail', 'telegram', 'agents'])
    expect(g.builtin[0]).toMatchObject({ toggleable: false, removable: false, enabled: true })
  })

  it('bật / đã cấu hình → lên "Của bạn"; cần chú ý khi Gmail hết hạn, Telegram chưa đăng nhập, agent chờ duyệt', () => {
    const g = buildPlugins(
      src({
        gmail: gmail({
          enabled: true,
          accounts: [{ id: 'a', email: 'x@y', label: '', enabled: true, connection: 'expired', connectedAt: 1, expiresAt: 1, skipSensitive: true, blockedSenders: [] }]
        }),
        telegram: telegram({ enabled: true, connection: 'code_sent' }),
        agents: agents({ enabled: true, pending: [{ clientId: 'c', name: 'CC', at: 1 }] }),
        mcp: [mcp('1', false)]
      })
    )
    expect(g.suggestions).toEqual([])
    const by = Object.fromEntries(g.yours.map((x) => [x.key, x]))
    expect(by.gmail).toMatchObject({ attention: true, meta: { accounts: 1 }, confirmEnable: true, removable: false })
    expect(by.telegram).toMatchObject({ attention: true, meta: { connected: false } })
    expect(by.agents).toMatchObject({ attention: true })
    expect(by['mcp:1']).toMatchObject({ enabled: false, confirmEnable: false, removable: true, meta: { source: 'npx x' } })
  })

  it('đã tắt nhưng còn tài khoản / phiên / agent → vẫn ở "Của bạn" (để cấu hình hoặc gỡ)', () => {
    const g = buildPlugins(
      src({
        gmail: gmail({ accounts: [{ id: 'a', email: 'x@y', label: '', enabled: true, connection: 'connected', connectedAt: 1, expiresAt: null, skipSensitive: true, blockedSenders: [] }] }),
        telegram: telegram({ connection: 'connected' }),
        agents: agents({ clients: [{ id: 'c' } as AgentServerStatus['clients'][number]] })
      })
    )
    expect(g.yours.map((x) => x.key)).toEqual(['gmail', 'telegram', 'agents', 'skill:bao-cao'])
    // Đang tắt thì không tính "cần chú ý".
    expect(g.yours.every((x) => !x.attention)).toBe(true)
  })

  it('MCP server từ kho: bật = xem danh sách công cụ, không gỡ lẻ (gỡ cả plugin), tự tắt vì đổi → cần chú ý', () => {
    const origin = { pluginKey: 'k#p', pluginName: 'p', server: 's', sha: 'a', host: 'mcp.ok.dev', headers: [], approvedTools: 1, review: null }
    const g = buildPlugins(
      src({
        mcp: [
          { ...mcp('a'), type: 'http', url: 'https://mcp.ok.dev/mcp', origin },
          { ...mcp('b', false), type: 'http', url: 'https://mcp.ok.dev/mcp', origin: { ...origin, review: 'tools' } }
        ]
      })
    )
    const a = g.yours.find((x) => x.key === 'mcp:a')!
    const b = g.yours.find((x) => x.key === 'mcp:b')!
    expect(a).toMatchObject({ reviewEnable: true, removable: false, attention: false, meta: { source: 'mcp.ok.dev · p' } })
    expect(b).toMatchObject({ reviewEnable: true, attention: true, enabled: false })
    expect(g.yours.find((x) => x.key === 'mcp:x')).toBeUndefined()
    expect(buildPlugins(src({ mcp: [mcp('c')] })).yours.find((x) => x.key === 'mcp:c')).toMatchObject({ reviewEnable: false, removable: true })
  })

  it('nguồn chưa tải (null) thì bỏ qua', () => {
    const g = buildPlugins({ skills: null, gmail: null, telegram: null, agents: null, mcp: null })
    expect(g).toEqual({ yours: [], builtin: [], suggestions: [] })
  })
})

describe('filterPlugins', () => {
  const g = buildPlugins(src({ skills: [skill('bao-cao', 'user'), skill('slide', 'user', false)], mcp: [mcp('1')] }))
  const label = (x: { name: string; description: string }): string => `${x.name} ${x.description}`

  it('tab Kết nối / Skill', () => {
    expect(filterPlugins(g.yours, { tab: 'connectors', status: 'all', text: '' }, label).map((x) => x.key)).toEqual(['mcp:1'])
    expect(filterPlugins(g.yours, { tab: 'skills', status: 'all', text: '' }, label).map((x) => x.key)).toEqual(['skill:bao-cao', 'skill:slide'])
  })

  it('trạng thái Đang bật / Đang tắt', () => {
    expect(filterPlugins(g.yours, { tab: 'all', status: 'off', text: '' }, label).map((x) => x.key)).toEqual(['skill:slide'])
    expect(filterPlugins(g.yours, { tab: 'all', status: 'on', text: '' }, label).map((x) => x.key)).toEqual(['mcp:1', 'skill:bao-cao'])
    expect(filterPlugins(g.yours, { tab: 'all', status: 'attention', text: '' }, label)).toEqual([])
  })

  it('ô tìm không dấu, mọi từ phải khớp', () => {
    expect(filterPlugins(g.yours, { tab: 'all', status: 'all', text: 'MO TA bao' }, label).map((x) => x.key)).toEqual(['skill:bao-cao'])
    expect(filterPlugins(g.yours, { tab: 'all', status: 'all', text: 'bao khong' }, label)).toEqual([])
  })
})
