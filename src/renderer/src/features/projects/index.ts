import { FolderKanban } from 'lucide-react'
import type { FeatureDefinition } from '../types'
import { ProjectsRoute } from './components/ProjectsRoute'
import { setupProjects } from './store'
import { PROJECTS_ROUTE } from './view'
import en from './i18n/en.json'
import vi from './i18n/vi.json'

/**
 * Dự án cá nhân (khác "Dự án team" ở /projects): hướng dẫn + file ngữ cảnh gửi kèm trợ lý trong mọi cuộc của dự án.
 * Mở từ thanh bên chat (không có trên thanh biểu tượng).
 */
export const projectsFeature: FeatureDefinition = {
  id: 'projects',
  titleKey: 'title',
  icon: FolderKanban,
  route: `${PROJECTS_ROUTE}/*`,
  roles: [],
  component: ProjectsRoute,
  i18n: { vi, en },
  nav: false,
  // Danh sách dùng cả ở thanh bên ("Đã ghim") và cửa sổ tìm kiếm → nạp từ lúc mở app.
  setup: setupProjects
}
