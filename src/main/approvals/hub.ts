import {
  APPROVAL_MAX_QUESTIONS,
  type ApprovalAskResult,
  type ApprovalCard,
  type ApprovalDelta,
  type ApprovalPastVersion,
  questionCount,
  splitRevisionHint
} from '@shared/approvals'

/** Gọi Claude để trả lời một câu hỏi về thẻ (không tool). Trả `{ error }` khi lỗi. */
export type ApprovalAnswerer = (
  card: ApprovalCard,
  question: string,
  onText: (answer: string) => void,
  signal: AbortSignal
) => Promise<{ error?: string }>

export type ApprovalHubDeps = {
  /** Danh sách thẻ / đoạn hỏi đáp đổi → báo sync `approvals`. */
  changed(): void
  /** Câu trả lời đang stream. */
  delta(d: ApprovalDelta): void
  answer: ApprovalAnswerer
  log: { warn(msg: string): void }
  maxQuestions?: number
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Entry = { card: ApprovalCard; touch(): boolean; abort: AbortController | null }

/**
 * Nơi tập trung mọi thẻ đang chờ duyệt (sửa file, xin quyền thư mục, nháp Gmail / Telegram) để hiện trong
 * khung chat, và chạy "Hỏi lại". Hub KHÔNG quyết định thay người dùng: đồng ý / từ chối vẫn đi qua
 * `respond` của từng loại thẻ; hub chỉ gia hạn chờ (`touch`) sau mỗi câu trả lời.
 */
export class ApprovalHub {
  private entries = new Map<string, Entry>()
  /** `<cuộc>:<loại>` → bản tiếp theo + các bản trước (kèm hỏi đáp, yêu cầu sửa), chờ đề xuất mới trong cùng lượt. */
  private revisions = new Map<string, { version: number; history: ApprovalPastVersion[]; chainId: string }>()

  constructor(private readonly deps: ApprovalHubDeps) {}

  /** `touch` gia hạn chờ của thẻ ở nơi giữ nó; trả false nếu thẻ không còn. */
  add(
    card: DistributiveOmit<ApprovalCard, 'qa' | 'createdAt' | 'version' | 'history' | 'chainId' | 'revising'>,
    touch: () => boolean
  ): void {
    const key = `${card.conversationId}:${card.kind}`
    const revision = this.revisions.get(key)
    this.revisions.delete(key)
    // Bản mới thay thẻ "đang chờ bản tiếp theo" của cùng chuỗi.
    if (revision) this.dropWaiting((c) => c.chainId === revision.chainId)
    this.entries.set(card.id, {
      card: {
        ...card,
        qa: [],
        createdAt: Date.now(),
        version: revision?.version ?? 1,
        // Bản mới nối tiếp chuỗi của bản trước: cùng một thẻ, xem lại được các bản cũ + hỏi đáp.
        history: revision?.history ?? [],
        chainId: revision?.chainId ?? card.id,
        revising: null
      } as ApprovalCard,
      touch,
      abort: null
    })
    this.deps.changed()
  }

  /**
   * Người dùng bấm "Yêu cầu sửa" (bên trong là từ chối kèm góp ý): đề xuất cùng loại tiếp theo của cuộc này
   * là bản kế tiếp và mang theo bản này (nội dung, hỏi đáp đã xong, yêu cầu sửa). Gọi TRƯỚC khi trả lời lượt
   * đang chờ (trợ lý có thể đề xuất lại ngay).
   */
  markRevised(id: string, note: string): void {
    const card = this.entries.get(id)?.card
    if (!card) return
    const past: ApprovalPastVersion = {
      version: card.version,
      request: card.request,
      // Câu đang trả lời dở bị huỷ khi thẻ đóng → không mang sang.
      qa: card.qa.filter((q) => q.status !== 'answering').map((q) => ({ ...q })),
      revision: note
    }
    this.revisions.set(`${card.conversationId}:${card.kind}`, {
      version: card.version + 1,
      history: [...(card.history as ApprovalPastVersion[]), past],
      chainId: card.chainId
    })
    // Khi lượt đang chờ đóng thẻ này, giữ lại ở trạng thái "đang chờ bản tiếp theo" (thẻ không biến mất).
    card.revising = note
  }

  /**
   * Hết lượt chat → bỏ ghi nhận "Yêu cầu sửa" chưa có đề xuất mới và thẻ đang chờ bản tiếp theo
   * (trợ lý không đề xuất lại; lượt sau bắt đầu lại từ bản 1).
   */
  endRun(conversationId: string): void {
    for (const key of this.revisions.keys()) if (key.startsWith(`${conversationId}:`)) this.revisions.delete(key)
    this.dropWaiting((c) => c.conversationId === conversationId)
  }

  /** Thẻ đóng (đã trả lời / hết hạn / dừng). Thẻ vừa "Yêu cầu sửa" thì ở lại chờ bản tiếp theo. */
  remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.abort?.abort()
    entry.abort = null
    if (entry.card.revising !== null && this.revisions.has(`${entry.card.conversationId}:${entry.card.kind}`)) {
      entry.touch = () => false
    } else this.entries.delete(id)
    this.deps.changed()
  }

  private dropWaiting(match: (card: ApprovalCard) => boolean): void {
    let dropped = false
    for (const [id, e] of this.entries)
      if (e.card.revising !== null && match(e.card)) {
        this.entries.delete(id)
        dropped = true
      }
    if (dropped) this.deps.changed()
  }

  list(): ApprovalCard[] {
    return [...this.entries.values()].map((e) => e.card).sort((a, b) => a.createdAt - b.createdAt)
  }

  get(id: string): ApprovalCard | null {
    return this.entries.get(id)?.card ?? null
  }

  /** Bắt đầu trả lời (chạy nền); kết quả hiện qua `changed` / `delta`. */
  ask(id: string, question: string): ApprovalAskResult {
    const entry = this.entries.get(id)
    if (!entry) return { status: 'expired' }
    const { card } = entry
    if (card.revising !== null) return { status: 'expired' }
    if (entry.abort) return { status: 'busy' }
    // Giới hạn tính cho cả chuỗi các bản.
    if (questionCount(card) >= (this.deps.maxQuestions ?? APPROVAL_MAX_QUESTIONS)) return { status: 'limit' }
    const index = card.qa.length
    // Bản sao trước khi thêm câu mới: prompt chỉ kèm các câu đã hỏi trước đó.
    const snapshot = { ...card, qa: [...card.qa] } as ApprovalCard
    card.qa.push({ question, answer: '', status: 'answering' })
    const abort = new AbortController()
    entry.abort = abort
    entry.touch()
    this.deps.changed()
    void this.run(entry, snapshot, index, question, abort)
    return { status: 'started' }
  }

  private async run(entry: Entry, snapshot: ApprovalCard, index: number, question: string, abort: AbortController): Promise<void> {
    const qa = entry.card.qa[index]
    let fullText = ''
    let result: { error?: string }
    try {
      result = await this.deps.answer(
        snapshot,
        question,
        (raw) => {
          qa.answer = splitRevisionHint(raw).text
          fullText = raw
          this.deps.delta({ id: entry.card.id, index, answer: qa.answer })
        },
        abort.signal
      )
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) }
    }
    // Thẻ đã đóng trong lúc trả lời → bỏ.
    if (abort.signal.aborted || this.entries.get(entry.card.id) !== entry) return
    entry.abort = null
    if (result.error) {
      this.deps.log.warn(`Hỏi lại thẻ duyệt lỗi: ${result.error}`)
      qa.status = 'error'
      qa.answer = result.error
    } else {
      qa.status = 'done'
      const { text, suggest } = splitRevisionHint(fullText)
      qa.answer = text.trim()
      if (suggest) qa.suggestRevision = true
    }
    // Mỗi câu trả lời tính lại hạn chờ (tối đa 30 phút kể từ lúc tạo thẻ).
    entry.touch()
    this.deps.changed()
  }
}
