import { randomUUID } from 'node:crypto'
import type { McpReviewResult } from '@shared/agents'
import { toolHashes } from './fingerprint'
import { listServerTools } from './review'
import type { McpServerStore } from './store'
import type { FetchLike } from './upstream'

const REVIEW_TTL_MS = 10 * 60 * 1000

/**
 * Bật MCP server từ kho lần đầu (hoặc sau khi URL / danh sách tool đổi): app kết nối, lấy danh sách tool + mô tả cho
 * người dùng xem; bấm Bật → lưu đúng dấu của danh sách VỪA XEM (token), không lấy lại.
 */
export class McpReviews {
  private pending = new Map<string, { id: string; hashes: Record<string, string>; at: number }>()

  constructor(
    private readonly deps: {
      store: Pick<McpServerStore, 'reviewTarget' | 'approvedHashes' | 'approveTools'>
      fetch: FetchLike
      log: { info(msg: string): void; warn(msg: string): void }
      now?(): number
    }
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  async review(id: string): Promise<McpReviewResult> {
    const target = this.deps.store.reviewTarget(id)
    if (!target) return { status: 'error', error: 'not_found' }
    if (target.missing.length) return { status: 'error', error: 'needs_secret', detail: target.missing.join(', ') }
    const r = await listServerTools({ url: target.url, host: target.host, secretHeaders: target.secretHeaders, needsHeaders: target.needsHeaders, fetch: this.deps.fetch })
    if (r.status === 'error') {
      this.deps.log.warn(`MCP từ kho: xem tool của ${target.host} lỗi: ${r.error} ${r.detail ?? ''}`)
      return { status: 'error', error: r.error, detail: r.detail }
    }
    const hashes = toolHashes(r.tools)
    const before = this.deps.store.approvedHashes(id)
    for (const [k, v] of this.pending) if (this.now() - v.at > REVIEW_TTL_MS || v.id === id) this.pending.delete(k)
    const token = randomUUID()
    this.pending.set(token, { id, hashes, at: this.now() })
    return {
      status: 'ok',
      token,
      host: target.host,
      url: target.url,
      tools: r.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? null, changed: !!before && before[t.name] !== hashes[t.name] }))
    }
  }

  /** Người dùng bấm Bật sau khi xem. Token hết hạn / sai → false (phải xem lại). */
  approve(token: string): boolean {
    const p = this.pending.get(token)
    this.pending.delete(token)
    if (!p || this.now() - p.at > REVIEW_TTL_MS) return false
    this.deps.store.approveTools(p.id, p.hashes)
    this.deps.log.info(`MCP từ kho: đã duyệt ${Object.keys(p.hashes).length} tool, bật server ${p.id}`)
    return true
  }
}
