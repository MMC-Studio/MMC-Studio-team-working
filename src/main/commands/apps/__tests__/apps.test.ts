import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLENDER_SCRIPT_MAX, type AppsSettings, type CommandApprovalRequest } from '@shared/commands'
import type { ActionLogEntry } from '../../../audit/actionLog'
import { AppToolRegistry, type ToolResult } from '../../../tools/registry'
import type { Verdict } from '../../service'
import { AppPolicyError, checkUnityMethod, planBlender, unityArgv } from '../plan'
import { logPathFor, pruneLogs, readTail, startAppProcess, type SpawnFn } from '../runner'
import { APP_KILL_SWITCH_HOLDER, AppRunService, RUN_BLENDER_TOOL, RUN_UNITY_TOOL, type EditedFile } from '../service'
import { unityLockState } from '../unityLock'
import { ExeVersions, parseUnityVersion, projectUnityVersion, unityVersionFromPath } from '../version'

const FAKE = join(__dirname, '..', '..', '..', '..', '..', 'tests', 'e2e', 'fixtures', 'fake-app.cjs')
const fakeSpawn: SpawnFn = (exe, argv, options) => spawn(process.execPath, [FAKE, exe, ...argv], options)
const win = process.platform === 'win32'

let base: string
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'mmc-apps-'))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

