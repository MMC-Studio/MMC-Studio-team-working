import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Chờ lần kiểm tra Claude CLI lúc mở app xong. Máy không có CLI (như CI) bị chuyển tới /claude ngay sau
 * đó — điều hướng trước lúc này thì trang đích bị kéo đi. Phải chờ phần tử HIỆN RA trước: `not.toContainText`
 * trên phần tử chưa tồn tại (app còn đang tải) pass ngay lập tức.
 */
export async function waitForStartup(page: Page): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/claude'))
  const status = page.getByTestId('cli-status')
  await expect(status).toBeVisible({ timeout: 30_000 })
  await expect(status).not.toContainText(/Đang kiểm tra/, { timeout: 30_000 })
}

/** Điều hướng tới `hash` và chắc chắn trang đích đứng yên (thử lại nếu bị chuyển trang chen ngang). */
export async function goTo(page: Page, hash: string, ready: Locator): Promise<void> {
  await expect(async () => {
    await page.evaluate((h) => (window.location.hash = h), hash)
    await expect(ready).toBeVisible({ timeout: 3_000 })
    expect(await page.evaluate(() => window.location.hash)).toBe(hash)
  }).toPass({ timeout: 30_000 })
}

/**
 * Mở cửa sổ Cài đặt ở `tab` (nổi trên trang Chat, địa chỉ `#/?settings=<tab>`) và chờ `ready` hiện.
 * Thử lại nếu bị chuyển trang chen ngang lúc mở app (xem waitForStartup).
 */
export async function openSettings(page: Page, tab: string, ready: Locator): Promise<void> {
  await expect(async () => {
    await page.evaluate((h) => (window.location.hash = h), `#/?settings=${tab}`)
    await expect(ready).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

/** Dòng của một plugin trên trang Plugin (`key`: `gmail`, `telegram`, `agents`, `mcp:<id>`, `skill:<tên>`, `builtin:<tên>`). */
export const pluginRow = (page: Page, key: string): Locator => page.locator(`[data-testid="plugin-row"][data-key="${key}"]`)

/**
 * Chọn một mục trong menu ⋯ của plugin `key` (trên dòng ở trang Plugin, hoặc đầu trang chi tiết).
 * Không tự bấm qua hộp cảnh báo / xác nhận — test tự kiểm và bấm.
 */
export async function pluginMenu(page: Page, key: string, action: 'enable' | 'disable' | 'remove' | 'settings'): Promise<void> {
  await page.getByTestId(`plugin-menu-${key}`).first().click()
  await page.getByTestId(`plugin-menu-${action}`).click()
}

/** Bật plugin qua menu ⋯ và bấm "Bật" trong hộp cảnh báo (Gmail / Telegram / Kết nối agent). */
export async function enablePlugin(page: Page, key: string): Promise<void> {
  await pluginMenu(page, key, 'enable')
  await page.getByTestId('plugin-enable-confirm').click()
}

/** Mục trong nút "Thêm ▾" của trang Plugin (`skill-folder`, `skill-zip`, `mcp`, `gmail`, `telegram`, `agents`). */
export async function pluginAdd(page: Page, item: string): Promise<void> {
  await page.getByTestId('plugins-add').click()
  await page.getByTestId(`plugins-add-${item}`).click()
}
