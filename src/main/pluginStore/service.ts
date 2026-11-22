import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import {
  CATALOG_CACHE_MS,
  MAX_USER_SOURCES,
  REF_RE,
  REPO_RE,
  REFRESH_MIN_MS,
  SHA_RE,
  parseRepo,
  type Catalog,
  type CatalogError,
  type CatalogPlugin,
  type CatalogSourceState,
  type FileChange,
  type InstalledPlugin,
  type PluginPreview,
  type PluginSourceInfo,
  type PluginStoreError,
  type ErrorDetail,
  type InstallResult,
  type PreviewResult
} from '@shared/pluginStore'
import { GitHubError, type GitHubClient } from './github'
import { InspectError, inspectArchive, sha256, type InspectedPlugin } from './inspect'
import { MARKETPLACE_PATH, parseMarketplace, type MarketplaceEntry } from './marketplace'

const PENDING_TTL_MS = 30 * 60 * 1000
const MAX_PENDING = 3

const sourceRecord = z.object({ repo: z.string().regex(REPO_RE), ref: z.string().regex(REF_RE), addedAt: z.number() })
export const userSourcesSchema = z.array(sourceRecord).max(MAX_USER_SOURCES)
export type UserSource = z.infer<typeof sourceRecord>

const installedRecord = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  sourceRepo: z.string(),
  location: z.object({ repo: z.string().regex(REPO_RE), path: z.string(), ref: z.string().nullable(), sha: z.string().regex(SHA_RE) }),
  license: z.string().nullable(),
  /** Thư mục trên đĩa (trong thư mục plugins). */
  dir: z.string().regex(/^[a-z0-9-]{1,80}$/),
  skills: z.array(z.string()),
  /** `<skill>/<đường dẫn>` → sha256. */
  files: z.record(z.string(), z.string()),
  installedAt: z.number(),
  updatedAt: z.number(),
  updateAvailable: z.string().nullable().default(null)
})
export const installedSchema = z.array(installedRecord).max(200)
export type InstalledRecord = z.infer<typeof installedRecord>

/** Skill của plugin đã cài — SkillStore đọc để hiện / chèn vào prompt (chỉ khi gọi đích danh). */
export type PluginSkillFile = {
  name: string
  dir: string
  pluginKey: string
  pluginName: string
  origin: string
  builtinSource: boolean
  /** File bị sửa / xoá ngoài app → không dùng. */
  modified: boolean
}

export type PluginStoreDeps = {
  github: GitHubClient
  /** Thư mục chứa plugin đã cài (`%APPDATA%/Team Working/plugins`). */
  dir: string
  /** Nguồn mặc định (resources/plugin-sources.json — đóng gói cùng app, chủ repo duyệt). */
  defaultSources: { repo: string; ref: string }[]
  getUserSources(): UserSource[]
  setUserSources(list: UserSource[]): void
  getInstalled(): InstalledRecord[]
  setInstalled(list: InstalledRecord[]): void
  /** Tên skill đã dùng: có sẵn / người dùng tự cài (không tính skill của plugin). */
  takenSkillNames(): Promise<{ builtin: Set<string>; user: Set<string> }>
  /** Gỡ cài đặt bật / tắt của các skill (gỡ plugin). */
  forgetSkills(names: string[]): void
  changed(): void
  now(): number
  log: { info(msg: string): void; warn(msg: string): void }
}

type CachedSource = { sha: string; fetchedAt: number; entries: MarketplaceEntry[] }
type Pending = { at: number; key: string; preview: PluginPreview; inspected: InspectedPlugin; record: Omit<InstalledRecord, 'installedAt' | 'updatedAt' | 'dir' | 'updateAvailable'> }

const keyOf = (sourceRepo: string, name: string): string => `${sourceRepo}#${name}`
/** Thư mục trên đĩa cho plugin: tên + 8 ký tự băm của khoá (2 nguồn cùng tên plugin không đè nhau). */
const dirOf = (key: string, name: string): string =>
  `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`

