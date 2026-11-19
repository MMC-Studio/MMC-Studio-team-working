import { Shapes } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { ArtifactLibraryPage } from './components/ArtifactLibraryPage'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

/** Trang Artifacts (mọi cuộc trò chuyện). Mở từ thanh bên chat — không có trên thanh biểu tượng. */
export const artifactLibraryFeature: FeatureDefinition = {
  id: 'artifactLibrary',
  titleKey: 'title',
  icon: Shapes,
  route: '/artifacts',
  roles: [],
  component: ArtifactLibraryPage,
  i18n: { vi, en },
  nav: false
}
