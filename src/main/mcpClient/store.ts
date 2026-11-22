import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { McpServerInfo, McpStoreOrigin } from '@shared/agents'
import { mcpServerInputSchema, type McpServerInput } from '@shared/schemas'
import type { Encryptor } from '../services/secrets'
import type { ProxyTarget } from './proxy'

/** Tên bị app dùng riêng — server của người dùng không được trùng. */
export const RESERVED_NAMES = ['mmc', 'twperm', 'mizuki']

const storedSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(['stdio', 'http']),
    command: z.string().nullable(),
    args: z.array(z.string()),
    url: z.string().nullable(),
    enabled: z.boolean(),
    secretKeys: z.array(z.string()),
    alwaysAllow: z.array(z.string()),
    // Server cài từ kho plugin (8b). approvedTools: tên tool → dấu (tên + mô tả + tham số) lúc người dùng duyệt.
    origin: z
      .object({
        pluginKey: z.string(),
        pluginName: z.string(),
        server: z.string(),
        sha: z.string(),
        host: z.string(),
        headers: z.array(z.object({ key: z.string(), template: z.string() })),
        approvedTools: z.record(z.string(), z.string()).nullable(),
        review: z.enum(['first', 'url', 'tools']).nullable()
      })
      .nullable()
      .default(null)
  })
)
type Stored = z.infer<typeof storedSchema>[number]
type StoredOrigin = NonNullable<Stored['origin']>

/** MCP server HTTP khai báo trong plugin, người dùng đã tick xác nhận lúc cài. */
export type StoreServerDecl = { server: string; url: string; host: string; headers: { key: string; template: string }[] }

type Secrets = Record<string, { env: Record<string, string>; headers: Record<string, string> }>

export type SettingsPort = { get(): unknown; set(list: unknown): void }

/** Cấu hình server cho Claude CLI (--mcp-config). */
export type CliServerEntry =
  | { command: string; args: string[]; env: Record<string, string> }
  | { type: 'http'; url: string; headers: Record<string, string> }

const publicOrigin = (o: StoredOrigin | null): McpStoreOrigin | null =>
  o && {
    pluginKey: o.pluginKey,
    pluginName: o.pluginName,
    server: o.server,
    sha: o.sha,
    host: o.host,
    headers: o.headers,
    approvedTools: o.approvedTools ? Object.keys(o.approvedTools).length : null,
    review: o.review
  }

/**
 * MCP server do người dùng thêm, hoặc cài từ kho plugin (8b). Cấu hình thường nằm trong bảng settings; giá trị bí mật
 * (biến môi trường, header — vd token) mã hoá bằng Windows DPAPI trong `secrets/mcp-servers.bin`, không bao giờ
 * trả về renderer (renderer chỉ thấy tên khoá).
 */
export class McpServerStore {
  private readonly file: string
  /** Server từ kho đang được lượt chat nào nạp (gỡ plugin → dừng đúng lượt đang dùng). */
  private active = new Map<string, Set<string>>()

  constructor(
    private readonly settings: SettingsPort,
    secretsDir: string,
    private readonly crypto: Encryptor
  ) {
    this.file = join(secretsDir, 'mcp-servers.bin')
  }

  private raw(): Stored[] {
    const parsed = storedSchema.safeParse(this.settings.get())
    return parsed.success ? parsed.data : []
  }

  private write(list: Stored[]): void {
    this.settings.set(list)
  }

  list(): McpServerInfo[] {
    return this.raw().map((s) => ({ ...s, origin: publicOrigin(s.origin) }))
  }

