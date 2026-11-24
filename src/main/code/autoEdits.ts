import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  AUTO_EDIT_END_REASONS,
  AUTO_EDIT_MAX_FILES,
  AUTO_EDIT_SESSION_MS,
  AUTO_EDIT_UNDO_MS,
  type AutoEditEndReason,
  type AutoEditOffer,
  type AutoEditSession,
  type AutoEditUndoResult
} from '@shared/autoEdits'
import type { RecordAction } from '../audit/actionLog'
import { otherLineEnding, type InspectedChange } from './change'
import { realRelative } from './paths'
import { askAlwaysReason } from './projectProfile'

/** Một file trong phiên (lưu trong session.json). Bản gốc nằm cạnh, tên `<blob>`. */
type StoredFile = {
  path: string
  /** Khoá so sánh (chữ thường — Windows không phân biệt hoa thường). */
  key: string
  /** Khoá của đường dẫn THẬT lúc sửa — lúc hoàn tác khác đi (junction cài thêm) → không ghi. */
  realKey: string
  isNewFile: boolean
  /** File bản gốc trong thư mục phiên; null = file mới (không có bản gốc). */
  blob: string | null
  originalSize: number
  originalHash: string | null
  /** Hash nội dung app dự tính sau lần tự duyệt cuối — khác lúc hoàn tác = file bị sửa thêm (xung đột). */
  expectedHash: string
  /** Cùng nội dung nhưng kiểu xuống dòng kia (LF ↔ CRLF) — CLI ghi theo kiểu xuống dòng của file, có thể khác bản app tính. */
  altHash?: string
  at: number
  edits: number
  /** Đã hoàn tác. */
  done: boolean
}

type Stored = {
  v: 1
  id: string
  owner: string
  conversationId: string
  root: string
  startedAt: number
  endsAt: number
  endedAt: number | null
  endReason: AutoEditEndReason | null
  /** Lần ghi cuối — app crash (phiên chưa kết thúc lúc mở lại) thì coi như kết thúc lúc này. */
  updatedAt: number
  /** Khoá mọi file đã tính vào giới hạn 50 (kể cả đã hoàn tác). */
  counted: string[]
  files: StoredFile[]
}

export type AutoEditsDeps = {
  /** Thư mục giữ phiên + bản gốc (`%APPDATA%/Team Working/auto-edits`). */
  dir: string
  getOwner(): string
  now?(): number
  /** Tên cuộc (null = cuộc đã xoá / không thuộc tài khoản này). */
  title(conversationId: string): string | null
  /** Báo giao diện (sync `autoEdits`). */
  changed(): void
  record?: RecordAction
  log: { warn(msg: string): void; info(msg: string): void }
}

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
const keyOf = (rel: string): string => rel.toLowerCase()

/**
 * Phiên tự duyệt sửa file (PR C). Mỗi cuộc tối đa một phiên đang chạy; phiên đã kết thúc còn giữ bản gốc tới 7 ngày để
 * hoàn tác. Mọi thứ ghi ra đĩa trước khi cho phép sửa → tắt app / crash không mất khả năng hoàn tác.
 */
export class AutoEdits {
  private sessions = new Map<string, Stored>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly now: () => number

  constructor(private readonly deps: AutoEditsDeps) {
    this.now = deps.now ?? Date.now
  }

  /**
   * Lúc mở app: nạp phiên trên đĩa. Phiên còn "đang chạy" (app đã đóng / crash) → kết thúc (`app_closed`, lúc ghi cuối).
   * Phiên quá 7 ngày sau khi kết thúc / không còn file nào → xoá cả bản gốc.
   */
  async load(): Promise<void> {
    let names: string[] = []
    try {
      names = await readdir(this.deps.dir)
    } catch {
      return
    }
    for (const name of names) {
      const folder = join(this.deps.dir, name)
      let s: Stored
      try {
        s = JSON.parse(await readFile(join(folder, 'session.json'), 'utf8')) as Stored
        if (s.v !== 1 || s.id !== name || !Array.isArray(s.files)) throw new Error('sai định dạng')
      } catch (err) {
        this.deps.log.warn(`Tự duyệt: bỏ phiên hỏng ${name}: ${String(err)}`)
        await rm(folder, { recursive: true, force: true }).catch(() => {})
        continue
      }
      if (s.endedAt === null) {
        s.endedAt = Math.min(s.updatedAt, s.endsAt)
        s.endReason = 'app_closed'
        await this.persist(s).catch(() => {})
      }
      if (this.expired(s)) {
        await rm(folder, { recursive: true, force: true }).catch(() => {})
        continue
      }
      this.sessions.set(s.id, s)
    }
    this.deps.changed()
  }

