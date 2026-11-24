import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { MAX_EXTRA_DIRS, type Conversation, type FolderAccessClosed, type FolderAccessRequest, type FolderAccessResult } from '@shared/types'
import { ApprovalTimer, type ApprovalTimerOptions } from '../approvals/timer'
import type { AppToolRegistry, ToolSet } from '../tools/registry'

type Verdict = { granted: true; path: string; write: boolean; extra: boolean } | { granted: false; reason: string }
type Pending = FolderAccessRequest & { resolve(v: Verdict): void; timer: ApprovalTimer }

export type FolderAccessDeps = {
  getConversation(id: string): Conversation | null
  /** Mở hộp chọn thư mục (gợi ý sẵn đường dẫn); null = người dùng huỷ. */
  pickFolder(suggestedPath: string | null): Promise<string | null>
  /** Gắn thư mục + quyền sửa cho hội thoại (đổi thư mục luôn reset quyền sửa trước). */
  grant(conversationId: string, path: string, write: boolean): Conversation | null | Promise<Conversation | null>
  /**
   * Gắn thư mục phụ (D, chỉ đọc) sau khi kiểm vùng cấm / chồng lấn / giới hạn. Thư mục không dùng được → ném Error có
   * mã (thẻ vẫn chờ, người dùng chọn lại).
   */
  grantExtra?(conversationId: string, path: string): Promise<Conversation | null>
  emit(event: FolderAccessRequest | FolderAccessClosed): void
  log: { info(msg: string): void }
  timer?: ApprovalTimerOptions
}

export const FOLDER_TOOL = 'request_folder_access'

const input = z.object({
  path: z.string().max(1000).optional().describe('Đường dẫn người dùng nhắc tới (vd D:\\unity\\3DCo_Ban), nếu có.'),
  write: z.boolean().default(false).describe('true nếu cần SỬA file (mỗi thay đổi người dùng vẫn duyệt diff); chỉ đọc thì false.'),
  reason: z.string().min(1).max(300).describe('Một câu ngắn: cần thư mục này để làm gì.'),
  extra: z
    .boolean()
    .default(false)
    .describe(`true = xin THÊM một thư mục phụ (tối đa ${MAX_EXTRA_DIRS}, luôn chỉ đọc) khi đã có thư mục dự án và cần đọc thêm thư mục khác.`)
})

const NO_FOLDER_CONTEXT = `## Truy cập thư mục trên máy
Bạn CHƯA đọc được file trên máy người dùng. Khi người dùng nhắc tới file / thư mục / dự án trên máy (code, Unity, Blender, DaVinci…) hoặc muốn bạn xem / sửa nó: gọi ${FOLDER_TOOL} (kèm path nếu họ nêu) — KHÔNG bảo họ copy-dán và KHÔNG nói là không làm được. Người dùng sẽ tự chọn thư mục để cấp quyền.`

const READ_ONLY_CONTEXT = `Nếu cần sửa file mà đang chỉ có quyền đọc: gọi ${FOLDER_TOOL} với write=true.`

const EXTRA_CONTEXT = `Cần đọc file ở một thư mục KHÁC ngoài thư mục dự án: gọi ${FOLDER_TOOL} với extra=true (thư mục phụ, chỉ đọc; người dùng tự chọn và tự bật sửa nếu muốn). Không xin thư mục hệ thống / cả ổ đĩa / cả thư mục người dùng — app sẽ chặn.`

/**
 * Trợ lý tự xin quyền thư mục: tool `request_folder_access` hiện thẻ cho người dùng; quyền chỉ có khi
 * người dùng TỰ chọn thư mục trong hộp thoại của hệ điều hành (đường dẫn trợ lý đưa chỉ là gợi ý) —
 * nên nội dung lạ (web, email…) không thể khiến trợ lý tự mở thư mục.
 * Tool CLI cố định theo từng lượt → quyền mới có hiệu lực từ lượt sau; renderer tự gửi lượt "tiếp tục".
 */
export class FolderAccessRequests {
  private pending = new Map<string, Pending>()

  constructor(private readonly deps: FolderAccessDeps) {}

  /** Tool + hướng dẫn cho lượt chat; đã có quyền sửa và đủ thư mục phụ → không cần tool. */
  toolsFor(conversationId: string): ToolSet | null {
    const conv = this.deps.getConversation(conversationId)
    if (!conv) return null
    if (!conv.cwd) return { names: [FOLDER_TOOL], context: NO_FOLDER_CONTEXT }
    const canAddExtra = conv.extraDirs.length < MAX_EXTRA_DIRS
    const context = [conv.codeWrite ? '' : READ_ONLY_CONTEXT, canAddExtra ? EXTRA_CONTEXT : ''].filter(Boolean).join('\n')
    return context ? { names: [FOLDER_TOOL], context } : null
  }

