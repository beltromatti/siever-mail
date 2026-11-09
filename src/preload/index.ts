import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

import installExtensionPreload from '@app/extension/preload'
import extensionShared from '@app/extension/shared'
import { extensionChannel } from '@shared/extension-ipc'
import { IPC_CHANNELS, type DesktopMailApi } from '@shared/ipc'
import { CALENDAR_IPC, type CalendarApi } from '@shared/calendar'
import { DIAGNOSTICS_IPC, type DiagnosticsApi } from '@shared/diagnostics'
import { FILES_IPC, type FilesApi } from '@shared/files'
import { SEGRETARIO_IPC, type SegretarioApi } from '@shared/segretario'

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
  addGoogleAccount: async (options) => invoke(IPC_CHANNELS.addGoogleAccount, options),
  addImapAccount: async (input) => invoke(IPC_CHANNELS.addImapAccount, input),
  addMicrosoftAccount: async (options) => invoke(IPC_CHANNELS.addMicrosoftAccount, options),
  cancelSignIn: async () => invoke(IPC_CHANNELS.cancelSignIn),
  discoverMailSettings: async (address) => invoke(IPC_CHANNELS.discoverMailSettings, address),
  markAccountLastViewed: async (accountId) => invoke(IPC_CHANNELS.markAccountLastViewed, accountId),
  removeAccount: async (accountId) => invoke(IPC_CHANNELS.removeAccount, accountId),
  outgoingCount: async (accountId) => invoke(IPC_CHANNELS.outgoingCount, accountId),
  setActiveMailboxContext: async (context) => invoke(IPC_CHANNELS.setActiveMailboxContext, context),
  checkMailNow: async () => invoke(IPC_CHANNELS.checkMailNow),
  reconnectAccount: async (accountId, password) =>
    invoke(IPC_CHANNELS.reconnectAccount, accountId, password),
  listFolders: async (accountId) => invoke(IPC_CHANNELS.listFolders, accountId),
  listRecentFolders: async (accountId) => invoke(IPC_CHANNELS.listRecentFolders, accountId),
  createFolder: async (input) => invoke(IPC_CHANNELS.createFolder, input),
  renameFolder: async (input) => invoke(IPC_CHANNELS.renameFolder, input),
  markFolderRead: async (accountId, folderPath) =>
    invoke(IPC_CHANNELS.markFolderRead, accountId, folderPath),
  getUnifiedFolderSummaries: async () => invoke(IPC_CHANNELS.getUnifiedFolderSummaries),
  getSegretarioViewCounts: async () => invoke(IPC_CHANNELS.getSegretarioViewCounts),
  getUnifiedPreferences: async () => invoke(IPC_CHANNELS.getUnifiedPreferences),
  setUnifiedIncludedAccounts: async (accountIds) =>
    invoke(IPC_CHANNELS.setUnifiedIncludedAccounts, accountIds),
  listMessages: async (accountId, folderPath, options) =>
    invoke(IPC_CHANNELS.listMessages, accountId, folderPath, options),
  getMessage: async (ref) => invoke(IPC_CHANNELS.getMessage, ref),
  readMessage: async (ref) => invoke(IPC_CHANNELS.readMessage, ref),
  prefetchMessages: async (refs) => invoke(IPC_CHANNELS.prefetchMessages, refs),
  hydratePreviews: async (refs) => invoke(IPC_CHANNELS.hydratePreviews, refs),
  searchOnServer: async (accountId, folderPath, query) =>
    invoke(IPC_CHANNELS.searchOnServer, accountId, folderPath, query),
  moveMessages: async (input) => invoke(IPC_CHANNELS.moveMessages, input),
  moveMessagesToRole: async (input) => invoke(IPC_CHANNELS.moveMessagesToRole, input),
  deleteMessages: async (refs) => invoke(IPC_CHANNELS.deleteMessages, refs),
  archiveMessages: async (refs) => invoke(IPC_CHANNELS.archiveMessages, refs),
  setMessagesSeen: async (input) => invoke(IPC_CHANNELS.setMessagesSeen, input),
  setMessagesFlagged: async (input) => invoke(IPC_CHANNELS.setMessagesFlagged, input),
  sendMail: async (input) => invoke(IPC_CHANNELS.sendMail, input),
  suggestContacts: async (query, limit) => invoke(IPC_CHANNELS.suggestContacts, query, limit),
  forgetContact: async (address) => invoke(IPC_CHANNELS.forgetContact, address),
  saveDraft: async (content) => invoke(IPC_CHANNELS.saveDraft, content),
  flushDraft: async (id) => invoke(IPC_CHANNELS.flushDraft, id),
  closeDraft: async (id) => invoke(IPC_CHANNELS.closeDraft, id),
  discardDraft: async (id) => invoke(IPC_CHANNELS.discardDraft, id),
  listDockedDrafts: async () => invoke(IPC_CHANNELS.listDockedDrafts),
  openDraftMessage: async (ref) => invoke(IPC_CHANNELS.openDraftMessage, ref),
  getStoredDraft: async (id) => invoke(IPC_CHANNELS.getStoredDraft, id),
  onDraftStatusChanged: (listener) => subscribe(IPC_CHANNELS.draftStatusChanged, listener),
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
  openFile: async (filePath) => invoke(IPC_CHANNELS.openFile, filePath),
  listRecentFiles: async () => invoke(IPC_CHANNELS.listRecentFiles),
  describeFiles: async (paths) => invoke(IPC_CHANNELS.describeFiles, paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternalUrl: async (url) => invoke(IPC_CHANNELS.openExternalUrl, url),
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
  onUnifiedFoldersChanged: (listener) => subscribe(IPC_CHANNELS.unifiedFoldersChanged, listener),
  getNotificationPreferences: async () => invoke(IPC_CHANNELS.getNotificationPreferences),
  setNotificationPreferences: async (preferences) =>
    invoke(IPC_CHANNELS.setNotificationPreferences, preferences),
  getNotificationStatus: async () => invoke(IPC_CHANNELS.getNotificationStatus),
  showTestNotification: async () => invoke(IPC_CHANNELS.showTestNotification),
  openNotificationSettings: async () => invoke(IPC_CHANNELS.openNotificationSettings),
  onNotificationStatusChanged: (listener) =>
    subscribe(IPC_CHANNELS.notificationStatusChanged, listener),
  onTaskbarBadgeChanged: (listener) => subscribe(IPC_CHANNELS.taskbarBadgeChanged, listener),
  setTaskbarBadgeImage: async (dataUrl, description) =>
    invoke(IPC_CHANNELS.setTaskbarBadgeImage, dataUrl, description),
  onAccountConnectionChanged: (listener) =>
    subscribe(IPC_CHANNELS.accountConnectionChanged, listener),
  onConnectionRefused: (listener) => subscribe(IPC_CHANNELS.connectionRefused, listener),
  listConnectionRefusals: async () => invoke(IPC_CHANNELS.listConnectionRefusals),
  takeBackOutgoing: async (draftId) => invoke(IPC_CHANNELS.takeBackOutgoing, draftId),
  onOutboxSent: (listener) => subscribe(IPC_CHANNELS.outboxSent, listener),
  messageMarks: async (messages) => invoke(IPC_CHANNELS.messageMarks, messages),
  markedBefore: async (messages) => invoke(IPC_CHANNELS.markedBefore, messages),
  onMarksChanged: (listener) => subscribe(IPC_CHANNELS.marksChanged, listener),
  onOutboxFailed: (listener) => subscribe(IPC_CHANNELS.outboxFailed, listener),
  onAppMenuCommand: (listener) => subscribe(IPC_CHANNELS.appMenuCommand, listener),
  showContextMenu: async (items) => invoke(IPC_CHANNELS.showContextMenu, items),
  onContextMenuRequest: (listener) => subscribe(IPC_CHANNELS.contextMenuRequest, listener)
}

