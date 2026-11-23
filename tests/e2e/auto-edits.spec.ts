import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { goTo, openSettings, waitForStartup } from './helpers'

// Tự duyệt sửa file trong phiên (PR C) — chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT ("FAKE_WRITES:<file>=<nội
// dung>|…" ghi nhiều file qua bước duyệt như CLI), MMC_FAKE_FOLDER (hộp chọn thư mục giả).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
let app: ElectronApplication
let page: Page
let userData: string
let project: string

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_FOLDER: project }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-auto-edits-e2e-'))
  project = join(userData, 'DuAn')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'goc.txt'), 'nội dung gốc của người dùng\n')
  await launch()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const sendButton = (): ReturnType<Page['getByRole']> => page.getByRole('button', { name: 'Gửi' })
const lastReply = (): ReturnType<Page['getByTestId']> => page.getByTestId('message-assistant').last()
const codeCard = (): ReturnType<Page['locator']> => page.locator('[data-testid="approval-card"][data-kind="code"]')
const session = (): ReturnType<Page['locator']> => page.getByTestId('auto-edit-sessions').getByTestId('auto-edit-session')
const file = (name: string): string => join(project, name)

async function send(text: string): Promise<void> {
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}
const replyDone = async (text: string): Promise<void> => {
  await expect(lastReply()).toContainText(text, { timeout: 20_000 })
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
}

