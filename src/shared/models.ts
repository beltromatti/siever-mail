export type AccountType = 'gmail' | 'imap'
export type AuthType = 'password' | 'oauth'

export interface MailAddress {
  name?: string
  address: string
}

export interface MailAttachment {
  id: string
  fileName: string
  contentType: string
  size: number
  cid?: string
}

export interface MailFolder {
  id: string
  accountId: string
  path: string
  name: string
  delimiter?: string
  specialUse?: string
  messageCount: number
  unseenCount: number
  lastSyncedAt?: number
}

export interface MailMessageSummary {
  accountId: string
  folderPath: string
  uid: number
  threadId?: string
  messageId?: string
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  date: string
  preview: string
  // False until the background hydration pass has fetched enough body to extract
  // a real preview. The UI shows a "Caricamento anteprima…" placeholder while
  // this is false instead of echoing the subject, so the user can tell at a
  // glance which rows are still being filled in.
  previewHydrated: boolean
  flags: string[]
  isRead: boolean
  hasAttachments: boolean
  size: number
}

export interface MailMessageDetail extends MailMessageSummary {
  bcc: MailAddress[]
  html?: string
  text?: string
  attachments: MailAttachment[]
}

export interface ListMessagesOptions {
  limit?: number
  query?: string
}

export const MESSAGE_LIST_PAGE_SIZE = 100
export const ALL_INBOX_FOLDER_PATH = '__all_inboxes__'

export interface UnifiedInboxSummary {
  messageCount: number
  unseenCount: number
  lastSyncedAt?: number
}

export interface UnifiedInboxPreferences {
  includedAccountIds: string[]
}

export interface MailMessageListPage {
  messages: MailMessageSummary[]
  total: number
  hasMore: boolean
  limit: number
  folderLastSyncedAt?: number
}

export interface MailAccount {
  id: string
  type: AccountType
  email: string
  displayName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  authType: AuthType
  createdAt: number
  updatedAt: number
}

export interface AddImapAccountInput {
  email: string
  displayName: string
  username: string
  password: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
}

export interface MessageRef {
  accountId: string
  folderPath: string
  uid: number
}

export interface ActiveMailboxContext {
  accountId: string
  folderPath: string
}

export interface MoveMessageInput extends MessageRef {
  destinationFolderPath: string
}

export interface ToggleSeenInput extends MessageRef {
  seen: boolean
}

export interface ComposeAttachmentInput {
  path: string
  name?: string
}

export interface ComposeMailInput {
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references?: string[]
  attachments: ComposeAttachmentInput[]
}

export interface PickedAttachment {
  path: string
  name: string
  size: number
}

export interface DownloadAttachmentInput {
  ref: MessageRef
  attachmentId: string
}

export interface DownloadAttachmentResult {
  filePath: string
}

export interface MailContactSuggestion {
  name?: string
  email: string
}

export interface AppCapabilities {
  googleOAuthReady: boolean
}

export interface AppBootstrap {
  capabilities: AppCapabilities
  accounts: MailAccount[]
}

export interface DataStorageSection {
  id: string
  label: string
  kind: 'account' | 'global'
  sizeBytes: number
}

export interface DataStorageBreakdown {
  totalBytes: number
  sections: DataStorageSection[]
}

export interface MailAccountSignature {
  accountId: string
  html: string
  updatedAt: number
}

export interface WindowControlsState {
  enabled: boolean
  maximized: boolean
  dragTopRegionEnabled: boolean
}

export type AccountConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'disconnected'

export interface AccountConnectionState {
  accountId: string
  status: AccountConnectionStatus
  errorMessage?: string
  lastConnectedAt?: number
  lastErrorAt?: number
}

export interface FolderCountsEvent {
  accountId: string
  folderPath: string
  messageCount: number
  unseenCount: number
  lastSyncedAt?: number
}

export interface MessagesChangedEvent {
  accountId: string
  folderPath: string
  added: MailMessageSummary[]
  updated: MailMessageSummary[]
  removedUids: number[]
  folder?: FolderCountsEvent
}

export interface FoldersChangedEvent {
  accountId: string
  folders: MailFolder[]
}

export interface UnifiedInboxChangedEvent {
  summary: UnifiedInboxSummary
}
