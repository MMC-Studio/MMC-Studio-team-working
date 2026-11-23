import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNotNull, lt, sql, type SQL } from 'drizzle-orm'
import {
  ACTION_LOG_RETENTION_MS,
  actionLogQuerySchema,
  type ActionLogDecision,
  type ActionLogItem,
  type ActionLogKind,
  type ActionLogPage,
  type ActionLogQuery
} from '@shared/actionLog'
import { matchesAllWords } from '@shared/text'
import type { AppDatabase } from '../db/client'
import { actionLog, conversations } from '../db/schema'

export type ActionLogEntry = {
  conversationId: string | null
  kind: ActionLogKind
  target: string
  decision: ActionLogDecision
  exitCode?: number | null
  durationMs?: number | null
  detail?: string | null
}

/** Hàm ghi nhật ký truyền cho các dịch vụ duyệt (lỗi ghi không bao giờ làm hỏng việc chính). */
export type RecordAction = (entry: ActionLogEntry) => void

/** Ghi / xem / dọn nhật ký thao tác (theo tài khoản hiện tại). Trang xem: Cài đặt → Quyền & riêng tư. */
export class ActionLogRepository {
  /** Báo trang nhật ký hỏi lại (sync mục `actionLog`). */
  onChange: () => void = () => {}

  constructor(
    private readonly db: AppDatabase,
    private readonly getOwner: () => string,
    private readonly now: () => number = Date.now
  ) {}

  add(entry: ActionLogEntry): void {
    this.db
      .insert(actionLog)
      .values({
        id: randomUUID(),
        owner: this.getOwner(),
        at: this.now(),
        conversationId: entry.conversationId,
        kind: entry.kind,
        target: entry.target.slice(0, 1000),
        decision: entry.decision,
        exitCode: entry.exitCode ?? null,
        durationMs: entry.durationMs ?? null,
        detail: entry.detail?.slice(0, 500) ?? null
      })
      .run()
    this.onChange()
  }

  /** Mọi mục của tài khoản hiện tại, mới nhất trước. */
  list(): (typeof actionLog.$inferSelect)[] {
    return this.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.owner, this.getOwner()))
      .orderBy(desc(actionLog.at))
      .all()
  }

  /**
   * Một trang nhật ký theo bộ lọc (loại / cuộc / chữ), mới nhất trước, kèm tên cuộc. Lọc loại / cuộc bằng SQL; tìm chữ
   * không dấu nên lọc ở đây (90 ngày nhật ký trên một máy — vài nghìn dòng là cùng).
   */
  query(raw: ActionLogQuery = {}): ActionLogPage {
    const q = actionLogQuerySchema.parse(raw)
    const owner = this.getOwner()
    const conds: SQL[] = [eq(actionLog.owner, owner)]
    if (q.kind) conds.push(eq(actionLog.kind, q.kind))
    if (q.conversationId) conds.push(eq(actionLog.conversationId, q.conversationId))
    const where = and(...conds)
    const base = this.db
      .select({ row: actionLog, title: conversations.title })
      .from(actionLog)
      .leftJoin(conversations, eq(conversations.id, actionLog.conversationId))
      .where(where)
      .orderBy(desc(actionLog.at), desc(actionLog.id))
    let rows: { row: typeof actionLog.$inferSelect; title: string | null }[]
    let total: number
    if (q.search.trim()) {
      const all = base.all().filter((r) => matchesAllWords(`${r.row.target} ${r.row.detail ?? ''}`, q.search))
      total = all.length
      rows = all.slice(q.offset, q.offset + q.limit)
    } else {
      total = this.db.select({ n: sql<number>`count(*)` }).from(actionLog).where(where).get()?.n ?? 0
      rows = base.limit(q.limit).offset(q.offset).all()
    }
    const items: ActionLogItem[] = rows.map(({ row, title }) => ({
      id: row.id,
      at: row.at,
      kind: row.kind,
      target: row.target,
      decision: row.decision,
      exitCode: row.exitCode,
      durationMs: row.durationMs,
      detail: row.detail,
      conversationId: row.conversationId,
      conversationTitle: row.conversationId ? (title ?? '') : null
    }))
    const convs = this.db
      .select({ id: conversations.id, title: conversations.title, last: sql<number>`max(${actionLog.at})` })
      .from(actionLog)
      .innerJoin(conversations, eq(conversations.id, actionLog.conversationId))
      .where(and(eq(actionLog.owner, owner), isNotNull(actionLog.conversationId)))
      .groupBy(conversations.id)
      .orderBy(desc(sql`max(${actionLog.at})`))
      .all()
    return { items, total, conversations: convs.map((c) => ({ id: c.id, title: c.title })) }
  }

  /** Xoá mục quá 90 ngày (mọi tài khoản trên máy). Trả số mục đã xoá. */
  prune(): number {
    const n = this.db.delete(actionLog).where(lt(actionLog.at, this.now() - ACTION_LOG_RETENTION_MS)).run().changes
    if (n) this.onChange()
    return n
  }
}