const segretarioApi: SegretarioApi = {
  getStatus: async () => invoke(SEGRETARIO_IPC.getStatus),
  saveKey: async (key) => invoke(SEGRETARIO_IPC.saveKey, key),
  removeKey: async () => invoke(SEGRETARIO_IPC.removeKey),
  forgetAll: async () => invoke(SEGRETARIO_IPC.forgetAll),
  checkKey: async () => invoke(SEGRETARIO_IPC.checkKey),
  getNotice: async () => invoke(SEGRETARIO_IPC.getNotice),
  dismissNotice: async () => invoke(SEGRETARIO_IPC.dismissNotice),
  getPreferences: async () => invoke(SEGRETARIO_IPC.getPreferences),
  setPreferences: async (preferences) => invoke(SEGRETARIO_IPC.setPreferences, preferences),
  getSpending: async () => invoke(SEGRETARIO_IPC.getSpending),
  getEngineState: async () => invoke(SEGRETARIO_IPC.getEngineState),
  retryReading: async (accountIds) => invoke(SEGRETARIO_IPC.retryReading, accountIds),
  listMemory: async () => invoke(SEGRETARIO_IPC.listMemory),
  writeMemory: async (path, content, seenRevision) =>
    invoke(SEGRETARIO_IPC.writeMemory, path, content, seenRevision),
  deleteMemory: async (path) => invoke(SEGRETARIO_IPC.deleteMemory, path),
  memoryHistory: async (path) => invoke(SEGRETARIO_IPC.memoryHistory, path),
  restoreMemory: async (path, revision) => invoke(SEGRETARIO_IPC.restoreMemory, path, revision),
  forgetEverything: async () => invoke(SEGRETARIO_IPC.forgetEverything),
  listLearning: async () => invoke(SEGRETARIO_IPC.listLearning),
  startConoscimi: async (keys) => invoke(SEGRETARIO_IPC.startConoscimi, keys),
  getOnboarding: async () => invoke(SEGRETARIO_IPC.getOnboarding),
  setOnboarding: async (state) => invoke(SEGRETARIO_IPC.setOnboarding, state),
  connectionReadiness: async (accountIds) => invoke(SEGRETARIO_IPC.connectionReadiness, accountIds),
  getReadingStatus: async (accountIds) => invoke(SEGRETARIO_IPC.getReadingStatus, accountIds),
  setPreparing: async (preparing) => invoke(SEGRETARIO_IPC.setPreparing, preparing),
  draftSent: async (draftId, writtenText) => invoke(SEGRETARIO_IPC.draftSent, draftId, writtenText),
  getRowWork: async (messages) => invoke(SEGRETARIO_IPC.getRowWork, messages),
  selectionWork: async (messages) => invoke(SEGRETARIO_IPC.selectionWork, messages),
  getMessageWork: async (accountId, messageKey) =>
    invoke(SEGRETARIO_IPC.getMessageWork, accountId, messageKey),
  setCommitmentStatus: async (id, status, options) =>
    invoke(SEGRETARIO_IPC.setCommitmentStatus, id, status, options),
  editCommitment: async (id, changes) => invoke(SEGRETARIO_IPC.editCommitment, id, changes),
  undoCommitmentStatus: async (id) => invoke(SEGRETARIO_IPC.undoCommitmentStatus, id),
  openCommitment: async (from, input) => invoke(SEGRETARIO_IPC.openCommitment, from, input),
  markHandled: async (messages) => invoke(SEGRETARIO_IPC.markHandled, messages),
  undoChange: async (activityId, eventId, index) =>
    invoke(SEGRETARIO_IPC.undoChange, activityId, eventId, index),
  replySource: async (accountId, messageKey) =>
    invoke(SEGRETARIO_IPC.replySource, accountId, messageKey),
  takeUpReply: async (accountId, messageKey, draftId) =>
    invoke(SEGRETARIO_IPC.takeUpReply, accountId, messageKey, draftId),
  discardReply: async (accountId, messageKey) =>
    invoke(SEGRETARIO_IPC.discardReply, accountId, messageKey),
  listProposals: async () => invoke(SEGRETARIO_IPC.listProposals),
  eventPrep: async (eventKey) => invoke(SEGRETARIO_IPC.eventPrep, eventKey),
  eventWork: async (eventKey) => invoke(SEGRETARIO_IPC.eventWork, eventKey),
  commitmentSource: async (id) => invoke(SEGRETARIO_IPC.commitmentSource, id),
  decideProposal: async (id, accepted, result, revision) =>
    invoke(SEGRETARIO_IPC.decideProposal, id, accepted, result, revision),
  getToday: async () => invoke(SEGRETARIO_IPC.getToday),
  refreshToday: async () => invoke(SEGRETARIO_IPC.refreshToday),
  getDue: async (throughDay) => invoke(SEGRETARIO_IPC.getDue, throughDay),
  assistWriting: async (request) => invoke(SEGRETARIO_IPC.assistWriting, request),
  reviewDraft: async (request) => invoke(SEGRETARIO_IPC.reviewDraft, request),
  askMail: async (question, requestId) => invoke(SEGRETARIO_IPC.askMail, question, requestId),
  stopAsking: async (requestId) => invoke(SEGRETARIO_IPC.stopAsking, requestId),
  listSavedSearches: async () => invoke(SEGRETARIO_IPC.listSavedSearches),
  saveSearch: async (id) => invoke(SEGRETARIO_IPC.saveSearch, id),
  removeSavedSearch: async (id) => invoke(SEGRETARIO_IPC.removeSavedSearch, id),
  listProjects: async (options) => invoke(SEGRETARIO_IPC.listProjects, options),
  getProject: async (id) => invoke(SEGRETARIO_IPC.getProject, id),
  refreshProject: async (id) => invoke(SEGRETARIO_IPC.refreshProject, id),
  createProject: async (title) => invoke(SEGRETARIO_IPC.createProject, title),
  updateProject: async (id, change) => invoke(SEGRETARIO_IPC.updateProject, id, change),
  mergeProjects: async (keepId, otherIds) => invoke(SEGRETARIO_IPC.mergeProjects, keepId, otherIds),
  setConversationProject: async (thread, projectId, linked) =>
    invoke(SEGRETARIO_IPC.setConversationProject, thread, projectId, linked),
  conversationProjects: async (threads) => invoke(SEGRETARIO_IPC.conversationProjects, threads),
  openProjectFolder: async (id) => invoke(SEGRETARIO_IPC.openProjectFolder, id),
  onWorkChanged: (listener) => subscribe(SEGRETARIO_IPC.workChanged, listener),
  onEngineChanged: (listener) => subscribe(SEGRETARIO_IPC.engineChanged, listener),
  listActivities: async (options) => invoke(SEGRETARIO_IPC.listActivities, options),
  getActivity: async (id) => invoke(SEGRETARIO_IPC.getActivity, id),
  startActivity: async (text, context) => invoke(SEGRETARIO_IPC.startActivity, text, context),
  sendMessage: async (id, text, context) => invoke(SEGRETARIO_IPC.sendMessage, id, text, context),
  retryActivity: async (id) => invoke(SEGRETARIO_IPC.retryActivity, id),
  cancelActivity: async (id) => invoke(SEGRETARIO_IPC.cancelActivity, id),
  removeActivity: async (id) => invoke(SEGRETARIO_IPC.removeActivity, id),
  markActivitySeen: async (id) => invoke(SEGRETARIO_IPC.markActivitySeen, id),
  resolveApproval: async (activityId, approvalId, approved, outcome) =>
    invoke(SEGRETARIO_IPC.resolveApproval, activityId, approvalId, approved, outcome),
  completeCompose: async (requestId, result) =>
    invoke(SEGRETARIO_IPC.completeCompose, requestId, result),
  onStatusChanged: (listener) => subscribe(SEGRETARIO_IPC.statusChanged, listener),
  onPreferencesChanged: (listener) => subscribe(SEGRETARIO_IPC.preferencesChanged, listener),
  onNotice: (listener) => subscribe(SEGRETARIO_IPC.notice, listener),
  onActivityEvent: (listener) => subscribe(SEGRETARIO_IPC.activityEvent, listener),
  onComposeRequest: (listener) => subscribe(SEGRETARIO_IPC.composeRequest, listener),
  onShowRequest: (listener) => subscribe(SEGRETARIO_IPC.showRequest, listener)
}

