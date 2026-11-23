import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { appendFile, mkdir, open, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { APP_LOG_RETENTION_MS, APP_LOG_TAIL_MAX, type AppProgram } from '@shared/commands'

export type SpawnFn = (exe: string, argv: string[], options: SpawnOptions) => ChildProcess

export type AppOutcome = {
  code: number | null
  timedOut: boolean
  stopped: boolean
  /** PHẦN CUỐI file log (≤ APP_LOG_TAIL_MAX). */
  tail: string
  /** Kích thước cả file log. */
  logBytes: number
}

export type AppProcess = { stop(): void; done: Promise<AppOutcome> }

/** Tên file log: `2026-11-23_153012-unity-1a2b3c4d.log` trong thư mục log của app. */
export function logPathFor(dir: string, program: AppProgram, id: string, now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return join(dir, `${stamp}-${program}-${id.slice(0, 8)}.log`)
}

/** Xoá file log quá hạn giữ (90 ngày) — chạy lúc mở app. */
export async function pruneLogs(dir: string, now = Date.now()): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.log')) continue
    try {
      const s = await stat(join(dir, name))
      if (now - s.mtimeMs > APP_LOG_RETENTION_MS) {
        await unlink(join(dir, name))
        removed++
      }
    } catch {
      // File đang bị giữ / đã bị xoá — bỏ qua, lần sau dọn.
    }
  }
  return removed
}

/** Đọc PHẦN CUỐI file (lỗi biên dịch / traceback nằm ở cuối log). */
export async function readTail(path: string, max = APP_LOG_TAIL_MAX): Promise<{ text: string; bytes: number }> {
  let fh
  try {
    fh = await open(path, 'r')
  } catch {
    return { text: '', bytes: 0 }
  }
  try {
    const { size } = await fh.stat()
    const length = Math.min(size, max)
    const buf = Buffer.alloc(length)
    await fh.read(buf, 0, length, size - length)
    // Cắt giữa ký tự UTF-8 ở đầu → bỏ phần lỗi.
    return { text: buf.toString('utf8').replace(/^\uFFFD+/, ''), bytes: size }
  } finally {
    await fh.close()
  }
}

/**
 * Dừng CẢ CÂY tiến trình: Unity sinh tiến trình con (biên dịch shader, licensing client…) — chỉ kill tiến trình cha
 * thì các con vẫn chạy. Windows: taskkill /T /F (đường dẫn tuyệt đối).
 */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (platform === 'win32' && child.pid) {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const k = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    k.on('error', () => child.kill())
    return
  }
  child.kill('SIGKILL')
}

/**
 * Chạy Unity / Blender: không qua shell, hạn tối đa, log đầy đủ ra file (Unity tự ghi qua `-logFile`; Blender: app ghi
 * stdout + stderr). Xong → trả phần cuối log.
 */
export function startAppProcess(opts: {
  exe: string
  argv: string[]
  cwd: string
  logPath: string
  /** Unity tự ghi log (`-logFile`) — app chỉ ghi thêm lỗi không khởi động được. */
  ownLog: boolean
  timeoutMs: number
  spawn?: SpawnFn
  kill?: (child: ChildProcess) => void
}): AppProcess {
  let timedOut = false
  let stopped = false
  let child: ChildProcess | null = null
  const kill = (): void => {
    if (child) (opts.kill ?? killTree)(child)
  }
  const done = (async (): Promise<AppOutcome> => {
    await mkdir(join(opts.logPath, '..'), { recursive: true })
    const out = opts.ownLog ? null : createWriteStream(opts.logPath, { flags: 'a' })
    const code = await new Promise<number | null>((resolveCode) => {
      let spawnError: string | null = null
      try {
        child = (opts.spawn ?? spawn)(opts.exe, opts.argv, {
          cwd: opts.cwd,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', opts.ownLog ? 'ignore' : 'pipe', opts.ownLog ? 'ignore' : 'pipe']
        })
      } catch (err) {
        spawnError = String(err)
      }
      if (!child) {
        void appendFile(opts.logPath, `[MMC studio] Không chạy được chương trình: ${spawnError}\n`).finally(() => resolveCode(null))
        return
      }
      if (stopped) kill()
      child.stdout?.pipe(out!, { end: false })
      child.stderr?.pipe(out!, { end: false })
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, opts.timeoutMs)
      let finished = false
      const finish = (c: number | null, note?: string): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (note) void appendFile(opts.logPath, `\n[MMC studio] ${note}\n`).catch(() => {}).finally(() => resolveCode(c))
        else resolveCode(c)
      }
      child.on('error', (e) => finish(null, `Không chạy được chương trình: ${e.message}`))
      child.on('close', (c) => finish(c))
    })
    if (out) await new Promise<void>((r) => out.end(r))
    if (timedOut || stopped)
      await appendFile(opts.logPath, `\n[MMC studio] ${timedOut ? `Hết hạn ${Math.round(opts.timeoutMs / 60_000)} phút — đã dừng.` : 'Người dùng đã dừng.'}\n`).catch(() => {})
    const tail = await readTail(opts.logPath)
    return { code, timedOut, stopped, tail: tail.text, logBytes: tail.bytes }
  })()
  return {
    stop: () => {
      stopped = true
      kill()
    },
    done
  }
}
