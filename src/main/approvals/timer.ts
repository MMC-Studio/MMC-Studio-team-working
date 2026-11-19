import { APPROVAL_IDLE_MS, APPROVAL_MAX_MS } from '@shared/approvals'

export type ApprovalTimerOptions = { idleMs?: number; maxMs?: number }

/**
 * Hạn chờ của một thẻ duyệt: hết `idleMs` không có gì mới → hết hạn; `touch()` (sau mỗi câu trả lời
 * của "Hỏi lại") tính lại từ đầu, nhưng không bao giờ vượt `maxMs` kể từ lúc tạo thẻ.
 */
export class ApprovalTimer {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly deadline: number
  private readonly idleMs: number

  constructor(
    private readonly onExpire: () => void,
    opts: ApprovalTimerOptions = {}
  ) {
    this.idleMs = opts.idleMs ?? APPROVAL_IDLE_MS
    this.deadline = Date.now() + (opts.maxMs ?? APPROVAL_MAX_MS)
    this.touch()
  }

  touch(): void {
    this.clear()
    const wait = Math.max(0, Math.min(this.idleMs, this.deadline - Date.now()))
    this.timer = setTimeout(() => {
      this.timer = null
      this.onExpire()
    }, wait)
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
