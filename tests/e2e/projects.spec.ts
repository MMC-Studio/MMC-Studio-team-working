import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Dự án (PR 5a): tạo, hướng dẫn + file ngữ cảnh vào prompt (kiểm bằng trợ lý giả), giới hạn ký tự hiện cho người dùng,
// ghim (thanh bên + Ctrl+K), xoá (đếm file / trí nhớ, giữ cuộc trò chuyện). Chạy được khi KHÔNG có Claude CLI.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const FAST = { timeout: 1_000 }
let app: ElectronApplication
let page: Page
let userData: string
let files: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-projects-e2e-'))
  files = mkdtempSync(join(tmpdir(), 'mmc-projects-files-'))
  // gdd + big vừa 16.000 ký tự; huge bị cắt; notes hết chỗ → chỉ gửi tên; ảnh bị từ chối.
  const paths = [
    ['gdd.md', '# GDD\nGame 2D platformer, nhân vật nhảy hai lần.'],
    ['big.md', 'b'.repeat(9_000)],
    ['huge.md', 'h'.repeat(9_000)],
    ['notes.txt', 'ghi chú ngắn'],
    ['anh.png', '\u0000PNG']
  ].map(([name, content]) => {
    const path = join(files, name)
    writeFileSync(path, content)
    return path
  })
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      TEAM_WORKING_USER_DATA: userData,
      MMC_FAKE_CHAT: '1',
      // Trợ lý giả có session như Claude CLI: lượt --resume giữ system prompt của lượt tạo session.
      MMC_FAKE_CLI_SESSIONS: '1',
      MMC_FAKE_PROJECT_FILES: paths.join('|')
    }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(files, { recursive: true, force: true })
})

const box = () => page.getByRole('textbox', { name: /Nhắn cho/ })
const projectBox = () => page.getByRole('textbox', { name: /Cuộc trò chuyện mới trong/ })
const lastReply = () => page.getByTestId('message-assistant').last()