const calendarApi: CalendarApi = {
  listConnections: async () => invoke(CALENDAR_IPC.listConnections),
  connectGoogle: async (mailAccountId) => invoke(CALENDAR_IPC.connectGoogle, mailAccountId),
  connectMicrosoft: async (mailAccountId) => invoke(CALENDAR_IPC.connectMicrosoft, mailAccountId),
  addIcs: async (link, name) => invoke(CALENDAR_IPC.addIcs, link, name),
  addCalDav: async (input) => invoke(CALENDAR_IPC.addCalDav, input),
  reconnect: async (connectionId, password) =>
    invoke(CALENDAR_IPC.reconnect, connectionId, password),
  respondByMail: async (ref, response) => invoke(CALENDAR_IPC.respondByMail, ref, response),
  disconnect: async (connectionId) => invoke(CALENDAR_IPC.disconnect, connectionId),
  events: async (fromIso, toIso) => invoke(CALENDAR_IPC.events, fromIso, toIso),
  search: async (query) => invoke(CALENDAR_IPC.search, query),
  event: async (eventKey) => invoke(CALENDAR_IPC.event, eventKey),
  eventByUid: async (iCalUid, mailAccountId) =>
    invoke(CALENDAR_IPC.eventByUid, iCalUid, mailAccountId),
  invitation: async (ref) => invoke(CALENDAR_IPC.invitation, ref),
  respond: async (eventKey, response, options) =>
    invoke(CALENDAR_IPC.respond, eventKey, response, options),
  calendars: async () => invoke(CALENDAR_IPC.calendars),
  setCalendarHidden: async (calendarKey, hidden) =>
    invoke(CALENDAR_IPC.setCalendarHidden, calendarKey, hidden),
  create: async (event) => invoke(CALENDAR_IPC.create, event),
  update: async (eventKey, change) => invoke(CALENDAR_IPC.update, eventKey, change),
  remove: async (eventKey) => invoke(CALENDAR_IPC.remove, eventKey),
  syncNow: async () => invoke(CALENDAR_IPC.syncNow),
  onChanged: (listener) => subscribe(CALENDAR_IPC.changed, () => listener())
}

