import { ARCHIVE_MAX_BYTES, SHA_RE } from '@shared/pluginStore'

/** Lỗi gọi GitHub (mã → i18n). `retryAt`: GitHub báo hết lượt, thử lại sau mốc này. */
export class GitHubError extends Error {
  constructor(
    readonly code: 'rate_limited' | 'not_found' | 'network' | 'too_large',
    readonly retryAt: number | null = null
  ) {
    super(code)
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type GitHubBases = { api: string; raw: string; codeload: string }

export const GITHUB_BASES: GitHubBases = {
  api: 'https://api.github.com',
  raw: 'https://raw.githubusercontent.com',
  codeload: 'https://codeload.github.com'
}

/**
 * Gọi GitHub KHÔNG token (repo public, không gắn tài khoản ai). API giới hạn ~60 lần / giờ theo IP nên chỉ dùng API
 * để đổi nhánh / tag ra commit SHA (kèm ETag — 304 không tính lượt); file đọc qua raw, gói zip qua codeload (không tính
 * vào giới hạn API). Hết lượt → `rate_limited` + giờ thử lại; không thử lại liên tục.
 */
export class GitHubClient {
  private etags = new Map<string, { etag: string; sha: string }>()
  private blockedUntil = 0

  constructor(
    private readonly fetch: FetchFn,
    private readonly now: () => number = Date.now,
    private readonly bases: GitHubBases = GITHUB_BASES
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // User-Agent chung (GitHub bắt buộc có) — không chứa tên / email người dùng.
    return { 'User-Agent': 'MMC-studio', ...extra }
  }

  private async get(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.fetch(url, init)
    } catch {
      throw new GitHubError('network')
    }
  }

  /** Nhánh / tag / SHA → commit SHA (1 lần gọi API; trả 304 khi chưa đổi). */
  async resolveSha(repo: string, ref: string): Promise<string> {
    if (SHA_RE.test(ref)) return ref
    if (this.now() < this.blockedUntil) throw new GitHubError('rate_limited', this.blockedUntil)
    const url = `${this.bases.api}/repos/${repo}/commits/${encodeURIComponent(ref)}`
    const cached = this.etags.get(url)
    const res = await this.get(url, {
      headers: this.headers({
        Accept: 'application/vnd.github.sha',
        ...(cached ? { 'If-None-Match': cached.etag } : {})
      })
    })
    if (res.status === 304 && cached) return cached.sha
    const remaining = res.headers.get('x-ratelimit-remaining')
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.status === 429)) {
      this.blockedUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : this.now() + 60 * 60 * 1000
      throw new GitHubError('rate_limited', this.blockedUntil)
    }
    if (res.status === 404 || res.status === 422) throw new GitHubError('not_found')
    if (!res.ok) throw new GitHubError('network')
    const sha = (await res.text()).trim()
    if (!SHA_RE.test(sha)) throw new GitHubError('network')
    const etag = res.headers.get('etag')
    if (etag) this.etags.set(url, { etag, sha })
    return sha
  }

  /** File chữ ở đúng commit (raw — không tính lượt API). null = không có file. */
  async raw(repo: string, sha: string, path: string): Promise<string | null> {
    const url = `${this.bases.raw}/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`
    const res = await this.get(url, { headers: this.headers() })
    if (res.status === 404) return null
    if (!res.ok) throw new GitHubError('network')
    return res.text()
  }

  /** Gói zip của repo ở đúng commit (codeload), giới hạn dung lượng. */
  async archive(repo: string, sha: string): Promise<Uint8Array> {
    const res = await this.get(`${this.bases.codeload}/${repo}/zip/${sha}`, { headers: this.headers() })
    if (res.status === 404) throw new GitHubError('not_found')
    if (!res.ok) throw new GitHubError('network')
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > ARCHIVE_MAX_BYTES) throw new GitHubError('too_large')
    const body = new Uint8Array(await res.arrayBuffer())
    if (body.byteLength > ARCHIVE_MAX_BYTES) throw new GitHubError('too_large')
    return body
  }
}
