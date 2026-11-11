import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import extensionMain from '@app/extension/main'
import { ensureAiSchema } from '@main/ai/schema'
import { prismaSql } from '@main/ai/sql'
import { diagnostics } from '@main/diagnostics/log'
import { sanitizeShortcutOverrides } from '@shared/commands'
import { upgradeMailFontStacksInHtml } from '@shared/mail-fonts'
import type {
  DraftAttachment,
  DraftContent,
  DraftKind,
  FetchedMessageDetail,
  FetchedMessageSummary,
  MailAccount,
  MailAddress,
  MailAttachment,
  MailAccountSignature,
  MailContactSuggestion,
  MailFolder,
  MailMessageDetail,
  MailLayoutMode,
  MailMessageListSort,
  MailMessageSummary,
  MessageGroupingMode,
  MessageListFilter,
  MessageListSortDirection,
  MessageListSortField,
  MessageRef,
  PecDetail,
  PecKind,
  PecReceipt,
  ThemeMode,
  UiPreferences
} from '@shared/models'
import {
  clampReaderZoom,
  DEFAULT_MAIL_LAYOUT_MODE,
  DEFAULT_MESSAGE_GROUPING_MODE,
  DEFAULT_MESSAGE_LIST_SORT_DIRECTION,
  DEFAULT_MESSAGE_LIST_SORT_FIELD,
  DEFAULT_THEME_MODE,
  DEFAULT_UI_PREFERENCES,
  NEW_EVENT_MINUTES,
  NEW_EVENT_MINUTES_DEFAULT,
  READER_ZOOM_DEFAULT
} from '@shared/models'
import { addressKey, isValidEmailAddress } from '@shared/email-address'
import { notificationPreferencesOf, type NotificationPreferences } from '@shared/notifications'
import { folderForRole, folderRole, type FolderRole } from '@shared/folders'
import {
  foldSearchText,
  parseSearchQuery,
  type SearchTerm,
  type SearchTermGroup
} from '@shared/search'
import {
  cleanDisplayName,
  isMeaningfulDisplayName,
  isSameSenderName,
  senderSortKey
} from '@shared/sender'
import { SIGNATURE_HTML_FORMAT, upgradeLegacySignatureHtml } from '@shared/signature-html'
import type { MarkedBefore, MessageMark } from '@shared/message-marks'
import { subjectSortKey } from '@shared/subject'

import { rankContactSuggestions, type ContactCandidate } from './contact-ranking'
import { fullTextMatchExpression, numberWords, queryNumbers } from './full-text-query'
import { isPecServer } from './mail-discovery'
import {
  forgetLeftKeysStatement,
  keyHoldersQuery,
  keysHeldStatement,
  keysLeftStatement,
  MESSAGE_ID_KEYS_SCHEMA,
  rememberKeysStatement
} from './mail-engine/message-id-keys'
import {
  identityLookups,
  isMessageIdKey,
  settleNewcomers,
  type IdentityClaim,
  type StoredIdentity
} from './mail-engine/message-identity'
import { isPecReceipt } from './mail-engine/pec'
import { plainTextOfHtml } from './mail-engine/preview'
import type { UnreadableMessage } from './mail-engine/unreadable-messages'
import {
  unreadConversationsQuery,
  unreadMessagesOf,
  type ReadFolders,
  type UnreadMessage
} from './mail-engine/unread-conversations'

const log = diagnostics('app')

/**
 * SQLite hands INTEGER columns back as `bigint` or `number` depending on
 * adapter quirks; normalise both shapes to the boolean the UI expects.
 */
function toBooleanFlag(value: unknown): boolean {
  if (typeof value === 'bigint') {
    return value !== 0n
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'boolean') {
    return value
  }
  return false
}

/**
 * Narrows a persisted string back to its union type. A value written by a
 * newer build, or corrupted by hand, resolves to the default rather than
 * leaking an invalid enum into the renderer.
 */
function pickFromAllowedValues<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T
): T {
  return typeof value === 'string' && (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback
}

const MAIL_LAYOUT_MODES: ReadonlyArray<MailLayoutMode> = ['apple', 'outlook']
const MESSAGE_LIST_SORT_FIELDS: ReadonlyArray<MessageListSortField> = [
  'date',
  'sender',
  'subject',
  'size'
]
const MESSAGE_LIST_SORT_DIRECTIONS: ReadonlyArray<MessageListSortDirection> = ['asc', 'desc']
const MESSAGE_GROUPING_MODES: ReadonlyArray<MessageGroupingMode> = ['none', 'auto', 'sender']
const THEME_MODES: ReadonlyArray<ThemeMode> = ['system', 'light', 'dark']

export interface StoredMailAccount extends MailAccount {
  encryptedSecret: string
}

/** What a message list shows of its mailboxes, and in which order. */
export interface MessageListView {
  query?: string
  sort?: MailMessageListSort
  grouping?: MessageGroupingMode
  filter?: MessageListFilter
  /** Messages a server search found for `query`, matches like the cache's own. */
  serverMatches?: ReadonlyArray<MessageRef>
  /** The only messages the list may hold: a list of the Segretario's (a view, a project, a search). */
  onlyRefs?: ReadonlyArray<MessageRef>
  /** For the `active` filter: the messages with something open or a reply waiting, by key. */
  activeKeys?: ReadonlyArray<{ accountId: string; messageKey: string }>
}

export interface FolderSyncState {
  uidValidity?: bigint
  highestModseq?: bigint
  lastKnownUid?: number
  /** The server's UIDNEXT when the folder was last synced: a higher one means mail came in. */
  uidNext?: number
  lastSyncedAt?: number
}

/**
 * What the server has of a folder that its cache leaves out on purpose,
 * under the folder's UIDVALIDITY (`left_out_messages`).
 */
export interface LeftOutMessages {
  /**
   * Messages this app flagged \Deleted there that wait for an expunge (see
   * `expungeOnly`): not another program's, and not mail to fetch again.
   */
  deleted: number[]
  /** Messages the server would not give (see `UnreadableMessage`). */
  unreadable: UnreadableMessage[]
}

interface CreateAccountInput {
  id: string
  type: MailAccount['type']
  email: string
  displayName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  authType: MailAccount['authType']
  encryptedSecret: string
}

interface FolderPersistenceInput extends MailFolder {}

const APP_PREFERENCES_SINGLETON_ID = 1
/** Contacts the suggestions weigh for one query: the most written to among those matching. */
const CONTACT_SUGGESTION_SCAN_LIMIT = 400
/** Learned contacts wait this long to be written together. */
const CONTACT_LEARN_DELAY_MS = 150
/** A sent folder's new messages are counted once its sync has settled. */
const SENT_RECOUNT_DELAY_MS = 3_000
const CONTACT_WRITE_BATCH_SIZE = 500
const CONTACT_REBUILD_PAGE_SIZE = 2_000
/**
 * Past this many matching senders a search is not looking for one of them
 * ("gmail", "com"), and the list keeps its plain order.
 */
const SEARCHED_SENDER_LIMIT = 200
const RECENT_FILES_KEPT = 200
/** The folders kept per account as recent destinations of "Sposta". */
const RECENT_FOLDERS_KEPT = 8
/**
 * Messages, keys or refs one statement names: a selection of thousands
 * would otherwise pass SQLite's limit on bound values.
 */
const IDENTITY_LOOKUP_CHUNK = 500

function chunkOf<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

/** A JSON object stored as text, or an empty one when it is not one. */
function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function normalizeAccountIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedIds = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)

  return Array.from(new Set(normalizedIds))
}

function toNumber(value: bigint | number): number {
  return Number(value)
}

function toBigIntStringOrNull(value: bigint | undefined): string | null {
  return typeof value === 'bigint' ? value.toString() : null
}

function fromBigIntString(value: string | null | undefined): bigint | undefined {
  if (!value) {
    return undefined
  }

  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

function toFiniteNonNegativeNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  return 0
}

/**
 * The columns a list row is made of. Lists read only these: a row's cached
 * body can weigh hundreds of kilobytes, and a page of a hundred rows read
 * them all for nothing.
 */
const MESSAGE_SUMMARY_SELECT = {
  accountId: true,
  folderPath: true,
  uid: true,
  messageKey: true,
  threadId: true,
  messageId: true,
  subject: true,
  fromJson: true,
  toJson: true,
  ccJson: true,
  dateIso: true,
  preview: true,
  previewHydrated: true,
  flagsJson: true,
  isRead: true,
  isFlagged: true,
  senderName: true,
  senderKey: true,
  senderLabel: true,
  hasAttachments: true,
  size: true,
  pecKind: true,
  pecRef: true
} as const satisfies Prisma.MessageSelect

/** Rows re-filed for search per transaction (see `refreshSearchText`). */
const SEARCH_REFRESH_PAGE_SIZE = 1_000

function addressesSearchText(addresses: ReadonlyArray<MailAddress>): string {
  return foldSearchText(
    addresses.map((address) => `${address.name ?? ''} ${address.address}`).join(' ')
  )
}

/**
 * What searches compare a message by, field by field, folded the way the
 * search terms are (see `foldSearchText`): "citta" finds "Città", a name
 * finds the people it names and not the JSON the addresses are stored as,
 * a word finds the text of a body and not its HTML tags. The sender is also
 * found by the name the list files them under, which can come from another
 * of their messages.
 */
function messageSearchText(message: {
  subject: string
  from: ReadonlyArray<MailAddress>
  to: ReadonlyArray<MailAddress>
  cc: ReadonlyArray<MailAddress>
  bcc?: ReadonlyArray<MailAddress>
  senderLabel: string
  preview: string
}): { searchFrom: string; searchTo: string; searchSubject: string; searchPreview: string } {
  return {
    searchFrom: `${foldSearchText(message.senderLabel)} ${addressesSearchText(message.from)}`,
    searchTo: addressesSearchText([...message.to, ...message.cc, ...(message.bcc ?? [])]),
    searchSubject: foldSearchText(message.subject),
    searchPreview: foldSearchText(message.preview)
  }
}

/**
 * What the reader needs of a body before it shows it: below this level a
 * stored body is the text the indexer downloaded, without the pictures its
 * HTML draws.
 */
export const READABLE_BODY_LEVEL = 2

/** A body as the engine hands it over to be kept. */
export type StoredBodyInput = Pick<
  FetchedMessageDetail,
  | 'html'
  | 'text'
  | 'from'
  | 'bcc'
  | 'replyTo'
  | 'references'
  | 'attachments'
  | 'preview'
  | 'pecDetail'
>

/** People as the index reads them: names and addresses, the list's own name for the sender. */
function indexedAddresses(addresses: ReadonlyArray<MailAddress>, label?: string): string {
  return [label, ...addresses.map((address) => `${address.name ?? ''} ${address.address}`)]
    .filter(Boolean)
    .join(' ')
}

/**
 * The words of a body as the index reads them — its text, not its markup —
 * and the names of the files it carries, so a search for "preventivo"
 * finds the message that attaches preventivo.pdf.
 */
function indexedBodyText(body: StoredBodyInput): string {
  const text = body.text?.trim() ? body.text : body.html ? plainTextOfHtml(body.html) : ''
  const files = body.attachments.map((attachment) => attachment.fileName).join(' ')
  return files ? `${text}\n${files}` : text
}

function normalizeMessageSearchQuery(query?: string): string | null {
  const normalized = (query || '').trim()
  return normalized ? normalized : null
}

/**
 * Builds the per-term WHERE clause. An unscoped term matches against every
 * indexable field; a scoped one is confined to the fields its prefix names,
 * which is what stops `da:rossi` from also matching people cc'd on a
 * thread or a name that merely appears in a signature block.
 */
function buildSingleTermWhere(term: SearchTerm): Prisma.MessageWhereInput {
  const value = term.value

  switch (term.scope) {
    case 'from':
      return { searchFrom: { contains: value } }
    case 'to':
      return { searchTo: { contains: value } }
    case 'subject':
      return { searchSubject: { contains: value } }
    case 'any':
    default:
      return {
        OR: [
          { searchSubject: { contains: value } },
          { searchFrom: { contains: value } },
          { searchTo: { contains: value } },
          { searchPreview: { contains: value } }
        ]
      }
  }
}

function buildGroupWhere(group: SearchTermGroup): Prisma.MessageWhereInput | null {
  const termClauses = group.terms.map((term) => buildSingleTermWhere(term))

  if (termClauses.length === 0) {
    return null
  }

  if (termClauses.length === 1) {
    return termClauses[0]
  }

  return { OR: termClauses }
}

/**
 * Translates the shared search grammar into a Prisma WHERE. The grammar
 * is parsed once (in `parseSearchQuery`) so this and the renderer
 * highlighter always agree on what counts as a match:
 *   • multiple groups → AND
 *   • multiple terms inside a group → OR
 *   • each term → contains-match across the envelope's fields
 * A message also matches when the full-text index found the whole query in
 * it (`indexHitsToken`, see `AppDatabase.indexHitsToken`) — its body, files
 * and people included — or when the server's own search did.
 *
 * Returns null when the input has no usable terms — callers treat that
 * as "no filter" and read the folder in full.
 */
function buildMessageConstraints(
  query?: string,
  filter?: MessageListFilter,
  serverMatches: ReadonlyArray<MessageRef> = [],
  indexHitsToken: string | null = null
): Prisma.MessageWhereInput[] {
  const constraints: Prisma.MessageWhereInput[] = []
  const searchWhere = buildMessageSearchWhere(query)
  const filterWhere = buildMessageFilterWhere(filter)

  if (searchWhere) {
    const alternatives = [
      ...(indexHitsToken ? [{ searchHits: { some: { token: indexHitsToken } } }] : []),
      ...buildServerMatchesWhere(serverMatches)
    ]

    constraints.push(alternatives.length > 0 ? { OR: [searchWhere, ...alternatives] } : searchWhere)
  }

  if (filterWhere) {
    constraints.push(filterWhere)
  }

  return constraints
}

/** Messages by key, account by account. */
function buildMessageKeysWhere(
  keys: ReadonlyArray<{ accountId: string; messageKey: string }>
): Prisma.MessageWhereInput[] {
  const byAccount = new Map<string, string[]>()

  for (const key of keys) {
    byAccount.set(key.accountId, [...(byAccount.get(key.accountId) ?? []), key.messageKey])
  }

  return [...byAccount].map(([accountId, messageKeys]) => ({
    accountId,
    messageKey: { in: messageKeys }
  }))
}

/** Messages a server search found, folder by folder. */
function buildServerMatchesWhere(matches: ReadonlyArray<MessageRef>): Prisma.MessageWhereInput[] {
  const uidsByMailbox = new Map<string, { accountId: string; folderPath: string; uids: number[] }>()

  for (const match of matches) {
    const key = `${match.accountId}\u0000${match.folderPath}`
    const mailbox = uidsByMailbox.get(key) ?? {
      accountId: match.accountId,
      folderPath: match.folderPath,
      uids: []
    }
    mailbox.uids.push(match.uid)
    uidsByMailbox.set(key, mailbox)
  }

  return [...uidsByMailbox.values()].map(({ accountId, folderPath, uids }) => ({
    accountId,
    folderPath,
    uid: { in: uids }
  }))
}

export function buildMessageSearchWhere(query?: string): Prisma.MessageWhereInput | null {
  const normalizedQuery = normalizeMessageSearchQuery(query)

  if (!normalizedQuery) {
    return null
  }

  const parsed = parseSearchQuery(normalizedQuery)
  const groupClauses = parsed.groups
    .map((group) => buildGroupWhere(group))
    .filter((clause): clause is Prisma.MessageWhereInput => clause !== null)

  if (groupClauses.length === 0) {
    return null
  }

  if (groupClauses.length === 1) {
    return groupClauses[0]
  }

  return { AND: groupClauses }
}

/**
 * Narrows the page to unread or flagged messages. Both columns are indexed
 * per (account, folder), so the filter costs an index seek rather than a
 * scan even on a mailbox with thousands of rows.
 */
function buildMessageFilterWhere(filter?: MessageListFilter): Prisma.MessageWhereInput | null {
  switch (filter) {
    case 'unread':
      return { isRead: false }
    case 'flagged':
      return { isFlagged: true }
    default:
      return null
  }
}

/**
 * The user's sort choice as a Prisma `orderBy`. Every clause ends with a
 * `uid` tiebreaker so rows with equal keys keep a stable order between
 * queries — otherwise the list flickers while incremental sync lands.
 * Sender and subject order on denormalised keys (`sender_sort`,
 * `subject_sort`) that fold case, accents and reply prefixes away; the raw
 * columns sort by bytes, which puts every capital before every lower-case
 * letter.
 */
function buildMessageOrderBy(
  sort?: MailMessageListSort,
  grouping?: MessageGroupingMode
): Prisma.MessageOrderByWithRelationInput[] {
  const direction: Prisma.SortOrder = sort?.direction === 'asc' ? 'asc' : 'desc'

  const withinGroup: Prisma.MessageOrderByWithRelationInput[] = (() => {
    switch (sort?.field) {
      case 'subject':
        return [{ subjectSort: direction }, { dateIso: 'desc' }, { uid: 'desc' }]
      case 'sender':
        // Senders by the name they are filed under, case and accents folded
        // away; inside each, newest first. A bare "cristian.valenti@…"
        // files under the name that address last used, so it sorts with
        // "Cristian Valenti" — and the several addresses a company
        // writes from under one name are one sender, as the user reads them.
        return [{ senderSort: direction }, { dateIso: 'desc' }, { uid: 'desc' }]
      case 'size':
        return [{ size: direction }, { dateIso: direction }, { uid: direction }]
      case 'date':
      default:
        return [{ dateIso: direction }, { uid: direction }]
    }
  })()

  // Sender grouping needs each sender's messages to arrive as one
  // contiguous run, so the sender leads the ORDER BY and the user's chosen
  // sort decides the order *inside* each section. Date grouping needs no
  // help: it buckets an already date-ordered page.
  if (grouping === 'sender' && sort?.field !== 'sender') {
    return [{ senderSort: 'asc' }, ...withinGroup]
  }

  return withinGroup
}

/**
 * Whether the list is being read sender by sender — sorted by sender, or
 * grouped by it — which is when a search should bring the senders it names
 * to the top.
 */
function ordersBySender(sort?: MailMessageListSort, grouping?: MessageGroupingMode): boolean {
  return sort?.field === 'sender' || grouping === 'sender'
}

/**
 * Rows whose From line matches the search. Typing "valenti" finds every
 * message that mentions Valenti — as sender, in copy, in a signature — and
 * when the list is then read sender by sender, the messages *from* that
 * person are the ones being looked for, so they lead (see
 * `findSearchedSenders`). Field-scoped terms other than `da:` never name a
 * sender.
 */
function buildSenderMatchWhere(query?: string): Prisma.MessageWhereInput | null {
  const normalizedQuery = normalizeMessageSearchQuery(query)

  if (!normalizedQuery) {
    return null
  }

  const senderTerms = parseSearchQuery(normalizedQuery).terms.filter(
    (term) => term.scope === 'any' || term.scope === 'from'
  )

  if (senderTerms.length === 0) {
    return null
  }

  return { OR: senderTerms.map((term) => ({ searchFrom: { contains: term.value } })) }
}

/**
 * A certified envelope fetched again, with the sender its body named
 * (`storeMessageBodies`) — the envelope itself names only the address the
 * provider certified.
 */
function withCarriedSender(
  message: FetchedMessageSummary,
  storedFromJson: string | undefined
): FetchedMessageSummary {
  const stored = storedFromJson ? parseJsonArray<MailAddress>(storedFromJson)[0] : undefined

  return message.pec &&
    !isPecReceipt(message.pec.kind) &&
    stored?.name &&
    stored.address.toLowerCase() === message.from[0]?.address.toLowerCase()
    ? { ...message, from: [stored], senderName: stored.name }
    : message
}

/** The name a message's own header gives its sender, when it gives a real one. */
function headerSenderName(message: FetchedMessageSummary): string | undefined {
  const first = message.from[0]
  return first && isMeaningfulDisplayName(first.name, first.address)
    ? first.name?.trim()
    : undefined
}

/**
 * How rows are filed for sorting and grouping (`resolveSenderLabels`,
 * `senderSortKey`, `subjectSortKey`). Bumping it re-files the rows a
 * database already holds on the next start:
 *   1 — one sender's spellings of a name share a label;
 *   2 — subjects sort by their first letter or digit, those without one first.
 */
const SORT_FILING_VERSION = 3

/**
 * The shape of the cache (see `resetCacheIfOutdated`). Bump it when what a
 * cached row holds changes in a way the rows already stored cannot follow:
 *   1 — up to 1.10, bodies kept with each row;
 *   2 — 2.0: stable message keys and threads, one body per message, the
 *       full-text index;
 *   3 — 2.0: who holds each key made of a Message-ID, by what every copy
 *       of the message says alike (`message_id_keys`), which the rows
 *       stored before did not keep;
 *   4 — 2.0: certified mail (PEC) read for what it is — what each message
 *       is (`pec_kind`, `pec_ref`), an envelope listed as the message it
 *       carries, its certification beside its body (`pec_json`) — which
 *       the rows stored before were not.
 */
export const CACHE_SCHEMA_VERSION = 4

/** The cache's tables, dependants first. */
const CACHE_TABLES_IN_DROP_ORDER = [
  'search_hits',
  'message_fts_vocab',
  'message_fts',
  'message_bodies',
  'messages',
  'left_out_messages',
  'folders'
] as const

/** Searches whose index matches are kept, for the list, its count and its scroll to agree. */
const CACHED_INDEX_SEARCHES = 4

interface MarkRow {
  extension: string
  account_id: string
  message_key: string
  label: string
  place: string
  files_json: string
  marked_at: bigint | number
}

function markOf(row: MarkRow): MessageMark {
  return {
    accountId: row.account_id,
    messageKey: row.message_key,
    extension: row.extension,
    label: row.label,
    place: row.place === '' ? null : row.place,
    files: JSON.parse(row.files_json) as string[],
    markedAt: Number(row.marked_at)
  }
}

