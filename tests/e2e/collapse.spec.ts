import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Thu gọn cho gọn màn hình:
// - Lời gọi công cụ của một lượt gộp thành MỘT dòng ("Đã dùng 9 công cụ · Read ×5, Grep ×4"), bấm để mở / đóng.
// - "Những điều đã ghi nhớ" gom theo loại, nhóm thu gọn được (nhớ trạng thái), 5 mục + "Xem thêm", mục dài một dòng.
// Chạy được khi KHÔNG có Claude CLI: công cụ giả lập bằng MMC_FAKE_CHAT (FAKE_TOOLS:<n>).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-collapse-e2e-'))
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1' }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const reply = () => page.getByTestId('message-assistant').last()
const summary = () => reply().getByTestId('tool-summary')

test('9 lời gọi công cụ: lúc chạy hiện việc đang làm, xong gộp thành một dòng thu gọn', async () => {
  await goTo(page, '#/', box())
  await page.getByRole('button', { name: 'Cuộc trò chuyện mới' }).click()
  await box().fill('Xem code giúp mình FAKE_TOOLS:9')
  await box().press('Enter')
  // Công cụ cuối (Read) "chạy" 1,5 giây.
  await expect(summary()).toHaveAttribute('data-running', 'true', { timeout: 20_000 })
  await expect(summary()).toContainText('Đang đọc file…')
  await expect(summary()).toContainText('file9.ts')

  await expect(reply()).toContainText('Mizuki (giả lập) đã nhận', { timeout: 20_000 })
  await expect(summary()).toHaveCount(1)
  await expect(summary()).not.toHaveAttribute('data-running')
  await expect(summary()).toContainText('Đã dùng 9 công cụ · Read ×5, Grep ×4')
  const toggle = summary().getByTestId('tool-summary-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(summary().getByTestId('tool-list')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/tools-collapsed.png' })
})

test('bấm dòng tóm tắt → danh sách từng công cụ kèm file / từ khoá; bấm lại → thu gọn', async () => {
  const toggle = summary().getByTestId('tool-summary-toggle')
  await toggle.click()
  const items = summary().getByTestId('tool-item')
  await expect(items).toHaveCount(9, FAST)
  await expect(items.nth(0)).toContainText('Read')
  await expect(items.nth(0)).toContainText('C:\\du-an\\src\\file1.ts')
  await expect(items.nth(1)).toContainText('Grep')
  await expect(items.nth(1)).toContainText('tukhoa2 · C:\\du-an\\src')
  await page.screenshot({ path: 'test-results/tools-expanded.png' })
  await toggle.click()
  await expect(summary().getByTestId('tool-list')).toHaveCount(0, FAST)
})

const group = (category: string) => page.locator(`[data-testid="memory-group"][data-category="${category}"]`)
const LONG = 'Ghi nhớ rất dài: ' + 'đang làm đồ án game Unity nhiều màn chơi, cần nhắc deadline và cách tối ưu hiệu năng. '.repeat(4)

test('trí nhớ gom theo loại: tiêu đề + số, 5 mục đầu + "Xem thêm 2"', async () => {
  await goTo(page, '#/memory', page.getByPlaceholder('Thêm điều trợ lý nên nhớ…'))
  const input = page.getByPlaceholder('Thêm điều trợ lý nên nhớ…')
  for (let i = 1; i <= 7; i++) {
    await input.fill(`Điều số ${i}`)
    await input.press('Enter')
    await expect(page.getByTestId('memory-item').filter({ hasText: `Điều số ${i}` })).toHaveCount(1)
  }
  await input.fill(LONG.trim())
  await input.locator('xpath=ancestor::form').locator('select').selectOption('skill')
  await input.press('Enter')

  await expect(group('other').getByTestId('memory-group-count')).toHaveText('7')
  await expect(group('other').getByTestId('memory-group-toggle')).toContainText('Khác')
  await expect(group('skill').getByTestId('memory-group-count')).toHaveText('1')
  await expect(group('other').getByTestId('memory-item')).toHaveCount(5)
  await group('other').getByTestId('memory-show-more').click()
  await expect(group('other').getByTestId('memory-item')).toHaveCount(7, FAST)
  await expect(group('other').getByTestId('memory-show-more')).toHaveCount(0)
})

test('mục dài: một dòng (cắt …) + "Xem thêm" → đầy đủ, "Thu gọn" → lại một dòng', async () => {
  const item = group('skill').getByTestId('memory-item')
  const content = item.getByTestId('memory-content')
  expect(await content.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const short = (await group('other').getByTestId('memory-content').first().boundingBox())!.height
  expect(Math.abs((await content.boundingBox())!.height - short)).toBeLessThan(2)
  // Mục ngắn không có nút "Xem thêm".
  await expect(group('other').getByTestId('memory-expand')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/memory-groups.png' })

  await item.getByTestId('memory-expand').click()
  await expect(item.getByTestId('memory-expand')).toHaveText('Thu gọn', FAST)
  expect((await content.boundingBox())!.height).toBeGreaterThan(short * 2)
  await item.getByTestId('memory-expand').click()
  await expect(item.getByTestId('memory-expand')).toHaveText('Xem thêm', FAST)
  expect(Math.abs((await content.boundingBox())!.height - short)).toBeLessThan(2)
})

test('thu gọn nhóm, nhớ trạng thái khi mở lại; đang tìm thì nhóm có kết quả tự mở (tạm thời)', async () => {
  const toggle = () => group('other').getByTestId('memory-group-toggle')
  await toggle().click()
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false', FAST)
  await expect(group('other').getByTestId('memory-item')).toHaveCount(0)

  await page.reload()
  await waitForStartup(page)
  await goTo(page, '#/memory', group('other'))
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  await expect(group('skill').getByTestId('memory-group-toggle')).toHaveAttribute('aria-expanded', 'true')

  const search = page.getByPlaceholder('Tìm trong trí nhớ…')
  await search.fill('số 3')
  await expect(group('other').getByTestId('memory-item')).toHaveCount(1)
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await expect(group('skill')).toHaveCount(0)

  await search.fill('')
  await expect(group('skill')).toHaveCount(1)
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
})

test('ảnh chụp sáng / tối ở khung 900px và 1280px (để so với ảnh mẫu)', async () => {
  const setWidth = (width: number) =>
    app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
  await group('other').getByTestId('memory-group-toggle').click()
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    for (const width of [900, 1280]) {
      await setWidth(width)
      await goTo(page, '#/memory', group('skill'))
      await group('skill').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `test-results/memory-groups-${theme}-${width}.png` })
      await goTo(page, '#/', box())
      await page.getByRole('button', { name: /^Chủ đề: Xem code/ }).click()
      await reply().getByTestId('tool-summary-toggle').click()
      await page.screenshot({ path: `test-results/tools-${theme}-${width}.png` })
    }
  }
  await page.getByTestId('theme-toggle').click()
})
