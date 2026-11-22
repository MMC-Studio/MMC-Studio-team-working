import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpServerStore } from '../../mcpClient/store'
import { GitHubClient } from '../github'
import { isPinnedCommand, parseMcpEntry } from '../inspect'
import { PluginStoreService, type InstalledRecord } from '../service'

// Kho plugin 8b: MCP server khai báo trong plugin — xem trước, chỉ cài server HTTPS người dùng tick, cập nhật, gỡ.
const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'base64').toString()
}
const log = { info: () => {}, warn: () => {} }
const skillMd = (name: string) => `---\nname: ${name}\ndescription: Skill ${name}\n---\nNội dung\n`

describe('đọc khai báo MCP', () => {
  it('https → cài được; http / sse / URL có biến / sai → không hỗ trợ kèm lý do; header → cần token', () => {
    expect(parseMcpEntry('a', { type: 'http', url: 'https://mcp.a.dev/mcp' })).toMatchObject({ kind: 'http', host: 'mcp.a.dev', reason: null, auth: 'unknown' })
    expect(parseMcpEntry('gh', { type: 'http', url: 'https://api.gh.dev/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' } })).toMatchObject({
      kind: 'http',
      auth: 'token',
      headers: [{ key: 'Authorization', template: 'Bearer ${GITHUB_TOKEN}' }]
    })
    expect(parseMcpEntry('b', { url: 'http://mcp.b.dev/mcp' })).toMatchObject({ kind: 'unsupported', reason: 'not_https', host: 'mcp.b.dev' })
    expect(parseMcpEntry('c', { type: 'sse', url: 'https://c.dev/sse' })).toMatchObject({ kind: 'unsupported', reason: 'sse' })
    expect(parseMcpEntry('d', { url: 'http://127.0.0.1:${PORT:-1}/mcp' })).toMatchObject({ reason: 'variables' })
    expect(parseMcpEntry('e', { url: 'https://user:pw@e.dev/mcp' })).toMatchObject({ reason: 'bad_url' })
    expect(parseMcpEntry('f', { url: 'http://127.0.0.1:5/mcp' })).toMatchObject({ reason: 'not_https' })
    expect(parseMcpEntry('f', { url: 'http://127.0.0.1:5/mcp' }, true)).toMatchObject({ kind: 'http' })
    expect(parseMcpEntry('g', { command: 'npx', args: ['-y', '@scope/srv@1.2.3'] })).toMatchObject({ kind: 'stdio', command: 'npx -y @scope/srv@1.2.3', pinned: true })
    expect(parseMcpEntry('h', { command: 'npx', args: ['-y', 'srv'] })).toMatchObject({ kind: 'stdio', pinned: false })
    expect(parseMcpEntry('x', 'rác')).toBeNull()
  })

  it('lệnh khoá phiên bản', () => {
    expect(isPinnedCommand('npx', ['-y', 'pkg@1.0.0'])).toBe(true)
    expect(isPinnedCommand('npx', ['pkg@latest'])).toBe(false)
    expect(isPinnedCommand('npx.cmd', ['@a/b@2.3.4-beta.1'])).toBe(true)
    expect(isPinnedCommand('uvx', ['mcp-server==0.4.1'])).toBe(true)
    expect(isPinnedCommand('uvx', ['--from', 'git+https://x', 'srv'])).toBe(false)
    expect(isPinnedCommand('uvx', ['mcp-server'])).toBe(false)
    expect(isPinnedCommand('pnpm', ['dlx', 'pkg@1.2.3'])).toBe(true)
    expect(isPinnedCommand('docker', ['run', '-i', `ghcr.io/x/y@sha256:${'f'.repeat(64)}`])).toBe(true)
    expect(isPinnedCommand('docker', ['run', '-i', 'ghcr.io/x/y:latest'])).toBe(false)
    expect(isPinnedCommand('bun', ['run', 'server.ts'])).toBe(false)
  })
})

