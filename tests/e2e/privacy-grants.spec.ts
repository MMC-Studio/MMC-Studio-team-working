import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Quyền đang cấp + thu hồi (Cài đặt → Quyền & riêng tư, B2) — chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT
// ("FAKE_TOOL:request_folder_access" xin thư mục, "FAKE_EDIT:<file>" xin sửa file qua thẻ), MMC_FAKE_FOLDER (hộp chọn
// thư mục giả), MMC_FAKE_GMAIL (một tài khoản Gmail giả cho quyền lịch hẹn).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string
let project: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-privacy-e2e-'))
  project = join(userData, 'DuAnQuyen')
  mkdirSync(project)
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_GMAIL: '1', MMC_FAKE_FOLDER: project }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const sendButton = (): ReturnType<Page['getByRole']> => page.getByRole('button', { name: 'Gửi' })
const card = (kind: string): ReturnType<Page['locator']> => page.locator(`[data-testid="approval-card"][data-kind="${kind}"]`)
const connection = (key: string): ReturnType<Page['locator']> => page.locator(`[data-testid="grant-connection"][data-key="${key}"]`)
const scheduleGrant = (key: string): ReturnType<Page['locator']> => page.locator(`[data-testid="grant-schedule-item"][data-key="${key}"]`)

async function send(text: string): Promise<void> {
  await goTo(page, '#/', box())
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}

async function openPrivacy(): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/?settings=privacy'))
  await expect(page.getByTestId('settings-tab-privacy')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 })
}

test('chưa cấp gì: thư mục / lịch trống; git, Gmail, Telegram, agent, MCP đều "Đang tắt", không có công tắc', async () => {
  await openPrivacy()
  await expect(page.getByTestId('grant-folders-empty')).toBeVisible()
  await expect(page.getByTestId('grant-schedules-empty')).toBeVisible()
  await expect(page.getByTestId('grant-git-status')).toHaveText('Đang tắt')
  await expect(page.getByTestId('grant-connection')).toHaveCount(4)
  for (const key of ['gmail', 'telegram', 'agents', 'mcp'])
    await expect(connection(key).getByTestId('grant-connection-status')).toHaveText('Đang tắt')
  // Chỉ trạng thái: không có công tắc nào trong phần quyền đang cấp.
  await expect(page.locator('[data-setting-id^="grant"] [role="switch"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('cấp thư mục đọc + sửa → hiện trong tab; thu hồi khi đang có thẻ chờ → dòng mất, thẻ bị huỷ, thanh thư mục mất', async () => {
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Sửa file', write: true })}`)
  // Ô "Cho phép sửa file" không tick sẵn (kể cả khi trợ lý xin quyền sửa) — người dùng tự tick.
  await card('folder').getByTestId('folder-access-write').check({ timeout: 20_000 })
  await card('folder').getByTestId('folder-access-choose').click()
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })

  await openPrivacy()
  const row = page.getByTestId('grant-folder')
  await expect(row).toHaveCount(1, FAST)
  await expect(row).toContainText('DuAnQuyen')
  await expect(row.getByTestId('grant-folder-access')).toHaveText('Đọc + sửa')
  await page.keyboard.press('Escape')

  // Trợ lý đang chờ duyệt sửa file thì người dùng thu hồi.
  await send('FAKE_EDIT:x.txt')
  await expect(card('code')).toBeVisible({ timeout: 20_000 })
  await openPrivacy()
  await row.getByTestId('grant-folder-revoke').click()
  await expect(row).toHaveCount(0, FAST)
  await expect(page.getByTestId('grant-folders-empty')).toBeVisible(FAST)
  // Nhật ký (B1) ghi thẻ bị dừng.
  await expect(page.locator('[data-testid="action-log-row"][data-kind="file_edit"]').first().getByTestId('action-log-decision')).toHaveAttribute(
    'data-decision',
    'stopped',
    FAST
  )
  await page.keyboard.press('Escape')
  await expect(card('code')).toHaveCount(0, FAST)
  await expect(page.getByTestId('code-bar')).toHaveCount(0, FAST)
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
})

test('"Gỡ thư mục" trên thanh thư mục cũng huỷ thẻ đang chờ (cùng một cách thu hồi)', async () => {
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Sửa lại', write: true })}`)
  // Ô "Cho phép sửa file" không tick sẵn (kể cả khi trợ lý xin quyền sửa) — người dùng tự tick.
  await card('folder').getByTestId('folder-access-write').check({ timeout: 20_000 })
  await card('folder').getByTestId('folder-access-choose').click()
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await send('FAKE_EDIT:y.txt')
  await expect(card('code')).toBeVisible({ timeout: 20_000 })
  const conversationId = await page.evaluate(async () => (await window.api.approvals.list())[0].conversationId)
  await page.evaluate((id) => window.api.code.clearFolder(id), conversationId)
  await expect(card('code')).toHaveCount(0, FAST)
  await expect(page.getByTestId('code-bar')).toHaveCount(0, FAST)
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
})

