import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeApprovalRequest, ExtraFolder } from '@shared/types'
import type { ActionLogEntry } from '../../audit/actionLog'
import { CodeApprovals, type Decision } from '../approvals'
import { AutoEdits } from '../autoEdits'

/** Thư mục phụ (D) ở bước duyệt sửa file: chỉ đọc → chặn; sửa → LUÔN hỏi, kể cả khi thư mục chính đang tự duyệt. */
let base: string
let main: string
let lib: string
let dataDir: string
let extras: ExtraFolder[]
let mainWritable: boolean
let records: ActionLogEntry[]
let requests: CodeApprovalRequest[]
let auto: AutoEdits
let approvals: CodeApprovals

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'tw-extra-appr-'))
  dataDir = mkdtempSync(join(tmpdir(), 'tw-extra-data-'))
  main = join(base, 'main')
  lib = join(base, 'lib')
  mkdirSync(main)
  mkdirSync(lib)
  writeFileSync(join(main, 'a.txt'), 'main\n')
  writeFileSync(join(lib, 'b.txt'), 'lib\n')
  extras = [{ path: lib, write: false }]
  mainWritable = true
  records = []
  requests = []
  auto = new AutoEdits({
    dir: dataDir,
    getOwner: () => 'u1',
    now: () => 1_000_000,
    title: () => 'Cuộc thử',
    changed: vi.fn(),
    record: (e) => records.push(e),
    log: { warn: vi.fn(), info: vi.fn() }
  })
  await auto.load()
  approvals = new CodeApprovals({
    writableRoot: (id) => (id === 'c1' && mainWritable ? main : null),
    extraDirs: (id) => (id === 'c1' ? extras : []),
    emit: (r) => requests.push(r),
    log: { warn: vi.fn() },
    record: (e) => records.push(e),
    autoEdits: auto
  })
})
afterEach(() => {
  approvals.stop()
  rmSync(base, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

type Outcome = { decision: Decision } | { card: CodeApprovalRequest; done: Promise<Decision> }
async function attempt(input: Record<string, unknown>, tool: 'Write' | 'Edit' = 'Write'): Promise<Outcome> {
  const n = requests.length
  let settled: Decision | undefined
  const done = approvals.decide('c1', tool, input).then((d) => (settled = d))
  await vi.waitFor(() => {
    if (settled === undefined && requests.length === n) throw new Error('chờ')
  })
  return settled !== undefined ? { decision: settled } : { card: requests[requests.length - 1], done }
}

describe('sửa file trong thư mục phụ', () => {
  it('thư mục phụ chỉ đọc → chặn không hỏi, nhật ký ghi nhãn thư mục phụ + write_disabled', async () => {
    const out = await attempt({ file_path: join(lib, 'b.txt'), content: 'x' })
    expect(out).toMatchObject({ decision: { allow: false, message: expect.stringContaining('chỉ đọc') } })
    expect(requests).toHaveLength(0)
    expect(records.at(-1)).toMatchObject({ kind: 'file_edit', target: '[phụ: lib] b.txt', decision: 'blocked', detail: 'write_disabled' })
  })

  it('thư mục phụ được sửa trong khi thư mục chính chỉ đọc → vẫn hiện thẻ, có đường dẫn thư mục phụ', async () => {
    mainWritable = false
    extras = [{ path: lib, write: true }]
    const out = await attempt({ file_path: join(lib, 'b.txt'), content: 'lib2\n' })
    if (!('card' in out)) throw new Error('phải hiện thẻ')
    expect(out.card).toMatchObject({ extraFolder: lib, change: { path: 'b.txt' } })
    // Không có phiên tự duyệt → không ghi lý do (sessionActive=false), không bao giờ có nút.
    expect(out.card.autoEdit).toEqual({ offer: false, reason: 'extra_folder', sessionActive: false })
    approvals.respond(out.card.id, true)
    expect(await out.done).toEqual({ allow: true })
    expect(records.at(-1)).toMatchObject({ target: '[phụ: lib] b.txt', decision: 'approved' })
  })

  it('(C) thư mục chính đang tự duyệt → file thư mục chính tự qua, file thư mục phụ VẪN hỏi + ghi lý do', async () => {
    extras = [{ path: lib, write: true }]
    // Mở phiên tự duyệt bằng "Đồng ý, và không hỏi lại" ở thư mục chính.
    const first = await attempt({ file_path: 'a.txt', content: 'main2\n' })
    if (!('card' in first)) throw new Error('phải hiện thẻ')
    expect(first.card.autoEdit).toEqual({ offer: true })
    expect(await approvals.respondAuto(first.card.id)).toEqual({ ok: true })
    // Thư mục chính: tự duyệt.
    expect(await attempt({ file_path: 'a.txt', content: 'main3\n' })).toEqual({ decision: { allow: true } })
    // Thư mục phụ: vẫn hỏi, thẻ ghi vì sao.
    const extra = await attempt({ file_path: join(lib, 'b.txt'), content: 'lib2\n' })
    if (!('card' in extra)) throw new Error('thư mục phụ phải hỏi')
    expect(extra.card.autoEdit).toEqual({ offer: false, reason: 'extra_folder', sessionActive: true })
    // Gọi thẳng "không hỏi lại" trên thẻ thư mục phụ cũng không được; phiên thư mục chính vẫn chạy.
    expect(await approvals.respondAuto(extra.card.id)).toEqual({ ok: false, error: 'not_eligible' })
    expect(auto.list().find((s) => s.conversationId === 'c1')?.endedAt ?? null).toBeNull()
    expect(auto.list()[0].files.map((f) => f.path)).toEqual(['a.txt'])
    approvals.respond(extra.card.id, false)
    expect(await extra.done).toMatchObject({ allow: false })
  })

  it('hồ sơ dự án tính theo CHÍNH thư mục phụ: thư mục phụ là dự án Unity → Library/ bị chặn', async () => {
    mkdirSync(join(lib, 'Assets'))
    mkdirSync(join(lib, 'ProjectSettings'))
    extras = [{ path: lib, write: true }]
    const out = await attempt({ file_path: join(lib, 'Library', 'x.txt'), content: 'x' })
    expect(out).toMatchObject({ decision: { allow: false, message: expect.stringMatching(/Unity/) } })
    expect(records.at(-1)).toMatchObject({ target: '[phụ: lib] Library/x.txt', decision: 'blocked', detail: 'protected_path' })
  })

  it('file ngoài cả thư mục chính lẫn thư mục phụ → chặn như cũ', async () => {
    extras = [{ path: lib, write: true }]
    const out = await attempt({ file_path: join(base, 'khac.txt'), content: 'x' })
    expect(out).toMatchObject({ decision: { allow: false } })
    expect(requests).toHaveLength(0)
  })
})
