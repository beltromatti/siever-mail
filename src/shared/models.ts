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
  /**
   * Mirror of the IMAP `\\Flagged` keyword — the same "contrassegna"
   * Outlook and iOS Mail show as a flag. It is a server-side flag, so
   * toggling it here shows up on every other client of the account.
   */
  isFlagged: boolean
  hasAttachments: boolean
  size: number
  /**
   * Display name of the first sender, falling back to its address. Stored
   * denormalised so the database can order and group on it directly
   * instead of sorting the raw serialized address JSON — which would file
   * every nameless sender in its own block.
   */
  senderName: string
  /** Lowercased address of the first sender. The grouping key. */
  senderKey: string
  /**
   * The name the message is filed under when the list is sorted or grouped
   * by sender, and the one its row shows: the header's display name, or —
   * when the header carries only an address — the latest name that address
   * used in any other message, so a bare "cristian.sangiorgi@…" files with
   * "Cristian Sangiorgi". The address itself only when no name is known.
   */
  senderLabel: string
}

export interface MailMessageDetail extends MailMessageSummary {
  bcc: MailAddress[]
  html?: string
  text?: string
  attachments: MailAttachment[]
}

/**
 * A message as the engine reads it off the server, before the database has
 * filed it. The sender label is not in it: it depends on every message
 * stored for the address, so only the database can work it out.
 */
export type FetchedMessageSummary = Omit<MailMessageSummary, 'senderLabel'>
export type FetchedMessageDetail = Omit<MailMessageDetail, 'senderLabel'>

export type MessageListSortField = 'date' | 'sender' | 'subject' | 'size'
export type MessageListSortDirection = 'asc' | 'desc'

export interface MailMessageListSort {
  field: MessageListSortField
  direction: MessageListSortDirection
}

/**
 * How the list breaks its rows into labelled sections.
 *   • 'none'   — one flat run.
 *   • 'auto'   — sections follow the sort, like Outlook's "Mostra in
 *                gruppi": Oggi / Ieri / week / month buckets while ordered
 *                by date, one section per sender while ordered by sender,
 *                a flat run under subject or size.
 *   • 'sender' — one section per sender under any sort. The database
 *                orders by sender first so each section is a single
 *                contiguous run, and the active sort still decides the
 *                order *inside* it.
 */
export type MessageGroupingMode = 'none' | 'auto' | 'sender'

/**
 * Transient view filter above the list — the "Tutto / Non letti" tabs every
 * mail client puts there, plus the flagged view that gives the
 * `\\Flagged` keyword somewhere to lead.
 *
 * Deliberately not persisted: a filter that survives a restart is how people
 * end up convinced their mail has disappeared.
 */
export type MessageListFilter = 'all' | 'unread' | 'flagged'

export const DEFAULT_MESSAGE_LIST_FILTER: MessageListFilter = 'all'

/**
 * The two shells the workspace can wear. Both share the same palette,
 * spacing scale and components — they differ in how the three panes are
 * arranged and how dense the rows are.
 *   • 'apple'   — folders / list / reading pane side by side, list rendered
 *                 as compact multi-line rows.
 *   • 'outlook' — folders on the left, a dense single-line table on top and
 *                 the reading pane underneath it.
 */
export type MailLayoutMode = 'apple' | 'outlook'

/** "Sistema" follows the operating system; "Chiaro" and "Scuro" stay put. */
export type ThemeMode = 'system' | 'light' | 'dark'
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

export const DEFAULT_MESSAGE_LIST_SORT_FIELD: MessageListSortField = 'date'
export const DEFAULT_MESSAGE_LIST_SORT_DIRECTION: MessageListSortDirection = 'desc'

/**
 * The direction a field starts in when the user switches to it: newest and
 * largest first, names alphabetically. Carrying the previous field's
 * direction over turned "Data, più recenti prima" into "Mittente Z → A".
 */
export function defaultSortDirection(field: MessageListSortField): MessageListSortDirection {
  return field === 'date' || field === 'size' ? 'desc' : 'asc'
}
export const DEFAULT_MESSAGE_GROUPING_MODE: MessageGroupingMode = 'auto'
export const DEFAULT_MAIL_LAYOUT_MODE: MailLayoutMode = 'apple'

/**
 * Every persisted view preference in one payload. Kept as a single record
 * (rather than a channel per toggle) so adding the next one costs nothing
 * and the renderer only has one thing to load and one thing to save.
 */
