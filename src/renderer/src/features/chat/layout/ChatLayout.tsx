import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { ConversationSidebar } from '../components/ConversationSidebar'
import { useSidebar } from './sidebarStore'

/**
 * Bố cục chung của trang Chat và các trang mở từ thanh bên (Artifacts, Dự án, Lịch hẹn, Plugin):
 * thanh bên chat (ẩn được bằng Ctrl+B) + nội dung trang.
 */
export function ChatLayout({ children }: { children: ReactNode }) {
  const hidden = useSidebar((s) => s.hidden)
  return (
    <div className="flex h-full min-h-0">
      {!hidden && <ConversationSidebar />}
      {children}
    </div>
  )
}

/** Nút ẩn / hiện thanh bên. `when="hidden"`: chỉ hiện lúc thanh bên đang ẩn (đặt ở đầu khung nội dung). */
export function SidebarToggle({ when }: { when?: 'hidden' }) {
  const { t } = useTranslation('chat')
  const hidden = useSidebar((s) => s.hidden)
  const toggle = useSidebar((s) => s.toggleHidden)
  if (when === 'hidden' && !hidden) return null
  const label = hidden ? t('sidebar.show') : t('sidebar.hide')
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={toggle}
      data-testid={hidden ? 'sidebar-show' : 'sidebar-hide'}
    >
      {hidden ? <PanelLeftOpen /> : <PanelLeftClose />}
    </Button>
  )
}
