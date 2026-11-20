import type { Project } from '@shared/projects'
import { matchesAllWords } from '@shared/text'

export const PROJECT_SORTS = ['updated', 'name', 'created'] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

/**
 * Trang Dự án: lọc theo tên + mô tả (không dấu), dự án ghim luôn đứng đầu, rồi sắp theo lựa chọn
 * (mới sửa / tên A→Z theo tiếng Việt / ngày tạo mới nhất).
 */
export function viewProjects(list: Project[], sort: ProjectSort, query: string): Project[] {
  const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true })
  const byKey = (a: Project, b: Project): number => {
    if (sort === 'name') return collator.compare(a.name, b.name)
    if (sort === 'created') return b.createdAt - a.createdAt
    return b.updatedAt - a.updatedAt
  }
  return list
    .filter((p) => matchesAllWords(`${p.name} ${p.description}`, query))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byKey(a, b))
}

/** Dự án ghim (thanh bên "Đã ghim"), theo tên. */
export const pinnedProjects = (list: Project[]): Project[] =>
  list.filter((p) => p.pinned).sort((a, b) => a.name.localeCompare(b.name, 'vi'))

/** Đường dẫn trang một dự án ("/projects" đã là Dự án team). */
export const PROJECTS_ROUTE = '/my-projects'
export const projectPath = (id: string): string => `${PROJECTS_ROUTE}/${id}`
