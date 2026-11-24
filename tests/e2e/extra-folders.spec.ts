import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Thư mục phụ (D) — chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT ("FAKE_TOOL:request_folder_access" xin thư mục
// chính, "FAKE_EDIT:<đường dẫn tuyệt đối>" xin sửa file ở thư mục phụ, "FAKE_WRITES:" ghi file thư mục chính),
// MMC_FAKE_FOLDER (thư mục chính). Hộp chọn thư mục phụ / đổi thư mục: thay `dialog.showOpenDialog` ở main.
// Thư mục phụ đặt trong test-results/ của repo, KHÔNG trong %TEMP% — %TEMP% nằm dưới AppData nên app chặn (đúng luật).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string
let project: string
let extrasBase: string
let libA: string
let libB: string
let libC: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-extra-e2e-'))
  mkdirSync(join(ROOT, 'test-results'), { recursive: true })
  extrasBase = mkdtempSync(join(ROOT, 'test-results', 'extra-e2e-'))
  // Thư mục chính cũng ngoài %TEMP%: thư mục phụ trùng nó phải báo "chồng lấn", không phải "vùng hệ thống".
  project = join(extrasBase, 'DuAnChinh')
  mkdirSync(join(project, 'sub'), { recursive: true })
  libA = join(extrasBase, 'ThuVienA')
  libB = join(extrasBase, 'ThuVienB')
  libC = join(extrasBase, 'ThuVienC')
  for (const d of [libA, libB, libC]) mkdirSync(d)
  writeFileSync(join(libA, 'b.txt'), 'gốc\n')
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_FOLDER: project }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(extrasBase, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const sendButton = (): ReturnType<Page['getByRole']> => page.getByRole('button', { name: 'Gửi' })
const card = (kind: string): ReturnType<Page['locator']> => page.locator(`[data-testid="approval-card"][data-kind="${kind}"]`)
const chips = (): ReturnType<Page['getByTestId']> => page.getByTestId('extra-folder')
const chip = (path: string): ReturnType<Page['locator']> => page.locator(`[data-testid="extra-folder"][data-path="${path.replace(/\\/g, '\\\\')}"]`)
const addButton = (): ReturnType<Page['getByTestId']> => page.getByTestId('extra-folder-add')
const lastReply = (): ReturnType<Page['getByTestId']> => page.getByTestId('message-assistant').last()

async function send(text: string): Promise<void> {
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}

/** Lần mở hộp chọn thư mục tiếp theo (thêm thư mục phụ / đổi thư mục chính) trả về `path`. */
async function pickNext(path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, path)
}

async function tryAdd(path: string): Promise<void> {
  await pickNext(path)
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await addButton().click()
}

async function openPrivacy(): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/?settings=privacy'))
  await expect(page.getByTestId('settings-tab-privacy')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 })
}

/** Cuộc mới dùng gần nhất (đang mở): lúc đầu là cuộc duy nhất, sau khi tách nhánh là nhánh. */
const activeConversation = async (): Promise<{ id: string; cwd: string | null; extraDirs: { path: string; write: boolean }[] }> =>
  page.evaluate(async () => (await window.api.conversations.list())[0])

test('cấp thư mục chính → thanh thư mục có nút "Thư mục phụ (0/3)"', async () => {
  await goTo(page, '#/', box())
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Đọc code' })}`)
  await card('folder').getByTestId('folder-access-choose').click({ timeout: 20_000 })
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await expect(addButton()).toHaveText(/Thư mục phụ \(0\/3\)/)
  await expect(chips()).toHaveCount(0)
})

