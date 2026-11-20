import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Trí nhớ dự án (PR 5b): trích đề xuất có phạm vi (chung / dự án), cùng MỘT đề xuất hiện ở trang dự án và trang
// Trí nhớ (duyệt / bỏ ở đâu thì chỗ kia cập nhật), đổi phạm vi trước khi duyệt, trí nhớ dự án tới trợ lý qua khối
// theo lượt (chỉ trong đúng dự án), thêm / sửa / xoá tay, xoá dự án đếm + xoá theo. Chạy được khi KHÔNG có Claude CLI:
// trợ lý giả trích đề xuất từ lệnh FAKE_MEM:<user|project|none>:<nội dung> và báo lại "trí nhớ dự án: …" nó thấy.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
const SLOW = { timeout: 20_000 }
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-project-memory-e2e-'))
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_CLI_SESSIONS: '1' }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const projectBox = () => page.getByRole('textbox', { name: /Cuộc trò chuyện mới trong/ })
const lastReply = () => page.getByTestId('message-assistant').last()
const idle = () => expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible(SLOW)

// Trang dự án
const pending = () => page.getByTestId('project-memory-suggestion')
const pendingRow = (text: string) => pending().filter({ hasText: text })
const projectItems = () => page.getByTestId('project-memory-item')
// Trang Trí nhớ
const suggestionRows = () => page.getByTestId('suggestions-section').getByTestId('memory-suggestion')
const suggestionRow = (text: string) => suggestionRows().filter({ hasText: text })
const memoryItems = () => page.getByTestId('memory-list-section').getByTestId('memory-item')

async function createProject(name: string): Promise<void> {
  await page.getByTestId('nav-projects').click()
  await page.getByTestId('project-new').click()
  await page.getByLabel('Tên dự án').fill(name)
  await page.getByRole('button', { name: 'Tạo dự án' }).click()
  await expect(page.getByTestId('project-name')).toHaveText(name, FAST)
}

async function openProject(name: string): Promise<void> {
  // Trang Trí nhớ không có thanh bên chat → vào trang Dự án qua địa chỉ.
  await goTo(page, '#/my-projects', page.getByTestId('projects-page'))
  await page.getByTestId('project-card').filter({ hasText: name }).click()
  await expect(page.getByTestId('project-name')).toHaveText(name, FAST)
}

const openMemoryPage = () => goTo(page, '#/memory', page.getByTestId('suggestions-section'))

test('trích trong dự án: đề xuất có phạm vi, hiện ngay ở trang dự án', async () => {
  await goTo(page, '#/', box())
  await createProject('Web Shop')
  await createProject('Game Pixel')
  await expect(page.getByTestId('project-memory-empty')).toBeVisible()

  await projectBox().fill('FAKE_MEM:project:Dùng URP; FAKE_MEM:user:Thích trả lời ngắn; FAKE_MEM:none:Tên scene viết thường')
  await projectBox().press('Enter')
  await expect(lastReply()).toContainText('Mizuki (giả lập) đã nhận', SLOW)
  await idle()
  await page.getByTestId('suggest-memory').click()

  // Trang dự án đang mở lúc trích xong → đề xuất tự hiện (đồng bộ, không cần mở lại trang).
  await page.getByTestId('chat-project').click()
  await expect(pending()).toHaveCount(3, SLOW)
  await expect(pendingRow('Dùng URP')).toHaveAttribute('data-scope', 'project')
  await expect(pendingRow('Thích trả lời ngắn')).toHaveAttribute('data-scope', 'user')
  // Thiếu scope trong cuộc thuộc dự án → mặc định dự án.
  await expect(pendingRow('Tên scene viết thường')).toHaveAttribute('data-scope', 'project')
  await page.screenshot({ path: 'test-results/project-memory-pending.png' })
})

test('trang Trí nhớ: cùng các đề xuất đó, nhãn "Dự án: …", lọc theo phạm vi', async () => {
  await openMemoryPage()
  await expect(suggestionRows()).toHaveCount(3)
  await expect(suggestionRow('Dùng URP').getByTestId('suggestion-scope')).toHaveText('Dự án: Game Pixel')
  await expect(suggestionRow('Thích trả lời ngắn').getByTestId('suggestion-scope')).toHaveCount(0)

  const filter = page.getByTestId('suggestion-scope-filter')
  await expect(filter.getByRole('tab')).toHaveText(['Tất cả (3)', 'Chung (1)', 'Dự án: Game Pixel (2)'])
  await filter.getByRole('tab', { name: 'Chung (1)' }).click()
  await expect(suggestionRows()).toHaveCount(1, FAST)
  await filter.getByRole('tab', { name: /Tất cả/ }).click()
  await expect(suggestionRows()).toHaveCount(3, FAST)
})

test('duyệt ở trang Trí nhớ → không nằm trong trí nhớ chung, hiện trong trí nhớ dự án; trang dự án bớt đề xuất', async () => {
  await suggestionRow('Dùng URP').getByTestId('memory-suggestion-accept').click()
  await expect(suggestionRows()).toHaveCount(2, FAST)
  // Danh sách mặc định chỉ hiện trí nhớ chung.
  await expect(memoryItems().filter({ hasText: 'Dùng URP' })).toHaveCount(0)
  await page.getByTestId('memory-scope').selectOption({ label: 'Dự án: Game Pixel' })
  await expect(memoryItems().filter({ hasText: 'Dùng URP' })).toHaveCount(1, FAST)
  await page.getByTestId('memory-scope').selectOption({ label: 'Trí nhớ chung' })

  await openProject('Game Pixel')
  await expect(pending()).toHaveCount(2)
  await expect(projectItems().filter({ hasText: 'Dùng URP' })).toHaveCount(1)
})

