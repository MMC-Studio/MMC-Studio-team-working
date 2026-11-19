import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Thẻ duyệt trong khung chat + "Hỏi lại" + "Từ chối kèm góp ý" — chạy được khi KHÔNG có Claude CLI:
// MMC_FAKE_CHAT ("FAKE_EDIT:<file>" xin sửa file qua thẻ duyệt diff như CLI; câu hỏi trên thẻ trả lời giả lập),
// MMC_FAKE_FOLDER (hộp chọn thư mục giả).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
let app: ElectronApplication
let page: Page
let userData: string
let project: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-approvals-e2e-'))
  project = join(userData, 'DuAn')
  mkdirSync(project, { recursive: true })
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, TEAM_WORKING_USER_DATA: userData, MMC_FAKE_CHAT: '1', MMC_FAKE_FOLDER: project }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const askBox = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Hỏi về đề xuất đang chờ duyệt/ })
const sendButton = (): ReturnType<Page['getByRole']> => page.getByRole('button', { name: 'Gửi' })
const lastReply = (): ReturnType<Page['getByTestId']> => page.getByTestId('message-assistant').last()
const card = (kind: string): ReturnType<Page['locator']> => page.locator(`[data-testid="approval-card"][data-kind="${kind}"]`)

async function send(text: string): Promise<void> {
  await goTo(page, '#/', box())
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}

/** Gõ câu hỏi vào ô chat (đang ở chế độ hỏi về thẻ) → câu hỏi hiện trên thẻ trong 1 giây. */
async function askAbout(target: ReturnType<Page['locator']>, question: string, nth: number): Promise<void> {
  await askBox().fill(question)
  await askBox().press('Enter')
  await expect(target.getByTestId('approval-question')).toHaveCount(nth, { timeout: 1_000 })
  await expect(target.getByTestId('approval-question').nth(nth - 1)).toHaveText(question)
  await expect(target.getByTestId('approval-answer').nth(nth - 1)).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
}

/** Gõ vào ô nhập TRÊN thẻ rồi bấm "Hỏi" → câu trả lời hiện dưới thẻ, thẻ vẫn chờ. */
async function askOnCard(target: ReturnType<Page['locator']>, question: string, nth: number): Promise<void> {
  await target.getByTestId('approval-input').fill(question)
  await target.getByTestId('approval-ask-send').click()
  await expect(target.getByTestId('approval-question')).toHaveCount(nth, { timeout: 1_000 })
  await expect(target.getByTestId('approval-input')).toHaveValue('')
  await expect(target.getByTestId('approval-answer').nth(nth - 1)).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
}

/** Gõ vào ô nhập trên thẻ rồi bấm "Yêu cầu sửa". */
async function revise(target: ReturnType<Page['locator']>, request: string): Promise<void> {
  await target.getByTestId('approval-input').fill(request)
  await target.getByTestId('approval-revise').click()
}

test('thẻ thư mục: "Yêu cầu sửa" → trợ lý nhận yêu cầu (không hiện chữ "từ chối" trên thẻ)', async () => {
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Xem cấu hình', write: true })}`)
  const folder = card('folder')
  await expect(folder).toBeVisible({ timeout: 20_000 })
  // Thẻ nằm trong vùng tin nhắn, không phải hộp thoại nổi; không còn nút "Từ chối kèm góp ý".
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(folder).not.toContainText('kèm góp ý')
  // Chưa gõ gì → hai nút không bấm được (không tự đoán câu hỏi / yêu cầu).
  await expect(folder.getByTestId('approval-ask-send')).toBeDisabled()
  await expect(folder.getByTestId('approval-revise')).toBeDisabled()
  await revise(folder, 'chỉ cần quyền đọc thôi')
  await expect(folder).toHaveCount(0, { timeout: 1_000 })
  await expect(lastReply()).toContainText('góp ý: "chỉ cần quyền đọc thôi"', { timeout: 20_000 })
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
})