interface StoredSignatureRow {
  accountId: string
  html: string
  format: bigint | number
  updatedAt: bigint
}

interface SenderLabelUse {
  label: string
  count: number
  date: string
}

/** Most messages first, then the most recent. */
function compareLabelUses(left: SenderLabelUse, right: SenderLabelUse): number {
  return right.count - left.count || (right.date > left.date ? 1 : right.date < left.date ? -1 : 0)
}

function dominantLabelUse(uses: ReadonlyArray<SenderLabelUse>): SenderLabelUse | undefined {
  return [...uses].sort(compareLabelUses)[0]
}

function latestLabelUse(uses: ReadonlyArray<SenderLabelUse>): SenderLabelUse | undefined {
  return uses.reduce<SenderLabelUse | undefined>(
    (latest, use) => (!latest || use.date > latest.date ? use : latest),
    undefined
  )
}

/** The stored notification preferences; what is missing or unreadable takes its default. */
function parseNotificationPreferences(value: string | null | undefined): NotificationPreferences {
  try {
    return notificationPreferencesOf(JSON.parse(value ?? '{}'))
  } catch {
    // A value no release wrote: the defaults stand in for it.
    return notificationPreferencesOf({})
  }
}

/** A draft as the app keeps it: its content, and where its server copy is. */
export interface StoredDraftRecord {
  content: DraftContent
  revision: number
  serverRevision: number
  server: { accountId: string; folderPath: string; uid: number | null } | null
  serverSavedAt: number | null
  docked: boolean
}

function mapDraftRow(row: {
  id: string
  accountId: string
  kind: string
  sourceAccountId: string | null
  toJson: string
  ccJson: string
  bccJson: string
  subject: string
  html: string
  inReplyTo: string | null
  referencesJson: string
  originalJson: string | null
  attachmentsJson: string
  revision: number
  serverRevision: number
  serverAccountId: string | null
  serverFolder: string | null
  serverUid: number | null
  serverSavedAt: bigint | null
  docked: boolean
}): StoredDraftRecord {
  const kind: DraftKind = row.kind === 'reply' || row.kind === 'forward' ? row.kind : 'new'
  let original: DraftContent['original']

  try {
    original = row.originalJson
      ? (JSON.parse(row.originalJson) as DraftContent['original'])
      : undefined
  } catch {
    // A value no release wrote: the draft is kept without it.
    original = undefined
  }

  return {
    content: {
      id: row.id,
      kind,
      accountId: row.accountId,
      sourceAccountId: row.sourceAccountId ?? undefined,
      to: parseJsonArray<MailAddress>(row.toJson),
      cc: parseJsonArray<MailAddress>(row.ccJson),
      bcc: parseJsonArray<MailAddress>(row.bccJson),
      subject: row.subject,
      html: row.html,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseJsonArray<string>(row.referencesJson),
      original,
      attachments: parseJsonArray<DraftAttachment>(row.attachmentsJson)
    },
    revision: row.revision,
    serverRevision: row.serverRevision,
    server:
      row.serverAccountId && row.serverFolder
        ? { accountId: row.serverAccountId, folderPath: row.serverFolder, uid: row.serverUid }
        : null,
    serverSavedAt: row.serverSavedAt === null ? null : toNumber(row.serverSavedAt),
    docked: row.docked
  }
}

/** Someone stored mail names, to learn as a contact (`AppDatabase.learnContacts`). */
export interface LearnedContact {
  address: string
  name?: string
  /** When they wrote to the user: the date of a message they sent. */
  receivedAt?: number
}

/** A contact ready to be written: its address checked, its name cleaned. */
interface ContactEntry extends LearnedContact {
  key: string
}

/** Folders whose people are not learned: drafts hold addresses half typed, spam strangers. */
const UNLEARNED_FOLDER_ROLES: ReadonlySet<FolderRole | null> = new Set(['\\Drafts', '\\Junk'])

/** The contact `address` stands for, or null when mail cannot be addressed to it. */
function contactEntry(address: MailAddress, receivedAt?: number): ContactEntry | null {
  const trimmed = address.address.trim()

  if (!isValidEmailAddress(trimmed)) {
    return null
  }

  const name = cleanDisplayName(address.name)

  return {
    key: addressKey(trimmed),
    address: trimmed,
    name: isMeaningfulDisplayName(name, trimmed) ? name : undefined,
    receivedAt
  }
}

/**
 * The people a stored message names: who sent it — but the user, in a
 * sent folder — with its date, and whoever it went to.
 */
function contactsOfMessage(
  message: Pick<FetchedMessageSummary, 'from' | 'to' | 'cc' | 'date'>,
  role: FolderRole | null
): ContactEntry[] {
  if (UNLEARNED_FOLDER_ROLES.has(role)) {
    return []
  }

  const date = Date.parse(message.date)
  const senders = role === '\\Sent' ? [] : message.from
  const sent = Number.isFinite(date) && date > 0 ? date : undefined

  return [
    ...senders.map((address) => contactEntry(address, sent)),
    ...message.to.map((address) => contactEntry(address)),
    ...message.cc.map((address) => contactEntry(address))
  ].filter((entry): entry is ContactEntry => entry !== null)
}

/**
 * One entry for what two say of the same address: the latest date it wrote
 * on, and the name it gave then — or the name already known.
 */
function mergeContactEntries(known: ContactEntry, next: ContactEntry): ContactEntry {
  const newer = (next.receivedAt ?? 0) > (known.receivedAt ?? 0)

  return {
    key: known.key,
    address: known.address,
    name: (newer && next.name) || known.name || next.name,
    receivedAt: newer ? next.receivedAt : known.receivedAt
  }
}

/** `entries` with each address once. */
function collapseContactEntries(entries: Iterable<ContactEntry>): Map<string, ContactEntry> {
  const byKey = new Map<string, ContactEntry>()

  for (const entry of entries) {
    const known = byKey.get(entry.key)
    byKey.set(entry.key, known ? mergeContactEntries(known, entry) : entry)
  }

  return byKey
}

function folderPriority(folder: Pick<MailFolder, 'specialUse'>): number {
  if (folder.specialUse === '\\Inbox') {
    return 0
  }

  if (folder.specialUse === '\\Sent') {
    return 1
  }

  if (folder.specialUse === '\\Drafts') {
    return 2
  }

  if (folder.specialUse === '\\Trash') {
    return 3
  }

  if (folder.specialUse === '\\Junk') {
    return 4
  }

  if (folder.specialUse === '\\Archive') {
    return 5
  }

  return 6
}

function toSqliteUrl(filePath: string): string {
  return `file:${resolve(filePath)}`
}

function mapFolderRow(row: {
  id: string
  accountId: string
  path: string
  name: string
  delimiter: string | null
  specialUse: string | null
  messageCount: number
  unseenCount: number
  lastSyncedAt: bigint | null
}): MailFolder {
  return {
    id: row.id,
    accountId: row.accountId,
    path: row.path,
    name: row.name,
    delimiter: row.delimiter ?? undefined,
    specialUse: row.specialUse ?? undefined,
    messageCount: row.messageCount,
    unseenCount: row.unseenCount,
    lastSyncedAt: row.lastSyncedAt ? toNumber(row.lastSyncedAt) : undefined
  }
}

