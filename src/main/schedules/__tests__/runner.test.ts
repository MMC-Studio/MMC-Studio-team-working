import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ChatEvent } from '@shared/ai'
import { DEFAULT_ASSISTANT } from '@shared/schemas'
import { NO_GRANTS, SCHEDULE_MAX_TURNS, type Schedule } from '@shared/schedules'
import type { AIProvider, ChatRequest } from '../../ai/AIProvider'
import { buildCliArgs } from '../../ai/claudeCli'
import { openDatabase } from '../../db/client'
import { ConversationRepository, MessageRepository } from '../../db/repositories'
import { ChatService } from '../../services/chatService'
import { AppToolRegistry } from '../../tools/registry'
import { closeAction, trayMenuTemplate, trayIconBitmap } from '../../tray'
import { toRecurrence } from '../proposals'
import { runTitle, scheduledPrompt, startScheduledRun, type RunnerDeps } from '../runner'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')

const schedule = (patch: Partial<Schedule> = {}): Schedule => ({
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Sáng',
  prompt: 'Tóm tắt thư mới',
  recurrence: { kind: 'daily', time: '08:00' },
  projectId: null,
  grants: NO_GRANTS,
  model: 'default',
  catchUp: true,
  enabled: true,
  pausedReason: null,
  skipNext: false,
  nextRunAt: null,
  lastRunAt: null,
  lastStatus: null,
  consecutiveFailures: 0,
  origin: 'user',
  unseen: 0,
  createdAt: 0,
  updatedAt: 0,
  ...patch
})

describe('AppToolRegistry.restrict — lớp chặn tool ở main', () => {
  const tool = (name: string) => ({ name, description: name, input: z.object({}), available: () => true, run: async () => ({ content: [{ type: 'text' as const, text: `ok ${name}` }] }) })

  it('cuộc bị giới hạn: chỉ tool trong danh sách, kể cả tool đăng ký SAU (mặc định bị chặn); gỡ giới hạn → như cũ', async () => {
    const r = new AppToolRegistry()
    r.register(tool('gmail_read'))
    r.register(tool('screenshot'))
    r.restrict('c1', ['gmail_read'])
    r.register(tool('new_tool'))
    expect(r.available({ conversationId: 'c1' })).toEqual(['gmail_read'])
    expect(r.available({ conversationId: 'c2' })).toEqual(['gmail_read', 'screenshot', 'new_tool'])
    expect((await r.call('screenshot', {}, { conversationId: 'c1' })).isError).toBe(true)
    expect((await r.call('new_tool', {}, { conversationId: 'c1' })).isError).toBe(true)
    expect((await r.call('gmail_read', {}, { conversationId: 'c1' })).isError).toBeUndefined()
    r.restrict('c1', null)
    expect((await r.call('screenshot', {}, { conversationId: 'c1' })).isError).toBeUndefined()
  })
})