  private expired(s: Stored): boolean {
    return s.endedAt !== null && (s.endedAt + AUTO_EDIT_UNDO_MS <= this.now() || s.files.every((f) => f.done))
  }

  private folder(s: Stored): string {
    return join(this.deps.dir, s.id)
  }

  /** Ghi session.json (ghi file tạm rồi đổi tên — không bao giờ để lại file nửa vời). */
  private async persist(s: Stored): Promise<void> {
    s.updatedAt = this.now()
    await mkdir(this.folder(s), { recursive: true })
    const target = join(this.folder(s), 'session.json')
    const tmp = `${target}.${randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify(s), 'utf8')
    await rename(tmp, target)
  }

  /** Phiên đang chạy của cuộc (tài khoản hiện tại); hết 2 giờ → kết thúc ngay tại đây. */
  activeSession(conversationId: string): Stored | null {
    for (const s of this.sessions.values()) {
      if (s.endedAt !== null || s.conversationId !== conversationId || s.owner !== this.deps.getOwner()) continue
      if (this.now() >= s.endsAt) {
        void this.finish(s, 'expired')
        return null
      }
      return s
    }
    return null
  }

  isActive(conversationId: string): boolean {
    return this.activeSession(conversationId) !== null
  }

  /**
   * Lần sửa này có được tự duyệt không (dùng cả để quyết định hiện nút trên thẻ). Thứ tự: file nguy hiểm → quá lớn →
   * hard link → ngắn hơn ½ bản gốc đầu phiên → đủ 50 file.
   */
  offer(conversationId: string, change: InspectedChange): AutoEditOffer {
    const session = this.activeSession(conversationId)
    const sessionActive = session !== null
    const risky = askAlwaysReason(change.profile, change.path) ?? askAlwaysReason(change.profile, change.realPath)
    if (risky) return { offer: false, reason: 'risky', detail: risky, sessionActive }
    if (change.tooLarge) return { offer: false, reason: 'too_large', sessionActive }
    if (change.links > 1) return { offer: false, reason: 'hard_link', sessionActive }
    const known = session?.files.find((f) => f.key === keyOf(change.path) && !f.done)
    // Bản gốc đầu phiên (file đã sửa trong phiên) — không phải lần sửa trước; file mới trong phiên = 0 byte.
    const originalSize = known ? known.originalSize : (change.before?.length ?? 0)
    if (originalSize > 0 && Buffer.byteLength(change.after, 'utf8') * 2 < originalSize)
      return { offer: false, reason: 'shrink', sessionActive }
    if (session && !session.counted.includes(keyOf(change.path)) && session.counted.length >= AUTO_EDIT_MAX_FILES)
      return { offer: false, reason: 'limit', sessionActive }
    return { offer: true }
  }

  /** File ở thư mục phụ (D): không bao giờ tự duyệt — thẻ không có nút, phiên đang chạy thì ghi lý do vì sao vẫn hỏi. */
  extraOffer(conversationId: string): AutoEditOffer {
    return { offer: false, reason: 'extra_folder', sessionActive: this.activeSession(conversationId) !== null }
  }

  /**
   * Cuộc đang có phiên + lần sửa đủ điều kiện → giữ bản gốc (lần đầu) rồi trả true (app cho phép không hỏi). Thư mục
   * của cuộc đã đổi → kết thúc phiên. Lỗi ghi bản gốc → false (hiện thẻ như thường, không bao giờ sửa khi chưa có bản gốc).
   */
  async tryAuto(conversationId: string, root: string, change: InspectedChange): Promise<boolean> {
    const session = this.activeSession(conversationId)
    if (!session) return false
    if (resolve(session.root) !== resolve(root)) {
      await this.finish(session, 'folder')
      return false
    }
    if (!this.offer(conversationId, change).offer) return false
    return this.register(session, change)
  }

  /** Người dùng bấm "Đồng ý, và không hỏi lại" trên thẻ: mở phiên (hoặc dùng phiên đang chạy) + ghi lần sửa này. */
  async start(conversationId: string, root: string, change: InspectedChange): Promise<boolean> {
    let session = this.activeSession(conversationId)
    if (session && resolve(session.root) !== resolve(root)) {
      await this.finish(session, 'folder')
      session = null
    }
    if (!this.offer(conversationId, change).offer) return false
    if (!session) {
      const now = this.now()
      session = {
        v: 1,
        id: randomUUID(),
        owner: this.deps.getOwner(),
        conversationId,
        root,
        startedAt: now,
        endsAt: now + AUTO_EDIT_SESSION_MS,
        endedAt: null,
        endReason: null,
        updatedAt: now,
        counted: [],
        files: []
      }
      try {
        await this.persist(session)
      } catch (err) {
        this.deps.log.warn(`Tự duyệt: không tạo được phiên: ${String(err)}`)
        return false
      }
      this.sessions.set(session.id, session)
      this.arm(session)
      this.deps.log.info(`Bật tự duyệt sửa file cho cuộc ${conversationId}`)
    }
    return this.register(session, change)
  }

  /** Báo giao diện khi hết 2 giờ (trạng thái vẫn kiểm lại ở mỗi lần sửa — bộ hẹn giờ chỉ để giao diện đổi đúng lúc). */
  private arm(s: Stored): void {
    const t = setTimeout(() => void this.finish(s, 'expired'), Math.max(0, s.endsAt - this.now()))
    t.unref?.()
    this.timers.set(s.id, t)
  }

  private async register(s: Stored, change: InspectedChange): Promise<boolean> {
    const key = keyOf(change.path)
    const at = this.now()
    const expectedHash = sha(Buffer.from(change.after, 'utf8'))
    const altHash = sha(Buffer.from(otherLineEnding(change.after), 'utf8'))
    let file = s.files.find((f) => f.key === key && !f.done)
    const isFirst = !file
    const newlyCounted = !s.counted.includes(key)
    if (!file) {
      // Giữ chỗ ngay (đồng bộ) để hai lần sửa song song không cùng vượt giới hạn 50.
      if (newlyCounted) s.counted.push(key)
      file = {
        path: change.path,
        key,
        realKey: keyOf(change.realPath),
        isNewFile: change.before === null,
        blob: change.before === null ? null : `${s.files.length}-${randomUUID()}.orig`,
        originalSize: change.before?.length ?? 0,
        originalHash: change.before === null ? null : sha(change.before),
        expectedHash,
        altHash,
        at,
        edits: 1,
        done: false
      }
      s.files.push(file)
    } else {
      file.expectedHash = expectedHash
      file.altHash = altHash
      file.at = at
      file.edits++
    }
    try {
      if (isFirst && file.blob && change.before) await writeFile(join(this.folder(s), file.blob), change.before)
      await this.persist(s)
    } catch (err) {
      this.deps.log.warn(`Tự duyệt: không giữ được bản gốc ${change.path}: ${String(err)}`)
      if (isFirst) {
        s.files = s.files.filter((f) => f !== file)
        if (newlyCounted) s.counted = s.counted.filter((k) => k !== key)
      }
      return false
    }
    this.deps.changed()
    return true
  }

  /** Kết thúc phiên đang chạy của cuộc (bấm Tắt, bỏ quyền sửa, gỡ / đổi thư mục…). Bản gốc vẫn giữ để hoàn tác. */
  async end(conversationId: string, reason: AutoEditEndReason): Promise<void> {
    for (const s of [...this.sessions.values()])
      if (s.endedAt === null && s.conversationId === conversationId) await this.finish(s, reason)
  }

  /** Ctrl+Alt+Q / đóng app: kết thúc mọi phiên của mọi tài khoản. */
  async endAll(reason: AutoEditEndReason): Promise<void> {
    for (const s of [...this.sessions.values()]) if (s.endedAt === null) await this.finish(s, reason)
  }

  private async finish(s: Stored, reason: AutoEditEndReason): Promise<void> {
    if (s.endedAt !== null) return
    if (!AUTO_EDIT_END_REASONS.includes(reason)) reason = 'stopped'
    s.endedAt = Math.min(this.now(), s.endsAt)
    s.endReason = reason
    clearTimeout(this.timers.get(s.id))
    this.timers.delete(s.id)
    this.deps.log.info(`Kết thúc tự duyệt sửa file (${reason}) cho cuộc ${s.conversationId}`)
    if (s.files.every((f) => f.done)) await this.drop(s)
    else await this.persist(s).catch((err) => this.deps.log.warn(`Tự duyệt: không ghi được phiên: ${String(err)}`))
    this.deps.changed()
  }

  private async drop(s: Stored): Promise<void> {
    this.sessions.delete(s.id)
    clearTimeout(this.timers.get(s.id))
    this.timers.delete(s.id)
    await rm(this.folder(s), { recursive: true, force: true }).catch((err) =>
      this.deps.log.warn(`Tự duyệt: không xoá được bản gốc: ${String(err)}`)
    )
  }

  private view(s: Stored): AutoEditSession {
    return {
      id: s.id,
      conversationId: s.conversationId,
      title: this.deps.title(s.conversationId),
      root: s.root,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      endedAt: s.endedAt,
      endReason: s.endReason,
      undoUntil: s.endedAt === null ? null : s.endedAt + AUTO_EDIT_UNDO_MS,
      files: s.files.filter((f) => !f.done).map((f) => ({ path: f.path, isNewFile: f.isNewFile, at: f.at, edits: f.edits })),
      counted: s.counted.length
    }
  }

  /** Phiên của tài khoản hiện tại: đang chạy, hoặc đã kết thúc mà còn file hoàn tác được (mới nhất trước). */
  list(conversationId?: string): AutoEditSession[] {
    const out: AutoEditSession[] = []
    for (const s of this.sessions.values()) {
      if (s.owner !== this.deps.getOwner()) continue
      if (conversationId && s.conversationId !== conversationId) continue
      if (s.endedAt === null && this.now() >= s.endsAt) void this.finish(s, 'expired')
      if (s.endedAt !== null && this.expired(s)) continue
      out.push(this.view(s))
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }

  private own(sessionId: string): Stored | null {
    const s = this.sessions.get(sessionId)
    return s && s.owner === this.deps.getOwner() ? s : null
  }

  sessionConversation(sessionId: string): string | null {
    return this.own(sessionId)?.conversationId ?? null
  }

  /** Bấm Tắt trên băng / Thu hồi ở Quyền & riêng tư. */
  async stop(sessionId: string): Promise<boolean> {
    const s = this.own(sessionId)
    if (!s || s.endedAt !== null) return false
    await this.finish(s, 'stopped')
    return true
  }

  /** Bấm "Xong" trên phiên đã kết thúc: bỏ bản gốc (không hoàn tác được nữa). */
  async dismiss(sessionId: string): Promise<boolean> {
    const s = this.own(sessionId)
    if (!s || s.endedAt === null) return false
    await this.drop(s)
    this.deps.changed()
    return true
  }

  /**
   * Hoàn tác tất cả (phiên đang chạy thì kết thúc trước — người gọi dừng lượt trợ lý trước khi gọi). Mỗi file: nội dung
   * hiện tại là bản app đã duyệt (hoặc vẫn là bản gốc) → khôi phục bản gốc / xoá file trợ lý tạo; bị sửa thêm → xung đột,
   * KHÔNG ghi đè trừ khi nằm trong `overwrite`. Kiểm lại đường dẫn thật + hard link ngay trước khi ghi.
   */
  async undo(sessionId: string, overwrite: string[] = []): Promise<AutoEditUndoResult | null> {
    const s = this.own(sessionId)
    if (!s) return null
    if (s.endedAt === null) await this.finish(s, 'undo')
    const force = new Set(overwrite.map(keyOf))
    const result: AutoEditUndoResult = { restored: [], conflicts: [], failed: [] }
    for (const f of s.files) {
      if (f.done) continue
      const outcome = await this.undoFile(s, f, force.has(f.key))
      if (outcome === 'restored') {
        f.done = true
        result.restored.push(f.path)
        if (f.blob) await rm(join(this.folder(s), f.blob), { force: true }).catch(() => {})
        this.record(s, f.path)
      } else if (outcome === 'conflict') result.conflicts.push(f.path)
      else result.failed.push({ path: f.path, reason: outcome })
    }
    if (s.files.every((f) => f.done)) await this.drop(s)
    else await this.persist(s).catch((err) => this.deps.log.warn(`Tự duyệt: không ghi được phiên: ${String(err)}`))
    this.deps.changed()
    return result
  }

  private record(s: Stored, path: string): void {
    try {
      this.deps.record?.({ conversationId: s.conversationId, kind: 'file_edit', target: path, decision: 'undone' })
    } catch (err) {
      this.deps.log.warn(`Ghi nhật ký hoàn tác lỗi: ${String(err)}`)
    }
  }

  private async undoFile(s: Stored, f: StoredFile, force: boolean): Promise<'restored' | 'conflict' | 'link_outside' | 'hard_link' | 'io'> {
    const abs = resolve(s.root, f.path)
    // Junction / symlink cài vào sau khi sửa → không ghi ra ngoài thư mục.
    const real = await realRelative(s.root, abs)
    if (real === null || keyOf(real) !== f.realKey) return 'link_outside'
    let current: Buffer | null = null
    try {
      const info = await stat(abs)
      if (!info.isFile()) return 'io'
      if (info.nlink > 1) return 'hard_link'
      current = await readFile(abs)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return 'io'
    }
    const currentHash = current ? sha(current) : null
    const untouched = currentHash === f.expectedHash || currentHash === f.altHash || currentHash === f.originalHash
    if (!untouched && !force) return 'conflict'
    try {
      if (f.isNewFile) {
        if (current) await rm(abs, { force: true })
      } else if (currentHash !== f.originalHash) {
        const original = await readFile(join(this.folder(s), f.blob!))
        if (sha(original) !== f.originalHash) return 'io'
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, original)
      }
      return 'restored'
    } catch (err) {
      this.deps.log.warn(`Tự duyệt: hoàn tác ${f.path} lỗi: ${String(err)}`)
      return 'io'
    }
  }
}