test('lệnh git: chỉ hiện trạng thái chung; "Đổi ở Khả năng" nhảy tới công tắc; bật → tab hiện "Đang bật"', async () => {
  await openPrivacy()
  await page.getByTestId('grant-git-open').click()
  await expect(page.getByTestId('settings-tab-capabilities')).toHaveAttribute('aria-current', 'page', FAST)
  const sw = page.getByTestId('commands-git-switch')
  await expect(sw).toBeVisible()
  await sw.check()
  await page.getByTestId('settings-tab-privacy').click()
  await expect(page.getByTestId('grant-git-status')).toHaveText('Đang bật', FAST)
  await page.keyboard.press('Escape')
})

test('quyền lịch hẹn: từng quyền một dòng; thu hồi Telegram / Gmail → mất ngay, lưu đúng; thu hồi thư mục → mất cả đề xuất sửa', async () => {
  const scheduleId = await page.evaluate(async (folder) => {
    await window.api.schedules.setFeature({ enabled: true, acknowledged: true, trayOnClose: false })
    await window.api.gmail.setCredentials({ clientId: 'e2e.apps.googleusercontent.com', clientSecret: 'secret' })
    await window.api.gmail.setEnabled(true)
    await window.api.gmail.connect()
    const account = (await window.api.gmail.status()).accounts[0].id
    const r = await window.api.schedules.save({
      input: {
        name: 'Tổng hợp sáng',
        prompt: 'Tóm tắt',
        recurrence: { kind: 'daily', time: '08:00' },
        projectId: null,
        grants: { folder, folderWrite: true, gmailAccounts: [account], telegram: true, drafts: true },
        model: 'default',
        catchUp: false
      },
      confirmed: true
    })
    if (r.status !== 'saved') throw new Error(JSON.stringify(r))
    return r.schedule.id
  }, project)
  await openPrivacy()
  const schedule = page.locator(`[data-testid="grant-schedule"][data-schedule="${scheduleId}"]`)
  await expect(schedule).toContainText('Tổng hợp sáng', FAST)
  await expect(schedule.getByTestId('grant-schedule-item')).toHaveCount(5)
  await expect(connection('gmail').getByTestId('grant-connection-status')).toHaveText('Đang bật', FAST)

  await scheduleGrant('telegram').getByTestId('grant-schedule-revoke').click()
  await expect(scheduleGrant('telegram')).toHaveCount(0, FAST)
  const gmailKey = await schedule.locator('[data-testid="grant-schedule-item"][data-key^="gmail:"]').getAttribute('data-key')
  await scheduleGrant(gmailKey!).getByTestId('grant-schedule-revoke').click()
  await expect(scheduleGrant(gmailKey!)).toHaveCount(0, FAST)
  await scheduleGrant('folder').getByTestId('grant-schedule-revoke').click()
  await expect(scheduleGrant('folder')).toHaveCount(0, FAST)
  await expect(scheduleGrant('folderWrite')).toHaveCount(0, FAST)
  await expect(schedule.getByTestId('grant-schedule-item')).toHaveCount(1)
  const grants = await page.evaluate(async (id) => (await window.api.schedules.list()).find((s) => s.id === id)!.grants, scheduleId)
  expect(grants).toEqual({ folder: null, folderWrite: false, gmailAccounts: [], telegram: false, drafts: true })

  await screenshot('privacy-grants')

  // Quyền cuối → lịch biến khỏi danh sách.
  await scheduleGrant('drafts').getByTestId('grant-schedule-revoke').click()
  await expect(page.getByTestId('grant-schedules-empty')).toBeVisible(FAST)
})

test('Gmail / Telegram / agent / MCP: "Mở trang Plugin" đóng Cài đặt và mở đúng trang', async () => {
  await connection('mcp').getByTestId('grant-connection-open').click()
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0, FAST)
  expect(await page.evaluate(() => window.location.hash)).toBe('#/plugins/mcp')
})

/** Ảnh cửa sổ Cài đặt ở giao diện sáng + tối (đổi lớp `dark` như cài đặt giao diện làm). */
async function screenshot(name: string): Promise<void> {
  const dialog = page.getByTestId('settings-dialog')
  // Chụp từ đầu tab (phần quyền đang cấp), không phải chỗ vừa cuộn tới.
  await page.locator('[data-setting-id="grantFolders"]').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await dialog.screenshot({ path: `test-results/${name}-${theme}.png` })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}
