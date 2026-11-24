import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, ExtraFolder } from '@shared/types'
import { checkExtraFolder, ExtraFolders, mainOverlapsExtras, rootFor, systemZones, type FolderZones } from '../extraFolders'
import { openDatabase } from '../../db/client'
import { ConversationRepository, MessageRepository } from '../../db/repositories'
import { conversationExtraDirs } from '../../db/schema'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

/**
 * Máy giả trong thư mục tạm:
 *   base/Users/me            ← USERPROFILE (exact: cấm chính nó + thư mục cha, thư mục con được)
 *   base/Users/me/AppData    ← cấm trong + cha
 *   base/Windows, base/Program Files, base/ProgramData, base/appdata-of-app
 *   base/Users/me/Documents/proj (thư mục chính), …/lib, …/other (ứng viên thư mục phụ)
 */
let base: string
let zones: FolderZones
let home: string
let docs: string
let main: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mmc-extra-'))
  home = join(base, 'Users', 'me')
  docs = join(home, 'Documents')
  main = join(docs, 'proj')
  for (const d of [
    join(home, 'AppData', 'Roaming'),
    join(home, 'AppData', 'Local', 'x'),
    join(base, 'Windows', 'System32'),
    join(base, 'Program Files', 'App'),
    join(base, 'ProgramData'),
    join(base, 'appdata-of-app'),
    join(main, 'src'),
    join(docs, 'lib'),
    join(docs, 'other'),
    join(base, 'D', 'work')
  ])
    mkdirSync(d, { recursive: true })
  writeFileSync(join(docs, 'note.txt'), 'x')
  zones = systemZones(
    {
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      WINDIR: join(base, 'Windows'),
      ProgramFiles: join(base, 'Program Files'),
      ProgramData: join(base, 'ProgramData')
    },
    [join(base, 'appdata-of-app')]
  )
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const check = (candidate: string, others: string[] = []) => checkExtraFolder(candidate, { main, others, zones })

describe('(1) vùng cấm và MỌI thư mục cha của vùng cấm', () => {
  it('thư mục cha của thư mục người dùng (kiểu C:\\Users) và cha của nữa → extra_contains_system', async () => {
    expect(await check(join(base, 'Users'))).toBe('extra_contains_system')
    expect(await check(base)).toBe('extra_contains_system')
  })

  it('chính thư mục người dùng bị cấm, thư mục con của nó thì được', async () => {
    expect(await check(home)).toBe('extra_contains_system')
    expect(await check(join(docs, 'lib'))).toBeNull()
  })

  it('Documents chứa thư mục chính → chồng lấn, không phải vùng cấm', async () => {
    expect(await check(docs)).toBe('extra_overlap_main')
  })

  it('trong vùng cấm (AppData, Windows, Program Files, ProgramData, dữ liệu app) → extra_system', async () => {
    expect(await check(join(home, 'AppData'))).toBe('extra_system')
    expect(await check(join(home, 'AppData', 'Local', 'x'))).toBe('extra_system')
    expect(await check(join(base, 'Windows'))).toBe('extra_system')
    expect(await check(join(base, 'Windows', 'System32'))).toBe('extra_system')
    expect(await check(join(base, 'Program Files', 'App'))).toBe('extra_system')
    expect(await check(join(base, 'ProgramData'))).toBe('extra_system')
    expect(await check(join(base, 'appdata-of-app'))).toBe('extra_system')
  })

  it('không phân biệt hoa thường (Windows)', async () => {
    if (process.platform !== 'win32') return
    expect(await check(join(base, 'USERS'))).toBe('extra_contains_system')
    expect(await check(join(base, 'windows', 'system32'))).toBe('extra_system')
  })

  it('junction đặt ở chỗ hợp lệ nhưng trỏ vào vùng cấm / thư mục cha của vùng cấm → bị chặn theo đường dẫn thật', async () => {
    symlinkSync(join(base, 'Users'), join(docs, 'to-users'), 'junction')
    symlinkSync(join(base, 'Windows'), join(docs, 'to-windows'), 'junction')
    symlinkSync(home, join(docs, 'to-home'), 'junction')
    expect(await check(join(docs, 'to-users'))).toBe('extra_contains_system')
    expect(await check(join(docs, 'to-windows'))).toBe('extra_system')
    expect(await check(join(docs, 'to-home'))).toBe('extra_contains_system')
  })

  it('gốc ổ đĩa → extra_drive_root; không tồn tại / là file → extra_missing', async () => {
    expect(await check(parse(base).root)).toBe('extra_drive_root')
    expect(await check(join(base, 'khong-co'))).toBe('extra_missing')
    expect(await check(join(docs, 'note.txt'))).toBe('extra_missing')
  })

  it('vùng cấm lấy từ biến môi trường THẬT của máy: C:\\Users, thư mục người dùng, AppData đều bị chặn', async () => {
    if (process.platform !== 'win32' || !process.env.USERPROFILE) return
    const real = systemZones(process.env)
    const users = parse(process.env.USERPROFILE).dir // C:\Users
    const at = (p: string) => checkExtraFolder(p, { main: join(base, 'D', 'work'), others: [], zones: real })
    expect(await at(users)).toBe('extra_contains_system')
    expect(await at(process.env.USERPROFILE)).toBe('extra_contains_system')
    if (process.env.APPDATA) expect(await at(process.env.APPDATA)).toBe('extra_system')
    if (process.env.WINDIR) expect(await at(process.env.WINDIR)).toBe('extra_system')
    // Thư mục tạm của test nằm dưới AppData\Local\Temp trên Windows → cũng bị chặn.
    expect(await at(base)).toBe('extra_system')
  })
})

