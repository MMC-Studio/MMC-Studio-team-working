import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { MAX_EXTRA_DIRS, type ExtraFolder } from '@shared/types'
import { insideProject } from './paths'

/**
 * Thư mục phụ (D): kiểm thư mục người dùng chọn trước khi gắn vào cuộc, và tìm thư mục (chính / phụ) chứa một file.
 * Mọi phép so đều làm trên cả đường dẫn chữ lẫn đường dẫn thật (junction / symlink) — một junction đặt trong Documents
 * trỏ vào C:\Windows vẫn là C:\Windows.
 */

export type ExtraFolderError =
  /** Không tồn tại / không phải thư mục / không đọc được đường dẫn thật. */
  | 'extra_missing'
  /** Gốc ổ đĩa (C:\, D:\, \\server\share\). */
  | 'extra_drive_root'
  /** Nằm trong (hoặc chính là) vùng cấm: AppData, Windows, Program Files, ProgramData, dữ liệu của app. */
  | 'extra_system'
  /** CHỨA một vùng cấm hoặc thư mục người dùng (vd C:\Users, C:\Users\<tên>). */
  | 'extra_contains_system'
  /** Nằm trong / chứa / trùng thư mục chính. */
  | 'extra_overlap_main'
  /** Nằm trong / chứa / trùng một thư mục phụ khác. */
  | 'extra_overlap_extra'

/**
 * Vùng cấm. `inside`: cấm chính nó, mọi thư mục con VÀ mọi thư mục cha. `exact`: cấm chính nó và mọi thư mục cha
 * (thư mục con được phép — vd thư mục người dùng: cấm `C:\Users\<tên>` nhưng `…\Documents\proj` được).
 */
export type FolderZones = { inside: string[]; exact: string[] }

type Env = Record<string, string | undefined>

/** Vùng cấm lấy từ biến môi trường của Windows + thư mục dữ liệu của app — không viết cứng ổ C:. */
export function systemZones(env: Env, extraInside: string[] = []): FolderZones {
  const pick = (...keys: string[]): string[] => keys.map((k) => env[k]).filter((v): v is string => !!v && isAbsolute(v))
  const home = pick('USERPROFILE')
  return {
    inside: [
      ...pick('APPDATA', 'LOCALAPPDATA', 'WINDIR', 'SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'ALLUSERSPROFILE'),
      ...home.map((h) => join(h, 'AppData')),
      ...extraInside
    ],
    exact: home
  }
}

/** `a` nằm trong hoặc chính là `b` (Windows: không phân biệt hoa thường — `path.relative` đã lo). */
export function within(a: string, b: string): boolean {
  const rel = relative(resolve(b), resolve(a))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && !/^[a-zA-Z]:/.test(rel))
}

const isRoot = (p: string): boolean => dirname(resolve(p)) === resolve(p)

/** Đường dẫn thật (không tồn tại → chính nó, để vùng cấm không có trên máy này vẫn so được theo chữ). */
async function real(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch {
    return resolve(p)
  }
}

/** Cả dạng chữ lẫn dạng thật của một danh sách đường dẫn (bỏ trùng). */
async function bothForms(paths: string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const p of paths) {
    out.add(resolve(p))
    out.add(await real(p))
  }
  return [...out]
}

/** Hai thư mục chồng lấn: trùng, hoặc cái này nằm trong cái kia. */
const overlaps = (a: string, b: string): boolean => within(a, b) || within(b, a)

/**
 * Thư mục có được làm thư mục phụ không (bỏ qua giới hạn 3 — repository chốt). Thứ tự lỗi: không tồn tại → gốc ổ đĩa →
 * trong vùng cấm → chứa vùng cấm → chồng thư mục chính → chồng thư mục phụ khác.
 */
export async function checkExtraFolder(
  candidate: string,
  ctx: { main: string; others: string[]; zones: FolderZones }
): Promise<ExtraFolderError | null> {
  let realCandidate: string
  try {
    realCandidate = await realpath(candidate)
    if (!(await stat(realCandidate)).isDirectory()) return 'extra_missing'
  } catch {
    return 'extra_missing'
  }
  const forms = [...new Set([resolve(candidate), realCandidate])]
  if (forms.some(isRoot)) return 'extra_drive_root'
  const inside = await bothForms(ctx.zones.inside)
  const exact = await bothForms(ctx.zones.exact)
  if (forms.some((f) => inside.some((z) => within(f, z)))) return 'extra_system'
  if (forms.some((f) => [...inside, ...exact].some((z) => within(z, f)))) return 'extra_contains_system'
  const main = await bothForms([ctx.main])
  if (forms.some((f) => main.some((m) => overlaps(f, m)))) return 'extra_overlap_main'
  const others = await bothForms(ctx.others)
  if (forms.some((f) => others.some((o) => overlaps(f, o)))) return 'extra_overlap_extra'
  return null
}

/** Thư mục chính MỚI có chồng lấn thư mục phụ đang có không (đổi thư mục chính). */
export async function mainOverlapsExtras(main: string, extras: string[]): Promise<boolean> {
  if (extras.length === 0) return false
  const forms = await bothForms([main])
  const others = await bothForms(extras)
  return forms.some((f) => others.some((o) => overlaps(f, o)))
}

/** Thư mục được dùng để sửa một file: thư mục chính, hoặc một thư mục phụ (kèm quyền sửa riêng). */
export type EditRoot = { path: string; write: boolean; extra: boolean }

/**
 * Thư mục (chính trước, rồi thư mục phụ) chứa `file` theo CHỮ. Thư mục không chồng lấn nhau nên nhiều nhất một thư
 * mục khớp. Không thư mục nào chứa → null. Kiểm đường dẫn thật làm ở \`inspectChange\` với đúng thư mục này.
 */
