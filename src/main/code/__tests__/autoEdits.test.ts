import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_EDIT_MAX_FILES, AUTO_EDIT_SESSION_MS, AUTO_EDIT_UNDO_MS } from '@shared/autoEdits'
import type { CodeApprovalRequest } from '@shared/types'
import type { ActionLogEntry } from '../../audit/actionLog'
import { CodeApprovals, type Decision } from '../approvals'
import { AutoEdits } from '../autoEdits'

let root: string
let dataDir: string
let now: number
let records: ActionLogEntry[]
let requests: CodeApprovalRequest[]
let writable: string | null
let auto: AutoEdits
let approvals: CodeApprovals
const changed = vi.fn()

function makeAuto(): AutoEdits {
  return new AutoEdits({
    dir: dataDir,
    getOwner: () => 'u1',
    now: () => now,
    title: () => 'Cuộc thử',
    changed,
    record: (e) => records.push(e),
    log: { warn: vi.fn(), info: vi.fn() }
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tw-auto-'))
  dataDir = mkdtempSync(join(tmpdir(), 'tw-auto-data-'))
  now = 1_000_000
  records = []
  requests = []
  writable = root
  auto = makeAuto()
  approvals = new CodeApprovals({
    writableRoot: (id) => (id === 'c1' || id === 'c2' ? writable : null),
    emit: (r) => requests.push(r),
    log: { warn: vi.fn() },
    record: (e) => records.push(e),
    autoEdits: auto
  })
})
afterEach(() => {
  approvals.stop()
  rmSync(root, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

const put = (rel: string, content: string | Buffer): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')

type Outcome = { decision: Decision } | { card: CodeApprovalRequest; done: Promise<Decision> }

/** Gọi bước duyệt như CLI: trả quyết định ngay (tự duyệt / chặn) hoặc thẻ đang chờ. */
async function attempt(tool: 'Write' | 'Edit', input: Record<string, unknown>): Promise<Outcome> {
  const n = requests.length
  let settled: Decision | undefined
  const done = approvals.decide('c1', tool, input).then((d) => (settled = d))
  await vi.waitFor(() => {
    if (settled === undefined && requests.length === n) throw new Error('chờ')
  })
  return settled !== undefined ? { decision: settled } : { card: requests[requests.length - 1], done }
}

/** Write như CLI: được phép → ghi file thật. */
async function write(rel: string, content: string): Promise<Outcome> {
  const out = await attempt('Write', { file_path: rel, content })
  if ('decision' in out && out.decision.allow) put(rel, content)
  return out
}

const isAuto = (o: Outcome): boolean => 'decision' in o && o.decision.allow
const card = (o: Outcome): CodeApprovalRequest => {
  if (!('card' in o)) throw new Error(`không có thẻ: ${JSON.stringify(o)}`)
  return o.card
}

/** Mở phiên: thẻ đầu tiên → "Đồng ý, và không hỏi lại" → CLI ghi file. */
async function startSession(rel = 'start.txt', content = 'mở phiên\n'): Promise<void> {
  const out = await attempt('Write', { file_path: rel, content })
  const c = card(out)
  expect(c.autoEdit).toEqual({ offer: true })
  expect(await approvals.respondAuto(c.id)).toEqual({ ok: true })
  expect(await (out as { done: Promise<Decision> }).done).toEqual({ allow: true })
  put(rel, content)
}

describe('Phiên tự duyệt sửa file (PR C)', () => {
  it('"Đồng ý, và không hỏi lại" mở phiên: lần sau không có thẻ; nhật ký always → auto', async () => {
    put('a.txt', 'cũ\n')
    await startSession()
    expect(auto.isActive('c1')).toBe(true)
    expect(isAuto(await write('a.txt', 'mới\n'))).toBe(true)
    expect(isAuto(await write('src/moi.ts', 'export {}\n'))).toBe(true)
    expect(requests).toHaveLength(1)
    expect(records.map((r) => [r.target, r.decision])).toEqual([
      ['start.txt', 'always'],
      ['a.txt', 'auto'],
      ['src/moi.ts', 'auto']
    ])
    const [s] = auto.list('c1')
    expect(s.files.map((f) => [f.path, f.isNewFile])).toEqual([
      ['start.txt', true],
      ['a.txt', false],
      ['src/moi.ts', true]
    ])
    expect(s.endsAt - s.startedAt).toBe(AUTO_EDIT_SESSION_MS)
  })

  it('mặc định tắt, theo từng cuộc: cuộc khác vẫn hỏi', async () => {
    await startSession()
    expect(auto.isActive('c2')).toBe(false)
    void approvals.decide('c2', 'Write', { file_path: 'khac.txt', content: 'x' })
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ conversationId: 'c2', autoEdit: { offer: true } })
  })

  describe('(1) + (4) file "vẫn hỏi": không có nút trên thẻ, phiên đang bật vẫn hiện thẻ kèm lý do', () => {
    const common = [
      'package.json',
      'tools/sub/package.json',
      '.env',
      '.env.local',
      'build.bat',
      'scripts/run.ps1',
      'x.cmd',
      'deploy.sh',
      '.github/workflows/ci.yml',
      '.vscode/tasks.json',
      'App.csproj',
      'App.sln',
      'Directory.Build.props',
      'src/Directory.Build.targets',
      '.claude/settings.json',
      '.mcp.json',
      '.husky/pre-commit',
      '.npmrc',
      // Dự án Unity nằm trong thư mục con (hồ sơ chỉ nhận ở gốc) — vẫn chặn theo dấu hiệu Unity.
      'Game/Assets/Scripts/Player.cs',
      'Game/Packages/manifest.json',
      'Game/Assets/Code.asmdef'
    ]
    it.each(common)('mọi dự án: %s', async (rel) => {
      const noSession = card(await write(rel, 'x\n'))
      expect(noSession.autoEdit).toMatchObject({ offer: false, reason: 'risky', sessionActive: false })
      expect(await approvals.respondAuto(noSession.id)).toEqual({ ok: false, error: 'not_eligible' })
      approvals.respond(noSession.id, false)
      await startSession()
      const during = card(await write(rel, 'y\n'))
      expect(during.autoEdit).toMatchObject({ offer: false, reason: 'risky', sessionActive: true })
      expect(during.autoEdit && !during.autoEdit.offer && during.autoEdit.detail).toBeTruthy()
    })

    it.each(['Assets/Editor/BuildTool.cs', 'Assets/Scripts/Player.cs', 'Tools.cs', 'Assets/Game.asmref', 'Assets/csc.rsp', 'Packages/manifest.json'])(
      'dự án Unity (nhận ở gốc): %s',
      async (rel) => {
        mkdirSync(join(root, 'Assets'), { recursive: true })
        mkdirSync(join(root, 'ProjectSettings'), { recursive: true })
        await startSession()
        expect(card(await write(rel, '// x\n')).autoEdit).toMatchObject({ offer: false, reason: 'risky' })
        // File khác của Unity (scene, shader) vẫn tự duyệt được.
        expect(isAuto(await write('Assets/Shaders/A.shader', 'Shader "A" {}\n'))).toBe(true)
      }
    )

    it('đi qua junction: đường dẫn chữ vô hại nhưng đường dẫn thật là .vscode/ → vẫn hỏi', async () => {
      mkdirSync(join(root, '.vscode'))
      symlinkSync(join(root, '.vscode'), join(root, 'cfg'), 'junction')
      await startSession()
      expect(card(await write('cfg/tasks.json', '{}\n')).autoEdit).toMatchObject({ offer: false, reason: 'risky' })
    })
  })

  it('(3) "ngắn hơn ½" áp dụng cho Edit và Write, so với bản gốc ĐẦU PHIÊN (không phải lần sửa trước)', async () => {
    put('doc.txt', 'a'.repeat(100))
    put('w.txt', 'b'.repeat(100))
    await startSession()
    // Edit 1: 100 → 60 (≥ ½ bản gốc) → tự duyệt.
    const e1 = await attempt('Edit', { file_path: 'doc.txt', old_string: 'a'.repeat(40), new_string: '' })
    expect(isAuto(e1)).toBe(true)
    put('doc.txt', 'a'.repeat(60))
    // Edit 2: 60 → 45 — so với lần trước thì không tới ½, nhưng so với bản gốc 100 thì < ½ → hỏi.
    const e2 = card(await attempt('Edit', { file_path: 'doc.txt', old_string: 'a'.repeat(15), new_string: '' }))
    expect(e2.autoEdit).toMatchObject({ offer: false, reason: 'shrink', sessionActive: true })
    approvals.respond(e2.id, false)
    // Write: 100 → 49 → hỏi; 100 → 50 → tự duyệt.
    expect(card(await write('w.txt', 'b'.repeat(48) + '\n')).autoEdit).toMatchObject({ reason: 'shrink' })
    expect(isAuto(await write('w.txt', 'b'.repeat(49) + '\n'))).toBe(true)
    // Không có phiên: Write làm file ngắn hơn ½ → thẻ không có nút tự duyệt.
    await auto.end('c1', 'stopped')
    put('z.txt', 'c'.repeat(100))
    expect(card(await write('z.txt', 'c\n')).autoEdit).toMatchObject({ offer: false, reason: 'shrink', sessionActive: false })
  })

  it('(5) file có nhiều hơn 1 hard link → vẫn hỏi', async () => {
    put('goc.txt', 'nội dung\n')
    linkSync(join(root, 'goc.txt'), join(root, 'ban-sao.txt'))
    await startSession()
    expect(card(await write('ban-sao.txt', 'nội dung mới\n')).autoEdit).toMatchObject({ offer: false, reason: 'hard_link' })
    expect(card(await write('goc.txt', 'nội dung mới\n')).autoEdit).toMatchObject({ offer: false, reason: 'hard_link' })
  })

  it('file > 2 MB → vẫn hỏi (không giữ được bản gốc); file nhị phân (byte 0 / không phải UTF-8) → từ chối', async () => {
    put('big.log', 'x'.repeat(2 * 1024 * 1024 + 1))
    put('data.bin2', Buffer.from([1, 2, 0, 3]))
    put('latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    await startSession()
    // Nội dung mới ngắn: luật "quá lớn" kiểm TRƯỚC luật "ngắn hơn ½" (không có bản gốc để so).
    expect(card(await write('big.log', 'y\n')).autoEdit).toMatchObject({ reason: 'too_large' })
    const bin = await write('data.bin2', 'x')
    expect(bin).toMatchObject({ decision: { allow: false } })
    expect(await write('latin.txt', 'cafe')).toMatchObject({ decision: { allow: false } })
    expect(records.filter((r) => r.decision === 'blocked').map((r) => r.detail)).toEqual(['binary_content', 'binary_content'])
  })

  // Test tay 2026-11-23: nhật ký có "App chặn" cho C:\…\hoc\ngan.txt rồi sửa lại được ngay — file CRLF, lần sửa trước
  // chèn dòng mới (CLI ghi CRLF), lần sau old_string có "\n" → app so từng byte nên chặn nhầm (CLI thì khớp).
  it('file CRLF: Edit có xuống dòng (như CLI) không bị chặn nhầm, vẫn tự duyệt', async () => {
    put('ngan.txt', 'dong 1\r\nTypical SPAs … has loaded:\r\n')
    await startSession()
    const first = await attempt('Edit', { file_path: join(root, 'ngan.txt'), old_string: 'has loaded:', new_string: 'has loaded:\ndong 21' })
    expect(isAuto(first)).toBe(true)
    put('ngan.txt', 'dong 1\r\nTypical SPAs … has loaded:\r\ndong 21\r\n')
    const second = await attempt('Edit', { file_path: join(root, 'ngan.txt'), old_string: 'has loaded:\ndong 21', new_string: 'has loaded:\ndong 21\ndong 22' })
    expect(isAuto(second)).toBe(true)
    expect(records.filter((r) => r.decision === 'blocked')).toEqual([])
  })

  it('bị chặn thật (old_string không có) → nhật ký ghi đường dẫn tương đối + lý do', async () => {
    put('ngan.txt', 'abc\n')
    expect(await attempt('Edit', { file_path: join(root, 'ngan.txt'), old_string: 'không có', new_string: 'x' })).toMatchObject({
      decision: { allow: false, message: 'Không tìm thấy đoạn cần sửa trong file.' }
    })
    expect(records.at(-1)).toMatchObject({ target: 'ngan.txt', decision: 'blocked', detail: 'old_string_not_found' })
    // Ngoài thư mục: giữ nguyên đường dẫn trợ lý đưa.
    const outside = join(tmpdir(), 'ngoai.txt')
    await attempt('Write', { file_path: outside, content: 'x' })
    expect(records.at(-1)).toMatchObject({ target: outside, decision: 'blocked', detail: 'outside_project' })
  })

  it(`tối đa ${AUTO_EDIT_MAX_FILES} file / phiên: file thứ 51 → thẻ; sửa lại file đã tính vẫn tự duyệt`, async () => {
    await startSession('f0.txt')
    for (let i = 1; i < AUTO_EDIT_MAX_FILES; i++) expect(isAuto(await write(`f${i}.txt`, `${i}\n`))).toBe(true)
    expect(card(await write('f50.txt', 'x\n')).autoEdit).toMatchObject({ offer: false, reason: 'limit', sessionActive: true })
    expect(isAuto(await write('f7.txt', 'sửa lại\n'))).toBe(true)
    expect(auto.list('c1')[0].counted).toBe(AUTO_EDIT_MAX_FILES)
  })

  it('hết 2 giờ → kết thúc, lại hỏi; còn hoàn tác được', async () => {
    await startSession()
    now += AUTO_EDIT_SESSION_MS - 1
    expect(isAuto(await write('a.txt', '1\n'))).toBe(true)
    now += 1
    expect(card(await write('b.txt', '2\n')).autoEdit).toEqual({ offer: true })
    const [s] = auto.list('c1')
    expect(s).toMatchObject({ endReason: 'expired', endedAt: s.endsAt, undoUntil: s.endsAt + AUTO_EDIT_UNDO_MS })
    expect(s.files.map((f) => f.path)).toEqual(['start.txt', 'a.txt'])
  })

  it.each(['stopped', 'write_off', 'folder', 'kill_switch'] as const)('kết thúc phiên (%s) → lại hỏi', async (reason) => {
    await startSession()
    if (reason === 'kill_switch') await auto.endAll(reason)
    else await auto.end('c1', reason)
    expect('card' in (await write('a.txt', 'x\n'))).toBe(true)
    expect(auto.list('c1')[0].endReason).toBe(reason)
  })

  it('thư mục của cuộc đổi sang chỗ khác → phiên kết thúc (folder), thẻ như thường', async () => {
    await startSession()
    const other = mkdtempSync(join(tmpdir(), 'tw-auto-other-'))
    try {
      writable = other
      const c = card(await attempt('Write', { file_path: 'x.txt', content: 'x' }))
      expect(c.autoEdit).toEqual({ offer: true })
      expect(auto.list('c1')[0].endReason).toBe('folder')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('"Đồng ý, và không hỏi lại" khi file vừa đổi thành file có hard link → không bật, thẻ vẫn chờ', async () => {
    put('a.txt', 'cũ\n')
    const out = await attempt('Write', { file_path: 'a.txt', content: 'mới\n' })
    const c = card(out)
    linkSync(join(root, 'a.txt'), join(root, 'b.txt'))
    expect(await approvals.respondAuto(c.id)).toEqual({ ok: false, error: 'not_eligible' })
    expect(auto.isActive('c1')).toBe(false)
    approvals.respond(c.id, true)
    expect(await (out as { done: Promise<Decision> }).done).toEqual({ allow: true })
  })

  describe('Hoàn tác tất cả', () => {
    it('khôi phục file đã sửa, xoá file trợ lý tạo, nhật ký undone; xong thì bỏ hẳn phiên', async () => {
      put('a.txt', 'gốc A\n')
      put('b.txt', 'gốc B\n')
      await startSession()
      await write('a.txt', 'A lần 1\n')
      await write('a.txt', 'A lần 2\n')
      await write('b.txt', 'B mới\n')
      await write('sub/new.txt', 'mới\n')
      const [s] = auto.list('c1')
      const r = await auto.undo(s.id)
      expect(r).toEqual({ restored: ['start.txt', 'a.txt', 'b.txt', 'sub/new.txt'], conflicts: [], failed: [] })
      expect(read('a.txt')).toBe('gốc A\n')
      expect(read('b.txt')).toBe('gốc B\n')
      expect(existsSync(join(root, 'sub/new.txt'))).toBe(false)
      expect(existsSync(join(root, 'start.txt'))).toBe(false)
      expect(records.filter((x) => x.decision === 'undone').map((x) => x.target)).toEqual(['start.txt', 'a.txt', 'b.txt', 'sub/new.txt'])
      expect(auto.list()).toEqual([])
      expect(readdirSync(dataDir)).toEqual([])
      expect(auto.isActive('c1')).toBe(false)
    })

    it.each([
      ['CLI ghi giữ CRLF', (s: string) => s],
      ['CLI ghi LF', (s: string) => s.replace(/\r\n/g, '\n')]
    ])('file CRLF (%s) → không báo xung đột nhầm', async (_name, written) => {
      put('win.txt', 'gốc\r\nhas loaded:\r\n')
      await startSession()
      expect(isAuto(await attempt('Edit', { file_path: 'win.txt', old_string: 'has loaded:\n', new_string: 'has loaded:\ndong 21\n' }))).toBe(true)
      put('win.txt', written('gốc\r\nhas loaded:\r\ndong 21\r\n'))
      const [s] = auto.list('c1')
      expect(await auto.undo(s.id)).toMatchObject({ conflicts: [], failed: [] })
      expect(read('win.txt')).toBe('gốc\r\nhas loaded:\r\n')
    })

    it('file bị sửa thêm sau lần tự duyệt cuối → xung đột, không ghi đè; chọn ghi đè → khôi phục', async () => {
      put('a.txt', 'gốc\n')
      await startSession()
      await write('a.txt', 'trợ lý\n')
      put('a.txt', 'người dùng sửa thêm\n')
      const [s] = auto.list('c1')
      expect(await auto.undo(s.id)).toEqual({ restored: ['start.txt'], conflicts: ['a.txt'], failed: [] })
      expect(read('a.txt')).toBe('người dùng sửa thêm\n')
      // Phiên còn (đã kết thúc) với file xung đột — hoàn tác tiếp được.
      expect(auto.list('c1')[0]).toMatchObject({ endReason: 'undo', files: [{ path: 'a.txt' }] })
      expect(await auto.undo(s.id, ['a.txt'])).toEqual({ restored: ['a.txt'], conflicts: [], failed: [] })
      expect(read('a.txt')).toBe('gốc\n')
    })

    it('CLI chưa kịp ghi (file vẫn là bản gốc) → coi như đã khôi phục', async () => {
      put('a.txt', 'gốc\n')
      await startSession()
      expect(isAuto(await attempt('Write', { file_path: 'a.txt', content: 'không ghi\n' }))).toBe(true)
      const [s] = auto.list('c1')
      expect((await auto.undo(s.id))?.restored).toContain('a.txt')
      expect(read('a.txt')).toBe('gốc\n')
    })

    it('junction cài vào sau khi sửa (đường dẫn giờ ra ngoài) → không ghi ra ngoài', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'tw-auto-out-'))
      try {
        put('dir/a.txt', 'gốc\n')
        await startSession()
        await write('dir/a.txt', 'mới\n')
        rmSync(join(root, 'dir'), { recursive: true })
        writeFileSync(join(outside, 'a.txt'), 'mới\n')
        symlinkSync(outside, join(root, 'dir'), 'junction')
        const [s] = auto.list('c1')
        expect((await auto.undo(s.id))?.failed).toEqual([{ path: 'dir/a.txt', reason: 'link_outside' }])
        expect(readFileSync(join(outside, 'a.txt'), 'utf8')).toBe('mới\n')
      } finally {
        rmSync(join(root, 'dir'), { force: true, recursive: false })
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('"Xong" bỏ bản gốc của phiên đã kết thúc; phiên đang chạy thì không', async () => {
      await startSession()
      const [s] = auto.list('c1')
      expect(await auto.dismiss(s.id)).toBe(false)
      await auto.stop(s.id)
      expect(await auto.dismiss(s.id)).toBe(true)
      expect(auto.list()).toEqual([])
      expect(readdirSync(dataDir)).toEqual([])
    })
  })

  describe('(2) hoàn tác không mất khi tắt app / crash', () => {
    it('mở lại app: phiên đang chạy → kết thúc (app_closed), vẫn hoàn tác được từ bản gốc trên đĩa', async () => {
      put('a.txt', 'gốc\n')
      await startSession()
      now += 60_000
      await write('a.txt', 'trợ lý sửa\n')
      // "Crash": bỏ đối tượng cũ, không gọi end.
      now += 3_600_000
      const reopened = makeAuto()
      await reopened.load()
      const [s] = reopened.list('c1')
      expect(s).toMatchObject({ endReason: 'app_closed', endedAt: 1_060_000, files: [{ path: 'start.txt' }, { path: 'a.txt' }] })
      expect(reopened.isActive('c1')).toBe(false)
      expect((await reopened.undo(s.id))?.restored).toEqual(['start.txt', 'a.txt'])
      expect(read('a.txt')).toBe('gốc\n')
    })

    it('quá 7 ngày sau khi kết thúc → dọn lúc mở app (cả bản gốc)', async () => {
      put('a.txt', 'gốc\n')
      await startSession()
      await write('a.txt', 'mới\n')
      await auto.end('c1', 'stopped')
      now += AUTO_EDIT_UNDO_MS - 1
      const stillThere = makeAuto()
      await stillThere.load()
      expect(stillThere.list('c1')).toHaveLength(1)
      now += 1
      const later = makeAuto()
      await later.load()
      expect(later.list()).toEqual([])
      expect(readdirSync(dataDir)).toEqual([])
    })

    it('phiên của tài khoản khác không hiện, không hoàn tác được', async () => {
      await startSession()
      const [s] = auto.list('c1')
      const other = new AutoEdits({
        dir: dataDir,
        getOwner: () => 'u2',
        now: () => now,
        title: () => null,
        changed,
        log: { warn: vi.fn(), info: vi.fn() }
      })
      await other.load()
      expect(other.list()).toEqual([])
      expect(await other.undo(s.id)).toBeNull()
    })
  })
})
