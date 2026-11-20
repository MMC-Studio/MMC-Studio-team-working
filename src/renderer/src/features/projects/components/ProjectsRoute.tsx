import { useParams } from 'react-router'
import { ProjectPage } from './ProjectPage'
import { ProjectsPage } from './ProjectsPage'

/** `/my-projects` → danh sách; `/my-projects/<id>` → trang một dự án (key theo id: đổi dự án là dựng lại sạch). */
export function ProjectsRoute() {
  const id = useParams()['*']?.split('/')[0]
  return id ? <ProjectPage key={id} id={id} /> : <ProjectsPage />
}
