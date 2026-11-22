import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolDef } from './fingerprint'
import { fetchApproved, headersToObject, RedirectBlockedError, type FetchLike } from './upstream'

const LIST_TIMEOUT_MS = 20_000
const PROBE_TIMEOUT_MS = 5_000
const MAX_TOOLS = 200

export type ListToolsResult =
  | { status: 'ok'; tools: ToolDef[] }
  | { status: 'error'; error: 'oauth_required' | 'unauthorized' | 'redirect_blocked' | 'network' | 'no_tools'; detail: string | null }

/**
 * Kết nối MCP server (qua `fetchApproved`: chỉ đúng tên miền, header gắn ở đây) và lấy TOÀN BỘ danh sách tool — để người
 * dùng xem trước khi bật. 401: server không đòi header → cần OAuth (chưa hỗ trợ); có header → header sai / thiếu quyền.
 */
export async function listServerTools(opts: {
  url: string
  host: string
  secretHeaders: Record<string, string>
  needsHeaders: boolean
  fetch: FetchLike
  timeoutMs?: number
}): Promise<ListToolsResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LIST_TIMEOUT_MS)
  const guarded = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    fetchApproved(
      opts.fetch,
      input instanceof Request ? input.url : input.toString(),
      opts.host,
      { method: init?.method ?? 'GET', headers: headersToObject(init?.headers), body: typeof init?.body === 'string' ? init.body : null, signal: controller.signal },
      opts.secretHeaders
    )
  const client = new Client({ name: 'mmc-studio', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), { fetch: guarded })
  try {
    await client.connect(transport, { signal: controller.signal, timeout: opts.timeoutMs ?? LIST_TIMEOUT_MS })
    const tools: ToolDef[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal: controller.signal })
      for (const t of page.tools) tools.push({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })
      cursor = page.nextCursor
    } while (cursor && tools.length < MAX_TOOLS)
    if (tools.length === 0) return { status: 'error', error: 'no_tools', detail: null }
    return { status: 'ok', tools: tools.slice(0, MAX_TOOLS) }
  } catch (e) {
    const err = errorOf(e)
    if (err instanceof RedirectBlockedError) return { status: 'error', error: 'redirect_blocked', detail: err.to }
    if (err instanceof StreamableHTTPError && (err.code === 401 || err.code === 403))
      return { status: 'error', error: opts.needsHeaders ? 'unauthorized' : 'oauth_required', detail: String(err.code) }
    return { status: 'error', error: 'network', detail: (err as Error).message.slice(0, 200) }
  } finally {
    clearTimeout(timer)
    await client.close().catch(() => undefined)
  }
}

/** `WWW-Authenticate` kiểu Bearer có `resource_metadata` (MCP Authorization, RFC 9728) → server dùng OAuth. */
export const isOAuthChallenge = (header: string | null): boolean => !!header && /^\s*Bearer\b/i.test(header) && /\bresource_metadata\s*=/i.test(header)

/** Lỗi gốc (SDK đôi khi bọc lỗi của fetch trong `cause`). */
function errorOf(e: unknown): unknown {
  let cur = e
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    if (cur instanceof RedirectBlockedError || cur instanceof StreamableHTTPError) return cur
    cur = (cur as Error & { cause?: unknown }).cause ?? cur
    if (cur === e) break
  }
  return e
}

/**
 * Lúc xem trước plugin: thử `initialize` KHÔNG kèm thông tin gì (không header, không dữ liệu người dùng) để biết server có
 * đòi đăng nhập OAuth không. Không theo redirect.
 * - 401 / 403 + `WWW-Authenticate: Bearer … resource_metadata=…` (chuẩn OAuth của MCP) → oauth: chắc chắn phải đăng nhập.
 *   Vd context7 với địa chỉ plugin khai báo (`?client=claude-code-plugin`) — cùng server, bỏ tham số đó thì ẩn danh được.
 * - 401 / 403 không có thông tin đó → maybe (không chặn; lúc bật app kết nối lại và báo đúng lỗi).
 * - Lỗi mạng / mã khác → unknown (không chặn).
 */
export async function probeAuth(fetchImpl: FetchLike, url: string): Promise<'none' | 'oauth' | 'maybe' | 'unknown'> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mmc-studio', version: '1' } }
      }),
      redirect: 'manual',
      signal: controller.signal
    })
    await res.body?.cancel().catch(() => undefined)
    if (res.status === 401 || res.status === 403) return isOAuthChallenge(res.headers.get('www-authenticate')) ? 'oauth' : 'maybe'
    return res.ok ? 'none' : 'unknown'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timer)
  }
}