/** Thẻ sửa file đang chờ → "Đồng ý, và không hỏi lại" → hộp cảnh báo → Bật. */
async function acceptAuto(): Promise<void> {
  const c = codeCard()
  await expect(c).toBeVisible({ timeout: 20_000 })
  await c.getByTestId('approval-accept-auto').click()
  const dialog = page.getByTestId('auto-edit-start-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('DuAn')
  await expect(dialog).toContainText('50 file')
  await page.getByTestId('auto-edit-start-confirm').click()
  await expect(c).toHaveCount(0, { timeout: 1_000 })
}

test('cấp thư mục có quyền sửa', async () => {
  await goTo(page, '#/', box())
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Sửa code', write: true })}`)
  const folder = page.locator('[data-testid="approval-card"][data-kind="folder"]')
  await expect(folder).toBeVisible({ timeout: 20_000 })
  await folder.getByTestId('folder-access-write').check()
  await folder.getByTestId('folder-access-choose').click()
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  // Mặc định tắt: chưa có băng tự duyệt.
  await expect(page.getByTestId('auto-edit-sessions')).toHaveCount(0)
})

test('"Đồng ý, và không hỏi lại" → băng hiện trong 1 giây; các lần sửa sau không có thẻ, số file tăng', async () => {
  await send('FAKE_WRITES:a.txt=một')
  await acceptAuto()
  await expect(session()).toHaveAttribute('data-state', 'active', { timeout: 1_000 })
  await replyDone('Đã ghi: a.txt')
  await expect(session().getByTestId('auto-edit-count')).toHaveText(/1 file/, { timeout: 1_000 })

  await send('FAKE_WRITES:b.txt=hai|sub/c.txt=ba|goc.txt=trợ_lý_ghi_đè_nội_dung_gốc')
  await replyDone('Đã ghi: b.txt, sub/c.txt, goc.txt')
  await expect(codeCard()).toHaveCount(0)
  await expect(session().getByTestId('auto-edit-count')).toHaveText(/4 file/, { timeout: 1_000 })
  expect(readFileSync(file('sub/c.txt'), 'utf8')).toBe('ba\n')
  expect(readFileSync(file('goc.txt'), 'utf8')).toBe('trợ lý ghi đè nội dung gốc\n')
  await expect(session().getByTestId('auto-edit-status')).toContainText(/còn 1:5\d|còn 2:00/)

  await session().getByTestId('auto-edit-count').click()
  await expect(session().getByTestId('auto-edit-files')).toContainText('sub/c.txt')
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await page.getByTestId('chat-drop-zone').screenshot({ path: `test-results/auto-edit-banner-${theme}.png` })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
})

test('file "vẫn hỏi" (package.json): thẻ hiện, KHÔNG có nút tự duyệt, ghi rõ lý do', async () => {
  await send('FAKE_WRITES:package.json={}')
  const c = codeCard()
  await expect(c).toBeVisible({ timeout: 20_000 })
  await expect(c.getByTestId('approval-accept-auto')).toHaveCount(0)
  await expect(c.getByTestId('auto-edit-ask-reason')).toHaveAttribute('data-reason', 'risky')
  await expect(c.getByTestId('auto-edit-ask-reason')).toContainText('package.json')
  await c.getByTestId('approval-reject').click()
  await replyDone('Không ghi file nào.')
  expect(existsSync(file('package.json'))).toBe(false)
})

test('Hoàn tác tất cả: file về bản gốc, file trợ lý tạo bị xoá, băng biến mất trong 1 giây, nhật ký "Đã hoàn tác"', async () => {
  await session().getByTestId('auto-edit-undo').click()
  await page.getByTestId('auto-edit-undo-confirm').click()
  await expect(page.getByTestId('auto-edit-sessions')).toHaveCount(0, { timeout: 1_000 })
  expect(readFileSync(file('goc.txt'), 'utf8')).toBe('nội dung gốc của người dùng\n')
  for (const f of ['a.txt', 'b.txt', 'sub/c.txt']) expect(existsSync(file(f))).toBe(false)

  await openSettings(page, 'privacy', page.getByTestId('action-log-list'))
  const undone = page.locator('[data-testid="action-log-decision"][data-decision="undone"]')
  await expect(undone).toHaveCount(4, { timeout: 1_000 })
  await expect(undone.first()).toHaveText('Đã hoàn tác')
  await expect(page.locator('[data-testid="action-log-decision"][data-decision="always"]').first()).toHaveText('Đồng ý + tự duyệt phiên')
  await expect(page.locator('[data-testid="action-log-decision"][data-decision="auto"]')).toHaveCount(3)
  await page.keyboard.press('Escape')
})

test('Tắt → lại hỏi từng lần; phiên đã tắt vẫn Hoàn tác được; "Xong" ở Quyền & riêng tư bỏ phiên', async () => {
  await expect(box()).toBeVisible({ timeout: 5_000 })
  await send('FAKE_WRITES:d.txt=bốn')
  await acceptAuto()
  await replyDone('Đã ghi: d.txt')
  await session().getByTestId('auto-edit-stop').click()
  await expect(session()).toHaveAttribute('data-state', 'ended', { timeout: 1_000 })
  await expect(session().getByTestId('auto-edit-status')).toContainText('Đã tắt tự duyệt')
  await expect(session().getByTestId('auto-edit-undo')).toBeVisible()

  await send('FAKE_WRITES:e.txt=năm')
  const c = codeCard()
  await expect(c).toBeVisible({ timeout: 20_000 })
  await c.getByTestId('approval-accept').click()
  await replyDone('Đã ghi: e.txt')

  await openSettings(page, 'privacy', page.getByTestId('grant-auto-edits'))
  const row = page.getByTestId('grant-auto-edits').getByTestId('auto-edit-session')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('DuAn')
  await row.getByTestId('auto-edit-dismiss').click()
  await expect(page.getByTestId('grant-auto-edits-empty')).toBeVisible({ timeout: 1_000 })
  // Bỏ bản gốc = giữ thay đổi.
  expect(readFileSync(file('d.txt'), 'utf8')).toBe('bốn\n')
  await page.keyboard.press('Escape')
})

test('tắt app khi phiên đang chạy → mở lại: phiên đã kết thúc, vẫn Hoàn tác được từ Quyền & riêng tư', async () => {
  await send('FAKE_WRITES:f.txt=sáu')
  await acceptAuto()
  await replyDone('Đã ghi: f.txt')
  await send('FAKE_WRITES:goc.txt=lần_hai_trợ_lý_viết_lại_cả_file_này')
  await replyDone('Đã ghi: goc.txt')
  await app.close()

  await launch()
  await openSettings(page, 'privacy', page.getByTestId('grant-auto-edits'))
  const row = page.getByTestId('grant-auto-edits').getByTestId('auto-edit-session')
  await expect(row).toHaveAttribute('data-state', 'ended')
  await expect(row.getByTestId('auto-edit-status')).toContainText('app đã đóng')
  await row.getByTestId('auto-edit-undo').click()
  await page.getByTestId('auto-edit-undo-confirm').click()
  await expect(page.getByTestId('grant-auto-edits-empty')).toBeVisible({ timeout: 1_000 })
  expect(existsSync(file('f.txt'))).toBe(false)
  expect(readFileSync(file('goc.txt'), 'utf8')).toBe('nội dung gốc của người dùng\n')
})
