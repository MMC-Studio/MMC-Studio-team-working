import { randomUUID } from 'node:crypto'
import type { DraftApprovalRequest, DraftDecision } from '@shared/connectors'
import { ApprovalTimer, type ApprovalTimerOptions } from '../approvals/timer'

export type DraftVerdict = { approve: true; body: string } | { approve: false; reason: string }
type Pending = DraftApprovalRequest & {
  conversationId: string
  resolve(v: DraftVerdict): void
  timer: ApprovalTimer
}

/**
 * Mỗi bản nháp trợ lý muốn tạo (Gmail / Telegram) phải được người dùng xem — có thể sửa nội dung — rồi mới tạo.
 * Không phản hồi trong 10 phút (tối đa 30 phút nếu đang hỏi lại), dừng lượt chat hoặc tắt kết nối → coi như từ chối.
 */
export class DraftApprovals {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly deps: {
      emit(req: (DraftApprovalRequest & { conversationId: string }) | { id: string; closed: true }): void
      log: { info(msg: string): void }
      timer?: ApprovalTimerOptions
    }
  ) {}

  request(conversationId: string, draft: Omit<DraftApprovalRequest, 'id'>): Promise<DraftVerdict> {
    const id = randomUUID()
    return new Promise<DraftVerdict>((resolve) => {
      const timer = new ApprovalTimer(
        () => this.settle(id, { approve: false, reason: 'Hết thời gian chờ người dùng duyệt.' }),
        this.deps.timer
      )
      const req: DraftApprovalRequest = { id, ...draft }
      this.pending.set(id, { ...req, conversationId, resolve, timer })
      this.deps.emit({ ...req, conversationId })
    })
  }

  /** "Hỏi lại" vừa trả lời → tính lại hạn chờ. */
  touch(id: string): boolean {
    const p = this.pending.get(id)
    p?.timer.touch()
    return !!p
  }

  respond(decision: DraftDecision): boolean {
    const p = this.pending.get(decision.id)
    if (!p) return false
    this.deps.log.info(`Nháp ${p.service}: ${decision.approve ? 'duyệt' : 'từ chối'}`)
    const body = decision.body?.trim() ? decision.body : p.body
    const note = decision.feedback?.trim()
    return this.settle(
      decision.id,
      decision.approve
        ? { approve: true, body }
        : {
            approve: false,
            reason: note
              ? `Người dùng đã từ chối bản nháp này và góp ý: "${note}". Hãy soạn lại theo góp ý rồi đề xuất nháp mới (người dùng sẽ duyệt lại).`
              : 'Người dùng đã từ chối bản nháp này.'
          }
    )
  }

  cancelConversation(conversationId: string): void {
    for (const [id, p] of this.pending)
      if (p.conversationId === conversationId)
        this.settle(id, { approve: false, reason: 'Đã dừng.' })
  }

  cancelService(service: DraftApprovalRequest['service']): void {
    for (const [id, p] of this.pending)
      if (p.service === service) this.settle(id, { approve: false, reason: 'Kết nối đã tắt.' })
  }

  /** Gmail: tắt / ngắt MỘT tài khoản → huỷ nháp chờ duyệt của riêng tài khoản đó. */
  cancelAccount(accountId: string): void {
    for (const [id, p] of this.pending)
      if (p.account?.id === accountId)
        this.settle(id, { approve: false, reason: 'Tài khoản đã tắt / ngắt kết nối.' })
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()])
      this.settle(id, { approve: false, reason: 'Đã dừng.' })
  }

  private settle(id: string, v: DraftVerdict): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    p.timer.clear()
    this.pending.delete(id)
    // Đóng thẻ (hết giờ / dừng chat / đã trả lời).
    this.deps.emit({ id, closed: true })
    p.resolve(v)
    return true
  }
}
