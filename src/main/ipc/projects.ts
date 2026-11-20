import { dialog, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { projectCreateSchema, projectUpdateSchema } from '@shared/projects'
import { idSchema } from '@shared/schemas'
import type { ProjectRepository } from '../projects/repository'
import type { ProjectService } from '../projects/service'
import { TEXT_EXTS } from '../services/attachments'
import type { HandleFn } from './register'

export type ProjectsIpcDeps = {
  handle: HandleFn
  repo: ProjectRepository
  service: ProjectService
  getWindow(): BrowserWindow | null
  /** Chỉ cho e2e ở bản chưa đóng gói: danh sách đường dẫn thay cho hộp thoại chọn file. */
  fakePick?: () => string[]
}

const P = { changes: 'projects' } as const

/** Dự án cá nhân: danh sách, chi tiết (kèm cách file được đưa vào prompt), sửa, xoá, file ngữ cảnh. */
export function registerProjectsIpc(deps: ProjectsIpcDeps): void {
  const { handle, repo, service } = deps

  handle(IPC.projectsList, z.undefined(), () => repo.list())
  handle(IPC.projectsGet, idSchema, (id) => service.detail(id))
  handle(IPC.projectsCreate, projectCreateSchema, (input) => repo.create(input), P)
  handle(
    IPC.projectsUpdate,
    projectUpdateSchema,
    (input) => {
      const updated = repo.update(input)
      if (!updated) throw new Error('project_not_found')
      return updated
    },
    P
  )
  handle(IPC.projectsDeleteInfo, idSchema, (id) => repo.deleteInfo(id))
  // Xoá dự án: cuộc trò chuyện thành cuộc thường, trí nhớ dự án mất theo → báo cả ba mục.
  handle(IPC.projectsRemove, idSchema, (id) => repo.remove(id), { changes: ['projects', 'conversations', 'memory'] })

  // Renderer không gửi đường dẫn: main tự mở hộp thoại chọn file (chỉ file chữ).
  handle(
    IPC.projectsAddFiles,
    idSchema,
    async (id) => {
      if (!repo.get(id)) throw new Error('project_not_found')
      let paths = deps.fakePick?.()
      if (!paths) {
        const win = deps.getWindow()
        const options: Electron.OpenDialogOptions = {
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Text', extensions: TEXT_EXTS.map((e) => e.slice(1)) }]
        }
        const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        if (r.canceled) return { added: 0, rejected: [] }
        paths = r.filePaths
      }
      return service.addFiles(id, paths)
    },
    P
  )
  handle(
    IPC.projectsRemoveFile,
    idSchema,
    (fileId) => {
      if (!repo.removeFile(fileId)) throw new Error('file_not_found')
    },
    P
  )
}
