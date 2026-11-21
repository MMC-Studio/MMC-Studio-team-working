import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TeamWorkingApi } from '../../src/shared/types'
import { goTo, openSettings, waitForStartup } from './helpers'

// `window.api` trong page.evaluate (preload) — chỉ khai báo kiểu.
declare global {
  interface Window {
    api: TeamWorkingApi
  }
}

// Lịch hẹn (PR 7a): mặc định tắt, bật qua cảnh báo + hỏi khay, tạo lịch (quyền mới phải xác nhận), chạy CHỈ ĐỌC
// (trợ lý giả báo lại tool / model / max-turns / MCP ngoài / thẻ duyệt nó nhận được), nhật ký, chưa xem, chạy bù
// khi máy thức, thư mục mất → 3 lỗi → tự tạm dừng, hết giờ, dừng khẩn cấp, tạm dừng tất cả, trợ lý đề xuất lịch.
// Chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT (trợ lý giả) + MMC_FAKE_CLOCK (tua đồng hồ qua IPC test).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
const RUN = { timeout: 15_000 }
const MIN = 60_000
const HOUR = 60 * MIN
let app: ElectronApplication
let page: Page
let userData: string
let folder: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-schedules-e2e-'))
  folder = mkdtempSync(join(tmpdir(), 'mmc-schedules-folder-'))
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      TEAM_WORKING_USER_DATA: userData,
      MMC_FAKE_CHAT: '1',
      MMC_FAKE_CLOCK: '1',
      MMC_FAKE_FOLDER: folder
    }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
})

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const row = (name: string) => page.locator(`[data-testid="schedule-row"][data-name="${name}"]`)
/** Tổng thời gian đã tua (đồng hồ của main = giờ thật + chừng này). */
let advanced = 0
const advance = async (ms: number): Promise<void> => {
  advanced += ms
  await page.evaluate((x) => window.api.schedules.test.advance(x), ms)
}
/** Máy ngủ `ms` rồi thức dậy. */
const sleep = async (ms: number): Promise<void> => {
  advanced += ms
  await page.evaluate((x) => window.api.schedules.test.sleep(x), ms)
}
/** Bỏ qua 2 phút chờ sau khi mở app (bộ hẹn giờ không chạy ngay lúc vừa mở). */
const pastWakeDelay = () => advance(3 * MIN)

async function openSchedules(): Promise<void> {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-scheduled').click()
  await expect(page.getByTestId('schedules-page')).toBeVisible(FAST)
}

/** Mở trang của lịch `name` (nhật ký). */
async function openDetail(name: string): Promise<void> {
  await openSchedules()
  await row(name).click()
  await expect(page.getByTestId('schedule-name')).toHaveText(name, FAST)
}

async function createSchedule(name: string, prompt: string, opts: { folder?: boolean; kind?: 'daily' | 'hourly'; time?: string } = {}): Promise<void> {
  await page.getByTestId('schedule-new').click()
  const editor = page.getByTestId('schedule-editor')
  await editor.getByLabel('Tên lịch').fill(name)
  await editor.getByLabel('Lời nhắn gửi trợ lý mỗi lần chạy').fill(prompt)
  if (opts.kind) await page.getByTestId(`schedule-kind-${opts.kind}`).click()
  if (opts.time) await page.getByTestId('schedule-time').fill(opts.time)
  if (opts.folder) {
    await page.getByTestId('schedule-pick-folder').click()
    await expect(page.getByTestId('schedule-folder')).toHaveText(folder, FAST)
  }
  await page.getByTestId('schedule-save').click()
  if (opts.folder) {
    // Quyền mới → hộp xác nhận liệt kê đúng thư mục; Cho phép mới lưu.
    const confirm = page.getByTestId('schedule-grant-confirm')
    await expect(confirm).toBeVisible(FAST)
    await expect(page.getByTestId('schedule-grant-list')).toContainText(folder)
    await page.getByTestId('schedule-grant-allow').click()
  }
  await expect(row(name)).toBeVisible(FAST)
}

