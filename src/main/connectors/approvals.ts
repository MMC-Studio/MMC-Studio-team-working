import { randomUUID } from 'node:crypto'
import type { DraftApprovalRequest, DraftDecision } from '@shared/connectors'
import type { ActionLogDecision } from '@shared/actionLog'
import { ApprovalTimer, type ApprovalTimerOptions } from '../approvals/timer'
import type { RecordAction } from '../audit/actionLog'

export type DraftVerdict = { approve: true; body: string } | { approve: false; reason: string }
type Pending = DraftApprovalRequest & {
  conversationId: string
  resolve(v: DraftVerdict): void
  timer: ApprovalTimer
}

/** Dòng nhật ký của một nháp: dịch vụ, tài khoản (Gmail), người nhận / tên chat — không tiêu đề, không nội dung. */
export function draftTarget(d: Pick<DraftApprovalRequest, 'service' | 'target' | 'account'>): string {
  const service = d.service === 'gmail' ? 'Gmail' : 'Telegram'
  return `${service}${d.account ? ` (${d.account.email})` : ''} → ${d.target}`
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
      log: { info(msg: string): void; warn?(msg: string): void }
      /** Nhật ký thao tác: dịch vụ + người nhận / tên chat, không nội dung nháp. */
      record?: RecordAction
      timer?: ApprovalTimerOptions
    }
  ) {}

  request(conversationId: string, draft: Omit<DraftApprovalRequest, 'id'>): Promise<DraftVerdict> {
    const id = randomUUID()
    return new Promise<DraftVerdict>((resolve) => {
      const timer = new ApprovalTimer(
        () => this.settle(id, { approve: false, reason: 'Hết thời gian chờ người dùng duyệt.' }, 'timeout'),
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
          },
      decision.approve ? 'approved' : 'rejected',
      decision.approve && decision.body?.trim() && decision.body !== p.body ? 'edited' : undefined
    )
  }

  cancelConversation(conversationId: string): void {
    for (const [id, p] of this.pending)
      if (p.conversationId === conversationId)
        this.settle(id, { approve: false, reason: 'Đã dừng.' }, 'stopped')
  }

  cancelService(service: DraftApprovalRequest['service']): void {
    for (const [id, p] of this.pending)
      if (p.service === service) this.settle(id, { approve: false, reason: 'Kết nối đã tắt.' }, 'stopped', 'connector_disabled')
  }

  /** Gmail: tắt / ngắt MỘT tài khoản → huỷ nháp chờ duyệt của riêng tài khoản đó. */
  cancelAccount(accountId: string): void {
    for (const [id, p] of this.pending)
      if (p.account?.id === accountId)
        this.settle(id, { approve: false, reason: 'Tài khoản đã tắt / ngắt kết nối.' }, 'stopped', 'account_disabled')
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()])
      this.settle(id, { approve: false, reason: 'Đã dừng.' }, 'stopped')
  }

  private settle(id: string, v: DraftVerdict, outcome: ActionLogDecision, detail?: string): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    p.timer.clear()
    this.pending.delete(id)
    // Đóng thẻ (hết giờ / dừng chat / đã trả lời).
    this.deps.emit({ id, closed: true })
    try {
      this.deps.record?.({ conversationId: p.conversationId || null, kind: 'draft', target: draftTarget(p), decision: outcome, detail })
    } catch (err) {
      this.deps.log.warn?.(`Ghi nhật ký nháp lỗi: ${String(err)}`)
    }
    p.resolve(v)
    return true
  }
}