test('thẻ thư mục: hỏi trên thẻ, rồi cấp quyền sửa', async () => {
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Sửa file cấu hình', write: true })}`)
  const folder = card('folder')
  await expect(folder).toBeVisible({ timeout: 20_000 })
  await expect(folder.getByTestId('approval-version')).toHaveCount(0)
  await askOnCard(folder, 'Thư mục này để làm gì?', 1)
  await expect(folder.getByTestId('approval-answer').first()).toContainText('Giải thích (giả lập) #1')
  await expect(folder.getByTestId('approval-answer').first()).toContainText('đọc + sửa')

  await folder.getByTestId('folder-access-choose').click()
  await expect(folder).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByTestId('code-bar')).toContainText('DuAn', { timeout: 1_000 })
  // App tự gửi lượt "tiếp tục" — chờ xong để lượt sau có quyền sửa.
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await expect(sendButton()).toBeVisible({ timeout: 20_000 })
})

test('sửa file: hỏi 2 câu liên tiếp rồi Đồng ý → file được sửa đúng', async () => {
  await send('FAKE_EDIT:a.txt')
  const code = card('code')
  await expect(code).toBeVisible({ timeout: 20_000 })
  await expect(code).toContainText('a.txt')
  await expect(code).toContainText('phiên bản 1')
  // Đang chờ duyệt: ô chat là ô hỏi về thẻ, không phải ô nhắn tin.
  await expect(box()).toHaveCount(0)

  await askAbout(code, 'Tại sao phải sửa chỗ này?', 1)
  await askAbout(code, 'Sửa vậy có ảnh hưởng gì khác không?', 2)
  await expect(code.getByTestId('approval-answer').nth(0)).toContainText('#1')
  await expect(code.getByTestId('approval-answer').nth(1)).toContainText('#2')
  await expect(code.getByTestId('approval-answer').nth(1)).toContainText('Sửa vậy có ảnh hưởng gì khác không?')
  // Hỏi đáp không tự duyệt: file chưa có.
  expect(existsSync(join(project, 'a.txt'))).toBe(false)

  await code.getByTestId('approval-accept').click()
  await expect(code).toHaveCount(0, { timeout: 1_000 })
  await expect(lastReply()).toContainText('Đã sửa a.txt (phiên bản 1)', { timeout: 20_000 })
  expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('phiên bản 1\n')
  await expect(box()).toBeVisible({ timeout: 20_000 })
})

