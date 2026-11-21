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
  // Cố định cỡ cửa sổ (máy CI mặc định nhỏ hơn) để bố cục giống nhau mọi máy.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
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
  await expect(sidebar().getByRole('button', { name: 'Cài đặt' })).toHaveCount(0)
  await expect(page.getByTestId('nav-settings')).toHaveCount(1)
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

test('Tìm kiếm: mục trên thanh bên mở cửa sổ nổi (chi tiết ở search.spec.ts)', async () => {
  await chat('Lỗi Unity nhân vật xuyên tường')
  await chat('Ôn thi cơ sở dữ liệu')
  await page.getByTestId('nav-search').click()
  const input = page.getByTestId('palette-input')
  await expect(input).toBeFocused(FAST)
  await expect(page.getByTestId('nav-search')).toHaveAttribute('aria-current', 'page')
  await input.fill('unity')
  await expect(page.getByTestId('search-palette').getByTestId('palette-item')).toHaveCount(1)
  await input.press('Escape')
  await expect(input).toHaveCount(0, FAST)
  // Thanh bên luôn đủ danh sách (không lọc theo ô tìm).
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
  // Panel đang mở — cửa sổ nhỏ (CI) thì thanh bên tự ẩn → vào trang bằng đường dẫn.
  await goTo(page, '#/artifacts', library)
  await page.evaluate(async () => {
    const api = (window as unknown as { api: { conversations: { list(): Promise<{ id: string; title: string }[]>; update(i: object): Promise<unknown> } } }).api
    const conv = (await api.conversations.list()).find((c) => c.title.includes('Viết tài liệu'))!
    await api.conversations.update({ id: conv.id, title: 'Thiết kế game' })
  })
  await expect(library.getByTestId('artifact-library-item').filter({ hasText: 'GDD' })).toContainText('Thiết kế game', FAST)
})