test('mặc định TẮT; bật lần đầu: cảnh báo + "Tôi hiểu" → hỏi ẩn xuống khay', async () => {
  await openSchedules()
  await expect(page.getByTestId('schedules-disabled')).toBeVisible()
  await expect(page.getByTestId('schedules-app-open-note')).toContainText('Chỉ chạy khi MMC studio đang mở')
  // Trợ lý chưa có tool đề xuất lịch khi tính năng tắt.
  await page.getByTestId('schedules-enable').click()
  const dialog = page.getByTestId('schedules-enable-dialog')
  await expect(dialog).toBeVisible(FAST)
  await expect(page.getByTestId('schedules-enable-warnings')).toContainText('hạn mức Claude của chính bạn')
  await expect(page.getByTestId('schedules-enable-confirm')).toBeDisabled()
  await page.getByTestId('schedules-ack').check()
  await page.getByTestId('schedules-enable-confirm').click()
  await expect(dialog).toContainText('Ẩn xuống khay khi đóng cửa sổ?', FAST)
  await page.getByTestId('schedules-tray-yes').click()
  await expect(dialog).toBeHidden(FAST)
  await expect(page.getByTestId('schedules-empty')).toBeVisible(FAST)
  // Cài đặt → Khả năng: công tắc bật, khay bật.
  await openSettings(page, 'capabilities', page.getByTestId('schedules-feature-switch'))
  await expect(page.getByTestId('schedules-feature-switch')).toBeChecked()
  await expect(page.getByTestId('schedules-tray-switch')).toBeChecked()
  await page.getByTestId('schedules-tray-switch').uncheck()
  await expect(page.getByTestId('schedules-tray-switch')).not.toBeChecked(FAST)
  await page.keyboard.press('Escape')
})

test('tạo lịch có thư mục → xác nhận quyền; "Chạy ngay" → cuộc mới CHỈ ĐỌC, nhật ký, số chưa xem', async () => {
  await openSchedules()
  await createSchedule('Đọc dự án', 'Xem thư mục và tóm tắt', { folder: true, time: '08:00' })
  await expect(row('Đọc dự án').getByTestId('schedule-summary')).toContainText('Hằng ngày lúc 08:00')
  await row('Đọc dự án').getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-run-now').click()
  await expect(row('Đọc dự án').getByTestId('schedule-unseen')).toHaveText('1', RUN)
  await expect(page.getByTestId('nav-scheduled-badge')).toHaveText('1', FAST)
  await row('Đọc dự án').click()
  const run = page.getByTestId('schedule-run').first()
  await expect(run).toHaveAttribute('data-status', 'done', FAST)
  await expect(run.getByTestId('schedule-run-text')).toContainText('Xong · chạy ngay')
  await run.getByTestId('schedule-run-open').click()
  const reply = page.getByTestId('message-assistant').last()
  // Lần chạy: chỉ Read/Grep/Glob, không tool app, không MCP ngoài, không thẻ duyệt, có câu "dữ liệu không phải lệnh".
  await expect(reply).toContainText('chạy lịch "Đọc dự án"', FAST)
  await expect(reply).toContainText('cli tools: Read,Grep,Glob | app tools: - | model: mặc định | max-turns: 25 | mcp ngoài: không | duyệt: không | dữ liệu không phải lệnh: có')
  // Tin của người dùng chỉ là lời nhắn (quy tắc của lần chạy không hiện).
  await expect(page.getByTestId('message-user').last()).toHaveText(/Xem thư mục và tóm tắt/)
  await expect(page.getByTestId('message-user').last()).not.toContainText('KHÔNG ngồi trước máy')
  await expect(page.getByTestId('chat-schedule-badge')).toHaveText('Từ lịch hẹn')
  // Mở cuộc → đã xem; cuộc từ lịch không hiện ở thanh bên.
  await expect(page.getByTestId('nav-scheduled-badge')).toHaveCount(0, FAST)
  await expect(page.getByTestId('conversation-item').filter({ hasText: 'Đọc dự án' })).toHaveCount(0)
})

test('sửa lịch: THÊM quyền phải xác nhận lại, BỎ quyền lưu thẳng; model Tiết kiệm → Haiku', async () => {
  await openDetail('Đọc dự án')
  await page.getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-edit').click()
  await page.getByRole('button', { name: 'Bỏ thư mục' }).click()
  await page.getByTestId('schedule-model').selectOption('cheap')
  await page.getByTestId('schedule-save').click()
  await expect(page.getByTestId('schedule-grant-confirm')).toHaveCount(0)
  await expect(page.getByTestId('schedule-grants-view')).toContainText('Không có quyền thêm', FAST)
  // Thêm lại thư mục → hỏi lại; Huỷ → không lưu.
  await page.getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-edit').click()
  await page.getByTestId('schedule-pick-folder').click()
  await page.getByTestId('schedule-save').click()
  await expect(page.getByTestId('schedule-grant-confirm')).toBeVisible(FAST)
  await page.getByTestId('schedule-grant-confirm').getByRole('button', { name: 'Hủy' }).click()
  await page.getByTestId('schedule-editor').getByRole('button', { name: 'Hủy' }).click()
  await expect(page.getByTestId('schedule-grants-view')).toContainText('Không có quyền thêm')
  await page.getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-edit').click()
  await page.getByTestId('schedule-pick-folder').click()
  await page.getByTestId('schedule-save').click()
  await page.getByTestId('schedule-grant-allow').click()
  await expect(page.getByTestId('schedule-grants-view')).toContainText(folder, FAST)
  await page.getByTestId('schedule-run-now-button').click()
  await expect(page.getByTestId('schedule-run').first()).toHaveAttribute('data-status', 'done', RUN)
  await page.getByTestId('schedule-run').first().getByTestId('schedule-run-open').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('model: cheap', FAST)
})

