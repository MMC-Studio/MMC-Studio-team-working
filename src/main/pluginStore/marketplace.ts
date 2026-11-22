import { posix } from 'node:path'
import { z } from 'zod'
import { REF_RE, REPO_RE, SHA_RE } from '@shared/pluginStore'

export const MARKETPLACE_PATH = '.claude-plugin/marketplace.json'
const MAX_PLUGINS = 1000

const str = (max: number) => z.string().max(max)
const sourceSchema = z.union([
  str(500),
  z.object({ source: str(50), repo: str(200).optional(), url: str(500).optional(), path: str(500).optional(), ref: str(200).optional(), sha: str(80).optional() }).passthrough()
])
const pluginSchema = z
  .object({
    name: str(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    description: str(2000).optional(),
    category: str(100).optional(),
    homepage: str(500).optional(),
    license: str(100).optional(),
    author: z.union([str(200), z.object({ name: str(200).optional() }).passthrough()]).optional(),
    source: sourceSchema
  })
  .passthrough()
const marketplaceSchema = z.object({ name: str(200).optional(), plugins: z.array(z.unknown()).max(MAX_PLUGINS) }).passthrough()

export type MarketplaceEntry = {
  name: string
  description: string
  category: string | null
  author: string | null
  homepage: string | null
  license: string | null
  location: { repo: string; path: string; ref: string | null; sha: string | null } | null
  unsupportedReason: string | null
}

const repoFromUrl = (url: string): string | null => {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m && REPO_RE.test(m[1]) ? m[1] : null
}

/** Đường dẫn trong repo an toàn (không tuyệt đối, không ..). '' = gốc repo. */
export function safeRepoPath(raw: string): string | null {
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (p === '' || p === '.') return ''
  if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.includes('\0') || p.split('/').includes('..')) return null
  return posix.normalize(p)
}

const ref = (v: string | undefined): string | null => (v && REF_RE.test(v) ? v : null)
const sha = (v: string | undefined): string | null => (v && SHA_RE.test(v) ? v : null)

/** Một mục plugin của marketplace → vị trí trên GitHub (repo + thư mục + ref / SHA đã khoá nếu có). */
function locate(source: z.infer<typeof sourceSchema>, marketplaceRepo: string): Pick<MarketplaceEntry, 'location' | 'unsupportedReason'> {
  if (typeof source === 'string') {
    const path = safeRepoPath(source)
    return path === null
      ? { location: null, unsupportedReason: 'bad_path' }
      : { location: { repo: marketplaceRepo, path, ref: null, sha: null }, unsupportedReason: null }
  }
  const kind = source.source
  if (kind === 'github') {
    const repo = source.repo && REPO_RE.test(source.repo) ? source.repo : null
    if (!repo) return { location: null, unsupportedReason: 'bad_repo' }
    const path = safeRepoPath(source.path ?? '')
    if (path === null) return { location: null, unsupportedReason: 'bad_path' }
    return { location: { repo, path, ref: ref(source.ref), sha: sha(source.sha) }, unsupportedReason: null }
  }
  if (kind === 'url' || kind === 'git-subdir' || kind === 'git') {
    const repo = repoFromUrl(source.url ?? '')
    if (!repo) return { location: null, unsupportedReason: 'not_github' }
    const path = safeRepoPath(kind === 'git-subdir' ? (source.path ?? '') : '')
    if (path === null) return { location: null, unsupportedReason: 'bad_path' }
    return { location: { repo, path, ref: ref(source.ref), sha: sha(source.sha) }, unsupportedReason: null }
  }
  return { location: null, unsupportedReason: 'unsupported_kind' }
}

/** Đọc marketplace.json (lỏng: mục lỗi bị bỏ qua, không làm hỏng cả danh sách). null = không phải marketplace. */
export function parseMarketplace(text: string, marketplaceRepo: string): MarketplaceEntry[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const m = marketplaceSchema.safeParse(data)
  if (!m.success) return null
  const out: MarketplaceEntry[] = []
  const seen = new Set<string>()
  for (const raw of m.data.plugins) {
    const p = pluginSchema.safeParse(raw)
    if (!p.success || seen.has(p.data.name)) continue
    seen.add(p.data.name)
    const author = typeof p.data.author === 'string' ? p.data.author : (p.data.author?.name ?? null)
    out.push({
      name: p.data.name,
      description: p.data.description ?? '',
      category: p.data.category ?? null,
      author,
      homepage: p.data.homepage?.startsWith('https://') ? p.data.homepage : null,
      license: p.data.license ?? null,
      ...locate(p.data.source, marketplaceRepo)
    })
  }
  return out
}
