import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_FILE_MAX_BYTES, PROJECT_MAX_FILES } from '@shared/projects'
import { openDatabase } from '../../db/client'
import { ConversationRepository, MessageRepository } from '../../db/repositories'
import { memories, memorySuggestions } from '../../db/schema'
import { ProjectRepository } from '../repository'
import { ProjectService, readContextFile } from '../service'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

describe('dự án (SQLite in-memory)', () => {
  let handle: ReturnType<typeof openDatabase>
  let owner: string
  let repo: ProjectRepository
  let convs: ConversationRepository
  let service: ProjectService
  let dir: string

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    owner = 'u1'
    repo = new ProjectRepository(handle.db, () => owner)
    convs = new ConversationRepository(handle.db, () => owner)
    service = new ProjectService({ repo, projectOf: (id) => convs.get(id)?.projectId ?? null })
    dir = mkdtempSync(join(tmpdir(), 'mmc-project-files-'))
  })
  afterEach(() => {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const file = (name: string, content: string | Buffer): string => {
    const path = join(dir, name)
    writeFileSync(path, content)
    return path
  }

  it('tạo / sửa / ghim; ghim xếp đầu; ghim không đổi "mới sửa"', () => {
    const a = repo.create({ name: 'Game Pixel', description: 'Unity 2D' })
    const b = repo.create({ name: 'Ôn thi', description: '' })
    const before = repo.get(a.id)!.updatedAt
    expect(repo.update({ id: a.id, pinned: true })!.updatedAt).toBe(before)
    expect(repo.list().map((p) => p.name)).toEqual(['Game Pixel', 'Ôn thi'])
    expect(repo.update({ id: b.id, instructions: 'Trả lời ngắn' })).toMatchObject({ instructions: 'Trả lời ngắn' })
    expect(repo.get(b.id)!.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('theo tài khoản: không thấy / sửa / xoá / tạo cuộc trong dự án của người khác', () => {
    const p = repo.create({ name: 'Riêng', description: '' })
    owner = 'u2'
    expect(repo.list()).toEqual([])
    expect(repo.get(p.id)).toBeNull()
    expect(repo.update({ id: p.id, name: 'x' })).toBeNull()
    expect(repo.remove(p.id)).toBe(false)
    expect(convs.createInProject('free', p.id)).toBeNull()
    expect(repo.files(p.id)).toEqual([])
  })

  it('cuộc trò chuyện trong dự án; nhánh giữ dự án', () => {
    const p = repo.create({ name: 'Game', description: '' })
    const c = convs.createInProject('code', p.id)!
    expect(c.projectId).toBe(p.id)
    const msgs = new MessageRepository(handle.db)
    const m = msgs.insert({ conversationId: c.id, role: 'user', content: 'xin chào' })
    expect(convs.fork(m.id)!.projectId).toBe(p.id)
  })

  it('xoá dự án: hộp xác nhận đếm đúng; file + trí nhớ dự án mất, cuộc trò chuyện còn (thành cuộc thường)', async () => {
    const p = repo.create({ name: 'Game', description: '' })
    const c = convs.createInProject('free', p.id)!
    await service.addFiles(p.id, [file('a.md', '# A'), file('b.txt', 'B')])
    handle.db.insert(memories).values({ id: crypto.randomUUID(), owner, content: 'dùng URP', projectId: p.id }).run()
    handle.db.insert(memories).values({ id: crypto.randomUUID(), owner, content: 'chung' }).run()
    const suggestion = (status: 'pending' | 'accepted') =>
      handle.db
        .insert(memorySuggestions)
        .values({ id: crypto.randomUUID(), owner, action: 'add', content: 'x', projectId: p.id, status })
        .run()
    suggestion('pending')
    suggestion('accepted') // đã duyệt → không đếm
    expect(repo.deleteInfo(p.id)).toEqual({ files: 2, memories: 1, suggestions: 1, conversations: 1 })

    expect(repo.remove(p.id)).toBe(true)
    expect(convs.get(c.id)).toMatchObject({ id: c.id, projectId: null })
    expect(handle.db.select().from(memories).all().map((m) => m.content)).toEqual(['chung'])
    expect(handle.db.select().from(memorySuggestions).all()).toEqual([])
    expect(repo.deleteInfo(p.id)).toBeNull()
  })

  it('thêm file: chỉ file chữ, ≤ giới hạn, tối đa số file; xoá file', async () => {
    const p = repo.create({ name: 'Game', description: '' })
    const r = await service.addFiles(p.id, [
      file('ghi-chu.md', `${String.fromCharCode(0xfeff)}Nội dung`), // có BOM (Notepad hay thêm)
      file('script.cs', 'class A {}'),
      file('anh.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      file('gia.txt', Buffer.from([0x61, 0x00, 0x62])),
      file('lon.md', 'x'.repeat(PROJECT_FILE_MAX_BYTES + 1))
    ])
    expect(r).toEqual({
      added: 2,
      rejected: [
        { name: 'anh.png', reason: 'not_text' },
        { name: 'gia.txt', reason: 'not_text' },
        { name: 'lon.md', reason: 'too_large' }
      ]
    })
    expect(repo.files(p.id)[0].content).toBe('Nội dung') // bỏ BOM

    const many = Array.from({ length: PROJECT_MAX_FILES }, (_, i) => file(`f${i}.txt`, 'x'))
    const r2 = await service.addFiles(p.id, many)
    expect(r2!.added).toBe(PROJECT_MAX_FILES - 2)
    expect(r2!.rejected.every((x) => x.reason === 'too_many')).toBe(true)

    const first = repo.files(p.id)[0]
    expect(repo.removeFile(first.id)).toBe(p.id)
    owner = 'u2'
    expect(repo.removeFile(repo.files(p.id)[0]?.id ?? first.id)).toBeNull()
  })

  it('readContextFile: file không phải UTF-8 bị từ chối', async () => {
    expect(await readContextFile(file('latin.txt', Buffer.from([0xff, 0xfe, 0xfd])))).toEqual({ name: 'latin.txt', reason: 'not_text' })
    expect(await readContextFile(join(dir, 'khong-co.md'))).toEqual({ name: 'khong-co.md', reason: 'unreadable' })
  })

  it('detail + promptFor: phần dự án vào prompt của cuộc trong dự án, cuộc thường thì không', async () => {
    const p = repo.create({ name: 'Game', description: 'Unity 2D' })
    repo.update({ id: p.id, instructions: 'Luôn dùng C#' })
    await service.addFiles(p.id, [file('gdd.md', 'Thiết kế màn chơi')])
    const detail = service.detail(p.id)!
    expect(detail.files).toMatchObject([{ name: 'gdd.md', usage: 'full', chars: 17 }])
    expect(detail.promptChars).toBeGreaterThan(0)

    const inProject = convs.createInProject('free', p.id)!
    const plain = convs.create('free')!
    expect(service.promptFor(inProject.id)).toContain('Luôn dùng C#')
    expect(service.promptFor(inProject.id)).toContain('Thiết kế màn chơi')
    expect(service.promptFor(plain.id)).toBe('')
  })
})
