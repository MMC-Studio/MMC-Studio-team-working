import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { Project, ProjectDeleteInfo, ProjectUpdate } from '@shared/projects'
import type { AppDatabase } from '../db/client'
import { conversations, memories, memorySuggestions, projectFiles, projects, schedules } from '../db/schema'

type ProjectRow = typeof projects.$inferSelect
export type ProjectFileRow = typeof projectFiles.$inferSelect

/** Viết thẳng tên bảng: drizzle bỏ tên bảng ở cột trong select một bảng → `id` sẽ khớp nhầm project_files.id. */
const fileCount = sql<number>`(SELECT count(*) FROM project_files WHERE project_files.project_id = projects.id)`

const toProject = (r: ProjectRow, files: number): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  instructions: r.instructions,
  pinned: r.pinned,
  fileCount: files,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
})

/**
 * Dự án cá nhân theo TÀI KHOẢN (như lịch sử chat): đọc / sửa / xoá chỉ dự án của người đang đăng nhập.
 * File ngữ cảnh luôn đi qua dự án nên cũng chỉ của tài khoản đó.
 */
export class ProjectRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly getOwner: () => string
  ) {}

  private mine(id?: string) {
    return and(eq(projects.owner, this.getOwner()), id === undefined ? undefined : eq(projects.id, id))
  }

  /** Ghim trước, mới sửa trước (trang Dự án tự sắp xếp lại theo lựa chọn). */
  list(): Project[] {
    return this.db
      .select({ row: projects, files: fileCount })
      .from(projects)
      .where(this.mine())
      .orderBy(desc(projects.pinned), desc(projects.updatedAt))
      .all()
      .map(({ row, files }) => toProject(row, files))
  }

  get(id: string): Project | null {
    const r = this.db.select({ row: projects, files: fileCount }).from(projects).where(this.mine(id)).get()
    return r ? toProject(r.row, r.files) : null
  }

  create(input: { name: string; description: string }): Project {
    const ts = Date.now()
    const row = this.db
      .insert(projects)
      .values({ id: randomUUID(), owner: this.getOwner(), name: input.name, description: input.description, createdAt: ts, updatedAt: ts })
      .returning()
      .get()
    return toProject(row, 0)
  }

  /** Ghim / bỏ ghim không tính là "sửa" (không đổi thứ tự "mới sửa"). */
  update(input: ProjectUpdate): Project | null {
    const patch: Partial<ProjectRow> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.description !== undefined) patch.description = input.description
    if (input.instructions !== undefined) patch.instructions = input.instructions
    if (input.pinned !== undefined) patch.pinned = input.pinned
    if (Object.keys(patch).length === 0) return this.get(input.id)
    if (input.name !== undefined || input.description !== undefined || input.instructions !== undefined) patch.updatedAt = Date.now()
    const row = this.db.update(projects).set(patch).where(this.mine(input.id)).returning().get()
    return row ? this.get(row.id) : null
  }

  touch(id: string): void {
    this.db.update(projects).set({ updatedAt: Date.now() }).where(this.mine(id)).run()
  }

  /** Những gì mất / được giữ khi xoá — cho hộp xác nhận. */
  deleteInfo(id: string): ProjectDeleteInfo | null {
    if (!this.get(id)) return null
    const count = (q: { n: number } | undefined): number => q?.n ?? 0
    return {
      files: count(this.db.select({ n: sql<number>`count(*)` }).from(projectFiles).where(eq(projectFiles.projectId, id)).get()),
      memories: count(this.db.select({ n: sql<number>`count(*)` }).from(memories).where(eq(memories.projectId, id)).get()),
      suggestions: count(
        this.db
          .select({ n: sql<number>`count(*)` })
          .from(memorySuggestions)
          .where(and(eq(memorySuggestions.projectId, id), eq(memorySuggestions.status, 'pending')))
          .get()
      ),
      conversations: count(
        this.db.select({ n: sql<number>`count(*)` }).from(conversations).where(eq(conversations.projectId, id)).get()
      ),
      schedules: count(this.db.select({ n: sql<number>`count(*)` }).from(schedules).where(eq(schedules.projectId, id)).get())
    }
  }

  /** Xoá dự án: file ngữ cảnh + trí nhớ dự án xoá theo (khoá ngoại), cuộc trò chuyện thành cuộc thường. */
  remove(id: string): boolean {
    if (!this.get(id)) return false
    return this.db.transaction((tx) => {
      // Lịch hẹn của dự án: giữ lại (khoá ngoại đặt project_id = null) nhưng TẠM DỪNG — mất hướng dẫn dự án thì lịch
      // có thể chạy sai ý; người dùng xem lại rồi tự bật.
      tx.update(schedules)
        .set({ enabled: false, pausedReason: 'project_deleted', updatedAt: Date.now() })
        .where(eq(schedules.projectId, id))
        .run()
      return tx.delete(projects).where(this.mine(id)).run().changes > 0
    })
  }

  // ---- File ngữ cảnh ----

  /** Theo thứ tự thêm vào (file thêm trước được ưu tiên chỗ trong prompt). */
  files(projectId: string): ProjectFileRow[] {
    if (!this.get(projectId)) return []
    return this.db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(asc(projectFiles.createdAt)).all()
  }

  fileCount(projectId: string): number {
    return this.get(projectId)?.fileCount ?? 0
  }

  addFile(projectId: string, file: { name: string; content: string; size: number }): ProjectFileRow | null {
    if (!this.get(projectId)) return null
    const row = this.db
      .insert(projectFiles)
      .values({ id: randomUUID(), projectId, name: file.name, content: file.content, size: file.size, createdAt: Date.now() })
      .returning()
      .get()
    this.touch(projectId)
    return row
  }

  /** Trả id dự án chứa file (null = không có / không phải của tài khoản này). */
  removeFile(fileId: string): string | null {
    const row = this.db
      .select({ projectId: projectFiles.projectId })
      .from(projectFiles)
      .innerJoin(projects, eq(projects.id, projectFiles.projectId))
      .where(and(eq(projectFiles.id, fileId), eq(projects.owner, this.getOwner())))
      .get()
    if (!row) return null
    this.db.delete(projectFiles).where(eq(projectFiles.id, fileId)).run()
    this.touch(row.projectId)
    return row.projectId
  }
}
