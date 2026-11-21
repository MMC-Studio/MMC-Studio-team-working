import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TeamWorkingApi } from '../../src/shared/types'
import { goTo, waitForStartup } from './helpers'

declare global {
  interface Window {
    api: TeamWorkingApi
  }
}

// Lịch hẹn 7b — hoãn duyệt: lần chạy theo lịch KHÔNG dừng chờ; đề xuất sửa file thành MỘT "Bộ thay đổi" (diff từ bản
// gốc tới bản cuối, kiểm hash lúc Đồng ý), nháp Gmail thành thẻ riêng (người nhận to rõ, cảnh báo người lạ, không
// "Đồng ý tất cả"). Thẻ lưu DB (tắt / mở app vẫn còn), hết hạn 7 ngày; Hỏi + Yêu cầu sửa (lượt mới cùng cuộc).
// Chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT + MMC_FAKE_CLOCK + MMC_FAKE_GMAIL.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
const RUN = { timeout: 15_000 }
let app: ElectronApplication
let page: Page
let userData: string
let folder: string
let advanced = 0

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_CLOCK: '1', MMC_FAKE_GMAIL: '1', MMC_FAKE_FOLDER: folder }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-deferred-e2e-'))
  folder = mkdtempSync(join(tmpdir(), 'mmc-deferred-folder-'))
  writeFileSync(join(folder, 'a.txt'), 'gốc\n')
  await launch()
  // Bật lịch hẹn (đã có e2e riêng cho hộp cảnh báo) + Gmail giả một tài khoản.
  await page.evaluate(async () => {
    await window.api.schedules.setFeature({ enabled: true, acknowledged: true, trayOnClose: false })
    await window.api.gmail.setCredentials({ clientId: 'e2e.apps.googleusercontent.com', clientSecret: 'secret' })
    await window.api.gmail.setEnabled(true)
    await window.api.gmail.connect()
  })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
})

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const row = (name: string) => page.locator(`[data-testid="schedule-row"][data-name="${name}"]`)
const cards = (kind: 'changeset' | 'draft') => page.locator(`[data-testid="deferred-card"][data-kind="${kind}"]`)
const file = (path: string) => page.locator(`[data-testid="deferred-file"][data-path="${path}"]`)

async function openSchedules(): Promise<void> {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-scheduled').click()
  await expect(page.getByTestId('schedules-page')).toBeVisible(FAST)
}

async function openLastRun(name: string): Promise<void> {
  await openSchedules()
  await row(name).click()
  await page.getByTestId('schedule-run').first().getByTestId('schedule-run-open').click()
  await expect(page.getByTestId('chat-schedule-badge')).toBeVisible(FAST)
}

const PROMPT = 'Dọn dự án FAKE_PROPOSE:a.txt=bản_1 FAKE_PROPOSE:a.txt=bản_2 FAKE_PROPOSE:src/moi.txt=xin_chào FAKE_GMAIL_DRAFT:la@ngoai.example FAKE_GMAIL_DRAFT:lan@example.com'

test('tạo lịch có quyền đề xuất sửa + soạn nháp → hộp xác nhận liệt kê đủ quyền mới', async () => {
  await openSchedules()
  await page.getByTestId('schedule-new').click()
  await page.getByLabel('Tên lịch').fill('Dọn dẹp')
  await page.getByLabel('Lời nhắn gửi trợ lý mỗi lần chạy').fill(PROMPT)
  await page.getByTestId('schedule-pick-folder').click()
  await page.getByTestId('schedule-folder-write').check()
  await page.locator('[data-testid^="schedule-gmail-"]').first().check()
  await page.getByTestId('schedule-drafts').check()
  await page.getByTestId('schedule-save').click()
  const list = page.getByTestId('schedule-grant-list')
  await expect(list.getByTestId('grant-folder')).toContainText(folder, FAST)
  await expect(list.getByTestId('grant-folderWrite')).toContainText('bạn duyệt từng file sau')
  await expect(list.getByTestId('grant-gmail')).toBeVisible()
  await expect(list.getByTestId('grant-drafts')).toBeVisible()
  await page.getByTestId('schedule-grant-allow').click()
  await expect(row('Dọn dẹp')).toBeVisible(FAST)
})

