import { randomUUID } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { ACTION_LOG_RETENTION_MS, type ActionLogDecision, type ActionLogKind } from '@shared/actionLog'
import type { AppDatabase } from '../db/client'
import { actionLog } from '../db/schema'

export type ActionLogEntry = {
  conversationId: string | null
  kind: ActionLogKind
  target: string
  decision: ActionLogDecision
  exitCode?: number | null
  durationMs?: number | null
  detail?: string | null
}

/** Ghi / dọn nhật ký thao tác (theo tài khoản hiện tại). Trang xem nhật ký: PR B. */
export class ActionLogRepository {
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
  }

  /** Mọi mục của tài khoản hiện tại, mới nhất trước (trang Quyền & riêng tư dùng ở PR B). */
  list(): (typeof actionLog.$inferSelect)[] {
    return this.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.owner, this.getOwner()))
      .all()
      .sort((a, b) => b.at - a.at)
  }

  /** Xoá mục quá 90 ngày (mọi tài khoản trên máy). Trả số mục đã xoá. */
  prune(): number {
    return this.db.delete(actionLog).where(and(lt(actionLog.at, this.now() - ACTION_LOG_RETENTION_MS))).run().changes
  }
}
