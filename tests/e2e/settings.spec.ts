import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Cài đặt thành cửa sổ nổi (PR 4): mở đè lên trang đang xem, tab chia nhóm, ô tìm không dấu → nhảy tới dòng + nháy nền,
// link cũ #/settings, đổi trang là tự đóng. Chạy được khi KHÔNG có Claude CLI.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-settings-e2e-'))
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1' }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

type Api = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
async function external(group: string, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    ({ group, method, args }) => (window as unknown as { api: Api }).api[group][method](...args),
    { group, method, args }
  )
}

const dialog = () => page.getByTestId('settings-dialog')
const search = () => page.getByTestId('settings-search')
const hash = () => page.evaluate(() => window.location.hash)
const row = (id: string) => dialog().locator(`[data-setting-id="${id}"]`)

test('nút Cài đặt mở cửa sổ nổi đè lên trang đang xem; tab mặc định Giao diện; Esc đóng, vẫn ở trang cũ', async () => {
  await goTo(page, '#/memory', page.getByRole('heading', { name: /nhớ gì về tôi/ }))
  await page.getByTestId('nav-settings').click()
  await expect(dialog()).toBeVisible(FAST)
  await expect(search()).toBeFocused()
  expect(await hash()).toMatch(/^#\/memory\?settings=appearance$/)
  await expect(dialog()).toHaveAttribute('data-tab', 'appearance')
  await expect(page.getByTestId('settings-tab-appearance')).toHaveAttribute('aria-current', 'page')
  await expect(dialog().locator('[data-testid^="settings-tab-"]')).toHaveCount(7)
  await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-pressed', 'true')
  // Trang nền vẫn là Trí nhớ.
  await expect(page.getByRole('heading', { name: /nhớ gì về tôi/, includeHidden: true })).toBeAttached()

  await page.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0, FAST)
  expect(await hash()).toBe('#/memory')
})

test('đổi tab: nội dung đúng tab, cột phải cuộn riêng', async () => {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('settings-tab-capabilities').click()
  await expect(dialog()).toHaveAttribute('data-tab', 'capabilities', FAST)
  await expect(page.getByTestId('voice-settings')).toBeVisible()
  await expect(page.getByTestId('skill-pick-folder')).toBeAttached()
  await page.getByTestId('settings-tab-updates').click()
  await expect(dialog().getByRole('heading', { name: 'Cập nhật', exact: true })).toBeVisible(FAST)
  await expect(page.getByTestId('update-auto-check')).toBeVisible()
  // Cột phải cuộn, cửa sổ không cao quá màn hình.
  const box = (await dialog().boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(820)
})

test('ô tìm không dấu: kết quả kèm tên tab; Enter / bấm → nhảy tới đúng dòng và nháy nền', async () => {
  await search().fill('giong noi')
  const results = page.getByTestId('settings-result')
  await expect(results).toHaveCount(1, FAST)
  await expect(results.first()).toContainText('Giọng nói')
  await expect(results.first()).toContainText('Khả năng')
  await search().press('Enter')
  await expect(dialog()).toHaveAttribute('data-tab', 'capabilities', FAST)
  await expect(row('voice')).toHaveAttribute('data-flashed', 'true', FAST)
  await expect(row('voice')).toBeInViewport()
  await expect(search()).toHaveValue('')

  await search().fill('TIÊU đề')
  await page.getByTestId('settings-result').filter({ hasText: 'Tự đặt tiêu đề' }).click()
  await expect(dialog()).toHaveAttribute('data-tab', 'ai', FAST)
  await expect(row('aiTitles')).toHaveAttribute('data-flashed', 'true', FAST)
  await expect(page.getByTestId('organize-aiTitles')).toBeInViewport()

  // Tìm theo tên tab.
  await search().fill('cap nhat')
  await expect(page.getByTestId('settings-result').filter({ hasText: 'Kênh cập nhật' })).toHaveCount(1)

  await search().fill('khongcogiheta')
  await expect(page.getByTestId('settings-no-results')).toContainText('khongcogiheta')
  // Esc khi đang tìm → xoá ô tìm (cửa sổ vẫn mở); Esc lần nữa → đóng.
  await search().press('Escape')
  await expect(search()).toHaveValue('')
  await expect(dialog()).toBeVisible()
  await expect(page.getByTestId('settings-tab-ai')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0, FAST)
})

test('công tắc: bấm tên dòng cũng bật / tắt; lưu đúng chỗ cũ', async () => {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('settings-tab-assistant').click()
  const sw = page.getByTestId('auto-suggest-memory')
  const before = await sw.isChecked()
  await row('autoSuggestMemory').getByText('Tự đề xuất ghi nhớ').click()
  await expect(sw).toBeChecked({ checked: !before, ...FAST })
  await expect.poll(async () => ((await external('settings', 'getAi')) as { autoSuggestMemory: boolean }).autoSuggestMemory).toBe(!before)
  await sw.setChecked(before)
  await expect.poll(async () => ((await external('settings', 'getAi')) as { autoSuggestMemory: boolean }).autoSuggestMemory).toBe(before)
})

test('"Mở" sang trang riêng (Gmail & Telegram) → cửa sổ tự đóng', async () => {
  await page.getByTestId('settings-tab-connections').click()
  await page.getByTestId('open-connectors').click()
  await expect(dialog()).toHaveCount(0, FAST)
  expect(await hash()).toBe('#/connectors')
})

test('link cũ: #/settings → tab Giao diện; #/settings/voice → tab Khả năng, nháy dòng Giọng nói', async () => {
  await page.evaluate(() => (window.location.hash = '#/settings'))
  await expect(dialog()).toHaveAttribute('data-tab', 'appearance')
  expect(await hash()).toBe('#/?settings=appearance')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window.location.hash = '#/settings/voice'))
  await expect(dialog()).toHaveAttribute('data-tab', 'capabilities')
  await expect(row('voice')).toHaveAttribute('data-flashed', 'true')
  // Nhảy xong thì bỏ tham số dòng khỏi địa chỉ (đổi tab sau đó không nháy lại).
  await expect.poll(hash).toBe('#/?settings=capabilities')
  await page.keyboard.press('Escape')
})

test('ảnh sáng / tối, 900px và 1280px', async () => {
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(() => (window.location.hash = '#/?settings=appearance'))
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId('settings-tab-ai').click()
      await expect(dialog()).toHaveCSS('opacity', '1')
      const box = (await dialog().boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await page.waitForTimeout(250)
      await page.screenshot({ path: `test-results/settings-${theme}-${width}.png` })
      await search().fill('giong')
      await page.screenshot({ path: `test-results/settings-search-${theme}-${width}.png` })
      await search().press('Escape')
      await page.keyboard.press('Escape')
      await expect(dialog()).toHaveCount(0)
    }
  }
  await page.evaluate(() => (window.location.hash = '#/?settings=appearance'))
  await page.getByTestId('theme-system').click()
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})
