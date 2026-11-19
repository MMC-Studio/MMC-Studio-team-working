import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Thanh bên chat mới (PR 2): điều hướng, Ctrl+B, thu gọn mục, trang Artifacts, trang "Sắp có", lỗi cuộn ngang.
// Chạy được khi KHÔNG có Claude CLI (MMC_FAKE_CHAT).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-sidebar-e2e-'))
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

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const sidebar = (): ReturnType<Page['getByTestId']> => page.getByTestId('chat-sidebar')
const setWidth = (width: number, height = 820): Promise<void> =>
  app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])

/** Cuộc trò chuyện mới → gửi tin → chờ trả lời xong. */
async function chat(text: string): Promise<void> {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
}

test('điều hướng trên đầu thanh bên + đáy hiện tên trợ lý; Cài đặt / tài khoản vẫn ở thanh biểu tượng', async () => {
  await goTo(page, '#/', box())
  const items = ['nav-new', 'nav-search', 'nav-projects', 'nav-artifacts', 'nav-scheduled', 'nav-plugins']
  const labels = ['Cuộc trò chuyện mới', 'Tìm kiếm', 'Dự án', 'Artifacts', 'Lịch hẹn', 'Plugin']
  for (let i = 0; i < items.length; i++) await expect(page.getByTestId(items[i])).toHaveText(labels[i])
  // Trang chat trống → "Mới" đang được tô.
  await expect(page.getByTestId('nav-new')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('sidebar-footer')).toContainText('Dùng trên máy này')
  // Không trùng mục giữa hai thanh: Cài đặt chỉ ở thanh biểu tượng; Công việc đổi chữ thành "Dự án team".
  await expect(sidebar().getByRole('link', { name: 'Cài đặt' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Cài đặt' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Dự án team' })).toHaveCount(1)
})

test('Ctrl+B / nút ẩn thanh bên → ẩn hẳn, đầu khung chat có nút mở lại; tải lại vẫn giữ', async () => {
  await goTo(page, '#/', box())
  await page.keyboard.press('Control+b')
  await expect(sidebar()).toHaveCount(0, FAST)
  const show = page.getByTestId('sidebar-show')
  await expect(show).toBeVisible(FAST)
  await show.click()
  await expect(sidebar()).toBeVisible(FAST)
  await page.getByTestId('sidebar-hide').click()
  await expect(sidebar()).toHaveCount(0, FAST)
  // Ctrl+B cả khi đang gõ trong ô chat.
  await box().focus()
  await page.keyboard.press('Control+b')
  await expect(sidebar()).toBeVisible(FAST)
  await page.keyboard.press('Control+b')
  await page.reload()
  await waitForStartup(page)
  await goTo(page, '#/', box())
  await expect(sidebar()).toHaveCount(0)
  await page.keyboard.press('Control+b')
  await expect(sidebar()).toBeVisible(FAST)
})

test('Tìm kiếm: ô tìm hiện trên đầu danh sách, lọc ngay; Esc đóng và xoá', async () => {
  await chat('Lỗi Unity nhân vật xuyên tường')
  await chat('Ôn thi cơ sở dữ liệu')
  await expect(page.getByTestId('conversation-item')).toHaveCount(2)
  const search = page.getByRole('textbox', { name: 'Tìm cuộc trò chuyện' })
  await expect(search).toHaveCount(0)
  await page.getByTestId('nav-search').click()
  await expect(search).toBeFocused(FAST)
  await expect(page.getByTestId('nav-search')).toHaveAttribute('aria-current', 'page')
  await search.fill('unity')
  await expect(page.getByTestId('conversation-item')).toHaveCount(1)
  await search.press('Escape')
  await expect(search).toHaveCount(0, FAST)
  await expect(page.getByTestId('conversation-item')).toHaveCount(2)
})

