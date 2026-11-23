import { randomUUID } from 'node:crypto'
import type { ActionLogDecision } from '@shared/actionLog'
import type { McpApprovalDecision, McpApprovalRequest } from '@shared/agents'
import type { RecordAction } from '../audit/actionLog'
import type { McpServerStore } from './store'

type Decision = { allow: boolean; message?: string }
type Pending = McpApprovalRequest & { conversationId: string; resolve(d: Decision): void; timer: ReturnType<typeof setTimeout> }

const TIMEOUT_MS = 10 * 60 * 1000

/** "mcp__<server>__<tool>" → { server, tool }. Tên server không chứa "__" (zod chặn lúc thêm). */
export function parseToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__([a-z0-9][a-z0-9_-]*?)__(.+)$/.exec(name)
  return m ? { server: m[1], tool: m[2] } : null
}

/**
 * Duyệt từng lần Mizuki gọi tool của MCP server người dùng thêm. "Luôn cho phép" ghi tool vào danh sách
 * tự duyệt của server (thu hồi được trong trang Kết nối agent). Không phản hồi trong 10 phút → từ chối.
 * Mọi lần gọi vào nhật ký thao tác (chỉ tên server / tool, không tham số) — kể cả lần CLI tự chạy vì "luôn cho phép".
 */
export class McpApprovals {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly deps: {
      store: Pick<McpServerStore, 'isUserServer' | 'allowAlways' | 'originOf'>
      emit(req: McpApprovalRequest): void
      log: { info(msg: string): void; warn(msg: string): void }
      record?: RecordAction
      timeoutMs?: number
    }
  ) {}

  request(conversationId: string, toolName: string, input: unknown): Promise<Decision> {
    const parsed = parseToolName(toolName)
    if (!parsed || !this.deps.store.isUserServer(parsed.server)) {
      this.deps.log.warn(`MCP: từ chối tự động tool lạ ${toolName}`)
      this.write(conversationId, parsed ? `${parsed.server}/${parsed.tool}` : toolName, 'blocked', 'unknown_server')
      return Promise.resolve({ allow: false, message: 'Tool này không thuộc MCP server nào người dùng đã thêm.' })
    }
    const id = randomUUID()
    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(
        () => this.settle(id, { allow: false, message: 'Hết thời gian chờ người dùng duyệt.' }, 'timeout'),
        this.deps.timeoutMs ?? TIMEOUT_MS
      )
      const origin = this.deps.store.originOf(parsed.server)
      this.pending.set(id, { id, conversationId, server: parsed.server, tool: parsed.tool, input, origin, resolve, timer })
      this.deps.emit({ id, server: parsed.server, tool: parsed.tool, input, origin })
    })
  }

  /**
   * CLI vừa gọi một tool MCP không qua bước duyệt (tool nằm trong "luôn cho phép" của lượt này) → ghi `auto`.
   * Chỉ ghi tool của server người dùng thêm (không ghi tool của app `mcp__mmc__*`).
   */
  recordAuto(conversationId: string, toolName: string): void {
    const parsed = parseToolName(toolName)
    if (!parsed || !this.deps.store.isUserServer(parsed.server)) return
    this.write(conversationId, `${parsed.server}/${parsed.tool}`, 'auto', 'always_allow')
  }

  respond(id: string, decision: McpApprovalDecision): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    // Server từ kho: không có "luôn cho phép" — coi như cho phép một lần.
    const always = decision === 'always' && !p.origin
    if (always) this.deps.store.allowAlways(p.server, p.tool)
    this.deps.log.info(`MCP: ${decision} ${p.server}/${p.tool}`)
    return decision === 'deny'
      ? this.settle(id, { allow: false, message: 'Người dùng đã từ chối lần gọi tool này.' }, 'rejected')
      : this.settle(id, { allow: true }, 'approved', always ? 'always_allow_set' : undefined)
  }

  cancelConversation(conversationId: string): void {
    for (const [id, p] of this.pending) if (p.conversationId === conversationId) this.settle(id, { allow: false, message: 'Đã dừng.' }, 'stopped')
  }

  /** Gỡ plugin / tắt server: huỷ mọi thẻ duyệt đang chờ của server đó. */
  cancelServer(server: string): void {
    for (const [id, p] of this.pending)
      if (p.server === server) this.settle(id, { allow: false, message: 'MCP server đã bị gỡ.' }, 'stopped', 'server_removed')
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { allow: false, message: 'Đã dừng.' }, 'stopped')
  }

  private write(conversationId: string, target: string, decision: ActionLogDecision, detail?: string): void {
    try {
      this.deps.record?.({ conversationId: conversationId || null, kind: 'mcp', target, decision, detail })
    } catch (err) {
      this.deps.log.warn(`Ghi nhật ký MCP lỗi: ${String(err)}`)
    }
  }

  private settle(id: string, d: Decision, outcome: ActionLogDecision, detail?: string): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    this.write(p.conversationId, `${p.server}/${p.tool}`, outcome, detail)
    p.resolve(d)
    return true
  }
}
