import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, waitForStartup } from './helpers'

// Chạy Unity / Blender (A2) — chạy được khi KHÔNG có Claude CLI và KHÔNG có Unity / Blender: MMC_FAKE_CHAT
// ("FAKE_TOOL:run_unity {json}" gọi tool như CLI thật), MMC_FAKE_FOLDER (hộp chọn thư mục giả), MMC_FAKE_UNITY_EXE /
// MMC_FAKE_BLENDER_EXE (hộp chọn file giả), MMC_FAKE_APP_RUNNER (tiến trình giả thay Unity.exe / blender.exe — thẻ vẫn hiện
// đường dẫn thật đã chọn).
test.describe.configure({ mode: 'serial' })

const ROOT = join(__dirname, '..', '..')
const UNITY_VERSION = '2022.3.62f3'
let app: ElectronApplication
let page: Page
let userData: string
let project: string

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mmc-app-runs-e2e-'))
  project = join(userData, 'UnityGame')
  mkdirSync(join(project, 'ProjectSettings'), { recursive: true })
  mkdirSync(join(project, 'Assets', 'Editor'), { recursive: true })
  writeFileSync(join(project, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${UNITY_VERSION}\n`)
  writeFileSync(join(project, 'export.py'), 'import bpy\nprint("xuất FBX")\n')
  writeFileSync(join(project, 'big.py'), `# ${'x'.repeat(70 * 1024)}\n`)
  // Unity.exe "cài bằng Hub" (file rỗng — phiên bản đọc theo thư mục), blender.exe rỗng.
  const unityDir = join(userData, 'Hub', 'Editor', UNITY_VERSION, 'Editor')
  mkdirSync(unityDir, { recursive: true })
  writeFileSync(join(unityDir, 'Unity.exe'), '')
  mkdirSync(join(userData, 'Blender'))
  writeFileSync(join(userData, 'Blender', 'blender.exe'), '')
  app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      TEAM_WORKING_USER_DATA: userData,
      MMC_FAKE_CHAT: '1',
      MMC_FAKE_FOLDER: project,
      MMC_FAKE_UNITY_EXE: join(unityDir, 'Unity.exe'),
      MMC_FAKE_BLENDER_EXE: join(userData, 'Blender', 'blender.exe'),
      MMC_FAKE_APP_RUNNER: join(ROOT, 'tests', 'e2e', 'fixtures', 'fake-app.cjs')
    }
  })
  page = await app.firstWindow()
  await waitForStartup(page)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

