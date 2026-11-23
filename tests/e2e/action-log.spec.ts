import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { goTo, waitForStartup } from './helpers'

// Nhật ký thao tác (Cài đặt → Quyền & riêng tư) — chạy được khi KHÔNG có Claude CLI: MMC_FAKE_CHAT ("FAKE_EDIT:<file>"
// xin sửa file qua thẻ duyệt, "FAKE_MCP:<server> <tool> <json>" gọi tool MCP như CLI — tool "luôn cho phép" chạy luôn
// không hỏi app), MMC_FAKE_FOLDER (hộp chọn thư mục giả). MCP server HTTP thật chạy trên 127.0.0.1.
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
let app: ElectronApplication
let page: Page
let userData: string
let project: string
let mcpServer: Server
let mcpUrl: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-action-log-e2e-'))
  project = join(userData, 'DuAnLog')
  mkdirSync(project)
  mcpServer = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    if (req.method !== 'POST') return void res.writeHead(405).end()
    const mcp = new McpServer({ name: 'echo', version: '1' })
    mcp.registerTool('echo', { description: 'Echo', inputSchema: { text: z.string() } }, async ({ text }) => ({
      content: [{ type: 'text', text: `echo ${text}` }]
    }))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => void transport.close())
    await mcp.connect(transport)
    await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString() || 'null'))
  })
  await new Promise<void>((r) => mcpServer.listen(0, '127.0.0.1', r))
  mcpUrl = `http://127.0.0.1:${(mcpServer.address() as { port: number }).port}/mcp`
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_FOLDER: project }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
})

test.afterAll(async () => {
  await app?.close()
  mcpServer?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const sendButton = (): ReturnType<Page['getByRole']> => page.getByRole('button', { name: 'Gửi' })
const card = (kind: string): ReturnType<Page['locator']> => page.locator(`[data-testid="approval-card"][data-kind="${kind}"]`)
const rows = (): ReturnType<Page['getByTestId']> => page.getByTestId('action-log-row')

async function send(text: string): Promise<void> {
  await goTo(page, '#/', box())
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}

async function openLog(): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/?settings=privacy'))
  await expect(page.getByTestId('settings-tab-privacy')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 })
}

test('chưa có thao tác: tab Quyền & riêng tư hiện nhật ký trống + ghi chú chỉ trên máy, 90 ngày', async () => {
  await openLog()
  await expect(page.getByTestId('action-log-empty')).toBeVisible()
  await expect(page.locator('[data-setting-id="actionLog"]')).toContainText('90 ngày')
  // Ô tìm của Cài đặt tìm được dòng này.
  const find = page.getByRole('textbox', { name: 'Tìm cài đặt' })
  await find.fill('nhat ky')
  await expect(page.getByTestId('settings-dialog').getByRole('list', { name: 'Tìm cài đặt' })).toContainText('Nhật ký thao tác')
  await find.fill('')
  await page.keyboard.press('Escape')
})

test('sửa file: Đồng ý → dòng "Sửa file · Đồng ý" kèm tên file và tên cuộc', async () => {
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Sửa file', write: true })}`)
  await card('folder').getByTestId('folder-access-choose').click({ timeout: 20_000 })
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await send('FAKE_EDIT:ghi-chu.txt')
  await card('code').getByTestId('approval-accept').click({ timeout: 20_000 })
  await expect(page.getByTestId('message-assistant').last()).toContainText('Đã sửa ghi-chu.txt', { timeout: 20_000 })
  await openLog()
  await expect(rows()).toHaveCount(1, { timeout: 1_000 })
  await expect(rows().first()).toHaveAttribute('data-kind', 'file_edit')
  await expect(rows().first().getByTestId('action-log-target')).toHaveText('ghi-chu.txt')
  await expect(rows().first().getByTestId('action-log-decision')).toHaveText('Đồng ý')
  await page.keyboard.press('Escape')
})

test('trang đang mở tự cập nhật: từ chối thẻ đang chờ → dòng mới hiện trong 1 giây', async () => {
  await send('FAKE_EDIT:khac.txt')
  await expect(card('code')).toBeVisible({ timeout: 20_000 })
  await openLog()
  await expect(rows()).toHaveCount(1)
  // Trả lời thẻ (đang nằm sau cửa sổ Cài đặt) qua IPC như nút Từ chối.
  await page.evaluate(async () => {
    const cards = await window.api.approvals.list()
    await window.api.code.respond(cards[0].id, false)
  })
  await expect(rows()).toHaveCount(2, { timeout: 1_000 })
  await expect(rows().first().getByTestId('action-log-target')).toHaveText('khac.txt')
  await expect(rows().first().getByTestId('action-log-decision')).toHaveAttribute('data-decision', 'rejected')
  await page.keyboard.press('Escape')
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
})