test('Đã ghim / Gần đây thu gọn được, giữ sau khi tải lại', async () => {
  await goTo(page, '#/', box())
  const item = page.getByTestId('conversation-item').first()
  await item.hover()
  await item.getByRole('button', { name: 'Ghim' }).click()
  const pinned = page.getByTestId('section-pinned')
  await expect(pinned.getByTestId('conversation-item')).toHaveCount(1, FAST)
  await page.getByTestId('section-toggle-pinned').click()
  await expect(pinned.getByTestId('conversation-item')).toHaveCount(0, FAST)
  await expect(page.getByTestId('section-toggle-pinned')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('section-toggle-recent').click()
  await expect(page.getByTestId('section-recent').getByTestId('conversation-item')).toHaveCount(0, FAST)
  await page.reload()
  await waitForStartup(page)
  await goTo(page, '#/', box())
  await expect(page.getByTestId('section-toggle-pinned')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('section-toggle-recent')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('section-toggle-pinned').click()
  await page.getByTestId('section-toggle-recent').click()
  await expect(page.getByTestId('conversation-item')).toHaveCount(2, FAST)
})

test('trang Artifacts: mọi artifact của mọi cuộc, lọc không dấu, bấm → mở đúng cuộc + panel', async () => {
  await chat('FAKE_ARTIFACT:doc Viết tài liệu thiết kế game')
  await chat('FAKE_ARTIFACT:sheet Bảng cân bằng nhân vật')
  await page.getByTestId('nav-artifacts').click()
  const library = page.getByTestId('artifact-library')
  await expect(library).toBeVisible(FAST)
  await expect(page.getByTestId('nav-artifacts')).toHaveAttribute('aria-current', 'page')
  const items = library.getByTestId('artifact-library-item')
  // Mới sửa trước: bảng (tạo sau) đứng đầu.
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toHaveAttribute('data-title', 'Cân bằng')
  await expect(items.nth(0)).toContainText('Bảng tính')
  await expect(items.nth(1)).toHaveAttribute('data-title', 'GDD')
  await expect(items.nth(1)).toContainText('Tài liệu')
  await library.getByRole('textbox', { name: /Lọc theo tên/ }).fill('can bang')
  await expect(items).toHaveCount(1, FAST)
  await library.getByRole('textbox', { name: /Lọc theo tên/ }).fill('')

  // Bấm GDD → về trang chat của cuộc chứa nó, panel mở đúng GDD.
  await items.filter({ hasText: 'GDD' }).click()
  await expect(box()).toBeVisible(FAST)
  await expect(page.getByTestId('chat-title')).toContainText('Viết tài liệu')
  const panel = page.getByTestId('artifact-panel')
  await expect(panel).toBeVisible(FAST)
  await expect(panel.getByRole('combobox', { name: 'Chọn artifact' }).locator('option:checked')).toHaveText('GDD')

  // Đổi tên cuộc trò chuyện ở nơi khác → trang Artifacts cập nhật tên ngay (đồng bộ).
  await page.getByTestId('nav-artifacts').click()
  await page.evaluate(async () => {
    const api = (window as unknown as { api: { conversations: { list(): Promise<{ id: string; title: string }[]>; update(i: object): Promise<unknown> } } }).api
    const conv = (await api.conversations.list()).find((c) => c.title.includes('Viết tài liệu'))!
    await api.conversations.update({ id: conv.id, title: 'Thiết kế game' })
  })
  await expect(library.getByTestId('artifact-library-item').filter({ hasText: 'GDD' })).toContainText('Thiết kế game', FAST)
})

test('Dự án / Lịch hẹn / Plugin: trang "Sắp có", mục đang mở được tô', async () => {
  for (const [nav, section, title] of [
    ['nav-projects', 'projects', 'Dự án'],
    ['nav-scheduled', 'scheduled', 'Lịch hẹn'],
    ['nav-plugins', 'plugins', 'Plugin']
  ]) {
    await page.getByTestId(nav).click()
    const soon = page.getByTestId('coming-soon')
    await expect(soon).toHaveAttribute('data-section', section, FAST)
    await expect(soon.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(soon).toContainText('Sắp có')
    await expect(page.getByTestId(nav)).toHaveAttribute('aria-current', 'page')
  }
  // Bấm một cuộc trò chuyện ở thanh bên → về trang chat.
  await page.getByTestId('conversation-item').first().locator('button').first().click()
  await expect(box()).toBeVisible(FAST)
})

test('tin có chuỗi dài (URL, JSON) → khung chat không cuộn ngang ở 900px', async () => {
  // Panel artifact (mở từ test trước) chiếm chỗ — đóng để đo đúng khung chat.
  if (await page.getByTestId('artifact-panel').isVisible()) await page.getByTestId('artifacts-toggle').click()
  await expect(page.getByTestId('artifact-panel')).toHaveCount(0, FAST)
  await setWidth(900)
  const url = `https://example.com/${'duong-dan-rat-dai-'.repeat(20)}?q=${'x'.repeat(120)}`
  const json = JSON.stringify({ data: 'y'.repeat(300), list: Array.from({ length: 30 }, (_, i) => `muc${i}`) })
  await chat(url)
  await box().fill(json)
  await box().press('Enter')
  await expect(page.getByTestId('message-user')).toHaveCount(2, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  const overflow = await page.evaluate(() => {
    const sc = document.querySelector('[data-testid="message-user"]')!.closest('.overflow-y-auto') as HTMLElement
    return { scroll: sc.scrollWidth, client: sc.clientWidth }
  })
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1)
  // Bong bóng tin nằm trọn trong khung.
  const bubble = (await page.getByTestId('message-user').last().boundingBox())!
  const view = await page.evaluate(() => document.querySelector('[data-testid="chat-drop-zone"]')!.getBoundingClientRect().right)
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(view + 1)
  await setWidth(1280)
})

test('ảnh thanh bên sáng / tối ở 900 / 1280px', async () => {
  // Dữ liệu giống ảnh mẫu: Đã ghim, vài nhóm, Gần đây.
  await page.evaluate(async () => {
    type Api = {
      conversations: { list(): Promise<{ id: string; title: string; pinned: boolean }[]>; create(m: string): Promise<{ id: string }>; update(i: object): Promise<unknown> }
      conversationGroups: { create(name: string): Promise<{ id: string } | { error: string }> }
    }
    const api = (window as unknown as { api: Api }).api
    const make = async (title: string, extra: object = {}): Promise<void> => {
      const c = await api.conversations.create('free')
      await api.conversations.update({ id: c.id, title, ...extra })
    }
    const team = (await api.conversationGroups.create('team-working')) as { id: string }
    const unity = (await api.conversationGroups.create('unity-3d')) as { id: string }
    await make('Agent tính năng thiếu', { groupId: team.id })
    await make('Chia sẻ quyền truy cập Supabase', { groupId: team.id })
    await make('Nhân vật quay theo hướng chuột', { groupId: unity.id })
    await make('Camera jitter và animation', { groupId: unity.id })
    await make('Thực tập game development', { pinned: true })
    await make('Đề cương ôn thi cơ sở dữ liệu')
    await make('Lộ trình thực tập AI cho sinh viên')
  })
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  await expect(page.getByTestId('group-section')).toHaveCount(2)
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    for (const width of [900, 1280]) {
      await setWidth(width)
      await page.screenshot({ path: `test-results/sidebar-${theme}-${width}.png` })
    }
  }
  await page.getByTestId('theme-toggle').click()
  await setWidth(1280)
})
