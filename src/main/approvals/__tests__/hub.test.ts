import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalCard } from '@shared/approvals'
import type { CodeApprovalRequest } from '@shared/types'
import { CodeApprovals, rejectMessage } from '../../code/approvals'
import { DraftApprovals } from '../../connectors/approvals'
import { explainPrompt, explainSystemPrompt, EXPLAIN_MARKER } from '../explain'
import { ApprovalHub, type ApprovalAnswerer } from '../hub'
import { ApprovalTimer } from '../timer'

const codeRequest: CodeApprovalRequest = {
  id: 'a1',
  conversationId: 'c1',
  toolName: 'Edit',
  change: { path: 'src/a.ts', isNewFile: false, patch: '@@ -1 +1 @@\n-a\n+b\n', added: 1, removed: 1 }
}

function setup(answer: ApprovalAnswerer, maxQuestions?: number) {
  const changed = vi.fn()
  const deltas: { id: string; index: number; answer: string }[] = []
  const hub = new ApprovalHub({ changed, delta: (d) => deltas.push(d), answer, log: { warn: vi.fn() }, maxQuestions })
  const touch = vi.fn(() => true)
  hub.add({ id: 'a1', conversationId: 'c1', kind: 'code', request: codeRequest }, touch)
  return { hub, changed, deltas, touch }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ApprovalHub — Hỏi lại', () => {
  it('trả lời stream dưới thẻ, mỗi câu gia hạn chờ; câu sau thấy các câu trước', async () => {
    const seen: ApprovalCard[] = []
    const { hub, deltas, touch } = setup(async (card, question, onText) => {
      seen.push(card)
      onText(`Vì ${question}`)
      onText(`Vì ${question} — xong `)
      return {}
    })
    expect(hub.ask('a1', 'Tại sao?')).toEqual({ status: 'started' })
    // Đang trả lời câu trước → không nhận câu mới.
    expect(hub.ask('a1', 'Câu 2')).toEqual({ status: 'busy' })
    await vi.waitFor(() => expect(hub.get('a1')!.qa[0].status).toBe('done'))
    expect(hub.get('a1')!.qa[0]).toEqual({ question: 'Tại sao?', answer: 'Vì Tại sao? — xong', status: 'done' })
    expect(deltas.at(-1)).toMatchObject({ id: 'a1', index: 0 })

    expect(hub.ask('a1', 'Ảnh hưởng gì?')).toEqual({ status: 'started' })
    await vi.waitFor(() => expect(hub.get('a1')!.qa[1].status).toBe('done'))
    // Câu thứ 2 được gửi kèm câu 1 đã trả lời, không kèm chính nó.
    expect(seen[1].qa).toHaveLength(1)
    expect(seen[1].qa[0].question).toBe('Tại sao?')
    // Gia hạn lúc bắt đầu và sau mỗi câu trả lời.
    expect(touch).toHaveBeenCalledTimes(4)
  })

  it('lỗi → hiện mã lỗi trên thẻ, vẫn hỏi tiếp được', async () => {
    const { hub } = setup(async () => ({ error: 'cli_missing' }))
    hub.ask('a1', 'x')
    await vi.waitFor(() => expect(hub.get('a1')!.qa[0]).toMatchObject({ status: 'error', answer: 'cli_missing' }))
    expect(hub.ask('a1', 'y')).toEqual({ status: 'started' })
  })

  it('tối đa N câu; thẻ đã đóng → expired và huỷ câu đang trả lời', async () => {
    let signal: AbortSignal | null = null
    const { hub } = setup(async (_c, _q, _t, s) => {
      signal = s
      return {}
    }, 1)
    hub.ask('a1', 'một')
    await vi.waitFor(() => expect(hub.get('a1')!.qa[0].status).toBe('done'))
    expect(hub.ask('a1', 'hai')).toEqual({ status: 'limit' })

    const slow = setup((_c, _q, _t, s) => {
      signal = s
      return new Promise(() => {})
    })
    slow.hub.ask('a1', 'chậm')
    slow.hub.remove('a1')
    expect(signal!.aborted).toBe(true)
    expect(slow.hub.ask('a1', 'nữa')).toEqual({ status: 'expired' })
    expect(slow.hub.list()).toEqual([])
  })
})

