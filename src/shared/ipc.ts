import type { ContextMenuItem, ContextMenuRequest } from './context-menu'
import type {
  AccountConnectionState,
  AddImapAccountInput,
  AppMenuCommand,
  AttachmentRef,
  ActiveMailboxContext,
  AppBootstrap,
  ComposeMailInput,
  CopiedAttachment,
  FoldersChangedEvent,
  MailAccountSignature,
  DataStorageBreakdown,
  ListMessagesOptions,
  MailAccount,
  MessagesChangedEvent,
  UnifiedFolderSummary,
  UnifiedFoldersChangedEvent,
  UnifiedPreferences,
  WindowControlsState,
  MailFolder,
  MailContactSuggestion,
  MailMessageDetail,
  MailMessageListPage,
  MessageAttachmentsRef,
  MessageRef,
  MessagesActionResult,
  MoveMessagesInput,
  OpenAttachmentResult,
  PickedAttachment,
  RecentFile,
  SavedAttachments,
  SetMessagesKeywordInput,
  UiPreferences
} from './models'

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  getAccountConnectionStates: 'app:get-account-connection-states',
  getUiPreferences: 'app:get-ui-preferences',
  setUiPreferences: 'app:set-ui-preferences',
  addGoogleAccount: 'account:add-google',
  addImapAccount: 'account:add-imap',
  markAccountLastViewed: 'account:mark-last-viewed',
  removeAccount: 'account:remove',
  setActiveMailboxContext: 'app:set-active-mailbox-context',
  checkMailNow: 'app:check-mail-now',
  listFolders: 'folder:list',
  getUnifiedFolderSummaries: 'folder:get-unified-summaries',
  getUnifiedPreferences: 'folder:get-unified-preferences',
  setUnifiedIncludedAccounts: 'folder:set-unified-included-accounts',
  listMessages: 'message:list',
  getMessage: 'message:get',
  readMessage: 'message:read',
  prefetchMessages: 'message:prefetch',
  hydratePreviews: 'message:hydrate-previews',
  searchOnServer: 'message:search-on-server',
  moveMessages: 'message:move',
  deleteMessages: 'message:delete',
  archiveMessages: 'message:archive',
  setMessagesSeen: 'message:set-seen',
  setMessagesFlagged: 'message:set-flagged',
  sendMail: 'message:send',
  pickAttachments: 'compose:pick-attachments',
  suggestContacts: 'contact:suggest',
  listAccountSignatures: 'signature:list-account',
  getAccountSignature: 'signature:get-account',
  setAccountSignature: 'signature:set-account',
  getDataStorageBreakdown: 'data:get-storage-breakdown',
  clearAccountData: 'data:clear-account',
  clearAllDataKeepAccounts: 'data:clear-all-keep-accounts',
  openAttachment: 'attachment:open',
  saveAttachment: 'attachment:save',
  saveAllAttachments: 'attachment:save-all',
  copyMessageAttachments: 'attachment:copy',
  clearAttachmentCache: 'attachment:clear-cache',
  revealFile: 'file:reveal',
  listRecentFiles: 'file:list-recent',
  describeFiles: 'file:describe',
  openExternalUrl: 'app:open-external-url',
  openLogsFolder: 'app:open-logs-folder',
  openMessageFromNotification: 'app:open-message-from-notification',
  getWindowControlsState: 'window:get-controls-state',
  minimizeWindow: 'window:minimize',
  toggleMaximizeWindow: 'window:toggle-maximize',
  closeWindow: 'window:close',
  windowControlsStateChanged: 'window:controls-state-changed',
  messagesChanged: 'engine:messages-changed',
  foldersChanged: 'engine:folders-changed',
  unifiedFoldersChanged: 'engine:unified-folders-changed',
  accountConnectionChanged: 'engine:account-connection-changed',
  appMenuCommand: 'app:menu-command',
  showContextMenu: 'app:show-context-menu',
  contextMenuRequest: 'app:context-menu-request'
} as const