export class AppDatabase {
  private readonly prisma: PrismaClient
  private readonly ready: Promise<void>
  private readonly queuedContacts = new Map<string, ContactEntry>()
  private contactFlushTimer: ReturnType<typeof setTimeout> | null = null
  private contactFlush: Promise<void> | null = null
  private sentRecountTimer: ReturnType<typeof setTimeout> | null = null
  private sentRecount: Promise<void> = Promise.resolve()
  /** Set when the contacts table predates what it now counts: `initialize` rebuilds it. */
  private contactsOutdated = false
  /**
   * Moves on whenever what the full-text index can match changes — a body
   * stored, a row added or gone — so a search's kept matches are made again.
   */
  private indexGeneration = 0
  /** The words of the index each number searched is written in, while the index stays as it was. */
  private readonly numberWordsCache = new Map<string, { generation: number; words: string[] }>()
  /** The tokens of the last searches' index matches (see `indexHitsToken`), oldest first. */
  private readonly indexSearches = new Map<string, { token: string; generation: number }>()

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true })

    const adapter = new PrismaBetterSqlite3({
      url: toSqliteUrl(filePath)
    })

    this.prisma = new PrismaClient({ adapter })
    this.ready = this.initialize()
  }

  /**
   * Resolves once the schema has been created and reconciled. Callers that
   * need to touch the file directly (the upgrade migration) await this
   * before doing so, so they never race the initial DDL.
   */
  async waitUntilReady(): Promise<void> {
    await this.ready
  }

  /**
   * Raw SQL escape hatch for extensions. The extension owns the schema
   * for its own tables; the host's only job is to share the SQLite
   * connection so the writes participate in the same WAL.
   */
  async runRawSql(sql: string, params: unknown[] = []): Promise<void> {
    await this.ready
    await this.prisma.$executeRawUnsafe(sql, ...params)
  }

  async runRawSqlQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ready
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...params)
  }

  /**
   * What the storage holds of each mailbox, in numbers, for the diagnostics
   * (vision §14.4): folders and when they were last synced, messages, those
   * whose words are indexed, drafts, the outbox, the marks, what the server
   * would not give.
   */
  async mailFigures(): Promise<
    Map<
      string,
      {
        folders: number
        foldersNeverSynced: number
        lastSyncedAt: number | null
        messages: number
        indexed: number
        drafts: number
        outbox: number
        marks: number
        leftOut: number
      }
    >
  > {
    await this.ready

    const rows = await this.prisma.$queryRaw<
      Array<Record<string, number | bigint | string | null>>
    >`
      SELECT a.id AS accountId,
        (SELECT COUNT(*) FROM folders f WHERE f.account_id = a.id) AS folders,
        (SELECT COUNT(*) FROM folders f WHERE f.account_id = a.id AND f.last_synced_at IS NULL)
          AS foldersNeverSynced,
        (SELECT MAX(f.last_synced_at) FROM folders f WHERE f.account_id = a.id) AS lastSyncedAt,
        (SELECT COUNT(*) FROM messages m WHERE m.account_id = a.id) AS messages,
        (SELECT COUNT(*) FROM message_bodies b WHERE b.account_id = a.id) AS indexed,
        (SELECT COUNT(*) FROM drafts d WHERE d.account_id = a.id) AS drafts,
        (SELECT COUNT(*) FROM outbox o WHERE o.account_id = a.id) AS outbox,
        (SELECT COUNT(*) FROM message_marks k WHERE k.account_id = a.id) AS marks,
        (SELECT COUNT(*) FROM left_out_messages l WHERE l.account_id = a.id) AS leftOut
      FROM accounts a
    `
    const count = (value: number | bigint | string | null): number => Number(value ?? 0)

    return new Map(
      rows.map((row) => [
        String(row.accountId),
        {
          folders: count(row.folders),
          foldersNeverSynced: count(row.foldersNeverSynced),
          lastSyncedAt: row.lastSyncedAt === null ? null : count(row.lastSyncedAt),
          messages: count(row.messages),
          indexed: count(row.indexed),
          drafts: count(row.drafts),
          outbox: count(row.outbox),
          marks: count(row.marks),
          leftOut: count(row.leftOut)
        }
      ])
    )
  }

  async getAccounts(): Promise<MailAccount[]> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT
        id,
        type,
        email,
        display_name AS displayName,
        imap_host AS imapHost,
        imap_port AS imapPort,
        imap_secure AS imapSecure,
        smtp_host AS smtpHost,
        smtp_port AS smtpPort,
        smtp_secure AS smtpSecure,
        username,
        auth_type AS authType,
        created_at AS createdAt,
        updated_at AS updatedAt,
        EXISTS (
          SELECT 1 FROM messages m WHERE m.account_id = accounts.id AND m.pec_kind IS NOT NULL
        ) AS hasPecMail
      FROM accounts
      ORDER BY
        CASE WHEN last_viewed_at IS NULL THEN 1 ELSE 0 END ASC,
        last_viewed_at DESC,
        created_at ASC
    `) as Array<{
      id: string
      type: string
      email: string
      displayName: string
      imapHost: string
      imapPort: number
      imapSecure: boolean
      smtpHost: string
      smtpPort: number
      smtpSecure: boolean
      username: string
      authType: string
      createdAt: bigint
      updatedAt: bigint
      hasPecMail: number | bigint
    }>

    return rows.map((row) => this.mapAccountRow(row))
  }

  async listAccountSignatures(): Promise<MailAccountSignature[]> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT account_id AS accountId, html AS html, html_format AS format, updated_at AS updatedAt
      FROM account_signatures
      ORDER BY updated_at DESC
    `) as StoredSignatureRow[]

    return Promise.all(
      rows
        .filter((row) => typeof row.accountId === 'string' && typeof row.html === 'string')
        .map(async (row) => ({
          accountId: row.accountId,
          html: await this.withUpgradedSignature(row),
          updatedAt: toNumber(row.updatedAt)
        }))
    )
  }

  async getAccountSignature(accountId: string): Promise<MailAccountSignature | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT account_id AS accountId, html AS html, html_format AS format, updated_at AS updatedAt
      FROM account_signatures
      WHERE account_id = ${accountId}
      LIMIT 1
    `) as StoredSignatureRow[]
    const row = rows[0]

    if (!row || typeof row.accountId !== 'string' || typeof row.html !== 'string') {
      return null
    }

    return {
      accountId: row.accountId,
      html: await this.withUpgradedSignature(row),
      updatedAt: toNumber(row.updatedAt)
    }
  }

  /**
   * Brings a stored signature up to date on read, and writes the result back
   * so the Firme editor shows the HTML the recipient will get:
   *
   *   • signatures from before the font fallback chains carry a face
   *     followed by a bare generic, and lose their identity wherever it is
   *     not installed — they get the full chain;
   *   • signatures from before format 2 relied on the old editor's page for
   *     their compact spacing — it is written onto them (see
   *     `upgradeLegacySignatureHtml`).
   *
   * Failing to persist is not worth surfacing: the upgraded HTML is already
   * being returned, and the next read tries again.
   */
  private async withUpgradedSignature(row: StoredSignatureRow): Promise<string> {
    const format = toNumber(row.format)
    const fontUpgraded = upgradeMailFontStacksInHtml(row.html)
    const upgraded =
      format < SIGNATURE_HTML_FORMAT ? upgradeLegacySignatureHtml(fontUpgraded) : fontUpgraded

    if (upgraded === row.html && format >= SIGNATURE_HTML_FORMAT) {
      return row.html
    }

    try {
      await this.prisma.$executeRaw`
        UPDATE account_signatures
        SET html = ${upgraded}, html_format = ${SIGNATURE_HTML_FORMAT}
        WHERE account_id = ${row.accountId}
      `
    } catch (error) {
      log.warn('signature.not-upgraded', { err: error })
    }

    return upgraded
  }

  async setAccountSignature(
    accountId: string,
    html: string | null
  ): Promise<MailAccountSignature | null> {
    await this.ready

    const now = BigInt(Date.now())
    // Upgraded on the way in as well, so a signature pasted from an older
    // message is stored with the chains rather than waiting for a read.
    const persistedHtml = upgradeMailFontStacksInHtml(html ?? '')

    await this.prisma.$executeRaw`
      INSERT INTO account_signatures(account_id, html, html_format, updated_at)
      VALUES (${accountId}, ${persistedHtml}, ${SIGNATURE_HTML_FORMAT}, ${now})
      ON CONFLICT(account_id) DO UPDATE SET
        html = excluded.html,
        html_format = excluded.html_format,
        updated_at = excluded.updated_at
    `

    if (!persistedHtml) {
      return null
    }

    return {
      accountId,
      html: persistedHtml,
      updatedAt: toNumber(now)
    }
  }

  async clearAccountData(accountId: string): Promise<void> {
    await this.ready

    // The cache only: the mail comes back from the server, a signature
    // would not.
    await this.prisma.$transaction([
      this.prisma.message.deleteMany({
        where: {
          accountId
        }
      }),
      this.prisma.messageBody.deleteMany({
        where: {
          accountId
        }
      }),
      this.prisma.folder.deleteMany({
        where: {
          accountId
        }
      }),
      this.prisma.$executeRaw`DELETE FROM left_out_messages WHERE account_id = ${accountId}`
    ])
    this.indexGeneration += 1
    // Who holds each Message-ID's key is not the cache: the mail downloaded
    // again takes its keys back.
    await this.markKeysLeft(accountId, null)

    await this.compact()
  }

  /**
   * The file rewritten without what was deleted: SQLite keeps a deleted
   * row's pages as free pages, its bytes still in the file, until VACUUM
   * rewrites it — what the user had removed would still take the disk, and
   * still be there to read. With the WAL the rewritten file lands in the
   * log first: the checkpoint after it is what shrinks the file itself.
   */
  async compact(): Promise<void> {
    await this.ready
    await this.prisma.$executeRawUnsafe('VACUUM')
    await this.prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  async clearAllDataKeepAccounts(): Promise<void> {
    await this.ready
    const now = BigInt(Date.now())

    await this.prisma.$transaction([
      this.prisma.message.deleteMany(),
      this.prisma.messageBody.deleteMany(),
      this.prisma.folder.deleteMany(),
      this.prisma.$executeRaw`DELETE FROM left_out_messages`,
      // What the Segretario names goes with it (see `AiStore.clearData`).
      this.prisma.$executeRaw`DELETE FROM message_id_keys`,
      this.prisma.contact.deleteMany(),
      this.prisma.recentFile.deleteMany(),
      this.prisma.recentFolder.deleteMany(),
      this.prisma.$executeRaw`DELETE FROM message_marks`,
      this.prisma.draft.deleteMany(),
      this.prisma.$executeRaw`DELETE FROM outbox`,
      this.prisma.$executeRaw`DELETE FROM account_signatures`,
      // Reset the singleton row of app preferences (unified inbox toggle)
      // back to its empty state; how the app looks stays as chosen.
      // Extensions own their own tables and clear them in their
      // `clearData`, which the service calls right after this.
      this.prisma.$executeRaw`
        UPDATE app_preferences
        SET unified_inbox_included_account_ids = NULL,
            updated_at = ${now}
        WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
      `
    ])

    await this.compact()
  }

  /**
   * Keeps a draft as it is now, as one more save of it — the next the
   * server is to get — open in the composer.
   */
  async saveDraft(content: DraftContent): Promise<StoredDraftRecord> {
    await this.ready

    const now = BigInt(Date.now())
    const fields = {
      accountId: content.accountId,
      kind: content.kind,
      sourceAccountId: content.sourceAccountId ?? null,
      toJson: JSON.stringify(content.to),
      ccJson: JSON.stringify(content.cc),
      bccJson: JSON.stringify(content.bcc),
      subject: content.subject,
      html: content.html,
      inReplyTo: content.inReplyTo ?? null,
      referencesJson: JSON.stringify(content.references ?? []),
      originalJson: content.original ? JSON.stringify(content.original) : null,
      attachmentsJson: JSON.stringify(content.attachments),
      docked: true,
      updatedAt: now
    }
    const row = await this.prisma.draft.upsert({
      where: { id: content.id },
      create: { id: content.id, ...fields, revision: 1, createdAt: now },
      update: { ...fields, revision: { increment: 1 } }
    })

    return mapDraftRow(row)
  }

  /**
   * A draft as the server has it, taken as the one the app keeps — opened
   * from Bozze — with the copy it came from as its own.
   */
  async adoptServerDraft(
    content: DraftContent,
    server: { accountId: string; folderPath: string; uid: number }
  ): Promise<StoredDraftRecord> {
    await this.ready

    const now = BigInt(Date.now())
    const fields = {
      accountId: content.accountId,
      kind: content.kind,
      sourceAccountId: content.sourceAccountId ?? null,
      toJson: JSON.stringify(content.to),
      ccJson: JSON.stringify(content.cc),
      bccJson: JSON.stringify(content.bcc),
      subject: content.subject,
      html: content.html,
      inReplyTo: content.inReplyTo ?? null,
      referencesJson: JSON.stringify(content.references ?? []),
      originalJson: content.original ? JSON.stringify(content.original) : null,
      attachmentsJson: JSON.stringify(content.attachments),
      revision: 1,
      serverRevision: 1,
      serverAccountId: server.accountId,
      serverFolder: server.folderPath,
      serverUid: server.uid,
      serverSavedAt: now,
      docked: true,
      updatedAt: now
    }
    const row = await this.prisma.draft.upsert({
      where: { id: content.id },
      create: { id: content.id, ...fields, createdAt: now },
      update: fields
    })

    return mapDraftRow(row)
  }

  async getDraft(id: string): Promise<StoredDraftRecord | null> {
    await this.ready

    const row = await this.prisma.draft.findUnique({ where: { id } })
    return row ? mapDraftRow(row) : null
  }

  /** The drafts of an account that answer a message, by its Message-ID. */
  async draftIdsReplyingTo(accountId: string, messageId: string): Promise<string[]> {
    await this.ready

    const rows = await this.prisma.draft.findMany({
      where: { accountId, inReplyTo: messageId },
      select: { id: true },
      orderBy: { createdAt: 'desc' }
    })
    return rows.map((row) => row.id)
  }

  /** The draft whose server copy is `uid` of `folderPath`, if the app keeps it. */
  async findDraftByServerCopy(
    accountId: string,
    folderPath: string,
    uid: number
  ): Promise<StoredDraftRecord | null> {
    await this.ready

    const row = await this.prisma.draft.findFirst({
      where: { serverAccountId: accountId, serverFolder: folderPath, serverUid: uid }
    })
    return row ? mapDraftRow(row) : null
  }

  /** The drafts to reopen at launch: left open, or not on the server as they are. */
  async listDockedDrafts(): Promise<StoredDraftRecord[]> {
    await this.ready

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM drafts WHERE docked = 1 OR revision > server_revision ORDER BY created_at
    `
    const drafts = await this.prisma.draft.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      orderBy: { createdAt: 'asc' }
    })

    return drafts.map(mapDraftRow)
  }

  /** The drafts whose latest save the server does not have yet. */
  async listUnfiledDraftIds(): Promise<string[]> {
    await this.ready

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM drafts WHERE revision > server_revision
    `
    return rows.map((row) => row.id)
  }

  /** The server has `revision` of the draft, as `uid` of `folderPath` (null: not known). */
  async markDraftFiled(
    id: string,
    filed: { revision: number; accountId: string; folderPath: string; uid: number | null }
  ): Promise<StoredDraftRecord | null> {
    await this.ready

    const now = BigInt(Date.now())
    await this.prisma.draft.updateMany({
      where: { id },
      data: {
        serverRevision: filed.revision,
        serverAccountId: filed.accountId,
        serverFolder: filed.folderPath,
        serverUid: filed.uid,
        serverSavedAt: now
      }
    })

    return this.getDraft(id)
  }

  async setDraftDocked(id: string, docked: boolean): Promise<void> {
    await this.ready
    await this.prisma.draft.updateMany({ where: { id }, data: { docked } })
  }

  async deleteDraft(id: string): Promise<void> {
    await this.ready
    await this.prisma.draft.deleteMany({ where: { id } })
  }

  /** A folder messages were just moved to, first among the account's recent destinations. */
  async recordRecentFolder(accountId: string, folderPath: string): Promise<void> {
    await this.ready

    const usedAt = BigInt(Date.now())

    await this.prisma.$transaction([
      this.prisma.recentFolder.upsert({
        where: { accountId_folderPath: { accountId, folderPath } },
        create: { accountId, folderPath, usedAt },
        update: { usedAt }
      }),
      this.prisma.$executeRaw`
        DELETE FROM recent_folders
        WHERE account_id = ${accountId}
          AND folder_path NOT IN (
            SELECT folder_path FROM recent_folders
            WHERE account_id = ${accountId}
            ORDER BY used_at DESC
            LIMIT ${RECENT_FOLDERS_KEPT}
          )
      `
    ])
  }

  /** An account's recent destinations of "Sposta", the latest first, among its folders now. */
  async listRecentFolders(accountId: string): Promise<string[]> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT recent.folder_path AS folderPath
      FROM recent_folders recent
      JOIN folders folder ON folder.account_id = recent.account_id AND folder.path = recent.folder_path
      WHERE recent.account_id = ${accountId}
      ORDER BY recent.used_at DESC
    `) as Array<{ folderPath: string }>

    return rows.map((row) => row.folderPath)
  }

  /**
   * Remembers files the user just attached, saved or filed away, as the
   * newest entries of the "Allega" menu. The history stays short: it is a
   * convenience, not a record.
   */
  async recordRecentFiles(paths: ReadonlyArray<string>, activity: string): Promise<void> {
    await this.ready

    if (paths.length === 0) {
      return
    }

    const usedAt = BigInt(Date.now())

    await this.prisma.$transaction([
      ...paths.map((path) =>
        this.prisma.recentFile.upsert({
          where: { path },
          create: { path, activity, usedAt },
          update: { activity, usedAt }
        })
      ),
      this.prisma.$executeRaw`
        DELETE FROM recent_files
        WHERE path NOT IN (
          SELECT path FROM recent_files ORDER BY used_at DESC LIMIT ${RECENT_FILES_KEPT}
        )
      `
    ])
  }

  /** The recent files under a folder that moved, kept where they are now (`moved`). */
  async relocateRecentFiles(moved: (path: string) => string | null): Promise<void> {
    await this.ready
    const rows = await this.prisma.recentFile.findMany()
    const writes = rows.flatMap((row) => {
      const path = moved(row.path)
      return path === null
        ? []
        : [
            this.prisma.recentFile.delete({ where: { path: row.path } }),
            this.prisma.recentFile.upsert({
              where: { path },
              create: { path, activity: row.activity, usedAt: row.usedAt },
              update: {}
            })
          ]
    })

    if (writes.length > 0) {
      await this.prisma.$transaction(writes)
    }
  }

  /**
   * Marks an extension leaves on messages (`MessageMark`): one per message
   * and place — marking the same message at the same place again is the
   * same mark, with what it says now.
   */
  async recordMarks(
    marks: ReadonlyArray<
      Omit<MessageMark, 'markedAt'> & { threadId: string; fromAddress: string | null }
    >
  ): Promise<void> {
    await this.ready
    const now = BigInt(Date.now())

    await this.prisma.$transaction(
      marks.map(
        (mark) => this.prisma.$executeRaw`
          INSERT INTO message_marks (
            extension, account_id, message_key, thread_id, from_address, label, place, files_json,
            marked_at
          ) VALUES (
            ${mark.extension}, ${mark.accountId}, ${mark.messageKey}, ${mark.threadId},
            ${mark.fromAddress?.toLowerCase() ?? null}, ${mark.label}, ${mark.place ?? ''},
            ${JSON.stringify(mark.files)}, ${now}
          )
          ON CONFLICT(extension, account_id, message_key, place) DO UPDATE SET
            label = excluded.label, files_json = excluded.files_json,
            thread_id = excluded.thread_id, marked_at = excluded.marked_at
        `
      )
    )
  }

  /** The marks on these messages of an account, the newest first. */
  async marksOf(accountId: string, messageKeys: ReadonlyArray<string>): Promise<MessageMark[]> {
    await this.ready

    if (messageKeys.length === 0) {
      return []
    }

    const rows = await this.prisma.$queryRaw<MarkRow[]>`
      SELECT * FROM message_marks
      WHERE account_id = ${accountId} AND message_key IN (${Prisma.join([...messageKeys])})
      ORDER BY marked_at DESC
    `
    return rows.map(markOf)
  }

  /**
   * Where earlier mail of these conversations was last marked with a place —
   * or, when none was, mail of these senders: the place, and which.
   */
  async markedBefore(
    threads: ReadonlyArray<{ accountId: string; threadId: string }>,
    senders: ReadonlyArray<string>
  ): Promise<MarkedBefore | null> {
    await this.ready

    if (threads.length > 0) {
      const [ofConversation] = await this.prisma.$queryRaw<Array<{ place: string }>>`
        SELECT place FROM message_marks
        WHERE place <> '' AND (${Prisma.join(
          threads.map(
            (thread) =>
              Prisma.sql`(account_id = ${thread.accountId} AND thread_id = ${thread.threadId})`
          ),
          ' OR '
        )})
        ORDER BY marked_at DESC LIMIT 1
      `

      if (ofConversation) {
        return { place: ofConversation.place, from: 'conversazione' }
      }
    }

    if (senders.length === 0) {
      return null
    }

    const [ofSender] = await this.prisma.$queryRaw<Array<{ place: string }>>`
      SELECT place FROM message_marks
      WHERE place <> '' AND from_address IN (${Prisma.join(senders.map((sender) => sender.toLowerCase()))})
      ORDER BY marked_at DESC LIMIT 1
    `
    return ofSender ? { place: ofSender.place, from: 'mittente' } : null
  }

  /** The latest marks an extension left, the newest first: what the user has been doing with it. */
  async recentMarks(extension: string, limit: number): Promise<MessageMark[]> {
    await this.ready
    const rows = await this.prisma.$queryRaw<MarkRow[]>`
      SELECT * FROM message_marks WHERE extension = ${extension}
      ORDER BY marked_at DESC LIMIT ${limit}
    `
    return rows.map(markOf)
  }

  /** The marks whose place is under a folder that moved, kept where it is now (`moved`); how many. */
  async relocateMarks(moved: (path: string) => string | null): Promise<number> {
    await this.ready
    const rows = await this.prisma.$queryRaw<
      MarkRow[]
    >`SELECT * FROM message_marks WHERE place <> ''`
    const writes = rows.flatMap((row) => {
      const place = moved(row.place)

      if (place === null) {
        return []
      }

      const files = (JSON.parse(row.files_json) as string[]).map((file) => moved(file) ?? file)
      return [
        this.prisma.$executeRaw`
          UPDATE OR REPLACE message_marks SET place = ${place}, files_json = ${JSON.stringify(files)}
          WHERE extension = ${row.extension} AND account_id = ${row.account_id}
            AND message_key = ${row.message_key} AND place = ${row.place}
        `
      ]
    })

    if (writes.length > 0) {
      await this.prisma.$transaction(writes)
    }

    return writes.length
  }

  async listRecentFiles(
    limit: number
  ): Promise<Array<{ path: string; activity: string; usedAt: number }>> {
    await this.ready

    const rows = await this.prisma.recentFile.findMany({
      orderBy: { usedAt: 'desc' },
      take: limit
    })

    return rows.map((row) => ({
      path: row.path,
      activity: row.activity,
      usedAt: toNumber(row.usedAt)
    }))
  }

  async getStoredAccountById(accountId: string): Promise<StoredMailAccount | null> {
    await this.ready

    const row = await this.prisma.account.findUnique({
      where: {
        id: accountId
      }
    })

    if (!row) {
      return null
    }

    return {
      ...this.mapAccountRow(row),
      encryptedSecret: row.encryptedSecret
    }
  }

  /** A message waiting to go: sent while its server could not be reached. */
  async queueOutgoing(entry: {
    id: string
    accountId: string
    draftId: string | null
    payload: unknown
  }): Promise<void> {
    await this.ready
    await this.prisma.$executeRaw`
      INSERT INTO outbox (id, account_id, draft_id, payload_json, queued_at)
      VALUES (${entry.id}, ${entry.accountId}, ${entry.draftId}, ${JSON.stringify(entry.payload)}, ${Date.now()})
    `
  }

  /** The messages waiting to go, the oldest first. */
  async listOutgoing(): Promise<
    Array<{
      id: string
      accountId: string
      draftId: string | null
      payload: unknown
      queuedAt: number
    }>
  > {
    await this.ready
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string
        account_id: string
        draft_id: string | null
        payload_json: string
        queued_at: number | bigint
      }>
    >`SELECT id, account_id, draft_id, payload_json, queued_at FROM outbox ORDER BY queued_at`
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      draftId: row.draft_id,
      payload: JSON.parse(row.payload_json) as unknown,
      queuedAt: Number(row.queued_at)
    }))
  }

  /**
   * A message no longer waiting — gone, given up, or taken back by its draft:
   * sent by hand, opened to change. How many left the outbox.
   */
  async removeOutgoing(where: { id: string } | { draftId: string }): Promise<number> {
    await this.ready
    return 'id' in where
      ? this.prisma.$executeRaw`DELETE FROM outbox WHERE id = ${where.id}`
      : this.prisma.$executeRaw`DELETE FROM outbox WHERE draft_id = ${where.draftId}`
  }

  /** The account's access, renewed (a provider that rotates its tokens): kept encrypted as it comes. */
  async setAccountSecret(accountId: string, encryptedSecret: string): Promise<void> {
    await this.ready
    await this.prisma.account.updateMany({ where: { id: accountId }, data: { encryptedSecret } })
  }

  /**
   * A new account starts with the first account's signature — in whatever
   * format it is stored, so a legacy one still gets upgraded on read — or,
   * for the very first account, the extension's default.
   */
  private async getDefaultSignatureForNewAccount(
    tx: Prisma.TransactionClient
  ): Promise<{ html: string; format: number }> {
    const existingAccounts = (await tx.$queryRaw`
      SELECT id AS id
      FROM accounts
      ORDER BY created_at ASC
      LIMIT 1
    `) as Array<{ id: string }>
    const firstAccountId = existingAccounts[0]?.id

    if (typeof firstAccountId === 'string' && firstAccountId) {
      const signatureRows = (await tx.$queryRaw`
        SELECT html AS html, html_format AS format
        FROM account_signatures
        WHERE account_id = ${firstAccountId}
        LIMIT 1
      `) as Array<Pick<StoredSignatureRow, 'html' | 'format'>>
      const row = signatureRows[0]

      return typeof row?.html === 'string'
        ? { html: row.html, format: toNumber(row.format) }
        : { html: '', format: SIGNATURE_HTML_FORMAT }
    }

    return { html: extensionMain.defaultAccountSignatureHtml, format: SIGNATURE_HTML_FORMAT }
  }

  async createAccount(input: CreateAccountInput): Promise<MailAccount> {
    await this.ready

    const now = BigInt(Date.now())

    const created = await this.prisma.$transaction(async (tx) => {
      const defaultSignature = await this.getDefaultSignatureForNewAccount(tx)
      const account = await tx.account.create({
        data: {
          id: input.id,
          type: input.type,
          email: input.email,
          displayName: input.displayName,
          imapHost: input.imapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
          smtpHost: input.smtpHost,
          smtpPort: input.smtpPort,
          smtpSecure: input.smtpSecure,
          username: input.username,
          authType: input.authType,
          encryptedSecret: input.encryptedSecret,
          createdAt: now,
          updatedAt: now
        }
      })

      await tx.$executeRaw`
        INSERT INTO account_signatures(account_id, html, html_format, updated_at)
        VALUES (${account.id}, ${defaultSignature.html}, ${defaultSignature.format}, ${now})
        ON CONFLICT(account_id) DO NOTHING
      `

      return account
    })

    return this.mapAccountRow(created)
  }

  async markAccountLastViewed(accountId: string, lastViewedAt = Date.now()): Promise<void> {
    await this.ready

    await this.prisma.$executeRaw`
      UPDATE accounts
      SET last_viewed_at = ${lastViewedAt}
      WHERE id = ${accountId}
    `
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.ready

    await this.prisma.account.deleteMany({
      where: {
        id: accountId
      }
    })
  }

  /**
   * Stores an account's folder list as the server gave it, with the counts
   * its STATUS reported. A folder read before keeps the message count its
   * cache was last brought in line with: compared with the server's at the
   * next review, it is how a change is noticed — taken from STATUS here, a
   * change still to sync looked done after the app quit before syncing it.
   */
  async replaceFolders(accountId: string, folders: FolderPersistenceInput[]): Promise<void> {
    await this.ready

    const now = BigInt(Date.now())
    const folderPaths = folders.map((folder) => folder.path)

    const removedRows = await this.prisma.$transaction(async (tx) => {
      if (folderPaths.length === 0) {
        await tx.folder.deleteMany({
          where: {
            accountId
          }
        })
        return 0
      }

      const synced = new Set(
        (
          await tx.folder.findMany({
            where: { accountId, lastSyncedAt: { not: null } },
            select: { path: true }
          })
        ).map((folder) => folder.path)
      )

      await Promise.all(
        folders.map(async (folder) => {
          await tx.folder.upsert({
            where: {
              accountId_path: {
                accountId,
                path: folder.path
              }
            },
            create: {
              id: folder.id,
              accountId,
              path: folder.path,
              name: folder.name,
              delimiter: folder.delimiter ?? null,
              specialUse: folder.specialUse ?? null,
              messageCount: folder.messageCount,
              unseenCount: folder.unseenCount,
              lastSyncedAt: folder.lastSyncedAt ? BigInt(folder.lastSyncedAt) : null,
              updatedAt: now
            },
            update: {
              id: folder.id,
              name: folder.name,
              delimiter: folder.delimiter ?? null,
              specialUse: folder.specialUse ?? null,
              ...(synced.has(folder.path) ? {} : { messageCount: folder.messageCount }),
              unseenCount: folder.unseenCount,
              updatedAt: now
            }
          })
        })
      )

      await tx.folder.deleteMany({
        where: {
          accountId,
          path: {
            notIn: folderPaths
          }
        }
      })

      await tx.$executeRaw`
        DELETE FROM left_out_messages
        WHERE account_id = ${accountId} AND folder_path NOT IN (${Prisma.join(folderPaths)})
      `

      const removed = await tx.message.deleteMany({
        where: {
          accountId,
          folderPath: {
            notIn: folderPaths
          }
        }
      })

      return removed.count
    })

    if (removedRows > 0) {
      await this.markKeysLeft(accountId, null)
    }
  }

  async listFolders(accountId: string): Promise<MailFolder[]> {
    await this.ready

    const rows = await this.prisma.folder.findMany({
      where: {
        accountId
      }
    })

    return rows
      .map((row) => mapFolderRow(row))
      .sort((a, b) => {
        const priorityDiff = folderPriority(a) - folderPriority(b)

        if (priorityDiff !== 0) {
          return priorityDiff
        }

        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
  }

  async getFolder(accountId: string, folderPath: string): Promise<MailFolder | null> {
    await this.ready

    const row = await this.prisma.folder.findUnique({
      where: {
        accountId_path: {
          accountId,
          path: folderPath
        }
      }
    })

    return row ? mapFolderRow(row) : null
  }

  async getFolderSyncState(accountId: string, folderPath: string): Promise<FolderSyncState | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT uid_validity AS uidValidity, highest_modseq AS highestModseq, last_known_uid AS lastKnownUid, uid_next AS uidNext, last_synced_at AS lastSyncedAt
      FROM folders
      WHERE account_id = ${accountId} AND path = ${folderPath}
      LIMIT 1
    `) as Array<{
      uidValidity: string | null
      highestModseq: string | null
      lastKnownUid: number | null
      uidNext: number | null
      lastSyncedAt: bigint | null
    }>

    const row = rows[0]

    if (!row) {
      return null
    }

    return {
      uidValidity: fromBigIntString(row.uidValidity),
      highestModseq: fromBigIntString(row.highestModseq),
      lastKnownUid: row.lastKnownUid ?? undefined,
      uidNext: row.uidNext ?? undefined,
      lastSyncedAt: row.lastSyncedAt ? toNumber(row.lastSyncedAt) : undefined
    }
  }

  async updateFolderSyncState(
    accountId: string,
    folderPath: string,
    state: FolderSyncState
  ): Promise<void> {
    await this.ready

    const uidValidity = toBigIntStringOrNull(state.uidValidity)
    const highestModseq = toBigIntStringOrNull(state.highestModseq)
    const lastKnownUid = state.lastKnownUid ?? null
    const uidNext = state.uidNext ?? null
    const lastSyncedAt = typeof state.lastSyncedAt === 'number' ? BigInt(state.lastSyncedAt) : null
    const now = BigInt(Date.now())

    await this.prisma.$executeRaw`
      UPDATE folders
      SET uid_validity = COALESCE(${uidValidity}, uid_validity),
          highest_modseq = COALESCE(${highestModseq}, highest_modseq),
          last_known_uid = COALESCE(${lastKnownUid}, last_known_uid),
          uid_next = COALESCE(${uidNext}, uid_next),
          last_synced_at = COALESCE(${lastSyncedAt}, last_synced_at),
          updated_at = ${now}
      WHERE account_id = ${accountId} AND path = ${folderPath}
    `
  }

  async resetFolderSyncState(accountId: string, folderPath: string): Promise<void> {
    await this.ready

    const now = BigInt(Date.now())

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({
        where: { accountId, folderPath }
      }),
      this.prisma.$executeRaw`
        DELETE FROM left_out_messages WHERE account_id = ${accountId} AND folder_path = ${folderPath}
      `,
      this.prisma.$executeRaw`
        UPDATE folders
        SET uid_validity = NULL,
            highest_modseq = NULL,
            last_known_uid = NULL,
            uid_next = NULL,
            last_synced_at = NULL,
            updated_at = ${now}
        WHERE account_id = ${accountId} AND path = ${folderPath}
      `
    ])
    // The folder read anew gives its messages back their keys.
    await this.markKeysLeft(accountId, null)
  }

  /**
   * A folder found unchanged on the server: what is kept of it is current as of
   * `at`. What depends on a folder being read after something happened — a
   * message missing everywhere is gone, not moved — reads it from here.
   */
  async markFolderCurrent(accountId: string, folderPath: string, at: number): Promise<void> {
    await this.ready

    await this.prisma.folder.updateMany({
      where: { accountId, path: folderPath },
      data: { lastSyncedAt: BigInt(at) }
    })
  }

  async updateFolderCounts(
    accountId: string,
    folderPath: string,
    messageCount: number,
    unseenCount: number
  ): Promise<void> {
    await this.ready

    await this.prisma.folder.updateMany({
      where: {
        accountId,
        path: folderPath
      },
      data: {
        messageCount,
        unseenCount,
        updatedAt: BigInt(Date.now())
      }
    })
  }

  /**
   * Learns the people in `contacts` — the senders and recipients of stored
   * mail, the user's own accounts — a moment later and in one write: a
   * folder's first sync names thousands. A known contact keeps its counts,
   * takes the latest date it wrote on with the name it gave then, and
   * otherwise keeps the name it had.
   */
  learnContacts(contacts: ReadonlyArray<LearnedContact>): void {
    for (const contact of contacts) {
      const entry = contactEntry(contact, contact.receivedAt)
      const queued = entry && this.queuedContacts.get(entry.key)

      if (entry) {
        this.queuedContacts.set(entry.key, queued ? mergeContactEntries(queued, entry) : entry)
      }
    }

    if (this.queuedContacts.size === 0 || this.contactFlushTimer !== null) {
      return
    }

    this.contactFlushTimer = setTimeout(() => {
      this.contactFlushTimer = null
      void this.flushLearnedContacts()
    }, CONTACT_LEARN_DELAY_MS)
  }

  /**
   * Counts a message the user sent: each recipient written to once more,
   * now, under the name the message gave them — and back among the
   * suggestions, if it had been taken out.
   */
  async recordContactsWritten(recipients: ReadonlyArray<MailAddress>): Promise<void> {
    await this.ready

    const entries = collapseContactEntries(
      recipients.flatMap((recipient) => contactEntry(recipient) ?? [])
    )
    const now = BigInt(Date.now())

    if (entries.size === 0) {
      return
    }

    await this.prisma.$transaction(
      [...entries.values()].map(
        (entry) => this.prisma.$executeRaw`
          INSERT INTO contacts (
            email_normalized, email_address, display_name, name_normalized,
            usage_count, last_used_at, updated_at
          )
          VALUES (
            ${entry.key}, ${entry.address}, ${entry.name ?? null},
            ${entry.name ? foldSearchText(entry.name) : null}, 1, ${now}, ${now}
          )
          ON CONFLICT(email_normalized) DO UPDATE SET
            email_address = excluded.email_address,
            display_name = COALESCE(excluded.display_name, contacts.display_name),
            name_normalized = COALESCE(excluded.name_normalized, contacts.name_normalized),
            usage_count = contacts.usage_count + 1,
            last_used_at = excluded.last_used_at,
            hidden_at = NULL,
            updated_at = excluded.updated_at
        `
      )
    )
  }

  /** Takes an address out of the suggestions, until the user writes to it again. */
  async hideContact(address: string): Promise<void> {
    await this.ready

    const now = BigInt(Date.now())
    await this.prisma.contact.updateMany({
      where: { emailNormalized: addressKey(address) },
      data: { hiddenAt: now, updatedAt: now }
    })
  }

  async listContactSuggestions(query: string, limit: number): Promise<MailContactSuggestion[]> {
    await this.ready

    // The first word narrows the table down; the ranking weighs the rest.
    const [firstWord] = foldSearchText(query.trim()).split(/\s+/)

    if (!firstWord) {
      return []
    }

    const pattern = `%${firstWord}%`
    const rows = await this.prisma.$queryRaw<
      Array<{
        key: string
        address: string
        name: string | null
        usageCount: number | bigint
        lastUsedAt: number | bigint
        lastReceivedAt: number | bigint | null
      }>
    >`
      SELECT email_normalized AS key, email_address AS address, display_name AS name,
        usage_count AS usageCount, last_used_at AS lastUsedAt, last_received_at AS lastReceivedAt
      FROM contacts
      WHERE hidden_at IS NULL
        AND (email_normalized LIKE ${pattern} OR name_normalized LIKE ${pattern})
      ORDER BY usage_count DESC, MAX(last_used_at, COALESCE(last_received_at, 0)) DESC
      LIMIT ${CONTACT_SUGGESTION_SCAN_LIMIT}
    `

    return rankContactSuggestions(
      query,
      rows.map((row): ContactCandidate => ({
        key: row.key,
        address: row.address,
        name: row.name,
        usageCount: toNumber(row.usageCount),
        lastUsedAt: toNumber(row.lastUsedAt),
        lastReceivedAt: row.lastReceivedAt === null ? null : toNumber(row.lastReceivedAt)
      })),
      limit
    )
  }

  private async flushLearnedContacts(): Promise<void> {
    if (this.contactFlush) {
      await this.contactFlush
    }

    const flush = (async () => {
      while (this.queuedContacts.size > 0) {
        const batch = [...this.queuedContacts.values()]
        this.queuedContacts.clear()

        try {
          await this.writeLearnedContacts(batch)
        } catch (error) {
          // Back in the queue for the next flush, merged with what came since.
          for (const entry of batch) {
            const queued = this.queuedContacts.get(entry.key)
            this.queuedContacts.set(entry.key, queued ? mergeContactEntries(entry, queued) : entry)
          }

          log.error('Learning contacts failed', error, { pending: batch.length })
          return
        }
      }
    })()

    this.contactFlush = flush

    try {
      await flush
    } finally {
      if (this.contactFlush === flush) {
        this.contactFlush = null
      }
    }
  }

  private async writeLearnedContacts(entries: ReadonlyArray<ContactEntry>): Promise<void> {
    const now = BigInt(Date.now())

    for (let start = 0; start < entries.length; start += CONTACT_WRITE_BATCH_SIZE) {
      await this.prisma.$transaction(
        entries.slice(start, start + CONTACT_WRITE_BATCH_SIZE).map((entry) => {
          const receivedAt = entry.receivedAt === undefined ? null : BigInt(entry.receivedAt)
          const name = entry.name ?? null

          return this.prisma.$executeRaw`
            INSERT INTO contacts (
              email_normalized, email_address, display_name, name_normalized,
              usage_count, last_used_at, last_received_at, updated_at
            )
            VALUES (
              ${entry.key}, ${entry.address}, ${name}, ${name && foldSearchText(name)},
              0, 0, ${receivedAt}, ${now}
            )
            ON CONFLICT(email_normalized) DO UPDATE SET
              display_name = CASE
                WHEN excluded.display_name IS NOT NULL AND (
                  contacts.display_name IS NULL
                  OR excluded.last_received_at > COALESCE(contacts.last_received_at, 0)
                ) THEN excluded.display_name
                ELSE contacts.display_name
              END,
              name_normalized = CASE
                WHEN excluded.display_name IS NOT NULL AND (
                  contacts.display_name IS NULL
                  OR excluded.last_received_at > COALESCE(contacts.last_received_at, 0)
                ) THEN excluded.name_normalized
                ELSE contacts.name_normalized
              END,
              last_received_at = NULLIF(
                MAX(COALESCE(contacts.last_received_at, 0), COALESCE(excluded.last_received_at, 0)),
                0
              ),
              updated_at = excluded.updated_at
            WHERE (contacts.display_name IS NULL AND excluded.display_name IS NOT NULL)
              OR excluded.last_received_at > COALESCE(contacts.last_received_at, 0)
          `
        })
      )
    }
  }

  /**
   * Counts again, a moment after a sent folder took new messages, how
   * often the user wrote to each address (`recountContactsWritten`).
   */
  private scheduleSentRecount(): void {
    if (this.sentRecountTimer !== null) {
      clearTimeout(this.sentRecountTimer)
    }

    this.sentRecountTimer = setTimeout(() => {
      this.sentRecountTimer = null
      this.sentRecount = this.sentRecount
        .then(() => this.recountContactsWritten())
        .catch((error: unknown) => log.error('Counting sent mail failed', error))
    }, SENT_RECOUNT_DELAY_MS)
  }

  /**
   * How often the user wrote to each address, from the stored sent folders
   * of every account: the messages sent from any client and device, those
   * sent from here already counted at the time (`recordContactsWritten`).
   * A count only grows — mail deleted from "Posta inviata" was still
   * written — so counting twice, or a folder synced twice, changes nothing.
   */
  private async recountContactsWritten(): Promise<void> {
    const sentRole = '\\sent'
    const rows = await this.prisma.$queryRaw<
      Array<{ address: string; count: number | bigint; lastDate: string | null }>
    >`
      WITH sent AS (
        SELECT m.id AS id, m.date_iso AS date, m.to_json AS toJson, m.cc_json AS ccJson,
          m.bcc_json AS bccJson
        FROM messages m
        JOIN folders f ON f.account_id = m.account_id AND f.path = m.folder_path
        WHERE lower(f.special_use) = ${sentRole}
      ),
      recipients AS (
        SELECT sent.id AS id, sent.date AS date, json_extract(r.value, '$.address') AS address
        FROM sent, json_each(sent.toJson) r
        UNION ALL
        SELECT sent.id, sent.date, json_extract(r.value, '$.address') FROM sent, json_each(sent.ccJson) r
        UNION ALL
        SELECT sent.id, sent.date, json_extract(r.value, '$.address') FROM sent, json_each(sent.bccJson) r
      )
      SELECT MIN(trim(address)) AS address, COUNT(DISTINCT id) AS count, MAX(date) AS lastDate
      FROM recipients
      WHERE address IS NOT NULL AND trim(address) <> ''
      GROUP BY lower(trim(address))
    `

    if (rows.length === 0) {
      return
    }

    const stored = new Map(
      (
        await this.prisma.contact.findMany({
          select: { emailNormalized: true, usageCount: true, lastUsedAt: true }
        })
      ).map((contact) => [contact.emailNormalized, contact])
    )
    const now = BigInt(Date.now())
    const writes = rows.flatMap((row) => {
      const entry = contactEntry({ address: row.address })
      const count = toNumber(row.count)
      const lastDate = Date.parse(row.lastDate ?? '')
      const lastUsedAt = BigInt(Number.isFinite(lastDate) && lastDate > 0 ? lastDate : 0)
      const known = entry && stored.get(entry.key)

      if (!entry || (known && known.usageCount >= count && known.lastUsedAt >= lastUsedAt)) {
        return []
      }

      return [
        this.prisma.$executeRaw`
          INSERT INTO contacts (email_normalized, email_address, usage_count, last_used_at, updated_at)
          VALUES (${entry.key}, ${entry.address}, ${count}, ${lastUsedAt}, ${now})
          ON CONFLICT(email_normalized) DO UPDATE SET
            usage_count = MAX(contacts.usage_count, excluded.usage_count),
            last_used_at = MAX(contacts.last_used_at, excluded.last_used_at),
            updated_at = excluded.updated_at
        `
      ]
    })

    for (let start = 0; start < writes.length; start += CONTACT_WRITE_BATCH_SIZE) {
      await this.prisma.$transaction(writes.slice(start, start + CONTACT_WRITE_BATCH_SIZE))
    }
  }

  /**
   * The contacts learned afresh from every stored message, as sync learns
   * them, and the sent mail counted: once, when the table gains what it
   * counts now. What it held before counted nothing — every address once —
   * and kept names with their quotes and addresses no mail can reach.
   */
  private async rebuildContacts(): Promise<void> {
    const folders = await this.prisma.folder.findMany({
      select: { accountId: true, path: true, specialUse: true }
    })
    const roles = new Map(
      folders.map((folder) => [`${folder.accountId}\n${folder.path}`, folderRole(folder)])
    )
    const entries: ContactEntry[] = []
    let after = ''

    for (;;) {
      const page = await this.prisma.message.findMany({
        where: { id: { gt: after } },
        orderBy: { id: 'asc' },
        take: CONTACT_REBUILD_PAGE_SIZE,
        select: {
          id: true,
          accountId: true,
          folderPath: true,
          fromJson: true,
          toJson: true,
          ccJson: true,
          dateIso: true
        }
      })

      for (const message of page) {
        entries.push(
          ...contactsOfMessage(
            {
              from: parseJsonArray<MailAddress>(message.fromJson),
              to: parseJsonArray<MailAddress>(message.toJson),
              cc: parseJsonArray<MailAddress>(message.ccJson),
              date: message.dateIso
            },
            roles.get(`${message.accountId}\n${message.folderPath}`) ?? null
          )
        )
      }

      if (page.length < CONTACT_REBUILD_PAGE_SIZE) {
        break
      }

      after = page[page.length - 1].id
    }

    // The accounts' own addresses, which no message may name yet.
    const accounts = await this.prisma.account.findMany({
      select: { email: true, displayName: true }
    })

    await this.prisma.contact.deleteMany()
    await this.writeLearnedContacts([
      ...collapseContactEntries([
        ...accounts.flatMap(
          (account) => contactEntry({ address: account.email, name: account.displayName }) ?? []
        ),
        ...entries
      ]).values()
    ])
    await this.recountContactsWritten()
  }

  async getUnifiedInboxIncludedAccountIds(): Promise<string[] | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT unified_inbox_included_account_ids AS includedAccountIds
      FROM app_preferences
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
      LIMIT 1
    `) as Array<{ includedAccountIds?: unknown }>
    const row = rows[0]

    if (!row || typeof row.includedAccountIds !== 'string' || !row.includedAccountIds.trim()) {
      return null
    }

    try {
      const parsed = JSON.parse(row.includedAccountIds) as unknown
      return normalizeAccountIdList(parsed)
    } catch {
      return null
    }
  }

  async setUnifiedInboxIncludedAccountIds(accountIds: string[]): Promise<void> {
    await this.ready

    const normalizedIds = normalizeAccountIdList(accountIds)
    const now = Date.now()

    await this.prisma.$executeRaw`
      UPDATE app_preferences
      SET unified_inbox_included_account_ids = ${JSON.stringify(normalizedIds)},
          updated_at = ${now}
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
    `
  }

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    await this.ready

    const rows = await this.prisma.$queryRaw<Array<{ value: string | null }>>`
      SELECT notification_preferences AS value
      FROM app_preferences
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
      LIMIT 1
    `

    return parseNotificationPreferences(rows[0]?.value)
  }

  /** Once-only notifications of these kinds (by the start of their keys) may be given again. */
  async forgetNotificationsGiven(prefixes: ReadonlyArray<string>): Promise<void> {
    await this.ready

    for (const prefix of prefixes) {
      await this.prisma.$executeRaw`
        DELETE FROM notifications_given WHERE substr(key, 1, ${prefix.length}) = ${prefix}
      `
    }
  }

  /**
   * Whether a notification given once was given already; it is marked as
   * given if not. True the first time only.
   */
  async giveNotificationOnce(key: string): Promise<boolean> {
    await this.ready
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO notifications_given (key, at) VALUES (${key}, ${Date.now()})
      ON CONFLICT(key) DO NOTHING
    `
    return inserted === 1
  }

  async setNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
    await this.ready

    await this.prisma.$executeRaw`
      UPDATE app_preferences
      SET notification_preferences = ${JSON.stringify(preferences)},
          updated_at = ${Date.now()}
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
    `
  }

  /**
   * The key and conversation each message fetched from a folder is stored
   * under (see `settleIdentity`), in the order of `claims`: a row stored
   * already keeps its own; a new one is settled against what the account
   * knows — the rows it holds, and who holds each key made of a Message-ID
   * (`message_id_keys`), remembered while no row does — oldest first, so a
   * batch's replies find their parents in it, and two messages of one
   * batch sharing a Message-ID are told apart as two stored ones. The keys
   * made of a Message-ID settled here are remembered with their holder,
   * held once the rows are stored (`upsertMessageSummaries`).
   */
  async settleMessageIdentities(
    accountId: string,
    folderPath: string,
    claims: ReadonlyArray<IdentityClaim>
  ): Promise<Array<{ messageKey: string; threadId: string }>> {
    await this.ready

    const settled = new Map<number, { messageKey: string; threadId: string }>()

    for (const part of chunkOf(claims, IDENTITY_LOOKUP_CHUNK)) {
      const existing = await this.prisma.message.findMany({
        where: { accountId, folderPath, uid: { in: part.map((claim) => claim.uid) } },
        select: { uid: true, messageKey: true, threadId: true }
      })

      existing.forEach((row) =>
        settled.set(row.uid, { messageKey: row.messageKey, threadId: row.threadId })
      )
    }

    const newcomers = claims.filter((claim) => !settled.has(claim.uid))
    const lookups = identityLookups(newcomers)
    const stored: StoredIdentity[] = [
      ...(
        await Promise.all(
          chunkOf(
            lookups.filter((key) => !isMessageIdKey(key)),
            IDENTITY_LOOKUP_CHUNK
          ).map((part) =>
            this.prisma.message.findMany({
              where: { accountId, messageKey: { in: part } },
              select: { messageKey: true, threadId: true }
            })
          )
        )
      ).flat(),
      ...(
        await Promise.all(
          chunkOf(lookups.filter(isMessageIdKey), IDENTITY_LOOKUP_CHUNK).map((part) => {
            const query = keyHoldersQuery(accountId, part)
            return this.prisma.$queryRawUnsafe<Required<StoredIdentity>[]>(
              query.sql,
              ...query.params
            )
          })
        )
      ).flat()
    ]
    const digests = new Map(newcomers.map((claim) => [claim.uid, claim.digest]))
    const holders = new Map<string, Required<StoredIdentity>>()

    for (const [uid, identity] of settleNewcomers(newcomers, stored)) {
      settled.set(uid, identity)

      if (isMessageIdKey(identity.messageKey) && !holders.has(identity.messageKey)) {
        holders.set(identity.messageKey, { ...identity, digest: digests.get(uid)! })
      }
    }

    const at = Date.now()

    for (const part of chunkOf([...holders.values()], IDENTITY_LOOKUP_CHUNK)) {
      const statement = rememberKeysStatement(accountId, part, at)
      await this.prisma.$executeRawUnsafe(statement.sql, ...statement.params)
    }

    // Every claim is settled above: stored already, or a newcomer.
    return claims.map((claim) => settled.get(claim.uid)!)
  }

  /**
   * Stores the messages of a folder fetched from the server. A row stored
   * already takes everything new but its key and conversation, which are
   * settled once, when it is first stored (`settleMessageIdentities`):
   * what hangs off them stays where it is.
   */
  async upsertMessageSummaries(
    accountId: string,
    folderPath: string,
    messages: FetchedMessageSummary[]
  ): Promise<{
    added: MailMessageSummary[]
    updated: MailMessageSummary[]
    /** Rows of other folders moved into the conversation of a message added (`filePecConversations`). */
    adopted: MailMessageSummary[]
  }> {
    await this.ready

    const result = {
      added: [] as MailMessageSummary[],
      updated: [] as MailMessageSummary[],
      adopted: [] as MailMessageSummary[]
    }

    if (messages.length === 0) {
      return result
    }

    const uids = messages.map((message) => message.uid)
    const existingRows = await this.prisma.message.findMany({
      where: {
        accountId,
        folderPath,
        uid: { in: uids }
      },
      select: {
        uid: true,
        messageKey: true,
        threadId: true,
        messageId: true,
        subject: true,
        preview: true,
        previewHydrated: true,
        isRead: true,
        dateIso: true,
        fromJson: true,
        hasAttachments: true
      }
    })

    const existingByUid = new Map(existingRows.map((row) => [row.uid, row]))
    const folder = await this.prisma.folder.findUnique({
      where: { accountId_path: { accountId, path: folderPath } },
      select: { path: true, specialUse: true }
    })
    const role = folder ? folderRole(folder) : null
    const contacts: ContactEntry[] = []
    const now = BigInt(Date.now())
    // Fetched again, a certified envelope keeps the sender its body named; a receipt new here goes
    // with the message sent it is about.
    const pec = await this.filePecConversations(
      accountId,
      messages.filter((message) => !existingByUid.has(message.uid))
    )
    const rows = messages.map((fetched) => {
      const carried = withCarriedSender(fetched, existingByUid.get(fetched.uid)?.fromJson)
      const threadId = pec.receipts.get(fetched.uid)
      return threadId ? { ...carried, threadId } : carried
    })
    const senderLabels = await this.resolveSenderLabels(rows)

    await this.prisma.$transaction([
      ...rows.map((message) => {
        const existing = existingByUid.get(message.uid) || null
        const senderLabel = senderLabels.get(message) ?? message.senderName
        const senderSort = senderSortKey(senderLabel)
        const subjectSort = subjectSortKey(message.subject)

        contacts.push(...contactsOfMessage(message, role))

        const create = {
          id: this.makeMessagePrimaryId(accountId, folderPath, message.uid),
          accountId,
          folderPath,
          uid: message.uid,
          messageKey: message.messageKey,
          threadId: message.threadId,
          messageId: message.messageId ?? null,
          subject: message.subject,
          subjectSort,
          fromJson: JSON.stringify(message.from),
          toJson: JSON.stringify(message.to),
          ccJson: JSON.stringify(message.cc),
          bccJson: '[]',
          dateIso: message.date,
          preview: message.preview,
          previewHydrated: message.previewHydrated,
          flagsJson: JSON.stringify(message.flags),
          isRead: message.isRead,
          isFlagged: message.isFlagged,
          senderName: message.senderName,
          senderKey: message.senderKey,
          senderLabel,
          senderSort,
          hasAttachments: message.hasAttachments,
          size: message.size,
          pecKind: message.pec?.kind ?? null,
          pecRef: message.pec?.ref ?? null,
          ...messageSearchText({ ...message, senderLabel }),
          updatedAt: now
        }
        // Never overwrite an already-hydrated preview with an envelope-only write.
        // The envelope phase doesn't know the preview (incoming messages come in
        // with `previewHydrated: false, preview: ''`), so if the row already has
        // a good preview we keep it. This keeps the per-row state monotonic.
        const keepExistingPreview = existing?.previewHydrated === true && !message.previewHydrated
        const preview = keepExistingPreview ? existing!.preview : message.preview
        // A certified envelope names only the address: its sender's name, written when its body was
        // read (`storeMessageBodies`), is not taken back by a fetch of the envelope alone.
        const keepsSender = message.pec !== undefined && !isPecReceipt(message.pec.kind)
        const update = {
          messageId: message.messageId ?? null,
          subject: message.subject,
          subjectSort,
          ...(keepsSender
            ? {}
            : { fromJson: JSON.stringify(message.from), senderName: message.senderName }),
          toJson: JSON.stringify(message.to),
          ccJson: JSON.stringify(message.cc),
          dateIso: message.date,
          preview,
          previewHydrated: keepExistingPreview ? true : message.previewHydrated,
          flagsJson: JSON.stringify(message.flags),
          isRead: message.isRead,
          isFlagged: message.isFlagged,
          senderKey: message.senderKey,
          senderLabel,
          senderSort,
          hasAttachments: message.hasAttachments,
          size: message.size,
          pecKind: message.pec?.kind ?? null,
          pecRef: message.pec?.ref ?? null,
          ...messageSearchText({ ...message, senderLabel, preview }),
          updatedAt: now
        }

        if (existing) {
          result.updated.push({
            ...message,
            messageKey: existing.messageKey,
            threadId: existing.threadId,
            senderLabel,
            preview: update.preview,
            previewHydrated: update.previewHydrated
          })
        } else {
          result.added.push({ ...message, senderLabel })
        }

        return this.prisma.message.upsert({
          where: {
            accountId_folderPath_uid: {
              accountId,
              folderPath,
              uid: message.uid
            }
          },
          create,
          update
        })
      }),
      ...pec.writes
    ])

    const held = [...new Set(result.added.map((row) => row.messageKey).filter(isMessageIdKey))]

    for (const part of chunkOf(held, IDENTITY_LOOKUP_CHUNK)) {
      const statement = keysHeldStatement(accountId, part)
      await this.prisma.$executeRawUnsafe(statement.sql, ...statement.params)
    }

    this.learnContacts(contacts)

    if (result.added.length > 0) {
      this.indexGeneration += 1
    }

    if (role === '\\Sent' && result.added.length > 0) {
      this.scheduleSentRecount()
    }

    result.adopted =
      pec.moved.length > 0
        ? (
            await this.prisma.message.findMany({
              where: { id: { in: pec.moved } },
              select: MESSAGE_SUMMARY_SELECT
            })
          ).map((row) => this.mapMessageRowToSummary(row))
        : []
    return result
  }

  /**
   * Certified mail (PEC) in its conversations, for a batch of messages new
   * to a folder: a receipt goes with the message sent it is about — named
   * by the Message-ID its client gave it — which it does not reference
   * (`fetchedIdentity` files it under that message's own conversation,
   * right for one that started a conversation). So:
   *   • a receipt whose message is known goes in its conversation, however
   *     that message is keyed (`receipts`, by uid);
   *   • the receipts stored before their message — the inbox is read before
   *     Sent — are moved into its conversation when it comes (`moved`).
   * `writes` puts both right, rows and the keys they hold, in the batch's
   * own transaction. What the Segretario wrote of a receipt moved — read
   * in the moment between the two — stays with the conversation it read.
   */
  private async filePecConversations(
    accountId: string,
    added: ReadonlyArray<FetchedMessageSummary>
  ): Promise<{
    receipts: Map<number, string>
    moved: string[]
    writes: Prisma.PrismaPromise<unknown>[]
  }> {
    const bare = (messageId: string): string => messageId.trim().replace(/^<|>$/g, '')
    const receipts = new Map<number, string>()
    const writes: Prisma.PrismaPromise<unknown>[] = []
    const rekey = (messageKey: string, threadId: string): Prisma.PrismaPromise<unknown> =>
      this.prisma.$executeRaw`
        UPDATE message_id_keys SET thread_id = ${threadId}
        WHERE account_id = ${accountId} AND message_key = ${messageKey}
      `

    const refs = [
      ...new Set(
        added.flatMap((message) =>
          message.pec && isPecReceipt(message.pec.kind) && message.pec.ref ? [message.pec.ref] : []
        )
      )
    ]

    if (refs.length > 0) {
      const sent = await this.prisma.message.findMany({
        where: {
          accountId,
          pecKind: null,
          messageId: { in: refs.flatMap((ref) => [ref, `<${ref}>`]) }
        },
        select: { messageId: true, threadId: true }
      })
      const threadOf = new Map(sent.map((row) => [bare(row.messageId!), row.threadId]))

      for (const message of added) {
        const threadId = message.pec?.ref ? threadOf.get(message.pec.ref) : undefined

        if (threadId && isPecReceipt(message.pec!.kind) && threadId !== message.threadId) {
          receipts.set(message.uid, threadId)
          writes.push(rekey(message.messageKey, threadId))
        }
      }
    }

    const threads = new Map(
      added.flatMap((message) =>
        message.messageId && !message.pec
          ? [[bare(message.messageId), message.threadId] as const]
          : []
      )
    )
    const strays = (
      await Promise.all(
        chunkOf([...threads.keys()], IDENTITY_LOOKUP_CHUNK).map((part) =>
          this.prisma.message.findMany({
            where: {
              accountId,
              pecRef: { in: part },
              pecKind: { notIn: ['busta', 'anomalia'] }
            },
            select: { id: true, messageKey: true, threadId: true, pecRef: true }
          })
        )
      )
    )
      .flat()
      .filter((row) => row.threadId !== threads.get(row.pecRef!))

    for (const row of strays) {
      const threadId = threads.get(row.pecRef!)!
      writes.push(
        this.prisma.message.update({ where: { id: row.id }, data: { threadId } }),
        rekey(row.messageKey, threadId)
      )
    }

    return { receipts, moved: strays.map((row) => row.id), writes }
  }

  /**
   * The label each message in `messages` is filed under.
   *
   * A named message takes the label its address already uses for the same
   * person (`isSameSenderName`) — the one most of its messages carry — so
   * "A.galli-BRENTA" files with "A. Galli - BRENTA" and "Valenti
   * Cristian" with "Cristian Valenti", while the different people a
   * shared address speaks for keep their own names. A message that gives
   * only an address — a phone, a scanner, a client that never set a name —
   * takes the latest label its address went by, so it sorts with that
   * person instead of apart as a bare address; when this batch brings a
   * newer one, the nameless rows already stored for the address take it too.
   */
  private async resolveSenderLabels(
    messages: ReadonlyArray<FetchedMessageSummary>
  ): Promise<Map<FetchedMessageSummary, string>> {
    const keys = [...new Set(messages.map((message) => message.senderKey).filter(Boolean))]
    const labelsByKey = new Map<string, SenderLabelUse[]>()

    if (keys.length > 0) {
      const stored = await this.prisma.$queryRaw<
        Array<{ key: string; label: string; count: number | bigint; date: string }>
      >`
        SELECT sender_key AS key, sender_label AS label, COUNT(*) AS count, MAX(date_iso) AS date
        FROM messages
        WHERE sender_key IN (${Prisma.join(keys)})
          AND sender_label <> sender_key
        GROUP BY sender_key, sender_label
      `

      for (const row of stored) {
        const uses = labelsByKey.get(row.key) ?? []
        uses.push({ label: row.label, count: Number(row.count), date: row.date })
        labelsByKey.set(row.key, uses)
      }
    }

    const storedLatest = new Map(
      [...labelsByKey].map(([key, uses]) => [key, latestLabelUse(uses)?.label])
    )
    const labels = new Map<FetchedMessageSummary, string>()

    // Named messages first, oldest to newest, so a name a batch brings is
    // known to every nameless message in it.
    const named = messages
      .filter((message) => message.senderKey && headerSenderName(message))
      .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))

    for (const message of named) {
      const name = headerSenderName(message) as string
      const uses = labelsByKey.get(message.senderKey) ?? []
      const label =
        dominantLabelUse(uses.filter((use) => isSameSenderName(use.label, name)))?.label ?? name
      const use = uses.find((candidate) => candidate.label === label)

      if (use) {
        use.count += 1
        use.date = message.date > use.date ? message.date : use.date
      } else {
        uses.push({ label, count: 1, date: message.date })
      }

      labelsByKey.set(message.senderKey, uses)
      labels.set(message, label)
    }

    for (const message of messages) {
      if (!labels.has(message)) {
        labels.set(
          message,
          latestLabelUse(labelsByKey.get(message.senderKey) ?? [])?.label ?? message.senderName
        )
      }
    }

    const relabeled = [...labelsByKey]
      .map(([key, uses]) => [key, latestLabelUse(uses)?.label] as const)
      .filter(
        (entry): entry is readonly [string, string] =>
          entry[1] !== undefined && entry[1] !== storedLatest.get(entry[0])
      )
    const relabels = relabeled.map(
      ([key, label]) => this.prisma.$executeRaw`
          UPDATE messages
          SET sender_label = ${label}, sender_sort = ${senderSortKey(label)}
          WHERE sender_key = ${key}
            AND LOWER(TRIM(sender_name)) = sender_key
            AND sender_label <> ${label}
        `
    )

    if (relabels.length > 0) {
      await this.prisma.$transaction(relabels)
      await this.refreshSenderSearchText(relabeled.map(([key]) => key))
    }

    return labels
  }

  /** A sender found by the name the list now files them under (see `messageSearchText`). */
  private async refreshSenderSearchText(senderKeys: ReadonlyArray<string>): Promise<void> {
    const rows = await this.prisma.message.findMany({
      where: { senderKey: { in: [...senderKeys] } },
      select: { id: true, fromJson: true, senderLabel: true, searchFrom: true }
    })
    const updates = rows.flatMap((row) => {
      const searchFrom = `${foldSearchText(row.senderLabel)} ${addressesSearchText(
        parseJsonArray<MailAddress>(row.fromJson)
      )}`

      return searchFrom === row.searchFrom
        ? []
        : [this.prisma.message.update({ where: { id: row.id }, data: { searchFrom } })]
    })

    if (updates.length > 0) {
      await this.prisma.$transaction(updates)
    }
  }

  /**
   * The copies an extension saved, which the Segretario's registry kept
   * before marks were the mail's: each becomes a mark of the extension that
   * saved it, at its place, with its files, worded as the app worded copies
   * — the extension words its own marks again. The registry drops the table
   * after (`ensureAiSchema`, version 7).
   */
  private async copiesToMarks(): Promise<void> {
    const [copies] = await this.prisma.$queryRaw<Array<{ found: number }>>`
      SELECT COUNT(*) AS found FROM sqlite_master WHERE type = 'table' AND name = 'ai_saved_copies'
    `

    if (Number(copies?.found ?? 0) === 0) {
      return
    }

    await this.prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO message_marks (
        extension, account_id, message_key, thread_id, from_address, label, place, files_json,
        marked_at
      )
      SELECT source, account_id, message_key, thread_id, from_address, 'Salvato', destination,
        files_json, saved_at
      FROM ai_saved_copies
      WHERE account_id IN (SELECT id FROM accounts)
    `)
  }

  /**
   * The calendars' tables (see the `Calendar*` models): the calendar
   * connections, each on its own — Google, Microsoft, CalDAV, a link — and a
   * copy of their calendars and events, kept in step.
   */
  private async ensureCalendarTables(): Promise<void> {
    const columns = async (table: string): Promise<Set<string>> =>
      new Set(
        (
          (await this.prisma.$queryRawUnsafe(`PRAGMA table_info(${table})`)) as Array<{
            name: string
          }>
        ).map((column) => column.name)
      )

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS calendar_connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        mail_account_id TEXT,
        server_url TEXT,
        username TEXT,
        encrypted_secret TEXT,
        connected_at INTEGER NOT NULL,
        last_sync_at INTEGER,
        problem TEXT
      )
    `)

    // Until 2.0 a calendar was a Google mail account's: each becomes a connection of its own,
    // with the account's id, so its events keep their keys.
    if ((await columns('calendar_accounts')).size > 0) {
      await this.prisma.$executeRawUnsafe(`
        INSERT OR IGNORE INTO calendar_connections (
          id, provider, label, mail_account_id, encrypted_secret, connected_at, last_sync_at, problem
        )
        SELECT c.account_id, 'google', COALESCE(a.email, c.account_id), a.id, c.encrypted_token,
          c.connected_at, c.last_sync_at, c.problem
        FROM calendar_accounts c LEFT JOIN accounts a ON a.id = c.account_id
      `)
      await this.prisma.$executeRawUnsafe('DROP TABLE calendar_accounts')
    }

    for (const table of ['calendar_calendars', 'calendar_events', 'calendar_changes']) {
      if ((await columns(table)).has('account_id')) {
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE ${table} RENAME COLUMN account_id TO connection_id`
        )
      }
    }

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS calendar_calendars (
        connection_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_primary INTEGER NOT NULL,
        writable INTEGER NOT NULL DEFAULT 1,
        color TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        role TEXT,
        sync_token TEXT,
        window_end INTEGER,
        PRIMARY KEY (connection_id, calendar_id)
      )
    `)
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        key TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        ical_uid TEXT,
        series_id TEXT,
        title TEXT NOT NULL,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        all_day INTEGER NOT NULL,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        location TEXT,
        description TEXT,
        attendees_json TEXT NOT NULL,
        organizer TEXT,
        creator TEXT,
        my_response TEXT,
        meet_link TEXT,
        html_link TEXT,
        origin_json TEXT,
        reminders_json TEXT
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(starts_at, ends_at)'
    )
    // An invitation's event is looked for by its UID in every calendar connected.
    await this.prisma.$executeRawUnsafe('DROP INDEX IF EXISTS idx_calendar_events_uid')
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_calendar_events_ical_uid ON calendar_events(ical_uid)'
    )

    // A CalDAV calendar's objects as the server has them: to sync them, and to change them in place.
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS calendar_objects (
        connection_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        url TEXT NOT NULL,
        etag TEXT,
        data TEXT NOT NULL,
        PRIMARY KEY (connection_id, url)
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_calendar_objects_calendar ON calendar_objects(connection_id, calendar_id)'
    )

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS calendar_changes (
        id INTEGER PRIMARY KEY,
        connection_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        in_app INTEGER NOT NULL DEFAULT 0,
        at INTEGER NOT NULL
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_calendar_changes_at ON calendar_changes(at)'
    )

    // Kept before calendars said whether they take events, and events who put them there.

    if (!(await columns('calendar_calendars')).has('writable')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE calendar_calendars ADD COLUMN writable INTEGER NOT NULL DEFAULT 1'
      )
    }

    const calendarColumns = await columns('calendar_calendars')

    if (!calendarColumns.has('color')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE calendar_calendars ADD COLUMN color TEXT')
    }

    if (!calendarColumns.has('hidden')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE calendar_calendars ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0'
      )
    }

    if (!calendarColumns.has('role')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE calendar_calendars ADD COLUMN role TEXT')
    }

    if (!(await columns('calendar_events')).has('origin_json')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE calendar_events ADD COLUMN origin_json TEXT')
    }

    // Kept before a series was told from its instances: every calendar is read whole again at
    // its next sync, which says them — a read of a calendar anew, no change for the Segretario —
    // and is looked at only once it is (`planCalendarLooks`).
    if (!(await columns('calendar_events')).has('series_id')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE calendar_events ADD COLUMN series_id TEXT')
      await this.prisma.$executeRawUnsafe('UPDATE calendar_calendars SET window_end = NULL')
      await this.prisma.$executeRawUnsafe('UPDATE calendar_connections SET last_sync_at = NULL')
    }

    // Kept before events said their own reminders: every calendar is read whole again at its next
    // sync, which says them — a read anew, no change for the Segretario (§13.3).
    if (!(await columns('calendar_events')).has('reminders_json')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE calendar_events ADD COLUMN reminders_json TEXT'
      )
      await this.prisma.$executeRawUnsafe('UPDATE calendar_calendars SET window_end = NULL')
      await this.prisma.$executeRawUnsafe('UPDATE calendar_connections SET last_sync_at = NULL')
    }

    // Kept before events said who put them there: read whole again at the next sync, which says
    // it — whose an event is (§7.4) —, a read anew, no change for the Segretario.
    if (!(await columns('calendar_events')).has('creator')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE calendar_events ADD COLUMN creator TEXT')
      await this.prisma.$executeRawUnsafe('UPDATE calendar_calendars SET window_end = NULL')
      await this.prisma.$executeRawUnsafe('UPDATE calendar_connections SET last_sync_at = NULL')
    }

    // Kept before the user's own changes in the app were noted for the Segretario.
    if (!(await columns('calendar_changes')).has('in_app')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE calendar_changes ADD COLUMN in_app INTEGER NOT NULL DEFAULT 0'
      )
    }
  }

  /**
   * The Prisma client, for the stores that keep their own tables in this
   * file — the Segretario's (see `src/main/ai/ai-store.ts`), the
   * calendars'. Resolves once the schema is ready.
   */
  async storeClient(): Promise<PrismaClient> {
    await this.ready
    return this.prisma
  }

  /**
   * The cache — folders, messages, their bodies and the index — is kept
   * across app updates: it holds the whole mailbox, and downloading it all
   * again at every release would cost the user hours. Its shape is versioned
   * on its own (`CACHE_SCHEMA_VERSION`): when it changes, the tables are
   * dropped here, before anything reads them, and created again in the new
   * shape; the engine downloads the mail anew. The keys made of a
   * Message-ID stay, held by no row since now: the messages downloaded
   * again take them back (see `message-id-keys.ts`).
   */
  private async resetCacheIfOutdated(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM app_meta WHERE key = 'cache_version'
    `

    if (rows[0]?.value === String(CACHE_SCHEMA_VERSION)) {
      return
    }

    for (const table of CACHE_TABLES_IN_DROP_ORDER) {
      await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`)
    }

    await this.prisma.$executeRaw`
      UPDATE message_id_keys SET left_at = ${Date.now()} WHERE left_at IS NULL
    `
    await this.prisma.$executeRaw`
      INSERT INTO app_meta (key, value) VALUES ('cache_version', ${String(CACHE_SCHEMA_VERSION)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  }

  /**
   * The full-text index of the bodies: an FTS5 table over `message_bodies`,
   * kept in step by triggers. Accents and case are folded the way the app's
   * search folds them, so "perche" finds "perché".
   */
  private async ensureMessageIndex(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        subject, sender, recipients, body,
        content='message_bodies', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      )
    `)
    // Its words, for a number to be found inside the codes the index keeps whole.
    await this.prisma.$executeRawUnsafe(
      "CREATE VIRTUAL TABLE IF NOT EXISTS message_fts_vocab USING fts5vocab(message_fts, 'row')"
    )
    await this.prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS message_bodies_ai AFTER INSERT ON message_bodies BEGIN
        INSERT INTO message_fts (rowid, subject, sender, recipients, body)
        VALUES (new.id, new.subject, new.sender, new.recipients, new.body);
      END
    `)
    await this.prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS message_bodies_ad AFTER DELETE ON message_bodies BEGIN
        INSERT INTO message_fts (message_fts, rowid, subject, sender, recipients, body)
        VALUES ('delete', old.id, old.subject, old.sender, old.recipients, old.body);
      END
    `)
    await this.prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS message_bodies_au AFTER UPDATE ON message_bodies BEGIN
        INSERT INTO message_fts (message_fts, rowid, subject, sender, recipients, body)
        VALUES ('delete', old.id, old.subject, old.sender, old.recipients, old.body);
        INSERT INTO message_fts (rowid, subject, sender, recipients, body)
        VALUES (new.id, new.subject, new.sender, new.recipients, new.body);
      END
    `)
  }

  /**
   * Brings every stored row in line with how rows are filed now: the
   * spellings one address uses for the same person take that address's most
   * used label, and every label and subject gets the current key. Runs once
   * per change of that scheme (`SORT_FILING_VERSION`), on the rows already
   * stored — an upgrade drops the message cache anyway, but a database kept
   * across the change must not stay split.
   */
  private async refileIfOutdated(): Promise<void> {
    const [{ user_version: version }] =
      await this.prisma.$queryRawUnsafe<Array<{ user_version: number | bigint }>>(
        'PRAGMA user_version'
      )

    if (Number(version) >= SORT_FILING_VERSION) {
      return
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; label: string; count: number | bigint; date: string }>
    >`
      SELECT sender_key AS key, sender_label AS label, COUNT(*) AS count, MAX(date_iso) AS date
      FROM messages
      WHERE sender_label <> sender_key
      GROUP BY sender_key, sender_label
    `
    const usesByKey = new Map<string, SenderLabelUse[]>()

    for (const row of rows) {
      const uses = usesByKey.get(row.key) ?? []
      uses.push({ label: row.label, count: Number(row.count), date: row.date })
      usesByKey.set(row.key, uses)
    }

    const updates: Prisma.PrismaPromise<number>[] = []

    for (const [key, uses] of usesByKey) {
      const canonical: SenderLabelUse[] = []

      for (const use of [...uses].sort(compareLabelUses)) {
        const into = canonical.find((candidate) => isSameSenderName(candidate.label, use.label))

        if (!into) {
          canonical.push(use)
        } else if (into.label !== use.label) {
          updates.push(this.prisma.$executeRaw`
            UPDATE messages SET sender_label = ${into.label}
            WHERE sender_key = ${key} AND sender_label = ${use.label}
          `)
        }
      }
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(updates)
    }

    // Keys are worked out here and written by primary key, only where they
    // changed: a mailbox of tens of thousands of rows re-files in a moment.
    const keyed = await this.prisma.$queryRaw<
      Array<{
        id: string
        senderLabel: string
        senderSort: string
        subject: string
        subjectSort: string
      }>
    >`
      SELECT id AS id, sender_label AS senderLabel, sender_sort AS senderSort,
        subject AS subject, subject_sort AS subjectSort
      FROM messages
    `
    const keyUpdates = keyed.flatMap((row) => {
      const senderSort = senderSortKey(row.senderLabel)
      const subjectSort = subjectSortKey(row.subject)

      return senderSort === row.senderSort && subjectSort === row.subjectSort
        ? []
        : [
            this.prisma.$executeRaw`
              UPDATE messages SET sender_sort = ${senderSort}, subject_sort = ${subjectSort}
              WHERE id = ${row.id}
            `
          ]
    })

    if (keyUpdates.length > 0) {
      await this.prisma.$transaction(keyUpdates)
    }

    await this.refreshSearchText()
    await this.prisma.$executeRawUnsafe(`PRAGMA user_version = ${SORT_FILING_VERSION}`)
  }

  /**
   * Works out every stored row's search text again (see
   * `messageSearchText`), a page at a time: a mailbox of a hundred thousand
   * rows is never held in memory at once.
   */
  private async refreshSearchText(): Promise<void> {
    let after = ''

    for (;;) {
      const rows = await this.prisma.message.findMany({
        where: { id: { gt: after } },
        orderBy: { id: 'asc' },
        take: SEARCH_REFRESH_PAGE_SIZE,
        select: {
          id: true,
          subject: true,
          fromJson: true,
          toJson: true,
          ccJson: true,
          bccJson: true,
          senderLabel: true,
          preview: true
        }
      })

      if (rows.length === 0) {
        return
      }

      await this.prisma.$transaction(
        rows.map((row) =>
          this.prisma.message.update({
            where: { id: row.id },
            data: {
              ...messageSearchText({
                subject: row.subject,
                from: parseJsonArray<MailAddress>(row.fromJson),
                to: parseJsonArray<MailAddress>(row.toJson),
                cc: parseJsonArray<MailAddress>(row.ccJson),
                bcc: parseJsonArray<MailAddress>(row.bccJson),
                senderLabel: row.senderLabel,
                preview: row.preview
              })
            }
          })
        )
      )

      after = rows[rows.length - 1].id
    }
  }

  async updateMessagePreviews(
    accountId: string,
    folderPath: string,
    updates: Array<{ uid: number; preview: string }>
  ): Promise<MailMessageSummary[]> {
    await this.ready

    if (updates.length === 0) {
      return []
    }

    const now = BigInt(Date.now())

    await this.prisma.$transaction(
      updates.map((entry) =>
        this.prisma.message.updateMany({
          where: { accountId, folderPath, uid: entry.uid },
          data: {
            preview: entry.preview,
            previewHydrated: true,
            searchPreview: foldSearchText(entry.preview),
            updatedAt: now
          }
        })
      )
    )

    const uids = updates.map((entry) => entry.uid)
    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath, uid: { in: uids } },
      select: MESSAGE_SUMMARY_SELECT
    })

    return rows.map((row) => this.mapMessageRowToSummary(row))
  }

  async listUnhydratedMessageUids(accountId: string, folderPath: string): Promise<number[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath, previewHydrated: false },
      select: { uid: true },
      orderBy: { uid: 'desc' }
    })

    return rows.map((row) => row.uid)
  }

  private mapMessageRowToSummary(row: {
    accountId: string
    folderPath: string
    uid: number
    messageKey: string
    threadId: string
    messageId: string | null
    subject: string
    fromJson: string
    toJson: string
    ccJson: string
    dateIso: string
    preview: string
    previewHydrated: boolean
    flagsJson: string
    isRead: boolean
    isFlagged: boolean
    senderName: string
    senderKey: string
    senderLabel: string
    hasAttachments: boolean
    size: number
    pecKind: string | null
    pecRef: string | null
  }): MailMessageSummary {
    return {
      ...(row.pecKind ? { pec: { kind: row.pecKind as PecKind, ref: row.pecRef } } : {}),
      accountId: row.accountId,
      folderPath: row.folderPath,
      uid: row.uid,
      messageKey: row.messageKey,
      threadId: row.threadId,
      messageId: row.messageId ?? undefined,
      subject: row.subject,
      from: parseJsonArray(row.fromJson),
      to: parseJsonArray(row.toJson),
      cc: parseJsonArray(row.ccJson),
      date: row.dateIso,
      preview: row.preview,
      previewHydrated: row.previewHydrated,
      flags: parseJsonArray(row.flagsJson),
      isRead: row.isRead,
      isFlagged: row.isFlagged,
      hasAttachments: row.hasAttachments,
      size: row.size,
      senderName: row.senderName,
      senderKey: row.senderKey,
      senderLabel: row.senderLabel
    }
  }

  /**
   * `find` run over `where` — except that the messages from the senders
   * `senderMatch` names come first. Two queries rather than a CASE in the
   * ORDER BY: Prisma cannot order on an expression, and the list pages by
   * growing `take`, so the split never shifts between pages. Without `take`,
   * every message.
   */
  private async inSearchOrder<Row>(
    where: Prisma.MessageWhereInput,
    senderMatch: Prisma.MessageWhereInput | null,
    take: number | undefined,
    find: (where: Prisma.MessageWhereInput, take: number | undefined) => Promise<Row[]>
  ): Promise<Row[]> {
    const senders = senderMatch ? await this.findSearchedSenders(where, senderMatch) : []

    if (senders.length === 0) {
      return find(where, take)
    }

    const leading: Prisma.MessageWhereInput = { senderSort: { in: senders } }
    const first = await find({ AND: [where, leading] }, take)

    if (take !== undefined && first.length >= take) {
      return first
    }

    const rest = await find(
      { AND: [where, { NOT: leading }] },
      take === undefined ? undefined : take - first.length
    )

    return [...first, ...rest]
  }

  /**
   * The senders among `where` whose From line matches the search, as sort
   * keys. Taken per sender rather than per row, so every message filed
   * under that sender leads together — including one sent under a name, or
   * from an address, the search does not match.
   */
  private async findSearchedSenders(
    where: Prisma.MessageWhereInput,
    senderMatch: Prisma.MessageWhereInput
  ): Promise<string[]> {
    const rows = await this.prisma.message.groupBy({
      by: ['senderSort'],
      where: { AND: [where, senderMatch, { senderSort: { not: '' } }] },
      orderBy: { senderSort: 'asc' },
      take: SEARCHED_SENDER_LIMIT + 1
    })

    return rows.length > SEARCHED_SENDER_LIMIT ? [] : rows.map((row) => row.senderSort)
  }

  /** How many rows the cache holds of each folder of an account, by path. */
  async countMessagesByFolder(accountId: string): Promise<Map<string, number>> {
    await this.ready

    const groups = await this.prisma.message.groupBy({
      by: ['folderPath'],
      where: { accountId },
      _count: { _all: true }
    })

    return new Map(groups.map((group) => [group.folderPath, group._count._all]))
  }

  async listAllMessageUids(accountId: string, folderPath: string): Promise<number[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath },
      select: { uid: true }
    })

    return rows.map((row) => row.uid)
  }

  /** The highest UID the cache holds of a folder: a message the server gave, null when it holds none. */
  async newestStoredUid(accountId: string, folderPath: string): Promise<number | null> {
    await this.ready

    const row = await this.prisma.message.findFirst({
      where: { accountId, folderPath },
      orderBy: { uid: 'desc' },
      select: { uid: true }
    })

    return row?.uid ?? null
  }

  async deleteMessageUids(accountId: string, folderPath: string, uids: number[]): Promise<void> {
    await this.ready

    if (uids.length === 0) {
      return
    }

    const chunkSize = 400

    for (let index = 0; index < uids.length; index += chunkSize) {
      const chunk = uids.slice(index, index + chunkSize)
      const where = { accountId, folderPath, uid: { in: chunk } }
      const keys = (
        await this.prisma.message.findMany({ where, select: { messageKey: true } })
      ).map((row) => row.messageKey)

      await this.prisma.message.deleteMany({ where })
      await this.forgetUnheldBodies(accountId, keys)
      await this.markKeysLeft(accountId, keys)
    }

    this.indexGeneration += 1
  }

  /**
   * The keys made of a Message-ID that no row holds any longer — of
   * `keys`, or of the whole account when it is null — left as of now:
   * remembered, for the message to come back as itself (see
   * `message-id-keys.ts`).
   */
  private async markKeysLeft(accountId: string, keys: ReadonlyArray<string> | null): Promise<void> {
    const at = Date.now()

    if (keys === null) {
      const statement = keysLeftStatement(accountId, at, null)
      await this.prisma.$executeRawUnsafe(statement.sql, ...statement.params)
      return
    }

    for (const part of chunkOf([...new Set(keys)].filter(isMessageIdKey), IDENTITY_LOOKUP_CHUNK)) {
      const statement = keysLeftStatement(accountId, at, part)
      await this.prisma.$executeRawUnsafe(statement.sql, ...statement.params)
    }
  }

  /**
   * Forgets the keys made of a Message-ID an account remembered with no
   * row holding them, once every folder of it has been read since they
   * left and the Segretario names none of them (see `message-id-keys.ts`).
   */
  async forgetLeftMessageIdKeys(accountId: string): Promise<void> {
    await this.ready

    const statement = forgetLeftKeysStatement(accountId)
    await this.prisma.$executeRawUnsafe(statement.sql, ...statement.params)
  }

  /** What the server has of a folder that its cache leaves out on purpose (see `LeftOutMessages`). */
  async listLeftOutMessages(accountId: string, folderPath: string): Promise<LeftOutMessages> {
    await this.ready

    const rows = await this.prisma.$queryRaw<
      Array<{
        uid: number | bigint
        reason: string
        failures: number | bigint
        retryAt: number | bigint | null
      }>
    >`
      SELECT uid, reason, failures, retry_at AS retryAt
      FROM left_out_messages
      WHERE account_id = ${accountId} AND folder_path = ${folderPath}
    `

    return {
      deleted: rows.filter((row) => row.reason === 'deleted').map((row) => Number(row.uid)),
      unreadable: rows
        .filter((row) => row.reason === 'unreadable')
        .map((row) => ({
          uid: Number(row.uid),
          failures: Number(row.failures),
          retryAt: row.retryAt === null ? null : Number(row.retryAt)
        }))
    }
  }

  /**
   * By folder of an account, what its cache leaves out on purpose: how
   * many of those messages the cache does not hold — what the server's
   * count of the folder has more — and whether one the server would not
   * give is to be asked for now, still being tried or due again.
   */
  async summarizeLeftOutMessages(
    accountId: string,
    now: number
  ): Promise<Map<string, { uncached: number; retry: boolean }>> {
    await this.ready

    const rows = await this.prisma.$queryRaw<
      Array<{ folderPath: string; uncached: number | bigint; retry: number | bigint }>
    >`
      SELECT l.folder_path AS folderPath,
        SUM(
          (l.reason = 'deleted' OR l.retry_at > ${now})
          AND NOT EXISTS (
            SELECT 1 FROM messages m
            WHERE m.account_id = l.account_id AND m.folder_path = l.folder_path AND m.uid = l.uid
          )
        ) AS uncached,
        MAX(l.reason = 'unreadable' AND (l.retry_at IS NULL OR l.retry_at <= ${now})) AS retry
      FROM left_out_messages l
      WHERE l.account_id = ${accountId}
      GROUP BY l.folder_path
    `

    return new Map(
      rows.map((row) => [
        row.folderPath,
        { uncached: Number(row.uncached), retry: Number(row.retry) === 1 }
      ])
    )
  }

  /** Messages this app flagged \Deleted in a folder, waiting there for an expunge (see `LeftOutMessages`). */
  async addDeletedUids(
    accountId: string,
    folderPath: string,
    uids: ReadonlyArray<number>
  ): Promise<void> {
    await this.ready

    for (const part of chunkOf(uids, IDENTITY_LOOKUP_CHUNK)) {
      await this.prisma.$executeRaw`
        INSERT INTO left_out_messages (account_id, folder_path, uid, reason)
        VALUES ${Prisma.join(part.map((uid) => Prisma.sql`(${accountId}, ${folderPath}, ${uid}, 'deleted')`))}
        ON CONFLICT (account_id, folder_path, uid) DO UPDATE
          SET reason = 'deleted', failures = 0, retry_at = NULL
      `
    }
  }

  /** Records messages of a folder the server would not give (see `UnreadableMessage`). */
  async storeUnreadableMessages(
    accountId: string,
    folderPath: string,
    records: ReadonlyArray<UnreadableMessage>
  ): Promise<void> {
    await this.ready

    for (const part of chunkOf(records, IDENTITY_LOOKUP_CHUNK)) {
      await this.prisma.$executeRaw`
        INSERT INTO left_out_messages (account_id, folder_path, uid, reason, failures, retry_at)
        VALUES ${Prisma.join(
          part.map(
            (record) =>
              Prisma.sql`(${accountId}, ${folderPath}, ${record.uid}, 'unreadable', ${record.failures}, ${record.retryAt})`
          )
        )}
        ON CONFLICT (account_id, folder_path, uid) DO UPDATE
          SET reason = excluded.reason, failures = excluded.failures, retry_at = excluded.retry_at
      `
    }
  }

  /** What a folder's cache stops leaving out: stored now, or gone from the server. */
  async forgetLeftOutMessages(
    accountId: string,
    folderPath: string,
    uids: ReadonlyArray<number>
  ): Promise<void> {
    await this.ready

    for (const part of chunkOf(uids, IDENTITY_LOOKUP_CHUNK)) {
      await this.prisma.$executeRaw`
        DELETE FROM left_out_messages
        WHERE account_id = ${accountId} AND folder_path = ${folderPath}
          AND uid IN (${Prisma.join(part)})
      `
    }
  }

  /**
   * Bodies of messages no folder holds any longer — gone from the server,
   * not just moved: a move keeps the message, and its key, in another
   * folder.
   */
  private async forgetUnheldBodies(accountId: string, keys: ReadonlyArray<string>): Promise<void> {
    if (keys.length === 0) {
      return
    }

    await this.prisma.$executeRaw`
      DELETE FROM message_bodies
      WHERE account_id = ${accountId}
        AND message_key IN (${Prisma.join([...new Set(keys)])})
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.account_id = message_bodies.account_id AND m.message_key = message_bodies.message_key
        )
    `
  }

  /** The words of the index the numbers of a query are written in, as `numberWords` finds them. */
  private async numberWordsOf(
    query: string | undefined
  ): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
    const found = new Map<string, string[]>()

    for (const digits of queryNumbers(query)) {
      const cached = this.numberWordsCache.get(digits)
      const words =
        cached?.generation === this.indexGeneration
          ? cached.words
          : await numberWords(this.prisma, digits)

      this.numberWordsCache.delete(digits)
      this.numberWordsCache.set(digits, { generation: this.indexGeneration, words })
      found.set(digits, words)
    }

    for (const digits of [...this.numberWordsCache.keys()].slice(0, -CACHED_INDEX_SEARCHES)) {
      this.numberWordsCache.delete(digits)
    }

    return found
  }

  /**
   * The rows of `mailboxes` the full-text index finds the whole of `query`
   * in, kept under a token the list's WHERE refers to (`search_hits`): a
   * word every signature carries can match tens of thousands of rows, more
   * than a statement can name one by one. The same search over the same
   * mailboxes reuses its token until a body is stored or a row leaves —
   * the list, its count and the scroll to the selection agree — and only
   * the last few searches are kept.
   */
  private async indexHitsToken(
    mailboxes: ReadonlyArray<{ accountId: string; folderPath: string }>,
    query: string | undefined
  ): Promise<string | null> {
    const expression = fullTextMatchExpression(query, await this.numberWordsOf(query))

    if (!expression || mailboxes.length === 0) {
      return null
    }

    const foldersByAccount = new Map<string, string[]>()

    for (const mailbox of mailboxes) {
      const folders = foldersByAccount.get(mailbox.accountId) ?? []
      folders.push(mailbox.folderPath)
      foldersByAccount.set(mailbox.accountId, folders)
    }

    const searchKey = [
      expression,
      ...[...foldersByAccount].map(([accountId, folders]) =>
        [accountId, ...[...folders].sort()].join('\u0000')
      )
    ]
      .sort()
      .join('\n')
    const cached = this.indexSearches.get(searchKey)

    if (cached?.generation === this.indexGeneration) {
      return cached.token
    }

    const token = randomUUID()

    await this.prisma.$transaction(
      [...foldersByAccount].map(
        ([accountId, folders]) => this.prisma.$executeRaw`
          INSERT INTO search_hits (token, message_id)
          SELECT ${token}, m.id FROM messages m
          WHERE m.account_id = ${accountId}
            AND m.folder_path IN (${Prisma.join(folders)})
            AND m.message_key IN (
              SELECT b.message_key
              FROM message_fts JOIN message_bodies b ON b.id = message_fts.rowid
              WHERE message_fts MATCH ${expression} AND b.account_id = ${accountId}
            )
        `
      )
    )

    this.indexSearches.delete(searchKey)
    this.indexSearches.set(searchKey, { token, generation: this.indexGeneration })
    const stale = [...this.indexSearches].filter(
      ([key, entry], index, all) =>
        (key === searchKey ? false : entry.generation !== this.indexGeneration) ||
        index < all.length - CACHED_INDEX_SEARCHES
    )

    for (const [key] of stale) {
      this.indexSearches.delete(key)
    }

    const forgotten = [...(cached ? [cached.token] : []), ...stale.map(([, entry]) => entry.token)]

    if (forgotten.length > 0) {
      await this.prisma.searchHit.deleteMany({ where: { token: { in: forgotten } } })
    }

    return token
  }

  /** What a message list of some mailboxes asks the cache, in the order it shows it. */
  private messageListQuery(
    mailboxes: ReadonlyArray<{ accountId: string; folderPath: string }>,
    view: MessageListView,
    indexHitsToken: string | null
  ): {
    where: Prisma.MessageWhereInput
    orderBy: Prisma.MessageOrderByWithRelationInput[]
    senderMatch: Prisma.MessageWhereInput | null
  } {
    const mailboxWhere =
      mailboxes.length === 1
        ? { accountId: mailboxes[0].accountId, folderPath: mailboxes[0].folderPath }
        : {
            OR: mailboxes.map((mailbox) => ({
              accountId: mailbox.accountId,
              folderPath: mailbox.folderPath
            }))
          }
    const constraints = buildMessageConstraints(
      view.query,
      view.filter,
      view.serverMatches,
      indexHitsToken
    )

    if (view.onlyRefs) {
      const refs = buildServerMatchesWhere(view.onlyRefs)
      constraints.push(refs.length > 0 ? { OR: refs } : { uid: { in: [] } })
    }

    if (view.filter === 'active') {
      const active = buildMessageKeysWhere(view.activeKeys ?? [])
      constraints.push(active.length > 0 ? { OR: active } : { uid: { in: [] } })
    }

    return {
      where: constraints.length > 0 ? { ...mailboxWhere, AND: constraints } : mailboxWhere,
      // The unified inbox spans multiple (accountId, folderPath) pairs, so
      // we need extra tiebreakers between the user-picked sort field and
      // the deterministic uid: without them, two messages from different
      // mailboxes with the same `dateIso` (or same subject/sender) would
      // shuffle on every refresh.
      orderBy: [
        ...buildMessageOrderBy(view.sort, view.grouping),
        { accountId: 'asc' as Prisma.SortOrder },
        { folderPath: 'asc' as Prisma.SortOrder }
      ],
      senderMatch: ordersBySender(view.sort, view.grouping)
        ? buildSenderMatchWhere(view.query)
        : null
    }
  }

  /** The first `limit` messages of a list of some mailboxes. */
  async listMessagesInMailboxes(
    mailboxes: ReadonlyArray<{ accountId: string; folderPath: string }>,
    limit: number,
    view: MessageListView
  ): Promise<MailMessageSummary[]> {
    await this.ready

    if (mailboxes.length === 0) {
      return []
    }

    const { where, orderBy, senderMatch } = this.messageListQuery(
      mailboxes,
      view,
      await this.indexHitsToken(mailboxes, view.query)
    )
    const rows = await this.inSearchOrder(
      where,
      senderMatch,
      Math.max(1, Math.floor(limit)),
      (pageWhere, take) =>
        this.prisma.message.findMany({
          where: pageWhere,
          orderBy,
          take,
          select: MESSAGE_SUMMARY_SELECT
        })
    )

    return rows.map((row) => this.mapMessageRowToSummary(row))
  }

  /**
   * Where a message sits in a list of some mailboxes, counting from 0; -1
   * when the list does not hold it. Reads keys only, so finding a message
   * thousands of rows down costs one light query.
   */
  async findMessagePosition(
    mailboxes: ReadonlyArray<{ accountId: string; folderPath: string }>,
    view: MessageListView,
    ref: MessageRef
  ): Promise<number> {
    await this.ready

    if (
      !mailboxes.some(
        (mailbox) => mailbox.accountId === ref.accountId && mailbox.folderPath === ref.folderPath
      )
    ) {
      return -1
    }

    const { where, orderBy, senderMatch } = this.messageListQuery(
      mailboxes,
      view,
      await this.indexHitsToken(mailboxes, view.query)
    )
    const keys = await this.inSearchOrder(where, senderMatch, undefined, (pageWhere, take) =>
      this.prisma.message.findMany({
        where: pageWhere,
        orderBy,
        take,
        select: { accountId: true, folderPath: true, uid: true }
      })
    )

    return keys.findIndex(
      (key) =>
        key.uid === ref.uid && key.accountId === ref.accountId && key.folderPath === ref.folderPath
    )
  }

  async countMessagesInMailboxes(
    mailboxes: ReadonlyArray<{ accountId: string; folderPath: string }>,
    view: Pick<MessageListView, 'query' | 'filter' | 'serverMatches' | 'onlyRefs'>
  ): Promise<number> {
    await this.ready

    if (mailboxes.length === 0) {
      return 0
    }

    const indexHitsToken = await this.indexHitsToken(mailboxes, view.query)

    return this.prisma.message.count({
      where: this.messageListQuery(mailboxes, view, indexHitsToken).where
    })
  }

  /** Among a folder's `limit` newest messages, those the reader cannot show from the cache. */
  async listRecentMessagesWithoutBody(
    accountId: string,
    folderPath: string,
    limit: number
  ): Promise<Array<{ uid: number; size: number }>> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT recent.uid AS uid, recent.size AS size FROM (
        SELECT uid, size, message_key, date_iso
        FROM messages
        WHERE account_id = ${accountId} AND folder_path = ${folderPath}
        ORDER BY date_iso DESC
        LIMIT ${limit}
      ) recent
      WHERE NOT EXISTS (
        SELECT 1 FROM message_bodies
        WHERE account_id = ${accountId} AND message_key = recent.message_key AND level >= ${READABLE_BODY_LEVEL}
      )
      ORDER BY recent.date_iso DESC
    `) as Array<{ uid: number | bigint; size: number | bigint }>

    return rows.map((row) => ({ uid: Number(row.uid), size: Number(row.size) }))
  }

  /**
   * The newest messages of `folderPaths` whose body is not stored at any
   * level, one row per message: the indexer's next batch. `skipKeys` are
   * messages it gave up on this session.
   */
  async listMessagesNeedingBody(
    accountId: string,
    folderPaths: ReadonlyArray<string>,
    limit: number,
    skipKeys: ReadonlySet<string>
  ): Promise<Array<{ folderPath: string; uid: number; size: number; messageKey: string }>> {
    await this.ready

    if (folderPaths.length === 0) {
      return []
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ folderPath: string; uid: number | bigint; size: number | bigint; messageKey: string }>
    >`
      SELECT m.folder_path AS folderPath, m.uid AS uid, m.size AS size, m.message_key AS messageKey
      FROM messages m
      WHERE m.account_id = ${accountId}
        AND m.folder_path IN (${Prisma.join([...folderPaths])})
        AND NOT EXISTS (
          SELECT 1 FROM message_bodies b
          WHERE b.account_id = m.account_id AND b.message_key = m.message_key
        )
      ORDER BY m.date_iso DESC
      LIMIT ${limit + skipKeys.size}
    `
    const seen = new Set<string>()
    const batch: Array<{ folderPath: string; uid: number; size: number; messageKey: string }> = []

    for (const row of rows) {
      if (seen.has(row.messageKey) || skipKeys.has(row.messageKey)) {
        continue
      }

      seen.add(row.messageKey)
      batch.push({
        folderPath: row.folderPath,
        uid: Number(row.uid),
        size: Number(row.size),
        messageKey: row.messageKey
      })

      if (batch.length >= limit) {
        break
      }
    }

    return batch
  }

  /** How much of an account's mail the index holds: messages, and those whose words it has. */
  async indexProgress(
    accountId: string,
    folderPaths: ReadonlyArray<string>
  ): Promise<{ total: number; indexed: number }> {
    await this.ready

    if (folderPaths.length === 0) {
      return { total: 0, indexed: 0 }
    }

    const [row] = await this.prisma.$queryRaw<
      Array<{ total: number | bigint; indexed: number | bigint }>
    >`
      SELECT COUNT(*) AS total, COUNT(b.id) AS indexed FROM (
        SELECT DISTINCT message_key FROM messages
        WHERE account_id = ${accountId} AND folder_path IN (${Prisma.join([...folderPaths])})
      ) k
      LEFT JOIN message_bodies b ON b.account_id = ${accountId} AND b.message_key = k.message_key
    `

    return { total: Number(row?.total ?? 0), indexed: Number(row?.indexed ?? 0) }
  }

  /**
   * Whether an account's recent mail can be read at ease: every message of
   * the folders the index reads has arrived from the server, and none since
   * `sinceIso` is still waiting for its text.
   */
  async recentMailIndexed(
    accountId: string,
    folderPaths: ReadonlyArray<string>,
    sinceIso: string
  ): Promise<boolean> {
    await this.ready

    if (folderPaths.length === 0) {
      return false
    }

    const [row] = await this.prisma.$queryRaw<
      Array<{
        unsynced: number | bigint
        onServer: number | bigint
        cached: number | bigint
        waiting: number | bigint
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM folders
          WHERE account_id = ${accountId} AND path IN (${Prisma.join([...folderPaths])})
            AND last_synced_at IS NULL) AS unsynced,
        (SELECT COALESCE(SUM(message_count), 0) FROM folders
          WHERE account_id = ${accountId} AND path IN (${Prisma.join([...folderPaths])})) AS onServer,
        (SELECT COUNT(*) FROM messages
          WHERE account_id = ${accountId} AND folder_path IN (${Prisma.join([...folderPaths])})) AS cached,
        (SELECT COUNT(*) FROM messages m
          WHERE m.account_id = ${accountId}
            AND m.folder_path IN (${Prisma.join([...folderPaths])})
            AND m.date_iso >= ${sinceIso}
            AND NOT EXISTS (
              SELECT 1 FROM message_bodies b
              WHERE b.account_id = m.account_id AND b.message_key = m.message_key
            )) AS waiting
    `

    // Every folder read once, all its mail in, the recent text indexed: an empty mailbox is
    // ready as soon as it is read, not never.
    return (
      row !== undefined &&
      Number(row.unsynced) === 0 &&
      Number(row.cached) >= Number(row.onServer) &&
      Number(row.waiting) === 0
    )
  }

  /**
   * An account's conversations with messages the Segretario has written no
   * note for, the latest first, each with those messages, the oldest first
   * (see `unreadConversationsQuery`): one statement, however many.
   */
  async listUnreadConversations(
    accountId: string,
    folders: ReadFolders,
    sinceIso: string,
    threadLimit: number,
    messageLimit: number
  ): Promise<UnreadMessage[]> {
    await this.ready

    if (folders.read.length === 0) {
      return []
    }

    const query = unreadConversationsQuery(accountId, folders, sinceIso, threadLimit, messageLimit)

    return unreadMessagesOf(
      await this.prisma.$queryRawUnsafe<
        Array<Omit<UnreadMessage, 'uid'> & { uid: number | bigint }>
      >(query.sql, ...query.params)
    )
  }

  /**
   * Of an account's messages the Segretario reads since a date — in these
   * folders, never a draft — how many there are, and how many it has read.
   */
  async readProgress(
    accountId: string,
    folders: { read: ReadonlyArray<string>; drafts: ReadonlyArray<string> },
    sinceIso: string
  ): Promise<{ read: number; total: number }> {
    await this.ready

    if (folders.read.length === 0) {
      return { read: 0, total: 0 }
    }

    const drafts = folders.drafts.length > 0 ? [...folders.drafts] : ['']
    const [row] = await this.prisma.$queryRaw<
      Array<{ total: number | bigint; read: number | bigint }>
    >`
      SELECT COUNT(DISTINCT m.message_key) AS total, COUNT(DISTINCT r.message_key) AS read
      FROM messages m
      LEFT JOIN ai_read r ON r.account_id = m.account_id AND r.message_key = m.message_key
      WHERE m.account_id = ${accountId}
        AND m.folder_path IN (${Prisma.join([...folders.read])})
        AND m.date_iso >= ${sinceIso}
        AND NOT EXISTS (
          SELECT 1 FROM messages d
          WHERE d.account_id = m.account_id AND d.message_key = m.message_key
            AND d.folder_path IN (${Prisma.join(drafts)})
        )
    `

    return { read: Number(row?.read ?? 0), total: Number(row?.total ?? 0) }
  }

  /** The keys of a conversation's messages in these folders, the oldest first, each once. */
  async threadMessageKeys(
    accountId: string,
    threadId: string,
    folderPaths: ReadonlyArray<string>
  ): Promise<string[]> {
    await this.ready

    if (folderPaths.length === 0) {
      return []
    }

    const rows = await this.prisma.message.findMany({
      where: { accountId, threadId, folderPath: { in: [...folderPaths] } },
      select: { messageKey: true, dateIso: true },
      orderBy: { dateIso: 'asc' }
    })
    return [...new Set(rows.map((row) => row.messageKey))]
  }

  /** The key and conversation of each message, where it is now; those not in the cache are left out. */
  async messageIdentities(
    refs: ReadonlyArray<MessageRef>
  ): Promise<
    Array<{ ref: MessageRef; messageKey: string; threadId: string; fromAddress: string | null }>
  > {
    await this.ready

    const rows = (
      await Promise.all(
        chunkOf(refs, IDENTITY_LOOKUP_CHUNK).map((part) =>
          this.prisma.message.findMany({
            where: {
              OR: part.map((ref) => ({
                accountId: ref.accountId,
                folderPath: ref.folderPath,
                uid: ref.uid
              }))
            },
            select: {
              accountId: true,
              folderPath: true,
              uid: true,
              messageKey: true,
              threadId: true,
              fromJson: true
            }
          })
        )
      )
    ).flat()

    return rows.map((row) => ({
      ref: { accountId: row.accountId, folderPath: row.folderPath, uid: Number(row.uid) },
      messageKey: row.messageKey,
      threadId: row.threadId,
      fromAddress:
        parseJsonArray<MailAddress>(row.fromJson)[0]?.address.trim().toLowerCase() || null
    }))
  }

  /** An account's conversations with a message from this sender since a date, the latest first. */
  async threadsFromSender(
    accountId: string,
    senderKey: string,
    sinceIso: string,
    limit: number
  ): Promise<string[]> {
    await this.ready

    const rows = await this.prisma.message.groupBy({
      by: ['threadId'],
      where: { accountId, senderKey, dateIso: { gte: sinceIso } },
      _max: { dateIso: true },
      orderBy: { _max: { dateIso: 'desc' } },
      take: limit
    })
    return rows.map((row) => row.threadId)
  }

  /** Whether a message in these folders went to one of these addresses, as its recipients are searched. */
  async anySentTo(
    folders: ReadonlyArray<{ accountId: string; folderPath: string }>,
    addresses: ReadonlyArray<string>
  ): Promise<boolean> {
    await this.ready

    if (folders.length === 0 || addresses.length === 0) {
      return false
    }

    // Each recipient is "name address", one after the other: an address is whole after a space.
    const whole = addresses.flatMap((address) => {
      const folded = ` ${foldSearchText(address.trim())}`
      return [{ searchTo: { endsWith: folded } }, { searchTo: { contains: `${folded} ` } }]
    })
    const found = await this.prisma.message.findFirst({
      where: {
        OR: folders.map((folder) => ({
          accountId: folder.accountId,
          folderPath: folder.folderPath
        })),
        AND: [{ OR: whole }]
      },
      select: { id: true }
    })
    return found !== null
  }

  /** The same message — by its Message-ID — in other accounts of the user's: each account's key and conversation. */
  async sameMessageElsewhere(
    accountId: string,
    messageId: string,
    accountIds: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; messageKey: string; threadId: string }>> {
    await this.ready

    const others = accountIds.filter((candidate) => candidate !== accountId)

    if (others.length === 0) {
      return []
    }

    return this.prisma.message.findMany({
      where: { accountId: { in: others }, messageId },
      select: { accountId: true, messageKey: true, threadId: true },
      distinct: ['accountId', 'messageKey']
    })
  }

  /** The keys of a folder's messages by UID, each once. */
  async messageKeysOfUids(
    accountId: string,
    folderPath: string,
    uids: ReadonlyArray<number>
  ): Promise<string[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath, uid: { in: [...uids] } },
      select: { messageKey: true },
      distinct: ['messageKey']
    })
    return rows.map((row) => row.messageKey)
  }

  /** The keys of an account's messages in these conversations. */
  async listMessageKeysOfThreads(
    accountId: string,
    threadIds: ReadonlyArray<string>
  ): Promise<string[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, threadId: { in: [...threadIds] } },
      select: { messageKey: true },
      distinct: ['messageKey']
    })
    return rows.map((row) => row.messageKey)
  }

  /** Where an account's messages with these keys are filed: every row of each. */
  async listMessageRowsByKey(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<
    Array<{
      folderPath: string
      uid: number
      messageKey: string
      threadId: string
      dateIso: string
      subject: string
      from: MailAddress[]
    }>
  > {
    await this.ready

    const rows = (
      await Promise.all(
        chunkOf([...new Set(messageKeys)], IDENTITY_LOOKUP_CHUNK).map((part) =>
          this.prisma.message.findMany({
            where: { accountId, messageKey: { in: part } },
            select: {
              folderPath: true,
              uid: true,
              messageKey: true,
              threadId: true,
              dateIso: true,
              subject: true,
              fromJson: true
            }
          })
        )
      )
    ).flat()

    return rows.map(({ fromJson, ...row }) => ({
      ...row,
      from: parseJsonArray<MailAddress>(fromJson)
    }))
  }

  /** A message's stored body at whatever level, for reading its words. */
  async getStoredBody(
    accountId: string,
    messageKey: string
  ): Promise<{
    level: number
    html: string | null
    text: string | null
    attachments: MailAttachment[]
    replyTo: MailAddress[]
    references: string[]
    pecDetail: PecDetail | null
  } | null> {
    await this.ready

    const body = await this.prisma.messageBody.findUnique({
      where: { accountId_messageKey: { accountId, messageKey } }
    })

    return body
      ? {
          level: body.level,
          html: body.html,
          text: body.text,
          attachments: parseJsonArray<MailAttachment>(body.attachmentsJson),
          replyTo: parseJsonArray<MailAddress>(body.replyToJson),
          references: parseJsonArray<string>(body.referencesJson),
          pecDetail: body.pecJson ? (JSON.parse(body.pecJson) as PecDetail) : null
        }
      : null
  }

  /**
   * A message of an account by the Message-ID its sender's client gave it:
   * the one a PEC receipt is about — its copy in Sent first, where there is
   * one.
   */
  async messageRefById(accountId: string, messageId: string): Promise<MessageRef | null> {
    await this.ready

    const bare = messageId.trim().replace(/^<|>$/g, '')
    const rows = await this.prisma.message.findMany({
      where: { accountId, messageId: { in: [bare, `<${bare}>`] }, pecKind: null },
      select: { folderPath: true, uid: true }
    })
    const sent = folderForRole(await this.listFolders(accountId), '\\Sent')?.path
    const row = rows.find((candidate) => candidate.folderPath === sent) ?? rows[0]

    return row ? { accountId, folderPath: row.folderPath, uid: row.uid } : null
  }

  /**
   * The PEC receipts on a message sent — those naming its Message-ID —
   * each once, the oldest first, with what its certification says when
   * the index has read it.
   */
  async pecReceipts(accountId: string, messageId: string): Promise<PecReceipt[]> {
    await this.ready

    const ref = messageId.trim().replace(/^<|>$/g, '')

    if (!ref) {
      return []
    }

    const rows = await this.prisma.message.findMany({
      where: { accountId, pecRef: ref, pecKind: { notIn: ['busta', 'anomalia'] } },
      select: { folderPath: true, uid: true, messageKey: true, pecKind: true, dateIso: true },
      orderBy: { dateIso: 'asc' }
    })
    const once = [...new Map(rows.map((row) => [row.messageKey, row])).values()]
    const bodies = new Map(
      (
        await this.prisma.messageBody.findMany({
          where: { accountId, messageKey: { in: once.map((row) => row.messageKey) } },
          select: { messageKey: true, pecJson: true }
        })
      ).map((body) => [body.messageKey, body.pecJson])
    )

    return once.map((row) => {
      const kept = bodies.get(row.messageKey)
      return {
        kind: row.pecKind as PecKind,
        ref: { accountId, folderPath: row.folderPath, uid: row.uid },
        date: row.dateIso,
        certification: kept ? (JSON.parse(kept) as PecDetail).certification : null
      }
    })
  }

  /** A message's size, and whether the reader can show it from the cache — without reading the body. */
  async getMessageBodyState(ref: MessageRef): Promise<{ size: number; hasBody: boolean } | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT m.size AS size, EXISTS (
        SELECT 1 FROM message_bodies b
        WHERE b.account_id = m.account_id AND b.message_key = m.message_key
          AND b.level >= ${READABLE_BODY_LEVEL}
      ) AS hasBody
      FROM messages m
      WHERE m.account_id = ${ref.accountId} AND m.folder_path = ${ref.folderPath} AND m.uid = ${ref.uid}
      LIMIT 1
    `) as Array<{ size: number | bigint; hasBody: number | bigint }>
    const row = rows[0]

    return row ? { size: Number(row.size), hasBody: Number(row.hasBody) === 1 } : null
  }

  /**
   * A message with its body, as the reader shows it. The body is only
   * there once it is readable (`READABLE_BODY_LEVEL`): the text the indexer
   * downloaded lacks the pictures it draws.
   */
  async getMessage(ref: MessageRef): Promise<MailMessageDetail | null> {
    await this.ready

    const row = await this.prisma.message.findUnique({
      where: {
        accountId_folderPath_uid: {
          accountId: ref.accountId,
          folderPath: ref.folderPath,
          uid: ref.uid
        }
      }
    })

    if (!row) {
      return null
    }

    const body = await this.prisma.messageBody.findUnique({
      where: { accountId_messageKey: { accountId: row.accountId, messageKey: row.messageKey } }
    })
    const readable = body !== null && body.level >= READABLE_BODY_LEVEL

    return {
      accountId: row.accountId,
      folderPath: row.folderPath,
      uid: row.uid,
      messageKey: row.messageKey,
      threadId: row.threadId,
      messageId: row.messageId ?? undefined,
      subject: row.subject,
      from: parseJsonArray(row.fromJson),
      to: parseJsonArray(row.toJson),
      cc: parseJsonArray(row.ccJson),
      bcc: parseJsonArray(row.bccJson),
      replyTo: body ? parseJsonArray(body.replyToJson) : [],
      references: body ? parseJsonArray<string>(body.referencesJson) : [],
      date: row.dateIso,
      preview: row.preview,
      previewHydrated: row.previewHydrated,
      flags: parseJsonArray(row.flagsJson),
      isRead: row.isRead,
      isFlagged: row.isFlagged,
      hasAttachments: row.hasAttachments,
      size: row.size,
      senderName: row.senderName,
      senderKey: row.senderKey,
      senderLabel: row.senderLabel,
      html: readable ? (body.html ?? undefined) : undefined,
      text: readable ? (body.text ?? undefined) : undefined,
      attachments: body ? parseJsonArray<MailAttachment>(body.attachmentsJson) : [],
      ...(row.pecKind ? { pec: { kind: row.pecKind as PecKind, ref: row.pecRef } } : {}),
      ...(body?.pecJson ? { pecDetail: JSON.parse(body.pecJson) as PecDetail } : {})
    }
  }

  /**
   * Keeps a message's body (see `storeMessageBodies`), the one `ref` names,
   * as the reader shows it.
   */
  async updateMessageBody(ref: MessageRef, body: StoredBodyInput): Promise<MailMessageSummary[]> {
    const row = await this.prisma.message.findUnique({
      where: {
        accountId_folderPath_uid: {
          accountId: ref.accountId,
          folderPath: ref.folderPath,
          uid: ref.uid
        }
      },
      select: { messageKey: true }
    })

    return row
      ? this.storeMessageBodies(ref.accountId, [
          { messageKey: row.messageKey, level: READABLE_BODY_LEVEL, body }
        ])
      : []
  }

  /**
   * Keeps bodies, once per message whatever folders hold it, and indexes
   * their words. A body never goes down a level: the text the indexer
   * downloads does not replace one the reader already shows.
   *
   * What the body tells the list better than the envelope could is
   * written on every row of the message, and those rows are returned for
   * the views to adopt:
   *   • the paperclip — the envelope-time flag is a heuristic over
   *     BODYSTRUCTURE that cannot tell a signature logo from a real
   *     attachment; with the body in hand the answer is exact;
   *   • the preview — read from the whole body rather than from its first
   *     32 KB, it replaces one the list made with less;
   *   • the Bcc a sent message carries, which only shows with its body;
   *   • the name of who sent a certified message (PEC): its envelope names
   *     only the address the provider certified, the message it carries
   *     the sender's name too — the list files the sender under it, and
   *     the next sync of the folder learns the contact by it.
   */
  async storeMessageBodies(
    accountId: string,
    entries: ReadonlyArray<{ messageKey: string; level: number; body: StoredBodyInput }>
  ): Promise<MailMessageSummary[]> {
    await this.ready

    if (entries.length === 0) {
      return []
    }

    const keys = [...new Set(entries.map((entry) => entry.messageKey))]
    const [rows, stored] = await Promise.all([
      this.prisma.message.findMany({
        where: { accountId, messageKey: { in: keys } },
        select: {
          id: true,
          messageKey: true,
          subject: true,
          fromJson: true,
          toJson: true,
          ccJson: true,
          bccJson: true,
          senderLabel: true,
          hasAttachments: true,
          preview: true,
          previewHydrated: true
        }
      }),
      this.prisma.messageBody.findMany({
        where: { accountId, messageKey: { in: keys } },
        select: { messageKey: true, level: true }
      })
    ])
    const storedLevel = new Map(stored.map((body) => [body.messageKey, body.level]))
    const rowsByKey = new Map<string, typeof rows>()

    for (const row of rows) {
      const keyed = rowsByKey.get(row.messageKey) ?? []
      keyed.push(row)
      rowsByKey.set(row.messageKey, keyed)
    }

    const now = BigInt(Date.now())
    const writes: Prisma.PrismaPromise<unknown>[] = []
    const changedRowIds: string[] = []
    const learned: MailAddress[] = []

    for (const { messageKey, level, body } of entries) {
      const keyed = rowsByKey.get(messageKey)

      // The message left every folder while its body was downloading.
      if (!keyed || (storedLevel.get(messageKey) ?? 0) > level) {
        continue
      }

      const envelope = keyed[0]
      const certified = parseJsonArray<MailAddress>(envelope.fromJson)[0]
      const carried =
        body.pecDetail && !isPecReceipt(body.pecDetail.kind) ? body.from[0] : undefined
      // The name the message carried gives its sender — the one the provider certified.
      const carriedName =
        certified &&
        carried &&
        carried.address.toLowerCase() === certified.address.toLowerCase() &&
        isMeaningfulDisplayName(carried.name, carried.address)
          ? carried.name!.trim()
          : null
      const from = carriedName
        ? [{ name: carriedName, address: certified!.address }]
        : parseJsonArray<MailAddress>(envelope.fromJson)
      const senderLabel = carriedName ?? envelope.senderLabel
      const to = parseJsonArray<MailAddress>(envelope.toJson)
      const cc = parseJsonArray<MailAddress>(envelope.ccJson)
      const indexed = {
        level,
        html: body.html ?? null,
        text: body.text ?? (body.html ? null : ''),
        attachmentsJson: JSON.stringify(body.attachments),
        replyToJson: JSON.stringify(body.replyTo),
        referencesJson: JSON.stringify(body.references),
        pecJson: body.pecDetail ? JSON.stringify(body.pecDetail) : null,
        subject: envelope.subject,
        sender: indexedAddresses(from, senderLabel),
        recipients: indexedAddresses([...to, ...cc, ...body.bcc]),
        body: indexedBodyText(body),
        fetchedAt: now
      }

      writes.push(
        this.prisma.messageBody.upsert({
          where: { accountId_messageKey: { accountId, messageKey } },
          create: { accountId, messageKey, ...indexed },
          update: indexed
        })
      )

      const hasAttachments = body.attachments.length > 0
      const searchTo = addressesSearchText([...to, ...cc, ...body.bcc])

      for (const row of keyed) {
        if (
          row.hasAttachments !== hasAttachments ||
          row.preview !== body.preview ||
          !row.previewHydrated ||
          (body.bcc.length > 0 && row.bccJson === '[]') ||
          (carriedName !== null && row.senderLabel !== senderLabel)
        ) {
          changedRowIds.push(row.id)
        }
      }

      writes.push(
        this.prisma.message.updateMany({
          where: { accountId, messageKey },
          data: {
            bccJson: JSON.stringify(body.bcc),
            hasAttachments,
            preview: body.preview,
            previewHydrated: true,
            searchPreview: foldSearchText(body.preview),
            searchTo,
            ...(carriedName
              ? {
                  fromJson: JSON.stringify(from),
                  senderName: carriedName,
                  senderLabel,
                  senderSort: senderSortKey(senderLabel),
                  searchFrom: `${foldSearchText(senderLabel)} ${addressesSearchText(from)}`
                }
              : {}),
            updatedAt: now
          }
        })
      )
      learned.push(...body.bcc)
    }

    if (writes.length === 0) {
      return []
    }

    await this.prisma.$transaction(writes)
    this.indexGeneration += 1
    this.learnContacts(learned)

    if (changedRowIds.length === 0) {
      return []
    }

    const changed = await this.prisma.message.findMany({
      where: { id: { in: changedRowIds } },
      select: MESSAGE_SUMMARY_SELECT
    })

    return changed.map((row) => this.mapMessageRowToSummary(row))
  }

  /** Every message of a folder read, its other flags kept: one statement, however many. */
  async markFolderRead(accountId: string, folderPath: string): Promise<void> {
    await this.ready

    const seen = '\\Seen'

    await this.prisma.$executeRaw`
      UPDATE messages
      SET is_read = 1,
          flags_json = json_insert(flags_json, '$[#]', ${seen}),
          updated_at = ${BigInt(Date.now())}
      WHERE account_id = ${accountId}
        AND folder_path = ${folderPath}
        AND NOT EXISTS (SELECT 1 FROM json_each(flags_json) WHERE value = ${seen})
    `
    await this.prisma.$executeRaw`
      UPDATE folders SET unseen_count = 0
      WHERE account_id = ${accountId} AND path = ${folderPath}
    `
  }

  /**
   * Adds or removes one IMAP keyword on several messages of one folder,
   * leaving their other flags alone, in one transaction. Returns the rows as
   * they are now, for the views to adopt.
   */
  async setMessagesFlag(
    accountId: string,
    folderPath: string,
    uids: number[],
    flag: string,
    present: boolean
  ): Promise<MailMessageSummary[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath, uid: { in: uids } },
      select: { uid: true, flagsJson: true }
    })
    const now = BigInt(Date.now())

    await this.prisma.$transaction(
      rows.map((row) => {
        const current = parseJsonArray<string>(row.flagsJson).filter(
          (value) => typeof value === 'string'
        )
        const flags = present
          ? Array.from(new Set([...current, flag]))
          : current.filter((value) => value !== flag)

        return this.prisma.message.updateMany({
          where: { accountId, folderPath, uid: row.uid },
          data: {
            flagsJson: JSON.stringify(flags),
            isRead: flags.includes('\\Seen'),
            isFlagged: flags.includes('\\Flagged'),
            updatedAt: now
          }
        })
      })
    )

    const updated = await this.prisma.message.findMany({
      where: { accountId, folderPath, uid: { in: uids } },
      select: MESSAGE_SUMMARY_SELECT
    })

    return updated.map((row) => this.mapMessageRowToSummary(row))
  }

  /**
   * Carries messages a MOVE took to another folder of the account along in
   * the cache, under the UIDs the server gave them there (COPYUID, RFC 4315):
   * they show in the destination at once, with the bodies already
   * downloaded, instead of disappearing until its next sync fetches them
   * again. A row a sync already brought in under the new UID gives way.
   * Returns the rows as they are now in the destination.
   */
  async relocateMessages(
    accountId: string,
    sourceFolderPath: string,
    destinationFolderPath: string,
    uidMap: ReadonlyMap<number, number>
  ): Promise<MailMessageSummary[]> {
    await this.ready

    if (uidMap.size === 0) {
      return []
    }

    const pairs = [...uidMap]
    const now = BigInt(Date.now())
    const arrived = {
      accountId,
      folderPath: destinationFolderPath,
      uid: { in: pairs.map(([, destinationUid]) => destinationUid) }
    }
    const arrivedKeys = (
      await this.prisma.message.findMany({ where: arrived, select: { messageKey: true } })
    ).map((row) => row.messageKey)

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: arrived }),
      ...pairs.map(([sourceUid, destinationUid]) =>
        this.prisma.message.updateMany({
          where: { accountId, folderPath: sourceFolderPath, uid: sourceUid },
          data: {
            id: this.makeMessagePrimaryId(accountId, destinationFolderPath, destinationUid),
            folderPath: destinationFolderPath,
            uid: destinationUid,
            updatedAt: now
          }
        })
      )
    ])

    await this.markKeysLeft(accountId, arrivedKeys)
    this.indexGeneration += 1
    const rows = await this.prisma.message.findMany({
      where: arrived,
      select: MESSAGE_SUMMARY_SELECT
    })

    return rows.map((row) => this.mapMessageRowToSummary(row))
  }

  /**
   * Overwrites the whole keyword set. Only correct when the caller genuinely
   * knows every flag the server holds — i.e. straight off an IMAP FETCH.
   */
  async replaceMessageFlags(
    accountId: string,
    folderPath: string,
    uid: number,
    flags: string[]
  ): Promise<MailMessageSummary | null> {
    await this.ready

    await this.prisma.message.updateMany({
      where: { accountId, folderPath, uid },
      data: {
        flagsJson: JSON.stringify(flags),
        isRead: flags.includes('\\Seen'),
        isFlagged: flags.includes('\\Flagged'),
        updatedAt: BigInt(Date.now())
      }
    })

    const row = await this.prisma.message.findUnique({
      where: {
        accountId_folderPath_uid: { accountId, folderPath, uid }
      },
      select: MESSAGE_SUMMARY_SELECT
    })

    if (!row) {
      return null
    }

    return this.mapMessageRowToSummary(row)
  }

  close(): void {
    for (const timer of [this.contactFlushTimer, this.sentRecountTimer]) {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }

    void this.prisma.$disconnect()
  }

  private async initialize(): Promise<void> {
    await this.prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL')
    await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('gmail', 'imap')),
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_secure INTEGER NOT NULL,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        smtp_secure INTEGER NOT NULL,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'oauth')),
        encrypted_secret TEXT NOT NULL,
        last_viewed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.ensureAccountLastViewedAtColumn()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    for (const statement of MESSAGE_ID_KEYS_SCHEMA) {
      await this.prisma.$executeRawUnsafe(statement)
    }

    await this.resetCacheIfOutdated()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        delimiter TEXT,
        special_use TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        unseen_count INTEGER NOT NULL DEFAULT 0,
        uid_validity TEXT,
        highest_modseq TEXT,
        last_known_uid INTEGER,
        uid_next INTEGER,
        last_synced_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, path)
      )
    `)

    // A folder's sync state, by UID (see `LeftOutMessages`): what the server
    // has there that the cache leaves out on purpose, and why.
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS left_out_messages (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        uid INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK(reason IN ('deleted', 'unreadable')),
        failures INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER,
        PRIMARY KEY(account_id, folder_path, uid)
      )
    `)

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        uid INTEGER NOT NULL,
        message_key TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        message_id TEXT,
        subject TEXT NOT NULL,
        subject_sort TEXT NOT NULL DEFAULT '',
        from_json TEXT NOT NULL,
        to_json TEXT NOT NULL,
        cc_json TEXT NOT NULL,
        bcc_json TEXT NOT NULL DEFAULT '[]',
        date_iso TEXT NOT NULL,
        preview TEXT NOT NULL,
        preview_hydrated INTEGER NOT NULL DEFAULT 0,
        flags_json TEXT NOT NULL,
        is_read INTEGER NOT NULL,
        is_flagged INTEGER NOT NULL DEFAULT 0,
        sender_name TEXT NOT NULL DEFAULT '',
        sender_key TEXT NOT NULL DEFAULT '',
        sender_label TEXT NOT NULL DEFAULT '',
        sender_sort TEXT NOT NULL DEFAULT '',
        has_attachments INTEGER NOT NULL,
        size INTEGER NOT NULL,
        search_from TEXT NOT NULL DEFAULT '',
        search_to TEXT NOT NULL DEFAULT '',
        search_subject TEXT NOT NULL DEFAULT '',
        search_preview TEXT NOT NULL DEFAULT '',
        pec_kind TEXT,
        pec_ref TEXT,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, folder_path, uid)
      )
    `)
    // A PEC receipt finds the message sent it is about by the Message-ID the sender gave it.
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_pec_ref ON messages(account_id, pec_ref) WHERE pec_ref IS NOT NULL'
    )

    // A message's body once, however many folders hold it (see
    // `message-identity.ts`), with the words the index reads. `level` says
    // what was downloaded: 1 the text alone, 2 the message as the reader
    // shows it, the pictures its text draws included.
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS message_bodies (
        id INTEGER PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        message_key TEXT NOT NULL,
        level INTEGER NOT NULL,
        html TEXT,
        text TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        reply_to_json TEXT NOT NULL DEFAULT '[]',
        references_json TEXT NOT NULL DEFAULT '[]',
        pec_json TEXT,
        subject TEXT NOT NULL DEFAULT '',
        sender TEXT NOT NULL DEFAULT '',
        recipients TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        fetched_at INTEGER NOT NULL,
        UNIQUE(account_id, message_key)
      )
    `)
    await this.ensureMessageIndex()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS search_hits (
        token TEXT NOT NULL,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        PRIMARY KEY (token, message_id)
      )
    `)
    // Matches of a search are only good for the session that made them.
    await this.prisma.$executeRawUnsafe('DELETE FROM search_hits')

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS contacts (
        email_normalized TEXT PRIMARY KEY,
        email_address TEXT NOT NULL,
        display_name TEXT,
        name_normalized TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL,
        last_received_at INTEGER,
        hidden_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.ensureContactColumns()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS account_signatures (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        html TEXT NOT NULL,
        html_format INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.ensureSignatureColumns()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS recent_files (
        path TEXT PRIMARY KEY,
        activity TEXT NOT NULL,
        used_at INTEGER NOT NULL
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_recent_files_used_at ON recent_files(used_at DESC)'
    )

    // What an extension did with a message outside the mail (`MessageMark`): kept with the mail,
    // not the Segretario — it shows with the AI off — and gone with its account.
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS message_marks (
        extension TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        message_key TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        from_address TEXT,
        label TEXT NOT NULL,
        place TEXT NOT NULL DEFAULT '',
        files_json TEXT NOT NULL DEFAULT '[]',
        marked_at INTEGER NOT NULL,
        PRIMARY KEY (extension, account_id, message_key, place)
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_message_marks_message ON message_marks(account_id, message_key)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_message_marks_thread ON message_marks(account_id, thread_id)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_message_marks_from ON message_marks(from_address)'
    )

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS recent_folders (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        used_at INTEGER NOT NULL,
        PRIMARY KEY(account_id, folder_path)
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_recent_folders_account_used_at ON recent_folders(account_id, used_at)'
    )

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        source_account_id TEXT,
        to_json TEXT NOT NULL DEFAULT '[]',
        cc_json TEXT NOT NULL DEFAULT '[]',
        bcc_json TEXT NOT NULL DEFAULT '[]',
        subject TEXT NOT NULL DEFAULT '',
        html TEXT NOT NULL DEFAULT '',
        in_reply_to TEXT,
        references_json TEXT NOT NULL DEFAULT '[]',
        original_json TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 0,
        server_revision INTEGER NOT NULL DEFAULT 0,
        server_account_id TEXT,
        server_folder TEXT,
        server_uid INTEGER,
        server_saved_at INTEGER,
        docked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_drafts_account ON drafts(account_id)'
    )

    // The messages sent while the server could not be reached: each goes by itself once it can.
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        draft_id TEXT,
        payload_json TEXT NOT NULL,
        queued_at INTEGER NOT NULL
      )
    `)

    // The notifications given only once — a reminder, the day's letter —, with when: a launch,
    // a wake, does not give them again (§13.3). Kept two days.
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS notifications_given (
        key TEXT PRIMARY KEY,
        at INTEGER NOT NULL
      )
    `)
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM notifications_given WHERE at < ${Date.now() - 2 * 24 * 60 * 60 * 1000}`
    )

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_preferences (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        unified_inbox_included_account_ids TEXT,
        theme_mode TEXT NOT NULL DEFAULT 'system',
        layout_mode TEXT NOT NULL DEFAULT 'apple',
        invert_message_list_default_order INTEGER NOT NULL DEFAULT 0,
        message_list_sort_field TEXT NOT NULL DEFAULT 'date',
        message_list_sort_direction TEXT NOT NULL DEFAULT 'desc',
        message_grouping TEXT NOT NULL DEFAULT 'auto',
        reader_zoom INTEGER NOT NULL DEFAULT 100,
        reader_details_open INTEGER NOT NULL DEFAULT 0,
        shortcut_overrides TEXT NOT NULL DEFAULT '{}',
        notification_preferences TEXT NOT NULL DEFAULT '{}',
        new_event_calendar_key TEXT,
        new_event_minutes INTEGER NOT NULL DEFAULT 60,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.ensureAppPreferencesColumns()

    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_accounts_last_viewed ON accounts(last_viewed_at DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_folders_account ON folders(account_id)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(account_id, folder_path, date_iso DESC)'
    )
    // Sender order moved from the raw address to `sender_sort`; the index
    // that served the old ORDER BY only slowed every write down.
    await this.prisma.$executeRawUnsafe('DROP INDEX IF EXISTS idx_messages_folder_sender')
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_sender_sort ON messages(account_id, folder_path, sender_sort)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_sender_key ON messages(sender_key)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_subject_sort ON messages(account_id, folder_path, subject_sort)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_flagged ON messages(account_id, folder_path, is_flagged)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_date_uid ON messages(account_id, folder_path, date_iso DESC, uid DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_uid ON messages(account_id, folder_path, uid DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_key ON messages(account_id, message_key)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(account_id, thread_id)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_contacts_last_used ON contacts(last_used_at DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_contacts_name_normalized ON contacts(name_normalized)'
    )
    await this.copiesToMarks()
    await ensureAiSchema(prismaSql(this.prisma))
    await this.ensureCalendarTables()
    await this.prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO app_preferences(id, unified_inbox_included_account_ids, updated_at)
      VALUES (${APP_PREFERENCES_SINGLETON_ID}, NULL, ${Date.now()})
    `)
    await this.refileIfOutdated()

    if (this.contactsOutdated) {
      await this.rebuildContacts()
    }
  }

  /**
   * Migrates the `app_preferences` singleton to add any new columns
   * introduced after the initial schema. SQLite doesn't support
   * `ADD COLUMN IF NOT EXISTS`, so we probe the existing layout with
   * `PRAGMA table_info` and only ALTER the table when a column is
   * missing. Default values are baked into the ALTER so existing rows
   * pick up the new field without a separate UPDATE pass.
   */
  private async ensureAppPreferencesColumns(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe(
      'PRAGMA table_info(app_preferences)'
    )) as Array<{ name?: string }>
    const columnNames = new Set(columns.map((column) => column.name ?? ''))

    const additions: Array<[column: string, definition: string]> = [
      ['invert_message_list_default_order', 'INTEGER NOT NULL DEFAULT 0'],
      ['layout_mode', "TEXT NOT NULL DEFAULT 'apple'"],
      ['message_list_sort_field', "TEXT NOT NULL DEFAULT 'date'"],
      ['message_list_sort_direction', "TEXT NOT NULL DEFAULT 'desc'"],
      ['message_grouping', "TEXT NOT NULL DEFAULT 'auto'"],
      ['reader_zoom', 'INTEGER NOT NULL DEFAULT 100'],
      ['reader_details_open', 'INTEGER NOT NULL DEFAULT 0'],
      ['shortcut_overrides', "TEXT NOT NULL DEFAULT '{}'"],
      ['theme_mode', "TEXT NOT NULL DEFAULT 'system'"],
      ['notification_preferences', "TEXT NOT NULL DEFAULT '{}'"],
      ['new_event_calendar_key', 'TEXT'],
      ['new_event_minutes', 'INTEGER NOT NULL DEFAULT 60']
    ]

    for (const [column, definition] of additions) {
      if (!columnNames.has(column)) {
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE app_preferences ADD COLUMN ${column} ${definition}`
        )
      }
    }

    // The edition of an extension's signature, counted before 2.0: nothing reads it any more.
    if (columnNames.has('extension_signature_revision')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE app_preferences DROP COLUMN extension_signature_revision'
      )
    }

    // 'date' grouping became 'auto': it still buckets by date under a date
    // sort, and now also groups by sender under a sender sort.
    await this.prisma.$executeRawUnsafe(
      "UPDATE app_preferences SET message_grouping = 'auto' WHERE message_grouping = 'date'"
    )
  }

  /**
   * Reads every persisted view preference in one go. Unknown or corrupted
   * values fall back to the shared defaults instead of failing the read —
   * a preference row can never be a reason the workspace refuses to open.
   */
  async getUiPreferences(): Promise<UiPreferences> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT theme_mode AS themeMode,
             layout_mode AS layoutMode,
             invert_message_list_default_order AS invertOrder,
             message_list_sort_field AS sortField,
             message_list_sort_direction AS sortDirection,
             message_grouping AS grouping,
             reader_zoom AS readerZoom,
             reader_details_open AS readerDetailsOpen,
             shortcut_overrides AS shortcutOverrides,
             new_event_calendar_key AS newEventCalendarKey,
             new_event_minutes AS newEventMinutes
      FROM app_preferences
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
      LIMIT 1
    `) as Array<{
      themeMode?: unknown
      layoutMode?: unknown
      invertOrder?: unknown
      sortField?: unknown
      sortDirection?: unknown
      grouping?: unknown
      readerZoom?: unknown
      readerDetailsOpen?: unknown
      shortcutOverrides?: unknown
      newEventCalendarKey?: unknown
      newEventMinutes?: unknown
    }>

    const row = rows[0]

    if (!row) {
      return DEFAULT_UI_PREFERENCES
    }

    return {
      themeMode: pickFromAllowedValues(row.themeMode, THEME_MODES, DEFAULT_THEME_MODE),
      layoutMode: pickFromAllowedValues(
        row.layoutMode,
        MAIL_LAYOUT_MODES,
        DEFAULT_MAIL_LAYOUT_MODE
      ),
      invertMessageListOrder: toBooleanFlag(row.invertOrder),
      messageListSort: {
        field: pickFromAllowedValues(
          row.sortField,
          MESSAGE_LIST_SORT_FIELDS,
          DEFAULT_MESSAGE_LIST_SORT_FIELD
        ),
        direction: pickFromAllowedValues(
          row.sortDirection,
          MESSAGE_LIST_SORT_DIRECTIONS,
          DEFAULT_MESSAGE_LIST_SORT_DIRECTION
        )
      },
      messageGrouping: pickFromAllowedValues(
        row.grouping,
        MESSAGE_GROUPING_MODES,
        DEFAULT_MESSAGE_GROUPING_MODE
      ),
      readerZoom: clampReaderZoom(toFiniteNonNegativeNumber(row.readerZoom) || READER_ZOOM_DEFAULT),
      readerDetailsOpen: toBooleanFlag(row.readerDetailsOpen),
      shortcutOverrides: sanitizeShortcutOverrides(parseJsonObject(row.shortcutOverrides)),
      newEventCalendarKey:
        typeof row.newEventCalendarKey === 'string' && row.newEventCalendarKey
          ? row.newEventCalendarKey
          : null,
      newEventMinutes: NEW_EVENT_MINUTES.includes(
        Number(row.newEventMinutes) as (typeof NEW_EVENT_MINUTES)[number]
      )
        ? Number(row.newEventMinutes)
        : NEW_EVENT_MINUTES_DEFAULT
    }
  }

  async setUiPreferences(preferences: UiPreferences): Promise<void> {
    await this.ready

    await this.prisma.$executeRaw`
      UPDATE app_preferences
      SET theme_mode = ${preferences.themeMode},
          layout_mode = ${preferences.layoutMode},
          invert_message_list_default_order = ${preferences.invertMessageListOrder ? 1 : 0},
          message_list_sort_field = ${preferences.messageListSort.field},
          message_list_sort_direction = ${preferences.messageListSort.direction},
          message_grouping = ${preferences.messageGrouping},
          reader_zoom = ${preferences.readerZoom},
          reader_details_open = ${preferences.readerDetailsOpen ? 1 : 0},
          shortcut_overrides = ${JSON.stringify(sanitizeShortcutOverrides(preferences.shortcutOverrides))},
          new_event_calendar_key = ${preferences.newEventCalendarKey},
          new_event_minutes = ${preferences.newEventMinutes},
          updated_at = ${Date.now()}
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
    `
  }

  /**
   * Rows written before signatures had a format get the column with the
   * value 1, which is exactly what they are: authored against the old page.
   */
  private async ensureSignatureColumns(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe(
      'PRAGMA table_info(account_signatures)'
    )) as Array<{ name?: string }>

    if (!columns.some((column) => column.name === 'html_format')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE account_signatures ADD COLUMN html_format INTEGER NOT NULL DEFAULT 1'
      )
    }

    // The edition of an extension's signature, counted before 2.0: nothing reads it any more.
    if (columns.some((column) => column.name === 'extension_revision')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE account_signatures DROP COLUMN extension_revision'
      )
    }
  }

  /**
   * Contacts stored before they counted the mail written to them get the
   * columns, and `initialize` learns them all again (`rebuildContacts`).
   */
  private async ensureContactColumns(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe('PRAGMA table_info(contacts)')) as Array<{
      name?: string
    }>

    if (columns.some((column) => column.name === 'last_received_at')) {
      return
    }

    await this.prisma.$executeRawUnsafe('ALTER TABLE contacts ADD COLUMN last_received_at INTEGER')
    await this.prisma.$executeRawUnsafe('ALTER TABLE contacts ADD COLUMN hidden_at INTEGER')
    this.contactsOutdated = true
  }

  private async ensureAccountLastViewedAtColumn(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe('PRAGMA table_info(accounts)')) as Array<{
      name?: string
    }>
    const hasLastViewedAt = columns.some((column) => column.name === 'last_viewed_at')

    if (hasLastViewedAt) {
      return
    }

    await this.prisma.$executeRawUnsafe('ALTER TABLE accounts ADD COLUMN last_viewed_at INTEGER')
  }

  /**
   * An account as the app speaks of it. Certified (PEC) when its server is a
   * known PEC provider's, or — `hasPecMail`, from the accounts' list —
   * certified envelopes and receipts came to it.
   */
  private mapAccountRow(row: {
    id: string
    type: string
    email: string
    displayName: string
    imapHost: string
    imapPort: number
    imapSecure: boolean
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    username: string
    authType: string
    createdAt: bigint
    updatedAt: bigint
    hasPecMail?: number | bigint | boolean
  }): MailAccount {
    return {
      pec: isPecServer(row.imapHost) || Boolean(Number(row.hasPecMail ?? 0)),
      id: row.id,
      type: row.type as MailAccount['type'],
      email: row.email,
      displayName: row.displayName,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecure: row.imapSecure,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      username: row.username,
      authType: row.authType as MailAccount['authType'],
      createdAt: toNumber(row.createdAt),
      updatedAt: toNumber(row.updatedAt)
    }
  }

  private makeMessagePrimaryId(accountId: string, folderPath: string, uid: number): string {
    return `${accountId}:${folderPath}:${uid}`
  }
}
