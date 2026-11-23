import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { insideProject, realRelative } from './paths'
import { detectProject, protectedReason, type ProjectInfo } from './projectProfile'

export { insideProject }

export type FileChange = {
  /** Đường dẫn tương đối trong thư mục dự án. */
  path: string
  isNewFile: boolean
  patch: string
  added: number
  removed: number
}

export type ChangeError =
  | 'outside_project'
  | 'link_outside'
  | 'unsupported_tool'
  | 'old_string_not_found'
  | 'invalid_input'
  /** Nội dung file là nhị phân (có byte 0 / không phải UTF-8) dù đuôi không nằm trong danh sách nhị phân. */
  | 'binary_content'

export type ChangeResult = FileChange | { error: ChangeError } | { error: 'protected_path'; reason: string }

/** File lớn hơn mức này: không đọc nội dung để làm diff (thẻ hiện như file trống) và không bao giờ tự duyệt (PR C). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Thông tin đầy đủ của một lần sửa — dùng cho tự duyệt (PR C): bản trước / sau thật, không chỉ diff. */
export type InspectedChange = FileChange & {
  /** Đường dẫn tuyệt đối (theo chữ, trong thư mục). */
  abs: string
  /** Đường dẫn tương đối THẬT (giải symlink / junction). */
  realPath: string
  profile: ProjectInfo
  /** Nội dung hiện tại; null = file chưa tồn tại. Rỗng khi file quá lớn (`tooLarge`). */
  before: Buffer | null
  /** Nội dung sau khi sửa (UTF-8). */
  after: string
  tooLarge: boolean
  /** Số hard link của file hiện có (1 với file thường; >1 = sửa file này là sửa cả chỗ khác). 0 = file mới. */
  links: number
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** Có byte 0 hoặc không giải được UTF-8 → coi là nhị phân (sửa bằng văn bản sẽ hỏng file). */
export function isBinary(buf: Buffer): boolean {
  if (buf.includes(0)) return true
  try {
    utf8.decode(buf)
    return false
  } catch {
    return true
  }
}

function count(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

/** Nội dung sau khi áp Edit / Write lên `before` (như CLI làm); lỗi → mã lỗi. */
export function applyTool(toolName: string, input: unknown, before: string): string | { error: ChangeError } {
  const data = (input ?? {}) as Record<string, unknown>
  if (toolName === 'Write') {
    if (typeof data.content !== 'string') return { error: 'invalid_input' }
    return data.content
  }
  if (toolName === 'Edit') {
    const { old_string: oldStr, new_string: newStr, replace_all: all } = data
    if (typeof oldStr !== 'string' || typeof newStr !== 'string') return { error: 'invalid_input' }
    if (!before.includes(oldStr)) return { error: 'old_string_not_found' }
    return all === true ? before.split(oldStr).join(newStr) : before.replace(oldStr, () => newStr)
  }
  return { error: 'unsupported_tool' }
}

/**
 * Tool Claude muốn chạy → mọi thông tin cần để duyệt (diff, bản trước / sau, hard link). Chỉ hỗ trợ Edit / Write;
 * file ngoài thư mục dự án, qua junction ra ngoài, thư mục bảo vệ, nhị phân bị từ chối.
 */
export async function inspectChange(
  root: string,
  toolName: string,
  input: unknown
): Promise<InspectedChange | { error: ChangeError } | { error: 'protected_path'; reason: string }> {
  const data = (input ?? {}) as Record<string, unknown>
  if (typeof data.file_path !== 'string') return { error: 'invalid_input' }
  const rel = insideProject(root, data.file_path)
  if (!rel) return { error: 'outside_project' }
  const profile = detectProject(root)
  const reason = protectedReason(profile, rel)
  if (reason) return { error: 'protected_path', reason }
  const abs = resolve(root, rel)
  // Symlink / junction trong dự án có thể trỏ ra ngoài (hoặc vào thư mục bảo vệ) dù đường dẫn chữ nằm trong.
  const realRel = await realRelative(root, abs)
  if (!realRel) return { error: 'link_outside' }
  const realReason = realRel !== rel ? protectedReason(profile, realRel) : null
  if (realReason) return { error: 'protected_path', reason: realReason }

  let before: Buffer | null = null
  let tooLarge = false
  let links = 0
  try {
    const info = await stat(abs)
    if (!info.isFile()) return { error: 'invalid_input' }
    links = info.nlink
    tooLarge = info.size > MAX_FILE_BYTES
    before = tooLarge ? Buffer.alloc(0) : await readFile(abs)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return { error: 'invalid_input' }
  }
  if (before && isBinary(before)) return { error: 'binary_content' }
  const beforeText = before?.toString('utf8') ?? ''

  const after = applyTool(toolName, input, beforeText)
  if (typeof after !== 'string') return after

  const patch = createTwoFilesPatch(`a/${rel}`, `b/${rel}`, beforeText, after, '', '', { context: 3 })
  return {
    path: rel,
    isNewFile: before === null,
    patch,
    ...count(patch),
    abs,
    realPath: realRel,
    profile,
    before,
    after,
    tooLarge,
    links
  }
}

/** Tool Claude muốn chạy → diff để người dùng duyệt (thẻ). */
export async function describeChange(root: string, toolName: string, input: unknown): Promise<ChangeResult> {
  const r = await inspectChange(root, toolName, input)
  if ('error' in r) return r
  return { path: r.path, isNewFile: r.isNewFile, patch: r.patch, added: r.added, removed: r.removed }
}
