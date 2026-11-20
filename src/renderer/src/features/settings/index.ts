import { Settings } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { SettingsDialog } from './components/SettingsDialog'
import { SettingsNavButton, SettingsRedirect } from './components/SettingsNav'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

/**
 * Cài đặt là cửa sổ nổi (mở bằng `?settings=<tab>` trên trang đang xem — xem dialog.ts), không phải trang riêng.
 * Route `/settings/*` giữ cho link cũ / thông báo: chuyển về trang Chat và mở cửa sổ.
 */
export const settingsFeature: FeatureDefinition = {
  id: 'settings',
  titleKey: 'title',
  icon: Settings,
  route: '/settings/*',
  roles: [],
  component: SettingsRedirect,
  i18n: { vi, en },
  nav: 'bottom',
  navButton: SettingsNavButton,
  overlay: SettingsDialog
}
