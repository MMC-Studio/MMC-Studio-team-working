import type { PrivacyFolderGrant, PrivacyScheduleGrant, PrivacyStatus, ScheduleGrantKey } from '@shared/privacy'
import { normalizeGrants, type Schedule, type ScheduleGrants } from '@shared/schedules'

/** Mọi dịch vụ có thẻ đang chờ / việc đang chạy theo cuộc (sửa file, MCP, nháp, xin quyền, đề xuất lịch, lệnh). */
export type ConversationCanceller = { cancelConversation(conversationId: string): void }

/**
 * Huỷ hết thẻ đang chờ + dừng việc đang chạy của một cuộc trên MỌI dịch vụ. Một dịch vụ lỗi không chặn các dịch vụ
 * còn lại (thu hồi phải đi tới cùng).
 */
export function cancelEverywhere(services: ConversationCanceller[], conversationId: string, warn: (msg: string) => void): void {
  for (const s of services) {
    try {
      s.cancelConversation(conversationId)
    } catch (err) {
      warn(`Thu hồi: huỷ việc của cuộc ${conversationId} lỗi: ${String(err)}`)
    }
  }
}

/** Thẻ hoãn duyệt của lịch bị ảnh hưởng khi thu hồi một quyền. */
export type DeferredScope = { kind: 'changeset' } | { kind: 'draft'; service?: 'gmail' | 'telegram'; accountId?: string }

export type PrivacyDeps = {
  /** Cuộc của tài khoản hiện tại đang có thư mục. */
  foldersInUse(): PrivacyFolderGrant[]
  /** null = không phải cuộc của tài khoản này. */
  getConversation(id: string): { cwd: string | null; extraDirs?: { path: string }[] } | null
  /** Gỡ thư mục (kèm bỏ quyền sửa và mọi thư mục phụ). */
  clearFolder(conversationId: string): void
  /** Gỡ một thư mục phụ (D) — huỷ thẻ, dừng lượt, gỡ (`ExtraFolders.remove`). */
  removeExtraFolder?(conversationId: string, path: string): void
  /** Huỷ MỌI thẻ đang chờ của cuộc (sửa file, MCP, nháp, xin quyền, đề xuất lịch, lệnh) + dừng lệnh đang chạy. */
  cancelConversation(conversationId: string): void
  /** Dừng lượt trợ lý đang chạy của cuộc (CLI giữ quyền đọc thư mục tới hết lượt). */
  abortTurn(conversationId: string): void

  schedules(): Schedule[]
  getSchedule(id: string): Schedule | null
  setScheduleGrants(id: string, grants: ScheduleGrants): void
  /** Bỏ lịch khỏi hàng chờ + dừng lần đang chạy (lần chạy giữ quyền chốt lúc bắt đầu). */
  stopSchedule(id: string): void
  /** Thẻ hoãn duyệt còn chờ của lịch dựa trên quyền vừa thu hồi → "Đã thu hồi quyền". Trả số thẻ. */
  revokeDeferred(scheduleId: string, scope: DeferredScope): number
  gmailLabel(accountId: string): string | null

  status(): Omit<PrivacyStatus, 'folders' | 'schedules'>
  log: { info(msg: string): void }
}

/** Gom quyền đang cấp cho trang Quyền & riêng tư + thu hồi (thư mục theo cuộc, quyền từng lịch hẹn). */
export class PrivacyService {
  constructor(private readonly deps: PrivacyDeps) {}

  status(): PrivacyStatus {
    return { folders: this.deps.foldersInUse(), schedules: this.scheduleGrants(), ...this.deps.status() }
  }

