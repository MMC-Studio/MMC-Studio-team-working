import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/** Cây rỗng của git — `--attr-source` trỏ vào đây → bỏ qua `.gitattributes` của repo (không filter / diff driver). */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Tìm git theo PATH, CHỈ ở thư mục tuyệt đối (mục tương đối như "." sẽ trỏ vào thư mục dự án — repo lạ đặt sẵn
 * git.exe là chạy được). Trả đường dẫn tuyệt đối để luôn chạy đúng file đó, không để hệ điều hành tự tìm.
 */
export function findGit(pathEnv: string | undefined, platform: NodeJS.Platform = process.platform): string | null {
  const name = platform === 'win32' ? 'git.exe' : 'git'
  for (const dir of (pathEnv ?? '').split(platform === 'win32' ? ';' : delimiter)) {
    const d = dir.trim().replace(/^"(.*)"$/, '$1')
    if (!d || !isAbsolute(d)) continue
    const file = join(d, name)
    try {
      if (statSync(file).isFile()) return file
    } catch {
      // không có ở đây
    }
  }
  return null
}

/**
 * Môi trường cho git: bỏ mọi biến GIT_* thừa hưởng (GIT_DIR, GIT_CONFIG_PARAMETERS… đổi repo / cấu hình), không hỏi
 * mật khẩu, không pager, và GIT_OPTIONAL_LOCKS=0 để `git status` không ghi lại index (lệnh chỉ đọc thật sự).
 */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (!/^GIT_/i.test(k) && k.toUpperCase() !== 'PAGER') env[k] = v
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat' }
}

export type ExecResult = { code: number | null; stdout: string; stderr: string }

export function execGit(exe: string, args: string[], cwd: string | undefined, timeoutMs = 10_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { cwd, env: gitEnv(), timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: false },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

export type GitInfo = { path: string; version: string } | { error: 'not_found' | 'too_old'; version?: string }

/**
 * git dùng được không: có trên máy + hiểu `--attr-source` (lớp chặn filter / diff driver của repo lạ). Thử thẳng cờ
 * đó thay vì so số phiên bản.
 */
export async function probeGit(exe: string | null): Promise<GitInfo> {
  if (!exe) return { error: 'not_found' }
  const v = await execGit(exe, ['--version'], undefined)
  if (v.code !== 0) return { error: 'not_found' }
  const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? v.stdout.trim()
  const attr = await execGit(exe, [`--attr-source=${EMPTY_TREE}`, 'version'], undefined)
  if (attr.code !== 0) return { error: 'too_old', version }
  return { path: exe, version }
}

const DRIVER_KEY = /^(filter\.(.+)\.(clean|smudge|process)|diff\.(.+)\.(textconv|command))$/i

/**
 * `-c <khoá>=` cho mọi lệnh filter / diff driver có trong cấu hình mà repo này thấy (kể cả file `include`) — chặn cả
 * driver khai báo qua `.git/info/attributes` (`--attr-source` không che file đó). Đọc cấu hình không chạy gì.
 * Tên driver có "=" / xuống dòng (không ghi đè an toàn được bằng `-c`) → ném lỗi, không chạy.
 */
export async function driverOverrides(exe: string, cwd: string): Promise<string[]> {
  const r = await execGit(exe, ['config', '--list', '--includes', '--name-only', '-z'], cwd)
  // Không phải repo / không có cấu hình → vẫn ghi đè các khoá cố định.
  const keys = r.code === 0 ? r.stdout.split('\0').filter(Boolean) : []
  const out = new Set<string>()
  for (const key of keys) {
    if (!DRIVER_KEY.test(key)) continue
    if (/[=\n\r]/.test(key)) throw new Error('unsafe_config')
    out.add(key)
    const filter = /^filter\.(.+)\.(clean|smudge|process)$/i.exec(key)
    if (filter) out.add(`filter.${filter[1]}.required`)
  }
  return [...out].flatMap((k) => ['-c', /\.required$/i.test(k) ? `${k}=false` : `${k}=`])
}

/** Cờ toàn cục luôn có, trước lệnh con. */
export function safetyArgs(platform: NodeJS.Platform = process.platform): string[] {
  return [
    '--no-pager',
    `--attr-source=${EMPTY_TREE}`,
    '-c', 'core.fsmonitor=false',
    '-c', `core.attributesFile=${platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '-c', 'diff.external=',
    '-c', 'log.showSignature=false',
    '-c', 'color.ui=false',
    '-c', 'core.quotePath=false',
    '-c', 'status.submoduleSummary=false',
    '-c', 'diff.submodule=short'
  ]
}
