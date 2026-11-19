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

test('hỏi 3 câu → đủ 3 cặp, thứ tự như khung chat, ô nhập tự focus + trong tầm nhìn, hỏi đáp dài thì cuộn riêng', async () => {
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
  /** Vị trí ô nhập so với vùng cuộn của khung chat + khung chat đã cuộn bao nhiêu. */
  const layout = (): Promise<{ scrollTop: number; boxTop: number; boxBottom: number; viewTop: number; viewBottom: number }> =>
    page.evaluate(() => {
      const box = document.querySelector('[data-testid="approval-input-box"]')!
      const sc = box.closest('.overflow-y-auto') as HTMLElement
      const b = box.getBoundingClientRect()
      const v = sc.getBoundingClientRect()
      return { scrollTop: sc.scrollTop, boxTop: b.top, boxBottom: b.bottom, viewTop: v.top, viewBottom: v.bottom }
    })

  const questions = ['Tại sao phải sửa?', 'Có ảnh hưởng gì khác không?', 'Có cách nào khác không?']
  for (let i = 0; i < questions.length; i++) {
    const before = await layout()
    await askOnCard(code, questions[i], i + 1)
    // Trả lời xong: ô nhập được focus và nằm trọn trong tầm nhìn.
    await expect(code.getByTestId('approval-input')).toBeFocused()
    const after = await layout()
    expect(after.boxTop).toBeGreaterThanOrEqual(after.viewTop - 1)
    expect(after.boxBottom).toBeLessThanOrEqual(after.viewBottom + 1)
    // Cuộn VỪA ĐỦ: nếu khung chat có cuộn thì ô nhập vừa chạm mép dưới (không kéo thẻ lên đầu).
    if (after.scrollTop !== before.scrollTop) expect(after.viewBottom - after.boxBottom).toBeLessThan(8)
  }
  await expect(code.getByTestId('approval-question')).toHaveText(questions)
  const answers = code.getByTestId('approval-answer')
  await expect(answers).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    await expect(answers.nth(i)).toContainText(`#${i + 1}`)
    await expect(answers.nth(i)).toContainText(questions[i])
  }
  // Thứ tự như khung chat: diff → hỏi đáp → ô nhập → Hỏi / Yêu cầu sửa → Từ chối / Đồng ý.
  const y = async (testId: string): Promise<number> => (await code.getByTestId(testId).first().boundingBox())!.y
  const order = [await y('approval-diff'), await y('approval-qa'), await y('approval-input'), await y('approval-ask-send'), await y('approval-accept')]
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  expect(await code.getAttribute('data-probe')).toBe('goc')
  expect(await page.evaluate(() => (window as unknown as { __removed: number }).__removed)).toBe(0)

  // Ảnh thẻ có 3 câu hỏi đáp (sáng / tối) trong test-results/.
  // Chỉ để chụp trọn thẻ: cửa sổ cao hơn + cuộn tới nút duyệt (thanh dưới không che).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 1150))
  await code.getByTestId('approval-accept').scrollIntoViewIfNeeded()
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await code.screenshot({ path: `test-results/approval-card-3qa-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))

  // Hỏi đáp dài → khung hỏi đáp có chiều cao giới hạn + cuộn riêng, câu mới nhất vẫn thấy, nút duyệt không bị đẩy xa.
  const long = 'Giải thích kỹ giúp mình từng dòng thay đổi này ảnh hưởng thế nào tới phần còn lại của dự án? '.repeat(4).trim()
  await askOnCard(code, long, 4)
  await askOnCard(code, `${long} (lần 2)`, 5)
  const qaBox = await code.getByTestId('approval-qa').evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
    atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }))
  expect(qaBox.client).toBeLessThanOrEqual(320)
  expect(qaBox.scroll).toBeGreaterThan(qaBox.client)
  expect(qaBox.atBottom).toBe(true)
  const qaRect = (await code.getByTestId('approval-qa').boundingBox())!
  const acceptRect = (await code.getByTestId('approval-accept').boundingBox())!
  expect(acceptRect.y - (qaRect.y + qaRect.height)).toBeLessThan(200)
  expect(await page.evaluate(() => (window as unknown as { __removed: number }).__removed)).toBe(0)

  await code.getByTestId('approval-reject').click()
  await expect(code).toHaveCount(0, { timeout: 1_000 })
  await expect(box()).toBeVisible({ timeout: 20_000 })
})

test('trợ lý thấy câu hỏi thực chất là yêu cầu sửa → nút "Gửi câu này như Yêu cầu sửa" (bấm mới gửi)', async () => {
  await send('FAKE_EDIT:s.txt')
  const code = card('code')
  await expect(code).toContainText('phiên bản 1', { timeout: 20_000 })
  // Câu hỏi thường → không có nút.
  await askOnCard(code, 'Tại sao tạo file này?', 1)
  await expect(code.getByTestId('approval-suggest-revise')).toHaveCount(0)
  // Câu thực chất là yêu cầu sửa → có nút, câu trả lời không lộ dấu nội bộ, CHƯA tự gửi.
  await askOnCard(code, 'Đổi nội dung thành lời chào', 2)
  const suggest = code.getByTestId('approval-suggest-revise')
  await expect(suggest).toHaveCount(1)
  await expect(suggest).toHaveText('Gửi câu này như Yêu cầu sửa')
  await expect(code.getByTestId('approval-answer').nth(1)).not.toContainText('[[')
  await page.waitForTimeout(300)
  await expect(code.getByTestId('approval-version')).toHaveCount(0)
  // Bấm → gửi đúng câu đó như Yêu cầu sửa → Bản 2.
  await suggest.click()
  await expect(code.getByTestId('approval-version')).toHaveText('Bản 2', { timeout: 10_000 })
  await expect(code.getByTestId('approval-revision')).toHaveText('Yêu cầu sửa: Đổi nội dung thành lời chào')
  await expect(code.getByTestId('approval-current').getByTestId('approval-diff')).toContainText('phiên bản 2: Đổi nội dung thành lời chào')
  // Bản cũ chỉ để xem: nút gợi ý không còn ở đó.
  await expect(code.getByTestId('approval-past-version').getByTestId('approval-suggest-revise')).toHaveCount(0)
  await code.getByTestId('approval-reject').click()
  await expect(code).toHaveCount(0, { timeout: 1_000 })
  await expect(box()).toBeVisible({ timeout: 20_000 })
})

test('"Yêu cầu sửa" → các bản nằm chung một thẻ: Bản 2 vẫn thấy câu hỏi + yêu cầu của Bản 1', async () => {
  await send('FAKE_EDIT:b.txt')
  const code = card('code')
  await expect(code).toContainText('phiên bản 1', { timeout: 20_000 })
  await expect(code.getByTestId('approval-version')).toHaveCount(0)
  await page.evaluate(() => {
    ;(document.querySelector('[data-testid="approval-card"]') as HTMLElement).dataset.probe = 'goc'
  })

  // Bản 1: hỏi 1 câu rồi Yêu cầu sửa.
  await askOnCard(code, 'Tại sao ghi phiên bản 1?', 1)
  await revise(code, 'ghi rõ là bản sửa theo yêu cầu')

  // Cùng một thẻ (không gắn lại), giờ là Bản 2.
  await expect(code.getByTestId('approval-version')).toHaveText('Bản 2', { timeout: 10_000 })
  await expect(code).toHaveCount(1)
  expect(await code.getAttribute('data-probe')).toBe('goc')
  const past1 = code.locator('[data-testid="approval-past-version"][data-version="1"]')
  await expect(past1.getByTestId('approval-question')).toHaveText(['Tại sao ghi phiên bản 1?'])
  await expect(past1.getByTestId('approval-answer')).toContainText('Giải thích (giả lập) #1')
  await expect(past1.getByTestId('approval-revision')).toHaveText('Yêu cầu sửa: ghi rõ là bản sửa theo yêu cầu')
  await expect(past1.getByTestId('approval-revision')).not.toContainText('chối')
  // Bản cũ: diff thu gọn, bấm "Xem lại" mới hiện; không có nút duyệt / ô nhập.
  await expect(past1.getByTestId('approval-diff')).toHaveCount(0)
  await past1.getByTestId('approval-past-toggle').click()
  await expect(past1.getByTestId('approval-diff')).toContainText('phiên bản 1')
  await expect(past1.getByRole('button', { name: /Đồng ý|Từ chối/ })).toHaveCount(0)
  await expect(past1.getByTestId('approval-input')).toHaveCount(0)
  // Bản mới nhất: diff mở sẵn, chỉ bản này có Đồng ý / Từ chối.
  const current = code.getByTestId('approval-current')
  await expect(current).toHaveAttribute('data-version', '2')
  await expect(current.getByTestId('approval-diff')).toContainText('phiên bản 2: ghi rõ là bản sửa theo yêu cầu')
  await expect(code.getByTestId('approval-accept')).toHaveCount(1)
  await expect(code.getByTestId('approval-reject')).toHaveCount(1)

  // Câu hỏi ở Bản 2 gửi kèm lịch sử Bản 1 cho trợ lý (Claude giả nêu lại số bản trước + yêu cầu).
  await askOnCard(current, 'Bản này khác bản trước chỗ nào?', 1)
  await expect(current.getByTestId('approval-answer')).toContainText('đã thấy 1 bản trước, yêu cầu: "ghi rõ là bản sửa theo yêu cầu"')
  // Đánh số câu tiếp tục cả chuỗi (#2) — giới hạn 10 câu tính chung.
  await expect(current.getByTestId('approval-answer')).toContainText('#2')
  // Ô chat bên dưới vẫn hỏi được (vào bản mới nhất).
  await askBox().fill('Có cần sửa file khác không?')
  await askBox().press('Enter')
  await expect(current.getByTestId('approval-answer').nth(1)).toHaveAttribute('data-status', 'done', { timeout: 10_000 })

  // Ảnh thẻ có 2 bản (sáng / tối) trong test-results/.
  await past1.getByTestId('approval-past-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 1300))
  await code.getByTestId('approval-accept').scrollIntoViewIfNeeded()
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await code.screenshot({ path: `test-results/approval-versions-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))

  // Bản 3: hai bản cũ xếp theo thứ tự; Đồng ý ghi đúng bản cuối.
  await revise(code, 'thêm dòng cuối')
  await expect(code.getByTestId('approval-version')).toHaveText('Bản 3', { timeout: 10_000 })
  await expect(code.getByTestId('approval-past-version')).toHaveCount(2)
  await expect(code.getByTestId('approval-revision')).toHaveText([
    'Yêu cầu sửa: ghi rõ là bản sửa theo yêu cầu',
    'Yêu cầu sửa: thêm dòng cuối'
  ])
  expect(await code.getAttribute('data-probe')).toBe('goc')
  expect(existsSync(join(project, 'b.txt'))).toBe(false)
  await code.getByTestId('approval-accept').click()
  await expect(lastReply()).toContainText('Đã sửa b.txt (phiên bản 3)', { timeout: 20_000 })
  expect(readFileSync(join(project, 'b.txt'), 'utf8')).toBe('phiên bản 3: thêm dòng cuối\n')
})