test('trang Dự án trống → tạo dự án → mở trang dự án', async () => {
  await goTo(page, '#/', box())
  await page.getByTestId('nav-projects').click()
  await expect(page.getByTestId('projects-empty')).toBeVisible(FAST)
  await expect(page.getByTestId('nav-projects')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('project-new').click()
  await page.getByLabel('Tên dự án').fill('Game Pixel')
  await page.getByLabel('Mô tả (không bắt buộc)').fill('Game 2D làm bằng Unity')
  await page.getByRole('button', { name: 'Tạo dự án' }).click()
  await expect(page.getByTestId('project-name')).toHaveText('Game Pixel', FAST)
  await expect(page.getByTestId('project-page')).toContainText('Game 2D làm bằng Unity')
  await expect(page.getByTestId('project-memory-empty')).toBeVisible()
  await expect(page.getByTestId('panel-scheduled')).toContainText('Chưa có lịch hẹn nào cho dự án này.')
})

test('hướng dẫn: sửa → hiện ngay ở cột phải', async () => {
  await page.getByTestId('project-edit-instructions').click()
  await page.getByTestId('instructions-input').fill('Luôn trả lời bằng C#')
  await page.getByTestId('instructions-save').click()
  await expect(page.getByTestId('project-instructions')).toHaveText('Luôn trả lời bằng C#', FAST)
})

test('file ngữ cảnh: chỉ nhận file chữ; bị cắt / chỉ gửi tên thì báo; gỡ file → biến mất ngay', async () => {
  await page.getByTestId('project-add-files').click()
  const rows = page.getByTestId('project-file')
  await expect(rows).toHaveCount(4, FAST)
  await expect(page.getByTestId('project-add-rejected')).toContainText('anh.png — không phải file chữ')
  await expect(rows.filter({ hasText: 'gdd.md' })).toHaveAttribute('data-usage', 'full')
  await expect(rows.filter({ hasText: 'big.md' })).toHaveAttribute('data-usage', 'full')
  await expect(rows.filter({ hasText: 'huge.md' })).toHaveAttribute('data-usage', 'clipped')
  await expect(rows.filter({ hasText: 'huge.md' }).getByTestId('project-file-usage')).toHaveText('Bị cắt bớt')
  await expect(rows.filter({ hasText: 'notes.txt' })).toHaveAttribute('data-usage', 'omitted')
  await expect(rows.filter({ hasText: 'notes.txt' }).getByTestId('project-file-usage')).toHaveText('Chỉ gửi tên')
  await expect(page.getByTestId('project-limit-warning')).toBeVisible()
  await expect(page.getByTestId('project-usage')).toContainText('/ 16.000')

  const notes = rows.filter({ hasText: 'notes.txt' })
  await notes.hover()
  await notes.getByTestId('project-file-remove').click()
  await expect(rows).toHaveCount(3, FAST)
})

test('gửi trong dự án → cuộc mới thuộc dự án; trợ lý nhận hướng dẫn + file; đầu khung chat có tên dự án', async () => {
  await projectBox().fill('Xin chào dự án')
  await projectBox().press('Enter')
  await expect(lastReply()).toContainText('[dự án: Game Pixel | hướng dẫn: Luôn trả lời bằng C# | file: gdd.md, big.md, huge.md]', {
    timeout: 20_000
  })
  await expect(page.getByTestId('chat-project')).toHaveText(/Game Pixel/)
  const row = page.getByTestId('conversation-item').first()
  await expect(row.getByLabel('Thuộc dự án')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
})

test('cùng cuộc, không đổi gì → giữ session (không gửi lại lịch sử)', async () => {
  await box().fill('tin thứ hai')
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(2, { timeout: 20_000 })
  await expect(lastReply()).toContainText('hướng dẫn: Luôn trả lời bằng C#', { timeout: 20_000 })
  await expect(lastReply()).not.toContainText('[kèm lịch sử]')
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
})

// Lỗi thật (test tay #30 với Claude): CLI khi --resume giữ system prompt cũ → hướng dẫn mới không có hiệu lực
// trong cuộc đang dở. App phải mở session mới (kèm lịch sử) khi phần dự án của prompt đổi.
test('sửa hướng dẫn giữa chừng → có hiệu lực từ tin tiếp theo trong cùng cuộc', async () => {
  await page.getByTestId('chat-project').click()
  await expect(page.getByTestId('project-conversation')).toHaveCount(1, FAST)
  await page.getByTestId('project-edit-instructions').click()
  await page.getByTestId('instructions-input').fill('Trả lời bằng Python')
  await page.getByTestId('instructions-save').click()
  await expect(page.getByTestId('project-instructions')).toHaveText('Trả lời bằng Python', FAST)
  await page.getByTestId('project-conversation').first().click()
  await box().fill('tin thứ ba')
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(3, { timeout: 20_000 })
  await expect(lastReply()).toContainText('hướng dẫn: Trả lời bằng Python', { timeout: 20_000 })
  // Session mới nên gửi kèm lịch sử để trợ lý vẫn nắm ngữ cảnh cuộc trò chuyện.
  await expect(lastReply()).toContainText('[kèm lịch sử]')
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })

  // Lượt sau nữa không đổi gì → dùng tiếp session mới, vẫn hướng dẫn mới.
  await box().fill('tin thứ tư')
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(4, { timeout: 20_000 })
  await expect(lastReply()).toContainText('hướng dẫn: Trả lời bằng Python', { timeout: 20_000 })
  await expect(lastReply()).not.toContainText('[kèm lịch sử]')
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
})