describe('(2) chồng lấn với thư mục chính / thư mục phụ khác', () => {
  it('trùng, nằm trong, chứa thư mục chính → extra_overlap_main', async () => {
    expect(await check(main)).toBe('extra_overlap_main')
    expect(await check(join(main, 'src'))).toBe('extra_overlap_main')
    expect(await check(docs)).toBe('extra_overlap_main')
  })

  it('junction trỏ vào thư mục chính → extra_overlap_main (so theo đường dẫn thật)', async () => {
    symlinkSync(main, join(docs, 'alias-main'), 'junction')
    expect(await check(join(docs, 'alias-main'))).toBe('extra_overlap_main')
  })

  it('trùng / chứa / nằm trong thư mục phụ khác → extra_overlap_extra; thư mục bên cạnh thì được', async () => {
    mkdirSync(join(docs, 'lib', 'sub'))
    expect(await check(join(docs, 'lib'), [join(docs, 'lib')])).toBe('extra_overlap_extra')
    expect(await check(join(docs, 'lib', 'sub'), [join(docs, 'lib')])).toBe('extra_overlap_extra')
    expect(await check(join(docs, 'lib'), [join(docs, 'lib', 'sub')])).toBe('extra_overlap_extra')
    expect(await check(join(docs, 'other'), [join(docs, 'lib')])).toBeNull()
  })

  it('đổi thư mục chính: trùng / nằm trong / chứa / junction tới thư mục phụ → chồng lấn', async () => {
    const lib = join(docs, 'lib')
    mkdirSync(join(lib, 'inner'))
    symlinkSync(lib, join(base, 'D', 'to-lib'), 'junction')
    expect(await mainOverlapsExtras(lib, [lib])).toBe(true)
    expect(await mainOverlapsExtras(join(lib, 'inner'), [lib])).toBe(true)
    expect(await mainOverlapsExtras(docs, [lib])).toBe(true)
    expect(await mainOverlapsExtras(join(base, 'D', 'to-lib'), [lib])).toBe(true)
    expect(await mainOverlapsExtras(join(base, 'D', 'work'), [lib])).toBe(false)
    expect(await mainOverlapsExtras(lib, [])).toBe(false)
  })
})

