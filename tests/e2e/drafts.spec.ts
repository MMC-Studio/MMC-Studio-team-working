import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Nháp tin nhắn theo từng cuộc: chữ còn khi sang trang khác rồi quay lại, mỗi cuộc giữ nháp riêng (cả đính kèm),
// thanh bên hiện "Nháp: …", gửi xong ô trống + hết "Nháp:", tắt / mở app vẫn còn chữ.
// Chạy được khi KHÔNG có Claude CLI (MMC_FAKE_CHAT).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string

async function launch(): Promise<void> {
  app = await electron.launch({ args: [ROOT], env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1' } })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-drafts-e2e-'))
  await launch()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const item = (title: string) => page.locator('[data-testid="conversation-item"]').filter({ hasText: title })
const lastReply = () => page.getByTestId('message-assistant').last()

/** Dán một file chữ vào ô nhập (như Ctrl+V file) → đính kèm. */
async function pasteFile(name: string): Promise<void> {
  await page.evaluate((n) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['ghi chú'], n, { type: 'text/markdown' }))
    const textarea = document.querySelector('textarea')!
    textarea.focus()
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, name)
}

/** Tạo một cuộc bằng tin đầu tiên (tiêu đề = chữ đầu). */
async function newConversation(text: string): Promise<void> {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  await box().fill(text)
  await box().press('Enter')
  await expect(lastReply()).toContainText('giả lập', { timeout: 15_000 })
}

test('cuộc mới: gõ dở → sang Artifacts → quay lại vẫn còn chữ', async () => {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  await box().fill('Đang gõ dở cuộc mới')
  await page.getByTestId('nav-artifacts').click()
  await expect(page.getByTestId('artifact-library')).toBeVisible(FAST)
  await page.getByTestId('nav-new').click()
  await expect(box()).toHaveValue('Đang gõ dở cuộc mới', FAST)
  await box().fill('')
})

test('mỗi cuộc giữ nháp riêng (chữ + đính kèm); thanh bên hiện "Nháp: …"', async () => {
  await newConversation('Cuộc A về Unity')
  await newConversation('Cuộc B về Blender')
  await item('Cuộc A').locator('button').first().click()
  await box().fill('Nháp ở cuộc A')
  await pasteFile('ghi-chu-A.md')
  await expect(page.getByTestId('draft-attachments')).toContainText('ghi-chu-A.md')
  await expect(item('Cuộc A').getByTestId('conversation-draft')).toHaveText('Nháp: Nháp ở cuộc A', FAST)
  // Sang B: ô trống, không có đính kèm của A.
  await item('Cuộc B').locator('button').first().click()
  await expect(box()).toHaveValue('', FAST)
  await expect(page.getByTestId('draft-attachments')).toHaveCount(0)
  // Sang trang khác rồi về A: còn chữ + đính kèm.
  await page.getByTestId('nav-projects').click()
  await expect(page.getByTestId('projects-page')).toBeVisible(FAST)
  await item('Cuộc A').locator('button').first().click()
  await expect(box()).toHaveValue('Nháp ở cuộc A', FAST)
  await expect(page.getByTestId('draft-attachments')).toContainText('ghi-chu-A.md')
})

test('đang trả lời một tin: khung "Đang trả lời" theo cuộc', async () => {
  await lastReply().hover()
  await lastReply().getByTestId('message-menu').click()
  await page.getByRole('menuitem', { name: 'Trả lời' }).click()
  await expect(page.getByTestId('reply-preview')).toBeVisible(FAST)
  await item('Cuộc B').locator('button').first().click()
  await expect(page.getByTestId('reply-preview')).toHaveCount(0)
  await item('Cuộc A').locator('button').first().click()
  await expect(page.getByTestId('reply-preview')).toBeVisible(FAST)
})

test('tắt rồi mở lại app → còn chữ + khung "Đang trả lời" (đính kèm chỉ giữ trong lúc app mở)', async () => {
  // Chờ quá 500 ms để chắc chắn đã ghi (đóng app cũng ghi ngay).
  await page.waitForTimeout(700)
  await app.close()
  await launch()
  await goTo(page, '#/', box())
  await expect(item('Cuộc A').getByTestId('conversation-draft')).toHaveText('Nháp: Nháp ở cuộc A')
  await item('Cuộc A').locator('button').first().click()
  await expect(box()).toHaveValue('Nháp ở cuộc A', FAST)
  await expect(page.getByTestId('reply-preview')).toBeVisible()
  await expect(page.getByTestId('draft-attachments')).toHaveCount(0)
})

test('gửi tin → ô trống, hết "Nháp:"; cuộc mới gửi tin đầu → nháp "new" xoá', async () => {
  await box().press('Enter')
  await expect(page.getByTestId('message-user').last()).toContainText('Nháp ở cuộc A', { timeout: 15_000 })
  await expect(lastReply()).toContainText('giả lập', { timeout: 15_000 })
  await expect(box()).toHaveValue('')
  await expect(item('Cuộc A').getByTestId('conversation-draft')).toHaveCount(0)
  await expect(page.getByTestId('reply-preview')).toHaveCount(0)
  await page.getByTestId('nav-new').click()
  await box().fill('Cuộc C mới tinh')
  await box().press('Enter')
  await expect(lastReply()).toContainText('Cuộc C', { timeout: 15_000 })
  await page.getByTestId('nav-new').click()
  await expect(box()).toHaveValue('', FAST)
})

test('ảnh sáng / tối 900 / 1280px (thanh bên có "Nháp:")', async () => {
  await item('Cuộc B').locator('button').first().click()
  await box().fill('Nháp dài cho cuộc B để xem cắt ngắn ở thanh bên khi tên rất dài')
  await item('Cuộc A').locator('button').first().click()
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) await page.getByTestId('theme-toggle').click()
      await page.screenshot({ path: `test-results/drafts-${theme}-${width}.png` })
    }
  }
  await page.getByTestId('theme-toggle').click()
})
