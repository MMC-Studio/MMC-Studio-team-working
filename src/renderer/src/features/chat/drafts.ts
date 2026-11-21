import { create } from 'zustand'
import { MAX_ATTACHMENT_UPLOAD_BYTES, MAX_ATTACHMENTS } from '@shared/schemas'
import type { Attachment, Message, PickAttachmentsResult } from '@shared/types'
import { api } from '@renderer/lib/api'

/**
 * Nháp tin nhắn THEO TỪNG CUỘC: chữ, tin đang trả lời (reply), file đính kèm. Khoá = id cuộc; cuộc mới chưa gửi =
 * "new"; cuộc mới trong dự án = "new:<id dự án>". Chuyển cuộc / chuyển trang → mỗi cuộc giữ nháp của mình.
 * Chữ + reply lưu trên máy theo tài khoản (localStorage — chỉ là chữ đang gõ dở của chính người này, không phải
 * dữ liệu dùng chung với main), ghi sau 500 ms không gõ; còn sau khi tắt app; quá 30 ngày tự bỏ. Đính kèm chỉ giữ
 * trong lúc app mở (file tạm ở main).
 */

export const DRAFT_SAVE_MS = 500
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const STORAGE_PREFIX = 'mmc.drafts.'
const REPLY_CONTENT_MAX = 2_000

export type DraftProblem = { name?: string; reason: string }

/** Phần lưu trên máy của một nháp. */
export type StoredDraft = { text: string; reply: Message | null; updatedAt: number }

export const newDraftKey = (projectId?: string | null): string => (projectId ? `new:${projectId}` : 'new')
const isNewKey = (key: string): boolean => key === 'new' || key.startsWith('new:')

/** Nháp có gì để giữ không (chữ hoặc đang trả lời một tin). */
const hasContent = (d: StoredDraft | undefined): d is StoredDraft => !!d && (d.text.trim().length > 0 || d.reply !== null)

/** Đọc từ máy: bỏ nháp hỏng / rỗng / quá 30 ngày. */
export function parseDrafts(raw: string | null, now: number): Record<string, StoredDraft> {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object') return {}
  const out: Record<string, StoredDraft> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const d = value as Partial<StoredDraft> | null
    if (!d || typeof d.text !== 'string' || typeof d.updatedAt !== 'number') continue
    if (now - d.updatedAt > DRAFT_MAX_AGE_MS) continue
    const reply = d.reply && typeof d.reply === 'object' && typeof (d.reply as Message).id === 'string' ? (d.reply as Message) : null
    const draft = { text: d.text, reply, updatedAt: d.updatedAt }
    if (hasContent(draft)) out[key] = draft
  }
  return out
}

/** Ghi lên máy: chỉ nháp có nội dung, chưa quá 30 ngày; tin đang trả lời cắt ngắn (chỉ để hiện khung "Đang trả lời"). */
export function serializeDrafts(drafts: Record<string, StoredDraft>, now: number): string {
  const out: Record<string, StoredDraft> = {}
  for (const [key, d] of Object.entries(drafts)) {
    if (!hasContent(d) || now - d.updatedAt > DRAFT_MAX_AGE_MS) continue
    out[key] = {
      text: d.text,
      reply: d.reply ? { ...d.reply, content: d.reply.content.slice(0, REPLY_CONTENT_MAX) } : null,
      updatedAt: d.updatedAt
    }
  }
  return JSON.stringify(out)
}

/** "Nháp: …" ở thanh bên — dòng đầu, cắt ngắn. */
export function draftPreview(text: string, max = 40): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

