import { ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { IntegrationsApi } from '@shared/api/integrations'
import type { GmailStatus, TelegramStatus } from '@shared/connectors'
import type { ScheduleNoticeEvent, ScheduleOpenEvent } from '@shared/schedules'
import { subscribe } from './subscribe'

/** Mảng C — Trải nghiệm & Kết nối ngoài: lịch hẹn, kho plugin, giọng nói, biểu cảm, Gmail, Telegram, nháp. */
export const integrationsApi: IntegrationsApi = {
  schedules: {
    list: () => ipcRenderer.invoke(IPC.schedulesList),
    status: () => ipcRenderer.invoke(IPC.schedulesStatus),
    save: (input) => ipcRenderer.invoke(IPC.schedulesSave, input),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.schedulesSetEnabled, { id, enabled }),
    skipNext: (id, skip) => ipcRenderer.invoke(IPC.schedulesSkipNext, { id, skip }),
    remove: (id) => ipcRenderer.invoke(IPC.schedulesRemove, id),
    runNow: (id) => ipcRenderer.invoke(IPC.schedulesRunNow, id),
    stop: () => ipcRenderer.invoke(IPC.schedulesStop),
    runs: (scheduleId, limit) => ipcRenderer.invoke(IPC.schedulesRuns, { scheduleId, limit }),
    markSeen: (conversationId) => ipcRenderer.invoke(IPC.schedulesMarkSeen, conversationId),
    setFeature: (input) => ipcRenderer.invoke(IPC.schedulesSetFeature, input),
    pauseAll: (paused) => ipcRenderer.invoke(IPC.schedulesPauseAll, paused),
    pickFolder: () => ipcRenderer.invoke(IPC.schedulesPickFolder),
    respondProposal: (decision) => ipcRenderer.invoke(IPC.schedulesRespondProposal, decision),
    deferred: {
      list: (conversationId) => ipcRenderer.invoke(IPC.deferredList, conversationId),
      approveFiles: (id, paths) => ipcRenderer.invoke(IPC.deferredApproveFiles, { id, paths }),
      rejectFiles: (id, paths) => ipcRenderer.invoke(IPC.deferredRejectFiles, { id, paths }),
      approveDraft: (id, body) => ipcRenderer.invoke(IPC.deferredApproveDraft, { id, body }),
      rejectDraft: (id) => ipcRenderer.invoke(IPC.deferredRejectDraft, id),
      ask: (id, question) => ipcRenderer.invoke(IPC.deferredAsk, { id, question }),
      revise: (id, note) => ipcRenderer.invoke(IPC.deferredRevise, { id, note })
    },
    onOpen: (listener) => subscribe<ScheduleOpenEvent>(IPC.schedulesOpen, listener),
    onNotice: (listener) => subscribe<ScheduleNoticeEvent>(IPC.schedulesNotice, listener),
    test: {
      advance: (ms) => ipcRenderer.invoke(IPC.schedulesTestAdvance, ms),
      sleep: (ms) => ipcRenderer.invoke(IPC.schedulesTestResume, ms),
      hotkey: () => ipcRenderer.invoke(IPC.schedulesTestHotkey)
    }
  },
  pluginStore: {
    sources: () => ipcRenderer.invoke(IPC.pluginStoreSources),
    addSource: (input) => ipcRenderer.invoke(IPC.pluginStoreAddSource, input),
    removeSource: (repo) => ipcRenderer.invoke(IPC.pluginStoreRemoveSource, repo),
    catalog: (force) => ipcRenderer.invoke(IPC.pluginStoreCatalog, force),
    preview: (key) => ipcRenderer.invoke(IPC.pluginStorePreview, key),
    cancelPreview: (token) => ipcRenderer.invoke(IPC.pluginStoreCancelPreview, token),
    install: (token, mcp) => ipcRenderer.invoke(IPC.pluginStoreInstall, { token, mcp: mcp ?? [] }),
    uninstall: (key) => ipcRenderer.invoke(IPC.pluginStoreUninstall, key),
    installed: () => ipcRenderer.invoke(IPC.pluginStoreInstalled),
    checkUpdates: () => ipcRenderer.invoke(IPC.pluginStoreCheckUpdates)
  },
  voice: {
    status: () => ipcRenderer.invoke(IPC.voiceStatus),
    setSettings: (value) => ipcRenderer.invoke(IPC.voiceSetSettings, value),
    install: (component) => ipcRenderer.invoke(IPC.voiceInstall, component),
    cancel: () => ipcRenderer.invoke(IPC.voiceCancel),
    removeModel: (component) => ipcRenderer.invoke(IPC.voiceRemoveModel, component),
    transcribe: (wav, durationMs) => ipcRenderer.invoke(IPC.voiceTranscribe, { wav, durationMs }),
    speak: (text) => ipcRenderer.invoke(IPC.voiceSpeak, text),
    setSpeaking: (on) => ipcRenderer.invoke(IPC.voiceSpeaking, on),
    recording: (id) => ipcRenderer.invoke(IPC.voiceRecording, id),
    onPack: (listener) => subscribe(IPC.voicePackEvent, listener),
    onStop: (listener) => subscribe(IPC.voiceStopEvent, () => listener())
  },
  expressive: {
    status: () => ipcRenderer.invoke(IPC.expressiveStatus),
    setSettings: (value) => ipcRenderer.invoke(IPC.expressiveSetSettings, value),
    resetAuto: () => ipcRenderer.invoke(IPC.expressiveResetAuto),
    setGiphyKey: (key) => ipcRenderer.invoke(IPC.expressiveSetGiphyKey, key),
    search: (kind, query, offset = 0) =>
      ipcRenderer.invoke(IPC.expressiveSearch, { kind, query, offset }),
    stickers: () => ipcRenderer.invoke(IPC.expressiveStickers),
    stickerData: (id) => ipcRenderer.invoke(IPC.expressiveStickerData, id),
    openStickersFolder: () => ipcRenderer.invoke(IPC.expressiveOpenStickers),
    favorites: () => ipcRenderer.invoke(IPC.expressiveFavorites),
    toggleFavorite: (ref) => ipcRenderer.invoke(IPC.expressiveToggleFavorite, ref),
    recent: () => ipcRenderer.invoke(IPC.expressiveRecent),
    recordEmoji: (emoji) => ipcRenderer.invoke(IPC.expressiveUseRecent, { emoji }),
    clearRecent: (kind) => ipcRenderer.invoke(IPC.expressiveClearRecent, kind)
  },
  gmail: {
    status: () => ipcRenderer.invoke(IPC.gmailStatus),
    onStatus: (listener) => subscribe<GmailStatus>(IPC.gmailStatusEvent, listener),
    setEnabled: (enabled) => ipcRenderer.invoke(IPC.gmailSetEnabled, enabled),
    setCredentials: (input) => ipcRenderer.invoke(IPC.gmailSetCredentials, input),
    setOptions: (input) => ipcRenderer.invoke(IPC.gmailSetOptions, input),
    updateAccount: (input) => ipcRenderer.invoke(IPC.gmailUpdateAccount, input),
    connect: (accountId) => ipcRenderer.invoke(IPC.gmailConnect, accountId),
    cancelConnect: () => ipcRenderer.invoke(IPC.gmailCancelConnect),
    disconnect: (accountId) => ipcRenderer.invoke(IPC.gmailDisconnect, accountId),
    preview: (accountId) => ipcRenderer.invoke(IPC.gmailPreview, accountId)
  },
  telegram: {
    status: () => ipcRenderer.invoke(IPC.telegramStatus),
    onStatus: (listener) => subscribe<TelegramStatus>(IPC.telegramStatusEvent, listener),
    setEnabled: (enabled) => ipcRenderer.invoke(IPC.telegramSetEnabled, enabled),
    setCredentials: (input) => ipcRenderer.invoke(IPC.telegramSetCredentials, input),
    sendCode: (phone) => ipcRenderer.invoke(IPC.telegramSendCode, phone),
    signIn: (code) => ipcRenderer.invoke(IPC.telegramSignIn, code),
    password: (password) => ipcRenderer.invoke(IPC.telegramPassword, password),
    cancelLogin: () => ipcRenderer.invoke(IPC.telegramCancelLogin),
    logout: () => ipcRenderer.invoke(IPC.telegramLogout),
    chats: (force) => ipcRenderer.invoke(IPC.telegramChats, force),
    setLists: (input) => ipcRenderer.invoke(IPC.telegramSetLists, input)
  },
  drafts: {
    respond: (decision) => ipcRenderer.invoke(IPC.draftRespond, decision)
  }
}