test('Dự án, Lịch hẹn, Plugin là trang thật; mục đang mở được tô', async () => {
  await page.getByTestId('nav-projects').click()
  await expect(page.getByTestId('projects-page')).toBeVisible(FAST)
  await expect(page.getByTestId('nav-projects')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('nav-plugins').click()
  await expect(page.getByTestId('plugins-page')).toBeVisible(FAST)
  await expect(page.getByTestId('nav-plugins')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('nav-scheduled').click()
  const schedules = page.getByTestId('schedules-page')
  await expect(schedules.getByRole('heading', { level: 1 })).toHaveText('Lịch hẹn', FAST)
  // Mặc định TẮT: giải thích + nút bật (qua cảnh báo).
  await expect(page.getByTestId('schedules-disabled')).toBeVisible()
  await expect(page.getByTestId('nav-scheduled')).toHaveAttribute('aria-current', 'page')
  // Bấm một cuộc trò chuyện ở thanh bên → về trang chat.
  await page.getByTestId('conversation-item').first().locator('button').first().click()
  await expect(box()).toBeVisible(FAST)
})

/** Bề rộng khung chat (giữa thanh bên và panel). */
const chatWidth = async (): Promise<number> => Math.round((await page.getByTestId('chat-drop-zone').boundingBox())!.width)
const sidebarWidth = async (): Promise<number> => Math.round((await page.getByTestId('sidebar-wrap').boundingBox())!.width)
/** Kéo tay kéo một đoạn `dx`; `hold` = giữ chuột (để chụp ảnh lúc đang kéo). */
async function drag(testId: string, dx: number, hold = false): Promise<void> {
  const b = (await page.getByTestId(testId).boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 8 })
  if (!hold) await page.mouse.up()
}
async function themeShot(name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await page.screenshot({ path: `test-results/${name}-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
}

test('900px + panel artifact: thanh bên tự ẩn, khung chat ≥ 360; đóng panel → hiện lại; Ctrl+B → thanh bên nổi không ép khung chat', async () => {
  await setWidth(900)
  // Panel artifact có thể còn mở từ test trước (thanh bên đang tự ẩn) → vào trang Artifacts bằng đường dẫn.
  await goTo(page, '#/artifacts', page.getByTestId('artifact-library'))
  await page.getByTestId('artifact-library-item').filter({ hasText: 'GDD' }).click()
  const panel = page.getByTestId('artifact-panel')
  await expect(panel).toBeVisible(FAST)
  // Không đủ chỗ cho cả ba → thanh bên tự ẩn, nút mở lại ở đầu khung chat.
  await expect(sidebar()).toHaveCount(0, FAST)
  await expect(page.getByTestId('chat-layout')).toHaveAttribute('data-auto-hidden', 'true')
  expect(await chatWidth()).toBeGreaterThanOrEqual(358)
  // Khung chat hẹp vẫn dùng được: không cuộn ngang (nút thao tác của tin xuống dưới bong bóng / xuống dòng).
  const scroll = await page.evaluate(() => {
    const sc = document.querySelector('[data-testid="message-user"]')!.closest('.overflow-y-auto') as HTMLElement
    return { scroll: sc.scrollWidth, client: sc.clientWidth }
  })
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client + 1)
  await themeShot('narrow-panel')

  // Ctrl+B → thanh bên nổi đè lên, khung chat giữ nguyên bề rộng.
  const before = await chatWidth()
  await page.keyboard.press('Control+b')
  const overlay = page.getByTestId('sidebar-overlay')
  await expect(overlay).toBeVisible(FAST)
  await expect(overlay).toHaveAttribute('data-mode', 'pinned')
  expect(await chatWidth()).toBe(before)
  await themeShot('narrow-panel-overlay')
  await page.keyboard.press('Control+b')
  await expect(overlay).toHaveCount(0, FAST)
  // Nút ở đầu khung chat cũng mở thanh bên nổi; Esc đóng.
  await page.getByTestId('sidebar-show').click()
  await expect(overlay).toBeVisible(FAST)
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0, FAST)

  // Đóng panel → thanh bên hiện lại cố định (lựa chọn của người dùng vẫn là "hiện").
  await page.getByTestId('artifacts-toggle').click()
  await expect(panel).toHaveCount(0, FAST)
  await expect(sidebar()).toBeVisible(FAST)
  await expect(page.getByTestId('chat-layout')).not.toHaveAttribute('data-auto-hidden', 'true')
  // Cửa sổ rộng + panel → cả ba cùng hiện, khung chat vẫn ≥ 360.
  await setWidth(1280)
  await page.getByTestId('artifacts-toggle').click()
  await expect(panel).toBeVisible(FAST)
  await expect(sidebar()).toBeVisible(FAST)
  expect(await chatWidth()).toBeGreaterThanOrEqual(358)
  await page.getByTestId('artifacts-toggle').click()
})

test('kéo mép thanh bên: đổi độ rộng, giới hạn 200–420 và chừa ≥ 360 cho khung chat, kéo nhỏ quá → ẩn, nhấp đúp → mặc định, nhớ sau tải lại', async () => {
  await setWidth(1280)
  await goTo(page, '#/', box())
  expect(await sidebarWidth()).toBe(256)
  await drag('sidebar-resize', 100)
  expect(await sidebarWidth()).toBe(356)
  // Rê chuột vào tay kéo → con trỏ ↔.
  expect(await page.getByTestId('sidebar-resize').evaluate((el) => getComputedStyle(el).cursor)).toBe('col-resize')
  await drag('sidebar-resize', 400)
  expect(await sidebarWidth()).toBe(420)
  // 420 - 250 = 170: dưới mức tối thiểu nhưng chưa tới ngưỡng ẩn (140) → giữ ở 200.
  await drag('sidebar-resize', -250)
  expect(await sidebarWidth()).toBe(200)
  // Nhấp đúp → mặc định.
  await page.getByTestId('sidebar-resize').dblclick()
  expect(await sidebarWidth()).toBe(256)

  // Ảnh lúc đang kéo (vạch sáng ở mép) — sáng rồi tối; không bấm gì khi đang giữ chuột.
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await drag('sidebar-resize', 30, true)
    await expect(page.getByTestId('sidebar-resize')).toHaveAttribute('data-dragging', 'true')
    await page.screenshot({ path: `test-results/sidebar-dragging-${theme}.png` })
    await page.mouse.up()
    await expect(page.getByTestId('sidebar-resize')).not.toHaveAttribute('data-dragging', 'true')
  }
  await page.getByTestId('theme-toggle').click()
  expect(await sidebarWidth()).toBe(316)

  // Nhớ sau khi tải lại.
  await page.reload()
  await waitForStartup(page)
  await goTo(page, '#/', box())
  expect(await sidebarWidth()).toBe(316)

  // Thiếu chỗ (cửa sổ app tối thiểu 900px nên thử bằng panel artifact 520px): thanh bên không kéo rộng hơn mức
  // chừa 360px cho khung chat — 1280 - 56 thanh biểu tượng - 520 - 360 = 344.
  await page.getByTestId('artifacts-toggle').click()
  await expect(page.getByTestId('artifact-panel')).toBeVisible(FAST)
  await drag('sidebar-resize', 300)
  expect(await sidebarWidth()).toBe(344)
  expect(await chatWidth()).toBeGreaterThanOrEqual(358)
  await page.getByTestId('artifacts-toggle').click()

  // Kéo nhỏ hơn mức tối thiểu một đoạn → ẩn hẳn (như Ctrl+B); hiện lại giữ độ rộng cũ.
  await drag('sidebar-resize', -250)
  await expect(sidebar()).toHaveCount(0, FAST)
  await expect(page.getByTestId('sidebar-show')).toBeVisible(FAST)
  await page.keyboard.press('Control+b')
  await expect(sidebar()).toBeVisible(FAST)
  expect(await sidebarWidth()).toBe(344)
  await page.getByTestId('sidebar-resize').dblclick()
  expect(await sidebarWidth()).toBe(256)
})

test('thanh bên đang ẩn: đưa chuột sát mép trái → thanh bên nổi, rời chuột → ẩn lại', async () => {
  await goTo(page, '#/', box())
  await page.keyboard.press('Control+b')
  await expect(sidebar()).toHaveCount(0, FAST)
  const before = await chatWidth()
  const edge = (await page.getByTestId('sidebar-hot-edge').boundingBox())!
  await page.mouse.move(edge.x + 600, edge.y + 300)
  await page.mouse.move(edge.x + 2, edge.y + 300, { steps: 10 })
  const overlay = page.getByTestId('sidebar-overlay')
  await expect(overlay).toBeVisible(FAST)
  await expect(overlay).toHaveAttribute('data-mode', 'hover')
  expect(await chatWidth()).toBe(before)
  // Rê vào trong thanh bên vẫn mở; rời chuột ra nội dung → ẩn.
  await page.mouse.move(edge.x + 120, edge.y + 300, { steps: 5 })
  await expect(overlay).toBeVisible()
  await page.mouse.move(edge.x + 700, edge.y + 300, { steps: 5 })
  await expect(overlay).toHaveCount(0, FAST)
  // Nút trong thanh bên nổi → ghim lại thành cố định (đủ chỗ).
  await page.mouse.move(edge.x + 2, edge.y + 300, { steps: 5 })
  await page.getByTestId('sidebar-overlay-toggle').click()
  await expect(overlay).toHaveCount(0, FAST)
  await expect(page.getByTestId('sidebar-wrap')).toBeVisible(FAST)
})

test('panel artifact: kéo mép trái đổi độ rộng, nhấp đúp về mặc định, nhớ sau tải lại', async () => {
  await setWidth(1280)
  await goTo(page, '#/artifacts', page.getByTestId('artifact-library'))
  await page.getByTestId('artifact-library-item').filter({ hasText: 'GDD' }).click()
  const panel = page.getByTestId('artifact-panel')
  await expect(panel).toBeVisible(FAST)
  const width = async (): Promise<number> => Math.round((await panel.boundingBox())!.width)
  expect(await width()).toBe(520)
  await drag('artifact-panel-resize', -80)
  expect(await width()).toBe(600)
  expect(await chatWidth()).toBeGreaterThanOrEqual(358)
  await page.reload()
  await waitForStartup(page)
  await goTo(page, '#/artifacts', page.getByTestId('artifact-library'))
  await page.getByTestId('artifact-library-item').filter({ hasText: 'GDD' }).click()
  await expect(panel).toBeVisible(FAST)
  expect(await width()).toBe(600)
  await page.getByTestId('artifact-panel-resize').dblclick()
  expect(await width()).toBe(520)
  await page.getByTestId('artifacts-toggle').click()
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