test('tới giờ → tự chạy; máy ngủ 3 giờ → thức dậy chạy bù MỘT lần sau 2 phút', async () => {
  await pastWakeDelay()
  await openSchedules()
  await createSchedule('Sáng', 'Chào buổi sáng', { time: '09:00' })
  // Tua tới đúng giờ hẹn (tính từ "bây giờ" của đồng hồ giả).
  const nextRunAt = await page.evaluate(async () => (await window.api.schedules.list()).find((x) => x.name === 'Sáng')!.nextRunAt!)
  await advance(Math.max(0, nextRunAt - (Date.now() + advanced)) + MIN)
  await openDetail('Sáng')
  await expect(page.getByTestId('schedule-run').first()).toHaveAttribute('data-status', 'done', RUN)
  // Máy "ngủ" qua giờ hẹn hôm sau 3 giờ rồi thức dậy: chờ 2 phút mới chạy bù.
  await sleep(24 * HOUR + 3 * HOUR - MIN)
  await page.waitForTimeout(500)
  await expect(page.getByTestId('schedule-run')).toHaveCount(1)
  await advance(3 * MIN)
  await expect(page.getByTestId('schedule-run')).toHaveCount(2, RUN)
  await expect(page.getByTestId('schedule-run').first()).toHaveAttribute('data-status', 'done', RUN)
  await expect(page.getByTestId('schedule-run').first().getByTestId('schedule-run-text')).toContainText('chạy bù')
})

test('thư mục bị xoá → "Không tìm thấy thư mục …", 3 lần liền → tự tạm dừng', async () => {
  rmSync(folder, { recursive: true, force: true })
  await openDetail('Đọc dự án')
  for (let i = 1; i <= 3; i++) {
    await page.getByTestId('schedule-run-now-button').click()
    await expect(page.locator('[data-testid="schedule-run"][data-reason="folder_missing"]')).toHaveCount(i, RUN)
  }
  await expect(page.locator('[data-testid="schedule-run"][data-reason="folder_missing"]').first()).toContainText(`Không tìm thấy thư mục ${folder}`)
  await expect(page.getByTestId('schedule-when')).toContainText('tạm dừng vì lỗi 3 lần liền', FAST)
  await expect(page.getByTestId('schedule-toggle')).not.toBeChecked()
})

test('chạy quá 10 phút → hết giờ; Ctrl+Alt+Q lúc đang chạy → dừng + tạm dừng tất cả', async () => {
  await openSchedules()
  await createSchedule('Chậm', 'Làm lâu FAKE_SLEEP:60000')
  await row('Chậm').getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-run-now').click()
  await expect(page.getByTestId('schedules-running-banner')).toBeVisible(RUN)
  await advance(11 * MIN)
  await openDetail('Chậm')
  await expect(page.getByTestId('schedule-run').first()).toHaveAttribute('data-status', 'timeout', RUN)
  // Lần 2: đang chạy thì nhấn phím dừng khẩn cấp.
  await page.getByTestId('schedule-run-now-button').click()
  await expect(page.getByTestId('schedules-running-banner')).toBeVisible(RUN)
  await page.evaluate(() => window.api.schedules.test.hotkey())
  await expect(page.getByTestId('schedule-run').first()).toHaveAttribute('data-reason', 'hotkey', RUN)
  await expect(page.getByTestId('schedules-paused-banner')).toContainText('dừng khẩn cấp', FAST)
  await openSchedules()
  await page.getByTestId('schedules-resume-all').click()
  await expect(page.getByTestId('schedules-paused-banner')).toHaveCount(0, FAST)
  // Tạm dừng tất cả → banner trong 1 giây; Tiếp tục → mất.
  await page.getByTestId('schedules-pause-all').click()
  await expect(page.getByTestId('schedules-paused-banner')).toBeVisible(FAST)
  await page.getByTestId('schedules-resume-all').click()
  await expect(page.getByTestId('schedules-paused-banner')).toHaveCount(0, FAST)
})

