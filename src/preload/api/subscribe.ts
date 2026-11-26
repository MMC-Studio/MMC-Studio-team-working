import { ipcRenderer, type IpcRendererEvent } from 'electron'

/** Đăng ký nghe sự kiện main → renderer; trả về hàm hủy. */
export function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_e: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}