const catalogError = (e: unknown): { error: CatalogError; retryAt: number | null } =>
  e instanceof GitHubError
    ? { error: e.code === 'too_large' ? 'network' : e.code, retryAt: e.retryAt }
    : { error: 'network', retryAt: null }

/**
 * Kho plugin: nguồn (mặc định + tự thêm), danh mục, xem trước → cài theo commit SHA, cập nhật (xem lại như cài mới),
 * gỡ. Chỉ skill bằng chữ được cài; kiểm sha256 từng file để biết file bị sửa ngoài app.
 */
export class PluginStoreService {
  private cache = new Map<string, CachedSource>()
  private errors = new Map<string, { error: CatalogError; retryAt: number | null }>()
  private lastRefresh = 0
  private pending = new Map<string, Pending>()
  /** Token đang cài (chặn bấm hai lần cùng lúc). */
  private installing = new Set<string>()
  private modifiedCache: Map<string, boolean> | null = null

  constructor(private readonly deps: PluginStoreDeps) {}

  // ---- Nguồn ----

  sources(): PluginSourceInfo[] {
    const defaults = this.deps.defaultSources.map((s) => ({ repo: s.repo, ref: s.ref, builtin: true, addedAt: null }))
    const user = this.deps
      .getUserSources()
      .filter((s) => !defaults.some((d) => d.repo.toLowerCase() === s.repo.toLowerCase()))
      .map((s) => ({ repo: s.repo, ref: s.ref, builtin: false, addedAt: s.addedAt }))
    return [...defaults, ...user]
  }

  private isBuiltinSource(repo: string): boolean {
    return this.deps.defaultSources.some((d) => d.repo.toLowerCase() === repo.toLowerCase())
  }

  addSource(input: { repo: string; ref?: string }): { status: 'ok'; source: PluginSourceInfo } | { status: 'error'; error: PluginStoreError } {
    const repo = parseRepo(input.repo)
    if (!repo) return { status: 'error', error: 'unsupported_source' }
    if (this.sources().some((s) => s.repo.toLowerCase() === repo.toLowerCase())) return { status: 'error', error: 'source_exists' }
    const list = this.deps.getUserSources()
    if (list.length >= MAX_USER_SOURCES) return { status: 'error', error: 'too_many_sources' }
    const source: UserSource = { repo, ref: input.ref ?? 'HEAD', addedAt: this.deps.now() }
    this.deps.setUserSources([...list, source])
    this.deps.changed()
    return { status: 'ok', source: { ...source, builtin: false } }
  }

  /** Xoá nguồn người dùng thêm: plugin đã cài GIỮ LẠI (nhãn "nguồn đã bị xoá", không cập nhật được). */
  removeSource(repo: string): { status: 'ok' } | { status: 'error'; error: PluginStoreError } {
    if (this.isBuiltinSource(repo)) return { status: 'error', error: 'builtin_source' }
    this.deps.setUserSources(this.deps.getUserSources().filter((s) => s.repo.toLowerCase() !== repo.toLowerCase()))
    this.cache.delete(repo)
    this.errors.delete(repo)
    this.deps.changed()
    return { status: 'ok' }
  }

  private sourceExists(repo: string): boolean {
    return this.sources().some((s) => s.repo.toLowerCase() === repo.toLowerCase())
  }

  // ---- Danh mục ----

  private async fetchSource(s: PluginSourceInfo): Promise<void> {
    try {
      const sha = await this.deps.github.resolveSha(s.repo, s.ref)
      const text = await this.deps.github.raw(s.repo, sha, MARKETPLACE_PATH)
      if (text === null) throw Object.assign(new Error('no_marketplace'), { catalog: 'no_marketplace' as const })
      const entries = parseMarketplace(text, s.repo)
      if (!entries) throw Object.assign(new Error('bad_marketplace'), { catalog: 'bad_marketplace' as const })
      this.cache.set(s.repo, { sha, fetchedAt: this.deps.now(), entries })
      this.errors.delete(s.repo)
    } catch (e) {
      const c = (e as { catalog?: CatalogError }).catalog
      this.errors.set(s.repo, c ? { error: c, retryAt: null } : catalogError(e))
      this.deps.log.warn(`Kho plugin: không đọc được nguồn ${s.repo} (${c ?? (e as Error).message})`)
    }
  }