export interface DesktopMailApi {
  bootstrap: () => Promise<AppBootstrap>
  /**
   * One-shot snapshot of the current connection state for every account
   * the engine knows about. Used by the renderer to seed the badge map
   * for events that fired before `onAccountConnectionChanged` was
   * subscribed (typically during bootstrap).
   */
  getAccountConnectionStates: () => Promise<AccountConnectionState[]>
  /** Every persisted view preference in one payload. */
  getUiPreferences: () => Promise<UiPreferences>
  /** Persists the whole record and echoes back what was actually stored. */
  setUiPreferences: (preferences: UiPreferences) => Promise<UiPreferences>
  addGoogleAccount: () => Promise<MailAccount>
  addImapAccount: (input: AddImapAccountInput) => Promise<MailAccount>
  markAccountLastViewed: (accountId: string) => Promise<void>
  removeAccount: (accountId: string) => Promise<void>
  setActiveMailboxContext: (context: ActiveMailboxContext | null) => Promise<void>
  /** Asks every account now whether new mail has arrived. */
  checkMailNow: () => Promise<void>
  listFolders: (accountId: string) => Promise<MailFolder[]>
  getUnifiedFolderSummaries: () => Promise<UnifiedFolderSummary[]>
  getUnifiedPreferences: () => Promise<UnifiedPreferences>
  setUnifiedIncludedAccounts: (accountIds: string[]) => Promise<UnifiedPreferences>
  listMessages: (
    accountId: string,
    folderPath: string,
    options?: ListMessagesOptions
  ) => Promise<MailMessageListPage>
  getMessage: (ref: MessageRef) => Promise<MailMessageDetail>
  /**
   * The message the reading pane shows. A later call takes the place of one
   * still waiting its turn, which then settles with null.
   */
  readMessage: (ref: MessageRef) => Promise<MailMessageDetail | null>
  /** Fetches ahead the bodies of the messages likely to be read next. */
  prefetchMessages: (refs: MessageRef[]) => Promise<void>
  /** Fetches the previews of rows in view that have none yet. */
  hydratePreviews: (refs: MessageRef[]) => Promise<void>
  /**
   * What the servers find for a search of a list, in the whole text of the
   * messages. Null when a later search took this one's place.
   */
  searchOnServer: (
    accountId: string,
    folderPath: string,
    query: string
  ) => Promise<MessageRef[] | null>
  /**
   * Actions on several messages, each folder's in one command. They settle
   * with the messages the server did not take, never with an error for a
   * refusal: the others went through.
   */
  moveMessages: (input: MoveMessagesInput) => Promise<MessagesActionResult>
  deleteMessages: (refs: MessageRef[]) => Promise<MessagesActionResult>
  archiveMessages: (refs: MessageRef[]) => Promise<MessagesActionResult>
  setMessagesSeen: (input: SetMessagesKeywordInput) => Promise<MessagesActionResult>
  setMessagesFlagged: (input: SetMessagesKeywordInput) => Promise<MessagesActionResult>
  sendMail: (input: ComposeMailInput) => Promise<void>
  suggestContacts: (query: string, limit?: number) => Promise<MailContactSuggestion[]>
  listAccountSignatures: () => Promise<MailAccountSignature[]>
  getAccountSignature: (accountId: string) => Promise<MailAccountSignature | null>
  setAccountSignature: (accountId: string, html: string) => Promise<MailAccountSignature | null>
  getDataStorageBreakdown: () => Promise<DataStorageBreakdown>
  clearAccountData: (accountId: string) => Promise<void>
  clearAllDataKeepAccounts: () => Promise<void>
  pickAttachments: () => Promise<PickedAttachment[]>
  openAttachment: (input: AttachmentRef) => Promise<OpenAttachmentResult>
  /** Resolves to the saved path, or null when the user cancelled. */
  saveAttachment: (input: AttachmentRef) => Promise<string | null>
  saveAllAttachments: (ref: MessageRef) => Promise<SavedAttachments | null>
  /** Copies of a message's attachments, for a reply or forward to carry. */
  copyMessageAttachments: (input: MessageAttachmentsRef) => Promise<CopiedAttachment[]>
  clearAttachmentCache: () => Promise<void>
  revealFile: (filePath: string) => Promise<void>
  listRecentFiles: () => Promise<RecentFile[]>
  /** Files dropped on or picked for the composer, checked and sized. */
  describeFiles: (paths: string[]) => Promise<PickedAttachment[]>
  /** The path of a file dropped from the desktop (Electron `webUtils`). */
  getPathForFile: (file: File) => string
  openExternalUrl: (url: string) => Promise<boolean>
  /** Reveals the folder the main process writes its log to. */
  openLogsFolder: () => Promise<void>
  onOpenMessageFromNotification: (listener: (ref: MessageRef) => void) => () => void
  getWindowControlsState: () => Promise<WindowControlsState>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<WindowControlsState>
  closeWindow: () => Promise<void>
  onWindowControlsStateChanged: (listener: (state: WindowControlsState) => void) => () => void
  onMessagesChanged: (listener: (event: MessagesChangedEvent) => void) => () => void
  onFoldersChanged: (listener: (event: FoldersChangedEvent) => void) => () => void
  onUnifiedFoldersChanged: (listener: (event: UnifiedFoldersChangedEvent) => void) => () => void
  onAccountConnectionChanged: (listener: (state: AccountConnectionState) => void) => () => void
  onAppMenuCommand: (listener: (command: AppMenuCommand) => void) => () => void
  /**
   * Shows a context menu the page composed, as a native one, and settles
   * with the id of the item chosen — null when it was dismissed.
   */
  showContextMenu: (items: ContextMenuItem[]) => Promise<string | null>
  /** What a text, link or image menu asks the page to do. */
  onContextMenuRequest: (listener: (request: ContextMenuRequest) => void) => () => void
}