  private scheduleGrants(): PrivacyScheduleGrant[] {
    return this.deps
      .schedules()
      .map((s) => {
        const g = s.grants
        const grants: PrivacyScheduleGrant['grants'] = []
        if (g.folder) grants.push({ key: 'folder', kind: 'folder', label: g.folder })
        if (g.folder && g.folderWrite) grants.push({ key: 'folderWrite', kind: 'folderWrite', label: g.folder })
        for (const id of g.gmailAccounts) grants.push({ key: `gmail:${id}`, kind: 'gmail', label: this.deps.gmailLabel(id) ?? id })
        if (g.telegram) grants.push({ key: 'telegram', kind: 'telegram', label: 'Telegram' })
        if (g.drafts) grants.push({ key: 'drafts', kind: 'drafts', label: '' })
        return { scheduleId: s.id, name: s.name, enabled: s.enabled, grants }
      })
      .filter((s) => s.grants.length > 0)
  }

  /**
   * Thu hồi thư mục của một cuộc: huỷ mọi thẻ đang chờ, dừng lệnh đang chạy và lượt trợ lý đang chạy (CLI đã nhận
   * quyền đọc cho cả lượt), rồi gỡ thư mục. Cuộc không phải của tài khoản này / không có thư mục → false.
   */
  revokeFolder(conversationId: string): boolean {
    const conv = this.deps.getConversation(conversationId)
    if (!conv?.cwd) return false
    this.deps.cancelConversation(conversationId)
    this.deps.abortTurn(conversationId)
    this.deps.clearFolder(conversationId)
    this.deps.log.info(`Quyền & riêng tư: thu hồi thư mục của cuộc ${conversationId}`)
    return true
  }

  /** Thu hồi một thư mục phụ (D) của cuộc. */
  revokeExtraFolder(conversationId: string, path: string): boolean {
    const conv = this.deps.getConversation(conversationId)
    if (!conv?.extraDirs?.some((e) => e.path === path) || !this.deps.removeExtraFolder) return false
    this.deps.removeExtraFolder(conversationId, path)
    this.deps.log.info(`Quyền & riêng tư: thu hồi một thư mục phụ của cuộc ${conversationId}`)
    return true
  }

  /**
   * Thu hồi một quyền của lịch: lưu quyền mới, dừng lần đang chạy của lịch (nó giữ quyền cũ tới hết lượt) và đóng các
   * thẻ hoãn duyệt còn chờ dựa trên quyền đó. Thu hồi `folder` mất luôn `folderWrite`.
   */
  revokeScheduleGrant(scheduleId: string, key: ScheduleGrantKey): Schedule | null {
    const s = this.deps.getSchedule(scheduleId)
    if (!s) return null
    const g = s.grants
    let next: ScheduleGrants
    let scope: DeferredScope[]
    if (key === 'folder') {
      next = { ...g, folder: null, folderWrite: false }
      scope = [{ kind: 'changeset' }]
    } else if (key === 'folderWrite') {
      next = { ...g, folderWrite: false }
      scope = [{ kind: 'changeset' }]
    } else if (key === 'telegram') {
      next = { ...g, telegram: false }
      scope = [{ kind: 'draft', service: 'telegram' }]
    } else if (key === 'drafts') {
      next = { ...g, drafts: false }
      scope = [{ kind: 'draft' }]
    } else {
      const id = key.slice('gmail:'.length)
      if (!g.gmailAccounts.includes(id)) return s
      next = { ...g, gmailAccounts: g.gmailAccounts.filter((a) => a !== id) }
      scope = [{ kind: 'draft', service: 'gmail', accountId: id }]
    }
    next = normalizeGrants(next)
    this.deps.setScheduleGrants(scheduleId, next)
    this.deps.stopSchedule(scheduleId)
    const closed = scope.reduce((n, sc) => n + this.deps.revokeDeferred(scheduleId, sc), 0)
    this.deps.log.info(`Quyền & riêng tư: thu hồi ${key.startsWith('gmail:') ? 'gmail' : key} của lịch ${scheduleId} (đóng ${closed} thẻ hoãn duyệt)`)
    return this.deps.getSchedule(scheduleId)
  }
}