  /**
   * Danh mục từ mọi nguồn. Bản đệm còn hạn (1 giờ) thì dùng lại; `force` (nút Làm mới) tối đa 1 lần / phút.
   * Lỗi một nguồn (hết lượt GitHub…) không làm hỏng nguồn khác; còn bản đệm cũ thì vẫn hiện.
   */
  async catalog(force = false): Promise<Catalog> {
    const now = this.deps.now()
    const canForce = force && now - this.lastRefresh >= REFRESH_MIN_MS
    if (canForce) this.lastRefresh = now
    const sources = this.sources()
    await Promise.all(
      sources.map(async (s) => {
        const cached = this.cache.get(s.repo)
        if (cached && !canForce && now - cached.fetchedAt < CATALOG_CACHE_MS) return
        await this.fetchSource(s)
      })
    )
    const installed = new Set(this.deps.getInstalled().map((p) => p.key))
    const states: CatalogSourceState[] = []
    const plugins: CatalogPlugin[] = []
    for (const s of sources) {
      const cached = this.cache.get(s.repo)
      const err = this.errors.get(s.repo)
      if (cached) {
        states.push({ repo: s.repo, builtin: s.builtin, status: 'ok', sha: cached.sha, fetchedAt: cached.fetchedAt, plugins: cached.entries.length, stale: err ?? null })
        for (const e of cached.entries)
          plugins.push({
            key: keyOf(s.repo, e.name),
            name: e.name,
            description: e.description,
            category: e.category,
            author: e.author,
            homepage: e.homepage,
            source: { repo: s.repo, builtin: s.builtin },
            location: e.location,
            unsupportedReason: e.unsupportedReason,
            installed: installed.has(keyOf(s.repo, e.name))
          })
      } else if (err) states.push({ repo: s.repo, builtin: s.builtin, status: 'error', error: err.error, retryAt: err.retryAt })
    }
    return { sources: states, plugins }
  }

  private async entry(key: string): Promise<{ source: PluginSourceInfo; sourceSha: string; entry: MarketplaceEntry } | PluginStoreError> {
    const [repo, name] = [key.slice(0, key.indexOf('#')), key.slice(key.indexOf('#') + 1)]
    const source = this.sources().find((s) => s.repo === repo)
    if (!source) return 'source_removed'
    if (!this.cache.has(repo)) await this.fetchSource(source)
    const cached = this.cache.get(repo)
    if (!cached) return this.errors.get(repo)?.error ?? 'network'
    const entry = cached.entries.find((e) => e.name === name)
    if (!entry) return 'plugin_not_found'
    return { source, sourceSha: cached.sha, entry }
  }

  // ---- Xem trước / cài / cập nhật ----