test('(1) thư mục CHA của vùng cấm (C:\\Users, thư mục người dùng), vùng cấm (AppData), gốc ổ đĩa → báo lý do trong 1 giây, không thêm', async () => {
  const home = homedir()
  await tryAdd(parse(home).dir) // C:\Users
  await expect(page.getByTestId('chat-error')).toContainText('chứa thư mục hệ thống', FAST)
  await tryAdd(home)
  await expect(page.getByTestId('chat-error')).toContainText('chứa thư mục hệ thống', FAST)
  await tryAdd(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
  await expect(page.getByTestId('chat-error')).toContainText('Không được chọn thư mục hệ thống', FAST)
  await tryAdd(parse(home).root)
  await expect(page.getByTestId('chat-error')).toContainText('cả một ổ đĩa', FAST)
  await expect(chips()).toHaveCount(0)
  expect((await activeConversation()).extraDirs).toEqual([])
})

test('(2) trùng / nằm trong thư mục chính → báo chồng lấn, không thêm', async () => {
  await tryAdd(project)
  await expect(page.getByTestId('chat-error')).toContainText('trùng, nằm trong hoặc chứa thư mục dự án', FAST)
  await tryAdd(join(project, 'sub'))
  await expect(page.getByTestId('chat-error')).toContainText('trùng, nằm trong hoặc chứa thư mục dự án', FAST)
  await expect(chips()).toHaveCount(0)
})

test('thêm thư mục phụ → chip hiện trong 1 giây, chỉ đọc; trợ lý sửa file ở đó → bị chặn, không có thẻ', async () => {
  await tryAdd(libA)
  await expect(chip(libA)).toBeVisible(FAST)
  await expect(chip(libA).getByTestId('extra-folder-write')).not.toBeChecked()
  await expect(addButton()).toHaveText(/\(1\/3\)/)
  // Bật sửa thư mục CHÍNH (để lượt chat có bước duyệt) — thư mục phụ vẫn chỉ đọc.
  await page.getByTestId('code-bar').locator('label').filter({ hasText: 'Chỉ đọc' }).first().getByRole('checkbox').click()
  await page.getByTestId('code-write-confirm').click()
  await send(`FAKE_EDIT:${join(libA, 'b.txt')}`)
  await expect(lastReply()).toContainText('Không sửa', { timeout: 20_000 })
  await expect(card('code')).toHaveCount(0)
  expect(readFileSync(join(libA, 'b.txt'), 'utf8')).toBe('gốc\n')
})

test('(C) thư mục chính đang tự duyệt; tick sửa thư mục phụ → sửa ở đó VẪN hiện thẻ (ghi lý do, không có nút tự duyệt)', async () => {
  // Mở phiên tự duyệt ở thư mục chính.
  await send('FAKE_WRITES:a.txt=một')
  await expect(card('code')).toBeVisible({ timeout: 20_000 })
  await card('code').getByTestId('approval-accept-auto').click()
  await page.getByTestId('auto-edit-start-confirm').click()
  await expect(page.getByTestId('auto-edit-sessions').getByTestId('auto-edit-session')).toHaveAttribute('data-state', 'active', FAST)
  await expect(lastReply()).toContainText('Đã ghi: a.txt', { timeout: 20_000 })

  // Tick sửa thư mục phụ: hộp xác nhận nhắc "không bao giờ tự duyệt".
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await chip(libA).getByTestId('extra-folder-write').click()
  await expect(page.getByRole('dialog')).toContainText('không bao giờ tự duyệt')
  await page.getByTestId('code-write-confirm').click()
  await expect(chip(libA).getByTestId('extra-folder-write')).toBeChecked(FAST)

  await send(`FAKE_EDIT:${join(libA, 'b.txt')}`)
  const c = card('code')
  await expect(c).toBeVisible({ timeout: 20_000 })
  await expect(c.getByTestId('approval-extra-folder')).toContainText(libA)
  await expect(c.getByTestId('auto-edit-ask-reason')).toHaveAttribute('data-reason', 'extra_folder')
  await expect(c.getByTestId('approval-accept-auto')).toHaveCount(0)
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await page.getByTestId('chat-drop-zone').screenshot({ path: `test-results/extra-folders-${theme}.png` })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await c.getByTestId('approval-accept').click()
  await expect(lastReply()).toContainText('Đã sửa', { timeout: 20_000 })
  expect(readFileSync(join(libA, 'b.txt'), 'utf8')).toBe('phiên bản 1\n')
})

test('(2) đổi thư mục chính sang thư mục chồng lấn thư mục phụ → báo lỗi, thư mục chính giữ nguyên', async () => {
  await pickNext(libA)
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('code-bar').getByRole('button', { name: 'Đổi thư mục' }).click()
  await expect(page.getByTestId('chat-error')).toContainText('gỡ thư mục phụ đó trước', FAST)
  await pickNext(extrasBase) // chứa thư mục phụ
  await page.getByTestId('code-bar').getByRole('button', { name: 'Đổi thư mục' }).click()
  await expect(page.getByTestId('chat-error')).toContainText('gỡ thư mục phụ đó trước', FAST)
  expect((await activeConversation()).cwd).toBe(project)
  await expect(chips()).toHaveCount(1)
})

test('tối đa 3 thư mục phụ; Quyền & riêng tư liệt kê dưới cuộc, thu hồi một thư mục → chip mất trong 1 giây', async () => {
  await tryAdd(libB)
  await expect(chip(libB)).toBeVisible(FAST)
  await tryAdd(libC)
  await expect(chip(libC)).toBeVisible(FAST)
  await expect(addButton()).toBeDisabled()
  await expect(addButton()).toHaveText(/\(3\/3\)/)

  await openPrivacy()
  const extras = page.getByTestId('grant-extra-folder')
  await expect(extras).toHaveCount(3, FAST)
  await expect(extras.first()).toContainText('Đọc + sửa (luôn hỏi)')
  await page.locator(`[data-testid="grant-extra-folder"][data-path="${libC.replace(/\\/g, '\\\\')}"]`).getByTestId('grant-extra-folder-revoke').click()
  await expect(extras).toHaveCount(2, FAST)
  await page.keyboard.press('Escape')
  await expect(chip(libC)).toHaveCount(0, FAST)
  await expect(addButton()).toBeEnabled()
})

test('gỡ một thư mục phụ trên thanh thư mục (×) → mất trong 1 giây', async () => {
  await chip(libB).getByTestId('extra-folder-remove').click()
  await expect(chip(libB)).toHaveCount(0, FAST)
  expect((await activeConversation()).extraDirs.map((e) => e.path)).toEqual([libA])
})

test('(4) tạo nhánh → nhánh có thư mục phụ, về chỉ đọc', async () => {
  const parentId = (await activeConversation()).id
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  const reply = page.getByTestId('message-assistant').first()
  await reply.hover()
  await reply.getByTestId('fork-message').click()
  await expect.poll(async () => (await activeConversation()).id, { timeout: 5_000 }).not.toBe(parentId)
  await expect(chip(libA)).toBeVisible(FAST)
  await expect(chip(libA).getByTestId('extra-folder-write')).not.toBeChecked()
})

test('(3) Gỡ thư mục chính → gỡ luôn thư mục phụ (cả trên thanh lẫn trang Quyền & riêng tư)', async () => {
  const fork = await activeConversation()
  await page.getByTestId('code-clear-folder').click()
  await expect(chips()).toHaveCount(0, FAST)
  expect((await page.evaluate(async (id) => (await window.api.conversations.list()).find((c) => c.id === id), fork.id))?.extraDirs).toEqual([])

  // Cuộc gốc: thu hồi thư mục chính ở trang Quyền & riêng tư → thư mục phụ mất theo.
  await openPrivacy()
  const rows = page.getByTestId('grant-folder')
  await expect(rows).toHaveCount(1, FAST)
  await expect(rows.getByTestId('grant-extra-folder')).toHaveCount(1)
  await rows.getByTestId('grant-folder-revoke').click()
  await expect(page.getByTestId('grant-folders-empty')).toBeVisible(FAST)
  await page.keyboard.press('Escape')
  const all = await page.evaluate(async () => (await window.api.conversations.list()).map((c) => c.extraDirs.length))
  expect(all.every((n) => n === 0)).toBe(true)
})
