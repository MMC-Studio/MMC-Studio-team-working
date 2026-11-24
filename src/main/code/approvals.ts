import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, isAbsolute } from 'node:path'
import { APP_NAME } from '@shared/appConfig'
import type { CodeApprovalRequest, ExtraFolder } from '@shared/types'
import type { ActionLogDecision } from '@shared/actionLog'
import { ApprovalTimer, type ApprovalTimerOptions } from '../approvals/timer'
import type { RecordAction } from '../audit/actionLog'
import type { AutoEdits } from './autoEdits'
import { inspectChange, insideProject, type ChangeError } from './change'

export type ApprovalDeps = {
  /** Thư mục dự án của hội thoại nếu chế độ Code đang BẬT quyền sửa; null = không được phép. */
  writableRoot(conversationId: string): string | null
  /**
   * Thư mục phụ của hội thoại (D). File nằm trong thư mục phụ → chỉ sửa được khi thư mục đó tick "Cho phép sửa", và
   * LUÔN hỏi (không tự duyệt). Không có = không có thư mục phụ.
   */
  extraDirs?(conversationId: string): ExtraFolder[]
  emit(request: CodeApprovalRequest): void
  /** Thẻ đóng (đã trả lời, hết hạn, dừng lượt…). */
  closed?(id: string): void
  /** Duyệt lần gọi tool của MCP server người dùng thêm (mcp__<server>__<tool>). */
  mcpApproval?(conversationId: string, toolName: string, input: unknown): Promise<Decision>
  log: { warn(msg: string): void }
  /** Nhật ký thao tác (chỉ đường dẫn file, không nội dung). */
  record?: RecordAction
  timer?: ApprovalTimerOptions
  /** Phiên tự duyệt sửa file (PR C). Không có = luôn hỏi, thẻ không có nút tự duyệt. */
  autoEdits?: Pick<AutoEdits, 'tryAuto' | 'offer' | 'start' | 'extraOffer'>
}

export type Decision = { allow: boolean; message?: string }
type Pending = {
  conversationId: string
  path: string
  /** Để "Đồng ý, và không hỏi lại" xem lại lần sửa ngay lúc bấm (file có thể đã đổi từ lúc hiện thẻ). */
  root: string
  /** File trong thư mục phụ (D) — không bao giờ tự duyệt. */
  extra: boolean
  toolName: string
  input: unknown
  resolve(d: Decision): void
  timer: ApprovalTimer
}

/** Đường dẫn trợ lý đưa (để ghi nhật ký khi bị chặn trước khi có diff). */
function inputPath(input: unknown): string {
  const p = input && typeof input === 'object' ? (input as { file_path?: unknown }).file_path : undefined
  return typeof p === 'string' && p ? p : '?'
}

const MAX_BODY = 5 * 1024 * 1024

/** Dòng nhật ký cho file trong thư mục phụ: phân biệt với file cùng tên ở thư mục chính. */
export const extraLogTarget = (folder: string, rel: string): string => `[phụ: ${basename(folder)}] ${rel}`

const REASONS: Record<ChangeError, string> = {
  outside_project: 'Chỉ được sửa file trong thư mục dự án đã chọn.',
  link_outside: 'Đường dẫn đi qua symlink / junction trỏ ra ngoài thư mục dự án — không được sửa.',
  unsupported_tool: `Tool này không được phép trong ${APP_NAME}.`,
  old_string_not_found: 'Không tìm thấy đoạn cần sửa trong file.',
  invalid_input: 'Yêu cầu sửa file không hợp lệ.',
  binary_content: 'File này là nhị phân — sửa bằng văn bản sẽ làm hỏng file.'
}

/** Lời từ chối gửi lại cho Claude; có góp ý → Claude đề xuất bản sửa mới trong cùng lượt. */
export function rejectMessage(feedback?: string): string {
  const text = feedback?.trim()
  if (!text) return 'Người dùng đã từ chối thay đổi này.'
  return `Người dùng đã từ chối thay đổi này và góp ý: "${text}". Hãy sửa lại theo góp ý rồi đề xuất thay đổi mới (người dùng sẽ duyệt lại).`
}

/**
 * Cầu nối duyệt quyền: MCP script (permission-mcp.cjs) gửi yêu cầu Edit/Write về đây,
 * app hiện diff cho người dùng và trả quyết định. Chỉ nghe 127.0.0.1, bắt buộc token.
 */
export class CodeApprovals {
  private server: Server | null = null
  private pending = new Map<string, Pending>()
  readonly token = randomBytes(24).toString('hex')
  url = ''

