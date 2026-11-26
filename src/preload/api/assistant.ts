import { ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AssistantApi } from '@shared/api/assistant'
import type { ComputerStatus } from '@shared/computer'
import type { SidecarState } from '@shared/sidecar'
import type { ApprovalDelta } from '@shared/approvals'
import type { AgentNotice, AgentServerStatus, McpApprovalRequest } from '@shared/agents'
import type { ChatStreamPayload, MemoryEventPayload } from '@shared/types'
import { subscribe } from './subscribe'

/** Mảng A — Trợ lý & Agent: chat, hội thoại, dự án, duyệt, Code, lệnh, agent, MCP, máy tính, artifact, skill, trí nhớ, quyền. */
export const assistantApi: AssistantApi = {
  approvals: {
    list: () => ipcRenderer.invoke(IPC.approvalsList),
    ask: (id, question) => ipcRenderer.invoke(IPC.approvalsAsk, { id, question }),
    onDelta: (listener) => subscribe<ApprovalDelta>(IPC.approvalsDelta, listener)
  },
  cli: {
    check: () => ipcRenderer.invoke(IPC.cliCheck)
  },
  conversations: {
    list: (query) => ipcRenderer.invoke(IPC.conversationsList, { query }),
    create: (mode, projectId) => ipcRenderer.invoke(IPC.conversationsCreate, { mode, projectId }),
    update: (input) => ipcRenderer.invoke(IPC.conversationsUpdate, input),
    remove: (id) => ipcRenderer.invoke(IPC.conversationsRemove, id),
    fork: (messageId) => ipcRenderer.invoke(IPC.conversationsFork, messageId),
    answerSuggestion: (id, accept) =>
      ipcRenderer.invoke(IPC.conversationsAnswerSuggestion, { id, accept })
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    get: (id) => ipcRenderer.invoke(IPC.projectsGet, id),
    create: (input) => ipcRenderer.invoke(IPC.projectsCreate, input),
    update: (input) => ipcRenderer.invoke(IPC.projectsUpdate, input),
    deleteInfo: (id) => ipcRenderer.invoke(IPC.projectsDeleteInfo, id),
    remove: (id) => ipcRenderer.invoke(IPC.projectsRemove, id),
    addFiles: (id) => ipcRenderer.invoke(IPC.projectsAddFiles, id),
    removeFile: (fileId) => ipcRenderer.invoke(IPC.projectsRemoveFile, fileId)
  },
  actionLog: {
    list: (query) => ipcRenderer.invoke(IPC.actionLogList, query)
  },
  privacy: {
    status: () => ipcRenderer.invoke(IPC.privacyStatus),
    revokeFolder: (conversationId) =>
      ipcRenderer.invoke(IPC.privacyRevokeFolder, { conversationId }),
    revokeExtraFolder: (conversationId, path) =>
      ipcRenderer.invoke(IPC.privacyRevokeExtraFolder, { conversationId, path }),
    revokeScheduleGrant: (scheduleId, key) =>
      ipcRenderer.invoke(IPC.privacyRevokeScheduleGrant, { scheduleId, key })
  },
  commands: {
    status: () => ipcRenderer.invoke(IPC.commandsStatus),
    setSettings: (settings) => ipcRenderer.invoke(IPC.commandsSetSettings, settings),
    respond: (decision) => ipcRenderer.invoke(IPC.commandsRespond, decision),
    setApp: (program, enabled) => ipcRenderer.invoke(IPC.commandsSetApp, { program, enabled }),
    chooseApp: (program) => ipcRenderer.invoke(IPC.commandsChooseApp, { program }),
    runs: (conversationId) => ipcRenderer.invoke(IPC.commandsRuns, { conversationId }),
    stopRun: (id) => ipcRenderer.invoke(IPC.commandsStopRun, { id }),
    dismissRun: (id) => ipcRenderer.invoke(IPC.commandsDismissRun, { id }),
    openRunLog: (id) => ipcRenderer.invoke(IPC.commandsOpenRunLog, { id })
  },
  conversationGroups: {
    list: () => ipcRenderer.invoke(IPC.conversationGroupsList),
    create: (name) => ipcRenderer.invoke(IPC.conversationGroupsCreate, name),
    update: (input) => ipcRenderer.invoke(IPC.conversationGroupsUpdate, input),
    remove: (id) => ipcRenderer.invoke(IPC.conversationGroupsRemove, id)
  },
  messages: {
    list: (conversationId) => ipcRenderer.invoke(IPC.messagesList, conversationId)
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC.skillsList),
    get: (source, name) => ipcRenderer.invoke(IPC.skillsGet, { source, name }),
    pick: (kind) => ipcRenderer.invoke(IPC.skillsPick, kind),
    install: (token) => ipcRenderer.invoke(IPC.skillsInstall, token),
    cancelPreview: (token) => ipcRenderer.invoke(IPC.skillsCancelPreview, token),
    remove: (name) => ipcRenderer.invoke(IPC.skillsRemove, name),
    setEnabled: (name, enabled) => ipcRenderer.invoke(IPC.skillsSetEnabled, { name, enabled }),
    openFolder: () => ipcRenderer.invoke(IPC.skillsOpenFolder),
    styleNotes: () => ipcRenderer.invoke(IPC.skillsStyleNotes),
    setStyleNotes: (notes) => ipcRenderer.invoke(IPC.skillsSetStyleNotes, notes),
    learnStyle: () => ipcRenderer.invoke(IPC.skillsLearnStyle)
  },
  artifacts: {
    list: (conversationId) => ipcRenderer.invoke(IPC.artifactsList, conversationId),
    listAll: () => ipcRenderer.invoke(IPC.artifactsListAll),
    versions: (id) => ipcRenderer.invoke(IPC.artifactsVersions, id),
    content: (id, version) => ipcRenderer.invoke(IPC.artifactsContent, { id, version }),
    saveVersion: (id, content) => ipcRenderer.invoke(IPC.artifactsSave, { id, content }),
    restore: (id, version) => ipcRenderer.invoke(IPC.artifactsRestore, { id, version }),
    export: (id, version, format) =>
      ipcRenderer.invoke(IPC.artifactsExport, { artifactId: id, version, format }),
    templates: () => ipcRenderer.invoke(IPC.artifactsTemplates)
  },
  chat: {
    send: (conversationId, text, attachmentIds = [], replyToId) =>
      ipcRenderer.invoke(IPC.chatSend, { conversationId, text, attachmentIds, replyToId }),
    abort: (requestId) => ipcRenderer.invoke(IPC.chatAbort, { requestId }),
    onEvent: (listener) => subscribe<ChatStreamPayload>(IPC.chatEvent, listener),
    pickAttachments: () => ipcRenderer.invoke(IPC.chatPickAttachments),
    addFile: (name, data) => ipcRenderer.invoke(IPC.chatAddFile, { name, data }),
    pasteClipboard: () => ipcRenderer.invoke(IPC.chatPasteClipboard),
    attachmentPreview: (id, size) => ipcRenderer.invoke(IPC.chatAttachmentPreview, { id, size }),
    sendMedia: (conversationId, text, media) =>
      ipcRenderer.invoke(IPC.chatSend, { conversationId, text, media }),
    sendVoice: (conversationId, text, voice) =>
      ipcRenderer.invoke(IPC.chatSend, { conversationId, text, voice }),
    react: (messageId, emoji) => ipcRenderer.invoke(IPC.chatReact, { messageId, emoji }),
    pin: (messageId, pinned) => ipcRenderer.invoke(IPC.chatPin, { messageId, pinned }),
    recall: (messageId) => ipcRenderer.invoke(IPC.chatRecall, messageId),
    editResend: (messageId, text) => ipcRenderer.invoke(IPC.chatEditResend, { messageId, text })
  },
  memory: {
    getProfile: () => ipcRenderer.invoke(IPC.memoryGetProfile),
    setProfile: (profile) => ipcRenderer.invoke(IPC.memorySetProfile, profile),
    list: (filter) => ipcRenderer.invoke(IPC.memoryList, filter),
    create: (content, category, projectId) =>
      ipcRenderer.invoke(IPC.memoryCreate, { content, category, projectId }),
    update: (id, content, category) =>
      ipcRenderer.invoke(IPC.memoryUpdate, { id, content, category }),
    remove: (id) => ipcRenderer.invoke(IPC.memoryRemove, id),
    suggestions: () => ipcRenderer.invoke(IPC.memorySuggestions),
    resolve: (input) => ipcRenderer.invoke(IPC.memoryResolve, input),
    resolveMany: (items) => ipcRenderer.invoke(IPC.memoryResolveMany, items),
    extract: (conversationId) => ipcRenderer.invoke(IPC.memoryExtract, conversationId),
    conversationLeft: (conversationId) =>
      ipcRenderer.invoke(IPC.memoryConversationLeft, conversationId),
    export: () => ipcRenderer.invoke(IPC.memoryExport),
    onEvent: (listener) => subscribe<MemoryEventPayload>(IPC.memoryEvent, listener)
  },
  computer: {
    status: () => ipcRenderer.invoke(IPC.computerStatus),
    onStatus: (listener) => subscribe<ComputerStatus>(IPC.computerStatusEvent, listener),
    setEnabled: (enabled, acceptWarning) =>
      ipcRenderer.invoke(IPC.computerSetEnabled, { enabled, acceptWarning }),
    setScreenAccess: (on) => ipcRenderer.invoke(IPC.computerSetScreenAccess, on),
    emergencyStop: () => ipcRenderer.invoke(IPC.computerEmergencyStop),
    preview: (display) => ipcRenderer.invoke(IPC.computerPreview, { display }),
    openLogs: () => ipcRenderer.invoke(IPC.computerOpenLogs)
  },
  agents: {
    status: () => ipcRenderer.invoke(IPC.agentsStatus),
    onStatus: (listener) => subscribe<AgentServerStatus>(IPC.agentsStatusEvent, listener),
    onNotice: (listener) => subscribe<AgentNotice>(IPC.agentsNoticeEvent, listener),
    setEnabled: (on) => ipcRenderer.invoke(IPC.agentsSetEnabled, on),
    setLimits: (limits) => ipcRenderer.invoke(IPC.agentsSetLimits, limits),
    createClient: (name) => ipcRenderer.invoke(IPC.agentsCreateClient, name),
    revoke: (id) => ipcRenderer.invoke(IPC.agentsRevoke, id),
    respondPairing: (clientId, allow) =>
      ipcRenderer.invoke(IPC.agentsRespondPairing, { clientId, allow }),
    stopAll: () => ipcRenderer.invoke(IPC.agentsStopAll),
    exchanges: () => ipcRenderer.invoke(IPC.agentsExchanges)
  },
  mcp: {
    list: () => ipcRenderer.invoke(IPC.mcpList),
    save: (input) => ipcRenderer.invoke(IPC.mcpSave, input),
    remove: (id) => ipcRenderer.invoke(IPC.mcpRemove, id),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.mcpSetEnabled, { id, enabled }),
    revokeAlways: (id, tool) => ipcRenderer.invoke(IPC.mcpRevokeAlways, { id, tool }),
    onApproval: (listener) => subscribe<McpApprovalRequest>(IPC.mcpApprovalEvent, listener),
    respond: (id, decision) => ipcRenderer.invoke(IPC.mcpRespond, { id, decision }),
    review: (id) => ipcRenderer.invoke(IPC.mcpReview, id),
    approveReview: (token) => ipcRenderer.invoke(IPC.mcpApproveReview, token),
    setStoreHeaders: (id, headers) => ipcRenderer.invoke(IPC.mcpSetStoreHeaders, { id, headers })
  },
  sidecar: {
    state: () => ipcRenderer.invoke(IPC.sidecarState),
    onState: (listener) => subscribe<SidecarState>(IPC.sidecarStateEvent, listener),
    install: () => ipcRenderer.invoke(IPC.sidecarInstall),
    cancel: () => ipcRenderer.invoke(IPC.sidecarCancel),
    uninstall: () => ipcRenderer.invoke(IPC.sidecarUninstall),
    check: () => ipcRenderer.invoke(IPC.sidecarCheck)
  },
  code: {
    chooseFolder: (conversationId) => ipcRenderer.invoke(IPC.codeChooseFolder, conversationId),
    setWrite: (conversationId, enabled) =>
      ipcRenderer.invoke(IPC.codeSetWrite, { conversationId, enabled }),
    respond: (id, allow, feedback) => ipcRenderer.invoke(IPC.codeRespond, { id, allow, feedback }),
    clearFolder: (conversationId) => ipcRenderer.invoke(IPC.codeClearFolder, conversationId),
    addExtraFolder: (conversationId) => ipcRenderer.invoke(IPC.codeAddExtraFolder, conversationId),
    removeExtraFolder: (conversationId, path) =>
      ipcRenderer.invoke(IPC.codeRemoveExtraFolder, { conversationId, path }),
    setExtraWrite: (conversationId, path, enabled) =>
      ipcRenderer.invoke(IPC.codeSetExtraWrite, { conversationId, path, enabled }),
    respondFolderAccess: (id, grant, write, feedback) =>
      ipcRenderer.invoke(IPC.folderAccessRespond, { id, grant, write, feedback }),
    respondAuto: (id) => ipcRenderer.invoke(IPC.codeRespondAuto, { id })
  },
  autoEdits: {
    list: (conversationId) =>
      ipcRenderer.invoke(IPC.autoEditsList, { conversationId: conversationId ?? null }),
    stop: (sessionId) => ipcRenderer.invoke(IPC.autoEditsStop, { sessionId }),
    undo: (input) => ipcRenderer.invoke(IPC.autoEditsUndo, input),
    dismiss: (sessionId) => ipcRenderer.invoke(IPC.autoEditsDismiss, { sessionId })
  }
}