test('hỏi 3 câu liên tiếp → cả 3 cặp hỏi đáp còn nguyên, thẻ không bị gắn lại, không xê dịch', async () => {
  await send('FAKE_EDIT:e.txt')
  const code = card('code')
  await expect(code).toBeVisible({ timeout: 20_000 })
  // Đánh dấu đúng nút DOM của thẻ + theo dõi mọi lần thẻ bị gỡ khỏi trang.
  await page.evaluate(() => {
    const w = window as unknown as { __removed: number }
    w.__removed = 0
    const el = document.querySelector('[data-testid="approval-card"]') as HTMLElement
    el.dataset.probe = 'goc'
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of Array.from(m.removedNodes))
          if (n instanceof HTMLElement && (n.matches('[data-testid="approval-card"]') || n.querySelector('[data-testid="approval-card"]')))
            w.__removed++
    }).observe(document.body, { childList: true, subtree: true })
  })
  const header = code.locator('.font-medium').first()
  const top = async (): Promise<number> => Math.round((await header.boundingBox())!.y)
  const startTop = await top()

  const questions = ['Tại sao phải sửa?', 'Có ảnh hưởng gì khác không?', 'Có cách nào khác không?']
  for (let i = 0; i < questions.length; i++) {
    await askOnCard(code, questions[i], i + 1)
    // Thẻ đứng yên: đầu thẻ không nhảy sau mỗi câu hỏi / trả lời.
    expect(await top()).toBe(startTop)
  }
  await expect(code.getByTestId('approval-question')).toHaveText(questions)
  const answers = code.getByTestId('approval-answer')
  await expect(answers).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    await expect(answers.nth(i)).toContainText(`#${i + 1}`)
    await expect(answers.nth(i)).toContainText(questions[i])
  }
  expect(await code.getAttribute('data-probe')).toBe('goc')
  expect(await page.evaluate(() => (window as unknown as { __removed: number }).__removed)).toBe(0)

  // Ảnh thẻ có 3 câu hỏi đáp (sáng / tối) trong test-results/.
  // Chỉ để chụp trọn thẻ: cửa sổ cao hơn + cuộn tới câu trả lời cuối (thanh dưới không che).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 1150))
  await answers.nth(2).scrollIntoViewIfNeeded()
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await code.screenshot({ path: `test-results/approval-card-3qa-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
  expect(await page.evaluate(() => (window as unknown as { __removed: number }).__removed)).toBe(0)

  await code.getByTestId('approval-reject').click()
  await expect(code).toHaveCount(0, { timeout: 1_000 })
  await expect(box()).toBeVisible({ timeout: 20_000 })
})

test('"Yêu cầu sửa" → thẻ mới thay thẻ cũ, ghi Bản 2, Bản 3; Đồng ý ghi đúng bản cuối', async () => {
  await send('FAKE_EDIT:b.txt')
  const code = card('code')
  await expect(code).toContainText('phiên bản 1', { timeout: 20_000 })
  await expect(code.getByTestId('approval-version')).toHaveCount(0)
  await revise(code, 'ghi rõ là bản sửa theo yêu cầu')

  // Thẻ cũ đóng, thẻ mới (Bản 2) có nội dung theo yêu cầu.
  await expect(code.getByTestId('approval-version')).toHaveText('Bản 2', { timeout: 10_000 })
  await expect(code).toHaveCount(1)
  await expect(code).toContainText('phiên bản 2: ghi rõ là bản sửa theo yêu cầu')
  await expect(code.getByTestId('approval-revision-note')).toContainText('ghi rõ là bản sửa theo yêu cầu')
  await expect(code.getByTestId('approval-revision-note')).not.toContainText('chối')
  await askOnCard(code, 'Bản này khác bản trước chỗ nào?', 1)
  // Ô chat bên dưới vẫn hỏi được.
  await askBox().fill('Có cần sửa file khác không?')
  await askBox().press('Enter')
  await expect(code.getByTestId('approval-answer').nth(1)).toHaveAttribute('data-status', 'done', { timeout: 10_000 })

  await revise(code, 'thêm dòng cuối')
  await expect(code.getByTestId('approval-version')).toHaveText('Bản 3', { timeout: 10_000 })
  await expect(code).toContainText('phiên bản 3: thêm dòng cuối')
  expect(existsSync(join(project, 'b.txt'))).toBe(false)
  await code.getByTestId('approval-accept').click()
  await expect(lastReply()).toContainText('Đã sửa b.txt (phiên bản 3)', { timeout: 20_000 })
  expect(readFileSync(join(project, 'b.txt'), 'utf8')).toBe('phiên bản 3: thêm dòng cuối\n')
})

test('Từ chối thường → không sửa file', async () => {
  await send('FAKE_EDIT:c.txt')
  const code = card('code')
  await expect(code).toBeVisible({ timeout: 20_000 })
  await code.getByTestId('approval-reject').click()
  await expect(code).toHaveCount(0, { timeout: 1_000 })
  await expect(lastReply()).toContainText('Không sửa c.txt', { timeout: 20_000 })
  expect(existsSync(join(project, 'c.txt'))).toBe(false)
})

test('đang ở trang khác → thanh nhắc chờ duyệt, bấm Xem về đúng thẻ; mở lại trang vẫn còn thẻ', async () => {
  await send('FAKE_EDIT:d.txt')
  await expect(card('code')).toBeVisible({ timeout: 20_000 })
  await goTo(page, '#/claude', page.getByTestId('cli-status'))
  const banner = page.getByTestId('approval-banner')
  await expect(banner).toBeVisible({ timeout: 1_000 })
  await expect(banner).toContainText('(1)')
  await page.getByTestId('approval-banner-open').click()
  await expect(card('code')).toBeVisible({ timeout: 1_000 })
  await expect(banner).toHaveCount(0)

  // Tải lại giao diện (renderer) → thẻ lấy lại từ main, không mất.
  await page.reload()
  await waitForStartup(page)
  await expect(banner).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('approval-banner-open').click()
  await expect(card('code')).toContainText('d.txt', { timeout: 5_000 })
  await card('code').getByTestId('approval-reject').click()
  await expect(card('code')).toHaveCount(0, { timeout: 1_000 })
})
