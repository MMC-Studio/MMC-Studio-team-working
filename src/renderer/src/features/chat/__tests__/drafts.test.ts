import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, Message } from '@shared/types'

const api = {
  chat: {
    pickAttachments: vi.fn(),
    pasteClipboard: vi.fn(),
    addFile: vi.fn()
  }
}
vi.mock('@renderer/lib/api', () => ({ api }))

/** localStorage giả (môi trường test là node). */
class MemoryStorage {
  data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v)
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
}
const store = new MemoryStorage()
vi.stubGlobal('window', { localStorage: store, addEventListener: vi.fn(), removeEventListener: vi.fn() })

const { DRAFT_MAX_AGE_MS, DRAFT_SAVE_MS, draftPreview, newDraftKey, parseDrafts, serializeDrafts, useDrafts } = await import('../drafts')

const msg = (id: string, content = 'tin gốc'): Message => ({
  id,
  conversationId: 'A',
  role: 'assistant',
  content,
  status: 'done',
  error: null,
  toolEvents: [],
  attachments: [],
  usage: null,
  reactions: [],
  media: null,
  voice: null,
  artifacts: [],
  replyToId: null,
  pinnedAt: null,
  recalledAt: null,
  createdAt: 0
})
const file = (id: string): Attachment => ({ id, name: `${id}.png`, mimeType: 'image/png', size: 1 })
const s = () => useDrafts.getState()

describe('nháp theo từng cuộc', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store.data.clear()
    s().load('u1', new Set(['A', 'B']))
  })
  afterEach(() => vi.useRealTimers())

  it('chữ, reply, đính kèm tách theo cuộc; cuộc mới / cuộc mới trong dự án có khoá riêng', async () => {
    s().setText('A', 'đang gõ ở A')
    s().setReply('A', msg('m1'))
    s().setText(newDraftKey(), 'cuộc mới')
    s().setText(newDraftKey('p1'), 'trong dự án')
    api.chat.pickAttachments.mockResolvedValueOnce({ attachments: [file('f1')], rejected: [] })
    await s().pick('A')
    expect(s().drafts.A).toMatchObject({ text: 'đang gõ ở A', reply: { id: 'm1' } })
    expect(s().drafts.B).toBeUndefined()
    expect(s().files.A).toEqual([file('f1')])
    expect(s().files.B).toBeUndefined()
    expect(s().drafts.new.text).toBe('cuộc mới')
    expect(s().drafts['new:p1'].text).toBe('trong dự án')
  })

  it('thêm file chậm, người dùng chuyển cuộc giữa chừng → file vẫn vào đúng cuộc đã bấm', async () => {
    let resolve!: (v: unknown) => void
    api.chat.pickAttachments.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const pending = s().pick('A')
    expect(s().busy.A).toBe(true)
    expect(s().busy.B).toBeUndefined()
    resolve({ attachments: [file('f2')], rejected: [] })
    await pending
    expect(s().files.A).toEqual([file('f2')])
    expect(s().files.B).toBeUndefined()
  })

  it('ghi lên máy sau 500 ms không gõ (theo tài khoản); gửi xong → xoá cả chữ, reply, đính kèm', () => {
    s().setText('A', 'a')
    s().setText('A', 'ab')
    expect(store.getItem('mmc.drafts.u1')).toBe('{}')
    vi.advanceTimersByTime(DRAFT_SAVE_MS)
    expect(JSON.parse(store.getItem('mmc.drafts.u1')!).A.text).toBe('ab')
    s().clear('A')
    vi.advanceTimersByTime(DRAFT_SAVE_MS)
    expect(JSON.parse(store.getItem('mmc.drafts.u1')!)).toEqual({})
    expect(s().files.A).toEqual([])
  })

  it('mở lại app: đọc lại chữ + reply; bỏ nháp của cuộc đã xoá (trừ "new"); tài khoản khác không thấy', () => {
    s().setText('A', 'còn đây')
    s().setText('B', 'cuộc B')
    s().setText('new', 'cuộc mới')
    s().setReply('A', msg('m1'))
    s().flush()
    s().load('u1', new Set(['A'])) // B đã bị xoá
    expect(Object.keys(s().drafts).sort()).toEqual(['A', 'new'])
    expect(s().drafts.A.reply?.id).toBe('m1')
    expect(s().files).toEqual({}) // đính kèm chỉ giữ trong lúc app mở
    s().load('u2', new Set(['A']))
    expect(s().drafts).toEqual({})
  })

  it('xoá cuộc → xoá nháp', () => {
    s().setText('A', 'x')
    s().remove('A')
    expect(s().drafts.A).toBeUndefined()
  })
})

describe('đọc / ghi', () => {
  const now = 1_800_000_000_000
  it('bỏ nháp rỗng, hỏng, quá 30 ngày', () => {
    const raw = JSON.stringify({
      A: { text: 'ok', reply: null, updatedAt: now - 1000 },
      B: { text: '   ', reply: null, updatedAt: now },
      C: { text: 'cũ', reply: null, updatedAt: now - DRAFT_MAX_AGE_MS - 1 },
      D: 'hỏng',
      E: { text: '', reply: msg('m9'), updatedAt: now }
    })
    expect(Object.keys(parseDrafts(raw, now))).toEqual(['A', 'E'])
    expect(parseDrafts('không phải json', now)).toEqual({})
    expect(parseDrafts(null, now)).toEqual({})
  })

  it('ghi: tin đang trả lời cắt ngắn, nháp rỗng / quá hạn không ghi', () => {
    const out = JSON.parse(
      serializeDrafts(
        {
          A: { text: 'x', reply: msg('m1', 'y'.repeat(5000)), updatedAt: now },
          B: { text: '', reply: null, updatedAt: now },
          C: { text: 'cũ', reply: null, updatedAt: now - DRAFT_MAX_AGE_MS - 1 }
        },
        now
      )
    )
    expect(Object.keys(out)).toEqual(['A'])
    expect(out.A.reply.content).toHaveLength(2000)
  })

  it('"Nháp: …" ở thanh bên: một dòng, cắt ngắn', () => {
    expect(draftPreview('  dòng 1\n dòng 2 ')).toBe('dòng 1 dòng 2')
    expect(draftPreview('a'.repeat(60))).toHaveLength(40)
  })
})
