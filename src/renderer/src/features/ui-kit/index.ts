import { Palette } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { UiKitPage } from './components/UiKitPage'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

/** Trang mẫu bộ giao diện chung (C0.1). CHỈ đăng ký ở bản dev — xem `devOnlyFeatures` trong registry.ts. */
export const uiKitFeature: FeatureDefinition = {
  id: 'ui-kit',
  titleKey: 'title',
  icon: Palette,
  route: '/ui-kit',
  roles: [],
  component: UiKitPage,
  i18n: { vi, en },
  nav: 'bottom'
}
