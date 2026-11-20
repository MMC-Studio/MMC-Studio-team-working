import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, openSettings, pluginAdd, pluginMenu, pluginRow, waitForStartup } from './helpers'

// Trang Plugin (PR 6): MỘT chỗ cho skill, Gmail, Telegram, MCP server, kết nối agent. Tab / tìm / lọc, "Thêm ▾",
// Gợi ý, skill có sẵn, link cũ chuyển hướng, Cài đặt chỉ còn dòng "Plugin". Chạy được khi KHÔNG có Claude CLI.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-plugins-e2e-'))
  // Hai skill người dùng có sẵn trong thư mục skill (như đã cài từ trước).
  for (const [name, desc] of [
    ['bao-cao-tuan', 'Viết báo cáo tuần theo mẫu của team'],
    ['slide-pixel', 'Slide phong cách pixel art']
  ]) {
    const dir = join(userData, 'skills', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`)
  }
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_GMAIL: '1', MMC_FAKE_TELEGRAM: '1' }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const rows = () => page.getByTestId('plugin-row')
const keys = async (): Promise<string[]> => rows().evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? ''))
const yours = () => page.getByTestId('plugins-yours')

test('thanh bên "Plugin" → trang thật: Của bạn (skill đã cài), Có sẵn trong app, Gợi ý (Gmail / Telegram / Kết nối agent)', async () => {
  await goTo(page, '#/', page.getByRole('textbox', { name: /Nhắn cho/ }))
  await page.getByTestId('nav-plugins').click()
  await expect(page.getByTestId('plugins-page')).toBeVisible(FAST)
  await expect(page.getByTestId('nav-plugins')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plugin')

  await expect(yours().getByTestId('plugin-row')).toHaveCount(2)
  await expect(pluginRow(page, 'skill:bao-cao-tuan')).toContainText('Viết báo cáo tuần')
  await expect(pluginRow(page, 'skill:bao-cao-tuan').getByTestId('plugin-subtitle')).toHaveText(/^Skill/)
  await expect(page.getByTestId('plugins-builtin').getByTestId('plugin-row').first()).toBeVisible()
  const suggestions = page.getByTestId('plugins-suggestions')
  await expect(suggestions.getByTestId('plugin-suggestion-gmail')).toContainText('Gmail')
  await expect(suggestions.getByTestId('plugin-suggestion-telegram')).toContainText('Telegram')
  await expect(suggestions.getByTestId('plugin-suggestion-agents')).toContainText('Kết nối agent')
})

test('tab Kết nối / Skill, ô tìm không dấu, Esc xoá ô tìm', async () => {
  await page.getByTestId('plugins-tab-skills').click()
  await expect(page.getByTestId('plugins-suggestions')).toHaveCount(0, FAST)
  await expect(page.getByTestId('plugins-builtin')).toBeVisible()
  expect(await page.evaluate(() => window.location.hash)).toBe('#/plugins?tab=skills')

  await page.getByTestId('plugins-tab-connectors').click()
  await expect(page.getByTestId('plugins-builtin')).toHaveCount(0, FAST)
  await expect(yours().getByTestId('plugin-row')).toHaveCount(0)
  await expect(page.getByTestId('plugins-suggestions').getByRole('button')).toHaveCount(3)

  await page.getByTestId('plugins-tab-all').click()
  await page.getByTestId('plugins-search').fill('BAO cao TUAN')
  // Khớp cả mô tả: skill có sẵn time-manager ("viết báo cáo … tuần").
  await expect(rows()).toHaveCount(2, FAST)
  expect(await keys()).toEqual(['skill:bao-cao-tuan', 'builtin:time-manager'])
  await page.getByTestId('plugins-search').fill('soan NHAP')
  await expect(page.getByTestId('plugins-suggestions').getByRole('button')).toHaveCount(2, FAST) // Gmail + Telegram
  await page.getByTestId('plugins-search').fill('khong co gi')
  await expect(page.getByTestId('plugins-no-results')).toBeVisible(FAST)
  await page.getByTestId('plugins-search').press('Escape')
  await expect(page.getByTestId('plugins-search')).toHaveValue('')
})

test('tắt skill qua ⋯ → nhãn "Đang tắt" ngay; lọc Đang bật / Đang tắt', async () => {
  await pluginMenu(page, 'skill:slide-pixel', 'disable')
  await expect(pluginRow(page, 'skill:slide-pixel')).toHaveAttribute('data-enabled', 'false', FAST)
  await expect(pluginRow(page, 'skill:slide-pixel').getByTestId('plugin-off')).toHaveText('Đang tắt')

  await page.getByTestId('plugins-filter').click()
  await page.getByTestId('plugins-filter-off').click()
  await expect(yours().getByTestId('plugin-row')).toHaveCount(1, FAST)
  await expect(pluginRow(page, 'skill:slide-pixel')).toBeVisible()
  await page.getByTestId('plugins-filter').click()
  await page.getByTestId('plugins-filter-on').click()
  await expect(pluginRow(page, 'skill:slide-pixel')).toHaveCount(0, FAST)
  await expect(page.getByTestId('plugins-suggestions')).toHaveCount(0) // gợi ý = chưa bật
  await page.getByTestId('plugins-filter').click()
  await page.getByTestId('plugins-filter-all').click()

  // Skill có sẵn: chỉ xem, không bật / tắt / gỡ.
  const builtin = page.getByTestId('plugins-builtin').getByTestId('plugin-row').first()
  const key = (await builtin.getAttribute('data-key'))!
  await page.getByTestId(`plugin-menu-${key}`).click()
  await expect(page.getByTestId('plugin-menu-settings')).toHaveText('Xem')
  await expect(page.getByTestId('plugin-menu-disable')).toHaveCount(0)
  await expect(page.getByTestId('plugin-menu-remove')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('trang chi tiết skill: nội dung SKILL.md; bật lại bằng ⋯ ở đầu trang', async () => {
  await pluginRow(page, 'skill:slide-pixel').getByRole('button').first().click()
  await expect(page.getByTestId('plugin-detail-name')).toContainText('slide-pixel')
  await expect(page.getByTestId('skill-body')).toContainText('# slide-pixel')
  await expect(page.getByTestId('plugin-detail').getByTestId('plugin-off')).toBeVisible()
  await pluginMenu(page, 'skill:slide-pixel', 'enable')
  await expect(page.getByTestId('plugin-detail').getByTestId('plugin-off')).toHaveCount(0, FAST)
  await page.getByTestId('plugin-breadcrumb').click()
  await expect(page.getByTestId('plugins-page')).toBeVisible(FAST)
})

test('"Thêm ▾": đủ mục; Kết nối Telegram (chưa bật) → hộp cảnh báo như ⋯; MCP server → mở sẵn form thêm', async () => {
  await page.getByTestId('plugins-add').click()
  for (const id of ['skill-folder', 'skill-zip', 'mcp', 'gmail', 'telegram', 'agents']) {
    await expect(page.getByTestId(`plugins-add-${id}`)).toBeVisible()
  }
  await page.keyboard.press('Escape')

  await pluginAdd(page, 'telegram')
  const dialog = page.getByTestId('plugin-enable-dialog')
  await expect(dialog).toContainText('Bật Telegram?')
  await expect(dialog).toContainText('Riêng tư')
  await expect(dialog.getByTestId('plugin-enable-confirm')).toHaveText('Bật và thiết lập')
  await dialog.getByRole('button', { name: 'Hủy' }).click()

  await pluginAdd(page, 'mcp')
  await expect(page.getByTestId('mcp-form')).toBeVisible(FAST)
  await page.getByTestId('mcp-form').getByRole('button', { name: 'Hủy' }).click()
})

test('bật Kết nối agent từ Gợi ý (qua hộp cảnh báo) → chuyển lên "Của bạn"; tắt qua ⋯ → về Gợi ý', async () => {
  await goTo(page, '#/plugins', page.getByTestId('plugins-page'))
  await page.getByTestId('plugin-suggestion-agents').click()
  await expect(page.getByTestId('plugin-enable-dialog')).toContainText('127.0.0.1')
  await page.getByTestId('plugin-enable-confirm').click()
  await expect(pluginRow(page, 'agents')).toBeVisible(FAST)
  await expect(page.getByTestId('plugin-suggestion-agents')).toHaveCount(0)
  await pluginMenu(page, 'agents', 'disable')
  // Tắt và chưa có agent nào → về lại Gợi ý.
  await expect(pluginRow(page, 'agents')).toHaveCount(0, FAST)
  await expect(page.getByTestId('plugin-suggestion-agents')).toBeVisible()
})

test('link cũ #/connectors → trang Plugin, tab Kết nối', async () => {
  await page.evaluate(() => (window.location.hash = '#/connectors'))
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/plugins?tab=connectors')
  await expect(page.getByTestId('plugins-tab-connectors')).toHaveAttribute('aria-selected', 'true')
})

test('Cài đặt: tab Kết nối chỉ còn dòng "Plugin"; tìm "gmail" / "skill" / "mcp" ra dòng Plugin', async () => {
  await openSettings(page, 'connections', page.getByTestId('open-plugins'))
  await expect(page.getByTestId('open-connectors')).toHaveCount(0)
  await expect(page.getByTestId('open-agents')).toHaveCount(0)
  for (const q of ['gmail', 'skill', 'mcp']) {
    await page.getByTestId('settings-search').fill(q)
    await expect(page.getByTestId('settings-result').filter({ hasText: 'Plugin' })).toHaveCount(1, FAST)
  }
  await page.getByTestId('settings-search').fill('')
  await page.keyboard.press('Escape')
})

test('thanh biểu tượng bên trái không có mục dẫn tới /connectors hay /agents', async () => {
  await goTo(page, '#/plugins', page.getByTestId('plugins-page'))
  await expect(page.locator('a[href="#/connectors"], a[href="#/agents"]')).toHaveCount(0)
})

test('ảnh sáng / tối, 900px và 1280px', async () => {
  // Có đủ: Của bạn (kết nối + skill), Có sẵn, Gợi ý.
  await page.getByTestId('plugin-suggestion-agents').click()
  await page.getByTestId('plugin-enable-confirm').click()
  await expect(pluginRow(page, 'agents')).toBeVisible(FAST)
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
        await page.getByTestId('theme-toggle').click()
      }
      await page.waitForTimeout(600) // chờ hiệu ứng đổi màu xong
      const noHScroll = await page.getByTestId('plugins-page').evaluate((el) => el.scrollWidth <= el.clientWidth)
      expect(noHScroll).toBe(true)
      await page.getByTestId('plugins-page').evaluate((el) => el.scrollTo(0, 0))
      await page.screenshot({ path: `test-results/plugins-${theme}-${width}.png` })
    }
  }
  await page.getByTestId('theme-toggle').click()
  await goTo(page, '#/plugins/gmail', page.getByTestId('gmail-off'))
  await page.screenshot({ path: 'test-results/plugin-detail-gmail.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})