test('thêm / gỡ file ngữ cảnh giữa chừng cũng có hiệu lực ở lượt tiếp theo', async () => {
  await page.getByTestId('chat-project').click()
  const huge = page.getByTestId('project-file').filter({ hasText: 'huge.md' })
  await huge.hover()
  await huge.getByTestId('project-file-remove').click()
  await expect(page.getByTestId('project-file')).toHaveCount(2, FAST)
  await page.getByTestId('project-conversation').first().click()
  await box().fill('tin thứ năm')
  await box().press('Enter')
  await expect(page.getByTestId('message-assistant')).toHaveCount(5, { timeout: 20_000 })
  await expect(lastReply()).toContainText('file: gdd.md, big.md]', { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
})

test('ghim: hiện trong "Đã ghim" ở thanh bên + tab Dự án của Ctrl+K; tìm / sắp xếp ở trang Dự án', async () => {
  await page.getByTestId('nav-projects').click()
  const card = page.getByTestId('project-card').filter({ hasText: 'Game Pixel' })
  await card.hover()
  await card.getByTestId('project-pin').click()
  const pinned = page.getByTestId('section-pinned').getByTestId('pinned-project')
  await expect(pinned).toHaveCount(1, FAST)
  await expect(pinned).toHaveAttribute('data-name', 'Game Pixel')

  // Dự án thứ hai: dự án ghim vẫn đứng đầu; tìm không dấu.
  await page.getByTestId('project-new').click()
  await page.getByLabel('Tên dự án').fill('Ôn thi cuối kỳ')
  await page.getByRole('button', { name: 'Tạo dự án' }).click()
  await expect(page.getByTestId('project-name')).toHaveText('Ôn thi cuối kỳ', FAST)
  await page.getByTestId('nav-projects').click()
  await expect(page.getByTestId('project-card').first()).toHaveAttribute('data-name', 'Game Pixel')
  await page.getByTestId('projects-search-open').click()
  await page.getByTestId('projects-search').fill('on thi')
  await expect(page.getByTestId('project-card')).toHaveCount(1, FAST)
  await page.getByTestId('projects-search').press('Escape')
  await expect(page.getByTestId('project-card')).toHaveCount(2)

  await pinned.click()
  await expect(page.getByTestId('project-name')).toHaveText('Game Pixel', FAST)

  await page.keyboard.press('Control+k')
  await page.getByTestId('palette-tab-projects').click()
  const items = page.getByTestId('search-palette').getByTestId('palette-item')
  await expect(items).toHaveCount(2, FAST)
  await page.getByTestId('palette-input').fill('on thi')
  await expect(items).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('project-name')).toHaveText('Ôn thi cuối kỳ', FAST)
})

test('xoá dự án: hộp xác nhận đếm file + trí nhớ; cuộc trò chuyện được giữ, thành cuộc thường', async () => {
  await page.getByTestId('section-pinned').getByTestId('pinned-project').click()
  await expect(page.getByTestId('project-name')).toHaveText('Game Pixel', FAST)
  await page.getByTestId('project-page').getByTestId('project-menu').first().click()
  await page.getByTestId('project-menu-delete').click()
  const counts = page.getByTestId('project-delete-counts')
  await expect(counts).toContainText('2 file ngữ cảnh')
  await expect(counts).toContainText('0 trí nhớ của dự án')
  await expect(page.getByTestId('project-delete-dialog')).toContainText('1 cuộc trò chuyện được giữ lại')
  await page.getByTestId('project-delete-confirm').click()
  await expect(page.getByTestId('projects-page')).toBeVisible(FAST)
  await expect(page.getByTestId('project-card')).toHaveCount(1, FAST)
  await expect(page.getByTestId('pinned-project')).toHaveCount(0, FAST)
  // Cuộc trò chuyện vẫn còn, không còn biểu tượng dự án.
  const row = page.getByTestId('conversation-item').first()
  await expect(row).toBeVisible()
  await expect(row.getByLabel('Thuộc dự án')).toHaveCount(0, FAST)
  await row.click()
  await expect(page.getByTestId('chat-project')).toHaveCount(0)
})

test('chế độ "project" hiện là "Quản lý công việc"', async () => {
  await page.getByTestId('nav-new').click()
  await expect(page.getByRole('combobox', { name: 'Chế độ' }).locator('option[value="project"]')).toHaveText('Quản lý công việc')
})

test('ảnh sáng / tối, 900px và 1280px', async () => {
  // Thêm lại file để trang dự án có đủ phần (cột phải, cảnh báo giới hạn).
  await page.getByTestId('nav-projects').click()
  await page.getByTestId('project-card').first().click()
  await page.getByTestId('project-add-files').click()
  await expect(page.getByTestId('project-file')).toHaveCount(4, FAST)
  for (const width of [1280, 900]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 820), width)
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
        await page.getByTestId('theme-toggle').click()
      }
      const noHScroll = await page.getByTestId('project-page').evaluate((el) => el.scrollWidth <= el.clientWidth)
      expect(noHScroll).toBe(true)
      await page.screenshot({ path: `test-results/project-${theme}-${width}.png` })
      await page.getByTestId('project-breadcrumb').click()
      await page.screenshot({ path: `test-results/projects-${theme}-${width}.png` })
      await page.getByTestId('project-card').first().click()
    }
  }
  await page.getByTestId('theme-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})
