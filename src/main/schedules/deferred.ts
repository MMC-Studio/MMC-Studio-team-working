import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import type { ApprovalQa } from '@shared/approvals'
import {
  DEFERRED_QUESTIONS_MAX,
  DEFERRED_TTL_MS,
  PROPOSE_MAX_BYTES,
  PROPOSE_MAX_FILES,
  type DeferredActionResult,
  type DeferredCard,
  type DeferredDraft,
  type DeferredFile,
  type DeferredFileError,
  type DeferredStatus
} from '@shared/deferred'
import type { ScheduleGrants } from '@shared/schedules'
import { insideProject, realInside, realRelative } from '../code/paths'
import { detectProject, protectedReason } from '../code/projectProfile'
import type { ActionLogEntry, RecordAction } from '../audit/actionLog'
import { draftTarget } from '../connectors/approvals'
import type { AppDatabase } from '../db/client'
import { deferredApprovals, schedules } from '../db/schema'
import { errorResult, type AppToolRegistry, type ToolResult } from '../tools/registry'

export const PROPOSE_TOOL = 'propose_file_change'
export const READ_PROPOSED_TOOL = 'read_proposed'

/** File lưu trong DB: bản gốc lúc đề xuất LẦN ĐẦU (+ hash) và bản đề xuất mới nhất. */
type StoredFile = {
  path: string
  baseHash: string | null
  original: string | null
  proposed: string
  versions: number
  status: DeferredFile['status']
  error: DeferredFileError | null
}
type ChangesetPayload = { kind: 'changeset'; folder: string; files: StoredFile[] }
/** Nháp + dữ liệu để tạo nháp lúc người dùng Đồng ý (không gửi ra giao diện). */
export type DraftPayload = {
  kind: 'draft'
  draft: DeferredDraft
  /** Gmail: người nhận (email), id thư đang trả lời `<tài khoản>:<id>`. Telegram: id chat. */
  to: string[]
  replyToId: string | null
  chatId: string | null
}
type Payload = ChangesetPayload | DraftPayload

const deferredDraftTarget = (p: DraftPayload): string =>
  draftTarget({ service: p.draft.service, account: p.draft.account ?? undefined, target: p.draft.recipients.join(', ') })
type Row = typeof deferredApprovals.$inferSelect

/** Lần chạy theo lịch đang diễn ra trong một cuộc (quyền của lịch, chốt lúc bắt đầu). */
export type RunContext = {
  owner: string
  scheduleId: string
  runId: string
  folder: string | null
  folderWrite: boolean
  drafts: boolean
}

/** Nháp do Gmail / Telegram đưa vào khi lượt là lần chạy theo lịch (không dừng chờ duyệt). */
export type DraftSubmission = Omit<DraftPayload, 'kind' | 'draft'> & { draft: Omit<DeferredDraft, 'error'> }

export type DeferredDeps = {
  db: AppDatabase
  getOwner(): string
  now(): number
  /** Quyền HIỆN TẠI của lịch (của người đang đăng nhập); null = lịch không còn. */
  scheduleGrants(scheduleId: string): ScheduleGrants | null
  /** Tạo nháp thật khi người dùng Đồng ý (kiểm lại tài khoản / chat còn bật). Lỗi → ném mã lỗi. */
  createDraft(p: DraftPayload, body: string): Promise<void>
  /** "Hỏi": gọi Claude một lần, không tool. */
  answer(card: DeferredCard, question: string, signal: AbortSignal): Promise<{ text: string } | { error: string }>
  /** "Yêu cầu sửa": lượt ngắn trong cùng cuộc, cùng tool + quyền của lịch, tính vào giới hạn mỗi ngày. */
  revise(input: { scheduleId: string; conversationId: string; note: string; summary: string }): 'queued' | 'disabled' | 'not_found'
  changed(): void
  log: { info(msg: string): void; warn(msg: string): void }
  /** Nhật ký thao tác (detail `deferred` = duyệt sau, từ lần chạy theo lịch). */
  record?: RecordAction
}

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