describe('ApprovalTimer — hạn chờ', () => {
  it('tính lại 10 phút sau mỗi câu trả lời nhưng không quá 30 phút kể từ lúc tạo thẻ', () => {
    vi.useFakeTimers()
    const expired = vi.fn()
    const timer = new ApprovalTimer(expired, { idleMs: 10, maxMs: 25 })
    vi.advanceTimersByTime(9)
    timer.touch()
    vi.advanceTimersByTime(9)
    timer.touch()
    expect(expired).not.toHaveBeenCalled()
    // Đã 18ms; gia hạn tiếp chỉ còn tới mốc 25ms.
    vi.advanceTimersByTime(5)
    timer.touch()
    vi.advanceTimersByTime(2)
    expect(expired).toHaveBeenCalledTimes(1)
  })

  it('CodeApprovals: hỏi đáp gia hạn; hết hạn tối đa thì từ chối dù vẫn đang hỏi', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tw-hub-'))
    try {
      const emitted: CodeApprovalRequest[] = []
      const closed: string[] = []
      const approvals = new CodeApprovals({
        writableRoot: () => root,
        emit: (r) => emitted.push(r),
        closed: (id) => closed.push(id),
        log: { warn: vi.fn() },
        timer: { idleMs: 300, maxMs: 900 }
      })
      const started = Date.now()
      const decision = approvals.decide('c1', 'Write', { file_path: join(root, 'a.txt'), content: 'x' })
      await vi.waitFor(() => expect(emitted).toHaveLength(1))
      const { id } = emitted[0]
      // Hỏi lại liên tục (mỗi 100ms gia hạn) → không hết hạn ở mốc 300ms, nhưng vẫn dừng ở mốc 900ms.
      const keepAlive = setInterval(() => approvals.touch(id), 100)
      await expect(decision).resolves.toEqual({ allow: false, message: 'Hết thời gian chờ người dùng duyệt.' })
      clearInterval(keepAlive)
      expect(Date.now() - started).toBeGreaterThanOrEqual(850)
      expect(closed).toEqual([id])
      expect(approvals.touch(id)).toBe(false)

      // Từ chối kèm góp ý → Claude nhận góp ý.
      const second = approvals.decide('c1', 'Write', { file_path: join(root, 'b.txt'), content: 'y' })
      await vi.waitFor(() => expect(emitted).toHaveLength(2))
      expect(approvals.respond(emitted[1].id, false, 'đổi tên file')).toBe(true)
      await expect(second).resolves.toEqual({ allow: false, message: rejectMessage('đổi tên file') })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Từ chối kèm góp ý', () => {
  it('sửa file: lời từ chối mang góp ý để Claude đề xuất lại', () => {
    expect(rejectMessage()).toBe('Người dùng đã từ chối thay đổi này.')
    expect(rejectMessage('  ')).toBe('Người dùng đã từ chối thay đổi này.')
    expect(rejectMessage('dùng const')).toContain('góp ý: "dùng const"')
    expect(rejectMessage('dùng const')).toContain('đề xuất thay đổi mới')
  })

  it('nháp: từ chối kèm góp ý → lý do có góp ý; hỏi lại gia hạn nhưng không quá hạn tối đa', async () => {
    vi.useFakeTimers()
    let id = ''
    const drafts = new DraftApprovals({
      emit: (e) => {
        if (!('closed' in e)) id = e.id
      },
      log: { info: vi.fn() },
      timer: { idleMs: 1000, maxMs: 1500 }
    })
    const draft = { service: 'gmail' as const, target: 'a@b.c', subject: 's', body: 'b', replyTo: null }
    const p = drafts.request('c1', draft)
    drafts.respond({ id, approve: false, feedback: 'thân mật hơn' })
    await expect(p).resolves.toEqual({ approve: false, reason: expect.stringContaining('góp ý: "thân mật hơn"') })

    const p2 = drafts.request('c1', draft)
    vi.advanceTimersByTime(900)
    expect(drafts.touch(id)).toBe(true)
    vi.advanceTimersByTime(500)
    expect(drafts.touch(id)).toBe(true)
    vi.advanceTimersByTime(99)
    expect(drafts.touch(id)).toBe(true)
    vi.advanceTimersByTime(2)
    await expect(p2).resolves.toMatchObject({ approve: false, reason: expect.stringContaining('Hết thời gian') })
    expect(drafts.touch(id)).toBe(false)
  })
})

describe('prompt giải thích', () => {
  it('kèm diff, tin gần đây, câu đã hỏi; không tool, dặn không tự đồng ý', () => {
    const card: ApprovalCard = {
      id: 'a1',
      conversationId: 'c1',
      createdAt: 0,
      version: 1,
      history: [],
      chainId: 'a1',
      revising: null,
      kind: 'code',
      request: { ...codeRequest, change: { ...codeRequest.change, patch: 'x'.repeat(30_000) } },
      qa: [
        { question: 'Tại sao?', answer: 'Để sửa lỗi.', status: 'done' },
        { question: 'Lỗi', answer: 'timeout', status: 'error' }
      ]
    }
    const prompt = explainPrompt(card, [{ role: 'user', content: 'sửa giúp mình file a' }, { role: 'assistant', content: '' }], 'Có ảnh hưởng gì?')
    expect(prompt).toContain('File: src/a.ts (+1 −1)')
    expect(prompt).toContain('đã cắt 10000 ký tự')
    expect(prompt).toContain('Người dùng: sửa giúp mình file a')
    expect(prompt).not.toContain('Trợ lý: \n')
    expect(prompt).toContain('Người dùng hỏi: Tại sao?\nBạn đã trả lời: Để sửa lỗi.')
    expect(prompt).not.toContain('timeout')
    expect(prompt.endsWith('Câu hỏi mới của người dùng: Có ảnh hưởng gì?')).toBe(true)
    const system = explainSystemPrompt('Mizuki')
    expect(system.startsWith(EXPLAIN_MARKER)).toBe(true)
    expect(system).toContain('KHÔNG tự đồng ý')
  })

  it('mô tả thẻ thư mục và nháp', () => {
    const folder = explainPrompt(
      { id: 'f', conversationId: 'c1', createdAt: 0, version: 1, history: [], chainId: 'x', revising: null, qa: [], kind: 'folder', request: { id: 'f', conversationId: 'c1', suggestedPath: 'D:\\game', write: true, reason: 'xem code' } },
      [],
      'q'
    )
    expect(folder).toContain('đọc + sửa')
    expect(folder).toContain('D:\\game')
    const draft = explainPrompt(
      { id: 'd', conversationId: 'c1', createdAt: 0, version: 1, history: [], chainId: 'x', revising: null, qa: [], kind: 'draft', request: { id: 'd', service: 'telegram', target: 'Nhóm A', subject: null, body: 'chào', replyTo: null } },
      [],
      'q'
    )
    expect(draft).toContain('Telegram')
    expect(draft).not.toContain('Tiêu đề:')
  })
})

describe('ApprovalHub — Yêu cầu sửa (chuỗi Bản 1 → Bản 2 → Bản 3 trong một thẻ)', () => {
  const add = (hub: ApprovalHub, id: string, conversationId = 'c1'): void =>
    hub.add({ id, conversationId, kind: 'code', request: { ...codeRequest, id, conversationId } }, () => true)
  const newHub = (answer: ApprovalAnswerer = async (_c, q, onText) => (onText(`đáp ${q}`), {}), maxQuestions?: number): ApprovalHub =>
    new ApprovalHub({ changed: () => {}, delta: () => {}, answer, log: { warn: vi.fn() }, maxQuestions })

  it('bản mới mang theo các bản cũ (nội dung, hỏi đáp, yêu cầu); hết lượt thì về bản 1', async () => {
    const hub = newHub()
    add(hub, 'b1')
    expect(hub.get('b1')).toMatchObject({ version: 1, history: [] })
    hub.ask('b1', 'tại sao?')
    await vi.waitFor(() => expect(hub.get('b1')!.qa[0].status).toBe('done'))
    hub.markRevised('b1', 'đổi tên biến')
    hub.remove('b1')
    add(hub, 'b2')
    expect(hub.get('b2')).toMatchObject({
      version: 2,
      chainId: 'b1',
      revising: null,
      qa: [],
      history: [{ version: 1, request: { id: 'b1' }, qa: [{ question: 'tại sao?', answer: 'đáp tại sao?' }], revision: 'đổi tên biến' }]
    })
    hub.markRevised('b2', 'thêm chú thích')
    hub.remove('b2')
    // Cuộc khác không bị ảnh hưởng.
    add(hub, 'x1', 'c2')
    expect(hub.get('x1')).toMatchObject({ version: 1, history: [] })
    add(hub, 'b3')
    expect(hub.get('b3')!.version).toBe(3)
    expect(hub.get('b3')!.history.map((v) => [v.version, v.revision])).toEqual([
      [1, 'đổi tên biến'],
      [2, 'thêm chú thích']
    ])
    hub.markRevised('b3', 'bỏ qua')
    hub.endRun('c1')
    add(hub, 'b4')
    expect(hub.get('b4')).toMatchObject({ version: 1, history: [] })
    // Thẻ không còn → không ghi nhận.
    hub.markRevised('khong-co', 'x')
    add(hub, 'b5')
    expect(hub.get('b5')!.version).toBe(1)
  })

  it('câu đang trả lời dở không mang sang bản mới; giới hạn câu hỏi tính cho cả chuỗi', async () => {
    const pending = newHub(() => new Promise(() => {}))
    add(pending, 'p1')
    pending.ask('p1', 'đang hỏi')
    pending.markRevised('p1', 'sửa đi')
    pending.remove('p1')
    add(pending, 'p2')
    expect(pending.get('p2')!.history[0].qa).toEqual([])

    const hub = newHub(undefined, 2)
    add(hub, 'b1')
    hub.ask('b1', 'một')
    await vi.waitFor(() => expect(hub.get('b1')!.qa[0].status).toBe('done'))
    hub.markRevised('b1', 'sửa')
    hub.remove('b1')
    add(hub, 'b2')
    hub.ask('b2', 'hai')
    await vi.waitFor(() => expect(hub.get('b2')!.qa[0].status).toBe('done'))
    expect(hub.ask('b2', 'ba')).toEqual({ status: 'limit' })
  })
})

describe('prompt giải thích — bản làm lại', () => {
  it('gửi kèm các bản trước: nội dung (cắt ngắn), hỏi đáp, yêu cầu sửa; bản hiện tại ghi rõ số bản', () => {
    const card: ApprovalCard = {
      id: 'b2',
      conversationId: 'c1',
      createdAt: 0,
      version: 2,
      chainId: 'b1',
      revising: null,
      kind: 'code',
      request: { ...codeRequest, id: 'b2', change: { ...codeRequest.change, patch: '+speed = 5\n' } },
      qa: [],
      history: [
        {
          version: 1,
          request: { ...codeRequest, change: { ...codeRequest.change, patch: '+' + 'y'.repeat(8000) } },
          qa: [{ question: 'Tại sao đổi?', answer: 'Để nhanh hơn.', status: 'done' }],
          revision: 'chỉ đổi thành 5'
        }
      ]
    }
    const prompt = explainPrompt(card, [], 'Bản này khác gì?')
    const past = /<cac-ban-truoc>([\s\S]*)<\/cac-ban-truoc>/.exec(prompt)![1]
    expect(past).toContain('Bản 1:')
    expect(past).toContain('đã cắt')
    expect(past).toContain('Người dùng hỏi: Tại sao đổi?\nBạn đã trả lời: Để nhanh hơn.')
    expect(past).toContain('Người dùng yêu cầu sửa: chỉ đổi thành 5')
    expect(prompt).toContain('<de-xuat>\nBản 2 (hiện tại)')
    expect(prompt).toContain('+speed = 5')
    expect(prompt.indexOf('<cac-ban-truoc>')).toBeLessThan(prompt.indexOf('<de-xuat>'))
  })
})

describe('ApprovalHub — thẻ không biến mất trong lúc chờ bản tiếp theo', () => {
  const add = (hub: ApprovalHub, id: string): void =>
    hub.add({ id, conversationId: 'c1', kind: 'code', request: { ...codeRequest, id } }, () => true)

  it('Yêu cầu sửa → thẻ ở lại (đang chờ), không hỏi được; bản mới thay nó, cùng chainId', () => {
    const hub = new ApprovalHub({ changed: () => {}, delta: () => {}, answer: async () => ({}), log: { warn: vi.fn() } })
    add(hub, 'b1')
    hub.markRevised('b1', 'đổi tên biến')
    hub.remove('b1')
    expect(hub.list()).toMatchObject([{ id: 'b1', revising: 'đổi tên biến', chainId: 'b1' }])
    expect(hub.ask('b1', 'x')).toEqual({ status: 'expired' })
    add(hub, 'b2')
    expect(hub.list()).toMatchObject([{ id: 'b2', version: 2, chainId: 'b1', revising: null }])

    // Trợ lý không đề xuất lại → hết lượt thì thẻ chờ được dọn.
    hub.markRevised('b2', 'thôi')
    hub.remove('b2')
    expect(hub.list()).toHaveLength(1)
    hub.endRun('c1')
    expect(hub.list()).toEqual([])
  })

  it('đóng thẻ bình thường (Đồng ý / Từ chối / hết hạn) → biến mất ngay', () => {
    const hub = new ApprovalHub({ changed: () => {}, delta: () => {}, answer: async () => ({}), log: { warn: vi.fn() } })
    add(hub, 'b1')
    hub.remove('b1')
    expect(hub.list()).toEqual([])
  })
})

describe('Hỏi → trợ lý nhận ra câu là yêu cầu sửa', () => {
  it('dấu [[yeu-cau-sua]] bị gỡ khỏi câu trả lời (cả khi đang stream dở), câu hỏi được đánh dấu gợi ý', async () => {
    const shown: string[] = []
    const hub = new ApprovalHub({
      changed: () => {},
      delta: (d) => shown.push(d.answer),
      answer: async (_c, _q, onText) => {
        let text = ''
        for (const part of ['Mình sẽ đổi khi bạn', ' gửi yêu cầu sửa.\n[[yeu-c', 'au-sua]]']) onText((text += part))
        return {}
      },
      log: { warn: vi.fn() }
    })
    hub.add({ id: 'a1', conversationId: 'c1', kind: 'code', request: codeRequest }, () => true)
    hub.ask('a1', 'đổi tên biến thành speed')
    await vi.waitFor(() => expect(hub.get('a1')!.qa[0].status).toBe('done'))
    expect(hub.get('a1')!.qa[0]).toMatchObject({ answer: 'Mình sẽ đổi khi bạn gửi yêu cầu sửa.', suggestRevision: true })
    expect(shown.some((s) => s.includes('[['))).toBe(false)
  })

  it('câu hỏi thường → không gợi ý', async () => {
    const hub = new ApprovalHub({ changed: () => {}, delta: () => {}, answer: async (_c, _q, onText) => (onText('Vì [a] cần.'), {}), log: { warn: vi.fn() } })
    hub.add({ id: 'a1', conversationId: 'c1', kind: 'code', request: codeRequest }, () => true)
    hub.ask('a1', 'tại sao?')
    await vi.waitFor(() => expect(hub.get('a1')!.qa[0].status).toBe('done'))
    expect(hub.get('a1')!.qa[0]).toMatchObject({ answer: 'Vì [a] cần.' })
    expect(hub.get('a1')!.qa[0].suggestRevision).toBeUndefined()
  })
})
