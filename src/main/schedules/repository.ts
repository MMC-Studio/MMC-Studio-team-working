import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, sql } from 'drizzle-orm'
import type {
  Schedule,
  ScheduleInput,
  ScheduleRun,
  ScheduleRunReason,
  ScheduleRunStatus,
  ScheduleRunTrigger,
  SchedulePauseReason
} from '@shared/schedules'
import { normalizeGrants, SCHEDULE_RUNS_KEEP, SCHEDULE_RUNS_MAX_AGE_MS } from '@shared/schedules'
import type { AppDatabase } from '../db/client'
import { conversations, projects, scheduleRuns, schedules } from '../db/schema'

type ScheduleRow = typeof schedules.$inferSelect
type RunRow = typeof scheduleRuns.$inferSelect

const unseenCount = sql<number>`(SELECT count(*) FROM schedule_runs r WHERE r.schedule_id = schedules.id AND r.conversation_id IS NOT NULL AND r.seen_at IS NULL AND r.status <> 'running')`

const toSchedule = (r: ScheduleRow, unseen: number): Schedule => ({
  id: r.id,
  name: r.name,
  prompt: r.prompt,
  recurrence: r.recurrence,
  projectId: r.projectId,
  grants: normalizeGrants(r.grants),
  model: r.model,
  catchUp: r.catchUp,
  enabled: r.enabled,
  pausedReason: r.pausedReason ?? null,
  skipNext: r.skipNext,
  nextRunAt: r.nextRunAt,
  lastRunAt: r.lastRunAt,
  lastStatus: r.lastStatus ?? null,
  consecutiveFailures: r.consecutiveFailures,
  origin: r.origin,
  unseen,
  pending: 0,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
})

const toRun = (r: RunRow): ScheduleRun => ({
  id: r.id,
  scheduleId: r.scheduleId,
  scheduledFor: r.scheduledFor,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  status: r.status,
  trigger: r.trigger,
  reason: r.reason ?? null,
  detail: r.detail,
  missed: r.missed,
  conversationId: r.conversationId,
  toolCount: r.toolCount,
  seenAt: r.seenAt
})

export type SchedulePatch = Partial<
  Pick<
    ScheduleRow,
    | 'enabled'
    | 'pausedReason'
    | 'skipNext'
    | 'nextRunAt'
    | 'lastRunAt'
    | 'lastStatus'
    | 'consecutiveFailures'
  >
>

export type NewRun = {
  scheduleId: string
  scheduledFor: number
  status: ScheduleRunStatus
  trigger: ScheduleRunTrigger
  reason?: ScheduleRunReason | null
  detail?: string | null
  missed?: number
  startedAt?: number | null
  finishedAt?: number | null
  conversationId?: string | null
}

/**
 * Lịch hẹn theo TÀI KHOẢN (như lịch sử chat). Hàm có `owner` rõ ràng dùng cho bộ hẹn giờ (chạy theo chủ lịch);
 * còn lại theo người đang đăng nhập.
 */
