import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Cửa sổ tìm kiếm nổi (Ctrl+K, PR 3): tab lọc, Gần đây + Hành động, phím tắt, xem trước artifact, Soạn, đồng bộ.
// Chạy được khi KHÔNG có Claude CLI (MMC_FAKE_CHAT).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-search-e2e-'))
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
/** Gọi IPC thẳng từ trang ("thay đổi từ nơi khác"). */
async function external(group: string, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    ({ group, method, args }) => (window as unknown as { api: Api }).api[group][method](...args),
    { group, method, args }
  )
}

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const palette = () => page.getByTestId('search-palette')
const input = () => page.getByTestId('palette-input')
const rows = () => palette().getByTestId('palette-item')
const row = (title: string | RegExp) => rows().filter({ hasText: title })
const selected = () => palette().locator('[role="option"][aria-selected="true"]')

async function chat(text: string): Promise<void> {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  await box().fill(text)
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant').last()).toContainText('Mizuki (giả lập) đã nhận', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
}

async function openPalette(): Promise<void> {
  if (!(await palette().isVisible())) await page.keyboard.press('Control+k')
  await expect(palette()).toBeVisible(FAST)
  await expect(input()).toBeFocused(FAST)
}

test('chuẩn bị dữ liệu: 2 cuộc trò chuyện + 1 artifact + 1 cuộc Code', async () => {
  await chat('Lỗi Unity nhân vật xuyên tường collider')
  await chat('Ôn thi cơ sở dữ liệu FAKE_ARTIFACT:doc')
  await expect.poll(async () => ((await external('artifacts', 'listAll')) as unknown[]).length).toBe(1)
  const code = (await external('conversations', 'create', 'code')) as { id: string }
  await external('conversations', 'update', { id: code.id, title: 'Sửa script Unity' })
  await expect(page.getByTestId('conversation-item')).toHaveCount(3, { timeout: 5_000 })
})

test('Ctrl+K mở ở mọi trang; chưa gõ: Gần đây + Hành động; Esc / Ctrl+K đóng; mục Tìm kiếm trên thanh bên mở được', async () => {
  await goTo(page, '#/artifacts', page.getByTestId('artifact-library'))
  await page.keyboard.press('Control+k')
  await expect(palette()).toBeVisible(FAST)
  await expect(input()).toBeFocused()
  await expect(palette()).toHaveAttribute('data-tab', 'all')
  await expect(palette().getByTestId('palette-section-recent').getByTestId('palette-item')).toHaveCount(4)
  const actions = palette().getByTestId('palette-section-actions')
  await expect(actions).toContainText('Cuộc trò chuyện mới')
  await expect(actions).toContainText('Cuộc trò chuyện Code mới')
  // Dòng mới nhất được chọn sẵn, có nút ⋯ và ↵ thay cho thời gian.
  await expect(selected()).toHaveCount(1)
  await expect(selected().getByTestId('palette-more')).toBeVisible()
  await expect(row('GDD')).toContainText('Tài liệu')
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0, FAST)

  await page.keyboard.press('Control+k')
  await expect(palette()).toBeVisible(FAST)
  await page.keyboard.press('Control+k')
  await expect(palette()).toHaveCount(0, FAST)

  await page.getByTestId('nav-search').click()
  await expect(palette()).toBeVisible(FAST)
  await expect(page.getByTestId('nav-search')).toHaveAttribute('aria-current', 'page')
  await palette().getByTestId('palette-close').click()
  await expect(palette()).toHaveCount(0, FAST)
})

test('tab lọc: Artifacts / Cuộc trò chuyện / Code; Dự án rỗng → "Tìm tất cả"; ← → đổi loại', async () => {
  await openPalette()
  await palette().getByTestId('palette-tab-artifacts').click()
  await expect(rows()).toHaveCount(1, FAST)
  await expect(rows().first()).toHaveAttribute('data-kind', 'artifact')
  await expect(input()).toBeFocused()
  await palette().getByTestId('palette-tab-chats').click()
  await expect(rows()).toHaveCount(2, FAST)
  await palette().getByTestId('palette-tab-code').click()
  await expect(rows()).toHaveCount(1, FAST)
  await expect(rows().first()).toHaveAttribute('data-title', 'Sửa script Unity')

  await palette().getByTestId('palette-tab-projects').click()
  await expect(palette().getByTestId('palette-empty')).toContainText('Không có kết quả trong Dự án')
  await palette().getByTestId('palette-search-all').click()
  await expect(palette()).toHaveAttribute('data-tab', 'all', FAST)

  // Ô trống: ← → đổi loại (vòng tròn).
  await page.keyboard.press('ArrowRight')
  await expect(palette()).toHaveAttribute('data-tab', 'artifacts', FAST)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(palette()).toHaveAttribute('data-tab', 'scheduled', FAST)
  // Đang gõ, con trỏ giữa chữ → ← chỉ di chuyển con trỏ.
  await input().fill('abc')
  await page.keyboard.press('ArrowLeft')
  await expect(palette()).toHaveAttribute('data-tab', 'scheduled')
  await input().fill('')
  await page.keyboard.press('Escape')
})

