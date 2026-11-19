import { create } from 'zustand'
import type { ApprovalCard, ApprovalDelta } from '@shared/approvals'
import { api } from '@renderer/lib/api'
import { coalesce, onSync, optimistic } from '@renderer/lib/sync'

type ApprovalsState = {
  cards: ApprovalCard[]
  /** Thẻ mà ô nhập chat đang hỏi (bấm "Hỏi lại" trên thẻ); null = thẻ đầu tiên của cuộc đang mở. */
  askTarget: string | null
  /** Tăng mỗi lần bấm "Hỏi lại" → ô nhập tự focus. */
  focusKey: number
  /** Lỗi của lần hỏi gần nhất (hiện trên thẻ). */
  askError: { id: string; code: string } | null
  refresh(): Promise<void>
  applyDelta(d: ApprovalDelta): void
  ask(id: string, question: string): Promise<boolean>
  /** Đóng thẻ ngay trên giao diện; `save` lỗi → hiện lại. */
  decide(id: string, save: () => Promise<unknown>): Promise<boolean>
  focusAsk(id: string): void
}

export const useApprovals = create<ApprovalsState>((set, get) => ({
  cards: [],
  askTarget: null,
  focusKey: 0,
  askError: null,

  async refresh() {
    const cards = await api.approvals.list()
    set((s) => ({ cards, askTarget: cards.some((c) => c.id === s.askTarget) ? s.askTarget : null }))
  },

  applyDelta({ id, index, answer }) {
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === id && c.qa[index] ? { ...c, qa: c.qa.map((q, i) => (i === index ? { ...q, answer } : q)) } : c
      )
    }))
  },

  async ask(id, question) {
    const before = get().cards
    const result = await optimistic({
      topic: 'approvals',
      apply: () =>
        set((s) => ({
          cards: s.cards.map((c) =>
            c.id === id ? { ...c, qa: [...c.qa, { question, answer: '', status: 'answering' as const }] } : c
          )
        })),
      rollback: () => set({ cards: before }),
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
    const before = get().cards
    const result = await optimistic({
      topic: 'approvals',
      apply: () => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),
      rollback: () => set({ cards: before }),
      save: async () => {
        await save()
        return true
      }
    })
    return result !== null
  },

  focusAsk(id) {
    set((s) => ({ askTarget: id, focusKey: s.focusKey + 1 }))
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

