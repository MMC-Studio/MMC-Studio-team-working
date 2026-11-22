import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Chạy lệnh git (A1) — chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT ("FAKE_TOOL:run_command {json}" gọi tool như
// CLI thật), MMC_FAKE_FOLDER (hộp chọn thư mục giả). git chạy THẬT trên một repo tạm có cấu hình "độc" (filter ghi file
// đánh dấu) để kiểm app không để repo chạy chương trình.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
let app: ElectronApplication
let page: Page
let userData: string
let project: string
let marker: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-commands-e2e-'))
  project = join(userData, 'GameRepo')
  marker = join(userData, 'marker.txt')
  mkdirSync(project)
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: project, stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  writeFileSync(join(project, 'Player.cs'), 'class Player {}\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  const script = join(userData, 'pwn.js')
  writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(marker)}, 'ran\\n')`)
  git('config', 'filter.evil.clean', `"${process.execPath.replace(/\\/g, '/')}" "${script.replace(/\\/g, '/')}"`)
  writeFileSync(join(project, '.gitattributes'), '*.cs filter=evil\n')
  writeFileSync(join(project, 'Player.cs'), 'class Player { int hp; }\n')
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_FOLDER: project }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const send = async (text: string): Promise<void> => {
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}
const run = (input: object): string =>
  `FAKE_TOOL:run_command ${JSON.stringify({ program: 'git', reason: 'Xem file nào đã đổi', ...input })}`
const lastReply = (): ReturnType<Page['getByTestId']> => page.getByTestId('message-assistant').last()
/** Lượt trả lời đã xong (nút Gửi hiện lại) và tin trợ lý cuối có chữ — rồi mới kiểm "không có". */
const settled = async (): Promise<void> => {
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  await expect(lastReply()).toContainText('giả lập', { timeout: 20_000 })
}

test('mặc định tắt: chưa có tool chạy lệnh, không có thẻ', async () => {
  await goTo(page, '#/', box())
  // Cấp thư mục (chỉ đọc) qua thẻ xin quyền.
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Xem repo', write: false })}`)
  await page.getByTestId('folder-access-choose').click({ timeout: 20_000 })
  await expect(page.getByTestId('code-bar')).toContainText('GameRepo', { timeout: 1_000 })
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })

  const before = await page.getByTestId('message-assistant').count()
  await send(run({ subcommand: 'status', args: ['--short'] }))
  await expect(page.getByTestId('message-assistant')).toHaveCount(before + 1, { timeout: 20_000 })
  await settled()
  await expect(lastReply()).not.toContainText('KẾT QUẢ TOOL')
  await expect(page.getByTestId('command-approval')).toHaveCount(0)
})

test('bật trong Cài đặt → Khả năng: công tắc đổi ngay, hiện git app sẽ dùng', async () => {
  await page.evaluate(() => (window.location.hash = '#/?settings=capabilities'))
  const sw = page.getByTestId('commands-git-switch')
  await expect(sw).toBeVisible({ timeout: 5_000 })
  await expect(sw).not.toBeChecked()
  await expect(page.getByTestId('commands-git-status')).toContainText(/git: .+git(\.exe)? \(/)
  await sw.check()
  await expect(sw).toBeChecked({ timeout: 1_000 })
  await page.keyboard.press('Escape')
})

test('thẻ duyệt hiện nguyên lệnh + thư mục; Chạy → output về trợ lý; filter của repo KHÔNG chạy', async () => {
  await send(run({ subcommand: 'status', args: ['--short'] }))
  const card = page.getByTestId('command-approval')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('command-display')).toHaveText('git status --short -- .')
  await expect(page.getByTestId('command-cwd')).toHaveText(project)
  await expect(card).toContainText('Xem file nào đã đổi')
  await page.getByTestId('command-full-toggle').click()
  await expect(page.getByTestId('command-full')).toContainText('--attr-source=')
  await expect(page.getByTestId('command-full')).toContainText('filter.evil.clean=')
  await screenshot('command-card')

  await page.getByTestId('approval-accept').click()
  await expect(card).toHaveCount(0, { timeout: 1_000 })
  await expect(lastReply()).toContainText('KẾT QUẢ TOOL: $ git status --short -- .', { timeout: 20_000 })
  await expect(lastReply()).toContainText('Player.cs')
  expect(existsSync(marker)).toBe(false)
})

test('Từ chối → không chạy, trợ lý được báo', async () => {
  await send(run({ subcommand: 'log', args: ['--oneline'] }))
  const card = page.getByTestId('command-approval')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('command-display')).toHaveText('git log --oneline -- .')
  await page.getByTestId('approval-reject').click()
  await expect(card).toHaveCount(0, { timeout: 1_000 })
  await expect(lastReply()).toContainText('LỖI TOOL: Người dùng không cho chạy lệnh này', { timeout: 20_000 })
})

test('cờ ghi file (--output) → app chặn ngay, không hiện thẻ', async () => {
  await send(run({ subcommand: 'diff', args: ['--output=out.txt'] }))
  await expect(lastReply()).toContainText('LỖI TOOL: Không chạy: Cờ không được phép với git diff: --output', { timeout: 20_000 })
  await expect(page.getByTestId('command-approval')).toHaveCount(0)
  expect(existsSync(join(project, 'out.txt'))).toBe(false)
})

test('tắt trong Cài đặt → lượt sau không còn tool', async () => {
  await page.evaluate(() => (window.location.hash = '#/?settings=capabilities'))
  const sw = page.getByTestId('commands-git-switch')
  await sw.uncheck()
  await expect(sw).not.toBeChecked({ timeout: 1_000 })
  await page.keyboard.press('Escape')
  const before = await page.getByTestId('message-assistant').count()
  await send(run({ subcommand: 'status', args: [] }))
  await expect(page.getByTestId('message-assistant')).toHaveCount(before + 1, { timeout: 20_000 })
  await settled()
  await expect(lastReply()).not.toContainText('KẾT QUẢ TOOL')
  await expect(page.getByTestId('command-approval')).toHaveCount(0)
})

async function screenshot(name: string): Promise<void> {
  const card = page.getByTestId('command-approval')
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await card.screenshot({ path: `test-results/${name}-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
}
