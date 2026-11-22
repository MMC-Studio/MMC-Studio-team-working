/**
 * Gọi MCP server HTTP cài từ kho: CHỈ tới đúng tên miền đã duyệt. Header bí mật do app gắn ở đây (CLI không bao giờ
 * thấy). Redirect cùng tên miền + cùng giao thức thì theo (tối đa 5 lần), sang tên miền khác → chặn (không gửi gì đi).
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export class RedirectBlockedError extends Error {
  constructor(readonly to: string) {
    super(`redirect_blocked: ${to}`)
  }
}

const REDIRECT = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

export async function fetchApproved(
  fetchImpl: FetchLike,
  url: string,
  host: string,
  init: { method: string; headers: Record<string, string>; body?: string | null; signal?: AbortSignal },
  secretHeaders: Record<string, string>
): Promise<Response> {
  let current = new URL(url)
  const protocol = current.protocol
  let method = init.method
  let body = init.body ?? null
  for (let hop = 0; ; hop++) {
    if (current.host !== host || current.protocol !== protocol) throw new RedirectBlockedError(current.host)
    const res = await fetchImpl(current.toString(), {
      method,
      headers: { ...init.headers, ...secretHeaders },
      body: method === 'GET' || method === 'HEAD' ? undefined : (body ?? undefined),
      redirect: 'manual',
      signal: init.signal
    })
    const location = res.headers.get('location')
    if (!REDIRECT.has(res.status) || !location) return res
    await res.body?.cancel().catch(() => undefined)
    if (hop >= MAX_REDIRECTS) throw new RedirectBlockedError(current.host)
    const next = new URL(location, current)
    if (next.host !== host || next.protocol !== protocol) throw new RedirectBlockedError(next.host)
    if (res.status === 303) {
      method = 'GET'
      body = null
    }
    current = next
  }
}

/** Headers / mảng / object → object chữ thường (để chuyển tiếp có chọn lọc). */
export function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(h).forEach((v, k) => (out[k.toLowerCase()] = v))
  return out
}