type DraftsState = {
  owner: string | null
  drafts: Record<string, StoredDraft>
  files: Record<string, Attachment[]>
  problems: Record<string, DraftProblem[]>
  busy: Record<string, boolean>
  /** Đổi tài khoản / mở app: đọc nháp của tài khoản này, bỏ nháp của cuộc không còn (`existing` = id các cuộc). */
  load(owner: string, existing: ReadonlySet<string>): void
  setText(key: string, text: string): void
  setReply(key: string, message: Message | null): void
  /** Gửi tin xong: xoá chữ + reply + đính kèm của khoá này. */
  clear(key: string): void
  /** Xoá cuộc → xoá nháp của cuộc đó. */
  remove(key: string): void
  addFiles(key: string, files: File[]): Promise<void>
  addFromClipboard(key: string): Promise<void>
  pick(key: string): Promise<void>
  removeFile(key: string, id: string): void
  /** Ghi ngay (trước khi đóng app). */
  flush(): void
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useDrafts = create<DraftsState>((set, get) => {
  const save = (): void => {
    timer = null
    const { owner, drafts } = get()
    if (!owner) return
    try {
      storage()?.setItem(STORAGE_PREFIX + owner, serializeDrafts(drafts, Date.now()))
    } catch {
      // Ổ đầy / bị chặn: nháp vẫn còn trong lúc app mở.
    }
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, DRAFT_SAVE_MS)
  }
  const patch = (key: string, p: Partial<StoredDraft>): void => {
    set((s) => {
      const prev = s.drafts[key] ?? { text: '', reply: null, updatedAt: 0 }
      return { drafts: { ...s.drafts, [key]: { ...prev, ...p, updatedAt: Date.now() } } }
    })
    schedule()
  }
  const files = (key: string): Attachment[] => get().files[key] ?? []
  const setFiles = (key: string, list: Attachment[], problems?: DraftProblem[]): void =>
    set((s) => ({
      files: { ...s.files, [key]: list },
      ...(problems ? { problems: { ...s.problems, [key]: problems } } : {})
    }))
  /** Ghép kết quả thêm file vào đúng khoá đã bắt đầu thao tác (người dùng có thể chuyển cuộc trong lúc chờ). */
  const merge = (key: string, res: PickAttachmentsResult, extra: DraftProblem[] = []): void => {
    const room = MAX_ATTACHMENTS - files(key).length
    const accepted = res.attachments.slice(0, Math.max(0, room))
    const problems: DraftProblem[] = [...extra, ...res.rejected]
    if (res.attachments.length > accepted.length) problems.push({ reason: 'too_many' })
    setFiles(key, [...files(key), ...accepted], problems)
  }
  const run = async (key: string, task: () => Promise<void>): Promise<void> => {
    set((s) => ({ busy: { ...s.busy, [key]: true } }))
    try {
      await task()
    } catch (err) {
      set((s) => ({ problems: { ...s.problems, [key]: [{ reason: (err as Error).message }] } }))
    } finally {
      set((s) => ({ busy: { ...s.busy, [key]: false } }))
    }
  }

  return {
    owner: null,
    drafts: {},
    files: {},
    problems: {},
    busy: {},

    load(owner, existing) {
      if (timer) save()
      let raw: string | null = null
      try {
        raw = storage()?.getItem(STORAGE_PREFIX + owner) ?? null
      } catch {
        raw = null
      }
      const all = parseDrafts(raw, Date.now())
      const drafts = Object.fromEntries(Object.entries(all).filter(([key]) => isNewKey(key) || existing.has(key)))
      set({ owner, drafts, files: {}, problems: {}, busy: {} })
      save()
    },

    setText: (key, text) => patch(key, { text }),
    setReply: (key, message) => patch(key, { reply: message }),

    clear(key) {
      set((s) => {
        const drafts = { ...s.drafts }
        delete drafts[key]
        return { drafts, files: { ...s.files, [key]: [] }, problems: { ...s.problems, [key]: [] } }
      })
      schedule()
    },

    remove(key) {
      get().clear(key)
    },

    async addFiles(key, list) {
      await run(key, async () => {
        const result: PickAttachmentsResult = { attachments: [], rejected: [] }
        const room = MAX_ATTACHMENTS - files(key).length
        const tooMany = list.length > room
        // Gửi từng file để mỗi lần truyền IPC có giới hạn; file quá lớn bị chặn trước khi đọc.
        for (const file of list.slice(0, Math.max(0, room))) {
          if (file.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
            result.rejected.push({ name: file.name, reason: 'too_large' })
            continue
          }
          const res = await api.chat.addFile(file.name || 'file', new Uint8Array(await file.arrayBuffer()))
          result.attachments.push(...res.attachments)
          result.rejected.push(...res.rejected)
        }
        merge(key, result, tooMany ? [{ reason: 'too_many' }] : [])
      })
    },
    async addFromClipboard(key) {
      await run(key, async () => merge(key, await api.chat.pasteClipboard()))
    },
    async pick(key) {
      await run(key, async () => merge(key, await api.chat.pickAttachments()))
    },
    removeFile: (key, id) => setFiles(key, files(key).filter((a) => a.id !== id), []),

    flush() {
      if (timer) {
        clearTimeout(timer)
        save()
      }
    }
  }
})

/** Ghi nháp ngay khi đóng / tải lại cửa sổ (đang trong 500 ms chờ). */
export function setupDraftsFlush(): () => void {
  const flush = (): void => useDrafts.getState().flush()
  window.addEventListener('beforeunload', flush)
  window.addEventListener('pagehide', flush)
  return () => {
    window.removeEventListener('beforeunload', flush)
    window.removeEventListener('pagehide', flush)
  }
}
