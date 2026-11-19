import { Hourglass } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { ComingSoonPage } from './components/ComingSoonPage'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

/** Trang tạm "Sắp có" (Dự án / Lịch hẹn / Plugin) mở từ thanh bên chat — PR sau thay bằng trang thật. */
export const comingSoonFeature: FeatureDefinition = {
  id: 'comingSoon',
  titleKey: 'title',
  icon: Hourglass,
  route: '/soon/:section',
  roles: [],
  component: ComingSoonPage,
  i18n: { vi, en },
  nav: false
}