export class ScheduleRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly getOwner: () => string
  ) {}

  private mine(id?: string, owner = this.getOwner()) {
    return and(eq(schedules.owner, owner), id === undefined ? undefined : eq(schedules.id, id))
  }

  list(owner = this.getOwner()): Schedule[] {
    return this.db
      .select({ row: schedules, unseen: unseenCount })
      .from(schedules)
      .where(this.mine(undefined, owner))
      .orderBy(asc(schedules.createdAt))
      .all()
      .map(({ row, unseen }) => toSchedule(row, unseen))
  }

  get(id: string, owner = this.getOwner()): Schedule | null {
    const r = this.db.select({ row: schedules, unseen: unseenCount }).from(schedules).where(this.mine(id, owner)).get()
    return r ? toSchedule(r.row, r.unseen) : null
  }

  /** Chủ của lịch (nội bộ: thông báo bấm vào → đúng tài khoản). */
  ownerOf(id: string): string | null {
    return this.db.select({ owner: schedules.owner }).from(schedules).where(eq(schedules.id, id)).get()?.owner ?? null
  }

  count(owner = this.getOwner()): { total: number; enabled: number } {
    const r = this.db
      .select({ total: sql<number>`count(*)`, enabled: sql<number>`coalesce(sum(${schedules.enabled}), 0)` })
      .from(schedules)
      .where(this.mine(undefined, owner))
      .get()
    return { total: r?.total ?? 0, enabled: r?.enabled ?? 0 }
  }

  ownsProject(projectId: string, owner = this.getOwner()): boolean {
    return !!this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.owner, owner)))
      .get()
  }

  create(input: ScheduleInput, origin: 'user' | 'assistant', nextRunAt: number | null): Schedule {
    const ts = Date.now()
    const row = this.db
      .insert(schedules)
      .values({
        id: randomUUID(),
        owner: this.getOwner(),
        name: input.name,
        prompt: input.prompt,
        recurrence: input.recurrence,
        projectId: input.projectId,
        grants: input.grants,
        model: input.model,
        catchUp: input.catchUp,
        enabled: true,
        nextRunAt,
        origin,
        createdAt: ts,
        updatedAt: ts
      })
      .returning()
      .get()
    return toSchedule(row, 0)
  }

  /** Sửa nội dung lịch (tên, lời nhắn, giờ, quyền…) — giờ đổi thì tính lại lần hẹn tới. */
  edit(id: string, input: ScheduleInput, nextRunAt: number | null): Schedule | null {
    const row = this.db
      .update(schedules)
      .set({
        name: input.name,
        prompt: input.prompt,
        recurrence: input.recurrence,
        projectId: input.projectId,
        grants: input.grants,
        model: input.model,
        catchUp: input.catchUp,
        nextRunAt,
        skipNext: false,
        updatedAt: Date.now()
      })
      .where(this.mine(id))
      .returning()
      .get()
    return row ? this.get(row.id) : null
  }

  /** Trạng thái chạy (bộ hẹn giờ) — theo id, không đổi `updated_at`. */
  patch(id: string, patch: SchedulePatch): void {
    if (Object.keys(patch).length === 0) return
    this.db.update(schedules).set(patch).where(eq(schedules.id, id)).run()
  }

  setEnabled(id: string, enabled: boolean, nextRunAt: number | null, pausedReason: SchedulePauseReason | null = null): Schedule | null {
    const row = this.db
      .update(schedules)
      .set({ enabled, pausedReason, nextRunAt, consecutiveFailures: enabled ? 0 : undefined, skipNext: enabled ? false : undefined })
      .where(this.mine(id))
      .returning()
      .get()
    return row ? this.get(row.id) : null
  }

  remove(id: string): boolean {
    return this.db.delete(schedules).where(this.mine(id)).run().changes > 0
  }

  /** Lịch đang bật của `owner` đã tới giờ (sớm nhất trước). */
  due(owner: string, now: number): Schedule[] {
    return this.db
      .select({ row: schedules, unseen: unseenCount })
      .from(schedules)
      .where(and(eq(schedules.owner, owner), eq(schedules.enabled, true), isNotNull(schedules.nextRunAt), lte(schedules.nextRunAt, now)))
      .orderBy(asc(schedules.nextRunAt))
      .all()
      .map(({ row, unseen }) => toSchedule(row, unseen))
  }

  /** Lịch đang bật của `owner` (tính lại lần hẹn tới khi đổi tài khoản). */
  enabledFor(owner: string): Schedule[] {
    return this.db
      .select({ row: schedules, unseen: unseenCount })
      .from(schedules)
      .where(and(eq(schedules.owner, owner), eq(schedules.enabled, true)))
      .all()
      .map(({ row, unseen }) => toSchedule(row, unseen))
  }

  // ---- Nhật ký các lần chạy ----

  insertRun(run: NewRun): ScheduleRun {
    const row = this.db
      .insert(scheduleRuns)
      .values({
        id: randomUUID(),
        scheduleId: run.scheduleId,
        scheduledFor: run.scheduledFor,
        status: run.status,
        trigger: run.trigger,
        reason: run.reason ?? null,
        detail: run.detail ?? null,
        missed: run.missed ?? 0,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        conversationId: run.conversationId ?? null,
        createdAt: Date.now()
      })
      .returning()
      .get()
    this.prune(run.scheduleId)
    return toRun(row)
  }

  updateRun(id: string, patch: Partial<Pick<RunRow, 'status' | 'reason' | 'detail' | 'finishedAt' | 'conversationId' | 'toolCount'>>): void {
    this.db.update(scheduleRuns).set(patch).where(eq(scheduleRuns.id, id)).run()
  }

  getRun(id: string): ScheduleRun | null {
    const r = this.db.select().from(scheduleRuns).where(eq(scheduleRuns.id, id)).get()
    return r ? toRun(r) : null
  }

  /** Nhật ký của một lịch (hoặc mọi lịch) của người đang đăng nhập, mới trước. */
  runs(scheduleId: string | null, limit: number): ScheduleRun[] {
    const owned = this.db.select({ id: schedules.id }).from(schedules).where(this.mine(scheduleId ?? undefined))
    return this.db
      .select()
      .from(scheduleRuns)
      .where(inArray(scheduleRuns.scheduleId, owned))
      .orderBy(desc(scheduleRuns.createdAt))
      .limit(limit)
      .all()
      .map(toRun)
  }

  /** Mở cuộc trò chuyện của một lần chạy → đã xem. Trả true nếu có dòng đổi. */
  markSeen(conversationId: string): boolean {
    const owned = this.db.select({ id: schedules.id }).from(schedules).where(this.mine())
    return (
      this.db
        .update(scheduleRuns)
        .set({ seenAt: Date.now() })
        .where(
          and(
            eq(scheduleRuns.conversationId, conversationId),
            isNull(scheduleRuns.seenAt),
            notInArray(scheduleRuns.status, ['running']),
            inArray(scheduleRuns.scheduleId, owned)
          )
        )
        .run().changes > 0
    )
  }

  unseen(owner = this.getOwner()): number {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(scheduleRuns)
        .innerJoin(schedules, eq(schedules.id, scheduleRuns.scheduleId))
        .where(
          and(
            eq(schedules.owner, owner),
            isNotNull(scheduleRuns.conversationId),
            isNull(scheduleRuns.seenAt),
            notInArray(scheduleRuns.status, ['running'])
          )
        )
        .get()?.n ?? 0
    )
  }

  /** Số lần THẬT SỰ chạy (có bắt đầu) từ mốc này — mọi tài khoản, vì hạn mức Claude là của máy. */
  startedSince(t: number): number {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(scheduleRuns)
        .where(and(isNotNull(scheduleRuns.startedAt), gte(scheduleRuns.startedAt, t)))
        .get()?.n ?? 0
    )
  }

  /** App tắt giữa lúc chạy → dòng "đang chạy" cũ thành "đã dừng". */
  markInterrupted(): number {
    return this.db
      .update(scheduleRuns)
      .set({ status: 'aborted', reason: 'interrupted', finishedAt: Date.now() })
      .where(eq(scheduleRuns.status, 'running'))
      .run().changes
  }

  /** Giữ 200 dòng mới nhất mỗi lịch, xoá dòng cũ hơn 90 ngày. */
  private prune(scheduleId: string): void {
    this.db
      .delete(scheduleRuns)
      .where(and(eq(scheduleRuns.scheduleId, scheduleId), lt(scheduleRuns.createdAt, Date.now() - SCHEDULE_RUNS_MAX_AGE_MS)))
      .run()
    const keep = this.db
      .select({ id: scheduleRuns.id })
      .from(scheduleRuns)
      .where(eq(scheduleRuns.scheduleId, scheduleId))
      .orderBy(desc(scheduleRuns.createdAt))
      .limit(SCHEDULE_RUNS_KEEP)
    this.db
      .delete(scheduleRuns)
      .where(and(eq(scheduleRuns.scheduleId, scheduleId), notInArray(scheduleRuns.id, keep)))
      .run()
  }

  /** Cuộc trò chuyện của lần chạy có còn không (người dùng có thể đã xoá). */
  conversationExists(id: string): boolean {
    return !!this.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id)).get()
  }
}