  /**
   * Tải đúng commit (SHA) rồi đọc — CHƯA ghi gì xuống đĩa. Cài phải dùng chính bản đã xem trước (token), không tải lại.
   * Plugin đã cài → đây là bản cập nhật: kèm thay đổi từng file so với bản đang dùng.
   */
  async preview(key: string): Promise<PreviewResult> {
    const found = await this.entry(key)
    if (typeof found === 'string') return { status: 'error', error: found, retryAt: this.errors.get(key.split('#')[0])?.retryAt ?? null }
    const { source, sourceSha, entry } = found
    if (!entry.location) return { status: 'error', error: 'unsupported_source' }
    const loc = entry.location
    let sha: string
    let zip: Uint8Array
    try {
      // Plugin trong cùng repo nguồn → đúng commit của marketplace; repo khác → SHA đã khoá trong marketplace, hoặc ref.
      sha = loc.sha ?? (loc.repo === source.repo && !loc.ref ? sourceSha : await this.deps.github.resolveSha(loc.repo, loc.ref ?? 'HEAD'))
      zip = await this.deps.github.archive(loc.repo, sha)
    } catch (e) {
      if (e instanceof GitHubError && e.code === 'too_large')
        return { status: 'error', error: 'too_large', detail: { reason: 'archive_too_big', file: loc.repo } }
      return { status: 'error', error: catalogError(e).error, retryAt: e instanceof GitHubError ? e.retryAt : null }
    }
    let inspected: InspectedPlugin
    try {
      inspected = inspectArchive(zip, loc.path, entry.license)
    } catch (e) {
      this.deps.log.warn(`Kho plugin: đọc gói ${key} lỗi: ${(e as Error).message}`)
      return { status: 'error', error: e instanceof InspectError ? e.code : 'bad_archive', detail: e instanceof InspectError ? e.detail : null }
    }
    const installed = this.deps.getInstalled()
    const current = installed.find((p) => p.key === key) ?? null
    const taken = await this.deps.takenSkillNames()
    const otherPlugins = new Set(installed.filter((p) => p.key !== key).flatMap((p) => p.skills))
    for (const s of inspected.skills)
      s.conflict = taken.builtin.has(s.name) ? 'builtin' : taken.user.has(s.name) ? 'user' : otherPlugins.has(s.name) ? 'plugin' : null
    const usable = inspected.skills.filter((s) => !s.conflict)
    const files: Record<string, string> = {}
    for (const s of usable) for (const f of s.files) files[`${s.name}/${f.path}`] = f.sha256

    const token = randomUUID()
    const preview: PluginPreview = {
      token,
      key,
      name: entry.name,
      description: entry.description,
      source: { repo: source.repo, builtin: source.builtin },
      location: { repo: loc.repo, path: loc.path, sha },
      license: inspected.license,
      skills: inspected.skills.map(({ contents: _c, ...s }) => s),
      ignored: inspected.ignored,
      warnings: dedupe(inspected.warnings),
      update: current ? { fromSha: current.location.sha, changes: await this.changes(current, usable) } : null
    }
    this.prune()
    this.pending.set(token, {
      at: this.deps.now(),
      key,
      preview,
      inspected,
      record: {
        key,
        name: entry.name,
        description: entry.description,
        sourceRepo: source.repo,
        location: { repo: loc.repo, path: loc.path, ref: loc.sha ? null : loc.ref, sha },
        license: inspected.license,
        skills: usable.map((s) => s.name),
        files
      }
    })
    return { status: 'ok', preview }
  }

  /** Thay đổi so với bản đang cài: file thêm / sửa / xoá (file chữ kèm diff). */
  private async changes(current: InstalledRecord, next: InspectedPlugin['skills']): Promise<FileChange[]> {
    const out: FileChange[] = []
    const nextFiles = new Map<string, Uint8Array>()
    for (const s of next) for (const [p, b] of s.contents) nextFiles.set(`${s.name}/${p}`, b)
    for (const [path, bytes] of nextFiles) {
      const old = current.files[path]
      if (!old) out.push({ path, change: 'added', patch: null })
      else if (old !== sha256(bytes)) {
        const before = await readFile(join(this.deps.dir, current.dir, path), 'utf8').catch(() => '')
        out.push({ path, change: 'modified', patch: createTwoFilesPatch(`a/${path}`, `b/${path}`, before, Buffer.from(bytes).toString('utf8'), '', '', { context: 3 }) })
      }
    }
    for (const path of Object.keys(current.files)) if (!nextFiles.has(path)) out.push({ path, change: 'removed', patch: null })
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  private prune(): void {
    const now = this.deps.now()
    for (const [k, v] of this.pending) if (now - v.at > PENDING_TTL_MS) this.pending.delete(k)
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value!)
  }

  cancelPreview(token: string): void {
    this.pending.delete(token)
  }

