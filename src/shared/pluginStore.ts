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

/** Lý do bỏ một file: không phải file chữ · lock file (package-lock.json, yarn.lock…) · một file quá 512 KB · vượt 100 file / 2 MB của skill. */
export type SkipReason = 'not_text' | 'lock_file' | 'too_big' | 'over_limit'
export type SkippedFile = { path: string; reason: SkipReason }

export type PreviewSkill = {
  name: string
  description: string
  body: string
  files: { path: string; size: number; sha256: string }[]
  /** File trong thư mục skill KHÔNG cài, kèm lý do (script / nhị phân, lock file, quá lớn, vượt giới hạn của skill). */
  skipped: SkippedFile[]
  /** Trùng tên skill có sẵn / skill bạn tự cài / skill của plugin khác → skill này không cài được. */
  conflict: 'builtin' | 'user' | 'plugin' | null
}

export type FileChange = { path: string; change: 'added' | 'modified' | 'removed'; patch: string | null }

/**
 * MCP server khai báo trong plugin (8b). Chỉ HTTP `https://` cài được (tắt sẵn, bật phải xem danh sách tool);
 * server chạy lệnh chỉ hiển thị nguyên văn (Thêm thủ công khi lệnh khoá phiên bản).
 */
export type PreviewMcpServer = {
  /** Tên trong gói (.mcp.json / plugin.json). */
  name: string
  kind: 'http' | 'stdio' | 'unsupported'
  url: string | null
  host: string | null
  /** Header cần nhập (tên khoá) + mẫu giá trị trong gói. */
  headers: { key: string; template: string }[]
  /** Server chạy lệnh: lệnh nguyên văn (hiện trong khung đỏ) + argv tách sẵn (lệnh, tham số…) để "Thêm thủ công". */
  command: string | null
  argv: string[]
  /** Lệnh khoá phiên bản (pkg@1.2.3, pkg==1.2.3, image@sha256…) → được "Thêm thủ công". */
  pinned: boolean
  /** Vì sao không cài được. */
  reason: 'not_https' | 'sse' | 'variables' | 'bad_url' | null
  /** Thử kết nối không kèm thông tin gì: oauth = cần đăng nhập OAuth (app chưa hỗ trợ) · token = cần header. */
  auth: 'none' | 'token' | 'oauth' | 'unknown'
  /** Cập nhật: so với server đang cài của plugin. */
  change: 'added' | 'url_changed' | 'headers_changed' | 'unchanged' | null
}

export const mcpInstallable = (m: PreviewMcpServer): boolean => m.kind === 'http' && m.auth !== 'oauth'

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
  /** MCP server của plugin (8b). */
  mcp: PreviewMcpServer[]
  /** Cập nhật plugin đã cài: SHA cũ + thay đổi từng file + MCP server bị bỏ khỏi plugin (sẽ gỡ). */
  update: { fromSha: string; changes: FileChange[]; mcpRemoved: string[] } | null
}

export type InstalledPlugin = {
  key: string
  name: string
  description: string
  source: { repo: string; builtin: boolean }
  location: { repo: string; path: string; sha: string }
  license: string | null
  skills: string[]
  /** MCP server đã cài từ plugin (tên trong app). */
  mcp: string[]
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

/**
 * Chi tiết lỗi để người dùng biết vì sao + file nào (không bao giờ chỉ báo chung chung).
 * - locked: thư mục / file đang bị chương trình khác mở (Explorer, trình soạn thảo…)
 * - write_failed: ghi đĩa lỗi (hết chỗ, không có quyền…) · hash_mismatch: file ghi xong bị đổi nội dung
 * - too_many_files / too_many_bytes: plugin vượt giới hạn đọc (`limit`) · archive_too_big: gói tải về quá 40 MB
 */
export type ErrorDetail = {
  reason: 'locked' | 'write_failed' | 'hash_mismatch' | 'too_many_files' | 'too_many_bytes' | 'archive_too_big'
  file: string | null
  /** Lỗi hệ thống gốc (vd EPERM) — hiện nhỏ để báo lỗi. */
  code?: string | null
}

export type PreviewResult =
  | { status: 'ok'; preview: PluginPreview }
  | { status: 'error'; error: PluginStoreError; retryAt?: number | null; detail?: ErrorDetail | null }

export type InstallResult = { status: 'ok'; plugin: InstalledPlugin } | { status: 'error'; error: PluginStoreError; detail?: ErrorDetail | null }

export const sourceInputSchema = z.object({
  /** "owner/repo" hoặc link https://github.com/owner/repo(.git). */
  repo: z.string().trim().min(3).max(300),
  ref: z.string().trim().regex(REF_RE).max(100).optional()
})

export const pluginKeySchema = z.string().min(3).max(300)

/** Cài: token xem trước + tên các MCP server người dùng đã tick xác nhận. */
export const installInputSchema = z.object({
  token: z.uuid(),
  mcp: z.array(z.string().min(1).max(100)).max(20).default([])
})

/** "owner/repo" từ chữ người dùng nhập (cả link GitHub); null nếu không hợp lệ. */
export function parseRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const m = /^(?:https:\/\/github\.com\/)?([^/\s]+\/[^/\s]+)$/.exec(s)
  return m && REPO_RE.test(m[1]) ? m[1] : null
}
