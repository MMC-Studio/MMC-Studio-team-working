import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  PROJECT_FILE_MAX_BYTES,
  PROJECT_MAX_FILES,
  type ProjectAddFilesResult,
  type ProjectDetail,
  type ProjectFileRejectReason
} from '@shared/projects'
import { TEXT_EXTS } from '../services/attachments'
import { buildProjectPrompt } from './prompt'
import type { ProjectRepository } from './repository'

/** Dấu BOM đầu file UTF-8 (Notepad hay thêm) — bỏ đi. */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`)

export type ContextFile = { name: string; content: string; size: number }

/**
 * Đọc một file ngữ cảnh: chỉ file chữ (cùng loại với đính kèm chữ), ≤ PROJECT_FILE_MAX_BYTES, UTF-8, không có byte 0
 * (file nhị phân đổi đuôi). Không bao giờ chạy gì — chỉ lấy chữ.
 */
export async function readContextFile(path: string): Promise<ContextFile | { name: string; reason: ProjectFileRejectReason }> {
  const name = basename(path)
  if (!TEXT_EXTS.includes(extname(name).toLowerCase())) return { name, reason: 'not_text' }
  try {
    const info = await stat(path)
    if (!info.isFile()) return { name, reason: 'unreadable' }
    if (info.size > PROJECT_FILE_MAX_BYTES) return { name, reason: 'too_large' }
    const data = await readFile(path)
    if (data.includes(0)) return { name, reason: 'not_text' }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(BOM, '')
    return { name, content, size: data.length }
  } catch (e) {
    // TextDecoder fatal → không phải UTF-8 → coi như không phải file chữ.
    return { name, reason: e instanceof TypeError ? 'not_text' : 'unreadable' }
  }
}

export type ProjectServiceDeps = {
  repo: ProjectRepository
  /** Dự án của một cuộc trò chuyện (chỉ cuộc của tài khoản hiện tại). */
  projectOf(conversationId: string): string | null
}

export class ProjectService {
  constructor(private readonly deps: ProjectServiceDeps) {}

  private prompt(projectId: string) {
    const project = this.deps.repo.get(projectId)
    if (!project) return null
    const files = this.deps.repo.files(projectId)
    return { project, files, ...buildProjectPrompt({ ...project, files }) }
  }

  /** Trang dự án: thông tin + file (đã đưa vào prompt thế nào) + số ký tự phần dự án trong prompt. */
  detail(projectId: string): ProjectDetail | null {
    const p = this.prompt(projectId)
    if (!p) return null
    return {
      ...p.project,
      files: p.files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        chars: f.content.length,
        usage: p.usage[f.id] ?? 'omitted',
        createdAt: f.createdAt
      })),
      promptChars: p.section.length
    }
  }

  /** Phần "Dự án" của system prompt cho cuộc trò chuyện ('' = không thuộc dự án). Dựng lại mỗi lượt gửi. */
  promptFor(conversationId: string): string {
    const projectId = this.deps.projectOf(conversationId)
    return projectId ? (this.prompt(projectId)?.section ?? '') : ''
  }

  /** Thêm file đã chọn (đường dẫn từ hộp thoại chọn file của main — renderer không gửi đường dẫn). */
  async addFiles(projectId: string, paths: string[]): Promise<ProjectAddFilesResult | null> {
    const { repo } = this.deps
    if (!repo.get(projectId)) return null
    const result: ProjectAddFilesResult = { added: 0, rejected: [] }
    let count = repo.fileCount(projectId)
    for (const path of paths) {
      const file = await readContextFile(path)
      if ('reason' in file) {
        result.rejected.push(file)
        continue
      }
      if (count >= PROJECT_MAX_FILES) {
        result.rejected.push({ name: file.name, reason: 'too_many' })
        continue
      }
      repo.addFile(projectId, file)
      count++
      result.added++
    }
    return result
  }
}