  /**
   * Cài / cập nhật đúng bản đã xem trước. Ghi thư mục tạm, kiểm lại sha256 từng file vừa ghi, rồi mới thay bản cũ
   * (giữ bản cũ tới phút chót — lỗi thì trả lại như trước).
   */
  async install(token: string): Promise<InstallResult> {
    const item = this.pending.get(token)
    if (!item) return { status: 'error', error: 'preview_expired' }
    if (this.installing.has(token)) return { status: 'error', error: 'install_failed', detail: { reason: 'locked', file: null, code: 'busy' } }
    if (!this.sourceExists(item.record.sourceRepo)) return { status: 'error', error: 'source_removed' }
    if (item.record.skills.length === 0) return { status: 'error', error: 'no_skills' }
    this.installing.add(token)
    try {
      const installed = this.deps.getInstalled()
      const current = installed.find((p) => p.key === item.key)
      const dir = current?.dir ?? dirOf(item.key, item.record.name)
      const files = new Map<string, Uint8Array>()
      for (const sk of item.inspected.skills.filter((x) => item.record.skills.includes(x.name)))
        for (const [p, bytes] of sk.contents) files.set(`${sk.name}/${p}`, bytes)
      const failed = await this.writePlugin(join(this.deps.dir, dir), files, item.record.files)
      if (failed) {
        this.deps.log.warn(`Kho plugin: cài ${item.key} lỗi: ${failed.reason} ${failed.file ?? ''} (${failed.code ?? '-'})`)
        // Giữ token: người dùng đóng chương trình đang giữ file rồi bấm lại được, không phải mở lại xem trước.
        return { status: 'error', error: 'install_failed', detail: failed }
      }
      this.pending.delete(token)
      const now = this.deps.now()
      const record: InstalledRecord = { ...item.record, dir, installedAt: current?.installedAt ?? now, updatedAt: now, updateAvailable: null }
      // Skill bỏ đi trong bản mới → quên cài đặt bật / tắt của chúng.
      if (current) this.deps.forgetSkills(current.skills.filter((sk) => !record.skills.includes(sk)))
      this.deps.setInstalled([...installed.filter((p) => p.key !== item.key), record])
      this.modifiedCache = null
      this.deps.log.info(`Kho plugin: đã ${current ? 'cập nhật' : 'cài'} ${item.key} @ ${record.location.sha.slice(0, 7)}`)
      this.deps.changed()
      return { status: 'ok', plugin: this.toInstalled(record) }
    } catch (e) {
      this.deps.log.warn(`Kho plugin: cài ${item.key} lỗi: ${(e as Error).message}`)
      return { status: 'error', error: 'install_failed', detail: { reason: 'write_failed', file: null, code: errCode(e) } }
    } finally {
      this.installing.delete(token)
    }
  }