describe('rootFor — file thuộc thư mục nào', () => {
  const extras: ExtraFolder[] = [{ path: 'D:\\lib', write: true }]
  it('đường dẫn tuyệt đối trong thư mục phụ → thư mục phụ; tương đối → chỉ thư mục chính', () => {
    if (process.platform !== 'win32') return
    expect(rootFor('D:\\lib\\a.cs', { path: 'C:\\proj', write: false }, extras)).toEqual({ path: 'D:\\lib', write: true, extra: true })
    expect(rootFor('src\\a.cs', { path: 'C:\\proj', write: false }, extras)).toEqual({ path: 'C:\\proj', write: false, extra: false })
    expect(rootFor('E:\\x.txt', { path: 'C:\\proj', write: false }, extras)).toBeNull()
  })
})

describe('ExtraFolders + SQLite thật (thêm / gỡ / sửa / đổi thư mục chính / nhánh)', () => {
  let handle: ReturnType<typeof openDatabase>
  let convs: ConversationRepository
  let msgs: MessageRepository
  let svc: ExtraFolders<Conversation>
  const calls: string[] = []
  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    convs = new ConversationRepository(handle.db, () => 'u1')
    msgs = new MessageRepository(handle.db)
    calls.length = 0
    svc = new ExtraFolders<Conversation>({
      getConversation: (id) => convs.get(id),
      addExtraDir: (id, p) => convs.addExtraDir(id, p),
      removeExtraDir: (id, p) => convs.removeExtraDir(id, p),
      setExtraWrite: (id, p, w) => convs.setExtraWrite(id, p, w),
      zones,
      cancelConversation: (id) => calls.push(`cancel:${id}`),
      cancelEdits: (id) => calls.push(`edits:${id}`),
      abortTurn: (id) => calls.push(`abort:${id}`),
      log: { info: vi.fn() }
    })
  })
  afterEach(() => handle.close())

  const withMain = (): Conversation => convs.setCwd(convs.create('code').id, main)!

  it('chưa có thư mục chính → extra_no_main; thêm được tối đa 3, mặc định chỉ đọc', async () => {
    const bare = convs.create('free')
    await expect(svc.add(bare.id, join(docs, 'lib'))).rejects.toThrow('extra_no_main')
    const c = withMain()
    for (const n of ['a', 'b', 'c', 'd']) mkdirSync(join(base, 'D', n))
    await svc.add(c.id, join(base, 'D', 'a'))
    await svc.add(c.id, join(base, 'D', 'b'))
    const third = await svc.add(c.id, join(base, 'D', 'c'))
    expect(third.extraDirs.map((e) => e.write)).toEqual([false, false, false])
    await expect(svc.add(c.id, join(base, 'D', 'd'))).rejects.toThrow('extra_limit')
    // Repository cũng chốt 3 (đường khác vào thẳng repo).
    expect(() => convs.addExtraDir(c.id, join(base, 'D', 'd'))).toThrow('extra_limit')
  })

  it('thư mục bị cấm / chồng lấn → ném mã lỗi, không lưu gì', async () => {
    const c = withMain()
    await expect(svc.add(c.id, join(base, 'Users'))).rejects.toThrow('extra_contains_system')
    await expect(svc.add(c.id, join(main, 'src'))).rejects.toThrow('extra_overlap_main')
    expect(convs.get(c.id)!.extraDirs).toEqual([])
  })

  it('tick sửa riêng từng thư mục; bỏ tick → huỷ thẻ sửa file đang chờ', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    const p = convs.get(c.id)!.extraDirs[0].path
    expect(svc.setWrite(c.id, p, true).extraDirs[0].write).toBe(true)
    expect(calls).toEqual([])
    expect(svc.setWrite(c.id, p, false).extraDirs[0].write).toBe(false)
    expect(calls).toEqual([`edits:${c.id}`])
    expect(() => svc.setWrite(c.id, join(docs, 'other'), true)).toThrow('extra_not_found')
  })

  it('gỡ thư mục phụ = thu hồi: huỷ thẻ + dừng lượt rồi mới gỡ', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    const p = convs.get(c.id)!.extraDirs[0].path
    expect(svc.remove(c.id, p)!.extraDirs).toEqual([])
    expect(calls).toEqual([`cancel:${c.id}`, `abort:${c.id}`])
  })

  it('(2) đổi thư mục chính chồng lấn thư mục phụ → folder_overlaps_extra; không chồng → được, thư mục phụ giữ nguyên', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    await expect(svc.checkMainChange(c.id, join(docs, 'lib'))).rejects.toThrow('folder_overlaps_extra')
    await expect(svc.checkMainChange(c.id, docs)).rejects.toThrow('folder_overlaps_extra')
    await expect(svc.checkMainChange(c.id, join(base, 'D', 'work'))).resolves.toBeUndefined()
    expect(convs.setCwd(c.id, join(base, 'D', 'work'))!.extraDirs).toHaveLength(1)
  })

  it('gỡ / thu hồi thư mục chính → gỡ luôn mọi thư mục phụ', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    await svc.add(c.id, join(docs, 'other'))
    expect(convs.setCwd(c.id, null)!.extraDirs).toEqual([])
    expect(convs.withFolder()).toEqual([])
  })

  it('trang Quyền & riêng tư thấy thư mục phụ của từng cuộc', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    convs.setExtraWrite(c.id, convs.get(c.id)!.extraDirs[0].path, true)
    expect(convs.withFolder()).toEqual([{ conversationId: c.id, title: '', path: main, write: false, extras: [{ path: join(docs, 'lib'), write: true }] }])
  })

  it('tạo nhánh chép thư mục phụ (về chỉ đọc, giữ thứ tự); thư mục không còn hợp lệ bị bỏ khi kiểm lại', async () => {
    const c = withMain()
    mkdirSync(join(base, 'D', 'gone'))
    await svc.add(c.id, join(docs, 'other'))
    await svc.add(c.id, join(base, 'D', 'gone'))
    await svc.add(c.id, join(docs, 'lib'))
    convs.setExtraWrite(c.id, join(docs, 'lib'), true)
    const m = msgs.insert({ conversationId: c.id, role: 'user', content: 'x' })
    const fork = convs.fork(m.id)!
    expect(fork.extraDirs).toEqual([
      { path: join(docs, 'other'), write: false },
      { path: join(base, 'D', 'gone'), write: false },
      { path: join(docs, 'lib'), write: false }
    ])
    rmSync(join(base, 'D', 'gone'), { recursive: true })
    const checked = await svc.revalidate(fork.id)
    expect(checked!.extraDirs.map((e) => e.path)).toEqual([join(docs, 'other'), join(docs, 'lib')])
    // Cuộc gốc không bị đụng.
    expect(convs.get(c.id)!.extraDirs).toHaveLength(3)
  })

  it('xoá cuộc → xoá luôn thư mục phụ (không để dòng mồ côi)', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    convs.remove(c.id)
    expect(handle.db.select().from(conversationExtraDirs).all()).toEqual([])
  })

  it('tài khoản khác không thấy / không thêm được thư mục phụ vào cuộc của người khác', async () => {
    const c = withMain()
    await svc.add(c.id, join(docs, 'lib'))
    const other = new ConversationRepository(handle.db, () => 'u2')
    expect(other.get(c.id)).toBeNull()
    expect(other.addExtraDir(c.id, join(docs, 'other'))).toBeNull()
    expect(other.removeExtraDir(c.id, join(docs, 'lib'))).toBeNull()
    expect(convs.get(c.id)!.extraDirs).toHaveLength(1)
  })
})