let n = 0
const dir = (name: string): string => {
  const d = join(base, `${name}-${n++}`)
  mkdirSync(d, { recursive: true })
  return d
}
/** Dự án Unity tối thiểu: ProjectSettings/ProjectVersion.txt. */
function unityProject(version = '2022.3.62f3'): string {
  const d = dir('UnityGame')
  mkdirSync(join(d, 'ProjectSettings'))
  mkdirSync(join(d, 'Assets'))
  writeFileSync(join(d, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${version}\nm_EditorVersionWithRevision: ${version} (96770f904ca7)\n`)
  return d
}
/** Unity.exe "cài bằng Hub" (file rỗng — phiên bản lấy theo thư mục). */
function unityExe(version = '2022.3.62f3'): string {
  const d = join(dir('Hub'), 'Editor', version, 'Editor')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'Unity.exe'), '')
  return join(d, 'Unity.exe')
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const waitFor = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('waitFor: hết giờ')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('phiên bản Unity', () => {
  it('đọc ProductVersion / thư mục Hub / ProjectVersion.txt', async () => {
    expect(parseUnityVersion('2022.3.62f3_96770f904ca7')).toBe('2022.3.62f3')
    expect(parseUnityVersion('6000.6.0f1_f7f8ed4d1e24')).toBe('6000.6.0f1')
    expect(parseUnityVersion('2022.3.62.9860879')).toBeNull()
    expect(parseUnityVersion(null)).toBeNull()
    expect(unityVersionFromPath('C:\\Program Files\\Unity\\Hub\\Editor\\6000.6.0f1\\Editor\\Unity.exe')).toBe('6000.6.0f1')
    expect(unityVersionFromPath('D:\\Unity\\Unity.exe')).toBeNull()
    expect(await projectUnityVersion(unityProject('2021.3.45f1'))).toBe('2021.3.45f1')
    expect(await projectUnityVersion(dir('NotUnity'))).toBeNull()
  })

  it('ProductVersion ưu tiên hơn thư mục; đệm theo file, cài bản khác vào cùng chỗ → đọc lại', async () => {
    const exe = unityExe('2022.3.62f3')
    const read = vi.fn(async () => '2023.2.1f1_abc')
    const versions = new ExeVersions(read)
    expect(await versions.unity(exe)).toBe('2023.2.1f1')
    expect(await versions.unity(exe)).toBe('2023.2.1f1')
    expect(read).toHaveBeenCalledTimes(1)
    writeFileSync(exe, 'bản mới')
    utimesSync(exe, new Date(), new Date(Date.now() + 5000))
    read.mockResolvedValueOnce(null as unknown as string)
    expect(await versions.unity(exe)).toBe('2022.3.62f3')
    expect(await versions.unity(join(base, 'khong-co.exe'))).toBeNull()
  })
})

describe('UnityLockfile: kiểm KHOÁ, không chỉ tồn tại', () => {
  it('không có file / file thừa sau crash → không chặn', async () => {
    const p = unityProject()
    expect(await unityLockState(p)).toBe('free')
    mkdirSync(join(p, 'Temp'))
    writeFileSync(join(p, 'Temp', 'UnityLockfile'), '')
    expect(await unityLockState(p)).toBe('free')
  })

  it.runIf(win)('file đang bị giữ độc quyền (như Unity Editor đang mở) → locked', async () => {
    const p = unityProject()
    mkdirSync(join(p, 'Temp'))
    const lock = join(p, 'Temp', 'UnityLockfile')
    writeFileSync(lock, '')
    const holder = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "$f=[IO.File]::Open($env:LOCK_PATH,'Open','ReadWrite','None'); Write-Output ready; Start-Sleep 60"],
      { env: { ...process.env, LOCK_PATH: lock }, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    try {
      await new Promise<void>((r) => holder.stdout.on('data', (b: Buffer) => b.toString().includes('ready') && r()))
      expect(await unityLockState(p)).toBe('locked')
    } finally {
      holder.kill()
    }
    await new Promise((r) => holder.on('close', r))
    expect(await unityLockState(p)).toBe('free')
  }, 30_000)
})

describe('dựng lệnh', () => {
  it('Unity: chỉ -executeMethod Lớp.Hàm, tên lạ bị chặn', () => {
    expect(checkUnityMethod(' BuildTools.BuildWindows ')).toBe('BuildTools.BuildWindows')
    expect(checkUnityMethod('My.Name_Space.Tools.Run2')).toBe('My.Name_Space.Tools.Run2')
    for (const bad of ['Build', 'Build.Run -quit', '-executeMethod X.Y', 'A.B;C', 'A..B', '1A.B', 'A.B()', ''])
      expect(() => checkUnityMethod(bad), bad).toThrow(AppPolicyError)
    expect(unityArgv('D:\\Game', 'A.B', 'C:\\logs\\x.log').argv).toEqual([
      '-batchmode',
      '-quit',
      '-projectPath',
      'D:\\Game',
      '-executeMethod',
      'A.B',
      '-logFile',
      'C:\\logs\\x.log'
    ])
  })

  it('Blender: script trong thư mục, đúng đuôi, ≤ 64 KB; tắt autoexec; .blend tuỳ chọn', async () => {
    const p = dir('Blend')
    mkdirSync(join(p, 'tools'))
    writeFileSync(join(p, 'tools', 'export.py'), 'import bpy\nprint("hi")\n')
    writeFileSync(join(p, 'scene.blend'), 'BLENDER')
    const plan = await planBlender(p, 'tools/export.py', 'scene.blend', ['--fast', 'a b'])
    expect(plan.argv).toEqual([
      '--background',
      join(p, 'scene.blend'),
      '--disable-autoexec',
      '--python-exit-code',
      '1',
      '--python',
      join(p, 'tools', 'export.py'),
      '--',
      '--fast',
      'a b'
    ])
    expect(plan.display).toBe('blender --background scene.blend --python tools/export.py -- --fast "a b"')
    expect(plan.script.content).toContain('import bpy')

    writeFileSync(join(p, 'big.py'), '#'.repeat(BLENDER_SCRIPT_MAX + 1))
    await expect(planBlender(p, 'big.py', null, [])).rejects.toThrow(/quá 64 KB/)
    writeFileSync(join(p, 'max.py'), '#'.repeat(BLENDER_SCRIPT_MAX))
    expect((await planBlender(p, 'max.py', null, [])).script.content).toHaveLength(BLENDER_SCRIPT_MAX)
    await expect(planBlender(p, '../x.py', null, [])).rejects.toThrow(/ngoài thư mục/)
    await expect(planBlender(p, join(p, 'tools', 'export.py'), null, [])).rejects.toThrow(/TƯƠNG ĐỐI/)
    await expect(planBlender(p, 'scene.blend', null, [])).rejects.toThrow(/chỉ nhận file .py/)
    await expect(planBlender(p, 'tools/missing.py', null, [])).rejects.toThrow(/không tồn tại/)
    await expect(planBlender(p, 'tools/export.py', 'tools/export.py', [])).rejects.toThrow(/chỉ nhận file .blend/)
  })

  it.runIf(win)('Blender: script qua junction ra ngoài thư mục → chặn', async () => {
    const p = dir('BlendJ')
    const outside = dir('Outside')
    writeFileSync(join(outside, 'evil.py'), 'print(1)')
    symlinkSync(outside, join(p, 'lib'), 'junction')
    await expect(planBlender(p, 'lib/evil.py', null, [])).rejects.toThrow(/ngoài thư mục/)
  })
})

describe('chạy tiến trình', () => {
  it('log đầy đủ ra file, trả PHẦN CUỐI; dọn log quá 90 ngày', async () => {
    const logs = dir('logs')
    const p = dir('Blend')
    writeFileSync(join(p, 'big.py'), 'BIG')
    const logPath = logPathFor(logs, 'blender', 'abcdef1234')
    expect(logPath).toMatch(/\d{4}-\d{2}-\d{2}_\d{6}-blender-abcdef12\.log$/)
    const out = await startAppProcess({
      exe: 'blender.exe',
      argv: ['--background', '--python', join(p, 'big.py')],
      cwd: p,
      logPath,
      ownLog: false,
      timeoutMs: 30_000,
      spawn: fakeSpawn
    }).done
    expect(out.code).toBe(0)
    expect(out.logBytes).toBeGreaterThan(64 * 1024)
    expect(Buffer.byteLength(out.tail)).toBeLessThanOrEqual(64 * 1024)
    expect(out.tail).toContain('Blender script done')
    expect(out.tail).not.toContain('Fake Blender — script')
    expect(readFileSync(logPath, 'utf8')).toContain('Fake Blender — script')

    const old = join(logs, 'old.log')
    writeFileSync(old, 'x')
    const past = new Date(Date.now() - 91 * 24 * 3600 * 1000)
    utimesSync(old, past, past)
    expect(await pruneLogs(logs)).toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(logPath)).toBe(true)
  }, 30_000)

  it('hết hạn → dừng CẢ CÂY tiến trình (cả tiến trình con), log ghi lý do', async () => {
    const logs = dir('logs')
    const p = unityProject()
    const logPath = logPathFor(logs, 'unity', 'timeout01')
    const out = await startAppProcess({
      exe: 'Unity.exe',
      argv: unityArgv(p, 'Tools.Sleep', logPath).argv,
      cwd: p,
      logPath,
      ownLog: true,
      timeoutMs: 1500,
      spawn: fakeSpawn
    }).done
    expect(out.timedOut).toBe(true)
    expect(out.tail).toContain('Đang chạy lâu')
    expect(out.tail).toContain('Hết hạn')
    const child = Number(readFileSync(logPath + '.child', 'utf8'))
    await waitFor(() => !alive(child))
  }, 30_000)

  it('đọc phần cuối file không tồn tại → rỗng', async () => {
    expect(await readTail(join(base, 'khong-co.log'))).toEqual({ text: '', bytes: 0 })
  })
})

type Harness = {
  service: AppRunService
  registry: AppToolRegistry
  cards: CommandApprovalRequest[]
  logs: ActionLogEntry[]
  edits: EditedFile[]
  settings: AppsSettings
  write: { value: boolean }
  folder: { value: string | null }
  lock: { value: 'free' | 'locked' | 'unknown' }
  kill: { arm: ReturnType<typeof vi.fn>; disarm: ReturnType<typeof vi.fn> }
  changed: ReturnType<typeof vi.fn>
  answer(v: Verdict): void
  /** Chạy ngay trước khi trả lời thẻ (mô phỏng việc xảy ra trong lúc thẻ chờ). */
  beforeAnswer: { fn: (() => void) | null }
}

function harness(project: string, exes: { unity?: string; blender?: string } = {}): Harness {
  const cards: CommandApprovalRequest[] = []
  const logs: ActionLogEntry[] = []
  const edits: EditedFile[] = []
  const settings: AppsSettings = {
    unity: { enabled: true, path: exes.unity ?? unityExe() },
    blender: { enabled: true, path: exes.blender ?? join(dir('Blender'), 'blender.exe') }
  }
  const write = { value: true }
  const folder = { value: project as string | null }
  const lock = { value: 'free' as 'free' | 'locked' | 'unknown' }
  const kill = { arm: vi.fn(() => true), disarm: vi.fn() }
  const changed = vi.fn()
  let pending: ((v: Verdict) => void) | null = null
  const beforeAnswer: Harness['beforeAnswer'] = { fn: null }
  const service = new AppRunService({
    settings: () => settings,
    folderOf: () => folder.value,
    canWrite: () => write.value,
    editedFiles: (_id, exts) => edits.filter((e) => exts.some((x) => e.path.endsWith(x))),
    versions: new ExeVersions(async () => null),
    logsDir: join(base, 'runs'),
    request: (req) => {
      cards.push({ id: `c${cards.length}`, ...req })
      return new Promise((r) => (pending = r))
    },
    log: (e) => logs.push(e),
    runsChanged: changed,
    killSwitch: kill,
    logger: { info: () => {}, warn: () => {} },
    spawn: fakeSpawn,
    lockState: async () => lock.value
  })
  const registry = new AppToolRegistry()
  service.registerTools(registry)
  return {
    service,
    registry,
    cards,
    logs,
    edits,
    settings,
    write,
    folder,
    lock,
    kill,
    changed,
    beforeAnswer,
    answer: (v) => {
      beforeAnswer.fn?.()
      pending?.(v)
    }
  }
}

const text = (r: ToolResult): string => r.content.map((c) => ('text' in c ? c.text : '')).join('')
const call = (h: Harness, tool: string, input: object): Promise<ToolResult> =>
  h.registry.call(tool, input, { conversationId: "conv1" })
/** Gọi tool; khi thẻ hiện thì trả lời. */
async function callAndAnswer(h: Harness, tool: string, input: object, verdict: Verdict | null): Promise<ToolResult> {
  const before = h.cards.length
  const result = call(h, tool, input)
  if (verdict) {
    await waitFor(() => h.cards.length > before)
    h.answer(verdict)
  }
  return result
}
const approve: Verdict = { approve: true }

describe('AppRunService — khi nào có tool', () => {
  it('chỉ khi bật + đã chọn chương trình + cuộc có thư mục với quyền SỬA', () => {
    const h = harness(unityProject())
    expect(h.service.toolsFor('conv1')?.names).toEqual([RUN_UNITY_TOOL, RUN_BLENDER_TOOL])
    expect(h.service.toolsFor('conv1')?.context).toContain('Lớp.Hàm')
    h.write.value = false
    expect(h.service.toolsFor('conv1')).toBeNull()
    h.write.value = true
    h.settings.unity.enabled = false
    expect(h.service.toolsFor('conv1')?.names).toEqual([RUN_BLENDER_TOOL])
    h.settings.blender.path = null
    expect(h.service.toolsFor('conv1')).toBeNull()
    h.settings.unity.enabled = true
    h.folder.value = null
    expect(h.service.toolsFor('conv1')).toBeNull()
  })
})

describe('AppRunService — Unity', () => {
  let project: string
  beforeEach(() => {
    project = unityProject('2022.3.62f3')
  })

  it('phiên bản Unity.exe khác dự án → chặn TRƯỚC khi hỏi, báo rõ hai phiên bản', async () => {
    const h = harness(project, { unity: unityExe('6000.6.0f1') })
    const r = await call(h, RUN_UNITY_TOOL, { method: 'Build.Run', reason: 'build' })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('Dự án dùng Unity 2022.3.62f3 nhưng Unity.exe đã chọn là 6000.6.0f1')
    expect(h.cards).toHaveLength(0)
    expect(h.logs).toEqual([expect.objectContaining({ kind: 'unity', decision: 'blocked', target: 'Unity Build.Run' })])
  })

  it('không đọc được phiên bản Unity.exe / không phải dự án Unity → chặn', async () => {
    const odd = join(dir('Custom'), 'Unity.exe')
    writeFileSync(odd, '')
    const h = harness(project, { unity: odd })
    expect(text(await call(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }))).toContain('Không đọc được phiên bản')
    const h2 = harness(dir('NotUnity'))
    expect(text(await call(h2, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }))).toContain('không phải dự án Unity')
    expect([...h.cards, ...h2.cards]).toHaveLength(0)
  })

  it('Unity Editor đang mở dự án (khoá) → chặn; không kiểm được khoá → chặn', async () => {
    const h = harness(project)
    h.lock.value = 'locked'
    expect(text(await call(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }))).toContain('Unity Editor đang mở dự án này')
    h.lock.value = 'unknown'
    expect(text(await call(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }))).toContain('Không kiểm được Temp/UnityLockfile')
    expect(h.cards).toHaveLength(0)
  })

  it('tên hàm lạ → chặn, không hiện thẻ', async () => {
    const h = harness(project)
    expect(text(await call(h, RUN_UNITY_TOOL, { method: 'A.B -nographics', reason: 'x' }))).toContain('Tên hàm không hợp lệ')
    expect(h.cards).toHaveLength(0)
  })

  it('thẻ: lệnh thật, phiên bản, file C# vừa sửa, log ngoài dự án; Chạy → phần cuối log + nhật ký', async () => {
    const h = harness(project)
    h.edits.push({ path: 'Assets/Editor/Build.cs', at: 1 }, { path: 'tools/x.py', at: 2 })
    const r = await callAndAnswer(h, RUN_UNITY_TOOL, { method: 'BuildTools.Build', reason: 'Build bản Windows' }, approve)
    const card = h.cards[0]
    expect(card).toMatchObject({
      program: 'unity',
      display: 'Unity -batchmode -quit -executeMethod BuildTools.Build',
      cwd: project,
      timeoutMs: 10 * 60_000,
      reason: 'Build bản Windows',
      app: { editedFiles: ['Assets/Editor/Build.cs'], version: '2022.3.62f3' }
    })
    expect(card.argv.slice(0, 6)).toEqual(['-batchmode', '-quit', '-projectPath', project, '-executeMethod', 'BuildTools.Build'])
    expect(card.argv[7]).toBe(card.app!.logPath)
    expect(card.app!.logPath.startsWith(join(base, 'runs'))).toBe(true)
    expect(r.isError).toBeFalsy()
    expect(text(r)).toContain('mã thoát 0')
    expect(text(r)).toContain('Executed BuildTools.Build: Build OK')
    expect(text(r)).toContain(`Log đầy đủ: ${card.app!.logPath}`)
    expect(h.logs).toEqual([expect.objectContaining({ kind: 'unity', decision: 'approved', exitCode: 0, detail: null })])
    expect(h.service.list('conv1')).toEqual([expect.objectContaining({ state: 'done', exitCode: 0, program: 'unity' })])
    expect(h.kill.arm).toHaveBeenCalledWith(APP_KILL_SWITCH_HOLDER)
    expect(h.kill.disarm).toHaveBeenCalledWith(APP_KILL_SWITCH_HOLDER)
  })

  it('lỗi biên dịch → isError, mã thoát 1, trạng thái failed', async () => {
    const h = harness(project)
    const r = await callAndAnswer(h, RUN_UNITY_TOOL, { method: 'Tools.Fail', reason: 'x' }, approve)
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('error CS0103')
    expect(h.service.list()[0]).toMatchObject({ state: 'failed', exitCode: 1 })
  })

  it('file C# bị sửa THÊM trong lúc thẻ chờ → không chạy', async () => {
    const h = harness(project)
    h.edits.push({ path: 'Assets/Editor/Build.cs', at: 1 })
    h.beforeAnswer.fn = () => (h.edits[0] = { path: 'Assets/Editor/Build.cs', at: 2 })
    const r = await callAndAnswer(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve)
    expect(text(r)).toContain('File C# trong cuộc đã được sửa thêm')
    expect(h.service.list()).toHaveLength(0)
    expect(h.logs).toEqual([expect.objectContaining({ decision: 'blocked' })])

    const h2 = harness(project)
    h2.beforeAnswer.fn = () => h2.edits.push({ path: 'Assets/Editor/New.cs', at: 5 })
    expect(text(await callAndAnswer(h2, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve))).toContain('sửa thêm')
    // File Python sửa thêm không liên quan Unity → vẫn chạy.
    const h3 = harness(project)
    h3.beforeAnswer.fn = () => h3.edits.push({ path: 'tools/x.py', at: 5 })
    expect((await callAndAnswer(h3, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve)).isError).toBeFalsy()
  })

  it('trong lúc thẻ chờ: Editor được mở / tắt quyền sửa / đổi Unity.exe → không chạy', async () => {
    const h = harness(project)
    h.beforeAnswer.fn = () => (h.lock.value = 'locked')
    expect(text(await callAndAnswer(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve))).toContain('Unity Editor đang mở')
    const h2 = harness(project)
    h2.beforeAnswer.fn = () => (h2.write.value = false)
    expect(text(await callAndAnswer(h2, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve))).toContain('đã đổi trong lúc chờ duyệt')
    const h3 = harness(project)
    h3.beforeAnswer.fn = () => (h3.settings.unity.path = unityExe('2022.3.62f3'))
    expect(text(await callAndAnswer(h3, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve))).toContain('đã đổi trong lúc chờ duyệt')
    expect([...h.service.list(), ...h2.service.list(), ...h3.service.list()]).toHaveLength(0)
  })

  it('Từ chối → không chạy, nhật ký rejected', async () => {
    const h = harness(project)
    const r = await callAndAnswer(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, { approve: false, reason: 'Người dùng không cho', decision: 'rejected' })
    expect(text(r)).toBe('Người dùng không cho')
    expect(h.logs).toEqual([expect.objectContaining({ kind: 'unity', decision: 'rejected' })])
    expect(h.service.list()).toHaveLength(0)
  })

  it('Dừng / dừng lượt / Ctrl+Alt+Q → dừng cả cây tiến trình, nhật ký stopped; mỗi cuộc một lần chạy', async () => {
    for (const how of ['stop', 'cancel', 'stopAll'] as const) {
      const h = harness(project)
      const result = callAndAnswer(h, RUN_UNITY_TOOL, { method: 'Tools.Sleep', reason: 'x' }, approve)
      await waitFor(() => h.service.list()[0]?.state === 'running')
      const run = h.service.list()[0]
      await waitFor(() => existsSync(run.logPath + '.child'))
      const child = Number(readFileSync(run.logPath + '.child', 'utf8'))
      // Đang chạy → lần gọi thứ hai trong cùng cuộc bị chặn.
      expect(text(await call(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }))).toContain('Đang có một lần chạy')
      if (how === 'stop') expect(h.service.stop(run.id)).toBe(true)
      else if (how === 'cancel') h.service.cancelConversation('conv1')
      else h.service.stopAll()
      const r = await result
      expect(text(r)).toContain('NGƯỜI DÙNG ĐÃ DỪNG Unity')
      expect(h.service.list()[0].state).toBe('stopped')
      expect(h.logs.at(-1)).toMatchObject({ kind: 'unity', decision: 'stopped', detail: 'stopped' })
      await waitFor(() => !alive(child))
      expect(h.changed).toHaveBeenCalled()
    }
  }, 60_000)

  it('Ẩn lần chạy đã xong; không ẩn được lần đang chạy', async () => {
    const h = harness(project)
    await callAndAnswer(h, RUN_UNITY_TOOL, { method: 'A.B', reason: 'x' }, approve)
    const run = h.service.list()[0]
    expect(h.service.logPathOf(run.id)).toBe(run.logPath)
    expect(h.service.stop(run.id)).toBe(false)
    expect(h.service.dismiss(run.id)).toBe(true)
    expect(h.service.list()).toHaveLength(0)
    expect(h.service.logPathOf(run.id)).toBeNull()
  })
})

describe('AppRunService — Blender', () => {
  let project: string
  beforeEach(() => {
    project = dir('BlendGame')
    writeFileSync(join(project, 'export.py'), 'import bpy\nprint("export")\n')
  })

  it('thẻ có TRỌN script + file .py vừa sửa; Chạy → output, autoexec tắt, tham số sau --', async () => {
    const h = harness(project)
    h.edits.push({ path: 'export.py', at: 1 }, { path: 'Assets/A.cs', at: 1 })
    const r = await callAndAnswer(h, RUN_BLENDER_TOOL, { script: 'export.py', scriptArgs: ['out.fbx'], reason: 'Xuất FBX' }, approve)
    expect(h.cards[0]).toMatchObject({
      program: 'blender',
      display: 'blender --background --python export.py -- out.fbx',
      app: { editedFiles: ['export.py'], script: { path: 'export.py', content: 'import bpy\nprint("export")\n' } }
    })
    expect(text(r)).toContain('mã thoát 0')
    expect(text(r)).toContain('autoexec: off')
    expect(text(r)).toContain('args out.fbx')
    expect(h.logs.at(-1)).toMatchObject({ kind: 'blender', decision: 'approved', exitCode: 0 })
  })

  it('script > 64 KB → chặn trước khi hỏi (không cắt)', async () => {
    const h = harness(project)
    writeFileSync(join(project, 'big.py'), '#'.repeat(BLENDER_SCRIPT_MAX + 10))
    const r = await call(h, RUN_BLENDER_TOOL, { script: 'big.py', reason: 'x' })
    expect(text(r)).toContain('quá 64 KB')
    expect(h.cards).toHaveLength(0)
    expect(h.logs).toEqual([expect.objectContaining({ kind: 'blender', decision: 'blocked' })])
  })

  it('script đổi sau khi thẻ hiện → không chạy; file .py khác sửa thêm → không chạy', async () => {
    const h = harness(project)
    h.beforeAnswer.fn = () => writeFileSync(join(project, 'export.py'), 'import os\nos.remove("x")\n')
    expect(text(await callAndAnswer(h, RUN_BLENDER_TOOL, { script: 'export.py', reason: 'x' }, approve))).toContain('đã đổi sau khi thẻ hiện')
    const h2 = harness(project)
    h2.beforeAnswer.fn = () => h2.edits.push({ path: 'helpers.py', at: 9 })
    expect(text(await callAndAnswer(h2, RUN_BLENDER_TOOL, { script: 'export.py', reason: 'x' }, approve))).toContain('File Python trong cuộc đã được sửa thêm')
    expect([...h.service.list(), ...h2.service.list()]).toHaveLength(0)
  })

  it('traceback → isError, phần cuối output có stderr', async () => {
    const h = harness(project)
    writeFileSync(join(project, 'bad.py'), 'FAIL')
    const r = await callAndAnswer(h, RUN_BLENDER_TOOL, { script: 'bad.py', reason: 'x' }, approve)
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('ValueError: hỏng')
    expect(text(r)).toContain('mã thoát 1')
  })

  it('tắt riêng Blender → chỉ dừng Blender, Unity vẫn chạy', async () => {
    const unity = unityProject()
    writeFileSync(join(unity, 'sleep.py'), 'SLEEP')
    const h = harness(unity)
    const b = callAndAnswer(h, RUN_BLENDER_TOOL, { script: 'sleep.py', reason: 'x' }, approve)
    await waitFor(() => h.service.list()[0]?.state === 'running')
    const blenderChild = (): number => Number(readFileSync(join(unity, 'sleep.py.child'), 'utf8'))
    await waitFor(() => existsSync(join(unity, 'sleep.py.child')))
    h.service.stopAll('unity')
    await new Promise((r) => setTimeout(r, 300))
    expect(h.service.list()[0].state).toBe('running')
    h.service.stopAll('blender')
    expect(text(await b)).toContain('NGƯỜI DÙNG ĐÃ DỪNG Blender')
    await waitFor(() => !alive(blenderChild()))
  }, 30_000)
})