function count(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

async function readCurrent(abs: string): Promise<{ exists: false } | { exists: true; buf: Buffer }> {
  try {
    return { exists: true, buf: await readFile(abs) }
  } catch {
    return { exists: false }
  }
}

const proposeInput = z.object({
  path: z.string().min(1).max(1000).describe('Đường dẫn file (tương đối trong thư mục dự án, hoặc tuyệt đối trong thư mục đó).'),
  content: z.string().max(PROPOSE_MAX_BYTES).describe('TOÀN BỘ nội dung mới của file (không phải đoạn diff).')
})
const readProposedInput = z.object({ path: z.string().min(1).max(1000) })

/**
 * Thẻ hoãn duyệt của lần chạy theo lịch: một "Bộ thay đổi" mỗi lần chạy (mỗi file một mục, đề xuất lại cùng file →
 * thay bản trước, diff luôn tính từ bản gốc lúc đề xuất lần đầu) + mỗi nháp một thẻ. Chỉ ghi file / tạo nháp khi người
 * dùng Đồng ý, lúc đó kiểm lại quyền, đường dẫn, file bảo vệ / nhị phân và hash file trên đĩa.
 */
export class DeferredService {
  private runs = new Map<string, RunContext>()
  private asking = new Map<string, AbortController>()

  constructor(private readonly deps: DeferredDeps) {}

  // ---- Lần chạy ----

  begin(conversationId: string, ctx: RunContext): void {
    this.runs.set(conversationId, ctx)
  }

  end(conversationId: string): void {
    this.runs.delete(conversationId)
  }

  /** Số thẻ còn chờ của một lần chạy (thông báo "… việc chờ duyệt"). */
  pendingForRun(runId: string): number {
    return this.deps.db
      .select({ n: sql<number>`count(*)` })
      .from(deferredApprovals)
      .where(and(eq(deferredApprovals.runId, runId), eq(deferredApprovals.status, 'pending')))
      .get()!.n
  }

  /** Hướng dẫn thêm cho prompt lần chạy (theo quyền của lịch). */
  static promptRules(grants: Pick<ScheduleGrants, 'folderWrite' | 'drafts'>): string[] {
    const lines: string[] = []
    if (grants.folderWrite)
      lines.push(
        '- Muốn sửa / tạo file: gọi mcp__mmc__propose_file_change với TOÀN BỘ nội dung mới. Đây chỉ là ĐỀ XUẤT — file chưa đổi, người dùng duyệt sau. Sửa tiếp một file đã đề xuất: đọc bản đề xuất bằng mcp__mmc__read_proposed (Read vẫn thấy bản cũ trên đĩa) rồi đề xuất lại cả file.'
      )
    if (grants.drafts)
      lines.push('- Nháp Gmail / Telegram chỉ là ĐỀ XUẤT: người dùng duyệt từng nháp sau, nháp không bao giờ được gửi. Chỉ soạn cho người nhận người dùng đã nhắc tới trong lời nhắn.')
    return lines
  }

  registerTools(registry: AppToolRegistry): void {
    const canPropose = (ctx: { conversationId: string }): boolean => {
      const run = this.runs.get(ctx.conversationId)
      return !!run?.folderWrite && !!run.folder
    }
    registry.register({
      name: PROPOSE_TOOL,
      description:
        'Lần chạy theo lịch hẹn: ĐỀ XUẤT nội dung mới cho một file trong thư mục dự án (toàn bộ file). Chưa ghi gì — người dùng duyệt sau. Đề xuất lại cùng file → thay bản trước.',
      input: proposeInput,
      available: canPropose,
      run: (input, ctx) => this.propose(ctx.conversationId, input.path, input.content)
    })
    registry.register({
      name: READ_PROPOSED_TOOL,
      description: 'Đọc bản ĐỀ XUẤT mới nhất của một file trong lần chạy này (Read chỉ thấy bản trên đĩa, chưa đổi).',
      input: readProposedInput,
      available: canPropose,
      run: async (input, ctx) => this.readProposed(ctx.conversationId, input.path)
    })
  }

  private changesetRow(runId: string): Row | undefined {
    return this.deps.db
      .select()
      .from(deferredApprovals)
      .where(and(eq(deferredApprovals.runId, runId), eq(deferredApprovals.kind, 'changeset')))
      .get()
  }

  private async propose(conversationId: string, rawPath: string, content: string): Promise<ToolResult> {
    const run = this.runs.get(conversationId)
    if (!run?.folder || !run.folderWrite) return errorResult('Lịch này không được đề xuất sửa file.')
    const folder = run.folder
    const rel = insideProject(folder, rawPath)
    if (!rel) return errorResult('File nằm ngoài thư mục của lịch — không đề xuất được.')
    const reason = protectedReason(detectProject(folder), rel)
    if (reason) return errorResult(`Không đề xuất sửa file này: ${reason}`)
    if (Buffer.byteLength(content, 'utf8') > PROPOSE_MAX_BYTES) return errorResult('Nội dung quá 256 KB.')
    const abs = resolve(folder, rel)
    const realRel = await realRelative(folder, abs)
    if (!realRel) return errorResult('Đường dẫn trỏ ra ngoài thư mục (symlink) — không đề xuất được.')
    const realReason = realRel !== rel ? protectedReason(detectProject(folder), realRel) : null
    if (realReason) return errorResult(`Không đề xuất sửa file này: ${realReason}`)

    const row = this.changesetRow(run.runId)
    const payload = (row?.payload as ChangesetPayload | undefined) ?? { kind: 'changeset', folder, files: [] }
    const existing = payload.files.find((f) => f.path === rel)
    if (existing) {
      existing.proposed = content
      existing.versions++
    } else {
      if (payload.files.length >= PROPOSE_MAX_FILES) return errorResult(`Mỗi lần chạy chỉ đề xuất tối đa ${PROPOSE_MAX_FILES} file.`)
      const current = await readCurrent(abs)
      if (current.exists && current.buf.length > PROPOSE_MAX_BYTES) return errorResult('File hiện tại quá 256 KB — không đề xuất sửa được.')
      if (current.exists && current.buf.includes(0)) return errorResult('File nhị phân — không sửa bằng văn bản.')
      payload.files.push({
        path: rel,
        baseHash: current.exists ? sha(current.buf) : null,
        original: current.exists ? current.buf.toString('utf8') : null,
        proposed: content,
        versions: 1,
        status: 'pending',
        error: null
      })
    }
    const now = this.deps.now()
    if (row) this.deps.db.update(deferredApprovals).set({ payload, updatedAt: now }).where(eq(deferredApprovals.id, row.id)).run()
    else
      this.deps.db
        .insert(deferredApprovals)
        .values({
          id: randomUUID(),
          owner: run.owner,
          conversationId,
          scheduleId: run.scheduleId,
          runId: run.runId,
          kind: 'changeset',
          payload,
          createdAt: now,
          expiresAt: now + DEFERRED_TTL_MS,
          updatedAt: now
        })
        .run()
    this.deps.changed()
    const v = existing ? existing.versions : 1
    return {
      content: [
        {
          type: 'text',
          text: `Đã ghi bản đề xuất ${v > 1 ? `(bản ${v}) ` : ''}cho ${rel} — file CHƯA đổi, người dùng sẽ duyệt sau. Sửa tiếp file này thì dựa trên nội dung vừa đề xuất (read_proposed), không dựa trên file trên đĩa.`
        }
      ]
    }
  }

  private readProposed(conversationId: string, rawPath: string): ToolResult {
    const run = this.runs.get(conversationId)
    if (!run?.folder) return errorResult('Không có lần chạy theo lịch.')
    const rel = insideProject(run.folder, rawPath)
    const row = this.changesetRow(run.runId)
    const file = rel ? (row?.payload as ChangesetPayload | undefined)?.files.find((f) => f.path === rel) : undefined
    if (!file) return errorResult('Chưa có bản đề xuất cho file này trong lần chạy — đọc file trên đĩa bằng Read.')
    return { content: [{ type: 'text', text: `--- Bản đề xuất ${file.versions} của ${file.path} ---\n${file.proposed}` }] }
  }

  /** Gmail / Telegram gọi khi lượt là lần chạy theo lịch có quyền soạn nháp: ghi thẻ, KHÔNG dừng chờ. null = không hoãn. */
  draftSink(conversationId: string): ((d: DraftSubmission) => string) | null {
    const run = this.runs.get(conversationId)
    if (!run) return null
    return (d) => {
      if (!run.drafts) return 'Lịch này không được soạn nháp — không ghi nháp.'
      const now = this.deps.now()
      this.deps.db
        .insert(deferredApprovals)
        .values({
          id: randomUUID(),
          owner: run.owner,
          conversationId,
          scheduleId: run.scheduleId,
          runId: run.runId,
          kind: 'draft',
          payload: { kind: 'draft', ...d, draft: { ...d.draft, error: null } } satisfies DraftPayload,
          createdAt: now,
          expiresAt: now + DEFERRED_TTL_MS,
          updatedAt: now
        })
        .run()
      this.deps.changed()
      return `Đã ghi nháp gửi ${d.draft.recipients.join(', ')} — CHƯA tạo, người dùng sẽ duyệt từng nháp sau.`
    }
  }

  // ---- Danh sách ----

  /** Thẻ quá 7 ngày → hết hạn (vẫn hiện để biết, không duyệt được). */
  private expire(): void {
    const changed = this.deps.db
      .update(deferredApprovals)
      .set({ status: 'expired', updatedAt: this.deps.now() })
      .where(and(eq(deferredApprovals.status, 'pending'), lt(deferredApprovals.expiresAt, this.deps.now())))
      .run().changes
    if (changed) this.deps.changed()
  }

  /**
   * Thu hồi quyền của lịch → thẻ còn chờ dựa trên quyền đó thành "Đã thu hồi quyền" (không duyệt được). Changeset: mọi
   * thẻ sửa file; draft: lọc theo dịch vụ / tài khoản Gmail nếu có. Trả số thẻ đã đóng.
   */
  revokeForSchedule(
    scheduleId: string,
    scope: { kind: 'changeset' } | { kind: 'draft'; service?: 'gmail' | 'telegram'; accountId?: string }
  ): number {
    const rows = this.deps.db
      .select()
      .from(deferredApprovals)
      .where(
        and(
          eq(deferredApprovals.owner, this.deps.getOwner()),
          eq(deferredApprovals.scheduleId, scheduleId),
          eq(deferredApprovals.status, 'pending'),
          eq(deferredApprovals.kind, scope.kind)
        )
      )
      .all()
      .filter((row) => {
        if (scope.kind !== 'draft') return true
        const d = (row.payload as DraftPayload).draft
        if (scope.service && d.service !== scope.service) return false
        return !scope.accountId || d.account?.id === scope.accountId
      })
    if (!rows.length) return 0
    this.deps.db
      .update(deferredApprovals)
      .set({ status: 'revoked', updatedAt: this.deps.now() })
      .where(inArray(deferredApprovals.id, rows.map((r) => r.id)))
      .run()
    this.deps.changed()
    return rows.length
  }

  list(conversationId: string | null): DeferredCard[] {
    this.expire()
    const rows = this.deps.db
      .select({ row: deferredApprovals, name: schedules.name })
      .from(deferredApprovals)
      .leftJoin(schedules, eq(schedules.id, deferredApprovals.scheduleId))
      .where(
        and(
          eq(deferredApprovals.owner, this.deps.getOwner()),
          conversationId ? eq(deferredApprovals.conversationId, conversationId) : inArray(deferredApprovals.status, ['pending'])
        )
      )
      .orderBy(asc(deferredApprovals.createdAt))
      .all()
    return rows.map(({ row, name }) => this.toCard(row, name))
  }

  pendingCount(owner = this.deps.getOwner()): number {
    return this.deps.db
      .select({ n: sql<number>`count(*)` })
      .from(deferredApprovals)
      .where(and(eq(deferredApprovals.owner, owner), eq(deferredApprovals.status, 'pending'), sql`${deferredApprovals.expiresAt} >= ${this.deps.now()}`))
      .get()!.n
  }

  /** Số thẻ còn chờ theo lịch (hiện trên dòng của lịch). */
  pendingBySchedule(owner = this.deps.getOwner()): Map<string, number> {
    const rows = this.deps.db
      .select({ id: deferredApprovals.scheduleId, n: sql<number>`count(*)` })
      .from(deferredApprovals)
      .where(and(eq(deferredApprovals.owner, owner), eq(deferredApprovals.status, 'pending'), sql`${deferredApprovals.expiresAt} >= ${this.deps.now()}`))
      .groupBy(deferredApprovals.scheduleId)
      .all()
    return new Map(rows.filter((r) => r.id).map((r) => [r.id!, r.n]))
  }

  private toCard(row: Row, scheduleName: string | null): DeferredCard {
    const base = {
      id: row.id,
      conversationId: row.conversationId,
      scheduleId: row.scheduleId,
      scheduleName,
      status: row.status as DeferredStatus,
      qa: row.qa as ApprovalQa[],
      createdAt: row.createdAt,
      expiresAt: row.expiresAt
    }
    const p = row.payload as Payload
    if (p.kind === 'draft') return { ...base, kind: 'draft', draft: p.draft }
    return {
      ...base,
      kind: 'changeset',
      folder: p.folder,
      files: p.files.map((f) => {
        const patch = createTwoFilesPatch(`a/${f.path}`, `b/${f.path}`, f.original ?? '', f.proposed, '', '', { context: 3 })
        return { path: f.path, isNew: f.original === null, patch, ...count(patch), versions: f.versions, status: f.status, error: f.error }
      })
    }
  }

  private mine(id: string): { row: Row; name: string | null } | null {
    const r = this.deps.db
      .select({ row: deferredApprovals, name: schedules.name })
      .from(deferredApprovals)
      .leftJoin(schedules, eq(schedules.id, deferredApprovals.scheduleId))
      .where(and(eq(deferredApprovals.id, id), eq(deferredApprovals.owner, this.deps.getOwner())))
      .get()
    return r ?? null
  }

  /** Thẻ còn duyệt được (của người này, còn chờ, chưa hết hạn). */
  private open(id: string, kind: 'changeset' | 'draft'): { row: Row; name: string | null } | string {
    this.expire()
    const r = this.mine(id)
    if (!r || r.row.kind !== kind) return 'not_found'
    if (r.row.status === 'expired') return 'expired'
    if (r.row.status !== 'pending') return 'closed'
    return r
  }

  private write(row: Row, entry: Omit<ActionLogEntry, 'conversationId'>): void {
    try {
      this.deps.record?.({ ...entry, conversationId: row.conversationId })
    } catch (err) {
      this.deps.log.warn(`Ghi nhật ký hoãn duyệt lỗi: ${String(err)}`)
    }
  }

  private save(row: Row, payload: Payload, extra: Partial<Row> = {}): void {
    let status = row.status
    if (payload.kind === 'changeset' && payload.files.every((f) => f.status === 'applied' || f.status === 'rejected')) status = 'done'
    this.deps.db
      .update(deferredApprovals)
      .set({ payload, status, updatedAt: this.deps.now(), ...extra })
      .where(eq(deferredApprovals.id, row.id))
      .run()
    this.deps.changed()
  }

  private result(id: string): DeferredActionResult {
    const r = this.mine(id)
    return r ? { status: 'ok', card: this.toCard(r.row, r.name) } : { status: 'error', error: 'not_found' }
  }

  // ---- Bộ thay đổi ----

  /**
   * Đồng ý từng file (hoặc mọi file đang chờ). Mỗi file kiểm lại lúc này: lịch còn quyền đề xuất sửa ĐÚNG thư mục đó,
   * đường dẫn (kể cả symlink) trong thư mục, không phải file bảo vệ / nhị phân, file trên đĩa chưa đổi kể từ lúc đề
   * xuất (hash; file mới thì chưa được tạo). Ghi file tạm cạnh file thật rồi đổi tên.
   */
  async approveFiles(id: string, paths?: string[]): Promise<DeferredActionResult> {
    const r = this.open(id, 'changeset')
    if (typeof r === 'string') return { status: 'error', error: r }
    const payload = r.row.payload as ChangesetPayload
    const grants = r.row.scheduleId ? this.deps.scheduleGrants(r.row.scheduleId) : null
    const allowed = !!grants?.folderWrite && grants.folder === payload.folder
    for (const f of payload.files) {
      if (f.status !== 'pending' && f.status !== 'conflict' && f.status !== 'error') continue
      if (paths && !paths.includes(f.path)) continue
      const error = allowed ? await this.apply(payload.folder, f) : 'no_permission'
      f.status = error ? (error === 'changed' || error === 'exists' ? 'conflict' : 'error') : 'applied'
      f.error = error
      this.deps.log.info(`Hoãn duyệt: ${f.path} → ${f.status}${error ? ` (${error})` : ''}`)
      this.write(r.row, { kind: 'file_edit', target: f.path, decision: error ? 'blocked' : 'approved', detail: error ? `deferred: ${error}` : 'deferred' })
    }
    this.save(r.row, payload)
    return this.result(id)
  }

  private async apply(folder: string, f: StoredFile): Promise<DeferredFileError | null> {
    const rel = insideProject(folder, f.path)
    if (!rel) return 'outside'
    if (protectedReason(detectProject(folder), rel)) return 'protected'
    if (Buffer.byteLength(f.proposed, 'utf8') > PROPOSE_MAX_BYTES) return 'too_large'
    const abs = resolve(folder, rel)
    const realRel = await realRelative(folder, abs)
    if (!realRel) return 'outside'
    if (realRel !== rel && protectedReason(detectProject(folder), realRel)) return 'protected'
    const current = await readCurrent(abs)
    if (f.baseHash === null && current.exists) return 'exists'
    if (f.baseHash !== null && (!current.exists || sha(current.buf) !== f.baseHash)) return 'changed'
    const tmp = join(dirname(abs), `.${randomUUID().slice(0, 8)}.mmc-tmp`)
    try {
      await mkdir(dirname(abs), { recursive: true })
      // Thư mục vừa tạo cũng phải nằm trong thư mục gốc (phòng symlink ở đường dẫn cha).
      if (!(await realInside(folder, dirname(abs)))) return 'outside'
      await writeFile(tmp, f.proposed, 'utf8')
      await rename(tmp, abs)
      return null
    } catch (err) {
      this.deps.log.warn(`Hoãn duyệt: ghi ${rel} lỗi: ${(err as Error).message}`)
      await rm(tmp, { force: true }).catch(() => {})
      return 'write_failed'
    }
  }

  rejectFiles(id: string, paths?: string[]): DeferredActionResult {
    const r = this.open(id, 'changeset')
    if (typeof r === 'string') return { status: 'error', error: r }
    const payload = r.row.payload as ChangesetPayload
    for (const f of payload.files) {
      if (f.status === 'applied' || f.status === 'rejected' || (paths && !paths.includes(f.path))) continue
      f.status = 'rejected'
      this.write(r.row, { kind: 'file_edit', target: f.path, decision: 'rejected', detail: 'deferred' })
    }
    this.save(r.row, payload)
    return this.result(id)
  }

  // ---- Nháp: duyệt TỪNG cái (không có "Đồng ý tất cả") ----

  async approveDraft(id: string, body?: string): Promise<DeferredActionResult> {
    const r = this.open(id, 'draft')
    if (typeof r === 'string') return { status: 'error', error: r }
    const payload = r.row.payload as DraftPayload
    const grants = r.row.scheduleId ? this.deps.scheduleGrants(r.row.scheduleId) : null
    const target = deferredDraftTarget(payload)
    if (!grants?.drafts) {
      payload.draft.error = 'no_permission'
      this.write(r.row, { kind: 'draft', target, decision: 'blocked', detail: 'deferred: no_permission' })
      this.save(r.row, payload)
      return this.result(id)
    }
    const text = body?.trim() ? body : payload.draft.body
    try {
      await this.deps.createDraft(payload, text)
      payload.draft = { ...payload.draft, body: text, error: null }
      this.write(r.row, { kind: 'draft', target, decision: 'approved', detail: 'deferred' })
      this.save(r.row, payload, { status: 'done' })
    } catch (err) {
      // Vd Gmail hết hạn đăng nhập: thẻ vẫn chờ, nhắc kết nối lại (không ghi nhật ký — chưa có nháp nào được tạo).
      payload.draft.error = (err as Error).message || 'draft_failed'
      this.save(r.row, payload)
    }
    return this.result(id)
  }

  rejectDraft(id: string): DeferredActionResult {
    const r = this.open(id, 'draft')
    if (typeof r === 'string') return { status: 'error', error: r }
    const payload = r.row.payload as DraftPayload
    payload.draft.error = 'rejected'
    this.write(r.row, { kind: 'draft', target: deferredDraftTarget(payload), decision: 'rejected', detail: 'deferred' })
    this.save(r.row, payload, { status: 'done' })
    return this.result(id)
  }

  // ---- Hỏi / Yêu cầu sửa ----

  ask(id: string, question: string): DeferredActionResult {
    const r = this.mine(id)
    if (!r || r.row.status !== 'pending') return { status: 'error', error: 'expired' }
    if (this.asking.has(id)) return { status: 'error', error: 'busy' }
    const qa = [...(r.row.qa as ApprovalQa[])]
    if (qa.length >= DEFERRED_QUESTIONS_MAX) return { status: 'error', error: 'limit' }
    const snapshot = this.toCard(r.row, r.name)
    qa.push({ question, answer: '', status: 'answering' })
    this.deps.db.update(deferredApprovals).set({ qa }).where(eq(deferredApprovals.id, id)).run()
    this.deps.changed()
    const abort = new AbortController()
    this.asking.set(id, abort)
    void this.deps
      .answer(snapshot, question, abort.signal)
      .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
      .then((res) => {
        this.asking.delete(id)
        const fresh = this.mine(id)
        if (!fresh) return
        const list = [...(fresh.row.qa as ApprovalQa[])]
        const i = list.length - 1
        list[i] = 'error' in res ? { ...list[i], status: 'error', answer: res.error } : { ...list[i], status: 'done', answer: res.text.trim() }
        this.deps.db.update(deferredApprovals).set({ qa: list }).where(eq(deferredApprovals.id, id)).run()
        this.deps.changed()
      })
    return this.result(id)
  }

  /** "Yêu cầu sửa": thẻ này khép lại ("đã yêu cầu sửa"), một lượt mới đề xuất lại trong cùng cuộc. */
  revise(id: string, note: string): DeferredActionResult {
    const r = this.mine(id)
    if (!r || r.row.status !== 'pending' || r.row.expiresAt < this.deps.now()) return { status: 'error', error: 'expired' }
    if (!r.row.scheduleId) return { status: 'error', error: 'not_found' }
    const p = r.row.payload as Payload
    const summary =
      p.kind === 'changeset'
        ? `Bộ thay đổi trước gồm: ${p.files.map((f) => `${f.path} (${f.status === 'applied' ? 'đã ghi' : f.status === 'rejected' ? 'bị từ chối' : 'chưa duyệt'})`).join(', ')}.`
        : `Nháp trước gửi ${p.draft.recipients.join(', ')}${p.draft.subject ? `, tiêu đề "${p.draft.subject}"` : ''}.`
    const queued = this.deps.revise({ scheduleId: r.row.scheduleId, conversationId: r.row.conversationId, note, summary })
    if (queued !== 'queued') return { status: 'error', error: queued }
    this.save(r.row, p, { status: 'revised' })
    return this.result(id)
  }

  /** Xoá cuộc / đổi tài khoản / tắt app: huỷ các câu "Hỏi" đang chạy. */
  cancelAll(): void {
    for (const a of this.asking.values()) a.abort()
    this.asking.clear()
  }
}

const clip = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max)}\n…(đã cắt ${t.length - max} ký tự)` : t)

/** Prompt "Hỏi" trên thẻ hoãn duyệt: mô tả thẻ + các câu đã hỏi + câu mới (system prompt dùng chung với thẻ duyệt). */
export function deferredExplainPrompt(card: DeferredCard, question: string): string {
  const body =
    card.kind === 'changeset'
      ? [
          `Loại: BỘ THAY ĐỔI file do lần chạy theo lịch hẹn ${card.scheduleName ? `"${card.scheduleName}" ` : ''}đề xuất (chưa ghi; người dùng duyệt từng file)`,
          `Thư mục: ${card.folder}`,
          ...card.files.map((f) => `File ${f.path} (+${f.added} −${f.removed}${f.isNew ? ', file mới' : ''}):\n\`\`\`diff\n${clip(f.patch, 8000)}\n\`\`\``)
        ].join('\n')
      : [
          `Loại: NHÁP ${card.draft.service === 'gmail' ? 'Gmail' : 'Telegram'} do lần chạy theo lịch hẹn đề xuất (chưa tạo; không bao giờ tự gửi)`,
          `Gửi tới: ${card.draft.recipients.join(', ')}`,
          card.draft.unknownRecipients.length ? `Người nhận CHƯA TỪNG liên lạc: ${card.draft.unknownRecipients.join(', ')}` : '',
          card.draft.subject !== null ? `Tiêu đề: ${card.draft.subject}` : '',
          'Nội dung:',
          clip(card.draft.body, 8000)
        ]
          .filter(Boolean)
          .join('\n')
  const asked = card.qa
    .filter((q) => q.status === 'done')
    .map((q) => `Người dùng hỏi: ${q.question}\nBạn đã trả lời: ${q.answer}`)
    .join('\n\n')
  return [`<de-xuat>\n${body}\n</de-xuat>`, asked ? `<hoi-thoai>\n${asked}\n</hoi-thoai>` : '', `Câu hỏi mới của người dùng: ${question}`]
    .filter(Boolean)
    .join('\n\n')
}