test('chạy: KHÔNG dừng chờ — một "Bộ thay đổi" (a.txt bản 2, file mới) + 2 thẻ nháp; file trên đĩa chưa đổi', async () => {
  await row('Dọn dẹp').getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-run-now').click()
  await expect(row('Dọn dẹp').getByTestId('schedule-pending')).toHaveText('3 chờ duyệt', RUN)
  // Số trên thanh bên = chưa xem + việc chờ duyệt.
  await expect(page.getByTestId('nav-scheduled-badge')).toHaveText('4', FAST)
  await openLastRun('Dọn dẹp')
  await expect(page.getByTestId('message-assistant').last()).toContainText('OK đề xuất a.txt')
  await expect(cards('changeset')).toHaveCount(1)
  await expect(cards('changeset')).toContainText('Bộ thay đổi · 2 file')
  await expect(file('a.txt')).toContainText('Bản 2')
  await expect(file('a.txt')).toContainText('+bản 2')
  await expect(file('a.txt')).toContainText('-gốc')
  await expect(file('src/moi.txt')).toContainText('file mới')
  expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('gốc\n')
  expect(existsSync(join(folder, 'src', 'moi.txt'))).toBe(false)
  // Nháp: người nhận to rõ; người chưa từng liên lạc có cảnh báo; không có nút "Đồng ý tất cả" cho nháp.
  await expect(cards('draft')).toHaveCount(2)
  const stranger = cards('draft').filter({ hasText: 'la@ngoai.example' })
  await expect(stranger.getByTestId('deferred-recipients')).toHaveText('la@ngoai.example')
  await expect(stranger.getByTestId('deferred-unknown')).toContainText('CHƯA TỪNG liên lạc')
  await expect(cards('draft').filter({ hasText: 'lan@example.com' }).getByTestId('deferred-unknown')).toHaveCount(0)
  await expect(page.getByTestId('deferred-approve-all')).toHaveCount(1)
  await expect(cards('draft').getByTestId('deferred-approve-all')).toHaveCount(0)
})

test('Đồng ý tất cả file: file đã bị sửa trên đĩa → KHÔNG ghi đè; file mới → ghi', async () => {
  writeFileSync(join(folder, 'a.txt'), 'bạn vừa sửa\n')
  await page.getByTestId('deferred-approve-all').click()
  await expect(file('src/moi.txt')).toHaveAttribute('data-status', 'applied', FAST)
  await expect(file('a.txt')).toHaveAttribute('data-status', 'conflict', FAST)
  await expect(file('a.txt').getByTestId('deferred-file-error')).toContainText('File đã thay đổi sau khi đề xuất')
  expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('bạn vừa sửa\n')
  expect(readFileSync(join(folder, 'src', 'moi.txt'), 'utf8')).toBe('xin chào')
  await file('a.txt').getByTestId('deferred-file-reject').click()
  await expect(cards('changeset')).toHaveAttribute('data-status', 'done', FAST)
})

test('nháp: duyệt TỪNG cái (sửa được nội dung); Hỏi → trợ lý giải thích dưới thẻ', async () => {
  const known = cards('draft').filter({ hasText: 'lan@example.com' })
  await known.getByTestId('deferred-draft-body').fill('Nội dung đã sửa')
  await known.getByTestId('deferred-draft-approve').click()
  await expect(known).toHaveAttribute('data-status', 'done', FAST)
  const stranger = cards('draft').filter({ hasText: 'la@ngoai.example' })
  await expect(stranger).toHaveAttribute('data-status', 'pending')
  await stranger.getByTestId('deferred-input').fill('Người này là ai?')
  await stranger.getByTestId('deferred-ask').click()
  await expect(stranger.getByTestId('deferred-answer')).toContainText('Người này là ai?', RUN)
})

