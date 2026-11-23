import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Phiên bản Unity dạng `2022.3.62f3` / `6000.6.0f1` (a = alpha, b = beta, f = final, p = patch, c = China, x = experimental). */
const UNITY_VERSION = /^(\d+\.\d+\.\d+[abcfpx]\d+)/

/** `2022.3.62f3_96770f904ca7` (ProductVersion của Unity.exe) → `2022.3.62f3`. */
export function parseUnityVersion(text: string | null | undefined): string | null {
  return UNITY_VERSION.exec(text?.trim() ?? '')?.[1] ?? null
}

/** Unity Hub cài ở `…\Editor\<phiên bản>\Editor\Unity.exe` — dùng khi file không có thông tin phiên bản. */
export function unityVersionFromPath(exe: string): string | null {
  const m = /[\\/](\d+\.\d+\.\d+[abcfpx]\d+)[\\/]Editor[\\/]Unity\.exe$/i.exec(exe)
  return m?.[1] ?? null
}

/** `m_EditorVersion: 2022.3.62f3` trong `ProjectSettings/ProjectVersion.txt`; null = không phải dự án Unity / không đọc được. */
export async function projectUnityVersion(folder: string): Promise<string | null> {
  try {
    const text = await readFile(join(folder, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return parseUnityVersion(/^m_EditorVersion:\s*(\S+)/m.exec(text)?.[1])
  } catch {
    return null
  }
}

/** Đọc ProductVersion của một file .exe (thông tin phiên bản của Windows) — không chạy chương trình đó. */
export type ProductVersionReader = (exe: string) => Promise<string | null>

/** PowerShell của hệ thống (đường dẫn tuyệt đối, không profile); đường dẫn exe đi qua biến môi trường, không ghép vào lệnh. */
export const readProductVersion: ProductVersionReader = (exe) =>
  new Promise((done) => {
    if (process.platform !== 'win32') return done(null)
    const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    execFile(
      ps,
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:MMC_EXE_PATH).VersionInfo.ProductVersion'],
      { env: { ...process.env, MMC_EXE_PATH: exe }, timeout: 15_000, windowsHide: true },
      (err, stdout) => done(err ? null : stdout.trim() || null)
    )
  })

/**
 * Phiên bản của chương trình đã chọn, đệm theo đường dẫn + thời điểm sửa file (cài bản khác vào cùng chỗ → đọc lại).
 * Unity: ProductVersion, không có thì lấy theo thư mục của Unity Hub. Blender: chỉ để hiện trong Cài đặt.
 */
export class ExeVersions {
  private cache = new Map<string, { key: string; version: string | null }>()

  constructor(private readonly read: ProductVersionReader = readProductVersion) {}

  async unity(exe: string): Promise<string | null> {
    return this.cached(exe, async () => parseUnityVersion(await this.read(exe)) ?? unityVersionFromPath(exe))
  }

  async blender(exe: string): Promise<string | null> {
    return this.cached(exe, async () => /^\d+\.\d+(\.\d+)?/.exec((await this.read(exe)) ?? '')?.[0] ?? null)
  }

  private async cached(exe: string, compute: () => Promise<string | null>): Promise<string | null> {
    let key: string
    try {
      const s = await stat(exe)
      key = `${s.size}:${s.mtimeMs}`
    } catch {
      return null
    }
    const hit = this.cache.get(exe)
    if (hit?.key === key) return hit.version
    const version = await compute()
    this.cache.set(exe, { key, version })
    return version
  }
}
