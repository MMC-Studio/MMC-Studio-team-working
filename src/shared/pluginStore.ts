import { z } from 'zod'

/**
 * Kho plugin online (PR 8a): nguồn = repo GitHub có `.claude-plugin/marketplace.json` (định dạng marketplace của Claude
 * Code). App CHỈ lấy skill bằng chữ (.md / .txt / .json) — script, hook, nhị phân không bao giờ được giữ hay chạy.
 * Cài theo commit SHA cụ thể (không theo nhánh), lưu sha256 từng file. Không tự cập nhật.
 */

/** "owner/repo" của GitHub. */
export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
export const SHA_RE = /^[0-9a-f]{40}$/
/** Nhánh / tag: chữ, số, - _ . / (không có .., không bắt đầu bằng -). */
export const REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/

/** Giới hạn tải về: gói zip của repo (cả repo, lấy riêng thư mục plugin). */
export const ARCHIVE_MAX_BYTES = 40 * 1024 * 1024
export const CATALOG_CACHE_MS = 60 * 60 * 1000
export const REFRESH_MIN_MS = 60 * 1000
export const MAX_USER_SOURCES = 20

export type PluginSourceInfo = {
  /** "owner/repo". */
  repo: string
  ref: string
  /** Nguồn mặc định (đóng gói cùng app, chủ repo đã duyệt) hay người dùng tự thêm. */
  builtin: boolean
  addedAt: number | null
}

export type CatalogPlugin = {
  /** Khoá duy nhất: `<repo nguồn>#<tên plugin>`. */
  key: string
  name: string
  description: string
  category: string | null
  author: string | null
  homepage: string | null
  source: { repo: string; builtin: boolean }
  /** Plugin nằm ở đâu (cùng repo nguồn hoặc repo khác) — null = định dạng app chưa hỗ trợ (không phải GitHub…). */
  location: { repo: string; path: string; ref: string | null; sha: string | null } | null
  unsupportedReason: string | null
  installed: boolean
}

export type CatalogSourceState =
  | {
      repo: string
      builtin: boolean
      status: 'ok'
      sha: string
      fetchedAt: number
      plugins: number
      /** Lần đọc mới nhất lỗi (vd GitHub hết lượt) — đang hiện bản đã lưu. */
      stale: { error: CatalogError; retryAt: number | null } | null
    }
  | { repo: string; builtin: boolean; status: 'error'; error: CatalogError; retryAt: number | null }

export type CatalogError = 'rate_limited' | 'not_found' | 'no_marketplace' | 'bad_marketplace' | 'network'

export type Catalog = { sources: CatalogSourceState[]; plugins: CatalogPlugin[] }

/** Cảnh báo lúc xem trước — không chặn cài, chỉ để người dùng đọc kỹ. */
export type PreviewWarning =
  | { kind: 'injection'; file: string; excerpt: string }
  | { kind: 'app_tool'; file: string; tool: string }
  | { kind: 'url'; file: string; url: string }
  | { kind: 'base64'; file: string }
  | { kind: 'shell'; file: string; excerpt: string }
  /** Skill nhắc tới file script / file bị bỏ → có thể không chạy đúng. */
  | { kind: 'missing_file'; file: string; target: string }

export type PreviewSkill = {
  name: string
  description: string
  body: string
  files: { path: string; size: number; sha256: string }[]
  skipped: string[]
  /** Trùng tên skill có sẵn / skill bạn tự cài / skill của plugin khác → skill này không cài được. */
  conflict: 'builtin' | 'user' | 'plugin' | null
}

export type FileChange = { path: string; change: 'added' | 'modified' | 'removed'; patch: string | null }

export type PluginPreview = {
  token: string
  key: string
  name: string
  description: string
  source: { repo: string; builtin: boolean }
  location: { repo: string; path: string; sha: string }
  license: string | null
  skills: PreviewSkill[]
  /** Phần plugin có nhưng app không lấy (hook, lệnh, agent, MCP, script…). */
  ignored: { hooks: boolean; commands: number; agents: number; mcp: boolean; otherFiles: number }
  warnings: PreviewWarning[]
  /** Cập nhật plugin đã cài: SHA cũ + thay đổi từng file. */
  update: { fromSha: string; changes: FileChange[] } | null
}

export type InstalledPlugin = {
  key: string
  name: string
  description: string
  source: { repo: string; builtin: boolean }
  location: { repo: string; path: string; sha: string }
  license: string | null
  skills: string[]
  installedAt: number
  updatedAt: number
  /** File bị sửa / xoá ngoài app (hash lệch) → skill không được dùng tới khi cài lại. */
  modified: boolean
  /** Nguồn đã bị xoá → giữ plugin, không cập nhật được. */
  sourceRemoved: boolean
  /** Lần kiểm tra gần nhất thấy có SHA mới. */
  updateAvailable: string | null
}

export type PluginStoreError =
  | CatalogError
  | 'unsupported_source'
  | 'plugin_not_found'
  | 'too_large'
  | 'bad_archive'
  | 'no_skills'
  | 'preview_expired'
  | 'source_removed'
  | 'source_exists'
  | 'too_many_sources'
  | 'builtin_source'
  | 'install_failed'

export type PreviewResult = { status: 'ok'; preview: PluginPreview } | { status: 'error'; error: PluginStoreError; retryAt?: number | null }

export const sourceInputSchema = z.object({
  /** "owner/repo" hoặc link https://github.com/owner/repo(.git). */
  repo: z.string().trim().min(3).max(300),
  ref: z.string().trim().regex(REF_RE).max(100).optional()
})

export const pluginKeySchema = z.string().min(3).max(300)

/** "owner/repo" từ chữ người dùng nhập (cả link GitHub); null nếu không hợp lệ. */
export function parseRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const m = /^(?:https:\/\/github\.com\/)?([^/\s]+\/[^/\s]+)$/.exec(s)
  return m && REPO_RE.test(m[1]) ? m[1] : null
}