const box = (): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: /Nhắn cho/ })
const send = async (text: string): Promise<void> => {
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}
const tool = (name: string, input: object): string => `FAKE_TOOL:${name} ${JSON.stringify({ reason: 'Build thử', ...input })}`
const lastReply = (): ReturnType<Page['getByTestId']> => page.getByTestId('message-assistant').last()
/** Lượt trả lời đã xong (nút Gửi hiện lại) và có tin trợ lý mới — rồi mới kiểm "không có". */
const sendAndSettle = async (text: string): Promise<void> => {
  const before = await page.getByTestId('message-assistant').count()
  await send(text)
  await expect(page.getByTestId('message-assistant')).toHaveCount(before + 1, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  await expect(lastReply()).toContainText('giả lập', { timeout: 20_000 })
}
const card = (): ReturnType<Page['getByTestId']> => page.getByTestId('command-approval')
const openCapabilities = async (): Promise<void> => {
  await page.evaluate(() => (window.location.hash = '#/?settings=capabilities'))
  await expect(page.getByTestId('commands-unity-switch')).toBeVisible({ timeout: 5_000 })
}

test('mặc định tắt: chưa chọn chương trình thì không bật được, không có tool', async () => {
  await goTo(page, '#/', box())
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Build game', write: false })}`)
  await page.getByTestId('folder-access-choose').click({ timeout: 20_000 })
  await expect(page.getByTestId('code-bar')).toContainText('UnityGame', { timeout: 1_000 })
  await expect(page.getByTestId('message-user').last()).toContainText('đã cấp quyền thư mục', { timeout: 20_000 })
  await sendAndSettle(tool('run_unity', { method: 'BuildTools.Build' }))
  await expect(lastReply()).not.toContainText('KẾT QUẢ TOOL')
  await expect(card()).toHaveCount(0)

  await openCapabilities()
  await expect(page.getByTestId('commands-unity-switch')).not.toBeChecked()
  await expect(page.getByTestId('commands-unity-switch')).toBeDisabled()
  await expect(page.getByTestId('commands-unity-status')).toContainText('Chưa chọn Unity.exe')
})

test('chọn Unity.exe / blender.exe → hiện đường dẫn + phiên bản, bật được; công tắc đổi trong 1 giây', async () => {
  await page.getByTestId('commands-unity-choose').click()
  await expect(page.getByTestId('commands-unity-status')).toContainText(`(phiên bản ${UNITY_VERSION})`, { timeout: 5_000 })
  const unity = page.getByTestId('commands-unity-switch')
  await expect(unity).toBeEnabled()
  await unity.check()
  await expect(unity).toBeChecked({ timeout: 1_000 })
  await page.getByTestId('commands-blender-choose').click()
  await expect(page.getByTestId('commands-blender-status')).toContainText('blender.exe', { timeout: 5_000 })
  await page.getByTestId('commands-blender-switch').check()
  await expect(page.getByTestId('commands-blender-switch')).toBeChecked({ timeout: 1_000 })
  // Blender chưa được test với Blender thật → nhãn "Thử nghiệm"; Unity thì không.
  await expect(page.getByTestId('commands-blender-experimental')).toHaveText('Thử nghiệm')
  await expect(page.locator('[data-setting-id="commandsUnity"]')).not.toContainText('Thử nghiệm')
  await page.getByTestId('commands-unity-status').screenshot({ path: 'test-results/app-runs-settings.png' })
  await page.locator('[data-setting-id="commandsBlender"]').screenshot({ path: 'test-results/app-runs-settings-blender.png' })
  await page.keyboard.press('Escape')
})

test('thư mục CHỈ ĐỌC → không có tool chạy Unity / Blender', async () => {
  await sendAndSettle(tool('run_unity', { method: 'BuildTools.Build' }))
  await expect(lastReply()).not.toContainText('KẾT QUẢ TOOL')
  await expect(card()).toHaveCount(0)
})

test('trợ lý xin quyền sửa: ô "Cho phép sửa file" KHÔNG tick sẵn, ghi rõ quyền sửa mở cả chạy Unity / Blender', async () => {
  await send(`FAKE_TOOL:request_folder_access ${JSON.stringify({ reason: 'Cần sửa script build', write: true })}`)
  const folder = page.getByTestId('folder-access')
  await expect(folder).toBeVisible({ timeout: 20_000 })
  await expect(folder.getByTestId('folder-access-write')).not.toBeChecked()
  await expect(folder.getByTestId('folder-access-write-runs')).toHaveText('Quyền sửa cũng cho phép trợ lý xin chạy Unity / Blender.')
  await folder.screenshot({ path: 'test-results/app-runs-folder-card.png' })
  // Không cấp — thư mục vẫn chỉ đọc (bước sau tự bật quyền sửa trên thanh thư mục).
  await folder.getByTestId('approval-reject').click()
  await expect(folder).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByRole('button', { name: 'Gửi' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('code-bar').getByRole('checkbox')).not.toBeChecked()
})

test('bật quyền sửa + trợ lý sửa file C# → thẻ: cảnh báo to, lệnh, phiên bản, file C# vừa sửa; Chạy → log về trợ lý', async () => {
  await page.getByTestId('code-bar').getByRole('checkbox').click()
  await page.getByRole('button', { name: 'Cho phép' }).click()
  await expect(page.getByTestId('code-bar').getByRole('checkbox')).toBeChecked({ timeout: 1_000 })
  await send('FAKE_EDIT:Assets/Editor/BuildTools.cs')
  await page.getByTestId('approval-accept').click({ timeout: 20_000 })
  await expect(lastReply()).toContainText('Đã sửa Assets/Editor/BuildTools.cs', { timeout: 20_000 })

  await send(tool('run_unity', { method: 'BuildTools.Build' }))
  await expect(card()).toBeVisible({ timeout: 20_000 })
  await expect(card()).toContainText('Chạy Unity')
  await expect(page.getByTestId('command-danger')).toContainText('Chạy code tuỳ ý — app không giới hạn được')
  await expect(page.getByTestId('command-display')).toHaveText('Unity -batchmode -quit -executeMethod BuildTools.Build')
  await expect(page.getByTestId('command-cwd')).toHaveText(project)
  await expect(page.getByTestId('command-version')).toContainText(UNITY_VERSION)
  await expect(page.getByTestId('command-edited')).toContainText('Assets/Editor/BuildTools.cs')
  await expect(page.getByTestId('command-log-path')).toContainText(join(userData, 'logs', 'runs'))
  await page.getByTestId('command-full-toggle').click()
  await expect(page.getByTestId('command-full')).toContainText('-projectPath')
  await screenshot('app-run-unity-card')

  await page.getByTestId('approval-accept').click()
  await expect(card()).toHaveCount(0, { timeout: 1_000 })
  await expect(lastReply()).toContainText('KẾT QUẢ TOOL: $ Unity -batchmode -quit -executeMethod BuildTools.Build', { timeout: 20_000 })
  await expect(lastReply()).toContainText('Executed BuildTools.Build: Build OK')
  const run = page.getByTestId('app-run').first()
  await expect(run).toHaveAttribute('data-state', 'done', { timeout: 1_000 })
  await expect(run.getByTestId('app-run-status')).toHaveText('Xong')
})

test('đang chạy: đồng hồ + Dừng → dừng trong 1 giây, trợ lý được báo', async () => {
  await send(tool('run_unity', { method: 'BuildTools.Sleep' }))
  await page.getByTestId('approval-accept').click({ timeout: 20_000 })
  const run = page.locator('[data-testid="app-run"][data-state="running"]')
  await expect(run).toBeVisible({ timeout: 5_000 })
  await expect(run.getByTestId('app-run-status')).toContainText(/Đang chạy · 00:0\d/)
  await run.screenshot({ path: 'test-results/app-run-running.png' })
  await run.getByTestId('app-run-stop').click()
  const stopped = page.getByTestId('app-run').first()
  await expect(stopped).toHaveAttribute('data-state', 'stopped', { timeout: 1_000 })
  await expect(lastReply()).toContainText('NGƯỜI DÙNG ĐÃ DỪNG Unity', { timeout: 20_000 })
  // Ẩn lần chạy đã xong.
  await stopped.getByTestId('app-run-dismiss').click()
  await expect(page.getByTestId('app-run')).toHaveCount(1, { timeout: 1_000 })
})

test('phiên bản dự án khác Unity.exe đã chọn → chặn ngay, không hiện thẻ', async () => {
  writeFileSync(join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.6.0f1\n')
  await send(tool('run_unity', { method: 'BuildTools.Build' }))
  await expect(lastReply()).toContainText(`LỖI TOOL: Không chạy: Dự án dùng Unity 6000.6.0f1 nhưng Unity.exe đã chọn là ${UNITY_VERSION}`, { timeout: 20_000 })
  await expect(card()).toHaveCount(0)
  writeFileSync(join(project, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${UNITY_VERSION}\n`)
})

test('Blender: thẻ hiện TRỌN script + cảnh báo import; Chạy → output', async () => {
  await send(tool('run_blender', { script: 'export.py', scriptArgs: ['out.fbx'] }))
  await expect(card()).toBeVisible({ timeout: 20_000 })
  await expect(card()).toContainText('Chạy Blender')
  await expect(page.getByTestId('command-display')).toHaveText('blender --background --python export.py -- out.fbx')
  await expect(page.getByTestId('command-script')).toHaveText('import bpy\nprint("xuất FBX")\n')
  await expect(page.getByTestId('command-imports')).toContainText('import các file .py khác')
  await screenshot('app-run-blender-card')
  await page.getByTestId('approval-accept').click()
  await expect(lastReply()).toContainText('Blender script done', { timeout: 20_000 })
  await expect(lastReply()).toContainText('autoexec: off')
})

test('Blender: script > 64 KB → từ chối, không hiện thẻ', async () => {
  await send(tool('run_blender', { script: 'big.py' }))
  await expect(lastReply()).toContainText('LỖI TOOL: Không chạy: Script big.py dài', { timeout: 20_000 })
  await expect(card()).toHaveCount(0)
})

test('nhật ký: Unity / Blender có trong Quyền & riêng tư; trạng thái công tắc', async () => {
  await page.evaluate(() => (window.location.hash = '#/?settings=privacy'))
  await expect(page.getByTestId('grant-unity-status')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('grant-unity-status')).toContainText('Đang bật')
  await expect(page.getByTestId('grant-blender-status')).toContainText('Đang bật')
  const rows = page.getByTestId('action-log-row')
  await expect(rows.filter({ hasText: 'Unity -batchmode -quit -executeMethod BuildTools.Sleep' })).toContainText('Đã dừng')
  await expect(rows.filter({ hasText: 'blender --python big.py' }).first()).toContainText('App chặn')
  await page.keyboard.press('Escape')
})

test('tắt Unity trong Cài đặt → lượt sau không còn tool', async () => {
  await openCapabilities()
  await page.getByTestId('commands-unity-switch').uncheck()
  await expect(page.getByTestId('commands-unity-switch')).not.toBeChecked({ timeout: 1_000 })
  await page.keyboard.press('Escape')
  await sendAndSettle(tool('run_unity', { method: 'BuildTools.Build' }))
  await expect(lastReply()).not.toContainText('KẾT QUẢ TOOL')
  await expect(card()).toHaveCount(0)
})

async function screenshot(name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => document.documentElement.classList.contains('dark'))) !== (theme === 'dark')) {
      await page.getByTestId('theme-toggle').click()
    }
    await card().screenshot({ path: `test-results/${name}-${theme}.png` })
    await page.getByTestId('command-danger').screenshot({ path: `test-results/${name}-danger-${theme}.png` })
  }
  await page.getByTestId('theme-toggle').click()
}
