import { create } from 'zustand'

/**
 * Bố cục trang Chat (thanh bên + khung chat + panel artifact) — chỉ là cách xem trên máy này nên lưu localStorage:
 * ẩn / hiện thanh bên (Ctrl+B), độ rộng thanh bên / panel, thu gọn "Đã ghim" / "Gần đây".
 * Khung chat luôn rộng tối thiểu CHAT_MIN: thiếu chỗ thì thanh bên tự ẩn (không đổi lựa chọn của người dùng),
 * lúc đó Ctrl+B / đưa chuột sát mép trái mở thanh bên dạng nổi đè lên nội dung.
 */
export const SIDEBAR_WIDTH = { default: 256, min: 200, max: 420 }
/** Kéo nhỏ hơn mức tối thiểu một đoạn này (px) → ẩn hẳn thanh bên. */
export const SIDEBAR_HIDE_GAP = 60
export const PANEL_WIDTH = { default: 520, min: 320 }
export const CHAT_MIN = 360

export type SidebarSectionKey = 'pinned' | 'recent'
/** Thanh bên nổi: `hover` = đưa chuột sát mép trái (rời chuột thì ẩn), `pinned` = mở bằng Ctrl+B / nút. */
export type SidebarOverlay = 'none' | 'hover' | 'pinned'

