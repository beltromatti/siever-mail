import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import installExtensionPreload from '@app/extension/preload'
import { IPC_CHANNELS, type DesktopMailApi } from '@shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as T)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const desktopMailApi: DesktopMailApi = {
  bootstrap: async () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  addGoogleAccount: async () => ipcRenderer.invoke(IPC_CHANNELS.addGoogleAccount),
  addImapAccount: async (input) => ipcRenderer.invoke(IPC_CHANNELS.addImapAccount, input),
  markAccountLastViewed: async (accountId) =>
    ipcRenderer.invoke(IPC_CHANNELS.markAccountLastViewed, accountId),
  removeAccount: async (accountId) => ipcRenderer.invoke(IPC_CHANNELS.removeAccount, accountId),
  setActiveMailboxContext: async (context) =>
    ipcRenderer.invoke(IPC_CHANNELS.setActiveMailboxContext, context),
  listFolders: async (accountId) => ipcRenderer.invoke(IPC_CHANNELS.listFolders, accountId),
  getUnifiedInboxSummary: async () => ipcRenderer.invoke(IPC_CHANNELS.getUnifiedInboxSummary),
  getUnifiedInboxPreferences: async () =>
    ipcRenderer.invoke(IPC_CHANNELS.getUnifiedInboxPreferences),
  setUnifiedInboxIncludedAccounts: async (accountIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.setUnifiedInboxIncludedAccounts, accountIds),
  listMessages: async (accountId, folderPath, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.listMessages, accountId, folderPath, options),
  getMessage: async (ref) => ipcRenderer.invoke(IPC_CHANNELS.getMessage, ref),
  moveMessage: async (input) => ipcRenderer.invoke(IPC_CHANNELS.moveMessage, input),
  deleteMessage: async (ref) => ipcRenderer.invoke(IPC_CHANNELS.deleteMessage, ref),
  archiveMessage: async (ref) => ipcRenderer.invoke(IPC_CHANNELS.archiveMessage, ref),
  toggleSeen: async (input) => ipcRenderer.invoke(IPC_CHANNELS.toggleSeen, input),
  sendMail: async (input) => ipcRenderer.invoke(IPC_CHANNELS.sendMail, input),
  suggestContacts: async (query, limit) =>
    ipcRenderer.invoke(IPC_CHANNELS.suggestContacts, query, limit),
  listAccountSignatures: async () => ipcRenderer.invoke(IPC_CHANNELS.listAccountSignatures),
  getAccountSignature: async (accountId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getAccountSignature, accountId),
  setAccountSignature: async (accountId, html) =>
    ipcRenderer.invoke(IPC_CHANNELS.setAccountSignature, accountId, html),
  getDataStorageBreakdown: async () => ipcRenderer.invoke(IPC_CHANNELS.getDataStorageBreakdown),
  clearAccountData: async (accountId) =>
    ipcRenderer.invoke(IPC_CHANNELS.clearAccountData, accountId),
  clearAllDataKeepAccounts: async () => ipcRenderer.invoke(IPC_CHANNELS.clearAllDataKeepAccounts),
  pickAttachments: async () => ipcRenderer.invoke(IPC_CHANNELS.pickAttachments),
  downloadAttachment: async (input) => ipcRenderer.invoke(IPC_CHANNELS.downloadAttachment, input),
  openExternalUrl: async (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  getWindowControlsState: async () => ipcRenderer.invoke(IPC_CHANNELS.getWindowControlsState),
  minimizeWindow: async () => ipcRenderer.invoke(IPC_CHANNELS.minimizeWindow),
  toggleMaximizeWindow: async () => ipcRenderer.invoke(IPC_CHANNELS.toggleMaximizeWindow),
  closeWindow: async () => ipcRenderer.invoke(IPC_CHANNELS.closeWindow),
  onOpenMessageFromNotification: (listener) =>
    subscribe(IPC_CHANNELS.openMessageFromNotification, listener),
  onWindowControlsStateChanged: (listener) =>
    subscribe(IPC_CHANNELS.windowControlsStateChanged, listener),
  onMessagesChanged: (listener) => subscribe(IPC_CHANNELS.messagesChanged, listener),
  onFoldersChanged: (listener) => subscribe(IPC_CHANNELS.foldersChanged, listener),
  onUnifiedInboxChanged: (listener) => subscribe(IPC_CHANNELS.unifiedInboxChanged, listener),
  onAccountConnectionChanged: (listener) =>
    subscribe(IPC_CHANNELS.accountConnectionChanged, listener)
}

// Merge any extension-provided bridge methods (e.g. archive: IPC channels
// added by the SIEVER extension) onto the host's API surface. The public
// build's installer returns an empty object, so window.mailApi remains the
// host's own API there.
const extensionBridge = installExtensionPreload(ipcRenderer)
const mergedMailApi = { ...desktopMailApi, ...extensionBridge }

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('mailApi', mergedMailApi)
} else {
  // @ts-expect-error context isolation disabled by external override
  window.mailApi = mergedMailApi
}