test('MCP: "Cho phép một lần" → "Đồng ý"; bấm "Luôn cho phép" → "Luôn cho phép"; lần sau tự chạy không thẻ → "Tự duyệt", khác màu', async () => {
  await page.evaluate((url) => window.api.mcp.save({ name: 'echo', type: 'http', url, headers: {}, enabled: true }), mcpUrl)
  await send('FAKE_MCP:echo echo {"text":"bí mật 1"}')
  await page.getByTestId('mcp-approval-once').click({ timeout: 20_000 })
  await expect(page.getByTestId('message-assistant').last()).toContainText('KẾT QUẢ MCP: echo bí mật 1', { timeout: 20_000 })
  await send('FAKE_MCP:echo echo {"text":"lần 2"}')
  await page.getByTestId('mcp-approval-always').click({ timeout: 20_000 })
  await expect(page.getByTestId('message-assistant').last()).toContainText('KẾT QUẢ MCP: echo lần 2', { timeout: 20_000 })
  await send('FAKE_MCP:echo echo {"text":"lần 3"}')
  await expect(page.getByTestId('message-assistant').last()).toContainText('KẾT QUẢ MCP: echo lần 3', { timeout: 20_000 })
  await expect(page.getByTestId('mcp-approval')).toHaveCount(0)

  await openLog()
  await page.getByTestId('action-log-kind').selectOption('mcp')
  await expect(rows()).toHaveCount(3, { timeout: 1_000 })
  const badges = rows().getByTestId('action-log-decision')
  await expect(badges).toHaveText(['Tự duyệt', 'Luôn cho phép', 'Đồng ý'])
  expect(await badges.evaluateAll((els) => els.map((e) => e.getAttribute('data-decision')))).toEqual(['auto', 'always', 'approved'])
  // "Tự duyệt" (không ai bấm) khác màu nhãn người dùng bấm.
  const color = (i: number): Promise<string> => badges.nth(i).evaluate((e) => getComputedStyle(e).color)
  expect(await color(0)).not.toBe(await color(1))
  expect(await color(0)).not.toBe(await color(2))
  await expect(rows().getByTestId('action-log-target')).toHaveText(['echo/echo', 'echo/echo', 'echo/echo'])
  // Không chép tham số.
  await expect(page.getByTestId('action-log-list')).not.toContainText('bí mật')
})

test('lọc: theo chữ (không dấu) và theo cuộc; bấm dòng → mở đúng cuộc', async () => {
  await page.getByTestId('action-log-kind').selectOption('')
  await expect(rows()).toHaveCount(5, { timeout: 1_000 })
  await page.getByTestId('action-log-search').fill('GHI CHU')
  await expect(rows()).toHaveCount(1, { timeout: 1_000 })
  await page.getByTestId('action-log-search').fill('khong-co-gi')
  await expect(page.getByTestId('action-log-empty')).toContainText('Không có thao tác nào khớp', { timeout: 1_000 })
  await page.getByTestId('action-log-search').fill('')
  await expect(rows()).toHaveCount(5, { timeout: 1_000 })
  const options = page.getByTestId('action-log-conversation').locator('option')
  await expect(options).toHaveCount(2) // "Mọi cuộc" + một cuộc

  await screenshot('action-log')

  // Bấm dòng sửa file → về khung chat, đúng cuộc (thanh thư mục của cuộc đó).
  await page.getByTestId('action-log-search').fill('ghi-chu')
  await rows().first().getByRole('button').click()
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByTestId('code-bar')).toContainText('DuAnLog', { timeout: 1_000 })
})

test('cuộc đã xoá: dòng còn, ghi "Cuộc đã xoá", không bấm được, không có con trỏ bàn tay', async () => {
  await openLog()
  const cursor = (el: ReturnType<Page['locator']>): Promise<string> => el.evaluate((e) => getComputedStyle(e).cursor)
  // Trước khi xoá: dòng mở được có con trỏ bàn tay.
  expect(await cursor(rows().first().getByRole('button'))).toBe('pointer')
  await page.evaluate(async () => {
    for (const c of await window.api.conversations.list()) await window.api.conversations.remove(c.id)
  })
  await expect(rows().getByRole('button')).toHaveCount(0, { timeout: 1_000 })
  await expect(rows()).toHaveCount(5)
  await expect(rows().first()).toContainText('Cuộc đã xoá')
  const fixed = rows().first().getByTestId('action-log-static')
  expect(await cursor(fixed)).toBe('default')
  // Rê chuột không đổi nền.
  const bg = await fixed.evaluate((e) => getComputedStyle(e).backgroundColor)
  await fixed.hover()
  expect(await fixed.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(bg)
  await screenshot('action-log-deleted')
})

/** Ảnh cửa sổ Cài đặt ở giao diện sáng + tối (đổi lớp `dark` như cài đặt giao diện làm). */
async function screenshot(name: string): Promise<void> {
  const dialog = page.getByTestId('settings-dialog')
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
    await dialog.screenshot({ path: `test-results/${name}-${theme}.png` })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}
