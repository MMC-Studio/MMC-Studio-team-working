import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, safeStorage } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { Conversation } from '@shared/types'
import { ApprovalHub } from '../approvals/hub'
import { explainPrompt, explainSystemPrompt } from '../approvals/explain'
import { CodeApprovals } from '../code/approvals'
import { AutoEdits } from '../code/autoEdits'
import { ExtraFolders, systemZones } from '../code/extraFolders'
import { FolderAccessRequests } from '../code/folderAccess'
import { McpApprovals } from '../mcpClient/approvals'
import { McpProxy } from '../mcpClient/proxy'
import { McpReviews } from '../mcpClient/reviews'
import { McpServerStore } from '../mcpClient/store'
import { ToolBridge } from '../tools/bridge'
import { AppToolRegistry } from '../tools/registry'
import { resourcePath, type BootEnv, type LateRefs } from './context'
import type { Core } from './core'

/** MCP (store, duyệt, proxy, review), hub thẻ duyệt, tự duyệt sửa file, duyệt sửa file, thư mục phụ, tool của app, xin quyền thư mục. */
export async function createApprovals(env: BootEnv, core: Core, late: LateRefs) {
  const { log, userData, workspaceDir, getWindow } = env
  const { getOwner, conversations, messages, settings, sync, recordAction, accountScope } = core

  // MCP server người dùng thêm (Mizuki dùng như tool) — mỗi lần gọi tool phải được duyệt.
  const mcpStore = new McpServerStore(
    {
      get: () => settings.get('mcpServers', z.array(z.any()), []),
      set: (list) => settings.set('mcpServers', list)
    },
    join(userData, 'secrets'),
    safeStorage
  )
  const mcpApprovals = new McpApprovals({
    store: mcpStore,
    emit: (req) => getWindow()?.webContents.send(IPC.mcpApprovalEvent, req),
    log,
    record: recordAction
  })
  // MCP server HTTP cài từ kho plugin (8b): CLI đi qua proxy cục bộ — header bí mật chỉ tới đúng tên miền đã duyệt,
  // danh sách tool đổi → tự tắt server. Dùng fetch của Node (redirect: 'manual' trả đúng mã 3xx để kiểm tên miền).
  const mcpFetch = (url: string, init: RequestInit): Promise<Response> => fetch(url, init)
  const mcpProxy = new McpProxy({
    target: (id) => mcpStore.proxyTarget(id),
    toolsChanged: (id) => {
      mcpStore.markToolsChanged(id)
      sync.changed('mcpServers')
    },
    fetch: mcpFetch,
    log
  })
  await mcpProxy.start()
  app.on('before-quit', () => mcpProxy.stop())
  const mcpReviews = new McpReviews({ store: mcpStore, fetch: mcpFetch, log })

  // Mọi thẻ chờ duyệt (sửa file, quyền thư mục, nháp) hiện trong khung chat + "Hỏi lại": gọi Claude MỘT lần riêng,
  // cùng model đang chat, KHÔNG tool, không resume session → lượt CLI đang chờ duyệt không bị đụng.
  const approvalHub = new ApprovalHub({
    changed: () => sync.changed('approvals'),
    delta: (d) => getWindow()?.webContents.send(IPC.approvalsDelta, d),
    answer: async (card, question, onText, signal) => {
      const recent = messages
        .recent(card.conversationId, 10)
        .filter((m) => !m.recalledAt)
        .map((m) => ({ role: m.role, content: m.content }))
      let text = ''
      for await (const event of late.getProvider().chat(
        {
          prompt: explainPrompt(card, recent, question),
          systemPrompt: explainSystemPrompt(accountScope.getAssistant().name),
          mode: 'free',
          cwd: workspaceDir,
          ephemeral: true
        },
        signal
      )) {
        if (event.type === 'text') onText((text += event.delta))
        else if (event.type === 'error') return { error: event.message }
      }
      return text.trim() ? {} : { error: 'empty_answer' }
    },
    log
  })
  // Có thẻ mới mà app đang ở cửa sổ khác → nháy biểu tượng để người dùng duyệt.
  const flashForApproval = (): void => {
    const mainWindow = getWindow()
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true)
  }

  // Tự duyệt sửa file trong một phiên (PR C): bản gốc giữ trên đĩa để Hoàn tác, kể cả sau khi tắt app / crash (7 ngày).
  const autoEdits = new AutoEdits({
    dir: join(userData, 'auto-edits'),
    getOwner,
    title: (id) => conversations.get(id)?.title ?? null,
    changed: () => sync.changed('autoEdits'),
    record: recordAction,
    log
  })
  await autoEdits.load()
  app.on('before-quit', () => void autoEdits.endAll('app_closed'))

  // Chế độ Code: mỗi lần Claude muốn sửa file, app hiện diff để người dùng duyệt.
  const approvals = new CodeApprovals({
    writableRoot: (id) => {
      const conv = conversations.get(id)
      return conv && conv.codeWrite && conv.cwd ? conv.cwd : null
    },
    extraDirs: (id) => {
      const conv = conversations.get(id)
      return conv?.cwd ? conv.extraDirs : []
    },
    emit: (request) => {
      approvalHub.add({ id: request.id, conversationId: request.conversationId, kind: 'code', request }, () => approvals.touch(request.id))
      flashForApproval()
    },
    closed: (id) => approvalHub.remove(id),
    mcpApproval: (conversationId, toolName, input) =>
      mcpApprovals.request(conversationId, toolName, input),
    log,
    record: recordAction,
    autoEdits
  })
  await approvals.start()
  app.on('before-quit', () => approvals.stop())

  // Thư mục phụ (D): tối đa 3, người dùng tự chọn; chặn vùng hệ thống + mọi thư mục cha của chúng, chặn chồng lấn.
  const extraFolders = new ExtraFolders<Conversation>({
    getConversation: (id) => conversations.get(id),
    addExtraDir: (id, path) => conversations.addExtraDir(id, path),
    removeExtraDir: (id, path) => conversations.removeExtraDir(id, path),
    setExtraWrite: (id, path, write) => conversations.setExtraWrite(id, path, write),
    zones: systemZones(process.env, [userData]),
    // Tạo ở phần sau (boot/ipc.ts, boot/chat.ts) — chỉ gọi khi người dùng thao tác, lúc đó đã có.
    cancelConversation: (id) => late.cancelConversationAccess(id),
    cancelEdits: (id) => approvals.cancelConversation(id),
    abortTurn: (id) => late.chat.abortConversation(id),
    log
  })
  const permissionScript = resourcePath('permission-mcp.cjs', 'resources/permission-mcp.cjs')

  // Tool của app cho Claude (MCP `mmc`): hiện có chụp màn hình (điều khiển máy tính — chỉ xem).
  const tools = new AppToolRegistry()
  const toolBridge = new ToolBridge(tools)
  await toolBridge.start()
  app.on('before-quit', () => toolBridge.stop())
  const appToolsScript = resourcePath('app-tools-mcp.cjs', 'resources/app-tools-mcp.cjs')

  // Trợ lý tự xin quyền thư mục (mọi chế độ): người dùng tự chọn thư mục trong hộp thoại mới có quyền.
  const folderAccess = new FolderAccessRequests({
    getConversation: (id) => conversations.get(id),
    pickFolder: async (suggested) => {
      // Hộp chọn thư mục giả chỉ cho e2e ở bản chưa đóng gói — không bao giờ có trong bản phát hành.
      const fake = app.isPackaged ? undefined : process.env.MMC_FAKE_FOLDER
      if (fake !== undefined) return fake || null
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory'],
        ...(suggested && existsSync(suggested) ? { defaultPath: suggested } : {})
      }
      const mainWindow = getWindow()
      const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      return picked.canceled ? null : (picked.filePaths[0] ?? null)
    },
    grantExtra: (id, path) => extraFolders.add(id, path),
    grant: async (id, path, write) => {
      await extraFolders.checkMainChange(id, path)
      approvals.cancelConversation(id)
      void autoEdits.end(id, 'folder')
      const conv = conversations.setCwd(id, path)
      return conv && write ? conversations.setCodeWrite(id, true) : conv
    },
    emit: (event) => {
      if ('closed' in event) return approvalHub.remove(event.id)
      approvalHub.add({ id: event.id, conversationId: event.conversationId, kind: 'folder', request: event }, () => folderAccess.touch(event.id))
      flashForApproval()
    },
    log
  })
  folderAccess.registerTools(tools)
  app.on('before-quit', () => folderAccess.cancelAll())

  return {
    mcpStore,
    mcpApprovals,
    mcpFetch,
    mcpProxy,
    mcpReviews,
    approvalHub,
    flashForApproval,
    autoEdits,
    approvals,
    extraFolders,
    permissionScript,
    tools,
    toolBridge,
    appToolsScript,
    folderAccess
  }
}

export type Approvals = Awaited<ReturnType<typeof createApprovals>>