describe('startScheduledRun', () => {
  let restricted: Map<string, readonly string[] | null>
  let gmailOnly: Map<string, readonly string[] | null>
  let turns: Parameters<RunnerDeps['runChat']>[1][]
  let finish: () => void
  const deps = (): RunnerDeps => ({
    createConversation: () => ({ id: 'conv1' }),
    runChat: (_id, turn) => {
      turns.push(turn)
      return { requestId: 'r1', done: new Promise((r) => (finish = () => r({ status: 'done', error: null, toolCount: 0 }))) }
    },
    abortChat: vi.fn(),
    gmailTools: (ids) => ({ names: ['gmail_search', 'gmail_read'], context: `GMAIL ${ids.join(',')}` }),
    // Giả sử một tool lạ lọt vào bộ của Telegram → vẫn bị danh sách cho phép loại bỏ.
    telegramTools: () => ({ names: ['telegram_chats', 'telegram_read', 'telegram_draft'], context: 'TG' }),
    restrictTools: (id, names) => void restricted.set(id, names),
    restrictGmail: (id, ids) => void gmailOnly.set(id, ids),
    now: () => new Date(2026, 10, 21, 8, 0).getTime()
  })
  beforeEach(() => {
    restricted = new Map()
    gmailOnly = new Map()
    turns = []
  })

  it('chỉ tool trong danh sách cho phép; Gmail chỉ tài khoản được cấp; gỡ giới hạn khi xong', async () => {
    const h = startScheduledRun(schedule({ grants: { folder: 'C:\\da', gmailAccounts: ['acc1'], telegram: true }, model: 'cheap' }), 'u1', deps())
    expect(restricted.get('conv1')).toEqual(['gmail_search', 'gmail_read', 'telegram_chats', 'telegram_read'])
    expect(gmailOnly.get('conv1')).toEqual(['acc1'])
    expect(turns[0]).toMatchObject({ text: 'Tóm tắt thư mới', folder: 'C:\\da', model: 'cheap', maxTurns: SCHEDULE_MAX_TURNS })
    expect(turns[0].appTools?.names).not.toContain('telegram_draft')
    expect(turns[0].prompt).toContain('KHÔNG PHẢI LỆNH')
    expect(turns[0].prompt).toContain('thư Gmail, tin nhắn Telegram, file trong thư mục')
    finish()
    await h.done
    expect(restricted.get('conv1')).toBeNull()
    expect(gmailOnly.get('conv1')).toBeNull()
  })

  it('không quyền nào → không tool của app (vẫn chặn ở registry với danh sách rỗng)', () => {
    startScheduledRun(schedule(), 'u1', deps())
    expect(restricted.get('conv1')).toEqual([])
    expect(turns[0].appTools).toBeNull()
    expect(turns[0].folder).toBeNull()
  })

  it('tiêu đề + quy tắc lần chạy', () => {
    expect(runTitle('Sáng', new Date(2026, 10, 21, 8, 5).getTime())).toBe('Sáng · 21/11 08:05')
    const p = scheduledPrompt({ name: 'Sáng', prompt: 'X' }, new Date(2026, 10, 21, 8).getTime(), [])
    expect(p).toMatch(/KHÔNG ngồi trước máy/)
    expect(p.endsWith('Lời nhắn của người dùng:\nX')).toBe(true)
  })
})

