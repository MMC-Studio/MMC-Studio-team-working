import { open } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Unity Editor đang mở dự án (giữ khoá `Temp/UnityLockfile`)? Kiểm KHOÁ, không chỉ kiểm tồn tại: Unity crash để lại
 * file thừa không được chặn mãi. Unity mở file này độc quyền khi đang chạy → mở lại để ghi báo EBUSY (Windows).
 *
 * Không mở được vì lý do khác (EPERM / EACCES — không có quyền) → coi là đang khoá: không chắc thì không chạy, và
 * thông báo nói rõ để người dùng tự kiểm.
 */
export async function unityLockState(folder: string): Promise<'free' | 'locked' | 'unknown'> {
  const path = join(folder, 'Temp', 'UnityLockfile')
  try {
    const fh = await open(path, 'r+')
    await fh.close()
    return 'free'
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'free'
    if (code === 'EBUSY') return 'locked'
    return 'unknown'
  }
}
