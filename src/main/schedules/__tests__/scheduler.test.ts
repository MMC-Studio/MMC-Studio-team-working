import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SCHEDULES_SETTINGS,
  NO_GRANTS,
  SCHEDULE_DAILY_RUNS,
  SCHEDULE_RUN_TIMEOUT_MS,
  SCHEDULE_WAKE_DELAY_MS,
  type ScheduleInput,
  type SchedulesSettings
} from '@shared/schedules'
import { openDatabase } from '../../db/client'
import { ConversationRepository } from '../../db/repositories'
import { ProjectRepository } from '../../projects/repository'
import { nextOccurrence } from '../recurrence'
import { ScheduleRepository } from '../repository'
import { Scheduler, type RunOutcome, type ScheduleNotice } from '../scheduler'
import { ScheduleService } from '../service'

const migrations = join(__dirname, '..', '..', 'db', 'migrations')
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()

const input = (patch: Partial<ScheduleInput> = {}): ScheduleInput => ({
  name: 'Tóm tắt thư',
  prompt: 'Tóm tắt thư mới',
  recurrence: { kind: 'daily', time: '08:00' },
  projectId: null,
  grants: NO_GRANTS,
  model: 'default',
  catchUp: true,
  ...patch
})

type Deferred = { resolve(o: RunOutcome): void; aborted: boolean }