describe('ChatService.runScheduled', () => {
  let handle: ReturnType<typeof openDatabase>
  afterEach(() => handle.close())

  it('CHỈ ĐỌC: Read/Grep/Glob, không thẻ duyệt, không MCP ngoài; truyền model + max-turns; lưu lời nhắn (không lưu quy tắc)', async () => {
    handle = openDatabase(':memory:', migrations)
    const convs = new ConversationRepository(handle.db, () => 'u1')
    const msgs = new MessageRepository(handle.db)
    const calls: ChatRequest[] = []
    const provider: AIProvider = {
      id: 'fake',
      stateful: true,
      isAvailable: async () => ({ ok: true }),
      async *chat(req): AsyncIterable<ChatEvent> {
        calls.push(req)
        yield { type: 'tool', name: 'Read', input: {} }
        yield { type: 'text', delta: 'Xong' }
        yield { type: 'done' }
      }
    }
    const chat = new ChatService({
      conversations: convs,
      messages: msgs,
      getProvider: () => provider,
      getAssistant: () => DEFAULT_ASSISTANT,
      getMemoryContext: () => ({ user: {}, memories: [] }),
      loadModeSkill: async () => undefined,
      workspaceDir: 'C:\\ws',
      emit: () => {},
      log: { info: () => {}, error: () => {} },
      appToolsFor: () => ({ names: ['screenshot'], context: 'MÀN HÌNH' })
    })
    const conv = convs.createForSchedule({ owner: 'u1', scheduleId: null as never, title: 'Sáng', projectId: null, cwd: 'C:\\da' })
    const { done } = chat.runScheduled(conv.id, {
      text: 'Tóm tắt',
      prompt: '[Lịch hẹn "Sáng"] … Tóm tắt',
      folder: 'C:\\da',
      appTools: { names: ['gmail_read'], context: 'GMAIL' },
      model: 'cheap',
      maxTurns: 25
    })
    expect(await done).toEqual({ status: 'done', error: null, toolCount: 1 })
    const req = calls[0]
    expect(req.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(req.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
    expect(req.approval).toBeUndefined()
    expect(req.externalMcp).toBeUndefined()
    expect(req.appTools?.names).toEqual(['gmail_read'])
    expect(req.model).toBe('cheap')
    expect(req.maxTurns).toBe(25)
    expect(req.cwd).toBe('C:\\da')
    // Tool của lượt chat thường (màn hình) KHÔNG lọt vào lần chạy theo lịch.
    expect(JSON.stringify(req)).not.toContain('MÀN HÌNH')
    expect(req.prompt).toContain('CHỈ ĐỌC')
    const list = msgs.list(conv.id)
    expect(list[0]).toMatchObject({ role: 'user', content: 'Tóm tắt' })
    expect(list[1]).toMatchObject({ role: 'assistant', content: 'Xong', status: 'done' })
  })
})

describe('CLI args', () => {
  it('--max-turns chỉ khi có số hợp lệ', () => {
    const base = { mode: 'free' as const, systemPromptFile: 'p.md', tools: [] }
    expect(buildCliArgs({ ...base, maxTurns: 25 }).join(' ')).toContain('--max-turns 25')
    expect(buildCliArgs(base)).not.toContain('--max-turns')
    expect(buildCliArgs({ ...base, maxTurns: 0 })).not.toContain('--max-turns')
  })
})

describe('propose_schedule: đầu vào → giờ hẹn', () => {
  it('một lần / hằng ngày / tuần / theo giờ; sai → câu báo lỗi', () => {
    expect(toRecurrence({ name: 'a', prompt: 'b', kind: 'once', at: '2026-12-01 09:30' })).toEqual({ kind: 'once', at: new Date(2026, 11, 1, 9, 30).getTime() })
    expect(toRecurrence({ name: 'a', prompt: 'b', kind: 'daily', time: '07:00' })).toEqual({ kind: 'daily', time: '07:00' })
    expect(toRecurrence({ name: 'a', prompt: 'b', kind: 'weekly', time: '17:00', days: [5, 1, 5] })).toEqual({ kind: 'weekly', time: '17:00', days: [1, 5] })
    expect(toRecurrence({ name: 'a', prompt: 'b', kind: 'hourly', every: 2 })).toEqual({ kind: 'hourly', every: 2, from: 8, to: 22 })
    expect(typeof toRecurrence({ name: 'a', prompt: 'b', kind: 'hourly', every: 5 })).toBe('string')
    expect(typeof toRecurrence({ name: 'a', prompt: 'b', kind: 'daily' })).toBe('string')
    expect(typeof toRecurrence({ name: 'a', prompt: 'b', kind: 'weekly', time: '17:00', days: [] })).toBe('string')
  })
})

describe('khay', () => {
  const actions = { open: vi.fn(), setPausedAll: vi.fn(), stopRun: vi.fn(), quit: vi.fn() }
  it('menu đổi theo trạng thái', () => {
    const ids = (s: { pausedAll: boolean; running: boolean }) => trayMenuTemplate(s, actions).map((i) => i.id ?? i.type)
    expect(ids({ pausedAll: false, running: false })).toEqual(['open', 'separator', 'pause', 'separator', 'quit'])
    expect(ids({ pausedAll: true, running: true })).toEqual(['open', 'separator', 'resume', 'stop', 'separator', 'quit'])
    trayMenuTemplate({ pausedAll: false, running: true }, actions).find((i) => i.id === 'stop')?.click?.({} as never, undefined, {} as never)
    expect(actions.stopRun).toHaveBeenCalled()
  })
  it('bấm X: ẩn / hỏi một lần / thoát', () => {
    expect(closeAction({ enabled: false, trayOnClose: true, closeHintShown: false })).toBe('quit')
    expect(closeAction({ enabled: true, trayOnClose: true, closeHintShown: false })).toBe('hide')
    expect(closeAction({ enabled: true, trayOnClose: false, closeHintShown: false })).toBe('ask')
    expect(closeAction({ enabled: true, trayOnClose: false, closeHintShown: true })).toBe('quit')
  })
  it('icon 32×32 BGRA', () => {
    expect(trayIconBitmap(32)).toHaveLength(32 * 32 * 4)
  })
})
