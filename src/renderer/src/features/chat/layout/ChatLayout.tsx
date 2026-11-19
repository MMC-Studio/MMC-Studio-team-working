import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { ConversationSidebar } from '../components/ConversationSidebar'
import { SIDEBAR_HIDE_GAP, SIDEBAR_WIDTH, useChatLayout, useSidebar } from './sidebarStore'

/**
 * Bố cục chung của trang Chat và các trang mở từ thanh bên (Artifacts, Dự án, Lịch hẹn, Plugin):
 * thanh bên chat (kéo đổi độ rộng, ẩn bằng Ctrl+B) + nội dung + panel bên phải (trang Chat: panel artifact).
 * Khung chat luôn ≥ CHAT_MIN: thiếu chỗ thì thanh bên tự ẩn; Ctrl+B / đưa chuột sát mép trái → thanh bên nổi đè lên.
 */
export function ChatLayout({ children, panel, panelOpen = false }: { children: ReactNode; panel?: ReactNode; panelOpen?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const layout = useChatLayout()
  const overlay = useSidebar((s) => s.overlay)
  const setOverlay = useSidebar((s) => s.setOverlay)
  const width = useSidebar((s) => s.width)

  // Đo bề rộng vùng bố cục (đổi cỡ cửa sổ) + báo panel đang mở để tính chỗ cho khung chat.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const measure = (): void => useSidebar.getState().setMetrics({ containerWidth: el.clientWidth })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const hasPanel = !!panel && panelOpen
  useEffect(() => {
    useSidebar.getState().setMetrics({ panelOpen: hasPanel })
    return () => useSidebar.getState().setMetrics({ panelOpen: false })
  }, [hasPanel])
  // Thanh bên trở lại cố định (đủ chỗ / người dùng mở) → bỏ dạng nổi.
  useEffect(() => {
    if (layout.sidebar === 'inline' && overlay !== 'none') setOverlay('none')
  }, [layout.sidebar, overlay, setOverlay])

  const overlayWidth = Math.min(width, Math.max(SIDEBAR_WIDTH.min, layout.panelMax))

  return (
    <div ref={root} className="relative flex h-full min-h-0" data-testid="chat-layout" data-auto-hidden={layout.autoHidden ? 'true' : undefined}>
      {layout.sidebar === 'inline' ? (
        <div className="relative h-full shrink-0" style={{ width: layout.sidebarWidth }} data-testid="sidebar-wrap">
          <ConversationSidebar />
          <SidebarResize />
        </div>
      ) : (
        <>
          {/* Đưa chuột sát mép trái → thanh bên nổi (rời chuột thì ẩn lại). */}
          {overlay === 'none' && (
            <div
              className="absolute inset-y-0 left-0 z-30 w-2"
              onMouseEnter={() => setOverlay('hover')}
              data-testid="sidebar-hot-edge"
            />
          )}
          {overlay === 'pinned' && (
            <div className="absolute inset-0 z-30" onClick={() => setOverlay('none')} data-testid="sidebar-overlay-backdrop" />
          )}
          {overlay !== 'none' && (
            <div
              className="absolute inset-y-0 left-0 z-40 shadow-xl"
              style={{ width: overlayWidth }}
              onMouseLeave={() => overlay === 'hover' && setOverlay('none')}
              data-testid="sidebar-overlay"
              data-mode={overlay}
            >
              <ConversationSidebar variant="overlay" />
            </div>
          )}
        </>
      )}
      {children}
      {panel}
    </div>
  )
}

/** Tay kéo ở mép phải thanh bên: kéo đổi độ rộng, kéo nhỏ quá thì ẩn hẳn, nhấp đúp về mặc định. */
function SidebarResize() {
  const { t } = useTranslation('chat')
  const layout = useChatLayout()
  const { setWidth, resetWidth, setHidden } = useSidebar.getState()
  return (
    <ResizeHandle
      side="right"
      label={t('sidebar.resize')}
      testId="sidebar-resize"
      onDrag={(start, dx) => {
        const next = start + dx
        if (next < SIDEBAR_WIDTH.min - SIDEBAR_HIDE_GAP) {
          // Hiện lại (Ctrl+B) thì về độ rộng trước khi kéo, không phải mức nhỏ nhất lúc kéo.
          setWidth(start)
          setHidden(true)
          return 'stop'
        }
        setWidth(Math.min(next, layout.sidebarMax))
        return undefined
      }}
      startWidth={layout.sidebarWidth}
      onReset={resetWidth}
    />
  )
}

/**
 * Tay kéo đổi độ rộng (dùng cho thanh bên và panel artifact): rê chuột → vạch sáng + con trỏ ↔; kéo; nhấp đúp → mặc định.
 * `onDrag(độ rộng lúc bắt đầu, độ dời ngang)`; trả 'stop' để kết thúc kéo (vd đã ẩn thanh bên).
 */
export function ResizeHandle({
  side,
  label,
  testId,
  startWidth,
  onDrag,
  onReset
}: {
  side: 'left' | 'right'
  label: string
  testId: string
  startWidth: number
  onDrag(start: number, dx: number): void | 'stop'
  onReset(): void
}) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; width: number } | null>(null)

  const end = (): void => {
    drag.current = null
    setDragging(false)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, width: startWidth }
    setDragging(true)
    // Giữ con trỏ ↔ và không bôi đen chữ trong lúc kéo (kể cả khi chuột ra khỏi tay kéo).
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const dx = side === 'right' ? e.clientX - d.x : d.x - e.clientX
    if (onDrag(d.width, dx) === 'stop') end()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      className={cn(
        'group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none',
        side === 'right' ? '-right-1' : '-left-1'
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      data-testid={testId}
      data-dragging={dragging ? 'true' : undefined}
    >
      {/* Vạch sáng hiện khi rê chuột / đang kéo. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary/60 opacity-0 transition-opacity group-hover:opacity-100',
          dragging && 'opacity-100'
        )}
      />
    </div>
  )
}

/**
 * Nút ẩn / hiện thanh bên.
 * - Mặc định (đầu thanh bên cố định): ẩn.
 * - `when="hidden"` (đầu khung nội dung): chỉ hiện khi thanh bên không cố định; bấm = như Ctrl+B.
 * - `variant="overlay"` (đầu thanh bên nổi): đủ chỗ thì ghim lại thành cố định, không thì đóng.
 */
export function SidebarToggle({ when, variant }: { when?: 'hidden'; variant?: 'overlay' }) {
  const { t } = useTranslation('chat')
  const layout = useChatLayout()
  const overlay = useSidebar((s) => s.overlay)
  const { toggle, setHidden, setOverlay } = useSidebar.getState()
  if (when === 'hidden' && (layout.sidebar === 'inline' || overlay !== 'none')) return null
  const showing = variant !== 'overlay' && when !== 'hidden'
  const label = showing ? t('sidebar.hide') : t('sidebar.show')
  const onClick = (): void => {
    if (variant !== 'overlay') return toggle()
    // Thanh bên nổi: người dùng đã ẩn và giờ đủ chỗ → hiện cố định; thiếu chỗ → đóng thanh bên nổi.
    if (!layout.autoHidden) setHidden(false)
    else setOverlay('none')
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={onClick}
      data-testid={showing ? 'sidebar-hide' : variant === 'overlay' ? 'sidebar-overlay-toggle' : 'sidebar-show'}
    >
      {showing ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  )
}
