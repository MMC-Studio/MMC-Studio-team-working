import { create } from 'zustand'
import type { ChatMode } from '@shared/ai'

/**
 * Ctrl+V có nên lấy file/ảnh thay vì dán chữ không. Có chữ → dán chữ như cũ (vd copy từ Word kèm ảnh
 * minh hoạ vẫn là dán chữ). Không có chữ mà có file hoặc ảnh → đính kèm.
 */
export function pasteKind(data: Pick<DataTransfer, 'types' | 'files' | 'getData'>): 'text' | 'files' | 'clipboard' {
  if (data.getData('text/plain')) return 'text'
  if (data.files.length > 0) return 'files'
  if (data.types.some((t) => t === 'Files' || t.startsWith('image/') || t === 'text/uri-list')) return 'clipboard'
  return 'text'
}

/** Kéo vào khung chat có mang file không (chỉ khi đó mới hiện vùng thả). */
export const dragHasFiles = (types: readonly string[]): boolean => types.includes('Files')

/**
 * Cuộc trò chuyện mới mở từ nơi khác (cửa sổ tìm kiếm): chữ điền sẵn vào ô nhập (Tab = "Soạn", chưa gửi) và / hoặc
 * chế độ (Hành động "Cuộc trò chuyện Code mới"). Composer / ChatPage lấy ra một lần (lúc gắn hoặc khi có mới) rồi xoá.
 */
type ComposeRequest = { text: string | null; mode: ChatMode | null }
export const useComposeText = create<
  ComposeRequest & { put(req: Partial<ComposeRequest>): void; takeText(): string | null; takeMode(): ChatMode | null }
>((set, get) => ({
  text: null,
  mode: null,
  put(req) {
    set({ text: req.text ?? null, mode: req.mode ?? null })
  },
  takeText() {
    const text = get().text
    if (text !== null) set({ text: null })
    return text
  },
  takeMode() {
    const mode = get().mode
    if (mode !== null) set({ mode: null })
    return mode
  }
}))
