import {
  APPROVAL_MAX_QUESTIONS,
  type ApprovalAskResult,
  type ApprovalCard,
  type ApprovalDelta
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

type Entry = { card: ApprovalCard; touch(): boolean; abort: AbortController | null }

/**
 * Nơi tập trung mọi thẻ đang chờ duyệt (sửa file, xin quyền thư mục, nháp Gmail / Telegram) để hiện trong
 * khung chat, và chạy "Hỏi lại". Hub KHÔNG quyết định thay người dùng: đồng ý / từ chối vẫn đi qua
 * `respond` của từng loại thẻ; hub chỉ gia hạn chờ (`touch`) sau mỗi câu trả lời.
 */
export class ApprovalHub {
  private entries = new Map<string, Entry>()
  /** `<cuộc>:<loại>` → bản tiếp theo + yêu cầu sửa, chờ đề xuất mới của trợ lý trong cùng lượt. */
  private revisions = new Map<string, { version: number; note: string }>()

  constructor(private readonly deps: ApprovalHubDeps) {}

  /** `touch` gia hạn chờ của thẻ ở nơi giữ nó; trả false nếu thẻ không còn. */
  add(card: Omit<ApprovalCard, 'qa' | 'createdAt' | 'version' | 'revisionNote'>, touch: () => boolean): void {
    const key = `${card.conversationId}:${card.kind}`
    const revision = this.revisions.get(key)
    this.revisions.delete(key)
    this.entries.set(card.id, {
      card: {
        ...card,
        qa: [],
        createdAt: Date.now(),
        version: revision?.version ?? 1,
        revisionNote: revision?.note ?? null
      } as ApprovalCard,
      touch,
      abort: null
    })
    this.deps.changed()
  }

  /**
   * Người dùng bấm "Yêu cầu sửa" (bên trong là từ chối kèm góp ý): đề xuất cùng loại tiếp theo của cuộc này
   * là bản kế tiếp. Gọi TRƯỚC khi trả lời lượt đang chờ (trợ lý có thể đề xuất lại ngay).
   */
  markRevised(id: string, note: string): void {
    const card = this.entries.get(id)?.card
    if (!card) return
    this.revisions.set(`${card.conversationId}:${card.kind}`, { version: card.version + 1, note })
  }

  /** Hết lượt chat → bỏ ghi nhận "Yêu cầu sửa" chưa có đề xuất mới (lượt sau bắt đầu lại từ bản 1). */
  endRun(conversationId: string): void {
    for (const key of this.revisions.keys()) if (key.startsWith(`${conversationId}:`)) this.revisions.delete(key)
  }

  remove(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.abort?.abort()
    this.entries.delete(id)
    this.deps.changed()
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
    if (entry.abort) return { status: 'busy' }
    if (card.qa.length >= (this.deps.maxQuestions ?? APPROVAL_MAX_QUESTIONS)) return { status: 'limit' }
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
    let result: { error?: string }
    try {
      result = await this.deps.answer(
        snapshot,
        question,
        (answer) => {
          qa.answer = answer
          this.deps.delta({ id: entry.card.id, index, answer })
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
      qa.answer = qa.answer.trim()
    }
    // Mỗi câu trả lời tính lại hạn chờ (tối đa 30 phút kể từ lúc tạo thẻ).
    entry.touch()
    this.deps.changed()
  }
}
