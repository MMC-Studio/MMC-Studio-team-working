import { create } from 'zustand'
import type { PaletteTab } from './paletteResults'

type PaletteState = {
  open: boolean
  tab: PaletteTab
  show(tab?: PaletteTab): void
  close(): void
  toggle(): void
  setTab(tab: PaletteTab): void
}

/** Cửa sổ tìm kiếm nổi (Ctrl+K / mục "Tìm kiếm" trên thanh bên). Mở lại luôn về tab Tất cả, ô nhập trống. */
export const usePalette = create<PaletteState>((set, get) => ({
  open: false,
  tab: 'all',
  show(tab = 'all') {
    set({ open: true, tab })
  },
  close() {
    set({ open: false })
  },
  toggle() {
    if (get().open) get().close()
    else get().show()
  },
  setTab(tab) {
    set({ tab })
  }
}))

/**
 * Ctrl+K (⌘K) mở / đóng cửa sổ tìm kiếm ở mọi trang. Không trùng phím nào khác của app
 * (Ctrl+B thanh bên, Ctrl+Enter thẻ duyệt, Ctrl+Alt+Q dừng điều khiển máy tính là phím toàn cục ở main).
 */
export function setupPaletteShortcut(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyK' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return
    e.preventDefault()
    usePalette.getState().toggle()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
