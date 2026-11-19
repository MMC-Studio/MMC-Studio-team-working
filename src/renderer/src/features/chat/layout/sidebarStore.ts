import { create } from 'zustand'

/**
 * Cách xem thanh bên chat — chỉ là tuỳ chọn hiển thị trên máy này nên lưu localStorage (không vào DB):
 * ẩn / hiện cả thanh (Ctrl+B), thu gọn mục "Đã ghim" / "Gần đây". Nhóm cuộc trò chuyện vẫn lưu thu gọn trong DB như cũ.
 */
export type SidebarSectionKey = 'pinned' | 'recent'

const HIDDEN_KEY = 'mmc.sidebar.hidden'
const sectionKey = (k: SidebarSectionKey): string => `mmc.sidebar.section.${k}`

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function write(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // Không lưu được (chế độ riêng tư…) → chỉ đổi trong phiên này.
  }
}

type SidebarState = {
  hidden: boolean
  /** Ô tìm trên đầu danh sách (mục "Tìm kiếm"; PR sau thay bằng cửa sổ nổi Ctrl+K). */
  searchOpen: boolean
  collapsed: Record<SidebarSectionKey, boolean>
  toggleHidden(): void
  setSearchOpen(open: boolean): void
  toggleSection(key: SidebarSectionKey): void
}

export const useSidebar = create<SidebarState>((set, get) => ({
  hidden: read(HIDDEN_KEY),
  searchOpen: false,
  collapsed: { pinned: read(sectionKey('pinned')), recent: read(sectionKey('recent')) },
  toggleHidden() {
    const hidden = !get().hidden
    write(HIDDEN_KEY, hidden)
    set({ hidden })
  },
  setSearchOpen(searchOpen) {
    // Mở ô tìm khi thanh bên đang ẩn → hiện thanh bên.
    if (searchOpen && get().hidden) get().toggleHidden()
    set({ searchOpen })
  },
  toggleSection(key) {
    const value = !get().collapsed[key]
    write(sectionKey(key), value)
    set((s) => ({ collapsed: { ...s.collapsed, [key]: value } }))
  }
}))

/** Ctrl+B (⌘B) ẩn / hiện thanh bên ở mọi trang có thanh bên chat. Không trùng phím nào khác của app. */
export function setupSidebarShortcut(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyB' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return
    e.preventDefault()
    useSidebar.getState().toggleHidden()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
