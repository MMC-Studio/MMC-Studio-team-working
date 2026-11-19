import { create } from 'zustand'
import type { ApprovalCard, ApprovalDelta, ApprovalQa } from '@shared/approvals'
import { api } from '@renderer/lib/api'
import { coalesce, onSync, optimistic } from '@renderer/lib/sync'

type ApprovalsState = {
  cards: ApprovalCard[]
  /** Lỗi của lần hỏi gần nhất (hiện trên thẻ). */
  askError: { id: string; code: string } | null
  refresh(): Promise<void>
  applyDelta(d: ApprovalDelta): void
  ask(id: string, question: string): Promise<boolean>
  /** Đóng thẻ ngay trên giao diện; `save` lỗi → hiện lại. */
  decide(id: string, save: () => Promise<unknown>): Promise<boolean>
}

export const useApprovals = create<ApprovalsState>((set, get) => ({
  cards: [],
  askError: null,

  async refresh() {
    const incoming = await api.approvals.list()
    // Ghép theo id: kết quả lấy về TRƯỚC khi bấm Hỏi (đến muộn) không được xoá câu vừa hỏi / phần trả lời đã stream.
    set((s) => ({ cards: incoming.map((c) => mergeCard(s.cards.find((l) => l.id === c.id), c)) }))
  },

  applyDelta({ id, index, answer }) {
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === id && c.qa[index] ? { ...c, qa: c.qa.map((q, i) => (i === index ? { ...q, answer } : q)) } : c
      )
    }))
  },

  async ask(id, question) {
    const added: ApprovalQa = { question, answer: '', status: 'answering' }
    const result = await optimistic({
      topic: 'approvals',
      apply: () => set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, qa: [...c.qa, added] } : c)) })),
      // Chỉ bỏ đúng câu vừa thêm — không khôi phục cả danh sách cũ (có thể đè thay đổi khác đến sau).
      rollback: () =>
        set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, qa: c.qa.filter((q) => q !== added) } : c)) })),
      save: async () => {
        set({ askError: null })
        const res = await api.approvals.ask(id, question)
        return res.status === 'started' ? res : { error: res.status }
      },
      // Báo ngay trên thẻ (hết hạn / đang trả lời câu trước / đã hỏi đủ 10 câu).
      onError: (code) => set({ askError: { id, code } })
    })
    return result !== null
  },

  async decide(id, save) {
    const removed = get().cards.find((c) => c.id === id)
    const result = await optimistic({
      topic: 'approvals',
      apply: () => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),
      // Lỗi → hiện lại đúng thẻ đó (lần hỏi lại sau sẽ lấy trạng thái thật từ main).
      rollback: () =>
        set((s) =>
          !removed || s.cards.some((c) => c.id === id)
            ? s
            : { cards: [...s.cards, removed].sort((a, b) => a.createdAt - b.createdAt) }
        ),
      save: async () => {
        await save()
        return true
      }
    })
    return result !== null
  }
}))

/** Thẻ của một cuộc trò chuyện (theo thứ tự tạo). */
export const cardsFor = (cards: ApprovalCard[], conversationId: string | null): ApprovalCard[] =>
  conversationId ? cards.filter((c) => c.conversationId === conversationId) : []

/** Nghe ở cấp app: thẻ có thể đến lúc người dùng đang ở trang khác. */
export function setupApprovals(): () => void {
  const refresh = coalesce(() => useApprovals.getState().refresh())
  const offSync = onSync('approvals', refresh)
  const offDelta = api.approvals.onDelta((d) => useApprovals.getState().applyDelta(d))
  void refresh()
  return () => {
    offSync()
    offDelta()
  }
}

/**
 * Ghép thẻ từ main với thẻ đang hiện (cùng id). Main chỉ thêm câu hỏi, không bao giờ bớt → bản từ main có ít câu
 * hơn nghĩa là bản đó cũ hơn: giữ các câu hiện có. Câu đang trả lời: giữ phần chữ dài hơn (stream đã tới xa hơn).
 */
export function mergeCard(local: ApprovalCard | undefined, remote: ApprovalCard): ApprovalCard {
  if (!local) return remote
  const qa = remote.qa.map((q, i) => {
    const l = local.qa[i]
    return l && q.status === 'answering' && l.status === 'answering' && l.answer.length > q.answer.length
      ? { ...q, answer: l.answer }
      : q
  })
  return { ...remote, qa: [...qa, ...local.qa.slice(remote.qa.length)] }
}