  /** Thêm / sửa server tự thêm. Giá trị bí mật để trống = giữ giá trị cũ của khoá đó. */
  save(input: McpServerInput): McpServerInfo {
    const data = mcpServerInputSchema.parse(input)
    if (RESERVED_NAMES.includes(data.name)) throw new Error('reserved_name')
    const list = this.raw()
    if (list.some((s) => s.name === data.name && s.id !== data.id)) throw new Error('duplicate_name')
    // Server từ kho: URL / tên cố định theo plugin; header nhập qua setStoreHeaders.
    if (data.id && list.find((s) => s.id === data.id)?.origin) throw new Error('store_server')
    if (!this.crypto.isEncryptionAvailable() && (Object.keys(data.env).length || Object.keys(data.headers).length)) {
      throw new Error('secure_storage_unavailable')
    }
    const id = data.id ?? randomUUID()
    const old = list.find((s) => s.id === id)
    const secrets = this.readSecrets()
    const prev = secrets[id] ?? { env: {}, headers: {} }
    const merge = (next: Record<string, string>, before: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v === '' ? (before[k] ?? '') : v]).filter(([, v]) => v !== ''))
    secrets[id] = { env: merge(data.env, prev.env), headers: merge(data.headers, prev.headers) }
    this.writeSecrets(secrets)

    const info: Stored = {
      id,
      name: data.name,
      type: data.type,
      command: data.type === 'stdio' ? data.command : null,
      args: data.type === 'stdio' ? data.args : [],
      url: data.type === 'http' ? data.url : null,
      enabled: data.enabled,
      secretKeys: [...Object.keys(secrets[id].env), ...Object.keys(secrets[id].headers)],
      // Đổi tên server thì quyền "luôn cho phép" cũ không còn đúng tên tool → bỏ.
      alwaysAllow: old && old.name === data.name ? old.alwaysAllow : [],
      origin: null
    }
    this.write(old ? list.map((s) => (s.id === id ? info : s)) : [...list, info])
    return { ...info, origin: null }
  }

  remove(id: string): void {
    this.write(this.raw().filter((s) => s.id !== id))
    const secrets = this.readSecrets()
    delete secrets[id]
    this.writeSecrets(secrets)
  }

  /** Server từ kho chỉ bật được qua bước xem danh sách tool (`approveTools`) — bật thẳng → needs_review. */
  setEnabled(id: string, enabled: boolean): void {
    const s = this.raw().find((x) => x.id === id)
    if (enabled && s?.origin && (!s.origin.approvedTools || s.origin.review)) throw new Error('needs_review')
    this.write(this.raw().map((x) => (x.id === id ? { ...x, enabled } : x)))
  }

  /** "Luôn cho phép": KHÔNG áp dụng cho server từ kho (mỗi lần gọi đều duyệt). */
  allowAlways(server: string, tool: string): void {
    this.write(this.raw().map((s) => (s.name === server && !s.origin && !s.alwaysAllow.includes(tool) ? { ...s, alwaysAllow: [...s.alwaysAllow, tool] } : s)))
  }

  revokeAlways(id: string, tool: string): void {
    this.write(this.raw().map((s) => (s.id === id ? { ...s, alwaysAllow: s.alwaysAllow.filter((t) => t !== tool) } : s)))
  }

  isUserServer(name: string): boolean {
    return this.raw().some((s) => s.name === name)
  }

  /** Server từ kho → tên miền + plugin (thẻ duyệt hiện tên miền chữ to, ẩn "luôn cho phép"). */
  originOf(name: string): { host: string; pluginName: string } | null {
    const o = this.raw().find((s) => s.name === name)?.origin
    return o ? { host: o.host, pluginName: o.pluginName } : null
  }

  // ---- Server từ kho plugin (8b) ----

  forPlugin(pluginKey: string): (StoreServerDecl & { id: string; name: string })[] {
    return this.raw().flatMap((s) =>
      s.origin?.pluginKey === pluginKey ? [{ id: s.id, name: s.name, server: s.origin.server, url: s.url ?? '', host: s.origin.host, headers: s.origin.headers }] : []
    )
  }

  /**
   * Cài / cập nhật server của một plugin: server mới → TẮT, chờ duyệt lần đầu; đổi URL / tên miền → tắt + duyệt lại;
   * server không còn trong danh sách → gỡ (kèm bí mật). Trả tên (trong app) của các server còn lại.
   */
  syncPlugin(plugin: { key: string; name: string; sha: string }, decls: StoreServerDecl[]): string[] {
    const list = this.raw()
    const secrets = this.readSecrets()
    const keep: Stored[] = []
    const names: string[] = []
    for (const s of list) {
      if (s.origin?.pluginKey !== plugin.key) keep.push(s)
      else if (!decls.some((d) => d.server === s.origin!.server)) delete secrets[s.id]
    }
    for (const d of decls) {
      const old = list.find((s) => s.origin?.pluginKey === plugin.key && s.origin.server === d.server)
      if (old?.origin) {
        const moved = old.url !== d.url || old.origin.host !== d.host
        const origin: StoredOrigin = {
          ...old.origin,
          pluginName: plugin.name,
          sha: plugin.sha,
          host: d.host,
          headers: d.headers,
          approvedTools: moved ? null : old.origin.approvedTools,
          review: moved ? (old.origin.approvedTools ? 'url' : 'first') : old.origin.review
        }
        // Header bỏ khỏi gói → bỏ giá trị đã lưu.
        const sec = secrets[old.id]
        if (sec) sec.headers = Object.fromEntries(Object.entries(sec.headers).filter(([k]) => d.headers.some((h) => h.key === k)))
        keep.push({ ...old, url: d.url, enabled: moved ? false : old.enabled, secretKeys: Object.keys(sec?.headers ?? {}), origin })
        names.push(old.name)
        continue
      }
      const name = uniqueName(`${plugin.name}-${d.server}`, [...keep.map((s) => s.name), ...names])
      keep.push({
        id: randomUUID(),
        name,
        type: 'http',
        command: null,
        args: [],
        url: d.url,
        enabled: false,
        secretKeys: [],
        alwaysAllow: [],
        origin: { pluginKey: plugin.key, pluginName: plugin.name, server: d.server, sha: plugin.sha, host: d.host, headers: d.headers, approvedTools: null, review: 'first' }
      })
      names.push(name)
    }
    this.writeSecrets(secrets)
    this.write(keep)
    return names
  }

  /** Gỡ plugin: xoá mọi server của nó + bí mật. Trả tên + id đã xoá. */
  removePlugin(pluginKey: string): { id: string; name: string }[] {
    const list = this.raw()
    const gone = list.filter((s) => s.origin?.pluginKey === pluginKey)
    if (gone.length === 0) return []
    const secrets = this.readSecrets()
    for (const s of gone) delete secrets[s.id]
    this.writeSecrets(secrets)
    this.write(list.filter((s) => s.origin?.pluginKey !== pluginKey))
    return gone.map((s) => ({ id: s.id, name: s.name }))
  }

  /** Nhập header bí mật cho server từ kho — chỉ các khoá plugin khai báo. Giá trị trống = giữ giá trị cũ. */
  setStoreHeaders(id: string, headers: Record<string, string>): McpServerInfo {
    const list = this.raw()
    const s = list.find((x) => x.id === id)
    if (!s?.origin) throw new Error('not_found')
    if (!this.crypto.isEncryptionAvailable()) throw new Error('secure_storage_unavailable')
    const secrets = this.readSecrets()
    const prev = secrets[id]?.headers ?? {}
    const next: Record<string, string> = {}
    for (const { key } of s.origin.headers) {
      const v = (headers[key] ?? '').trim()
      if (v) next[key] = v
      else if (prev[key]) next[key] = prev[key]
    }
    secrets[id] = { env: {}, headers: next }
    this.writeSecrets(secrets)
    const info: Stored = { ...s, secretKeys: Object.keys(next) }
    this.write(list.map((x) => (x.id === id ? info : x)))
    return { ...info, origin: publicOrigin(info.origin) }
  }

  /** Thông tin để kết nối xem danh sách tool lúc bật lần đầu (thiếu header bắt buộc → missing). */
  reviewTarget(id: string): { url: string; host: string; secretHeaders: Record<string, string>; needsHeaders: boolean; missing: string[] } | null {
    const s = this.raw().find((x) => x.id === id)
    if (!s?.origin || !s.url) return null
    const secretHeaders = this.readSecrets()[id]?.headers ?? {}
    const keys = s.origin.headers.map((h) => h.key)
    return { url: s.url, host: s.origin.host, secretHeaders, needsHeaders: keys.length > 0, missing: keys.filter((k) => !secretHeaders[k]) }
  }

  /** Dấu đã duyệt lần trước (để đánh dấu tool nào đổi khi xem lại). */
  approvedHashes(id: string): Record<string, string> | null {
    return this.raw().find((s) => s.id === id)?.origin?.approvedTools ?? null
  }

  /** Người dùng đã xem danh sách tool và bấm Bật → lưu dấu từng tool, bật server. */
  approveTools(id: string, hashes: Record<string, string>): void {
    this.write(this.raw().map((s) => (s.id === id && s.origin ? { ...s, enabled: true, origin: { ...s.origin, approvedTools: hashes, review: null } } : s)))
  }

  /** Proxy thấy danh sách tool đổi → tắt server, chờ xác nhận lại. */
  markToolsChanged(id: string): void {
    this.write(this.raw().map((s) => (s.id === id && s.origin ? { ...s, enabled: false, origin: { ...s.origin, review: 'tools' } } : s)))
  }

  /** Cho proxy: server từ kho đang bật + đã duyệt. */
  proxyTarget(id: string): ProxyTarget | null {
    const s = this.raw().find((x) => x.id === id)
    if (!s?.origin || !s.enabled || !s.url || !s.origin.approvedTools || s.origin.review) return null
    return { url: s.url, host: s.origin.host, secretHeaders: this.readSecrets()[id]?.headers ?? {}, approved: s.origin.approvedTools }
  }

  /** Lượt chat đang nạp server `id`. */
  conversationsUsing(id: string): string[] {
    return [...this.active].filter(([, ids]) => ids.has(id)).map(([c]) => c)
  }

  endRun(conversationId: string): void {
    this.active.delete(conversationId)
  }

  /**
   * Server đang bật → cấu hình cho CLI + tool tự duyệt ("luôn cho phép", chỉ server tự thêm).
   * Server từ kho: CLI chỉ nhận địa chỉ proxy cục bộ (`endpoint`), không thấy URL thật / header; chưa duyệt tool
   * hoặc proxy chưa chạy → không nạp.
   */
  forCli(
    endpoint: ((id: string) => { url: string; headers: Record<string, string> } | null) | null = null,
    conversationId?: string
  ): { servers: Record<string, CliServerEntry>; allowedTools: string[] } | null {
    const enabled = this.raw().filter((s) => s.enabled)
    const secrets = this.readSecrets()
    const servers: Record<string, CliServerEntry> = {}
    const used = new Set<string>()
    for (const s of enabled) {
      if (s.origin) {
        const ep = endpoint && s.origin.approvedTools && !s.origin.review ? endpoint(s.id) : null
        if (!ep) continue
        servers[s.name] = { type: 'http', url: ep.url, headers: ep.headers }
        used.add(s.id)
        continue
      }
      const sec = secrets[s.id] ?? { env: {}, headers: {} }
      servers[s.name] = s.type === 'stdio' ? { command: s.command ?? '', args: s.args, env: sec.env } : { type: 'http', url: s.url ?? '', headers: sec.headers }
    }
    if (Object.keys(servers).length === 0) return null
    if (conversationId && used.size) this.active.set(conversationId, used)
    const allowedTools = enabled.filter((s) => !s.origin).flatMap((s) => s.alwaysAllow.map((t) => `mcp__${s.name}__${t}`))
    return { servers, allowedTools }
  }

  private readSecrets(): Secrets {
    if (!existsSync(this.file) || !this.crypto.isEncryptionAvailable()) return {}
    try {
      return JSON.parse(this.crypto.decryptString(readFileSync(this.file))) as Secrets
    } catch {
      return {}
    }
  }

  private writeSecrets(secrets: Secrets): void {
    if (!this.crypto.isEncryptionAvailable()) return
    writeFileSync(this.file, this.crypto.encryptString(JSON.stringify(secrets)))
  }
}

/** Tên server trong app từ tên plugin + server: chữ thường, số, gạch; không trùng tên đã có / tên app dành riêng. */
export function uniqueName(base: string, taken: string[]): string {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 28)
      .replace(/-$/, '') || 'mcp'
  const used = new Set([...taken, ...RESERVED_NAMES])
  if (!used.has(clean)) return clean
  for (let i = 2; ; i++) if (!used.has(`${clean}-${i}`)) return `${clean}-${i}`
}
