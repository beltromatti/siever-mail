import type {
  AccountConnectionState,
  AddImapAccountInput,
  ActiveMailboxContext,
  AppBootstrap,
  ComposeMailInput,
  FoldersChangedEvent,
  MailAccountSignature,
  DataStorageBreakdown,
  DownloadAttachmentInput,
  DownloadAttachmentResult,
  ListMessagesOptions,
  MailAccount,
  MessagesChangedEvent,
  UnifiedInboxChangedEvent,
  UnifiedInboxPreferences,
  UnifiedInboxSummary,
  WindowControlsState,
  MailFolder,
  MailContactSuggestion,
  MailMessageDetail,
  MailMessageListPage,
  MessageRef,
  MoveMessageInput,
  PickedAttachment,
  ToggleSeenInput
} from './models'

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  addGoogleAccount: 'account:add-google',
  addImapAccount: 'account:add-imap',
  markAccountLastViewed: 'account:mark-last-viewed',
  removeAccount: 'account:remove',
  setActiveMailboxContext: 'app:set-active-mailbox-context',
  listFolders: 'folder:list',
  getUnifiedInboxSummary: 'folder:get-unified-inbox-summary',
  getUnifiedInboxPreferences: 'folder:get-unified-inbox-preferences',
  setUnifiedInboxIncludedAccounts: 'folder:set-unified-inbox-included-accounts',
  listMessages: 'message:list',
  getMessage: 'message:get',
  moveMessage: 'message:move',
  deleteMessage: 'message:delete',
  archiveMessage: 'message:archive',
  toggleSeen: 'message:toggle-seen',
  sendMail: 'message:send',
  pickAttachments: 'compose:pick-attachments',
  suggestContacts: 'contact:suggest',
  listAccountSignatures: 'signature:list-account',
  getAccountSignature: 'signature:get-account',
  setAccountSignature: 'signature:set-account',
  getDataStorageBreakdown: 'data:get-storage-breakdown',
  clearAccountData: 'data:clear-account',
  clearAllDataKeepAccounts: 'data:clear-all-keep-accounts',
  downloadAttachment: 'message:download-attachment',
  openExternalUrl: 'app:open-external-url',
  openMessageFromNotification: 'app:open-message-from-notification',
  getWindowControlsState: 'window:get-controls-state',
  minimizeWindow: 'window:minimize',
  toggleMaximizeWindow: 'window:toggle-maximize',
  closeWindow: 'window:close',
  windowControlsStateChanged: 'window:controls-state-changed',
  messagesChanged: 'engine:messages-changed',
  foldersChanged: 'engine:folders-changed',
  unifiedInboxChanged: 'engine:unified-inbox-changed',
  accountConnectionChanged: 'engine:account-connection-changed'
} as const

export interface DesktopMailApi {
  bootstrap: () => Promise<AppBootstrap>
  addGoogleAccount: () => Promise<MailAccount>
  addImapAccount: (input: AddImapAccountInput) => Promise<MailAccount>
  markAccountLastViewed: (accountId: string) => Promise<void>
  removeAccount: (accountId: string) => Promise<void>
  setActiveMailboxContext: (context: ActiveMailboxContext | null) => Promise<void>
  listFolders: (accountId: string) => Promise<MailFolder[]>
  getUnifiedInboxSummary: () => Promise<UnifiedInboxSummary>
  getUnifiedInboxPreferences: () => Promise<UnifiedInboxPreferences>
  setUnifiedInboxIncludedAccounts: (accountIds: string[]) => Promise<UnifiedInboxPreferences>
  listMessages: (
    accountId: string,
    folderPath: string,
    options?: ListMessagesOptions
  ) => Promise<MailMessageListPage>
  getMessage: (ref: MessageRef) => Promise<MailMessageDetail>
  moveMessage: (input: MoveMessageInput) => Promise<void>
  deleteMessage: (ref: MessageRef) => Promise<void>
  archiveMessage: (ref: MessageRef) => Promise<void>
  toggleSeen: (input: ToggleSeenInput) => Promise<void>
  sendMail: (input: ComposeMailInput) => Promise<void>
  suggestContacts: (query: string, limit?: number) => Promise<MailContactSuggestion[]>
  listAccountSignatures: () => Promise<MailAccountSignature[]>
  getAccountSignature: (accountId: string) => Promise<MailAccountSignature | null>
  setAccountSignature: (accountId: string, html: string) => Promise<MailAccountSignature | null>
  getDataStorageBreakdown: () => Promise<DataStorageBreakdown>
  clearAccountData: (accountId: string) => Promise<void>
  clearAllDataKeepAccounts: () => Promise<void>
  pickAttachments: () => Promise<PickedAttachment[]>
  downloadAttachment: (input: DownloadAttachmentInput) => Promise<DownloadAttachmentResult>
  openExternalUrl: (url: string) => Promise<boolean>
  onOpenMessageFromNotification: (listener: (ref: MessageRef) => void) => () => void
  getWindowControlsState: () => Promise<WindowControlsState>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<WindowControlsState>
  closeWindow: () => Promise<void>
  onWindowControlsStateChanged: (listener: (state: WindowControlsState) => void) => () => void
  onMessagesChanged: (listener: (event: MessagesChangedEvent) => void) => () => void
  onFoldersChanged: (listener: (event: FoldersChangedEvent) => void) => () => void
  onUnifiedInboxChanged: (listener: (event: UnifiedInboxChangedEvent) => void) => () => void
  onAccountConnectionChanged: (listener: (state: AccountConnectionState) => void) => () => void
}