const filesApi: FilesApi = {
  sources: async () => invoke(FILES_IPC.sources)
}

const diagnosticsApi: DiagnosticsApi = {
  record: (event) => ipcRenderer.send(DIAGNOSTICS_IPC.record, event),
  info: async () => invoke(DIAGNOSTICS_IPC.info),
  export: async (options) => invoke(DIAGNOSTICS_IPC.export, options),
  openFolder: async () => invoke(DIAGNOSTICS_IPC.openFolder)
}

// The extension's bridge, over its own channels (under its id), apart from the host's APIs:
// `window.extensionApi`. The public build has no extension, and no such bridge.
const extensionIdentity = extensionShared.identity
const extensionApi = extensionIdentity
  ? installExtensionPreload({
      invoke: (name, ...args) => invoke(extensionChannel(extensionIdentity.id, name), ...args),
      on: (name, listener) => subscribe(extensionChannel(extensionIdentity.id, name), listener)
    })
  : undefined

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('mailApi', desktopMailApi)
  contextBridge.exposeInMainWorld('segretarioApi', segretarioApi)
  contextBridge.exposeInMainWorld('calendarApi', calendarApi)
  contextBridge.exposeInMainWorld('filesApi', filesApi)
  contextBridge.exposeInMainWorld('diagnosticsApi', diagnosticsApi)

  if (extensionApi) {
    contextBridge.exposeInMainWorld('extensionApi', extensionApi)
  }
} else {
  // @ts-expect-error context isolation disabled by external override
  window.mailApi = desktopMailApi
  // @ts-expect-error context isolation disabled by external override
  window.segretarioApi = segretarioApi
  // @ts-expect-error context isolation disabled by external override
  window.calendarApi = calendarApi
  // @ts-expect-error context isolation disabled by external override
  window.filesApi = filesApi
  // @ts-expect-error context isolation disabled by external override
  window.diagnosticsApi = diagnosticsApi
  // @ts-expect-error context isolation disabled by external override
  window.extensionApi = extensionApi
}
