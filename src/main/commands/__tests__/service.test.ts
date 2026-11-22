import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandApprovalRequest } from '@shared/commands'
import type { ActionLogEntry } from '../../audit/actionLog'
import { AppToolRegistry } from '../../tools/registry'
import { findGit, gitEnv, probeGit, type GitInfo } from '../gitEnv'
import { CommandService, KILL_SWITCH_HOLDER, RUN_COMMAND_TOOL } from '../service'

const gitExe = findGit(process.env.PATH)
let git: GitInfo = { error: 'not_found' }
let base: string
let repo: string
let marker: string

/** Repo "lạ": cấu hình chạy chương trình (ghi file đánh dấu) qua filter, diff driver, textconv, fsmonitor, info/attributes. */
function makeEvilRepo(): void {
  base = mkdtempSync(join(tmpdir(), 'mmc-cmd-'))
  repo = join(base, 'repo')
  marker = join(base, 'marker.txt')
  mkdirSync(repo)
  const script = join(base, 'pwn.js')
  writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n')`)
  const cmd = (what: string): string => `"${process.execPath.replace(/\\/g, '/')}" "${script.replace(/\\/g, '/')}" ${what}`
  const g = (...args: string[]): void => void execFileSync(gitExe!, args, { cwd: repo, env: gitEnv() })
  g('init', '-q')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  writeFileSync(join(repo, 'a.txt'), 'dòng 1\n')
  writeFileSync(join(repo, '.gitattributes'), '*.txt filter=evil diff=evil\n')
  g('add', '.')
  g('commit', '-qm', 'init')
  g('config', 'filter.evil.clean', cmd('clean'))
  g('config', 'filter.evil.smudge', cmd('smudge'))
  g('config', 'diff.evil.textconv', cmd('textconv'))
  g('config', 'diff.evil.command', cmd('diffcmd'))
  g('config', 'diff.external', cmd('external'))
  g('config', 'core.fsmonitor', cmd('fsmonitor'))
  g('config', 'log.showSignature', 'true')
  g('config', 'gpg.program', cmd('gpg'))
  // attr-source không che file này → app phải ghi đè khoá driver.
  mkdirSync(join(repo, '.git', 'info'), { recursive: true })
  writeFileSync(join(repo, '.git', 'info', 'attributes'), '*.txt filter=evil diff=evil\n')
  writeFileSync(join(repo, 'a.txt'), 'dòng 1\ndòng 2\n')
}

beforeAll(async () => {
  git = await probeGit(gitExe)
  if (!('error' in git)) makeEvilRepo()
})
afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

type Harness = {
  service: CommandService
  registry: AppToolRegistry
  cards: CommandApprovalRequest[]
  logs: ActionLogEntry[]
  kill: { arm: ReturnType<typeof vi.fn>; disarm: ReturnType<typeof vi.fn> }
  settings: { gitEnabled: boolean }
}

function harness(folder: () => string | null = () => repo): Harness {
  const cards: CommandApprovalRequest[] = []
  const logs: ActionLogEntry[] = []
  const settings = { gitEnabled: true }
  const kill = { arm: vi.fn(() => true), disarm: vi.fn() }
  const service = new CommandService({
    settings: () => settings,
    git: () => git,
    folderOf: () => folder(),
    emit: (e) => {
      if (!('closed' in e)) cards.push(e)
    },
    log: (e) => logs.push(e),
    killSwitch: kill,
    logger: { info: () => {}, warn: () => {} }
  })
  const registry = new AppToolRegistry()
  service.registerTools(registry)
  return { service, registry, cards, logs, kill, settings }
}

const text = (r: { content: { type: string; text?: string }[] }): string => r.content.map((c) => c.text ?? '').join('')
/** Gọi tool, đợi thẻ duyệt xuất hiện rồi trả lời. */
async function callAndAnswer(h: Harness, input: object, approve: boolean | null, feedback?: string) {
  const before = h.cards.length
  const p = h.registry.call(RUN_COMMAND_TOOL, { program: 'git', reason: 'xem thay đổi', ...input }, { conversationId: 'c1' })
  if (approve !== null) {
    await vi.waitFor(() => expect(h.cards.length).toBe(before + 1), { timeout: 10_000 })
    h.service.respond({ id: h.cards.at(-1)!.id, approve, feedback })
  }
  return p
}

const describeGit = gitExe ? describe : describe.skip

