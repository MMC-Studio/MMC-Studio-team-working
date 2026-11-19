import { describe, expect, it, vi } from 'vitest'
import type { ApprovalCard, ApprovalQa } from '@shared/approvals'

vi.mock('@renderer/lib/api', () => ({ api: {} }))
const { mergeCard } = await import('../approvals/store')

const card = (qa: ApprovalQa[]): ApprovalCard => ({
  id: 'a1',
  conversationId: 'c1',
  createdAt: 0,
  version: 1,
  revisionNote: null,
  qa,
  kind: 'folder',
  request: { id: 'a1', conversationId: 'c1', suggestedPath: null, write: false, reason: 'x' }
})
const done = (q: string): ApprovalQa => ({ question: q, answer: `trả lời ${q}`, status: 'done' })

describe('mergeCard — thẻ không mất câu hỏi đáp khi đồng bộ', () => {
  it('bản từ main đến muộn (ít câu hơn) không xoá câu vừa hỏi', () => {
    const asking: ApprovalQa = { question: 'câu 3', answer: '', status: 'answering' }
    const local = card([done('1'), done('2'), asking])
    const merged = mergeCard(local, card([done('1'), done('2')]))
    expect(merged.qa.map((q) => q.question)).toEqual(['1', '2', 'câu 3'])
    // Giữ đúng đối tượng để hoàn tác (khi hỏi lỗi) tìm được câu cần bỏ.
    expect(merged.qa[2]).toBe(asking)
  })

  it('đang stream: giữ phần chữ dài hơn; main báo xong thì lấy bản của main', () => {
    const local = card([{ question: 'q', answer: 'Vì đoạn này cần', status: 'answering' }])
    expect(mergeCard(local, card([{ question: 'q', answer: 'Vì', status: 'answering' }])).qa[0].answer).toBe('Vì đoạn này cần')
    expect(mergeCard(local, card([{ question: 'q', answer: 'Vì đoạn này cần sửa.', status: 'done' }])).qa[0]).toMatchObject({
      status: 'done',
      answer: 'Vì đoạn này cần sửa.'
    })
  })

  it('thẻ mới / main có nhiều câu hơn → theo main', () => {
    expect(mergeCard(undefined, card([done('1')])).qa).toHaveLength(1)
    expect(mergeCard(card([done('1')]), card([done('1'), done('2'), done('3')])).qa).toHaveLength(3)
  })
})