export type LayoutInput = {
  /** Bề rộng vùng bố cục chat (đã trừ thanh biểu tượng). */
  containerWidth: number
  hidden: boolean
  sidebarWidth: number
  panelOpen: boolean
  panelWidth: number
}
export type ChatLayoutMetrics = {
  sidebar: 'inline' | 'hidden'
  /** Thanh bên người dùng để hiện nhưng không đủ chỗ (khung chat < CHAT_MIN) → tạm ẩn. */
  autoHidden: boolean
  sidebarWidth: number
  /** Độ rộng tối đa kéo được lúc này (khung chat vẫn ≥ CHAT_MIN). */
  sidebarMax: number
  panelWidth: number
  panelMax: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Tính bố cục: panel nhường chỗ cho khung chat trước, thanh bên chỉ hiện cố định khi còn đủ chỗ. */
export function computeLayout(i: LayoutInput): ChatLayoutMetrics {
  const panelMax = Math.max(PANEL_WIDTH.min, i.containerWidth - CHAT_MIN)
  const panelWidth = i.panelOpen ? clamp(i.panelWidth, PANEL_WIDTH.min, panelMax) : 0
  const room = i.containerWidth - panelWidth - CHAT_MIN
  const sidebarMax = Math.min(SIDEBAR_WIDTH.max, room)
  if (i.hidden) return { sidebar: 'hidden', autoHidden: false, sidebarWidth: 0, sidebarMax, panelWidth, panelMax }
  if (sidebarMax < SIDEBAR_WIDTH.min) return { sidebar: 'hidden', autoHidden: true, sidebarWidth: 0, sidebarMax, panelWidth, panelMax }
  return {
    sidebar: 'inline',
    autoHidden: false,
    sidebarWidth: clamp(i.sidebarWidth, SIDEBAR_WIDTH.min, sidebarMax),
    sidebarMax,
    panelWidth,
    panelMax
  }
}

const KEYS = {
  hidden: 'mmc.sidebar.hidden',
  width: 'mmc.sidebar.width',
  panelWidth: 'mmc.artifactPanel.width',
  section: (k: SidebarSectionKey) => `mmc.sidebar.section.${k}`
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Không lưu được (chế độ riêng tư…) → chỉ đổi trong phiên này.
  }
}
const readNumber = (key: string, fallback: number): number => {
  const n = Number(read(key))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

type SidebarState = {
  hidden: boolean
  width: number
  panelWidth: number
  overlay: SidebarOverlay
  collapsed: Record<SidebarSectionKey, boolean>
  /** Đo từ ChatLayout (để Ctrl+B biết đang thiếu chỗ hay không). */
  containerWidth: number
  panelOpen: boolean
  setHidden(hidden: boolean): void
  /** Ctrl+B / nút ẩn-hiện: thanh bên đang cố định → ẩn; đang ẩn mà đủ chỗ → hiện cố định; thiếu chỗ → mở / đóng dạng nổi. */
  toggle(): void
  setOverlay(overlay: SidebarOverlay): void
  setWidth(width: number): void
  resetWidth(): void
  setPanelWidth(width: number): void
  resetPanelWidth(): void
  setMetrics(m: { containerWidth?: number; panelOpen?: boolean }): void
  toggleSection(key: SidebarSectionKey): void
}

export const useSidebar = create<SidebarState>((set, get) => ({
  hidden: read(KEYS.hidden) === '1',
  width: clamp(readNumber(KEYS.width, SIDEBAR_WIDTH.default), SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
  panelWidth: Math.max(PANEL_WIDTH.min, readNumber(KEYS.panelWidth, PANEL_WIDTH.default)),
  overlay: 'none',
  collapsed: { pinned: read(KEYS.section('pinned')) === '1', recent: read(KEYS.section('recent')) === '1' },
  containerWidth: typeof window === 'undefined' ? 1280 : window.innerWidth,
  panelOpen: false,

  setHidden(hidden) {
    write(KEYS.hidden, hidden ? '1' : null)
    set({ hidden, overlay: 'none' })
  },
  toggle() {
    const s = get()
    if (s.overlay !== 'none') return set({ overlay: 'none' })
    const layout = layoutOf(s)
    if (layout.sidebar === 'inline') return s.setHidden(true)
    // Đang ẩn: còn chỗ thì hiện cố định; thiếu chỗ thì mở dạng nổi (không ép khung chat).
    const shown = layoutOf({ ...s, hidden: false })
    if (shown.sidebar === 'inline') return s.setHidden(false)
    set({ overlay: 'pinned' })
  },
  setOverlay(overlay) {
    set({ overlay })
  },
  setWidth(width) {
    const w = Math.round(clamp(width, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max))
    write(KEYS.width, String(w))
    set({ width: w })
  },
  resetWidth() {
    write(KEYS.width, null)
    set({ width: SIDEBAR_WIDTH.default })
  },
  setPanelWidth(width) {
    const w = Math.round(Math.max(PANEL_WIDTH.min, width))
    write(KEYS.panelWidth, String(w))
    set({ panelWidth: w })
  },
  resetPanelWidth() {
    write(KEYS.panelWidth, null)
    set({ panelWidth: PANEL_WIDTH.default })
  },
  setMetrics(m) {
    set(m)
  },
  toggleSection(key) {
    const value = !get().collapsed[key]
    write(KEYS.section(key), value ? '1' : null)
    set((s) => ({ collapsed: { ...s.collapsed, [key]: value } }))
  }
}))

function layoutOf(s: Pick<SidebarState, 'containerWidth' | 'hidden' | 'width' | 'panelOpen' | 'panelWidth'>): ChatLayoutMetrics {
  return computeLayout({
    containerWidth: s.containerWidth,
    hidden: s.hidden,
    sidebarWidth: s.width,
    panelOpen: s.panelOpen,
    panelWidth: s.panelWidth
  })
}

/** Bố cục hiện tại (thanh bên cố định / ẩn, độ rộng thanh bên + panel đã giới hạn). */
export function useChatLayout(): ChatLayoutMetrics {
  const containerWidth = useSidebar((s) => s.containerWidth)
  const hidden = useSidebar((s) => s.hidden)
  const width = useSidebar((s) => s.width)
  const panelOpen = useSidebar((s) => s.panelOpen)
  const panelWidth = useSidebar((s) => s.panelWidth)
  return layoutOf({ containerWidth, hidden, width, panelOpen, panelWidth })
}

/** Ctrl+B (⌘B) ẩn / hiện thanh bên ở mọi trang có thanh bên chat; Esc đóng thanh bên nổi. Không trùng phím nào khác của app. */
export function setupSidebarShortcut(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && useSidebar.getState().overlay !== 'none') {
      useSidebar.getState().setOverlay('none')
      return
    }
    if (e.code !== 'KeyB' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return
    e.preventDefault()
    useSidebar.getState().toggle()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