describe('PluginStoreService + MCP', () => {
  let dir: string
  let secretsDir: string
  let mcpList: unknown
  let mcp: McpServerStore
  let installed: InstalledRecord[]
  let store: PluginStoreService
  let zips: Map<string, Uint8Array>
  let marketplace: unknown
  const probe = vi.fn(async (url: string) => (url.includes('oauth') ? ('oauth' as const) : ('none' as const)))
  const removed: string[] = []

  const publish = (sha: string, files: Record<string, string>): void => {
    zips.set(sha, zipSync(Object.fromEntries(Object.entries(files).map(([p, c]) => [`kho-${sha}/${p}`, strToU8(c)]))))
    currentSha = sha
  }
  let currentSha = SHA1
  const fetchFake = async (url: string): Promise<Response> => {
    const u = new URL(url)
    if (u.host === 'api.github.com') return new Response(currentSha, { headers: { etag: `"${currentSha}"` } })
    if (u.host === 'raw.githubusercontent.com') return new Response(JSON.stringify(marketplace))
    const sha = /zip\/(\w+)$/.exec(u.pathname)![1]
    return new Response(Buffer.from(zips.get(sha)!))
  }

  const mcpJson = (servers: Record<string, unknown>) => JSON.stringify({ mcpServers: servers })
  const V1 = {
    'plugins/p/skills/s/SKILL.md': skillMd('s'),
    'plugins/p/.mcp.json': mcpJson({
      ok: { type: 'http', url: 'https://mcp.ok.dev/mcp' },
      gh: { type: 'http', url: 'https://api.gh.dev/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
      linear: { type: 'http', url: 'https://oauth.linear.dev/mcp' },
      plain: { url: 'http://plain.dev/mcp' },
      local: { command: 'npx', args: ['-y', 'srv'] }
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mmc-plugins-mcp-'))
    secretsDir = mkdtempSync(join(tmpdir(), 'mmc-secrets-'))
    mcpList = []
    installed = []
    zips = new Map()
    removed.length = 0
    probe.mockClear()
    marketplace = { plugins: [{ name: 'p', source: './plugins/p', description: 'P' }, { name: 'chi-mcp', source: './plugins/m', description: 'Chỉ MCP' }] }
    mcp = new McpServerStore({ get: () => mcpList, set: (l) => void (mcpList = l) }, secretsDir, crypto)
    store = new PluginStoreService({
      github: new GitHubClient(fetchFake as never, Date.now),
      dir,
      defaultSources: [{ repo: 'mmc/kho', ref: 'main' }],
      getUserSources: () => [],
      setUserSources: () => {},
      getInstalled: () => installed,
      setInstalled: (l) => void (installed = l),
      takenSkillNames: async () => ({ builtin: new Set(), user: new Set() }),
      forgetSkills: () => {},
      mcp: {
        forPlugin: (k) => mcp.forPlugin(k),
        syncPlugin: (p, d) => mcp.syncPlugin(p, d),
        removePlugin: (k) => {
          removed.push(k)
          mcp.removePlugin(k)
        }
      },
      probe,
      changed: () => {},
      now: Date.now,
      log
    })
    publish(SHA1, { ...V1, 'plugins/m/.claude-plugin/plugin.json': JSON.stringify({ name: 'chi-mcp', mcpServers: './cfg/mcp.json' }), 'plugins/m/cfg/mcp.json': mcpJson({ ctx: { type: 'http', url: 'https://ctx.dev/mcp' } }) })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(secretsDir, { recursive: true, force: true })
  })

  it('xem trước: từng server kèm loại / lý do; server không header được thử kết nối, đòi OAuth → ghi rõ; server có header không thử', async () => {
    const r = await store.preview('mmc/kho#p')
    if (r.status !== 'ok') throw new Error(r.error)
    const by = Object.fromEntries(r.preview.mcp.map((m) => [m.name, m]))
    expect(by.ok).toMatchObject({ kind: 'http', host: 'mcp.ok.dev', auth: 'none', change: null })
    expect(by.gh).toMatchObject({ kind: 'http', auth: 'token' })
    expect(by.linear).toMatchObject({ kind: 'http', auth: 'oauth' })
    expect(by.plain).toMatchObject({ kind: 'unsupported', reason: 'not_https' })
    expect(by.local).toMatchObject({ kind: 'stdio', command: 'npx -y srv', pinned: false })
    expect(probe.mock.calls.map((c) => c[0]).sort()).toEqual(['https://mcp.ok.dev/mcp', 'https://oauth.linear.dev/mcp'])
  })

  it('cài: CHỈ server https đã tick (bỏ OAuth / http / chạy lệnh / tên lạ); server TẮT sẵn, chờ duyệt lần đầu', async () => {
    const r = await store.preview('mmc/kho#p')
    if (r.status !== 'ok') throw new Error()
    const done = await store.install(r.preview.token, ['ok', 'gh', 'linear', 'plain', 'local', 'la'])
    expect(done).toMatchObject({ status: 'ok', plugin: { skills: ['s'], mcp: ['p-ok', 'p-gh'] } })
    expect(mcp.list().map((s) => [s.name, s.enabled, s.origin?.review])).toEqual([
      ['p-ok', false, 'first'],
      ['p-gh', false, 'first']
    ])
    expect(installed[0].mcp).toEqual(['ok', 'gh'])
  })

  it('plugin chỉ có MCP (đường dẫn trong plugin.json): xem trước được; không tick gì → không cài; tick → cài, không tạo thư mục', async () => {
    const r = await store.preview('mmc/kho#chi-mcp')
    if (r.status !== 'ok') throw new Error(r.error)
    expect(r.preview.skills).toEqual([])
    expect(r.preview.mcp).toMatchObject([{ name: 'ctx', kind: 'http', auth: 'none' }])
    expect(await store.install(r.preview.token, [])).toEqual({ status: 'error', error: 'no_skills' })
    const done = await store.install(r.preview.token, ['ctx'])
    expect(done).toMatchObject({ status: 'ok', plugin: { skills: [], mcp: ['chi-mcp-ctx'] } })
    expect(existsSync(join(dir, installed[0].dir))).toBe(false)
  })

  it('cập nhật: đổi URL / header được đánh dấu, server bị bỏ khỏi gói liệt kê để gỡ; đổi URL → tắt + duyệt lại; gỡ plugin → gỡ MCP', async () => {
    let r = await store.preview('mmc/kho#p')
    if (r.status !== 'ok') throw new Error()
    await store.install(r.preview.token, ['ok', 'gh'])
    const okId = mcp.list().find((s) => s.name === 'p-ok')!.id
    mcp.approveTools(okId, { echo: 'h' })
    publish(SHA2, {
      ...V1,
      'plugins/p/.mcp.json': mcpJson({ ok: { type: 'http', url: 'https://moved.ok.dev/mcp' }, ctx2: { type: 'http', url: 'https://ctx2.dev/mcp' } })
    })
    const fresh = new PluginStoreService({ ...(store as unknown as { deps: ConstructorParameters<typeof PluginStoreService>[0] }).deps })
    r = await fresh.preview('mmc/kho#p')
    if (r.status !== 'ok') throw new Error()
    expect(r.preview.mcp.map((m) => [m.name, m.change])).toEqual([
      ['ok', 'url_changed'],
      ['ctx2', 'added']
    ])
    expect(r.preview.update?.mcpRemoved).toEqual(['p-gh'])
    await fresh.install(r.preview.token, ['ok'])
    expect(mcp.list()).toMatchObject([{ id: okId, name: 'p-ok', url: 'https://moved.ok.dev/mcp', enabled: false, origin: { review: 'url', host: 'moved.ok.dev' } }])
    await fresh.uninstall('mmc/kho#p')
    expect(removed).toEqual(['mmc/kho#p'])
    expect(mcp.list()).toEqual([])
  })
})