  registerTools(registry: AppToolRegistry): void {
    registry.register({
      name: FOLDER_TOOL,
      description:
        'Xin người dùng quyền đọc (write=false) hoặc đọc + sửa (write=true) một thư mục trên máy. Người dùng tự chọn thư mục; ' +
        'quyền có hiệu lực từ lượt sau — khi được cấp, kết thúc câu trả lời bằng một câu ngắn, app sẽ tự tiếp tục.',
      input,
      available: (ctx) => this.toolsFor(ctx.conversationId) !== null,
      run: async (args, ctx) => {
        const conv = this.deps.getConversation(ctx.conversationId)
        // Thư mục phụ chỉ khi đã có thư mục chính; chưa có thì xin như thư mục chính.
        const extra = args.extra && !!conv?.cwd
        if (extra && conv && conv.extraDirs.length >= MAX_EXTRA_DIRS)
          return { content: [{ type: 'text', text: `Cuộc này đã có đủ ${MAX_EXTRA_DIRS} thư mục phụ — không thêm được nữa.` }] }
        const verdict = await this.request(ctx.conversationId, {
          suggestedPath: args.path?.trim() || null,
          write: extra ? false : args.write,
          reason: args.reason,
          ...(extra ? { extra: true } : {})
        })
        if (!verdict.granted) return { content: [{ type: 'text', text: verdict.reason }] }
        if (verdict.extra)
          return {
            content: [
              {
                type: 'text',
                text:
                  `Người dùng đã thêm thư mục phụ (chỉ đọc): ${verdict.path}. Đọc được từ lượt sau, dùng đường dẫn tuyệt đối. ` +
                  'Hãy KẾT THÚC câu trả lời ngay bằng một câu ngắn — app sẽ tự gửi lượt tiếp theo.'
              }
            ]
          }
        const level = verdict.write ? 'đọc + sửa (mỗi thay đổi người dùng duyệt diff)' : 'chỉ đọc'
        return {
          content: [
            {
              type: 'text',
              text:
                `Người dùng đã cấp quyền ${level} thư mục: ${verdict.path}. Công cụ đọc/sửa file có từ lượt sau. ` +
                'Hãy KẾT THÚC câu trả lời ngay bằng một câu ngắn (vd "Có quyền rồi, mình xem ngay nhé") — app sẽ tự gửi lượt tiếp theo.'
            }
          ]
        }
      }
    })
  }

  request(conversationId: string, req: Omit<FolderAccessRequest, 'id' | 'conversationId'>): Promise<Verdict> {
    // Mỗi hội thoại chỉ một thẻ xin quyền cùng lúc.
    this.cancelConversation(conversationId)
    const id = randomUUID()
    return new Promise<Verdict>((resolve) => {
      const timer = new ApprovalTimer(
        () => this.settle(id, { granted: false, reason: 'Hết thời gian chờ người dùng cấp quyền.' }),
        this.deps.timer
      )
      const full: FolderAccessRequest = { id, conversationId, ...req }
      this.pending.set(id, { ...full, resolve, timer })
      this.deps.emit(full)
    })
  }

  /** "Hỏi lại" vừa trả lời → tính lại hạn chờ. */
  touch(id: string): boolean {
    const p = this.pending.get(id)
    p?.timer.touch()
    return !!p
  }

  /**
   * Người dùng bấm Từ chối (có thể kèm góp ý), hoặc Chọn thư mục (mở hộp thoại; huỷ hộp thoại → thẻ vẫn chờ).
   */
  async respond(id: string, grant: boolean, write: boolean, feedback?: string): Promise<FolderAccessResult> {
    const p = this.pending.get(id)
    if (!p) return { status: 'expired' }
    if (!grant) {
      const note = feedback?.trim()
      this.settle(id, {
        granted: false,
        reason: note
          ? `Người dùng từ chối cấp quyền thư mục và góp ý: "${note}". Hãy làm theo góp ý (nếu cần thư mục / mức quyền khác thì xin lại đúng như vậy).`
          : 'Người dùng từ chối cấp quyền thư mục. Đừng hỏi lại trong lượt này.'
      })
      return { status: 'denied' }
    }
    const path = await this.deps.pickFolder(p.suggestedPath)
    if (!path) return { status: 'pending' }
    // Trong lúc mở hộp thoại, lượt chat có thể đã dừng.
    if (!this.pending.has(id)) return { status: 'expired' }
    const extra = !!p.extra
    let conversation: Conversation | null
    try {
      // Thư mục phụ luôn chỉ đọc (người dùng tự tick sửa trên thanh thư mục); thư mục chính theo ô "Cho phép sửa".
      const { grantExtra } = this.deps
      if (!extra) conversation = await this.deps.grant(p.conversationId, path, write)
      else if (grantExtra) conversation = await grantExtra(p.conversationId, path)
      else throw new Error('extra_no_main')
    } catch (err) {
      // Thư mục bị cấm / chồng lấn → thẻ vẫn chờ, renderer báo lý do để người dùng chọn lại.
      return { status: 'pending', error: (err as Error).message }
    }
    if (!this.pending.has(id)) return { status: 'expired' }
    if (!conversation) {
      this.settle(id, { granted: false, reason: 'Không tìm thấy cuộc trò chuyện.' })
      return { status: 'expired' }
    }
    const granted = extra ? false : write
    this.deps.log.info(`Cấp quyền thư mục${extra ? ' phụ' : ''} (${granted ? 'đọc + sửa' : 'chỉ đọc'}) cho hội thoại ${p.conversationId}`)
    this.settle(id, { granted: true, path, write: granted, extra })
    return { status: 'granted', conversation }
  }

  cancelConversation(conversationId: string): void {
    for (const [id, p] of this.pending)
      if (p.conversationId === conversationId) this.settle(id, { granted: false, reason: 'Đã dừng.' })
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { granted: false, reason: 'App đang đóng.' })
  }

  private settle(id: string, v: Verdict): void {
    const p = this.pending.get(id)
    if (!p) return
    p.timer.clear()
    this.pending.delete(id)
    // Luôn báo đóng thẻ (hết giờ, dừng lượt…) để thẻ không treo; renderer bỏ qua nếu đã đóng.
    this.deps.emit({ id, closed: true })
    p.resolve(v)
  }
}