export interface UiPreferences {
  themeMode: ThemeMode
  layoutMode: MailLayoutMode
  /**
   * Renders the list upside-down: same order, but the newest row sits at
   * the visual bottom and the viewport starts anchored there. A pure
   * presentation flip — `messageListSort` is untouched.
   */
  invertMessageListOrder: boolean
  messageListSort: MailMessageListSort
  messageGrouping: MessageGroupingMode
  /**
   * How large message bodies are shown in the reading pane, in percent —
   * the Ctrl/⌘ + wheel zoom Outlook and Mail offer. It scales the message
   * only, never the app around it, and applies to every message.
   */
  readerZoom: number
}

/** What the application menu asks the page to do. */
export type AppMenuCommand =
  | 'compose'
  | 'settings'
  | 'reader-zoom-in'
  | 'reader-zoom-out'
  | 'reader-zoom-reset'

export const READER_ZOOM_MIN = 50
export const READER_ZOOM_MAX = 200
export const READER_ZOOM_DEFAULT = 100

export function clampReaderZoom(value: number): number {
  return Math.min(READER_ZOOM_MAX, Math.max(READER_ZOOM_MIN, Math.round(value)))
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  themeMode: DEFAULT_THEME_MODE,
  layoutMode: DEFAULT_MAIL_LAYOUT_MODE,
  invertMessageListOrder: false,
  messageListSort: {
    field: DEFAULT_MESSAGE_LIST_SORT_FIELD,
    direction: DEFAULT_MESSAGE_LIST_SORT_DIRECTION
  },
  messageGrouping: DEFAULT_MESSAGE_GROUPING_MODE,
  readerZoom: READER_ZOOM_DEFAULT
}

export interface ListMessagesOptions {
  limit?: number
  query?: string
  sort?: MailMessageListSort
  /**
   * When 'sender', the query orders by sender before applying `sort`, so
   * the renderer can slice the page into contiguous per-sender sections.
   */
  grouping?: MessageGroupingMode
  filter?: MessageListFilter
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

export interface ToggleFlaggedInput extends MessageRef {
  flagged: boolean
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

export interface AttachmentRef {
  ref: MessageRef
  attachmentId: string
}

/** Attachments of one message, by their id in `MailMessageDetail.attachments`. */
export interface MessageAttachmentsRef {
  ref: MessageRef
  attachmentIds: string[]
}

/** A copy of a message's attachment, ready to go out with another message. */
export interface CopiedAttachment extends PickedAttachment {
  attachmentId: string
}

/**
 * How opening an attachment went. `blocked` is a type that runs code: it
 * is never launched from a message, only saved on purpose. `no-application`
 * means nothing on this computer opens that type.
 */
export type OpenAttachmentResult =
  | { status: 'opened' }
  | { status: 'blocked' }
  | { status: 'no-application' }

export interface SavedAttachments {
  directory: string
  filePaths: string[]
}

/** A file the "Allega" menu offers back. */
export interface RecentFile {
  path: string
  name: string
  /** The folder it sits in — what tells two files with one name apart. */
  folder: string
  /** What the user last did with it: "Allegato a un messaggio", "Aperto di recente"… */
  activity: string
  usedAt: number
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
  /** `files`: copies of opened attachments, on disk beside the database. */
  kind: 'account' | 'global' | 'files'
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

/**
 * Where an account's link to its server stands:
 *   • 'connecting'   — first contact since the app started.
 *   • 'connected'    — both IMAP links are up; changes arrive in real time.
 *   • 'reconnecting' — an established link dropped and is being rebuilt.
 *   • 'offline'      — the computer has no network; retries wait for it.
 *   • 'error'        — the server could not be reached, or refused the
 *                      login. Retries go on by themselves, backing off.
 *   • 'disconnected' — the account's engine is stopped.
 */
export type AccountConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'error'
  | 'disconnected'

export interface AccountConnectionState {
  accountId: string
  status: AccountConnectionStatus
  /** True while a folder is downloading its mail for the first time. */
  syncing: boolean
  /** Why the last attempt failed; set with 'error'. */
  errorMessage?: string
  /** The server turned the credentials down: retrying cannot fix it. */
  authFailed?: boolean
  /** The last moment the server answered, as epoch milliseconds. */
  lastContactAt?: number
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