test('trang dự án: đổi phạm vi Chung → Dự án rồi duyệt; bỏ qua → trang Trí nhớ cũng mất', async () => {
  const row = pendingRow('Thích trả lời ngắn')
  await row.getByTestId('project-memory-scope').click()
  await expect(row).toHaveAttribute('data-scope', 'project', FAST)
  await row.getByTestId('project-memory-accept').click()
  await expect(pending()).toHaveCount(1, FAST)
  await expect(projectItems().filter({ hasText: 'Thích trả lời ngắn' })).toHaveCount(1, FAST)

  await pendingRow('Tên scene viết thường').getByTestId('project-memory-reject').click()
  await expect(pending()).toHaveCount(0, FAST)

  await openMemoryPage()
  await expect(suggestionRows()).toHaveCount(0)
  await expect(memoryItems()).toHaveCount(0) // không có trí nhớ chung nào
})

test('trợ lý thấy trí nhớ dự án trong đúng dự án; dự án khác / cuộc thường thì không', async () => {
  await openProject('Game Pixel')
  await page.getByTestId('project-conversation').first().click()
  await box().fill('dự án đang tới đâu rồi')
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(2, SLOW)
  await expect(lastReply()).toContainText('trí nhớ dự án: ', SLOW)
  await expect(lastReply()).toContainText('Dùng URP')
  await expect(lastReply()).toContainText('Thích trả lời ngắn')
  await expect(lastReply()).toContainText('trí nhớ: - |') // không có trí nhớ chung
  await idle()

  await openProject('Web Shop')
  await projectBox().fill('chào Web Shop')
  await projectBox().press('Enter')
  await expect(lastReply()).toContainText('trí nhớ dự án: - |', SLOW)
  await idle()

  await page.getByTestId('nav-new').click()
  await box().fill('chào cuộc thường')
  await box().press('Enter')
  await expect(lastReply()).toContainText('trí nhớ dự án: - |', SLOW)
  await idle()
})

test('thêm / sửa / xoá tay trí nhớ dự án — hiện ngay; "Mở trên trang Trí nhớ" mở đúng dự án', async () => {
  await openProject('Game Pixel')
  await page.getByTestId('project-memory-add').click()
  await page.getByTestId('project-memory-input').fill('Build cho Windows trước')
  await page.getByTestId('project-memory-submit').click()
  await expect(projectItems().filter({ hasText: 'Build cho Windows trước' })).toHaveCount(1, FAST)

  const item = projectItems().filter({ hasText: 'Build cho Windows trước' })
  await item.hover()
  await item.getByTestId('project-memory-edit').click()
  await page.getByTestId('project-memory-edit-input').fill('Build cho Windows và Android')
  await page.getByTestId('project-memory-save').click()
  await expect(projectItems().filter({ hasText: 'Build cho Windows và Android' })).toHaveCount(1, FAST)

  const edited = projectItems().filter({ hasText: 'Build cho Windows và Android' })
  await edited.hover()
  await edited.getByTestId('project-memory-remove').click()
  await expect(projectItems()).toHaveCount(2, FAST)

  await page.getByTestId('project-memory-open').click()
  await expect(page.getByTestId('memory-scope')).toHaveValue(/.+/)
  await expect(memoryItems()).toHaveCount(2)
  await expect(memoryItems().filter({ hasText: 'Dùng URP' })).toHaveCount(1)
})

test('ảnh cột trí nhớ ở trang dự án: sáng / tối', async () => {
  await openProject('Game Pixel')
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    const noHScroll = await page.getByTestId('project-page').evaluate((el) => el.scrollWidth <= el.clientWidth)
    expect(noHScroll).toBe(true)
    await page.screenshot({ path: `test-results/project-memory-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
})

test('xoá dự án: hộp xác nhận đếm trí nhớ + đề xuất chờ; xoá xong trí nhớ dự án mất', async () => {
  // Một đề xuất còn chờ để hộp xác nhận đếm.
  await page.getByTestId('project-conversation').first().click()
  await box().fill('FAKE_MEM:project:Dùng Tilemap')
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(3, SLOW)
  await idle()
  await page.getByTestId('suggest-memory').click()
  await page.getByTestId('chat-project').click()
  await expect(pending()).toHaveCount(1, SLOW)

  await page.getByTestId('project-page').getByTestId('project-menu').first().click()
  await page.getByTestId('project-menu-delete').click()
  const counts = page.getByTestId('project-delete-counts')
  await expect(counts).toContainText('2 trí nhớ của dự án')
  await expect(counts).toContainText('1 đề xuất trí nhớ đang chờ duyệt')
  await page.getByTestId('project-delete-confirm').click()
  await expect(page.getByTestId('projects-page')).toBeVisible(FAST)

  await openMemoryPage()
  await expect(suggestionRows()).toHaveCount(0)
  await expect(page.getByTestId('memory-scope').locator('option')).toHaveText(['Trí nhớ chung', 'Dự án: Web Shop'])
})