test('gõ để tìm: tiêu đề, artifact không dấu, nội dung tin nhắn có trích đoạn; không có kết quả', async () => {
  await openPalette()
  await input().fill('unity')
  await expect(rows()).toHaveCount(2)
  await expect(palette().getByTestId('palette-section-actions')).toHaveCount(0)
  await input().fill('gdd')
  await expect(rows()).toHaveCount(1)
  await expect(rows().first()).toHaveAttribute('data-kind', 'artifact')
  // Chỉ khớp nội dung tin nhắn → trích đoạn, chữ khớp tô đậm.
  await input().fill('collider')
  await expect(rows()).toHaveCount(1)
  await expect(rows().first().getByTestId('search-snippet').locator('strong')).toHaveText('collider')
  await input().fill('khongcogiheta')
  await expect(palette().getByTestId('palette-empty')).toContainText('Không có kết quả')
  await expect(palette().getByTestId('palette-search-all')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('↑ ↓ chọn, Enter mở cuộc trò chuyện; "/" chọn loại; Alt+Enter → Ghim (thanh bên đổi ngay)', async () => {
  await openPalette()
  await page.keyboard.press('/')
  await expect(palette().getByTestId('palette-filter')).toHaveCount(6, FAST)
  await expect(input()).toHaveValue('')
  // Tất cả → Artifacts → Cuộc trò chuyện → Code
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveAttribute('data-tab', 'code', FAST)
  await expect(rows()).toHaveCount(1)

  // Esc trong danh sách loại → về kết quả, chưa đóng cửa sổ.
  await page.keyboard.press('/')
  await page.keyboard.press('Escape')
  await expect(palette()).toBeVisible()
  await expect(rows()).toHaveCount(1)

  await page.keyboard.press('Alt+Enter')
  await expect(palette().getByTestId('palette-action')).toHaveText(['Mở', 'Ghim'])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0, FAST)
  await expect(page.getByTestId('section-pinned').getByTestId('conversation-item')).toHaveCount(1, FAST)

  await openPalette()
  await palette().getByTestId('palette-tab-chats').click()
  await page.keyboard.press('ArrowDown')
  const title = await selected().getAttribute('data-title')
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0, FAST)
  await expect(page.getByTestId('chat-title')).toHaveText(title ?? '___', FAST)
})

test('artifact: xem trước bên phải khi chọn; Enter → mở cuộc trò chuyện + panel artifact', async () => {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-new').click()
  await expect(page.getByTestId('artifact-panel')).toHaveCount(0)
  await openPalette()
  await palette().getByTestId('palette-tab-artifacts').click()
  const preview = palette().getByTestId('palette-preview')
  await expect(preview).toBeVisible(FAST)
  await expect(preview).toContainText('GDD')
  await expect(preview.getByTestId('palette-preview-text')).not.toContainText('Đang tải', FAST)
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'test-results/search-preview.png' })
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0, FAST)
  await expect(page.getByTestId('artifact-panel')).toBeVisible(FAST)
  await expect(page.getByTestId('artifact-panel')).toContainText('GDD')
})

test('Tab = Soạn: chữ đang gõ thành tin nhắn mới (chưa gửi); Hành động "Cuộc trò chuyện Code mới"', async () => {
  await openPalette()
  await input().fill('giải thích giúp mình async/await')
  await page.keyboard.press('Tab')
  await expect(palette()).toHaveCount(0, FAST)
  await expect(box()).toHaveValue('giải thích giúp mình async/await', FAST)
  await expect(box()).toBeFocused()
  await expect(page.getByTestId('message-user')).toHaveCount(0)
  await box().fill('')

  await openPalette()
  await palette().getByTestId('palette-section-actions').getByText('Cuộc trò chuyện Code mới').click()
  await expect(palette()).toHaveCount(0, FAST)
  await expect(page.getByRole('combobox', { name: 'Chế độ' })).toHaveValue('code', FAST)
})

test('đồng bộ: đổi tên từ nơi khác khi cửa sổ đang mở → hiện trong 1 giây', async () => {
  await openPalette()
  await palette().getByTestId('palette-tab-code').click()
  const list = (await external('conversations', 'list')) as { id: string; mode: string }[]
  const code = list.find((c) => c.mode === 'code')!
  await external('conversations', 'update', { id: code.id, title: 'Shader nước Unity' })
  await expect(rows().first()).toHaveAttribute('data-title', 'Shader nước Unity', FAST)
  await page.keyboard.press('Escape')
})

test('ảnh sáng / tối, 900px và 1280px', async () => {
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      await expect(palette()).toHaveCount(0)
      if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
        await page.getByTestId('theme-toggle').click()
      }
      await openPalette()
      // Chờ hiệu ứng hiện xong rồi mới chụp.
      await expect(palette()).toHaveCSS('opacity', '1')
      await page.waitForTimeout(250)
      // Khung chat không bị cuộn ngang, cửa sổ nằm gọn trong màn hình.
      const bound = await palette().boundingBox()
      expect(bound!.x).toBeGreaterThanOrEqual(0)
      expect(bound!.x + bound!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `test-results/search-${theme}-${width}.png` })
      await page.keyboard.press('Escape')
    }
  }
  await page.getByTestId('theme-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})
