import { create } from 'zustand'
import type { Project } from '@shared/projects'
import { api } from '@renderer/lib/api'
import { coalesce, onSync, optimistic } from '@renderer/lib/sync'

type ProjectsState = {
  projects: Project[]
  loaded: boolean
  reload(): Promise<void>
  togglePin(id: string): Promise<void>
}

/**
 * Danh sách dự án dùng chung cho trang Dự án, thanh bên (dự án ghim trong "Đã ghim") và cửa sổ tìm kiếm.
 * Tự tải lại khi main báo `projects` (sync) — không làm mới theo chu kỳ.
 */
export const useProjects = create<ProjectsState>((set, get) => {
  const load = coalesce(async () => {
    set({ projects: await api.projects.list(), loaded: true })
  })
  return {
    projects: [],
    loaded: false,
    reload: () => load(),
    async togglePin(id) {
      const before = get().projects
      const target = before.find((p) => p.id === id)
      if (!target) return
      await optimistic({
        topic: 'projects',
        apply: () => set({ projects: before.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)) }),
        rollback: () => set({ projects: before }),
        save: () => api.projects.update({ id, pinned: !target.pinned })
      })
    }
  }
})

/** Nạp lúc mở app + mỗi khi có thay đổi (kể cả từ nơi khác). */
export function setupProjects(): () => void {
  void useProjects.getState().reload()
  return onSync('projects', () => void useProjects.getState().reload())
}