describe('Scheduler', () => {
  let handle: ReturnType<typeof openDatabase>
  let owner: string
  let clock: number
  let settings: SchedulesSettings
  let lastOwner: string | null
  let repo: ScheduleRepository
  let convs: ConversationRepository
  let runs: Deferred[]
  let startFails: Error | null
  let folders: Set<string>
  let armOk: boolean
  let armed: string[]
  let notices: ScheduleNotice[]
  let scheduler: Scheduler
  let service: ScheduleService

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    owner = 'u1'
    clock = at(2026, 11, 21, 7, 0)
    settings = { ...DEFAULT_SCHEDULES_SETTINGS, enabled: true, acknowledged: true }
    lastOwner = null
    repo = new ScheduleRepository(handle.db, () => owner)
    convs = new ConversationRepository(handle.db, () => owner)
    runs = []
    startFails = null
    folders = new Set()
    armOk = true
    armed = []
    notices = []
    scheduler = new Scheduler({
      repo,
      now: () => clock,
      getSettings: () => settings,
      setSettings: (v) => {
        settings = v
      },
      getLastOwner: () => lastOwner,
      setLastOwner: (o) => {
        lastOwner = o
      },
      startRun: (s, o) => {
        if (startFails) throw startFails
        const conv = convs.createForSchedule({ owner: o, scheduleId: s.id, title: s.name, projectId: s.projectId, cwd: s.grants.folder })
        let resolve!: (o: RunOutcome) => void
        const d: Deferred = { resolve: (x) => resolve(x), aborted: false }
        const done = new Promise<RunOutcome>((r) => (resolve = r))
        runs.push(d)
        return {
          conversationId: conv.id,
          done,
          abort: () => {
            d.aborted = true
            resolve({ status: 'aborted', error: null, toolCount: 0 })
          }
        }
      },
      folderExists: (p) => folders.has(p),
      killSwitch: {
        arm: (h) => {
          if (armOk) armed.push(h)
          return armOk
        },
        disarm: (h) => {
          armed = armed.filter((x) => x !== h)
        }
      },
      notify: (n) => notices.push(n),
      changed: () => {},
      log: { info: () => {}, warn: () => {} }
    })
    service = new ScheduleService({
      repo,
      scheduler,
      now: () => clock,
      isDirectory: (p) => folders.has(p),
      gmailAccounts: () => [{ id: 'acc1', label: 'Trường' }]
    })
    scheduler.start()
  })
  afterEach(() => handle.close())

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const ready = (): void => {
    scheduler.setAccount(owner)
    clock += SCHEDULE_WAKE_DELAY_MS
  }
  const create = (patch: Partial<ScheduleInput> = {}) => {
    const r = service.save({ input: input(patch), confirmed: true })
    if (r.status !== 'saved') throw new Error('not saved')
    return r.schedule
  }
  const finishRun = async (i = runs.length - 1, outcome: RunOutcome = { status: 'done', error: null, toolCount: 2 }): Promise<void> => {
    runs[i].resolve(outcome)
    await flush()
  }

  it('chưa biết tài khoản → không chạy; tới giờ → một cuộc mới, nhật ký done, giữ phím dừng TRONG LÚC chạy', async () => {
    const s = create()
    clock = at(2026, 11, 21, 8, 0)
    scheduler.tick()
    expect(runs).toHaveLength(0)
    // Tài khoản này là người dùng lần trước (không phải đổi tài khoản) → giữ lần hẹn.
    lastOwner = owner
    scheduler.setAccount(owner)
    scheduler.tick()
    expect(runs).toHaveLength(1)
    expect(armed).toEqual(['schedule-run'])
    expect(scheduler.status().running?.scheduleId).toBe(s.id)
    await finishRun()
    expect(armed).toEqual([])
    const [run] = repo.runs(s.id, 10)
    expect(run).toMatchObject({ status: 'done', trigger: 'on_time', toolCount: 2 })
    expect(run.conversationId).toBeTruthy()
    expect(convs.get(run.conversationId!)?.scheduleId).toBe(s.id)
    expect(repo.get(s.id)?.nextRunAt).toBe(at(2026, 11, 22, 8))
    expect(notices.at(-1)).toMatchObject({ kind: 'finished', status: 'done', conversationId: run.conversationId })
    expect(scheduler.status().unseen).toBe(1)
    service.markSeen(run.conversationId!)
    expect(scheduler.status().unseen).toBe(0)
  })

  it('mở app / máy thức: chờ 2 phút rồi mới chạy bù MỘT lần, gộp lượt lỡ', async () => {
    const s = create()
    repo.patch(s.id, { nextRunAt: at(2026, 11, 19, 8) })
    clock = at(2026, 11, 21, 9)
    lastOwner = owner
    scheduler.start() // app vừa mở
    scheduler.setAccount(owner)
    scheduler.tick()
    expect(runs).toHaveLength(0)
    clock += SCHEDULE_WAKE_DELAY_MS
    scheduler.tick()
    expect(runs).toHaveLength(1)
    await finishRun()
    expect(repo.runs(s.id, 10)[0]).toMatchObject({ trigger: 'catch_up', missed: 3, status: 'done' })
    scheduler.tick()
    expect(runs).toHaveLength(1)
  })

  it('quá hạn bù → ghi "bỏ lỡ", không chạy', () => {
    const s = create({ catchUp: true })
    ready()
    repo.patch(s.id, { nextRunAt: at(2026, 11, 21, 8) })
    clock = at(2026, 11, 21, 15) // trễ 7 giờ > hạn bù 6 giờ
    scheduler.tick()
    expect(runs).toHaveLength(0)
    expect(repo.runs(s.id, 10)[0]).toMatchObject({ status: 'missed', missed: 1 })
    expect(repo.get(s.id)?.nextRunAt).toBe(at(2026, 11, 22, 8))
  })

  it('đổi tài khoản: lịch của A không chạy khi đăng nhập B; A quay lại sau nhiều ngày → KHÔNG bù, chỉ tính lại lần tới', () => {
    const s = create()
    ready()
    owner = 'u2'
    scheduler.setAccount('u2')
    clock = at(2026, 11, 24, 9) // A vắng 3 ngày
    scheduler.tick()
    expect(runs).toHaveLength(0)
    owner = 'u1'
    scheduler.setAccount('u1')
    scheduler.tick()
    expect(runs).toHaveLength(0)
    expect(repo.runs(s.id, 10)).toHaveLength(0)
    expect(repo.get(s.id)?.nextRunAt).toBe(at(2026, 11, 25, 8))
  })

  it('cùng tài khoản mở lại app → vẫn chạy bù như thường', () => {
    const s = create()
    ready()
    lastOwner = 'u1'
    // App "đóng" rồi mở lại: scheduler mới.
    repo.patch(s.id, { nextRunAt: at(2026, 11, 21, 8) })
    clock = at(2026, 11, 21, 10)
    scheduler.start()
    clock += SCHEDULE_WAKE_DELAY_MS
    scheduler.tick()
    expect(runs).toHaveLength(1)
  })

  it(`giới hạn ${SCHEDULE_DAILY_RUNS} lần / ngày (tính cả "Chạy ngay"), báo một lần`, async () => {
    const s = create()
    ready()
    for (let i = 0; i < SCHEDULE_DAILY_RUNS; i++) {
      expect(scheduler.runNow(s.id)).toBe(true)
      await finishRun()
    }
    expect(scheduler.runNow(s.id)).toBe(true)
    expect(runs).toHaveLength(SCHEDULE_DAILY_RUNS)
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'skipped', reason: 'daily_limit' })
    scheduler.runNow(s.id)
    expect(notices.filter((n) => n.kind === 'dailyLimit')).toHaveLength(1)
  })

  it('chạy quá 10 phút → dừng, ghi hết giờ; máy ngủ giữa chừng → lý do "slept"', async () => {
    const s = create()
    ready()
    scheduler.runNow(s.id)
    clock += SCHEDULE_RUN_TIMEOUT_MS + 1
    scheduler.tick()
    await flush()
    expect(runs[0].aborted).toBe(true)
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'timeout', reason: null })
    scheduler.runNow(s.id)
    clock += SCHEDULE_RUN_TIMEOUT_MS + 1
    scheduler.resume()
    await flush()
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'timeout', reason: 'slept' })
  })

  it('thư mục bị xoá / đổi tên → lỗi rõ, 3 lần liền → tự tạm dừng + báo', async () => {
    folders.add('C:\\du-an')
    const s = create({ grants: { ...NO_GRANTS, folder: 'C:\\du-an' } })
    folders.clear()
    ready()
    for (let i = 0; i < 3; i++) {
      scheduler.runNow(s.id)
      await flush()
    }
    expect(runs).toHaveLength(0)
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'error', reason: 'folder_missing', detail: 'C:\\du-an' })
    expect(repo.get(s.id)).toMatchObject({ enabled: false, pausedReason: 'failures', consecutiveFailures: 3 })
    expect(notices.some((n) => n.kind === 'paused')).toBe(true)
  })

  it('lỗi xen kẽ thành công → đếm lại từ đầu', async () => {
    const s = create()
    ready()
    scheduler.runNow(s.id)
    await finishRun(0, { status: 'error', error: 'boom', toolCount: 0 })
    scheduler.runNow(s.id)
    await finishRun(1, { status: 'error', error: 'boom', toolCount: 0 })
    expect(repo.get(s.id)?.consecutiveFailures).toBe(2)
    scheduler.runNow(s.id)
    await finishRun(2)
    expect(repo.get(s.id)).toMatchObject({ consecutiveFailures: 0, enabled: true })
  })

  it('hết hạn mức Claude → tạm dừng MỌI lịch tới hôm sau (không tính lỗi của lịch)', async () => {
    const s = create()
    ready()
    scheduler.runNow(s.id)
    await finishRun(0, { status: 'error', error: "You've hit your limit · resets 5pm", toolCount: 0 })
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'error', reason: 'quota' })
    expect(settings.pausedUntil).toBe(at(2026, 11, 22))
    expect(repo.get(s.id)?.consecutiveFailures).toBe(0)
    clock = at(2026, 11, 21, 8)
    scheduler.tick()
    expect(runs).toHaveLength(1)
    clock = at(2026, 11, 22, 8, 1)
    scheduler.tick() // gỡ tạm dừng; lần hẹn tính lại từ bây giờ
    expect(settings.pausedUntil).toBeNull()
    expect(repo.get(s.id)?.nextRunAt).toBe(at(2026, 11, 23, 8))
  })

  it('xếp hàng: một lịch chạy một lúc, lịch kia chạy sau', async () => {
    const a = create({ name: 'A' })
    const b = create({ name: 'B' })
    ready()
    clock = at(2026, 11, 21, 8)
    scheduler.tick()
    expect(runs).toHaveLength(1)
    await finishRun()
    expect(runs).toHaveLength(2)
    await finishRun()
    expect(repo.runs(a.id, 1)[0].status).toBe('done')
    expect(repo.runs(b.id, 1)[0].status).toBe('done')
  })

  it('"Bỏ qua lần tới" → ghi bỏ qua, lần sau chạy lại bình thường', () => {
    const s = create()
    service.setSkipNext(s.id, true)
    ready()
    clock = at(2026, 11, 21, 8)
    scheduler.tick()
    expect(runs).toHaveLength(0)
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'skipped', reason: 'skip_next' })
    expect(repo.get(s.id)?.skipNext).toBe(false)
  })

  it('tạm dừng tất cả → dừng lần đang chạy; tiếp tục → giờ đã qua không tính bỏ lỡ', async () => {
    const s = create()
    ready()
    scheduler.runNow(s.id)
    scheduler.setPausedAll(true)
    await flush()
    expect(runs[0].aborted).toBe(true)
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'aborted', reason: 'user_stop' })
    clock = at(2026, 11, 23, 12)
    scheduler.tick()
    expect(runs).toHaveLength(1)
    scheduler.setPausedAll(false)
    expect(runs).toHaveLength(1)
    expect(repo.runs(s.id, 1)[0].status).toBe('aborted')
    expect(repo.get(s.id)?.nextRunAt).toBe(at(2026, 11, 24, 8))
  })

  it('Ctrl+Alt+Q: đang chạy → dừng + tạm dừng mọi lịch; không chạy gì → không đổi (phím dùng chung với giọng nói)', async () => {
    const s = create()
    ready()
    scheduler.emergencyStop()
    expect(settings.pausedAll).toBe(false)
    scheduler.runNow(s.id)
    scheduler.emergencyStop()
    await flush()
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'aborted', reason: 'hotkey' })
    expect(settings).toMatchObject({ pausedAll: true, pauseReason: 'hotkey' })
    expect(notices.some((n) => n.kind === 'pausedAll' && n.reason === 'hotkey')).toBe(true)
  })

  it('không đăng ký được phím dừng (app khác giữ) → vẫn chạy, ghi chú no_hotkey', async () => {
    armOk = false
    const s = create()
    ready()
    scheduler.runNow(s.id)
    await finishRun()
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'done', reason: 'no_hotkey' })
  })

  it('lịch một lần: chạy xong → tự tắt (đã xong)', async () => {
    const s = create({ recurrence: { kind: 'once', at: at(2026, 11, 21, 8) } })
    ready()
    clock = at(2026, 11, 21, 8)
    scheduler.tick()
    await finishRun()
    expect(repo.get(s.id)).toMatchObject({ enabled: false, pausedReason: 'done', nextRunAt: null })
  })

  it('app tắt giữa lúc chạy → mở lại: dòng "đang chạy" thành đã dừng (gián đoạn)', () => {
    const s = create()
    ready()
    scheduler.runNow(s.id)
    scheduler.start()
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'aborted', reason: 'interrupted' })
  })

  it('bắt đầu lỗi (vd hội thoại bận) → lỗi, nhả phím', () => {
    const s = create()
    ready()
    startFails = new Error('conversation_busy')
    scheduler.runNow(s.id)
    expect(armed).toEqual([])
    expect(repo.runs(s.id, 1)[0]).toMatchObject({ status: 'error', detail: 'conversation_busy' })
  })

  it('xoá lịch đang chạy → dừng, cuộc trò chuyện giữ lại thành cuộc thường', async () => {
    const s = create()
    ready()
    scheduler.runNow(s.id)
    const conversationId = scheduler.status().running!.conversationId
    expect(service.remove(s.id)).toBe(true)
    await flush()
    expect(runs[0].aborted).toBe(true)
    expect(convs.get(conversationId)?.scheduleId).toBeNull()
  })

  it('tắt tính năng → dừng lần đang chạy, bỏ hàng chờ', async () => {
    const a = create({ name: 'A' })
    create({ name: 'B' })
    ready()
    clock = at(2026, 11, 21, 8)
    scheduler.tick()
    settings = { ...settings, enabled: false }
    scheduler.setEnabled(false)
    await flush()
    expect(runs).toHaveLength(1)
    expect(repo.runs(a.id, 1)[0].status).toBe('aborted')
  })

  it('nextOccurrence lúc tạo lịch', () => {
    const s = create()
    expect(s.nextRunAt).toBe(nextOccurrence({ kind: 'daily', time: '08:00' }, clock))
  })
})

