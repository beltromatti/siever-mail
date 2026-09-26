import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

import installExtensionPreload from '@app/extension/preload'
import { IPC_CHANNELS, type DesktopMailApi } from '@shared/ipc'

const REMOTE_METHOD_ERROR_PREFIX =
  /^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as T)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * `ipcRenderer.invoke`, rejecting with the main process's own message.
 * Electron rejects with "Error invoking remote method '<channel>': Error:
 * <message>", and that prefix reached the user verbatim wherever an error
 * is shown.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace(REMOTE_METHOD_ERROR_PREFIX, ''), { cause: error })
  }
}

const desktopMailApi: DesktopMailApi = {
  bootstrap: async () => invoke(IPC_CHANNELS.bootstrap),
  getAccountConnectionStates: async () => invoke(IPC_CHANNELS.getAccountConnectionStates),
  getUiPreferences: async () => invoke(IPC_CHANNELS.getUiPreferences),
  setUiPreferences: async (preferences) => invoke(IPC_CHANNELS.setUiPreferences, preferences),
  addGoogleAccount: async () => invoke(IPC_CHANNELS.addGoogleAccount),
  addImapAccount: async (input) => invoke(IPC_CHANNELS.addImapAccount, input),
  markAccountLastViewed: async (accountId) => invoke(IPC_CHANNELS.markAccountLastViewed, accountId),
  removeAccount: async (accountId) => invoke(IPC_CHANNELS.removeAccount, accountId),
  setActiveMailboxContext: async (context) => invoke(IPC_CHANNELS.setActiveMailboxContext, context),
  listFolders: async (accountId) => invoke(IPC_CHANNELS.listFolders, accountId),
  getUnifiedInboxSummary: async () => invoke(IPC_CHANNELS.getUnifiedInboxSummary),
  getUnifiedInboxPreferences: async () => invoke(IPC_CHANNELS.getUnifiedInboxPreferences),
  setUnifiedInboxIncludedAccounts: async (accountIds) =>
    invoke(IPC_CHANNELS.setUnifiedInboxIncludedAccounts, accountIds),
  listMessages: async (accountId, folderPath, options) =>
    invoke(IPC_CHANNELS.listMessages, accountId, folderPath, options),
  getMessage: async (ref) => invoke(IPC_CHANNELS.getMessage, ref),
  moveMessage: async (input) => invoke(IPC_CHANNELS.moveMessage, input),
  deleteMessage: async (ref) => invoke(IPC_CHANNELS.deleteMessage, ref),
  archiveMessage: async (ref) => invoke(IPC_CHANNELS.archiveMessage, ref),
  toggleSeen: async (input) => invoke(IPC_CHANNELS.toggleSeen, input),
  toggleFlagged: async (input) => invoke(IPC_CHANNELS.toggleFlagged, input),
  sendMail: async (input) => invoke(IPC_CHANNELS.sendMail, input),
  suggestContacts: async (query, limit) => invoke(IPC_CHANNELS.suggestContacts, query, limit),
  listAccountSignatures: async () => invoke(IPC_CHANNELS.listAccountSignatures),
  getAccountSignature: async (accountId) => invoke(IPC_CHANNELS.getAccountSignature, accountId),
  setAccountSignature: async (accountId, html) =>
    invoke(IPC_CHANNELS.setAccountSignature, accountId, html),
  getDataStorageBreakdown: async () => invoke(IPC_CHANNELS.getDataStorageBreakdown),
  clearAccountData: async (accountId) => invoke(IPC_CHANNELS.clearAccountData, accountId),
  clearAllDataKeepAccounts: async () => invoke(IPC_CHANNELS.clearAllDataKeepAccounts),
  pickAttachments: async () => invoke(IPC_CHANNELS.pickAttachments),
  openAttachment: async (input) => invoke(IPC_CHANNELS.openAttachment, input),
  saveAttachment: async (input) => invoke(IPC_CHANNELS.saveAttachment, input),
  saveAllAttachments: async (ref) => invoke(IPC_CHANNELS.saveAllAttachments, ref),
  copyMessageAttachments: async (input) => invoke(IPC_CHANNELS.copyMessageAttachments, input),
  clearAttachmentCache: async () => invoke(IPC_CHANNELS.clearAttachmentCache),
  revealFile: async (filePath) => invoke(IPC_CHANNELS.revealFile, filePath),
  listRecentFiles: async () => invoke(IPC_CHANNELS.listRecentFiles),
  describeFiles: async (paths) => invoke(IPC_CHANNELS.describeFiles, paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternalUrl: async (url) => invoke(IPC_CHANNELS.openExternalUrl, url),
  openLogsFolder: async () => invoke(IPC_CHANNELS.openLogsFolder),
  getWindowControlsState: async () => invoke(IPC_CHANNELS.getWindowControlsState),
  minimizeWindow: async () => invoke(IPC_CHANNELS.minimizeWindow),
  toggleMaximizeWindow: async () => invoke(IPC_CHANNELS.toggleMaximizeWindow),
  closeWindow: async () => invoke(IPC_CHANNELS.closeWindow),
  onOpenMessageFromNotification: (listener) =>
    subscribe(IPC_CHANNELS.openMessageFromNotification, listener),
  onWindowControlsStateChanged: (listener) =>
    subscribe(IPC_CHANNELS.windowControlsStateChanged, listener),
  onMessagesChanged: (listener) => subscribe(IPC_CHANNELS.messagesChanged, listener),
  onFoldersChanged: (listener) => subscribe(IPC_CHANNELS.foldersChanged, listener),
  onUnifiedInboxChanged: (listener) => subscribe(IPC_CHANNELS.unifiedInboxChanged, listener),
  onAccountConnectionChanged: (listener) =>
    subscribe(IPC_CHANNELS.accountConnectionChanged, listener),
  onAppMenuCommand: (listener) => subscribe(IPC_CHANNELS.appMenuCommand, listener)
}

// Merge any extension-provided bridge methods (the IPC channels an
// extension registers) onto the host's API surface. The public build's
// installer returns an empty object, so window.mailApi remains the host's
// own API there.
const extensionBridge = installExtensionPreload(ipcRenderer)
const mergedMailApi = { ...desktopMailApi, ...extensionBridge }

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('mailApi', mergedMailApi)
} else {
  // @ts-expect-error context isolation disabled by external override
  window.mailApi = mergedMailApi
}
