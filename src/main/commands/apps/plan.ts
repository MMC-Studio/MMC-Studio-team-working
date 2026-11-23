import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import { BLENDER_SCRIPT_ARGS_MAX, BLENDER_SCRIPT_MAX } from '@shared/commands'
import { realRelative } from '../../code/paths'

/** Lỗi khiến app chặn ngay, không hiện thẻ (trợ lý nhận lý do). */
export class AppPolicyError extends Error {}

/** `Lớp.Hàm` hoặc `Namespace.Lớp.Hàm` — chỉ chữ / số / gạch dưới, không khoảng trắng, không cờ. */
const METHOD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/

export function checkUnityMethod(method: string): string {
  const m = method.trim()
  if (m.length > 200 || !METHOD.test(m))
    throw new AppPolicyError(`Tên hàm không hợp lệ: "${method}". Cần dạng Lớp.Hàm (vd BuildTools.BuildWindows) — hàm static trong script Editor.`)
  return m
}

/** Unity: app tự dựng lệnh; trợ lý chỉ chọn hàm. */
export function unityArgv(folder: string, method: string, logPath: string): { argv: string[]; display: string } {
  return {
    argv: ['-batchmode', '-quit', '-projectPath', folder, '-executeMethod', method, '-logFile', logPath],
    display: `Unity -batchmode -quit -executeMethod ${method}`
  }
}

/** File trong thư mục (theo đường dẫn THẬT, qua symlink / junction) và đúng đuôi; trả đường dẫn tương đối. */
async function fileInside(folder: string, rel: string, ext: string, label: string): Promise<{ rel: string; abs: string }> {
  const raw = rel.trim()
  if (!raw || isAbsolute(raw) || raw.startsWith('-')) throw new AppPolicyError(`${label}: cần đường dẫn TƯƠNG ĐỐI trong thư mục dự án ("${rel}").`)
  if (extname(raw).toLowerCase() !== ext) throw new AppPolicyError(`${label}: chỉ nhận file ${ext} ("${rel}").`)
  const abs = resolve(folder, raw)
  const real = await realRelative(folder, abs)
  if (!real) throw new AppPolicyError(`${label} nằm ngoài thư mục dự án (kể cả qua symlink / junction): "${rel}".`)
  try {
    if (!(await stat(abs)).isFile()) throw new Error()
  } catch {
    throw new AppPolicyError(`${label} không tồn tại: "${real}".`)
  }
  return { rel: real, abs }
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

export type BlenderPlan = {
  argv: string[]
  display: string
  script: { rel: string; abs: string; content: string; sha256: string }
  blend: string | null
}

/**
 * Blender: `--background [file.blend] --disable-autoexec --python-exit-code 1 --python <script> -- <args>`.
 * `--disable-autoexec`: script nhúng trong file .blend không tự chạy → chỉ script hiện trên thẻ được chạy (dù script
 * đó vẫn import được file .py khác trong thư mục — thẻ ghi rõ). Script > BLENDER_SCRIPT_MAX → từ chối (thẻ phải hiện
 * TRỌN script, không cắt).
 */
export async function planBlender(folder: string, scriptRel: string, blendRel: string | null, args: string[]): Promise<BlenderPlan> {
  const script = await fileInside(folder, scriptRel, '.py', 'Script')
  const size = (await stat(script.abs)).size
  if (size > BLENDER_SCRIPT_MAX)
    throw new AppPolicyError(
      `Script ${script.rel} dài ${Math.round(size / 1024)} KB — quá ${BLENDER_SCRIPT_MAX / 1024} KB nên người dùng không xem hết được trên thẻ. Tách thành script ngắn hơn.`
    )
  const content = await readFile(script.abs, 'utf8')
  const blend = blendRel?.trim() ? await fileInside(folder, blendRel, '.blend', 'File .blend') : null
  if (args.length > BLENDER_SCRIPT_ARGS_MAX) throw new AppPolicyError(`Tối đa ${BLENDER_SCRIPT_ARGS_MAX} tham số cho script.`)
  const argv = [
    '--background',
    ...(blend ? [blend.abs] : []),
    '--disable-autoexec',
    '--python-exit-code',
    '1',
    '--python',
    script.abs,
    ...(args.length ? ['--', ...args] : [])
  ]
  const show = (a: string): string => (/[\s"]/.test(a) || a === '' ? JSON.stringify(a) : a)
  const display = ['blender --background', ...(blend ? [show(blend.rel)] : []), '--python', show(script.rel), ...(args.length ? ['--', ...args.map(show)] : [])].join(' ')
  return { argv, display, script: { ...script, content, sha256: sha256(content) }, blend: blend?.rel ?? null }
}

/** Đọc lại script ngay trước khi chạy: khác bản trên thẻ → không chạy. */
export async function scriptUnchanged(abs: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(abs, 'utf8')) === expected
  } catch {
    return false
  }
}

/** Danh sách file đã sửa trong cuộc, so không phụ thuộc thứ tự. */
export function sameFiles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}