test('phím trên ô nhập của thẻ: Enter = Hỏi, Shift+Enter xuống dòng, Ctrl+Enter = Yêu cầu sửa; ô trống / đang ghép chữ thì không gửi', async () => {
  await send('FAKE_EDIT:k.txt')
  const code = card('code')
  await expect(code).toContainText('phiên bản 1', { timeout: 20_000 })
  const input = code.getByTestId('approval-input')
  const questions = code.getByTestId('approval-question')
  await expect(code.getByTestId('approval-key-hint')).toHaveText('Enter để hỏi · Ctrl+Enter để yêu cầu sửa · Shift+Enter xuống dòng')

  // Ô trống: Enter không làm gì.
  await input.focus()
  await input.press('Enter')
  await page.waitForTimeout(300)
  await expect(questions).toHaveCount(0)
  await expect(input).toHaveValue('')

  // Shift+Enter xuống dòng, chưa gửi.
  await input.pressSequentially('Dòng một')
  await input.press('Shift+Enter')
  await input.pressSequentially('dòng hai')
  await expect(input).toHaveValue('Dòng một\ndòng hai')
  await expect(questions).toHaveCount(0)

  // Bộ gõ đang ghép chữ (Unikey / EVKey / IME): Enter để chốt chữ, không gửi.
  await input.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(300)
  await expect(questions).toHaveCount(0)

  // Enter = Hỏi: gửi luôn, ô nhập trống lại.
  await input.press('Enter')
  await expect(questions).toHaveText(['Dòng một\ndòng hai'], { timeout: 1_000 })
  await expect(input).toHaveValue('')
  await expect(code.getByTestId('approval-answer')).toHaveAttribute('data-status', 'done', { timeout: 10_000 })

  // Ô chat bên dưới giữ cách cũ: Shift+Enter xuống dòng, Enter gửi.
  await askBox().fill('Câu ở ô chat')
  await askBox().press('Shift+Enter')
  await expect(askBox()).toHaveValue('Câu ở ô chat\n')
  await expect(questions).toHaveCount(1)
  await askBox().press('Enter')
  await expect(questions).toHaveCount(2, { timeout: 1_000 })
  await expect(code.getByTestId('approval-answer').nth(1)).toHaveAttribute('data-status', 'done', { timeout: 10_000 })

  // Ctrl+Enter = Yêu cầu sửa → Bản 2.
  await input.fill('làm bằng phím tắt')
  await input.press('Control+Enter')
  await expect(code.getByTestId('approval-version')).toHaveText('Bản 2', { timeout: 10_000 })
  await expect(code.getByTestId('approval-revision')).toHaveText('Yêu cầu sửa: làm bằng phím tắt')
  await expect(code.getByTestId('approval-current').getByTestId('approval-diff')).toContainText('phiên bản 2: làm bằng phím tắt')

  await code.getByTestId('approval-reject').click()
  await expect(code).toHaveCount(0, { timeout: 1_000 })
  await expect(box()).toBeVisible({ timeout: 20_000 })
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