  constructor(private readonly deps: ApprovalDeps) {}

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/approve') {
        res.writeHead(404).end()
        return
      }
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (c: string) => {
        body += c
        if (body.length > MAX_BODY) req.destroy()
      })
      req.on('end', () => {
        void this.handle(body).then((decision) => {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(decision))
        })
      })
    })
    // Không giới hạn thời gian chờ: người dùng có thể cần vài phút để đọc diff / hỏi lại.
    this.server.requestTimeout = 0
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  private tokenOk(value: unknown): boolean {
    if (typeof value !== 'string' || value.length !== this.token.length) return false
    return timingSafeEqual(Buffer.from(value), Buffer.from(this.token))
  }

  private async handle(raw: string): Promise<Decision> {
    let body: { token?: unknown; conversationId?: unknown; toolName?: unknown; input?: unknown }
    try {
      body = JSON.parse(raw)
    } catch {
      return { allow: false, message: 'invalid_request' }
    }
    if (!this.tokenOk(body.token)) return { allow: false, message: 'invalid_token' }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
    const toolName = typeof body.toolName === 'string' ? body.toolName : ''
    return this.decide(conversationId, toolName, body.input)
  }

  /** Một lần dùng tool cần quyền → chờ người dùng quyết định (Claude giả trong e2e cũng gọi thẳng vào đây). */
  async decide(conversationId: string, toolName: string, input: unknown): Promise<Decision> {
    // Tool của MCP server người dùng thêm → hộp thoại duyệt riêng (không phải diff sửa file).
    if (toolName.startsWith('mcp__')) {
      return this.deps.mcpApproval ? this.deps.mcpApproval(conversationId, toolName, input) : { allow: false, message: 'Không duyệt được tool này.' }
    }
    // Thư mục phụ (D): chỉ đường dẫn tuyệt đối (CLI chạy với cwd = thư mục chính); thư mục không chồng lấn nhau.
    const raw = inputPath(input)
    const extra = isAbsolute(raw) ? (this.deps.extraDirs?.(conversationId) ?? []).find((e) => insideProject(e.path, raw) !== null) : undefined
    if (extra) return this.decideExtra(conversationId, extra, toolName, input)

    const root = this.deps.writableRoot(conversationId)
    if (!root) {
      this.write(conversationId, raw, 'blocked', 'write_disabled')
      return { allow: false, message: 'Chế độ sửa file đang tắt.' }
    }

    const change = await inspectChange(root, toolName, input)
    if ('error' in change) {
      this.deps.log.warn(`Từ chối tự động ${toolName}: ${change.error}`)
      // Trong thư mục → đường dẫn tương đối như các dòng khác của cùng file (không thì nhật ký trông như file ở chỗ khác).
      this.write(conversationId, insideProject(root, raw) ?? raw, 'blocked', change.error)
      return this.refusal(change)
    }

    // Phiên tự duyệt (PR C): đủ điều kiện → cho phép không hỏi (bản gốc đã ghi ra đĩa trước khi trả lời).
    if (await this.deps.autoEdits?.tryAuto(conversationId, root, change)) {
      this.write(conversationId, change.path, 'auto')
      return { allow: true }
    }
    const autoEdit = this.deps.autoEdits?.offer(conversationId, change)
    const view = { path: change.path, isNewFile: change.isNewFile, patch: change.patch, added: change.added, removed: change.removed }
    const id = randomUUID()
    return new Promise<Decision>((resolve) => {
      const timer = new ApprovalTimer(
        () => this.settle(id, { allow: false, message: 'Hết thời gian chờ người dùng duyệt.' }, 'timeout'),
        this.deps.timer
      )
      this.pending.set(id, { conversationId, path: change.path, root, extra: false, toolName, input, resolve, timer })
      this.deps.emit({ id, conversationId, toolName, change: view, ...(autoEdit ? { autoEdit } : {}) })
    })
  }

  private refusal(change: { error: ChangeError } | { error: 'protected_path'; reason: string }): Decision {
    if (change.error === 'protected_path') return { allow: false, message: `Không được sửa file này. ${change.reason}` }
    return { allow: false, message: REASONS[change.error] }
  }

  /**
   * File trong thư mục phụ (D): cần tick "Cho phép sửa" riêng cho thư mục đó; kiểm như thư mục chính (đường dẫn thật,
   * hồ sơ dự án của CHÍNH thư mục phụ, nhị phân) rồi LUÔN hiện thẻ — không tự duyệt, không có nút "không hỏi lại".
   */
  private async decideExtra(conversationId: string, extra: ExtraFolder, toolName: string, input: unknown): Promise<Decision> {
    const raw = inputPath(input)
    const label = extraLogTarget(extra.path, insideProject(extra.path, raw) ?? raw)
    if (!extra.write) {
      this.write(conversationId, label, 'blocked', 'write_disabled')
      return {
        allow: false,
        message: 'Thư mục phụ này chỉ đọc. Người dùng phải tự tick "Cho phép sửa" cho thư mục đó trên thanh thư mục.'
      }
    }
    const change = await inspectChange(extra.path, toolName, input)
    if ('error' in change) {
      this.deps.log.warn(`Từ chối tự động ${toolName} (thư mục phụ): ${change.error}`)
      this.write(conversationId, label, 'blocked', change.error)
      return this.refusal(change)
    }
    const autoEdit = this.deps.autoEdits?.extraOffer(conversationId)
    const view = { path: change.path, isNewFile: change.isNewFile, patch: change.patch, added: change.added, removed: change.removed }
    const id = randomUUID()
    return new Promise<Decision>((resolve) => {
      const timer = new ApprovalTimer(
        () => this.settle(id, { allow: false, message: 'Hết thời gian chờ người dùng duyệt.' }, 'timeout'),
        this.deps.timer
      )
      const path = extraLogTarget(extra.path, change.path)
      this.pending.set(id, { conversationId, path, root: extra.path, extra: true, toolName, input, resolve, timer })
      this.deps.emit({ id, conversationId, toolName, change: view, extraFolder: extra.path, ...(autoEdit ? { autoEdit } : {}) })
    })
  }

  private write(conversationId: string, path: string, decision: ActionLogDecision, detail?: string): void {
    try {
      this.deps.record?.({ conversationId: conversationId || null, kind: 'file_edit', target: path, decision, detail })
    } catch (err) {
      this.deps.log.warn(`Ghi nhật ký sửa file lỗi: ${String(err)}`)
    }
  }

  private settle(id: string, decision: Decision, outcome: ActionLogDecision, detail?: string): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    p.timer.clear()
    this.pending.delete(id)
    this.deps.closed?.(id)
    this.write(p.conversationId, p.path, outcome, detail)
    p.resolve(decision)
    return true
  }

  /** "Hỏi lại" vừa trả lời → tính lại hạn chờ (không quá 30 phút kể từ lúc tạo thẻ). */
  touch(id: string): boolean {
    const p = this.pending.get(id)
    p?.timer.touch()
    return !!p
  }

  /** Người dùng bấm Đồng ý / Từ chối (có thể kèm góp ý). */
  respond(id: string, allow: boolean, feedback?: string): boolean {
    return allow
      ? this.settle(id, { allow: true }, 'approved')
      : this.settle(id, { allow: false, message: rejectMessage(feedback) }, 'rejected')
  }

  /**
   * "Đồng ý, và không hỏi lại trong phiên này" (PR C): xem lại lần sửa NGAY LÚC BẤM (file / quyền có thể đã đổi từ
   * lúc hiện thẻ), mở phiên + giữ bản gốc, rồi mới cho phép. Không còn đủ điều kiện → thẻ vẫn chờ (người dùng bấm
   * Đồng ý thường hoặc Từ chối). Nhật ký: `always` (người dùng bấm — khác `approved` và `auto`).
   */
  async respondAuto(id: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_eligible' | 'changed' }> {
    const p = this.pending.get(id)
    if (!p || !this.deps.autoEdits) return { ok: false, error: 'not_found' }
    // Thẻ của thư mục phụ không có nút này; renderer cũ / gọi thẳng IPC cũng không mở được phiên.
    if (p.extra) return { ok: false, error: 'not_eligible' }
    const root = this.deps.writableRoot(p.conversationId)
    if (!root || root !== p.root) return { ok: false, error: 'changed' }
    const change = await inspectChange(root, p.toolName, p.input)
    if ('error' in change || change.path !== p.path) return { ok: false, error: 'changed' }
    if (!this.pending.has(id)) return { ok: false, error: 'not_found' }
    if (!(await this.deps.autoEdits.start(p.conversationId, root, change))) return { ok: false, error: 'not_eligible' }
    // Thẻ có thể vừa đóng (hết hạn / dừng lượt) trong lúc ghi bản gốc — phiên vẫn mở, lần sửa này không chạy.
    if (!this.settle(id, { allow: true }, 'always')) return { ok: false, error: 'not_found' }
    return { ok: true }
  }

  /** Dừng phản hồi / tắt quyền sửa → từ chối mọi yêu cầu đang chờ của hội thoại. */
  cancelConversation(conversationId: string): void {
    for (const [id, p] of this.pending) if (p.conversationId === conversationId) this.settle(id, { allow: false, message: 'Đã dừng.' }, 'stopped')
  }

  stop(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { allow: false, message: 'App đang đóng.' }, 'stopped')
    this.server?.close()
    this.server = null
  }
}