export function rootFor(file: string, main: { path: string; write: boolean } | null, extras: ExtraFolder[]): EditRoot | null {
  const roots: EditRoot[] = [
    ...(main ? [{ path: main.path, write: main.write, extra: false }] : []),
    ...extras.map((e) => ({ path: e.path, write: e.write, extra: true }))
  ]
  // Đường dẫn tương đối chỉ có nghĩa với thư mục chính (CLI chạy với cwd = thư mục chính).
  if (!isAbsolute(file)) return roots.find((r) => !r.extra && insideProject(r.path, file) !== null) ?? null
  return roots.find((r) => insideProject(r.path, file) !== null) ?? null
}


type Conv = { id: string; cwd: string | null; extraDirs: ExtraFolder[] }

export type ExtraFoldersDeps<C extends Conv> = {
  getConversation(id: string): C | null
  addExtraDir(id: string, path: string): C | null
  removeExtraDir(id: string, path: string): C | null
  setExtraWrite(id: string, path: string, write: boolean): C | null
  zones: FolderZones
  /** Huỷ MỌI thẻ đang chờ của cuộc (sửa file, MCP, nháp, xin quyền, đề xuất lịch, lệnh) + dừng lệnh đang chạy. */
  cancelConversation(id: string): void
  /** Huỷ thẻ sửa file đang chờ của cuộc (bỏ tick sửa). */
  cancelEdits(id: string): void
  /** Dừng lượt trợ lý đang chạy (CLI nhận \`--add-dir\` cho cả lượt). */
  abortTurn(id: string): void
  log: { info(msg: string): void }
}

/** Mọi thao tác với thư mục phụ (D) đi qua đây — IPC thanh thư mục, thẻ trợ lý xin quyền, trang Quyền & riêng tư, nhánh. */
export class ExtraFolders<C extends Conv> {
  constructor(private readonly deps: ExtraFoldersDeps<C>) {}

  private conv(id: string): C {
    const c = this.deps.getConversation(id)
    if (!c) throw new Error('conversation_not_found')
    return c
  }

  /** Kiểm rồi gắn (chỉ đọc). Lỗi → Error có mã (\`extra_*\`). */
  async add(conversationId: string, path: string): Promise<C> {
    const c = this.conv(conversationId)
    if (!c.cwd) throw new Error('extra_no_main')
    if (c.extraDirs.length >= MAX_EXTRA_DIRS) throw new Error('extra_limit')
    const err = await checkExtraFolder(path, { main: c.cwd, others: c.extraDirs.map((e) => e.path), zones: this.deps.zones })
    if (err) throw new Error(err)
    // Hộp chọn thư mục mở lâu: thư mục chính có thể vừa đổi / gỡ trong lúc đó.
    const now = this.conv(conversationId)
    if (now.cwd !== c.cwd) throw new Error('extra_no_main')
    const updated = this.deps.addExtraDir(conversationId, resolve(path))
    if (!updated) throw new Error('extra_no_main')
    this.deps.log.info(`Thêm thư mục phụ (chỉ đọc) cho hội thoại ${conversationId}`)
    return updated
  }

  /** Gỡ = thu hồi: huỷ thẻ đang chờ, dừng lượt đang chạy (CLI giữ quyền đọc tới hết lượt), rồi gỡ. */
  remove(conversationId: string, path: string): C | null {
    const c = this.deps.getConversation(conversationId)
    if (!c) return null
    if (!c.extraDirs.some((e) => e.path === path)) return c
    this.deps.cancelConversation(conversationId)
    this.deps.abortTurn(conversationId)
    this.deps.log.info(`Gỡ thư mục phụ của hội thoại ${conversationId}`)
    return this.deps.removeExtraDir(conversationId, path)
  }

  /** Tick / bỏ tick "Cho phép sửa" của một thư mục phụ. Bỏ tick → huỷ thẻ sửa file đang chờ. */
  setWrite(conversationId: string, path: string, enabled: boolean): C {
    const c = this.conv(conversationId)
    if (!c.extraDirs.some((e) => e.path === path)) throw new Error('extra_not_found')
    if (!enabled) this.deps.cancelEdits(conversationId)
    return this.deps.setExtraWrite(conversationId, path, enabled) ?? c
  }

  /** Đổi thư mục chính: thư mục mới không được chồng lấn thư mục phụ đang có (người dùng gỡ thư mục phụ đó trước). */
  async checkMainChange(conversationId: string, newMain: string): Promise<void> {
    const c = this.deps.getConversation(conversationId)
    if (c && (await mainOverlapsExtras(newMain, c.extraDirs.map((e) => e.path)))) throw new Error('folder_overlaps_extra')
  }

  /**
   * Nhánh vừa tạo đã chép thư mục phụ (chỉ đọc): kiểm lại từng thư mục (còn tồn tại, không bị cấm, không chồng lấn) —
   * máy / thư mục có thể đã đổi từ lúc thêm. Thư mục không đạt bị bỏ khỏi nhánh.
   */
  async revalidate(conversationId: string): Promise<C | null> {
    let c = this.deps.getConversation(conversationId)
    const main = c?.cwd
    if (!c || !main) return c
    const kept: string[] = []
    for (const e of c.extraDirs) {
      const err = await checkExtraFolder(e.path, { main, others: kept, zones: this.deps.zones })
      if (err) c = this.deps.removeExtraDir(conversationId, e.path) ?? c
      else kept.push(e.path)
    }
    return c
  }
}
