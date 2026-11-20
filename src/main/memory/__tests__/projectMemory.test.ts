import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/ai'
import type { AIProvider, ChatRequest } from '../../ai/AIProvider'
import { openDatabase } from '../../db/client'
import {
  ConversationRepository,
  LOCAL_OWNER,
  MemoryRepository,
  MessageRepository,
  SettingsRepository,
  SuggestionRepository
} from '../../db/repositories'
import { ProjectRepository } from '../../projects/repository'
import { MemoryService, PROJECT_MEMORY_LIMIT } from '../memoryService'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

class ScriptedProvider implements AIProvider {
  readonly id = 'fake'
  readonly stateful = true
  calls: ChatRequest[] = []
  constructor(public reply: string) {}
  async isAvailable(): Promise<{ ok: boolean }> {
    return { ok: true }
  }
  async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
    this.calls.push(req)
    yield { type: 'text', delta: this.reply }
    yield { type: 'done' }
  }
}

const reply = (items: unknown[]): string => '```json\n' + JSON.stringify({ type: 'memory_suggestions', items }) + '\n```'

describe('Trí nhớ dự án (MemoryService + repository, SQLite in-memory)', () => {
  let handle: ReturnType<typeof openDatabase>
  let convs: ConversationRepository
  let msgs: MessageRepository
  let mems: MemoryRepository
  let sugg: SuggestionRepository
  let projects: ProjectRepository
  let provider: ScriptedProvider
  let owner: string

  const service = (): MemoryService =>
    new MemoryService({
      conversations: convs,
      messages: msgs,
      memories: mems,
      suggestions: sugg,
      settings: new SettingsRepository(handle.db),
      getProvider: () => provider,
      loadSkill: async () => '# Memory keeper',
      workspaceDir: 'C:\\ws',
      emit: () => undefined,
      log: { info: vi.fn(), warn: vi.fn() },
      getOwner: () => owner,
      getProject: (id) => projects.get(id)
    })

  /** Cuộc trong dự án có một lượt hỏi–đáp mới. */
  const chatIn = (projectId: string | null): string => {
    const c = projectId ? convs.createInProject('free', projectId)! : convs.create('free')
    msgs.insert({ conversationId: c.id, role: 'user', content: 'Dự án dùng URP, mình thích trả lời ngắn' })
    msgs.insert({ conversationId: c.id, role: 'assistant', content: 'Ok' })
    return c.id
  }

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    owner = LOCAL_OWNER
    const getOwner = (): string => owner
    convs = new ConversationRepository(handle.db, getOwner)
    msgs = new MessageRepository(handle.db)
    mems = new MemoryRepository(handle.db, getOwner)
    sugg = new SuggestionRepository(handle.db, getOwner)
    projects = new ProjectRepository(handle.db, getOwner)
    provider = new ScriptedProvider(reply([]))
  })
  afterEach(() => handle.close())

  it('repository: lọc theo phạm vi (bỏ trống = tất cả, null = chung, id = dự án)', () => {
    const a = projects.create({ name: 'A', description: '' })
    mems.create('chung', 'other')
    mems.create('của A', 'other', null, a.id)
    expect(mems.list().map((m) => m.content).sort()).toEqual(['chung', 'của A'])
    expect(mems.list(undefined, null).map((m) => m.content)).toEqual(['chung'])
    expect(mems.list(undefined, a.id)).toMatchObject([{ content: 'của A', projectId: a.id }])
  })

  it('trích trong dự án: prompt có tên dự án + hai nhóm, đề xuất mang đúng phạm vi; không thấy trí nhớ dự án khác', async () => {
    const a = projects.create({ name: 'Game Unity', description: 'đồ án 2D' })
    const b = projects.create({ name: 'Web', description: '' })
    const general = mems.create('Thích ví dụ C#', 'preference')
    mems.create('A dùng Unity 6', 'project', null, a.id)
    const other = mems.create('B dùng Next.js', 'project', null, b.id)
    provider.reply = reply([
      { action: 'add', content: 'Dùng URP', scope: 'project' },
      { action: 'add', content: 'Thích trả lời ngắn', scope: 'user' },
      { action: 'add', content: 'Không ghi scope' },
      { action: 'update', id: general.id, content: 'Thích ví dụ C# ngắn', scope: 'project' },
      { action: 'delete', id: other.id } // trí nhớ dự án khác → bị bỏ
    ])
    const conv = chatIn(a.id)

    expect(await service().extract(conv)).toEqual({ added: 4 })
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain('DỰ ÁN "Game Unity" — đồ án 2D')
    expect(prompt).toContain('A dùng Unity 6')
    expect(prompt).toContain('Thích ví dụ C#')
    expect(prompt).not.toContain('B dùng Next.js')

    const pending = sugg.pending()
    expect(pending.map((s) => [s.content, s.projectId])).toEqual([
      ['Dùng URP', a.id],
      ['Thích trả lời ngắn', null],
      ['Không ghi scope', a.id], // thiếu scope trong dự án → dự án
      ['Thích ví dụ C# ngắn', null] // update giữ phạm vi của memory đích
    ])
    expect(pending[0]).toMatchObject({ projectName: 'Game Unity', sourceProjectId: a.id, sourceProjectName: 'Game Unity' })
    expect(pending[1]).toMatchObject({ projectName: null, sourceProjectId: a.id })
  })

  it('trích ngoài dự án: thiếu scope hay ghi "project" đều thành trí nhớ chung', async () => {
    provider.reply = reply([
      { action: 'add', content: 'Không ghi scope' },
      { action: 'add', content: 'Ghi project', scope: 'project' }
    ])
    await service().extract(chatIn(null))
    expect(provider.calls[0].prompt).not.toContain('scope')
    expect(sugg.pending().map((s) => [s.content, s.projectId, s.sourceProjectId])).toEqual([
      ['Không ghi scope', null, null],
      ['Ghi project', null, null]
    ])
  })

  it('duyệt: giữ phạm vi đề xuất, đổi Chung ↔ dự án được, không gắn sang dự án tuỳ ý', async () => {
    const a = projects.create({ name: 'A', description: '' })
    const b = projects.create({ name: 'B', description: '' })
    provider.reply = reply([
      { action: 'add', content: 'một', scope: 'project' },
      { action: 'add', content: 'hai', scope: 'project' },
      { action: 'add', content: 'ba', scope: 'user' },
      { action: 'add', content: 'bốn', scope: 'user' }
    ])
    await service().extract(chatIn(a.id))
    const [one, two, three, four] = sugg.pending()
    const svc = service()

    svc.resolve({ id: one.id, accept: true })
    svc.resolve({ id: two.id, accept: true, projectId: null })
    svc.resolve({ id: three.id, accept: true, projectId: a.id }) // chung → dự án của cuộc trò chuyện
    expect(() => svc.resolve({ id: four.id, accept: true, projectId: b.id })).toThrow('invalid_scope')

    expect(mems.list(undefined, a.id).map((m) => m.content).sort()).toEqual(['ba', 'một'])
    expect(mems.list(undefined, null).map((m) => m.content)).toEqual(['hai'])
    expect(sugg.pending().map((s) => s.content)).toEqual(['bốn'])
  })

  it('tự thêm: dự án phải tồn tại và của người đang đăng nhập', () => {
    const a = projects.create({ name: 'A', description: '' })
    const svc = service()
    expect(svc.create('x', 'other', a.id).projectId).toBe(a.id)
    expect(svc.create('y', 'other').projectId).toBeNull()
    owner = 'nguoi-khac'
    expect(() => svc.create('z', 'other', a.id)).toThrow('project_not_found')
  })

  it('ngữ cảnh: chỉ trí nhớ chung + của dự án đang mở, ngân sách riêng cho trí nhớ dự án', () => {
    const a = projects.create({ name: 'A', description: '' })
    const b = projects.create({ name: 'B', description: '' })
    for (let i = 0; i < 20; i++) mems.create(`chung ${i} unity`, 'other')
    for (let i = 0; i < 15; i++) mems.create(`dự án A ${i} unity`, 'other', null, a.id)
    mems.create('dự án B unity', 'other', null, b.id)
    const svc = service()

    const inA = svc.contextFor('unity', chatIn(a.id))
    expect(inA.memories).toHaveLength(15) // trí nhớ chung giữ nguyên 15 mục
    expect(inA.memories.every((m) => m.startsWith('chung'))).toBe(true)
    expect(inA.projectMemories).toHaveLength(PROJECT_MEMORY_LIMIT)
    expect(inA.projectMemories.every((m) => m.startsWith('dự án A'))).toBe(true)

    const plain = svc.contextFor('unity', chatIn(null))
    expect(plain.projectMemories).toEqual([])
    expect([...plain.memories].some((m) => m.includes('dự án'))).toBe(false)
  })

  it('xoá dự án → trí nhớ + đề xuất của dự án mất, trí nhớ chung còn', async () => {
    const a = projects.create({ name: 'A', description: '' })
    mems.create('chung', 'other')
    mems.create('của A', 'other', null, a.id)
    provider.reply = reply([{ action: 'add', content: 'đề xuất A' }])
    await service().extract(chatIn(a.id))
    expect(projects.deleteInfo(a.id)).toMatchObject({ memories: 1, suggestions: 1 })

    projects.remove(a.id)
    expect(mems.list().map((m) => m.content)).toEqual(['chung'])
    expect(sugg.pending()).toEqual([])
  })
})
