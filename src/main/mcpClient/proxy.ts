import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { changedTools, type ToolDef } from './fingerprint'
import { fetchApproved, RedirectBlockedError, type FetchLike } from './upstream'

/** Server từ kho đang bật + đã duyệt danh sách tool (null = không cho đi qua). */
export type ProxyTarget = { url: string; host: string; secretHeaders: Record<string, string>; approved: Record<string, string> }

export type McpProxyDeps = {
  target(id: string): ProxyTarget | null
  /** Danh sách tool / mô tả đổi so với lần duyệt → app tự tắt server, người dùng phải xác nhận lại. */
  toolsChanged(id: string, tools: string[]): void
  fetch: FetchLike
  log: { info(msg: string): void; warn(msg: string): void }
}

export const PROXY_HEADER = 'x-mmc-proxy'
const MAX_BODY = 4 * 1024 * 1024
const FORWARD_REQ = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']
const FORWARD_RES = ['content-type', 'mcp-session-id', 'cache-control']

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: unknown } }

/**
 * Proxy cục bộ (127.0.0.1, token ngẫu nhiên) giữa Claude CLI và MCP server HTTP cài từ kho plugin:
 * - CLI chỉ biết `http://127.0.0.1:<port>/s/<id>` + token proxy — KHÔNG thấy URL thật hay header bí mật.
 * - App gắn header bí mật và chỉ gửi tới đúng tên miền đã duyệt; redirect sang tên miền khác → chặn.
 * - `tools/list`: so với danh sách người dùng đã duyệt; tool mới / đổi mô tả / đổi tham số → tự tắt server, trả lỗi.
 * - `tools/call`: tool chưa duyệt → chặn (lớp chặn thứ hai sau thẻ duyệt từng lần gọi).
 */
export class McpProxy {
  private server: Server | null = null
  private port = 0
  readonly token = randomBytes(24).toString('hex')

  constructor(private readonly deps: McpProxyDeps) {}

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        this.deps.log.warn(`MCP proxy: ${(e as Error).message}`)
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Proxy lỗi.' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    this.server = server
    this.port = (server.address() as AddressInfo).port
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** Địa chỉ cho CLI (null = chưa chạy → không nạp server từ kho). */
  endpoint(id: string): { url: string; headers: Record<string, string> } | null {
    if (!this.server) return null
    return { url: `http://127.0.0.1:${this.port}/s/${id}`, headers: { [PROXY_HEADER]: this.token } }
  }

  private authorized(req: IncomingMessage): boolean {
    const got = Buffer.from(String(req.headers[PROXY_HEADER] ?? ''))
    const want = Buffer.from(this.token)
    return got.length === want.length && timingSafeEqual(got, want)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const m = /^\/s\/([0-9a-f-]{36})$/.exec(req.url ?? '')
    if (!m || !this.authorized(req)) return void res.writeHead(404).end()
    const id = m[1]
    const target = this.deps.target(id)
    if (!target) return rpcError(res, null, 403, 'Server này đang tắt hoặc chưa được duyệt.')
    const method = req.method ?? 'GET'
    if (!['GET', 'POST', 'DELETE'].includes(method)) return void res.writeHead(405).end()

    const body = method === 'POST' ? await readBody(req) : null
    if (body === undefined) return rpcError(res, null, 413, 'Yêu cầu quá lớn.')
    let messages: RpcMessage[] = []
    if (body) {
      try {
        const parsed = JSON.parse(body) as RpcMessage | RpcMessage[]
        messages = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return rpcError(res, null, 400, 'JSON không hợp lệ.')
      }
    }
    // Gọi tool chưa duyệt → chặn ngay, không gửi đi.
    const blocked = messages.find((msg) => msg.method === 'tools/call' && !(typeof msg.params?.name === 'string' && msg.params.name in target.approved))
    if (blocked) {
      this.deps.log.warn(`MCP proxy: chặn gọi tool chưa duyệt ${String(blocked.params?.name)} (${target.host})`)
      return rpcError(res, blocked.id ?? null, 200, 'Tool này chưa được người dùng duyệt.')
    }
    const listing = messages.length === 1 && messages[0].method === 'tools/list' && messages[0].id !== undefined ? messages[0] : null

    const headers: Record<string, string> = {}
    for (const h of FORWARD_REQ) {
      const v = req.headers[h]
      if (typeof v === 'string') headers[h] = v
    }
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    let upstream: Response
    try {
      upstream = await fetchApproved(this.deps.fetch, target.url, target.host, { method, headers, body, signal: controller.signal }, target.secretHeaders)
    } catch (e) {
      if (e instanceof RedirectBlockedError) {
        this.deps.log.warn(`MCP proxy: chặn redirect ${target.host} → ${e.to}`)
        return rpcError(res, messages[0]?.id ?? null, 502, `Server chuyển hướng sang tên miền khác (${e.to}) — đã chặn.`)
      }
      if (controller.signal.aborted) return
      return rpcError(res, messages[0]?.id ?? null, 502, 'Không kết nối được MCP server.')
    }

    const outHeaders: Record<string, string> = {}
    for (const h of FORWARD_RES) {
      const v = upstream.headers.get(h)
      if (v) outHeaders[h] = v
    }

    if (listing && upstream.ok) {
      const text = await upstream.text()
      const tools = toolsFrom(text, upstream.headers.get('content-type') ?? '', listing.id ?? null)
      // Không đọc được (CLI có thể đọc được theo cách khác) → không cho qua.
      if (!tools) return rpcError(res, listing.id ?? null, 502, 'Không đọc được danh sách tool của server.')
      const changed = changedTools(tools, target.approved)
      if (changed.length) {
        this.deps.log.warn(`MCP proxy: danh sách tool của ${target.host} đổi (${changed.slice(0, 5).join(', ')}) → tắt server`)
        this.deps.toolsChanged(id, changed)
        return rpcError(res, listing.id ?? null, 200, 'Danh sách tool của server đã đổi so với lần người dùng duyệt — server đã bị tắt, cần xác nhận lại.')
      }
      res.writeHead(upstream.status, outHeaders)
      return void res.end(text)
    }

    res.writeHead(upstream.status, outHeaders)
    if (!upstream.body) return void res.end()
    Readable.fromWeb(upstream.body as unknown as NodeReadableStream)
      .on('error', () => res.end())
      .pipe(res)
  }
}

function rpcError(res: ServerResponse, id: RpcMessage['id'] | null, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32001, message } }))
}

/** Đọc thân yêu cầu (≤ 4 MB); quá → undefined. */
function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        resolve(undefined)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Lấy `result.tools` của đúng phản hồi (JSON hoặc SSE). Không đọc được → null (proxy chặn, không cho qua). */
export function toolsFrom(text: string, contentType: string, id: RpcMessage['id'] | null): ToolDef[] | null {
  const candidates: unknown[] = []
  if (contentType.includes('text/event-stream')) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      try {
        candidates.push(JSON.parse(data))
      } catch {
        /* bỏ qua sự kiện hỏng */
      }
    }
  } else {
    try {
      const parsed = JSON.parse(text) as unknown
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]))
    } catch {
      return null
    }
  }
  for (const c of candidates) {
    const msg = c as { id?: unknown; result?: { tools?: unknown } }
    if (msg && msg.id === id && Array.isArray(msg.result?.tools))
      return (msg.result.tools as ToolDef[]).filter((t) => t && typeof t.name === 'string')
  }
  return null
}