test('tắt rồi mở lại app → thẻ chờ duyệt vẫn còn (lưu DB)', async () => {
  await app.close()
  await launch()
  await openLastRun('Dọn dẹp')
  await expect(cards('draft').filter({ hasText: 'la@ngoai.example' })).toHaveAttribute('data-status', 'pending', FAST)
  await expect(cards('changeset')).toHaveAttribute('data-status', 'done')
})

test('Yêu cầu sửa → lượt mới CÙNG cuộc (tính vào giới hạn ngày), thẻ cũ khép lại, đề xuất mới xuất hiện', async () => {
  const before = await page.evaluate(async () => (await window.api.schedules.status()).today)
  const stranger = cards('draft').filter({ hasText: 'la@ngoai.example' })
  await stranger.getByTestId('deferred-input').fill('Đừng gửi cho người lạ')
  await stranger.getByTestId('deferred-revise').click()
  await expect(stranger).toHaveAttribute('data-status', 'revised', FAST)
  await expect(cards('changeset')).toHaveCount(2, RUN)
  await expect(page.getByTestId('message-user').last()).toHaveText(/Đừng gửi cho người lạ/)
  expect(await page.evaluate(async () => (await window.api.schedules.status()).today)).toBe(before + 1)
  const lastRun = () =>
    page.evaluate(async () => {
      const s = (await window.api.schedules.list()).find((x) => x.name === 'Dọn dẹp')!
      return (await window.api.schedules.runs(s.id, 5))[0]
    })
  await expect.poll(lastRun, RUN).toMatchObject({ trigger: 'revision', status: 'done' })
})

test('quá 7 ngày → thẻ hết hạn, không còn nút duyệt', async () => {
  // Tắt lịch trước (không thì lịch hằng ngày tự chạy bù trong 8 ngày đó, tạo thẻ mới).
  await page.evaluate(async () => {
    const s = (await window.api.schedules.list()).find((x) => x.name === 'Dọn dẹp')!
    await window.api.schedules.setEnabled(s.id, false)
  })
  advanced += 8 * 24 * 60 * 60 * 1000
  await page.evaluate((ms) => window.api.schedules.test.advance(ms), 8 * 24 * 60 * 60 * 1000)
  await openLastRun('Dọn dẹp')
  await expect(page.locator('[data-testid="deferred-card"][data-status="pending"]')).toHaveCount(0, RUN)
  await expect(page.locator('[data-testid="deferred-card"][data-status="expired"]').first().getByTestId('deferred-state')).toHaveText('Đã hết hạn (quá 7 ngày)')
  await expect(page.getByTestId('deferred-file-approve')).toHaveCount(0)
  await expect(page.getByTestId('deferred-draft-approve')).toHaveCount(0)
})

test('ảnh sáng / tối 900 / 1280px', async () => {
  // Một lần chạy mới để có thẻ đang chờ trong ảnh. Gmail giả giữ token trong bộ nhớ → mở lại app phải kết nối lại.
  writeFileSync(join(folder, 'a.txt'), 'gốc\n')
  await page.evaluate(() => window.api.gmail.connect())
  await openSchedules()
  await row('Dọn dẹp').getByTestId('schedule-menu').click()
  await page.getByTestId('schedule-run-now').click()
  await expect(row('Dọn dẹp').getByTestId('schedule-pending')).toBeVisible(RUN)
  await openLastRun('Dọn dẹp')
  await expect(page.getByTestId('chat-schedule-stop')).toHaveCount(0, RUN)
  await expect(cards('draft')).toHaveCount(2, RUN)
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) await page.getByTestId('theme-toggle').click()
      await cards('changeset').last().scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/deferred-changeset-${theme}-${width}.png` })
      await cards('draft').last().scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/deferred-draft-${theme}-${width}.png` })
    }
  }
  await page.getByTestId('theme-toggle').click()
  void advanced
})
