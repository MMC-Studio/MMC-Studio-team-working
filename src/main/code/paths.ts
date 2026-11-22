import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** `rel` (kết quả của `path.relative`) có trỏ ra ngoài thư mục gốc không — `..foo` là tên file hợp lệ, `..\x` thì không. */
function escapes(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../') || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)
}

/**
 * Đường dẫn có nằm TRONG thư mục dự án không, CHỈ theo chữ (chặn ../ và ổ đĩa khác) → đường dẫn tương đối
 * dạng `a/b`, hoặc null (kể cả khi trỏ đúng thư mục gốc). Không giải symlink — dùng `realRelative` trước khi
 * đọc / ghi / chạy gì đó thật.
 */
export function insideProject(root: string, target: string): string | null {
  const abs = isAbsolute(target) ? resolve(target) : resolve(root, target)
  const rel = relative(resolve(root), abs)
  if (!rel || escapes(rel)) return null
  return rel.replace(/\\/g, '/')
}

/**
 * Vị trí THẬT của `abs` (giải symlink / junction) so với vị trí thật của `root` → đường dẫn tương đối dạng `a/b`
 * ('' = chính thư mục gốc), hoặc null nếu nằm ngoài / không xác định được. Phần chưa tồn tại (file sắp tạo) thì
 * giải thư mục cha gần nhất có thật rồi nối phần còn lại — không có symlink nào trong phần chưa tồn tại.
 */
export async function realRelative(root: string, abs: string): Promise<string | null> {
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return null
  }
  const rest: string[] = []
  let probe = resolve(abs)
  for (;;) {
    try {
      const real = join(await realpath(probe), ...rest)
      const rel = relative(realRoot, real)
      return escapes(rel) ? null : rel.replace(/\\/g, '/')
    } catch (err) {
      // Chỉ "chưa tồn tại" mới đi lên thư mục cha; lỗi khác (quyền, vòng symlink…) → không xác định được.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null
      const parent = dirname(probe)
      if (parent === probe) return null
      rest.unshift(basename(probe))
      probe = parent
    }
  }
}

/** Đường dẫn thật vẫn nằm trong thư mục (kể cả chính thư mục gốc). */
export async function realInside(root: string, abs: string): Promise<boolean> {
  return (await realRelative(root, abs)) !== null
}