describe('ScheduleService — quyền và giới hạn', () => {
  let handle: ReturnType<typeof openDatabase>
  let owner = 'u1'
  let service: ScheduleService
  let repo: ScheduleRepository
  const folders = new Set(['C:\\a', 'C:\\b'])
  const scheduler = { forget: vi.fn(), tick: vi.fn() }

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations)
    owner = 'u1'
    repo = new ScheduleRepository(handle.db, () => owner)
    service = new ScheduleService({
      repo,
      scheduler: scheduler as never,
      now: () => at(2026, 11, 21, 7),
      isDirectory: (p) => folders.has(p),
      gmailAccounts: () => [
        { id: 'acc1', label: 'Trường' },
        { id: 'acc2', label: 'Cá nhân' }
      ]
    })
  })
  afterEach(() => handle.close())

  it('tạo lịch có quyền → phải xác nhận trước; không quyền → lưu thẳng', () => {
    expect(service.save({ input: input(), confirmed: false }).status).toBe('saved')
    const r = service.save({ input: input({ grants: { folder: 'C:\\a', gmailAccounts: ['acc1'], telegram: true } }), confirmed: false })
    expect(r).toEqual({
      status: 'confirm',
      added: [{ kind: 'folder', path: 'C:\\a' }, { kind: 'gmail', accountId: 'acc1', label: 'Trường' }, { kind: 'telegram' }]
    })
    expect(repo.list()).toHaveLength(1)
  })

  it('sửa lịch: THÊM quyền phải xác nhận lại, BỚT quyền lưu thẳng', () => {
    const created = service.save({ input: input({ grants: { folder: 'C:\\a', gmailAccounts: ['acc1'], telegram: false } }), confirmed: true })
    if (created.status !== 'saved') throw new Error()
    const id = created.schedule.id
    const more = service.save({ id, input: input({ grants: { folder: 'C:\\a', gmailAccounts: ['acc1', 'acc2'], telegram: true } }), confirmed: false })
    expect(more).toEqual({ status: 'confirm', added: [{ kind: 'gmail', accountId: 'acc2', label: 'Cá nhân' }, { kind: 'telegram' }] })
    expect(repo.get(id)?.grants.gmailAccounts).toEqual(['acc1'])
    const other = service.save({ id, input: input({ grants: { folder: 'C:\\b', gmailAccounts: ['acc1'], telegram: false } }), confirmed: false })
    expect(other).toMatchObject({ status: 'confirm', added: [{ kind: 'folder', path: 'C:\\b' }] })
    const less = service.save({ id, input: input(), confirmed: false })
    expect(less.status).toBe('saved')
    expect(repo.get(id)?.grants).toEqual(NO_GRANTS)
  })

  it('kiểm tra: thư mục không có, tài khoản Gmail lạ, dự án của người khác, giờ một lần đã qua', () => {
    expect(() => service.save({ input: input({ grants: { ...NO_GRANTS, folder: 'C:\\khong-co' } }), confirmed: true })).toThrow('folder_not_found')
    expect(() => service.save({ input: input({ grants: { ...NO_GRANTS, gmailAccounts: ['x'] } }), confirmed: true })).toThrow('gmail_account_not_found')
    const projects = new ProjectRepository(handle.db, () => 'u2')
    const p = projects.create({ name: 'Của u2', description: '' })
    expect(() => service.save({ input: input({ projectId: p.id }), confirmed: true })).toThrow('project_not_found')
    expect(() => service.save({ input: input({ recurrence: { kind: 'once', at: at(2026, 11, 20) } }), confirmed: true })).toThrow('once_past')
  })

  it('giới hạn 10 lịch đang bật / 20 lịch', () => {
    for (let i = 0; i < 10; i++) service.save({ input: input({ name: `L${i}` }), confirmed: true })
    expect(() => service.save({ input: input(), confirmed: true })).toThrow('limit_enabled')
    const first = repo.list()[0]
    service.setEnabled(first.id, false)
    expect(service.save({ input: input(), confirmed: true }).status).toBe('saved')
    expect(() => service.setEnabled(first.id, true)).toThrow('limit_enabled')
  })

  it('lịch theo tài khoản; xoá dự án → lịch giữ lại, bỏ dự án, tạm dừng', () => {
    const projects = new ProjectRepository(handle.db, () => owner)
    const p = projects.create({ name: 'Game', description: '' })
    const r = service.save({ input: input({ projectId: p.id }), confirmed: true })
    if (r.status !== 'saved') throw new Error()
    expect(projects.deleteInfo(p.id)?.schedules).toBe(1)
    projects.remove(p.id)
    expect(repo.get(r.schedule.id)).toMatchObject({ projectId: null, enabled: false, pausedReason: 'project_deleted' })
    owner = 'u2'
    expect(service.list()).toHaveLength(0)
  })
})