test('bật / tắt một lịch, bỏ qua lần tới, xoá (cuộc trò chuyện giữ lại)', async () => {
  await openSchedules()
  const toggle = row('Sáng').getByTestId('schedule-toggle')
  await toggle.uncheck()
  await expect(row('Sáng')).toHaveAttribute('data-state', 'off', FAST)
  await toggle.check()
  await expect(row('Sáng')).toHaveAttribute('data-state', 'on', FAST)
  await row('Sáng').getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-skip').click()
  await expect(row('Sáng').getByTestId('schedule-state')).toHaveText('bỏ qua lần tới', FAST)
  const conversations = await page.evaluate(async () => (await window.api.conversations.list()).filter((c) => c.title.startsWith('Sáng')).length)
  await row('Sáng').getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-delete').click()
  await page.getByTestId('schedule-delete-confirm').click()
  await expect(row('Sáng')).toHaveCount(0, FAST)
  const after = await page.evaluate(async () => (await window.api.conversations.list()).filter((c) => c.title.startsWith('Sáng')))
  expect(after).toHaveLength(conversations)
  expect(after.every((c) => c.scheduleId === null)).toBe(true)
})

test('trợ lý ĐỀ XUẤT lịch → thẻ duyệt → "Tạo lịch" mới tạo (chỉ đọc, không quyền)', async () => {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  const proposal = { name: 'Nhắc nộp báo cáo', prompt: 'Nhắc mình nộp báo cáo tuần', kind: 'weekly', time: '16:00', days: [5] }
  await box().fill(`FAKE_TOOL:propose_schedule ${JSON.stringify(proposal)}`)
  await box().press('Enter')
  const card = page.locator('[data-testid="approval-card"][data-kind="schedule"]')
  await expect(card).toBeVisible(RUN)
  await expect(card.getByTestId('schedule-proposal-when')).toHaveText('T6 lúc 16:00')
  await expect(card).toContainText('chỉ đọc')
  // Chưa bấm → chưa có lịch.
  expect(await page.evaluate(async () => (await window.api.schedules.list()).some((s) => s.name === 'Nhắc nộp báo cáo'))).toBe(false)
  await card.getByTestId('schedule-proposal-accept').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Đã tạo lịch hẹn "Nhắc nộp báo cáo"', RUN)
  const created = await page.evaluate(async () => (await window.api.schedules.list()).find((s) => s.name === 'Nhắc nộp báo cáo')!)
  expect(created).toMatchObject({ origin: 'assistant', grants: { folder: null, gmailAccounts: [], telegram: false } })
})

test('xoá dự án → lịch giữ lại, bỏ dự án, tạm dừng', async () => {
  const projectId = await page.evaluate(async () => (await window.api.projects.create({ name: 'Game' })).id)
  await openSchedules()
  await page.getByTestId('schedule-new').click()
  await page.getByLabel('Tên lịch').fill('Của dự án')
  await page.getByLabel('Lời nhắn gửi trợ lý mỗi lần chạy').fill('Tóm tắt tiến độ')
  await page.getByTestId('schedule-project').selectOption(projectId)
  await page.getByTestId('schedule-save').click()
  await expect(row('Của dự án').getByTestId('schedule-summary')).toContainText('Game', FAST)
  await page.getByTestId('nav-projects').click()
  await page.locator('[data-testid="project-card"][data-name="Game"]').click()
  await expect(page.getByTestId('project-name')).toHaveText('Game', FAST)
  await expect(page.getByTestId('project-schedule')).toHaveText(/Của dự án/, FAST)
  await page.getByTestId('project-menu').click()
  await page.getByTestId('project-menu-delete').click()
  await expect(page.getByTestId('project-delete-schedules')).toContainText('1 lịch hẹn', FAST)
  await page.getByTestId('project-delete-confirm').click()
  await openSchedules()
  await expect(row('Của dự án')).toHaveAttribute('data-state', 'project_deleted', FAST)
  await expect(row('Của dự án').getByTestId('schedule-summary')).not.toContainText('Game')
})

test('Ctrl+K tab Lịch hẹn; ảnh sáng / tối 900 / 1280px', async () => {
  await goTo(page, '#/', box())
  await page.keyboard.press('Control+k')
  await page.getByTestId('search-palette').locator('input').fill('đọc dự án')
  await expect(page.getByTestId('search-palette')).toContainText('Đọc dự án', FAST)
  await page.keyboard.press('Escape')
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      await openSchedules()
      if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) await page.getByTestId('theme-toggle').click()
      expect(await page.getByTestId('schedules-page').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: `test-results/schedules-${theme}-${width}.png` })
      await row('Đọc dự án').click()
      await expect(page.getByTestId('schedule-page')).toBeVisible(FAST)
      await page.screenshot({ path: `test-results/schedule-${theme}-${width}.png` })
      await page.getByTestId('schedule-menu').click()
      await page.getByTestId('schedule-edit').click()
      await page.screenshot({ path: `test-results/schedule-editor-${theme}-${width}.png` })
      await page.keyboard.press('Escape')
    }
  }
  await page.getByTestId('theme-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})
