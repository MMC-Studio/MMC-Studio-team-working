import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useParams } from 'react-router'
import { cn } from '@renderer/lib/utils'
import { isSettingsTab, tabOf } from '../catalog'
import { settingsLink, useSettingsDialog } from '../dialog'

/** Nút Cài đặt ở thanh biểu tượng: mở cửa sổ nổi đè lên trang đang xem (không chuyển trang). */
export function SettingsNavButton() {
  const { t } = useTranslation('settings')
  const dialog = useSettingsDialog()
  const label = t('title')
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={dialog.open}
      className={cn(
        'relative flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
        dialog.open && 'bg-primary/10 text-primary'
      )}
      onClick={() => (dialog.open ? dialog.close() : dialog.show())}
      data-testid="nav-settings"
    >
      <Settings className="size-5" />
    </button>
  )
}

/**
 * Đường dẫn cũ `#/settings` (thông báo, link cũ) và `#/settings/<tab hoặc id dòng>` → về trang Chat, mở cửa sổ Cài đặt.
 * Vd `#/settings/voice` mở tab Khả năng và nháy dòng Giọng nói.
 */
export function SettingsRedirect() {
  const target = useParams()['*'] ?? ''
  const { hash } = useLocation()
  // Link cũ dạng /settings#expressive.
  const key = target || hash.replace(/^#/, '')
  const tab = isSettingsTab(key) ? key : tabOf(key)
  const focus = !isSettingsTab(key) && tabOf(key) ? key : undefined
  return <Navigate to={settingsLink('/', tab, focus)} replace />
}