describeGit('CommandService (git thật)', () => {
  beforeEach(() => {
    if (marker) rmSync(marker, { force: true })
  })

  it('git dùng được: đường dẫn tuyệt đối + hiểu --attr-source', () => {
    expect('error' in git).toBe(false)
  })

  it('repo lạ: status / diff / log -p / show — chạy được, KHÔNG chương trình nào của repo được chạy', { timeout: 30_000 }, async () => {
    const h = harness()
    const status = await callAndAnswer(h, { subcommand: 'status', args: ['--short'] }, true)
    expect(text(status)).toContain('a.txt')
    const diff = await callAndAnswer(h, { subcommand: 'diff', args: [] }, true)
    expect(text(diff)).toContain('+dòng 2')
    await callAndAnswer(h, { subcommand: 'log', args: ['-p', '-1'] }, true)
    await callAndAnswer(h, { subcommand: 'show', args: ['--stat', 'HEAD'] }, true)
    expect(existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe('')
    // Thẻ hiện nguyên lệnh: lệnh dễ đọc + lệnh thật có cờ an toàn.
    expect(h.cards[0].display).toBe('git status --short -- .')
    expect(h.cards[0].executable).toBe(gitExe)
    expect(h.cards[1].argv).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv', '-c', 'core.fsmonitor=false', 'filter.evil.clean=']))
    expect(h.logs.map((l) => l.decision)).toEqual(['approved', 'approved', 'approved', 'approved'])
    expect(h.logs[0]).toMatchObject({ kind: 'command', target: 'git status --short -- .', exitCode: 0, conversationId: 'c1' })
    // Giữ phím dừng khẩn cấp trong lúc chạy, nhả khi xong.
    expect(h.kill.arm).toHaveBeenCalledWith(KILL_SWITCH_HOLDER)
    expect(h.kill.disarm).toHaveBeenCalledWith(KILL_SWITCH_HOLDER)
  })

  it('đối chứng: chạy git thẳng (không cờ an toàn) thì repo này CÓ chạy chương trình', () => {
    try {
      execFileSync(gitExe!, ['diff'], { cwd: repo, env: gitEnv(), stdio: 'ignore', timeout: 15_000 })
    } catch {
      // diff driver giả có thể trả mã lỗi — chỉ cần biết nó đã chạy.
    }
    expect(existsSync(marker)).toBe(true)
  })

  it('từ chối (kèm góp ý) → không chạy, trợ lý nhận góp ý; nhật ký ghi rejected', async () => {
    const h = harness()
    const r = await callAndAnswer(h, { subcommand: 'log', args: ['--oneline'] }, false, 'chỉ xem 3 commit thôi')
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('chỉ xem 3 commit thôi')
    expect(h.logs).toEqual([expect.objectContaining({ decision: 'rejected', target: 'git log --oneline -- .' })])
  })

  it('cờ không được phép → chặn trước khi hỏi (không có thẻ), nhật ký ghi blocked', async () => {
    const h = harness()
    const r = await callAndAnswer(h, { subcommand: 'diff', args: ['--output=../x.txt'] }, null)
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('--output')
    expect(h.cards).toHaveLength(0)
    expect(h.logs).toEqual([expect.objectContaining({ decision: 'blocked' })])
  })

  it('đường dẫn qua junction ra ngoài thư mục → chặn', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mmc-cmd-out-'))
    const { symlinkSync } = await import('node:fs')
    symlinkSync(outside, join(repo, 'link'), 'junction')
    try {
      const h = harness()
      const r = await callAndAnswer(h, { subcommand: 'log', args: [], paths: ['link'] }, null)
      expect(text(r)).toContain('junction')
      expect(h.cards).toHaveLength(0)
    } finally {
      rmSync(join(repo, 'link'), { recursive: false, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('dừng lượt khi thẻ đang chờ → không chạy, nhật ký ghi stopped', async () => {
    const h = harness()
    const p = callAndAnswer(h, { subcommand: 'status', args: [] }, null)
    await vi.waitFor(() => expect(h.cards).toHaveLength(1))
    h.service.cancelConversation('c1')
    expect((await p).isError).toBe(true)
    expect(h.logs).toEqual([expect.objectContaining({ decision: 'stopped' })])
  })

  it('tắt tính năng / chưa có thư mục → không có tool', () => {
    const h = harness()
    expect(h.registry.available({ conversationId: 'c1' })).toEqual([RUN_COMMAND_TOOL])
    h.settings.gitEnabled = false
    expect(h.registry.available({ conversationId: 'c1' })).toEqual([])
    expect(harness(() => null).registry.available({ conversationId: 'c1' })).toEqual([])
  })

  it('lần chạy theo lịch: registry chỉ cho tool trong danh sách của lịch → run_command không có', () => {
    const h = harness()
    h.registry.restrict('c1', ['propose_file_change'])
    expect(h.registry.available({ conversationId: 'c1' })).toEqual([])
  })
})

describe('findGit / gitEnv', () => {
  it('bỏ qua mục PATH tương đối (vd "." — sẽ trỏ vào thư mục dự án)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmc-findgit-'))
    try {
      writeFileSync(join(dir, process.platform === 'win32' ? 'git.exe' : 'git'), '')
      expect(findGit(`.;relative\\bin`, 'win32')).toBeNull()
      expect(findGit(`.;${dir}`, process.platform)).toBe(join(dir, process.platform === 'win32' ? 'git.exe' : 'git'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('bỏ biến GIT_* thừa hưởng, tắt hỏi mật khẩu / pager / khoá index', () => {
    const env = gitEnv({ PATH: 'x', GIT_DIR: 'C:\\khac', git_config_parameters: "'core.fsmonitor=evil'", PAGER: 'less' })
    expect(env).toEqual({ PATH: 'x', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat' })
  })
})
