import { ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { CommonApi } from '@shared/api/common'
import type { UpdateState } from '@shared/update'
import type { SyncTopic } from '@shared/sync'
import { subscribe } from './subscribe'

/** Dùng chung — đồng bộ, app, cập nhật, cài đặt, tài khoản, đăng nhập (chủ dự án giữ). */
export const commonApi: CommonApi = {
  sync: {
    onChanged: (listener) => subscribe<SyncTopic[]>(IPC.syncChanged, listener)
  },
  settings: {
    getAssistant: () => ipcRenderer.invoke(IPC.settingsGetAssistant),
    setAssistant: (profile) => ipcRenderer.invoke(IPC.settingsSetAssistant, profile),
    getAppearance: () => ipcRenderer.invoke(IPC.settingsGetAppearance),
    setAppearance: (appearance) => ipcRenderer.invoke(IPC.settingsSetAppearance, appearance),
    getAi: () => ipcRenderer.invoke(IPC.settingsGetAi),
    setAi: (settings) => ipcRenderer.invoke(IPC.settingsSetAi, settings),
    setApiKey: (key) => ipcRenderer.invoke(IPC.settingsSetApiKey, key),
    clearApiKey: () => ipcRenderer.invoke(IPC.settingsClearApiKey),
    getChatOrganize: () => ipcRenderer.invoke(IPC.settingsGetChatOrganize),
    setChatOrganize: (settings) => ipcRenderer.invoke(IPC.settingsSetChatOrganize, settings)
  },
  update: {
    getState: () => ipcRenderer.invoke(IPC.updateGetState),
    onState: (listener) => subscribe<UpdateState>(IPC.updateState, listener),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    postpone: () => ipcRenderer.invoke(IPC.updatePostpone),
    skip: () => ipcRenderer.invoke(IPC.updateSkip),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    getSettings: () => ipcRenderer.invoke(IPC.settingsGetUpdate),
    setSettings: (settings) => ipcRenderer.invoke(IPC.settingsSetUpdate, settings)
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    onNavigate: (listener) => subscribe<string>(IPC.appNavigate, listener),
    logError: (message) => ipcRenderer.invoke(IPC.appLogError, message),
    bugInfo: () => ipcRenderer.invoke(IPC.appBugInfo)
  },
  auth: {
    oauth: (authorizeUrl) => ipcRenderer.invoke(IPC.authOAuth, authorizeUrl),
    cancel: () => ipcRenderer.invoke(IPC.authCancel)
  },
  account: {
    set: (uid) => ipcRenderer.invoke(IPC.accountSet, uid)
  },
  accounts: {
    list: () => ipcRenderer.invoke(IPC.accountsList),
    record: (account, session) => ipcRenderer.invoke(IPC.accountsRecord, { account, session }),
    remember: (id, remember, session) =>
      ipcRenderer.invoke(IPC.accountsRemember, { id, remember, session }),
    session: (id) => ipcRenderer.invoke(IPC.accountsSession, id),
    dropSession: (id) => ipcRenderer.invoke(IPC.accountsDropSession, id),
    forget: (id) => ipcRenderer.invoke(IPC.accountsForget, id)
  }
}