  /**
   * Ghi plugin vào `dest`; trả null khi xong, hoặc lý do + file lỗi (bản cũ giữ nguyên).
   * Cách 1: ghi thư mục tạm, kiểm hash, đổi tên thay bản cũ. Windows không cho đổi tên thư mục đang mở
   * (Explorer, trình soạn thảo, cửa sổ lệnh đứng trong đó → EPERM / EBUSY) → cách 2: ghi đè từng file tại chỗ,
   * xoá file thừa; lỗi giữa chừng thì ghi lại nội dung cũ.
   */
  private async writePlugin(dest: string, files: Map<string, Uint8Array>, hashes: Record<string, string>): Promise<ErrorDetail | null> {
    const tmp = join(this.deps.dir, `.tmp-${randomUUID()}`)
    const backup = join(this.deps.dir, `.old-${randomUUID()}`)
    try {
      const bad = await writeAndVerify(tmp, files, hashes)
      if (bad) return bad
      if (existsSync(dest)) {
        try {
          await rename(dest, backup)
        } catch (e) {
          if (!isLocked(e)) throw e
          this.deps.log.info(`Kho plugin: thư mục ${dest} đang bị mở (${errCode(e)}) → ghi đè từng file`)
          return await this.writeInPlace(dest, files, hashes)
        }
      }
      try {
        await rename(tmp, dest)
      } catch (e) {
        if (existsSync(backup)) await rename(backup, dest)
        return { reason: isLocked(e) ? 'locked' : 'write_failed', file: null, code: errCode(e) }
      }
      await rm(backup, { recursive: true, force: true }).catch(() => undefined)
      return null
    } catch (e) {
      return { reason: isLocked(e) ? 'locked' : 'write_failed', file: fileOf(e, tmp), code: errCode(e) }
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async writeInPlace(dest: string, files: Map<string, Uint8Array>, hashes: Record<string, string>): Promise<ErrorDetail | null> {
    const old = new Map<string, Uint8Array>()
    for (const p of await listFiles(dest))
      try {
        old.set(p, await readFile(join(dest, ...p.split('/'))))
      } catch (e) {
        // Chưa ghi gì → bản cũ còn nguyên.
        return { reason: isLocked(e) ? 'locked' : 'write_failed', file: p, code: errCode(e) }
      }
    const restore = async (): Promise<void> => {
      for (const p of await listFiles(dest).catch(() => [] as string[]))
        if (!old.has(p)) await rm(join(dest, ...p.split('/')), { force: true }).catch(() => undefined)
      for (const [p, bytes] of old) {
        const target = join(dest, ...p.split('/'))
        await mkdir(dirname(target), { recursive: true }).catch(() => undefined)
        await writeFile(target, bytes).catch(() => undefined)
      }
    }
    for (const [p, bytes] of files) {
      const target = join(dest, ...p.split('/'))
      try {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, bytes)
        if (sha256(await readFile(target)) !== hashes[p]) {
          await restore()
          return { reason: 'hash_mismatch', file: p }
        }
      } catch (e) {
        await restore()
        return { reason: isLocked(e) ? 'locked' : 'write_failed', file: p, code: errCode(e) }
      }
    }
    for (const p of old.keys())
      if (!files.has(p))
        try {
          await rm(join(dest, ...p.split('/')), { force: true })
        } catch (e) {
          await restore()
          return { reason: isLocked(e) ? 'locked' : 'write_failed', file: p, code: errCode(e) }
        }
    await removeEmptyDirs(dest)
    return null
  }

  /** Gỡ: xoá thư mục plugin + bản ghi (SHA, hash) + cài đặt của skill. Không đụng cuộc trò chuyện / trí nhớ. */
  async uninstall(key: string): Promise<boolean> {
    const installed = this.deps.getInstalled()
    const p = installed.find((x) => x.key === key)
    if (!p) return false
    await rm(join(this.deps.dir, p.dir), { recursive: true, force: true })
    this.deps.setInstalled(installed.filter((x) => x.key !== key))
    this.deps.forgetSkills(p.skills)
    this.modifiedCache = null
    this.deps.log.info(`Kho plugin: đã gỡ ${key}`)
    this.deps.changed()
    return true
  }

  /** "Kiểm tra cập nhật": SHA mới của từng plugin đã cài (nguồn còn). Không tự cập nhật gì. */
  async checkUpdates(): Promise<InstalledPlugin[]> {
    const list = this.deps.getInstalled()
    const next: InstalledRecord[] = []
    for (const p of list) {
      if (!this.sourceExists(p.sourceRepo)) {
        next.push(p)
        continue
      }
      let latest: string | null = null
      try {
        const source = this.sources().find((s) => s.repo === p.sourceRepo)!
        await this.fetchSource(source)
        const cached = this.cache.get(p.sourceRepo)
        const e = cached?.entries.find((x) => x.name === p.name)
        if (e?.location)
          latest = e.location.sha ?? (e.location.repo === p.sourceRepo && !e.location.ref ? cached!.sha : await this.deps.github.resolveSha(e.location.repo, e.location.ref ?? 'HEAD'))
      } catch {
        latest = null
      }
      next.push({ ...p, updateAvailable: latest && latest !== p.location.sha ? latest : null })
    }
    this.deps.setInstalled(next)
    this.deps.changed()
    return this.installed()
  }

  // ---- Đã cài ----

  /** File trên đĩa còn đúng hash lúc cài không (thiếu / sửa / thêm file lạ trong thư mục skill → bị sửa). */
  private isModified(p: InstalledRecord): boolean {
    this.modifiedCache ??= new Map()
    const cached = this.modifiedCache.get(p.key)
    if (cached !== undefined) return cached
    let modified = false
    for (const [path, hash] of Object.entries(p.files)) {
      try {
        if (sha256(readFileSync(join(this.deps.dir, p.dir, path))) !== hash) modified = true
      } catch {
        modified = true
      }
      if (modified) break
    }
    this.modifiedCache.set(p.key, modified)
    return modified
  }

  /** Bỏ bản nhớ kết quả kiểm hash (vd khi mở trang Plugin) — người dùng có thể vừa sửa file ngoài app. */
  recheck(): void {
    this.modifiedCache = null
  }

  private toInstalled(p: InstalledRecord): InstalledPlugin {
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      source: { repo: p.sourceRepo, builtin: this.isBuiltinSource(p.sourceRepo) },
      location: { repo: p.location.repo, path: p.location.path, sha: p.location.sha },
      license: p.license,
      skills: p.skills,
      installedAt: p.installedAt,
      updatedAt: p.updatedAt,
      modified: this.isModified(p),
      sourceRemoved: !this.sourceExists(p.sourceRepo),
      updateAvailable: p.updateAvailable
    }
  }

  installed(): InstalledPlugin[] {
    return this.deps.getInstalled().map((p) => this.toInstalled(p))
  }

  /** Skill của các plugin đã cài (SkillStore đọc nội dung từ `dir`). */
  skillFiles(): PluginSkillFile[] {
    return this.deps.getInstalled().flatMap((p) => {
      const modified = this.isModified(p)
      return p.skills.map((name) => ({
        name,
        dir: join(this.deps.dir, p.dir, name),
        pluginKey: p.key,
        pluginName: p.name,
        origin: `kho:${p.location.repo}@${p.location.sha.slice(0, 7)}`,
        builtinSource: this.isBuiltinSource(p.sourceRepo),
        modified
      }))
    })
  }
}

/** Gộp cảnh báo trùng (cùng loại + file + nội dung). */
function dedupe<T extends { kind: string; file: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((w) => {
    const k = JSON.stringify(w)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Đọc danh sách nguồn mặc định (resources/plugin-sources.json); hỏng / thiếu → không có nguồn mặc định. */
export function loadDefaultSources(file: string): { repo: string; ref: string }[] {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { sources?: { repo?: string; ref?: string }[] }
    return (data.sources ?? []).flatMap((s) =>
      s.repo && REPO_RE.test(s.repo) ? [{ repo: s.repo, ref: s.ref && REF_RE.test(s.ref) ? s.ref : 'HEAD' }] : []
    )
  } catch {
    return []
  }
}

const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const errCode = (e: unknown): string | null => (e as NodeJS.ErrnoException | null)?.code ?? null
const isLocked = (e: unknown): boolean => LOCK_CODES.has(errCode(e) ?? '')
/** File gây lỗi, tính từ thư mục plugin (không lộ đường dẫn đầy đủ trên máy). */
const fileOf = (e: unknown, root: string): string | null => {
  const path = (e as NodeJS.ErrnoException | null)?.path
  return path ? relative(root, path).split(sep).join('/') || null : null
}

/** Ghi tất cả file vào `root` (mới) và kiểm sha256 ngay sau khi ghi (ổ đĩa / phần mềm khác đổi nội dung → không cài). */
async function writeAndVerify(root: string, files: Map<string, Uint8Array>, hashes: Record<string, string>): Promise<ErrorDetail | null> {
  for (const [p, bytes] of files) {
    const target = join(root, ...p.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    if (sha256(await readFile(target)) !== hashes[p]) return { reason: 'hash_mismatch', file: p }
  }
  return null
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(root, { withFileTypes: true, recursive: true }))
    if (e.isFile()) out.push(relative(root, join(e.parentPath, e.name)).split(sep).join('/'))
  return out
}

async function removeEmptyDirs(root: string): Promise<void> {
  const dirs = (await readdir(root, { withFileTypes: true, recursive: true }))
    .filter((e) => e.isDirectory())
    .map((e) => join(e.parentPath, e.name))
    .sort((a, b) => b.length - a.length)
  for (const d of dirs) await rmdir(d).catch(() => undefined)
}
