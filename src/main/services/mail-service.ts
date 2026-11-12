import { randomUUID } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { connect as netConnect } from 'node:net'
import { basename, join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'

import { BrowserWindow, dialog, net, shell } from 'electron'
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { z } from 'zod'

import type { DiscoveredMailSettings } from '@shared/connections'
import { diagnostics } from '@main/diagnostics/log'
import { messages } from '@main/i18n'
import type {
  AccountConnectionState,
  ConnectionRefusal,
  ConnectionRefusedNotice,
  ActiveMailboxContext,
  AddImapAccountInput,
  AppBootstrap,
  ComposeMailInput,
  CreateFolderInput,
  MoveMessagesToRoleInput,
  RenameFolderInput,
  AttachmentRef,
  CopiedAttachment,
  FetchedMessageDetail,
  ListMessagesOptions,
  MailAccount,
  MailAccountSignature,
  MailAddress,
  MailContactSuggestion,
  MailFolder,
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
  DraftContent,
  DraftStatus,
  StoredDraft,
  UiPreferences,
  UnifiedFolderSummary,
  UnifiedPreferences
} from '@shared/models'
import { isValidEmailAddress } from '@shared/email-address'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  folderDisplayRank,
  folderForRole,
  folderRole,
  segretarioSearch,
  segretarioProject,
  segretarioView,
  SEGRETARIO_VIEWS,
  UNIFIED_FOLDER_ROLES,
  unifiedFolderRole,
  type FolderRole,
  type SegretarioView
} from '@shared/folders'
import {
  mailRefusedNotice,
  MAX_MESSAGES_PER_ACTION,
  MESSAGE_LIST_PAGE_SIZE,
  READER_ZOOM_MAX,
  READER_ZOOM_MIN,
  NEW_EVENT_MINUTES
} from '@shared/models'
import { parseSearchQuery } from '@shared/search'

import {
  accountAttachmentCacheDirectory,
  attachmentCacheRoot,
  attachmentCopyDirectory,
  clearAttachmentCache,
  fileSha256,
  isExecutableAttachment,
  markFromInternet,
  sha256
} from './attachment-files'
import { getAppWindow } from '@main/app-window'
import type { SegretarioService } from '@main/ai/segretario-service'
import { invitationReply } from '@main/calendar/icalendar'
import { isIcsAttachment, type CalendarResponse } from '@shared/calendar'
import type { MarkedBefore, MessageMark, MessageMarksChange } from '@shared/message-marks'
import type { MessageLocation, SegretarioMailPort } from '@main/ai/agent/tool-types'
import type { NotificationCenter } from '@main/notifications/center'
import { DraftService, draftFilesRoot, draftRefKey } from './drafts'
import type { AppDatabase, MessageListView } from './database'
import { resolveUniqueFilePath, sanitizePathSegment } from './file-utils'
import type { GoogleAuthResult, GoogleOAuthService } from './google-oauth'
import { discoverMailSettings } from './mail-discovery'
import { refusalClause, refusalOf, serverWords } from './connection-refusal'
import { INVITATION_ANSWERS, MESSAGES } from './mail-service.messages'
import { MailTokenBroker } from './mail-tokens'
import {
  MICROSOFT_MAIL_SCOPES,
  type MicrosoftAuthResult,
  type MicrosoftOAuthService
} from './microsoft-oauth'
import { MailEngine } from './mail-engine'
import type { RawMessage } from './mail-engine/account-connection'
import { indexedFolderPaths } from './mail-engine/mail-indexer'
import { sendFailureOf } from './mail-engine/send-failure'
import { imapSearchGroups } from './mail-engine/server-search'
import {
  buildRawOutgoingMessage,
  createOutgoingMessagePayload,
  createSmtpTransport,
  verifyImapAccount,
  verifyImapLogin,
  type AccountWithSecret,
  type OutgoingMessagePayload
} from './mail-engine/mail-transport'
import { updateAppMenuShortcuts } from '../app-menu'
import { applyThemeMode } from '../theme'
import { canonicalPath, reachablePath } from './network-volumes'
import { isUserFile, listRecentFiles, privateFolders } from './recent-files'
import { decryptSecret, encryptSecret } from './secure-storage'

const log = diagnostics('mail')

const imapAccountSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().trim().min(1),
  imapHost: z.string().trim().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean()
})

/** A recipient as the composer hands it over, its address checked as the composer checks it. */
const recipientSchema = z.object({
  name: z.string().trim().max(256).optional(),
  address: z
    .string()
    .trim()
    .refine(isValidEmailAddress, {
      error: (issue) => messages(MESSAGES).invalidAddress(String(issue.input))
    })
})

const composeSchema = z
  .object({
    accountId: z.string().trim().min(1),
    draftId: z.string().uuid().optional(),
    to: z.array(recipientSchema),
    cc: z.array(recipientSchema),
    bcc: z.array(recipientSchema),
    subject: z.string().trim(),
    html: z.string(),
    text: z.string(),
    inReplyTo: z.string().optional(),
    references: z.array(z.string()).optional(),
    attachments: z.array(
      z.object({
        path: z.string().min(1),
        name: z.string().optional()
      })
    )
  })
  .refine((payload) => payload.to.length + payload.cc.length + payload.bcc.length > 0, {
    error: () => messages(MESSAGES).addRecipient
  })

const messageRefSchema = z.object({
  accountId: z.string().trim().min(1),
  folderPath: z.string().trim().min(1),
  uid: z.number().int().positive()
})
/** The messages around the one being read are fetched ahead, a few at a time. */
const MAX_PREFETCHED_MESSAGES = 8
/** Previews asked for at once: the rows a list can hold. */
const MAX_HYDRATED_PREVIEWS = 2_000
const messageRefsSchema = z.array(messageRefSchema).max(MAX_MESSAGES_PER_ACTION)
const moveMessagesSchema = z.object({
  refs: messageRefsSchema,
  destinationFolderPath: z.string().trim().min(1)
})
const moveMessagesToRoleSchema = z.object({
  refs: messageRefsSchema,
  role: z.enum(UNIFIED_FOLDER_ROLES as [FolderRole, ...FolderRole[]])
})
const renameFolderSchema = z.object({
  accountId: z.string().trim().min(1),
  folderPath: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200)
})
const createFolderSchema = z.object({
  accountId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  parentPath: z.string().trim().min(1).optional()
})
const setMessagesKeywordSchema = z.object({
  refs: messageRefsSchema,
  present: z.boolean()
})
const attachmentRefSchema = z.object({
  ref: messageRefSchema,
  attachmentId: z.string().trim().min(1)
})
const messageAttachmentsRefSchema = z.object({
  ref: messageRefSchema,
  attachmentIds: z.array(z.string().trim().min(1)).min(1).max(200)
})
const filePathsSchema = z.array(z.string().min(1)).max(200)

const RECENT_FILES_OFFERED = 8
const activeMailboxContextSchema = z.object({
  accountId: z.string().trim().min(1),
  folderPath: z.string().trim().min(1)
})
const MAX_ACCOUNT_SIGNATURE_HTML_LENGTH = 32000
const accountSignatureInputSchema = z.object({
  accountId: z.string().trim().min(1),
  html: z.string().max(MAX_ACCOUNT_SIGNATURE_HTML_LENGTH),
  headerHtml: z.string().max(MAX_ACCOUNT_SIGNATURE_HTML_LENGTH)
})

/** Recipients a draft keeps, as typed — valid addresses or not. */
const MAX_DRAFT_RECIPIENTS = 2_000
/** Long enough for the drafts being written to reach Bozze; never long enough to hold the quit up. */
const DRAFT_FLUSH_ON_QUIT_MS = 4_000
/** How often the outbox is tried while it holds something and the network is there. */
const OUTBOX_EVERY_MS = 20_000

const draftAddressSchema = z.object({
  name: z.string().max(256).optional(),
  address: z.string().trim().min(1).max(320)
})

const draftContentSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['new', 'reply', 'forward']),
  accountId: z.string().trim().min(1),
  sourceAccountId: z.string().trim().min(1).optional(),
  to: z.array(draftAddressSchema).max(MAX_DRAFT_RECIPIENTS),
  cc: z.array(draftAddressSchema).max(MAX_DRAFT_RECIPIENTS),
  bcc: z.array(draftAddressSchema).max(MAX_DRAFT_RECIPIENTS),
  subject: z.string().max(2_000),
  html: z.string(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  original: z
    .object({
      ref: z.object({
        accountId: z.string().trim().min(1),
        folderPath: z.string().trim().min(1),
        uid: z.number().int().positive()
      }),
      attachments: z.array(z.looseObject({ id: z.string(), fileName: z.string() }))
    })
    .optional(),
  attachments: z.array(
    z.object({
      name: z.string(),
      size: z.number().nonnegative(),
      path: z.string().min(1).optional(),
      originalId: z.string().optional(),
      failed: z.boolean().optional()
    })
  )
})

const uiPreferencesSchema = z.object({
  themeMode: z.enum(['system', 'light', 'dark']),
  layoutMode: z.enum(['apple', 'outlook']),
  invertMessageListOrder: z.boolean(),
  messageListSort: z.object({
    field: z.enum(['date', 'sender', 'subject', 'size']),
    direction: z.enum(['asc', 'desc'])
  }),
  messageGrouping: z.enum(['none', 'auto', 'sender']),
  readerZoom: z.number().int().min(READER_ZOOM_MIN).max(READER_ZOOM_MAX),
  readerDetailsOpen: z.boolean(),
  shortcutOverrides: z.record(z.string(), z.string()),
  newEventCalendarKey: z.string().min(1).nullable(),
  newEventMinutes: z
    .number()
    .refine((minutes) => (NEW_EVENT_MINUTES as ReadonlyArray<number>).includes(minutes))
})

const unifiedInboxIncludedAccountsSchema = z.array(z.string().trim().min(1))

const CONTACT_SUGGESTION_LIMIT_DEFAULT = 12
const CONTACT_SUGGESTION_LIMIT_MAX = 30

function normalizeMessageListLimit(limit?: number): number {
  const parsedLimit = Number(limit)

  if (!Number.isFinite(parsedLimit)) {
    return MESSAGE_LIST_PAGE_SIZE
  }

  return Math.max(MESSAGE_LIST_PAGE_SIZE, Math.floor(parsedLimit))
}

function parseAttachmentIndex(attachmentId: string): number {
  const trimmedAttachmentId = attachmentId.trim()

  if (/^\d+$/.test(trimmedAttachmentId)) {
    return Number.parseInt(trimmedAttachmentId, 10)
  }

  const prefixedMatch = trimmedAttachmentId.match(/^att-(\d+)$/i)

  if (prefixedMatch) {
    return Number.parseInt(prefixedMatch[1] || '', 10)
  }

  const uidPrefixedMatch = trimmedAttachmentId.match(/^\d+-(\d+)$/)

  if (uidPrefixedMatch) {
    return Number.parseInt(uidPrefixedMatch[1] || '', 10)
  }

  throw new Error('Attachment identifier is invalid.')
}

function normalizeAccountSignatureHtml(rawHtml: string): string | null {
  const withoutNullChars = rawHtml.split('\u0000').join('')
  const trimmed = withoutNullChars.trim()

  if (!trimmed) {
    return null
  }

  // A rule or a table shows as much as a picture: a letterhead can be just a line.
  const hasEmbeddedMedia = /<(?:img|svg|video|audio|hr|table)\b/i.test(trimmed)
  const visibleText = trimmed
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!visibleText && !hasEmbeddedMedia) {
    return null
  }

  return trimmed
}

/** The mailboxes some messages are filed in, each once. */
function mailboxesOf(
  refs: ReadonlyArray<MessageRef>
): Array<{ accountId: string; folderPath: string }> {
  const seen = new Map<string, { accountId: string; folderPath: string }>()

  for (const ref of refs) {
    seen.set(`${ref.accountId}\u0000${ref.folderPath}`, {
      accountId: ref.accountId,
      folderPath: ref.folderPath
    })
  }

  return [...seen.values()]
}

/**
 * A GET that hands a redirect back instead of following it, as `fetch` with
 * `redirect: 'manual'` means — which Electron's `net.fetch` turns into a
 * failure ("Redirect was cancelled"), so a config file behind a redirect was
 * never read. Still Chromium's network: the system's proxy and certificates.
 */
function fetchNotFollowing(url: string, init: { signal?: AbortSignal | null }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'manual', cache: 'no-store' })
    const abort = (): void => {
      request.abort()
      reject(init.signal?.reason ?? new Error(messages(MESSAGES).interrupted))
    }

    if (init.signal?.aborted) {
      abort()
      return
    }

    init.signal?.addEventListener('abort', abort, { once: true })
    const settle = (): void => init.signal?.removeEventListener('abort', abort)

    request.on('redirect', (status, _method, redirectUrl) => {
      settle()
      request.abort()
      resolve(new Response(null, { status, headers: { location: redirectUrl } }))
    })
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        settle()
        const headers = new Headers()

        for (const [name, value] of Object.entries(response.headers)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }

        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }))
      })
      response.on('error', (error: Error) => {
        settle()
        reject(error)
      })
    })
    request.on('error', (error) => {
      settle()
      reject(error)
    })
    request.end()
  })
}

/** Whether a mail server answers at an address and port, encrypted from the first byte or not, within a few seconds. */
function serverAnswers(host: string, port: number, secure: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host, timeout: 4_000 })
      : netConnect({ host, port, timeout: 4_000 })
    const done = (answered: boolean): void => {
      socket.destroy()
      resolve(answered)
    }

    socket.once(secure ? 'secureConnect' : 'connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** How an answer to an invitation is said, in its subject and in its line, as calendars say it. */
function invitationAnswer(
  response: Exclude<CalendarResponse, 'needsAction'>,
  name: string,
  summary: string
): { subject: string; body: string } {
  const m = messages(INVITATION_ANSWERS)

  switch (response) {
    case 'accepted':
      return { subject: m.acceptedSubject, body: m.acceptedBody(name, summary) }
    case 'tentative':
      return { subject: m.tentativeSubject, body: m.tentativeBody(name, summary) }
    case 'declined':
      return { subject: m.declinedSubject, body: m.declinedBody(name, summary) }
  }
}

/** A mailbox signed in with Microsoft: IMAP with OAuth, not Gmail. */
function isMicrosoftAccount(account: Pick<MailAccount, 'type' | 'authType'>): boolean {
  return account.type === 'imap' && account.authType === 'oauth'
}

/** The server turned SMTP sign-in off for the organisation or the mailbox (5.7.139). */
function smtpTurnedOff(error: unknown): boolean {
  const text = `${(error as { response?: string } | null)?.response ?? ''} ${error instanceof Error ? error.message : ''}`
  return /5\.7\.139|SmtpClientAuthentication is disabled/i.test(text)
}

/**
 * The folders of an account the Segretario reads — every one but the
 * Trash, Spam and Bozze — and the drafts' own, to leave drafts out where
 * a folder lists them too (Gmail's All Mail).
 */
function segretarioFolders(folders: ReadonlyArray<MailFolder>): {
  read: string[]
  drafts: string[]
} {
  const roles = folders.map((folder) => ({ path: folder.path, role: folderRole(folder) }))

  return {
    read: roles
      .filter(({ role }) => role !== '\\Trash' && role !== '\\Junk' && role !== '\\Drafts')
      .map(({ path }) => path),
    drafts: roles.filter(({ role }) => role === '\\Drafts').map(({ path }) => path)
  }
}

/** What the mail is given by the workspace that creates it (see `Workspace`). */
export interface MailServiceOptions {
  database: AppDatabase
  google: GoogleOAuthService
  microsoft: MicrosoftOAuthService
  /** The Segretario's lists the mail shows as its own: its views, its projects, its searches. */
  segretario: Pick<SegretarioService, 'viewKeys' | 'activeKeys' | 'searchRefs' | 'projectThreads'>
  /** Messages had their text indexed, or went away: what reads the mail may look again. */
  onMailChanged: () => void
  /** An account is about to go: the work that could still write about it stops, and waits (§11.4). */
  onAccountRemoving: (account: MailAccount) => Promise<void>
  /** An account went — or stayed, its removal cut short: what the other apps kept of it goes. */
  onAccountRemoved: (account: MailAccount) => Promise<void>
  /** A mailbox turned down for good, and stopped: the user is told, once. */
  onConnectionRefused: (notice: ConnectionRefusedNotice) => void
  /** The app's notifications: new mail, and a message of the outbox that did not go (§13.3). */
  notifications: NotificationCenter
  /** The unread messages of every mailbox's Posta in arrivo, whenever the count may have changed. */
  onInboxUnreadChange: (count: number) => void
}

export class MailService {
  private readonly database: AppDatabase
  private readonly googleOAuthService: GoogleOAuthService
  private readonly microsoftOAuthService: MicrosoftOAuthService
  /** The tokens of the mailboxes signed in with Google or Microsoft. */
  private readonly tokens: MailTokenBroker
  private readonly engine: MailEngine
  private readonly notifications: NotificationCenter
  private readonly drafts: DraftService
  private readonly segretario: MailServiceOptions['segretario']
  private readonly onAccountRemoving: MailServiceOptions['onAccountRemoving']
  private readonly onAccountRemoved: MailServiceOptions['onAccountRemoved']
  /** The mailboxes being removed now: they take no more work. */
  private readonly leaving = new Set<string>()
  // The copy of each attachment last written, and what it held, keyed by its
  // folder: an untouched copy is used again without a download.
  private readonly attachmentCopies = new Map<string, { filePath: string; digest: string }>()
  // The outbox's turn: messages sent while their server could not be reached go when it can.
  private outboxTimer: ReturnType<typeof setInterval> | null = null
  private sendingOutbox: Promise<void> | null = null
  /** The drafts whose message is leaving the outbox now: not sent again by hand meanwhile. */
  private readonly leavingOutbox = new Set<string>()

  constructor(options: MailServiceOptions) {
    this.database = options.database
    this.googleOAuthService = options.google
    this.microsoftOAuthService = options.microsoft
    this.segretario = options.segretario
    this.onAccountRemoving = options.onAccountRemoving
    this.onAccountRemoved = options.onAccountRemoved
    this.tokens = new MailTokenBroker(
      this.googleOAuthService,
      this.microsoftOAuthService,
      (accountId, secret) => this.database.setAccountSecret(accountId, encryptSecret(secret))
    )
    this.notifications = options.notifications
    this.engine = new MailEngine({
      database: this.database,
      tokens: this.tokens,
      getMainWindow: getAppWindow,
      notifications: options.notifications,
      onInboxUnreadChange: options.onInboxUnreadChange,
      onMailChanged: options.onMailChanged,
      onRefused: (accountId, refusal, detail) =>
        void this.database
          .getStoredAccountById(accountId)
          .then((account) => {
            if (account) {
              options.onConnectionRefused(mailRefusedNotice(account, refusal, detail))
            }
          })
          .catch((error: unknown) => log.error('A refused mailbox could not be told', error))
    })
    this.drafts = new DraftService({
      database: this.database,
      engine: this.engine,
      getAccount: async (accountId) => {
        const stored = await this.database.getStoredAccountById(accountId)
        return stored ? { ...stored, secret: decryptSecret(stored.encryptedSecret) } : null
      },
      onStatus: (status) =>
        getAppWindow()?.webContents.send(IPC_CHANNELS.draftStatusChanged, status)
    })
  }

  /**
   * What the Segretario reaches of the mail: the same operations the
   * user's own clicks call, so its work shows in the views as theirs does.
   */
  segretarioPort(): SegretarioMailPort {
    const markdown = new NodeHtmlMarkdown({ keepDataImages: false, maxConsecutiveNewlines: 2 })

    return {
      listAccounts: () => this.database.getAccounts(),
      accountSignatures: async () =>
        new Map(
          (await this.database.listAccountSignatures()).map((signature) => [
            signature.accountId,
            markdown.translate(signature.html).trim()
          ])
        ),
      listFolders: (accountId) => this.database.listFolders(accountId),
      // The planner asks every few seconds: one statement per account, however much is unread.
      unreadConversations: async (sinceOf, limit) => {
        const threads = new Map<
          string,
          {
            accountId: string
            threadId: string
            newest: string
            messages: Array<{ ref: MessageRef; messageKey: string; dateIso: string }>
          }
        >()

        for (const account of await this.database.getAccounts()) {
          const rows = await this.database.listUnreadConversations(
            account.id,
            segretarioFolders(await this.database.listFolders(account.id)),
            sinceOf(account.id),
            limit,
            limit
          )

          for (const row of rows) {
            const key = `${account.id}\u0000${row.threadId}`
            const thread = threads.get(key) ?? {
              accountId: account.id,
              threadId: row.threadId,
              newest: row.newest,
              messages: []
            }

            thread.messages.push({
              ref: { accountId: account.id, folderPath: row.folderPath, uid: row.uid },
              messageKey: row.messageKey,
              dateIso: row.dateIso
            })
            threads.set(key, thread)
          }
        }

        return [...threads.values()]
          .sort((a, b) => b.newest.localeCompare(a.newest))
          .slice(0, limit)
          .map(({ accountId, threadId, messages }) => ({ accountId, threadId, messages }))
      },
      readingProgress: async (sinceOf, accountIds) => {
        let read = 0
        let total = 0

        for (const account of (await this.database.getAccounts()).filter(
          (candidate) => !accountIds || accountIds.includes(candidate.id)
        )) {
          const progress = await this.database.readProgress(
            account.id,
            segretarioFolders(await this.database.listFolders(account.id)),
            sinceOf(account.id)
          )
          read += progress.read
          total += progress.total
        }

        return { read, total }
      },
      threadsFromSender: (accountId, address, sinceIso, limit) =>
        this.database.threadsFromSender(accountId, address.trim().toLowerCase(), sinceIso, limit),
      userWroteTo: async (addresses) => {
        const sent = await Promise.all(
          (await this.database.getAccounts()).map(async (account) => {
            const path = folderForRole(await this.database.listFolders(account.id), '\\Sent')?.path
            return path ? [{ accountId: account.id, folderPath: path }] : []
          })
        )
        return this.database.anySentTo(sent.flat(), addresses)
      },
      alert: async (message, line) =>
        this.engine.alert(message.accountId, message.messageKey, line),
      sameMessageElsewhere: async (ref) => {
        const messageId = (await this.database.getMessage(ref))?.messageId

        return messageId
          ? this.database.sameMessageElsewhere(
              ref.accountId,
              messageId,
              (await this.database.getAccounts()).map((account) => account.id)
            )
          : []
      },
      messageSummaries: (accountId, messageKeys) => this.bestRowsByKey(accountId, messageKeys),
      marksOf: (accountId, messageKeys) => this.database.marksOf(accountId, messageKeys),
      recentMarks: (extension, limit) => this.database.recentMarks(extension, limit),
      locate: (accountId, messageKeys) => this.locateMessages(accountId, messageKeys),
      threadKeys: async (accountId, threadId) =>
        this.database.threadMessageKeys(
          accountId,
          threadId,
          segretarioFolders(await this.database.listFolders(accountId)).read
        ),
      recentMailIndexed: async (accountId, days) =>
        this.database.recentMailIndexed(
          accountId,
          indexedFolderPaths(await this.database.listFolders(accountId)),
          new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        ),
      searchClient: () => this.database.storeClient(),
      searchServer: async (mailboxes, text, { background }) => {
        const groups = imapSearchGroups(parseSearchQuery(text))

        if (groups.length === 0) {
          return []
        }

        const found = await Promise.all(
          mailboxes.map(async (mailbox) =>
            (
              (await this.engine.searchMessages(mailbox, groups, {
                priority: background ? 'background' : 'user'
              })) ?? []
            ).map((uid) => ({ ...mailbox, uid }))
          )
        )
        return found.flat()
      },
      readMessage: async (ref) => {
        await this.ensureAccountExists(ref.accountId)
        let message = await this.database.getMessage(ref)

        if (!message) {
          throw new Error(messages(MESSAGES).messageNotInFolder)
        }

        let body = await this.database.getStoredBody(ref.accountId, message.messageKey)

        if (!body) {
          await this.engine.loadMessageBody(ref, message.size, 'use')
          message = (await this.database.getMessage(ref)) ?? message
          body = await this.database.getStoredBody(ref.accountId, message.messageKey)
        }

        const text = body?.text?.trim()
          ? body.text
          : body?.html
            ? markdown.translate(body.html)
            : ''

        return {
          ...(await this.withPecReceipts(message)),
          attachments: body?.attachments ?? message.attachments,
          replyTo: body?.replyTo ?? message.replyTo,
          references: body?.references ?? message.references,
          ...(body?.pecDetail ? { pecDetail: body.pecDetail } : {}),
          textForReading: text.replace(/\n{3,}/g, '\n\n').trim()
        }
      },
      attachmentContent: async (ref, attachment) => {
        const message = await this.requireMessage(ref)
        const [fetched] = await this.engine.fetchAttachments(
          ref,
          [{ index: parseAttachmentIndex(attachment.id), part: attachment.part }],
          message.size
        )

        if (!fetched) {
          throw new Error(messages(MESSAGES).attachmentUnavailable)
        }

        return { data: fetched.content, contentType: attachment.contentType }
      },
      copyAttachments: async (ref, attachmentIds) =>
        (await this.copyMessageAttachments({ ref, attachmentIds })).map((copy) => ({
          path: copy.path,
          name: copy.name
        })),
      archive: (refs) => this.archiveMessages(refs),
      move: (refs, destinationFolderPath) => this.moveMessages({ refs, destinationFolderPath }),
      setSeen: (refs, present) => this.setMessagesSeen({ refs, present }),
      setFlagged: (refs, present) => this.setMessagesFlagged({ refs, present }),
      // Never a deletion for good: a message already in the Trash stays there.
      trash: (refs) =>
        this.withDraftsLeaving(refs, (acting) => this.engine.moveMessagesToTrash(acting)),
      draftOfMessage: async (ref) =>
        folderForRole(await this.database.listFolders(ref.accountId), '\\Drafts')?.path ===
        ref.folderPath
          ? (await this.drafts.openMessage(ref)).content.id
          : null,
      draftsReplyingTo: async (ref) => {
        const messageId = (await this.database.getMessage(ref))?.messageId
        return messageId ? this.database.draftIdsReplyingTo(ref.accountId, messageId) : []
      },
      getDraft: async (draftId) => {
        const draft = await this.database.getDraft(draftId)

        if (!draft) {
          return null
        }

        const content = draft.content
        const addresses = (list: MailAddress[]): string[] =>
          list.map((address) =>
            address.name ? `${address.name} <${address.address}>` : address.address
          )

        return {
          accountId: content.accountId,
          to: addresses(content.to),
          cc: addresses(content.cc),
          bcc: addresses(content.bcc),
          subject: content.subject,
          text: markdown.translate(content.html).trim(),
          attachments: content.attachments.map((attachment) => attachment.name)
        }
      }
    }
  }

  async start(): Promise<void> {
    await this.engine.start()
    await this.drafts.resume()
    // First at the next round, not at once: the mailboxes have connected, or said they are refused.
    this.outboxTimer = setInterval(() => void this.sendOutbox(), OUTBOX_EVERY_MS)
  }

  /** Whether the Segretario reads new mail as it comes: an alert for new mail waits for its note. */
  setSegretarioReading(reading: boolean): void {
    this.engine.setSegretarioReading(reading)
  }

  /** Messages the Segretario read (§4.1): a new one waiting for its reading is not told. */
  messagesRead(accountId: string, messageKeys: ReadonlyArray<string>): void {
    this.engine.messagesRead(accountId, messageKeys)
  }

  /** The unread messages of every mailbox's Posta in arrivo, as the app's icon may count them. */
  inboxUnreadCount(): Promise<number> {
    return this.engine.inboxUnreadCount()
  }

  async stop(): Promise<void> {
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer)
      this.outboxTimer = null
    }

    // What is being written reaches Bozze before the connections close.
    await this.drafts
      .flushAll(DRAFT_FLUSH_ON_QUIT_MS)
      .catch((error: unknown) => log.error('Filing drafts on quit failed', error))
    await this.engine.stop()
  }

  /**
   * The raw sources of messages, of any account and folder, each handed to
   * `onMessage` as it arrives (see `MailEngine.fetchMessageRawSources`).
   */
  fetchMessageRawSources(
    refs: ReadonlyArray<MessageRef>,
    onMessage: (ref: MessageRef, message: RawMessage) => Promise<void>
  ): Promise<{ missing: MessageRef[]; unread: Array<{ ref: MessageRef; message: string }> }> {
    return this.engine.fetchMessageRawSources(refs, onMessage)
  }

  async bootstrap(): Promise<AppBootstrap> {
    return {
      capabilities: {
        googleOAuthReady: this.googleOAuthService.isConfigured(),
        microsoftOAuthReady: this.microsoftOAuthService.isConfigured()
      },
      accounts: await this.database.getAccounts()
    }
  }

  async addImapAccount(input: AddImapAccountInput): Promise<MailAccount> {
    const payload = imapAccountSchema.parse(input)

    await verifyImapAccount(payload)

    return this.addAccount({
      id: randomUUID(),
      type: 'imap',
      email: payload.email,
      displayName: payload.displayName,
      username: payload.username,
      authType: 'password',
      encryptedSecret: encryptSecret(payload.password),
      imapHost: payload.imapHost,
      imapPort: payload.imapPort,
      imapSecure: payload.imapSecure,
      smtpHost: payload.smtpHost,
      smtpPort: payload.smtpPort,
      smtpSecure: payload.smtpSecure
    })
  }

  /**
   * A mailbox put right with a new password — the one the server refused
   * changed: tried first, as when the account was added, then kept, and the
   * mailbox connects again with it.
   */
  async replacePassword(accountId: string, password: string): Promise<void> {
    const stored = await this.database.getStoredAccountById(accountId)

    if (!stored || stored.authType !== 'password') {
      throw new Error(messages(MESSAGES).notPasswordMailbox)
    }

    await verifyImapAccount({
      email: stored.email,
      displayName: stored.displayName,
      username: stored.username,
      password,
      imapHost: stored.imapHost,
      imapPort: stored.imapPort,
      imapSecure: stored.imapSecure,
      smtpHost: stored.smtpHost,
      smtpPort: stored.smtpPort,
      smtpSecure: stored.smtpSecure
    }).catch((error: unknown) => {
      // The servers are the user's to know: a refused password is said plainly, anything else as is.
      const cause = error instanceof Error ? error.cause : undefined

      if (refusalOf(cause) === 'accesso' || (cause as { code?: unknown })?.code === 'EAUTH') {
        throw new Error(messages(MESSAGES).passwordRefused(stored.email))
      }

      throw error
    })
    await this.database.setAccountSecret(accountId, encryptSecret(password))
    await this.engine.reconnectAccount(accountId)
  }

  /**
   * A mailbox signed in again with its provider: tried with the new
   * authorization — IMAP turned off stays off whatever the consent — then
   * kept, and it connects.
   */
  async replaceAuthorization(accountId: string, secret: string): Promise<void> {
    const stored = await this.database.getStoredAccountById(accountId)

    if (!stored || stored.authType !== 'oauth') {
      throw new Error(messages(MESSAGES).notProviderMailbox)
    }

    const kept = await this.tryWithToken(stored, secret)
    await this.database.setAccountSecret(accountId, encryptSecret(kept))
    await this.engine.reconnectAccount(accountId)
  }

  /** How a mailbox stands turned down, if it is (`ConnectionRefusal`). */
  accountRefusal(accountId: string): ConnectionRefusal | null {
    return this.engine.accountRefusal(accountId)
  }

  /** A mailbox tried again as it is — its server's certificate put right meanwhile. */
  retryAccount(accountId: string): Promise<void> {
    return this.engine.reconnectAccount(accountId)
  }

  /** The mailbox of a Google account the user granted: Gmail over IMAP and SMTP, with its token. */
  async addGoogleMailbox(granted: GoogleAuthResult): Promise<MailAccount> {
    const mailbox = {
      type: 'gmail' as const,
      email: granted.email,
      username: granted.email,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapSecure: true
    }
    const secret = await this.tryWithToken(mailbox, granted.refreshToken)

    return this.addAccount({
      id: randomUUID(),
      ...mailbox,
      displayName: granted.displayName,
      authType: 'oauth',
      encryptedSecret: encryptSecret(secret),
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true
    })
  }

  /**
   * The mailbox of a Microsoft account the user granted — Microsoft 365,
   * Outlook.com — over IMAP and SMTP with OAuth.
   */
  async addMicrosoftMailbox(granted: MicrosoftAuthResult): Promise<MailAccount> {
    const mailbox = {
      type: 'imap' as const,
      email: granted.email,
      username: granted.email,
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecure: true
    }
    const secret = await this.tryWithToken(mailbox, granted.secret)

    return this.addAccount({
      id: randomUUID(),
      ...mailbox,
      displayName: granted.displayName,
      authType: 'oauth',
      encryptedSecret: encryptSecret(secret),
      // Outlook.com sends through its own server; Microsoft 365 through Office 365's.
      smtpHost: granted.personal ? 'smtp-mail.outlook.com' : 'smtp.office365.com',
      smtpPort: 587,
      smtpSecure: false
    })
  }

  /**
   * A mailbox signed in with its provider, tried before it is kept: the
   * consent is not yet a mailbox that answers — Gmail with IMAP turned off,
   * a company that turned it off for Microsoft 365 (§14.1). Its IMAP
   * server only: a Microsoft account whose SMTP is off sends through Graph.
   * Gives back the secret to keep — Microsoft's, renewed on the way.
   */
  private async tryWithToken(
    mailbox: Pick<MailAccount, 'type' | 'username' | 'imapHost' | 'imapPort' | 'imapSecure'>,
    secret: string
  ): Promise<string> {
    let kept = secret
    const accessToken =
      mailbox.type === 'gmail'
        ? await this.googleOAuthService.getAccessToken(secret)
        : await this.microsoftOAuthService.accessToken(
            secret,
            MICROSOFT_MAIL_SCOPES,
            async (renewed) => {
              kept = renewed
            }
          )

    await verifyImapLogin(mailbox, { user: mailbox.username, accessToken }).catch(
      (error: unknown) => {
        const cause = error instanceof Error ? error.cause : undefined

        // The consent given, the mailbox closed to IMAP: said plainly, with what to do.
        if (refusalOf(cause) === 'accesso') {
          throw new Error(
            mailbox.type === 'gmail'
              ? messages(MESSAGES).googleImapOff(mailbox.username, serverWords(cause))
              : messages(MESSAGES).microsoftImapOff(mailbox.username, serverWords(cause)),
            { cause }
          )
        }

        throw error
      }
    )
    return kept
  }

  /**
   * A new account, kept and connected: in "Tutti gli account", its address
   * among the contacts, its mail downloading.
   */
  private async addAccount(
    input: Parameters<AppDatabase['createAccount']>[0]
  ): Promise<MailAccount> {
    const account = await this.database.createAccount(input)
    log.info('account.added', {
      conn: account.id,
      type: account.type,
      auth: account.authType,
      pec: account.pec,
      by: 'user'
    })

    await this.includeAccountInUnifiedInbox(account.id)
    this.database.learnContacts([{ address: account.email, name: account.displayName }])
    await this.engine.addAccount(account.id)
    return account
  }

  /** A mailbox's servers, found from its address alone; null when nothing tells them. */
  async discoverMailSettings(address: string): Promise<DiscoveredMailSettings | null> {
    const resolver = new Resolver({ timeout: 3_000, tries: 2 })

    try {
      return await discoverMailSettings(address, {
        fetch: (input, init) =>
          init?.redirect === 'manual'
            ? fetchNotFollowing(String(input), init)
            : net.fetch(input, init),
        resolveMx: (domain) => resolver.resolveMx(domain),
        resolveSrv: (name) => resolver.resolveSrv(name),
        reachable: serverAnswers
      })
    } finally {
      resolver.cancel()
    }
  }

  /**
   * The connection stops first, and the mailbox takes no more work: nothing
   * new comes from it, and a message leaving the outbox from it goes, or
   * not, before. The others stop the work that could write about it; then
   * what is kept of it goes, and what they kept of it after — even when the
   * removal is cut short, so nothing stays held (§11.4).
   */
  async removeAccount(accountId: string): Promise<void> {
    const account = await this.ensureAccountExists(accountId)
    const startedAt = Date.now()
    this.leaving.add(accountId)
    log.info('account.removing', { conn: accountId, type: account.type, by: 'user' })

    try {
      await this.engine.removeAccount(accountId)
      await this.sendingOutbox

      try {
        await this.onAccountRemoving(account)
        await this.database.clearAccountData(accountId)
        await this.database.deleteAccount(accountId)
        await this.dropAttachmentCopies(accountId)
        log.info('account.removed', { conn: accountId, ms: Date.now() - startedAt })
      } finally {
        await this.onAccountRemoved(account)
      }
    } finally {
      this.leaving.delete(accountId)
    }
  }

  /** The messages waiting in the outbox to go from a mailbox: removing it, they would not. */
  async outgoingCount(accountId: string): Promise<number> {
    return (await this.database.listOutgoing()).filter((entry) => entry.accountId === accountId)
      .length
  }

  async markAccountLastViewed(accountId: string): Promise<void> {
    await this.ensureAccountExists(accountId)
    await this.database.markAccountLastViewed(accountId)
  }

  checkMailNow(): void {
    this.engine.checkNow()
  }

  async setActiveMailboxContext(context: ActiveMailboxContext | null): Promise<void> {
    const nextContext = context ? activeMailboxContextSchema.parse(context) : null
    this.engine.setActiveContext(nextContext)
  }

  async listFolders(accountId: string): Promise<MailFolder[]> {
    await this.ensureAccountExists(accountId)
    const folders = await this.database.listFolders(accountId)

    if (folders.length === 0) {
      return this.engine.refreshAccountFolders(accountId)
    }

    return folders
  }

  /** How many messages each view of the Segretario's holds, as its list shows them. */
  async getSegretarioViewCounts(): Promise<Record<SegretarioView, number>> {
    const counts = await Promise.all(
      SEGRETARIO_VIEWS.map(
        async (view) =>
          [view, (await this.refsOfKeys(await this.segretario.viewKeys(view))).length] as const
      )
    )
    return Object.fromEntries(counts) as Record<SegretarioView, number>
  }

  async getUnifiedFolderSummaries(): Promise<UnifiedFolderSummary[]> {
    return this.engine.computeUnifiedFolderSummaries()
  }

  /**
   * The mail as the diagnostics tell it (vision §14.4): each mailbox — its
   * kind, its servers, how its connection stands, what the storage holds of
   * it. Never a secret.
   */
  async diagnosticState(): Promise<Record<string, unknown>> {
    const isoOf = (at: number | null): string | null => (at ? new Date(at).toISOString() : null)
    const [accounts, figures] = await Promise.all([
      this.database.getAccounts(),
      this.database.mailFigures()
    ])
    const states = new Map(
      this.getAccountConnectionStates().map((state) => [state.accountId, state])
    )

    return {
      accounts: accounts.map((account) => {
        const state = states.get(account.id)

        return {
          id: account.id,
          email: account.email,
          type: account.type,
          auth: account.authType,
          pec: account.pec,
          imap: `${account.imapHost}:${account.imapPort}${account.imapSecure ? ' tls' : ''}`,
          smtp: `${account.smtpHost}:${account.smtpPort}${account.smtpSecure ? ' tls' : ''}`,
          connectedAt: new Date(account.createdAt).toISOString(),
          status: state?.status ?? null,
          syncing: state?.syncing ?? false,
          error: state?.errorMessage ?? null,
          refused: state?.refused ?? null,
          lastContactAt: isoOf(state?.lastContactAt ?? null),
          index: state?.index ?? null,
          leaving: this.leaving.has(account.id),
          ...figures.get(account.id),
          lastSyncedAt: isoOf(figures.get(account.id)?.lastSyncedAt ?? null)
        }
      })
    }
  }

  getAccountConnectionStates(): AccountConnectionState[] {
    return this.engine.snapshotAccountConnectionStates()
  }

  /**
   * Also puts the stored theme into effect: the launch reads it from a
   * mirror file, which a new install or a restored database may not have
   * yet.
   */
  async getUiPreferences(): Promise<UiPreferences> {
    const preferences = await this.database.getUiPreferences()
    applyThemeMode(preferences.themeMode)
    updateAppMenuShortcuts(preferences.shortcutOverrides)
    return preferences
  }

  /**
   * Validates and stores the whole preference record, then echoes back what
   * was actually persisted so the renderer's state can never drift from the
   * database (a value the schema rejects comes back as its default).
   */
  async setUiPreferences(preferences: UiPreferences): Promise<UiPreferences> {
    const payload = uiPreferencesSchema.parse(preferences)
    await this.database.setUiPreferences(payload)
    return this.getUiPreferences()
  }

  async getUnifiedPreferences(): Promise<UnifiedPreferences> {
    const accounts = await this.database.getAccounts()
    const includedAccountIds = await this.resolveEffectiveUnifiedInboxAccountIds(accounts)

    return {
      includedAccountIds
    }
  }

  async setUnifiedIncludedAccounts(accountIds: string[]): Promise<UnifiedPreferences> {
    const payload = unifiedInboxIncludedAccountsSchema.parse(accountIds)
    const accounts = await this.database.getAccounts()
    const accountIdSet = new Set(accounts.map((account) => account.id))
    const normalizedIncludedAccountIds = Array.from(
      new Set(
        payload
          .map((accountId) => accountId.trim())
          .filter((accountId) => accountIdSet.has(accountId))
      )
    )

    await this.database.setUnifiedInboxIncludedAccountIds(normalizedIncludedAccountIds)

    return {
      includedAccountIds: normalizedIncludedAccountIds
    }
  }

  /**
   * A page of a folder's list — or one of Tutti gli account — from the top: `limit` rows,
   * more when `includeRef` sits further down, so the message the user had
   * selected stays in the list under a new order or filter.
   */
  async listMessages(
    accountId: string,
    folderPath: string,
    options?: ListMessagesOptions
  ): Promise<MailMessageListPage> {
    const onlyRefs = await this.segretarioListRefs(folderPath)
    const mailboxes = onlyRefs
      ? mailboxesOf(onlyRefs)
      : await this.listMailboxes(accountId, folderPath)
    const view: MessageListView = {
      query: options?.query?.trim() || undefined,
      sort: options?.sort,
      grouping: options?.grouping,
      filter: options?.filter,
      activeKeys: options?.filter === 'active' ? await this.segretario.activeKeys() : undefined,
      serverMatches: options?.serverMatches
        ? messageRefsSchema.parse(options.serverMatches)
        : undefined,
      onlyRefs
    }
    let limit = normalizeMessageListLimit(options?.limit)

    if (mailboxes.length === 0) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        limit,
        cachedCount: 0,
        serverCount: 0,
        mailboxes
      }
    }

    const includeRef = options?.includeRef ? messageRefSchema.parse(options.includeRef) : null

    if (includeRef) {
      const position = await this.database.findMessagePosition(mailboxes, view, includeRef)

      if (position >= limit) {
        limit = (Math.floor(position / MESSAGE_LIST_PAGE_SIZE) + 2) * MESSAGE_LIST_PAGE_SIZE
      }
    }

    const messages = await this.database.listMessagesInMailboxes(mailboxes, limit, view)
    const narrowed = Boolean(view.query) || (view.filter !== undefined && view.filter !== 'all')
    // A view holds what the Segretario's notes chose, nothing still to come from a server.
    const cachedCount = onlyRefs
      ? await this.database.countMessagesInMailboxes(mailboxes, { onlyRefs })
      : await this.database.countMessagesInMailboxes(mailboxes, {})
    const available =
      narrowed || onlyRefs
        ? await this.database.countMessagesInMailboxes(mailboxes, view)
        : cachedCount
    const folders = await Promise.all(
      mailboxes.map((mailbox) => this.database.getFolder(mailbox.accountId, mailbox.folderPath))
    )
    const serverCount = onlyRefs
      ? cachedCount
      : folders.reduce((total, folder) => total + (folder?.messageCount ?? 0), 0)
    const syncTimes = folders.flatMap((folder) =>
      folder?.lastSyncedAt !== undefined ? [folder.lastSyncedAt] : []
    )

    return {
      messages,
      // A narrowed view reports what it actually holds; only the whole
      // folder can lean on the server's count, which knows about rows the
      // local cache has not pulled down yet.
      total: narrowed ? available : Math.max(available, serverCount),
      // What more there is to show is what the cache holds: the server's
      // count includes messages still on their way.
      hasMore: available > messages.length,
      limit,
      folderLastSyncedAt: syncTimes.length > 0 ? Math.max(...syncTimes) : undefined,
      cachedCount,
      serverCount,
      mailboxes
    }
  }

  /** The messages a list of the Segretario's holds — a view, a project, a search — or undefined for a folder. */
  private async segretarioListRefs(folderPath: string): Promise<MessageRef[] | undefined> {
    const view = segretarioView(folderPath)

    if (view) {
      return this.refsOfKeys(await this.segretario.viewKeys(view))
    }

    const projectId = segretarioProject(folderPath)

    if (projectId) {
      return this.segretarioProjectRefs(projectId)
    }

    const searchId = segretarioSearch(folderPath)
    return searchId ? ((await this.segretario.searchRefs(searchId)) ?? []) : undefined
  }

  /** The messages of a project: every message of its conversations, its whole story, wherever filed. */
  private async segretarioProjectRefs(projectId: string): Promise<MessageRef[]> {
    const threads = await this.segretario.projectThreads(projectId)
    const keys: Array<{ accountId: string; messageKey: string }> = []

    for (const accountId of new Set(threads.map((thread) => thread.accountId))) {
      const threadIds = threads
        .filter((thread) => thread.accountId === accountId)
        .map((thread) => thread.threadId)

      for (const messageKey of await this.database.listMessageKeysOfThreads(accountId, threadIds)) {
        keys.push({ accountId, messageKey })
      }
    }

    return this.refsOfKeys(keys)
  }

  /**
   * Messages by key, across accounts, each as one row in the folder the
   * user thinks of it in; those only in the Trash or Spam are left out.
   */
  private async refsOfKeys(
    keys: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<MessageRef[]> {
    const refs: MessageRef[] = []

    for (const accountId of new Set(keys.map((key) => key.accountId))) {
      const ofAccount = keys
        .filter((key) => key.accountId === accountId)
        .map((key) => key.messageKey)

      for (const summary of (await this.bestRowsByKey(accountId, ofAccount)).values()) {
        refs.push(summary.ref)
      }
    }

    return refs
  }

  /**
   * Where messages are, by key: each in the folder the user thinks of it
   * in, or — when it is only in the Trash or Spam — there, set aside. Those
   * in no folder are not in the map: gone.
   */
  private async locateMessages(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<Map<string, MessageLocation>> {
    const folders = await this.database.listFolders(accountId)
    const located = new Map<string, { rank: number; location: MessageLocation }>()

    for (const row of await this.database.listMessageRowsByKey(accountId, messageKeys)) {
      const folder = folders.find((candidate) => candidate.path === row.folderPath)
      const role = folder ? folderRole(folder) : null
      const setAside = role === '\\Trash' || role === '\\Junk'
      const draft = role === '\\Drafts'
      // Anywhere else comes before the Trash and Spam; then the folder the user looks in first.
      const rank = (setAside ? 100 : 0) + folderDisplayRank(folder)
      const known = located.get(row.messageKey)

      if (!known || rank < known.rank) {
        located.set(row.messageKey, {
          rank,
          location: {
            ref: { accountId, folderPath: row.folderPath, uid: row.uid },
            threadId: row.threadId,
            dateIso: row.dateIso,
            subject: row.subject,
            from: row.from,
            setAside,
            draft
          }
        })
      }
    }

    return new Map([...located].map(([key, { location }]) => [key, location]))
  }

  /**
   * An account's messages by key, each as one row in the folder the user
   * thinks of it in — never one thrown away or in Spam — with who wrote it,
   * what about and when.
   */
  private async bestRowsByKey(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<
    Map<string, { ref: MessageRef; subject: string; from: MailAddress[]; dateIso: string }>
  > {
    const located = await this.locateMessages(accountId, messageKeys)
    return new Map(
      [...located]
        .filter(([, location]) => !location.setAside)
        .map(([key, { ref, subject, from, dateIso }]) => [key, { ref, subject, from, dateIso }])
    )
  }

  /** The mailboxes a list shows: one folder, those "Tutti gli account" gathers for a role, or a view's. */
  private async listMailboxes(
    accountId: string,
    folderPath: string
  ): Promise<Array<{ accountId: string; folderPath: string }>> {
    const role = unifiedFolderRole(folderPath)

    if (role) {
      return this.engine.resolveUnifiedMailboxes(role)
    }

    const refs = await this.segretarioListRefs(folderPath)

    if (refs) {
      return mailboxesOf(refs)
    }

    await this.ensureAccountExists(accountId)
    return [{ accountId, folderPath }]
  }

  /**
   * What the servers find for a search of a list — in the whole text of
   * the messages, which the cache holds only for those downloaded — to be
   * listed with the cache's own matches (`ListMessagesOptions.serverMatches`).
   * Null when a later search took this one's place.
   */
  async searchOnServer(
    accountId: string,
    folderPath: string,
    query: string
  ): Promise<MessageRef[] | null> {
    const groups = imapSearchGroups(parseSearchQuery(z.string().max(500).parse(query)))

    if (groups.length === 0) {
      return []
    }

    const mailboxes = await this.listMailboxes(accountId, folderPath)
    const found = await Promise.all(
      mailboxes.map(async (mailbox) => {
        const uids = await this.engine.searchMessages(mailbox, groups)
        return uids === null ? null : uids.map((uid) => ({ ...mailbox, uid }))
      })
    )

    return found.some((refs) => refs === null) ? null : found.flatMap((refs) => refs ?? [])
  }

  /** A message with its body: from the cache, or fetched and kept there. */
  async getMessage(input: MessageRef): Promise<MailMessageDetail> {
    const ref = messageRefSchema.parse(input)
    const { message, size } = await this.cachedMessage(ref)

    if (message) {
      return message
    }

    return this.storedDetail(ref, await this.engine.loadMessageBody(ref, size, 'use'))
  }

  /**
   * The message the reading pane shows. Null when the pane moved on to
   * another message before this one's turn came (see `BodyLoadIntent`).
   */
  async readMessage(input: MessageRef): Promise<MailMessageDetail | null> {
    const ref = messageRefSchema.parse(input)
    const { message, size } = await this.cachedMessage(ref)

    if (message) {
      return this.withPecReceipts(message)
    }

    const fetched = await this.engine.loadMessageBody(ref, size, 'read')
    return fetched ? this.withPecReceipts(await this.storedDetail(ref, fetched)) : null
  }

  /**
   * A message with what certified mail says around it: the receipts its
   * provider sent back on one the user sent from a certified mailbox; for
   * a receipt, the message sent it is about.
   */
  private async withPecReceipts(message: MailMessageDetail): Promise<MailMessageDetail> {
    if (message.pec && message.pec.kind !== 'busta' && message.pec.kind !== 'anomalia') {
      const sent = message.pec.ref
        ? await this.database.messageRefById(message.accountId, message.pec.ref)
        : null
      return sent ? { ...message, pecSent: sent } : message
    }

    if (message.pec || !message.messageId) {
      return message
    }

    const receipts = await this.database.pecReceipts(message.accountId, message.messageId)
    return receipts.length > 0 ? { ...message, pecReceipts: receipts } : message
  }

  /**
   * Fetches ahead the bodies of messages likely to be read next — those
   * around the one being read — while the connection has nothing else to
   * do. One that fails is fetched again when it is read.
   */
  async prefetchMessages(input: MessageRef[]): Promise<void> {
    const refs = z.array(messageRefSchema).max(MAX_PREFETCHED_MESSAGES).parse(input)

    for (const ref of refs) {
      const state = await this.database.getMessageBodyState(ref)

      if (state && !state.hasBody) {
        this.engine.loadMessageBody(ref, state.size, 'prefetch').catch(() => undefined)
      }
    }
  }

  /** Fetches the previews of rows in view that have none yet. */
  async hydratePreviews(input: MessageRef[]): Promise<void> {
    const refs = z.array(messageRefSchema).max(MAX_HYDRATED_PREVIEWS).parse(input)
    await this.ensureAccountsExist(refs)
    await this.engine.hydratePreviews(refs)
  }

  /** The message if its body is cached, and its size for fetching it otherwise. */
  private async cachedMessage(
    ref: MessageRef
  ): Promise<{ message: MailMessageDetail | null; size: number }> {
    await this.ensureAccountExists(ref.accountId)

    const cached = await this.database.getMessage(ref)
    const hasBody = cached && (cached.html !== undefined || cached.text !== undefined)

    return { message: hasBody ? cached : null, size: cached?.size ?? 0 }
  }

  /** A fetched body as the cache now holds it with its message. */
  private async storedDetail(
    ref: MessageRef,
    fetched: FetchedMessageDetail
  ): Promise<MailMessageDetail> {
    return (await this.database.getMessage(ref)) ?? { ...fetched, senderLabel: fetched.senderName }
  }

  async moveMessages(input: MoveMessagesInput): Promise<MessagesActionResult> {
    const payload = moveMessagesSchema.parse(input)
    await this.ensureAccountsExist(payload.refs)
    const result = await this.withDraftsLeaving(payload.refs, (acting) =>
      this.engine.moveMessages(acting, payload.destinationFolderPath)
    )
    const failed = new Set(
      result.failed.map((ref) => `${ref.accountId}\u0000${ref.folderPath}\u0000${ref.uid}`)
    )
    const moved = payload.refs.find(
      (ref) => !failed.has(`${ref.accountId}\u0000${ref.folderPath}\u0000${ref.uid}`)
    )

    // Where messages were moved by hand comes first next time (see `listRecentFolders`).
    if (moved) {
      await this.database.recordRecentFolder(moved.accountId, payload.destinationFolderPath)
    }

    return result
  }

  /** Moves messages, of any account, to each one's folder for a role (see `moveMessagesToRole`). */
  async moveMessagesToRole(input: MoveMessagesToRoleInput): Promise<MessagesActionResult> {
    const payload = moveMessagesToRoleSchema.parse(input)
    await this.ensureAccountsExist(payload.refs)
    return this.withDraftsLeaving(payload.refs, (acting) =>
      this.engine.moveMessagesToRole(acting, payload.role)
    )
  }

  /** An account's recent destinations of "Sposta", the latest first. */
  async listRecentFolders(accountId: string): Promise<string[]> {
    await this.ensureAccountExists(accountId)
    return this.database.listRecentFolders(accountId)
  }

  /** Marks every message of a folder read — or of every folder a "Tutti gli account" one gathers. */
  async markFolderRead(accountId: string, folderPath: string): Promise<void> {
    const mailboxes = await this.listMailboxes(
      z.string().trim().min(1).parse(accountId),
      z.string().trim().min(1).parse(folderPath)
    )

    await Promise.all(mailboxes.map((mailbox) => this.engine.markFolderRead(mailbox)))
  }

  /** Gives a folder of an account another name, where it is. */
  async renameFolder(input: RenameFolderInput): Promise<MailFolder> {
    const payload = renameFolderSchema.parse(input)
    await this.ensureAccountExists(payload.accountId)
    return this.engine.renameFolder(payload.accountId, payload.folderPath, payload.name)
  }

  /** Creates a folder in an account — inside `parentPath`, or at its top. */
  async createFolder(input: CreateFolderInput): Promise<MailFolder> {
    const payload = createFolderSchema.parse(input)
    await this.ensureAccountExists(payload.accountId)
    return this.engine.createFolder(payload.accountId, payload.name, payload.parentPath ?? null)
  }

  async deleteMessages(refs: MessageRef[]): Promise<MessagesActionResult> {
    const payload = messageRefsSchema.parse(refs)
    await this.ensureAccountsExist(payload)
    return this.withDraftsLeaving(payload, (acting) => this.engine.deleteMessages(acting))
  }

  /**
   * "Archivia", from the toolbar, the Segretario or an extension: each
   * message as its provider means it, by what it is rather than the row it
   * was picked from (see `MailEngine.archiveMessages`). One archived
   * already stays where it is, and is no failure.
   */
  async archiveMessages(refs: ReadonlyArray<MessageRef>): Promise<MessagesActionResult> {
    const payload = messageRefsSchema.parse(refs)
    await this.ensureAccountsExist(payload)
    return this.withDraftsLeaving(payload, (acting) => this.engine.archiveMessages(acting))
  }

  /**
   * Messages leaving their folder, by `act`. Those of Bozze take their
   * drafts with them (see `DraftService.hold`): the copy that leaves is the
   * draft as it is, and only a draft whose copy did leave is let go — not
   * one `act` left where it was (`stayed`: archived already, on Gmail a
   * draft is). What failed is said in the refs the caller gave.
   */
  private async withDraftsLeaving(
    refs: ReadonlyArray<MessageRef>,
    act: (refs: MessageRef[]) => Promise<MessagesActionResult & { stayed?: MessageRef[] }>
  ): Promise<MessagesActionResult> {
    const draftsFolders = new Map<string, string | undefined>()

    for (const accountId of new Set(refs.map((ref) => ref.accountId))) {
      draftsFolders.set(
        accountId,
        folderForRole(await this.database.listFolders(accountId), '\\Drafts')?.path
      )
    }

    const held = await this.drafts.hold(
      refs.filter((ref) => draftsFolders.get(ref.accountId) === ref.folderPath)
    )
    const refused = new Set(held.refused.map(draftRefKey))
    const given = new Map<string, MessageRef>()
    const acting = refs.flatMap((ref) => {
      if (refused.has(draftRefKey(ref))) {
        return []
      }

      const copy = held.current.get(draftRefKey(ref)) ?? ref
      given.set(draftRefKey(copy), ref)
      return [copy]
    })

    let result: MessagesActionResult & { stayed?: MessageRef[] }

    try {
      result = acting.length > 0 ? await act(acting) : { failed: [] }
    } catch (error) {
      // Nothing is known to have left: every draft is written on again.
      await held.settle([])
      throw error
    }

    const failed = new Set(result.failed.map(draftRefKey))
    const stayed = new Set((result.stayed ?? []).map(draftRefKey))
    await held.settle(
      acting.filter((ref) => !failed.has(draftRefKey(ref)) && !stayed.has(draftRefKey(ref)))
    )

    return {
      failed: [...result.failed.map((ref) => given.get(draftRefKey(ref)) ?? ref), ...held.refused],
      error: result.error ?? held.error,
      ...(result.kept ? { kept: result.kept.map((ref) => given.get(draftRefKey(ref)) ?? ref) } : {})
    }
  }

  async setMessagesSeen(input: SetMessagesKeywordInput): Promise<MessagesActionResult> {
    const payload = setMessagesKeywordSchema.parse(input)
    await this.ensureAccountsExist(payload.refs)
    return this.engine.setMessagesSeen(payload.refs, payload.present)
  }

  async setMessagesFlagged(input: SetMessagesKeywordInput): Promise<MessagesActionResult> {
    const payload = setMessagesKeywordSchema.parse(input)
    await this.ensureAccountsExist(payload.refs)
    return this.engine.setMessagesFlagged(payload.refs, payload.present)
  }

  private async ensureAccountsExist(refs: ReadonlyArray<MessageRef>): Promise<void> {
    for (const accountId of new Set(refs.map((ref) => ref.accountId))) {
      await this.ensureAccountExists(accountId)
    }
  }

  /**
   * Sends a message. Sent while its server cannot be reached — no network,
   * the server down — it is not lost: it waits in the outbox, says so
   * (`queued`), and goes by itself when it can (`sendOutbox`). Sent again by
   * hand, the copy waiting is let go.
   */
  async sendMail(input: ComposeMailInput): Promise<{ queued: boolean }> {
    const payload = composeSchema.parse(input)
    const stored = await this.database.getStoredAccountById(payload.accountId)
    if (!stored) {
      throw new Error(messages(MESSAGES).accountNotFound)
    }

    if (payload.draftId) {
      if (this.leavingOutbox.has(payload.draftId)) {
        throw new Error(messages(MESSAGES).leavingOutbox)
      }

      await this.database.removeOutgoing({ draftId: payload.draftId })
    }

    // A mailbox its server turned down for good sends nothing until it is put right.
    const refusal = this.engine.accountRefusal(payload.accountId)

    if (refusal) {
      throw new Error(messages(MESSAGES).mailboxStopped(stored.email, refusalClause(refusal)))
    }

    // Certified mail (PEC) takes no Bcc: its provider would refuse the whole message.
    if (
      payload.bcc.length > 0 &&
      (await this.database.getAccounts()).some(
        (account) => account.id === payload.accountId && account.pec
      )
    ) {
      throw new Error(messages(MESSAGES).pecNoBcc)
    }

    // A file attached a while ago may be gone by now; say which, rather than
    // failing halfway through the upload.
    await this.describeFiles(payload.attachments.map((attachment) => attachment.path))

    const account = {
      ...stored,
      secret: decryptSecret(stored.encryptedSecret)
    }

    try {
      await this.deliver(account, createOutgoingMessagePayload(account, payload))
    } catch (error) {
      // Not sent: the draft, as it was when sending, waits in Bozze.
      if (payload.draftId) {
        void this.drafts.flush(payload.draftId)
      }

      const failure = sendFailureOf(error, net.isOnline())

      // It never reached the server: it waits, and goes by itself.
      if (failure === 'passing') {
        log.warn('send.queued', { conn: account.id, err: error })
        await this.database.queueOutgoing({
          id: randomUUID(),
          accountId: account.id,
          draftId: payload.draftId ?? null,
          payload
        })
        return { queued: true }
      }

      // Broken off while it went: it may have arrived — said, before the user sends it again.
      if (failure === 'uncertain') {
        throw new Error(
          messages(MESSAGES).sendingBrokenOff(
            error instanceof Error ? error.message : String(error)
          ),
          { cause: error }
        )
      }

      throw error
    }

    await this.afterSent(payload)
    return { queued: false }
  }

  /**
   * A draft opened again to change: its message, waiting in the outbox, is
   * taken back — sent as it was, it would not be what the user now writes.
   * Whether it was waiting.
   */
  async takeBackOutgoing(draftId: string): Promise<boolean> {
    return (await this.database.removeOutgoing({ draftId })) > 0
  }

  /** A message gone: its draft, who it went to, the files it took. */
  private async afterSent(payload: ComposeMailInput): Promise<void> {
    if (payload.draftId) {
      void this.drafts
        .sent(payload.draftId)
        .catch((error: unknown) => log.failed('draft.not-deleted', error))
    }

    // The message has gone: counting who it went to must not turn that into a failure.
    void this.database
      .recordContactsWritten([...payload.to, ...payload.cc, ...payload.bcc])
      .catch((error: unknown) => log.error('Counting the recipients failed', error))
    await this.recordRecentFiles(
      payload.attachments.map((attachment) => attachment.path),
      messages(MESSAGES).attachedToMessage
    )
  }

  /**
   * The outbox, tried in order when the network is there: what goes is said
   * (`outboxSent`); what still cannot reach its server waits; what fails
   * otherwise — refused, or broken off midway, so perhaps gone — leaves the
   * outbox and is said (`outboxFailed`), its draft in Bozze for the user.
   */
  private sendOutbox(): Promise<void> {
    this.sendingOutbox ??= (async () => {
      if (!net.isOnline()) {
        return
      }

      const tried = new Set<string>()

      // Read again at each step: a message sent by hand meanwhile, by its draft, has left it.
      for (;;) {
        const entry = (await this.database.listOutgoing()).find(({ id }) => !tried.has(id))

        if (!entry) {
          break
        }

        tried.add(entry.id)
        const payload = entry.payload as ComposeMailInput
        const stored = await this.database.getStoredAccountById(entry.accountId)

        if (
          !stored ||
          this.leaving.has(entry.accountId) ||
          this.engine.accountRefusal(entry.accountId)
        ) {
          continue
        }

        const account = { ...stored, secret: decryptSecret(stored.encryptedSecret) }
        const failed = (message: string, why: string): void => {
          log.warn('outbox.failed', { conn: entry.accountId, why })
          const m = messages(MESSAGES)
          // The user thinks it went: away from the window, the system tells them (§13.3).
          this.notifications.notify({
            family: 'app',
            kind: 'app.outbox-failed',
            key: `app:outbox:${entry.id}`,
            title: m.notSentTitle,
            body: message,
            concealed: { title: m.notSentTitle, body: m.notSentConcealed },
            target: entry.draftId ? { kind: 'draft', draftId: entry.draftId } : { kind: 'window' },
            when: 'away'
          })
          getAppWindow()?.webContents.send(IPC_CHANNELS.outboxFailed, {
            draftId: entry.draftId,
            subject: payload.subject,
            message
          })
        }

        if (entry.draftId) {
          this.leavingOutbox.add(entry.draftId)
        }

        try {
          // A file attached may be gone since: said, rather than half sent.
          const filesGone = await this.describeFiles(
            payload.attachments.map((attachment) => attachment.path)
          ).then(
            () => null,
            (error: unknown) => (error instanceof Error ? error.message : String(error))
          )

          if (filesGone) {
            await this.database.removeOutgoing({ id: entry.id })
            failed(messages(MESSAGES).notSent(payload.subject, filesGone), 'files-gone')
            continue
          }

          try {
            await this.deliver(account, createOutgoingMessagePayload(account, payload))
          } catch (error) {
            const failure = sendFailureOf(error, net.isOnline())

            if (failure === 'passing') {
              continue
            }

            await this.database.removeOutgoing({ id: entry.id })
            failed(
              failure === 'uncertain'
                ? messages(MESSAGES).outboxBrokenOff(payload.subject)
                : messages(MESSAGES).notSent(
                    payload.subject,
                    error instanceof Error ? error.message : String(error)
                  ),
              failure
            )
            continue
          }

          await this.database.removeOutgoing({ id: entry.id })
          log.info('outbox.sent', { conn: entry.accountId, waitedMs: Date.now() - entry.queuedAt })
          await this.afterSent(payload)
          getAppWindow()?.webContents.send(IPC_CHANNELS.outboxSent, {
            draftId: entry.draftId,
            subject: payload.subject
          })
        } finally {
          if (entry.draftId) {
            this.leavingOutbox.delete(entry.draftId)
          }
        }
      }
    })()
      .catch((error: unknown) => log.error('The outbox could not be sent', error))
      .finally(() => {
        this.sendingOutbox = null
      })

    return this.sendingOutbox
  }

  /**
   * A message sent from an account: through its SMTP server — through
   * Graph where a Microsoft organisation turned SMTP off — and its copy
   * filed in Inviata where the server does not file it itself (Gmail and
   * Graph do).
   */
  private async deliver(
    account: AccountWithSecret,
    outgoing: OutgoingMessagePayload
  ): Promise<void> {
    const rawOutgoing = account.type === 'imap' ? await buildRawOutgoingMessage(outgoing) : null
    // The provider's token, fetched before anything is handed over (`sendFailureOf`).
    const transport = await createSmtpTransport(account, this.tokens).catch((error: unknown) => {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        beforeSending: true
      })
    })

    try {
      let sentThroughGraph = false
      const result = await transport.sendMail(outgoing).catch(async (error: unknown) => {
        if (rawOutgoing && isMicrosoftAccount(account) && smtpTurnedOff(error)) {
          await this.sendThroughGraph(account, rawOutgoing, outgoing.bcc)
          sentThroughGraph = true
          return { messageId: outgoing.messageId }
        }

        throw error
      })

      if (account.type === 'imap' && rawOutgoing && !sentThroughGraph) {
        const messageId = typeof result?.messageId === 'string' ? result.messageId.trim() : ''
        // The message has gone. Filing its copy in "Posta inviata" waits for
        // the account's IMAP connection, however long that takes, so it must
        // neither hold the result back nor turn it into a failure — which
        // would invite sending it twice.
        void this.engine.appendToSent(account.id, rawOutgoing, messageId).catch((error) => {
          log.failed('sent-copy.not-filed', error, { conn: account.id })
        })
      }
    } finally {
      transport.close()
    }
  }

  /**
   * A message sent as it was built (MIME), through Graph, by a Microsoft
   * account. The MIME of a message sent carries no Bcc, and Graph is not
   * documented to send to one it finds there: with blind copies the message
   * becomes a draft from that MIME, gets its Bcc as Graph's own field, which
   * a draft takes, and is sent from there.
   */
  private async sendThroughGraph(
    account: { id: string; type: MailAccount['type']; secret: string },
    raw: Buffer,
    bcc: ReadonlyArray<MailAddress>
  ): Promise<void> {
    const token = await this.microsoftOAuthService.accessToken(
      account.secret,
      bcc.length === 0
        ? ['https://graph.microsoft.com/Mail.Send']
        : ['https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/Mail.ReadWrite'],
      (secret) => this.database.setAccountSecret(account.id, encryptSecret(secret))
    )
    const graph = async (path: string, init: RequestInit): Promise<Response> => {
      const response = await net
        .fetch(`https://graph.microsoft.com/v1.0${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, ...init.headers }
        })
        .catch((error: unknown) => {
          // Broken off on the way: the message may have reached Microsoft (`sendFailureOf`).
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            command: 'GRAPH'
          })
        })

      if (!response.ok) {
        throw Object.assign(
          new Error(messages(MESSAGES).microsoftNotSent(response.status, await response.text())),
          { status: response.status }
        )
      }

      return response
    }
    const mime = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: raw.toString('base64')
    }

    if (bcc.length === 0) {
      await graph('/me/sendMail', mime)
      return
    }

    const draft = (await (await graph('/me/messages', mime)).json()) as { id: string }
    await graph(`/me/messages/${encodeURIComponent(draft.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bccRecipients: bcc.map((address) => ({
          emailAddress: { address: address.address, name: address.name || undefined }
        }))
      })
    })
    await graph(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST' })
  }

  async suggestContacts(query: string, limit?: number): Promise<MailContactSuggestion[]> {
    const normalizedQuery = query.trim()

    if (!normalizedQuery) {
      return []
    }

    const parsedLimit = Number(limit)
    const normalizedLimit = Number.isFinite(parsedLimit)
      ? Math.min(CONTACT_SUGGESTION_LIMIT_MAX, Math.max(1, Math.floor(parsedLimit)))
      : CONTACT_SUGGESTION_LIMIT_DEFAULT

    return this.database.listContactSuggestions(normalizedQuery, normalizedLimit)
  }

  /** See `DraftService.save`. */
  async saveDraft(input: DraftContent): Promise<DraftStatus> {
    const content = draftContentSchema.parse(input) as DraftContent
    await this.ensureAccountExists(content.accountId)
    return this.drafts.save(content)
  }

  flushDraft(id: string): Promise<DraftStatus> {
    return this.drafts.flush(z.string().uuid().parse(id))
  }

  closeDraft(id: string): Promise<DraftStatus> {
    return this.drafts.close(z.string().uuid().parse(id))
  }

  async discardDraft(id: string): Promise<void> {
    const draftId = z.string().uuid().parse(id)
    // A message in the outbox thrown away does not go.
    await this.database.removeOutgoing({ draftId })
    await this.drafts.discard(draftId)
  }

  getStoredDraft(id: string): Promise<StoredDraft | null> {
    return this.drafts.get(z.string().min(1).parse(id))
  }

  listDockedDrafts(): Promise<StoredDraft[]> {
    return this.drafts.listDocked()
  }

  async openDraftMessage(input: MessageRef): Promise<StoredDraft> {
    const ref = messageRefSchema.parse(input)
    await this.ensureAccountExists(ref.accountId)
    return this.drafts.openMessage(ref)
  }

  /** Takes an address out of the composer's suggestions. */
  async forgetContact(address: string): Promise<void> {
    await this.database.hideContact(z.string().trim().min(1).parse(address))
  }

  async listAccountSignatures(): Promise<MailAccountSignature[]> {
    return this.database.listAccountSignatures()
  }

  async getAccountSignature(accountId: string): Promise<MailAccountSignature | null> {
    const normalizedAccountId = z.string().trim().min(1).parse(accountId)
    await this.ensureAccountExists(normalizedAccountId)
    return this.database.getAccountSignature(normalizedAccountId)
  }

  async setAccountSignature(
    accountId: string,
    content: { html: string; headerHtml: string }
  ): Promise<MailAccountSignature> {
    const payload = accountSignatureInputSchema.parse({ accountId, ...content })
    await this.ensureAccountExists(payload.accountId)

    return this.database.setAccountSignature(payload.accountId, {
      html: normalizeAccountSignatureHtml(payload.html),
      headerHtml: normalizeAccountSignatureHtml(payload.headerHtml)
    })
  }

  async clearAccountData(accountId: string): Promise<void> {
    await this.ensureAccountExists(accountId)
    await this.engine.removeAccount(accountId)
    await this.database.clearAccountData(accountId)
    await this.dropAttachmentCopies(accountId)
    await this.engine.addAccount(accountId)
  }

  private async dropAttachmentCopies(accountId?: string): Promise<void> {
    const scope = accountId ? accountAttachmentCacheDirectory(accountId) : attachmentCacheRoot()

    for (const directory of this.attachmentCopies.keys()) {
      if (directory.startsWith(scope)) {
        this.attachmentCopies.delete(directory)
      }
    }

    await clearAttachmentCache(accountId)
  }

  /**
   * Runs `work` with every account's connection stopped, and starts them
   * again after, whatever it did: nothing syncs into what `work` empties.
   */
  async whileDisconnected(work: () => Promise<void>): Promise<void> {
    const accounts = await this.database.getAccounts()

    // Stop every connection in parallel before we touch the DB: each stop awaits
    // its own IMAP logout + command-worker drain, so the slowest account doesn't
    // serialize the others. The wipe then runs on a quiesced state.
    await Promise.allSettled(accounts.map((account) => this.engine.removeAccount(account.id)))

    try {
      await work()
    } finally {
      // Re-bootstrap all accounts in parallel. engine.addAccount returns once the
      // AccountConnection is created and its connection loop is started; the IMAP
      // connects and the bootstrap then run concurrently across accounts.
      await Promise.allSettled(accounts.map((account) => this.engine.addAccount(account.id)))
    }
  }

  /**
   * Empties what the mail keeps — its cache, the contacts, drafts,
   * signatures, recent files and folders, the attachments' copies — while
   * the accounts and the preferences stay. Runs with the connections
   * stopped (see `whileDisconnected`).
   */
  async clearData(): Promise<void> {
    await this.database.clearAllDataKeepAccounts()
    await this.dropAttachmentCopies()
    // The drafts went with the rest: the files they were opened with go too.
    await rm(draftFilesRoot(), { recursive: true, force: true })
  }

  async pickAttachments(parentWindow?: BrowserWindow): Promise<PickedAttachment[]> {
    const options = {
      title: messages(MESSAGES).attachFiles,
      buttonLabel: messages(MESSAGES).attach,
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? [] : this.describeFiles(result.filePaths)
  }

  /**
   * Opens an attachment with the application the system uses for its type,
   * from a copy in the account's attachment folder. The copy is reused
   * while it is untouched; if the user edited it in the meantime, the
   * attachment opens as a fresh copy beside it, so the message always
   * shows what it actually contains.
   */
  async openAttachment(input: AttachmentRef): Promise<OpenAttachmentResult> {
    const { ref, attachmentId } = attachmentRefSchema.parse(input)
    const message = await this.requireMessage(ref)
    const listed = message.attachments.find((attachment) => attachment.id === attachmentId)

    if (!listed) {
      throw new Error(messages(MESSAGES).attachmentUnavailable)
    }

    if (isExecutableAttachment(listed.fileName)) {
      return { status: 'blocked' }
    }

    const [copy] = await this.copyAttachments(ref, message, [listed.id], 'open')
    const failure = await shell.openPath(copy.path)
    return failure ? { status: 'no-application' } : { status: 'opened' }
  }

  /**
   * Copies of a message's attachments for a reply or forward to carry, as
   * the message holds them. They are the composer's own, apart from the
   * copies the reader opens: an application editing one of those must not
   * change what a forward sends.
   */
  async copyMessageAttachments(input: MessageAttachmentsRef): Promise<CopiedAttachment[]> {
    const { ref, attachmentIds } = messageAttachmentsRefSchema.parse(input)
    const message = await this.requireMessage(ref)
    const unknown = attachmentIds.find(
      (attachmentId) => !message.attachments.some((attachment) => attachment.id === attachmentId)
    )

    if (unknown) {
      throw new Error(messages(MESSAGES).attachmentUnavailable)
    }

    return this.copyAttachments(ref, message, attachmentIds, 'compose')
  }

  /**
   * Copies of some attachments of a message, each in a folder of its own
   * under the account's attachment folder, keyed by what it is for. A copy
   * written before is used again while it is untouched; the others come
   * from a single download of the message. A copy that changed since — an
   * application saved over it — stays as it is, and the attachment gets a
   * fresh copy beside it.
   */
  private async copyAttachments(
    ref: MessageRef,
    message: MailMessageDetail,
    attachmentIds: ReadonlyArray<string>,
    purpose: 'open' | 'compose'
  ): Promise<CopiedAttachment[]> {
    const requested = attachmentIds.map((attachmentId) => {
      const index = parseAttachmentIndex(attachmentId)
      const identity = [ref.folderPath, ref.uid, message.messageId ?? message.date, index]

      return {
        attachmentId,
        index,
        part: message.attachments.find((attachment) => attachment.id === attachmentId)?.part,
        directory: attachmentCopyDirectory(
          ref.accountId,
          purpose === 'open' ? identity : [purpose, ...identity]
        )
      }
    })
    const paths = new Map<string, string>()

    for (const { directory } of requested) {
      const known = this.attachmentCopies.get(directory)

      if (known && (await fileSha256(known.filePath)) === known.digest) {
        paths.set(directory, known.filePath)
      }
    }

    const missing = requested.filter(({ directory }) => !paths.has(directory))

    if (missing.length > 0) {
      const downloaded = await this.engine.fetchAttachments(ref, missing, message.size)

      for (const [position, attachment] of downloaded.entries()) {
        const { directory } = missing[position]
        const digest = sha256(attachment.content)
        const target = join(
          directory,
          sanitizePathSegment(attachment.fileName, messages(MESSAGES).attachmentFileName)
        )
        const existingDigest = await fileSha256(target)
        let filePath = target

        if (existingDigest !== digest) {
          await mkdir(directory, { recursive: true })
          filePath = existingDigest
            ? await resolveUniqueFilePath(directory, basename(target))
            : target
          await writeFile(filePath, attachment.content)
          await markFromInternet(filePath)
        }

        this.attachmentCopies.set(directory, { filePath, digest })
        paths.set(directory, filePath)
      }
    }

    // Named as the message names it, which the file on disk may not be.
    return Promise.all(
      requested.map(async ({ attachmentId, directory }) => {
        const filePath = paths.get(directory) as string
        const listed = message.attachments.find((attachment) => attachment.id === attachmentId)

        return {
          attachmentId,
          path: filePath,
          name: listed?.fileName || basename(filePath),
          size: (await stat(filePath)).size
        }
      })
    )
  }

  /** "Salva con nome…": the system save dialog, starting where the user last saved. */
  async saveAttachment(input: AttachmentRef, parentWindow?: BrowserWindow): Promise<string | null> {
    const { ref, attachmentId } = attachmentRefSchema.parse(input)
    const message = await this.requireMessage(ref)
    const listed = message.attachments.find((attachment) => attachment.id === attachmentId)

    if (!listed) {
      throw new Error(messages(MESSAGES).attachmentUnavailable)
    }

    const m = messages(MESSAGES)
    const options = {
      title: m.saveAttachment,
      buttonLabel: m.save,
      defaultPath: sanitizePathSegment(listed.fileName, m.attachmentFileName)
    }
    const choice = parentWindow
      ? await dialog.showSaveDialog(parentWindow, options)
      : await dialog.showSaveDialog(options)

    if (choice.canceled || !choice.filePath) {
      return null
    }

    const [attachment] = await this.engine.fetchAttachments(
      ref,
      [{ index: parseAttachmentIndex(attachmentId), part: listed.part }],
      message.size
    )
    await writeFile(choice.filePath, attachment.content)
    await markFromInternet(choice.filePath)
    await this.recordRecentFiles([choice.filePath], messages(MESSAGES).savedFromMessage)

    return choice.filePath
  }

  /**
   * "Salva tutti": every attachment the reader lists, into one folder the
   * user picks, from a single download of the message. Names already taken
   * there get a " (1)" rather than overwriting anything.
   */
  async saveAllAttachments(
    input: MessageRef,
    parentWindow?: BrowserWindow
  ): Promise<SavedAttachments | null> {
    const ref = messageRefSchema.parse(input)
    const message = await this.requireMessage(ref)

    const options = {
      title: messages(MESSAGES).saveAllAttachments,
      buttonLabel: messages(MESSAGES).saveHere,
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const choice = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)
    const directory = choice.filePaths[0]

    if (choice.canceled || !directory) {
      return null
    }

    const attachments = await this.engine.fetchAttachments(
      ref,
      message.attachments.map((attachment) => ({
        index: parseAttachmentIndex(attachment.id),
        part: attachment.part
      })),
      message.size
    )
    const filePaths: string[] = []

    for (const attachment of attachments) {
      const filePath = await resolveUniqueFilePath(
        directory,
        sanitizePathSegment(attachment.fileName, messages(MESSAGES).attachmentFileName)
      )
      await writeFile(filePath, attachment.content)
      await markFromInternet(filePath)
      filePaths.push(filePath)
    }

    await this.recordRecentFiles(filePaths, messages(MESSAGES).savedFromMessage)
    return { directory, filePaths }
  }

  /** Shows a file in the Finder — in Esplora file — where its share is now. */
  async revealFile(filePath: string): Promise<void> {
    shell.showItemInFolder(await reachablePath(z.string().min(1).parse(filePath)))
  }

  /**
   * Opens a file the composer attaches — the user's own, or the copy a
   * forward carries — with the application the system uses for its type,
   * as Outlook opens an attachment of a message being written: what is
   * saved in it before sending is what goes out. Files that start programs
   * are not opened from here, as from a message.
   */
  async openFile(filePath: string): Promise<OpenAttachmentResult> {
    const [file] = await this.describeFiles([filePath])

    if (isExecutableAttachment(file.name)) {
      return { status: 'blocked' }
    }

    const failure = await shell.openPath(file.path)
    return failure ? { status: 'no-application' } : { status: 'opened' }
  }

  /**
   * Remembers the files the user handled, for "Allega" to offer back — not
   * the copies the app keeps for itself, such as a forward's attachments.
   */
  async recordRecentFiles(paths: ReadonlyArray<string>, activity: string): Promise<void> {
    const folders = privateFolders()
    await this.database.recordRecentFiles(
      await Promise.all(
        paths.filter((path) => isUserFile(path, folders)).map((path) => canonicalPath(path))
      ),
      activity
    )
  }

  /* ──────────────────────────────── marks ──────────────────────────────── */

  /**
   * An extension marks messages still where `ref` says (`MessageMark`): kept
   * by their identity, with places and files as the app keeps paths — under
   * the mount point their share first had. The rows and the reader showing
   * them are told. Resolves with each message's key, for what follows.
   */
  async recordMarks(
    extension: string,
    entries: ReadonlyArray<{ ref: MessageRef; label: string; place?: string; files?: string[] }>
  ): Promise<Array<{ ref: MessageRef; messageKey: string }>> {
    const refKey = (ref: MessageRef): string =>
      `${ref.accountId}\u0000${ref.folderPath}\u0000${ref.uid}`
    const identities = new Map(
      (await this.database.messageIdentities(entries.map((entry) => entry.ref))).map((identity) => [
        refKey(identity.ref),
        identity
      ])
    )
    const marks = await Promise.all(
      entries.map(async (entry) => {
        const identity = identities.get(refKey(entry.ref))

        if (!identity) {
          throw new Error(messages(MESSAGES).messageMoved)
        }

        return {
          extension,
          accountId: entry.ref.accountId,
          messageKey: identity.messageKey,
          threadId: identity.threadId,
          fromAddress: identity.fromAddress,
          label: entry.label,
          place: entry.place ? await canonicalPath(entry.place) : null,
          files: await Promise.all((entry.files ?? []).map((file) => canonicalPath(file)))
        }
      })
    )

    await this.database.recordMarks(marks)
    this.marksChanged(marks)
    return marks.map((mark, index) => ({ ref: entries[index].ref, messageKey: mark.messageKey }))
  }

  /** The marks an extension left on these messages, each by its `ref` as given. */
  async marksOfRefs(
    extension: string,
    refs: ReadonlyArray<MessageRef>
  ): Promise<
    Array<{
      ref: MessageRef
      label: string
      place: string | null
      files: string[]
      markedAt: number
    }>
  > {
    const marks: Array<{
      ref: MessageRef
      label: string
      place: string | null
      files: string[]
      markedAt: number
    }> = []

    for (const identity of await this.database.messageIdentities(refs)) {
      for (const mark of await this.database.marksOf(identity.ref.accountId, [
        identity.messageKey
      ])) {
        if (mark.extension === extension) {
          marks.push({
            ref: identity.ref,
            label: mark.label,
            place: mark.place,
            files: mark.files,
            markedAt: mark.markedAt
          })
        }
      }
    }

    return marks
  }

  /** The marks on these messages, every extension's, the newest first. */
  async messageMarks(
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<MessageMark[]> {
    const marks: MessageMark[] = []

    for (const accountId of new Set(messages.map((message) => message.accountId))) {
      marks.push(
        ...(await this.database.marksOf(
          accountId,
          messages
            .filter((message) => message.accountId === accountId)
            .map((message) => message.messageKey)
        ))
      )
    }

    return marks.sort((left, right) => right.markedAt - left.markedAt)
  }

  /** Where earlier mail of these messages' conversations, or else of their senders, was marked with a place. */
  markedBefore(
    messages: ReadonlyArray<{ accountId: string; threadId: string; from: string | null }>
  ): Promise<MarkedBefore | null> {
    return this.database.markedBefore(
      [
        ...new Map(
          messages.map((message) => [`${message.accountId}\u0000${message.threadId}`, message])
        ).values()
      ].map(({ accountId, threadId }) => ({ accountId, threadId })),
      [...new Set(messages.flatMap((message) => (message.from ? [message.from] : [])))]
    )
  }

  /** The marks under a folder that moved, kept where it is now (`moved`); how many. The rows are told. */
  async relocateMarks(moved: (path: string) => string | null): Promise<number> {
    const count = await this.database.relocateMarks(moved)

    if (count > 0) {
      getAppWindow()?.webContents.send(IPC_CHANNELS.marksChanged, null)
    }

    return count
  }

  private marksChanged(marks: ReadonlyArray<{ accountId: string; messageKey: string }>): void {
    for (const accountId of new Set(marks.map((mark) => mark.accountId))) {
      const change: MessageMarksChange = {
        accountId,
        messageKeys: marks
          .filter((mark) => mark.accountId === accountId)
          .map((mark) => mark.messageKey)
      }
      getAppWindow()?.webContents.send(IPC_CHANNELS.marksChanged, change)
    }
  }

  async listRecentFiles(): Promise<RecentFile[]> {
    return listRecentFiles(
      await this.database.listRecentFiles(RECENT_FILES_OFFERED * 3),
      RECENT_FILES_OFFERED
    )
  }

  /**
   * Turns paths dropped on the composer or picked from the recent files into
   * attachments. Folders are refused by name, and a file that vanished or
   * sits on a share that is gone says so, instead of failing at send time.
   */
  async describeFiles(input: string[]): Promise<PickedAttachment[]> {
    const paths = filePathsSchema.parse(input)

    return Promise.all(
      paths.map(async (given) => {
        // A file on a share the restart left unmounted, or mounted elsewhere, is still there.
        const filePath = await reachablePath(given)
        const stats = await stat(filePath).catch(() => null)

        if (!stats) {
          throw new Error(messages(MESSAGES).fileGone(basename(filePath)))
        }

        if (!stats.isFile()) {
          throw new Error(messages(MESSAGES).folderNotFile(basename(filePath)))
        }

        return { path: filePath, name: basename(filePath), size: stats.size }
      })
    )
  }

  async clearAttachmentCache(): Promise<void> {
    await this.dropAttachmentCopies()
  }

  /** The iCalendar file a message carries, as text; null when it carries none. */
  async invitationText(ref: MessageRef): Promise<string | null> {
    const message = await this.requireMessage(ref)
    const file = message.attachments.find(isIcsAttachment)

    if (!file) {
      return null
    }

    const [fetched] = await this.engine.fetchAttachments(
      ref,
      [{ index: parseAttachmentIndex(file.id), part: file.part }],
      message.size
    )
    return fetched ? fetched.content.toString('utf8') : null
  }

  /**
   * An invitation answered by mail (iMIP): the event is in no calendar
   * reached here, so the organizer gets the answer as their calendar reads
   * it — from the account the invitation came to, by the address it named.
   */
  async respondToInvitationByMail(
    ref: MessageRef,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<void> {
    const text = await this.invitationText(ref)
    const stored = await this.database.getStoredAccountById(ref.accountId)

    if (!text || !stored) {
      throw new Error(messages(MESSAGES).invitationGone)
    }

    const account = { ...stored, secret: decryptSecret(stored.encryptedSecret) }
    const addresses = (await this.database.getAccounts()).map((candidate) => candidate.email)
    const reply = invitationReply(
      text,
      { addresses, address: account.email, name: account.displayName },
      response
    )
    const said = invitationAnswer(response, account.displayName, reply.summary)

    await this.deliver(account, {
      from: { name: account.displayName, address: account.email },
      to: [{ address: reply.organizer }],
      cc: [],
      bcc: [],
      subject: `${said.subject}: ${reply.summary}`,
      text: said.body,
      html: '',
      attachments: [],
      icalEvent: { method: 'REPLY', content: reply.ics }
    })
  }

  private async requireMessage(ref: MessageRef): Promise<MailMessageDetail> {
    await this.ensureAccountExists(ref.accountId)
    return this.getMessage(ref)
  }

  private async resolveEffectiveUnifiedInboxAccountIds(accounts: MailAccount[]): Promise<string[]> {
    if (accounts.length === 0) {
      return []
    }

    const configuredIncludedAccountIds = await this.database.getUnifiedInboxIncludedAccountIds()

    if (configuredIncludedAccountIds === null) {
      return accounts.map((account) => account.id)
    }

    const accountIdSet = new Set(accounts.map((account) => account.id))

    return configuredIncludedAccountIds.filter((accountId) => accountIdSet.has(accountId))
  }

  private async includeAccountInUnifiedInbox(accountId: string): Promise<void> {
    const configuredIncludedAccountIds = await this.database.getUnifiedInboxIncludedAccountIds()

    if (configuredIncludedAccountIds === null) {
      return
    }

    const validAccountIds = new Set(
      (await this.database.getAccounts()).map((account) => account.id)
    )
    const normalizedIncludedAccountIds = configuredIncludedAccountIds.filter((id) =>
      validAccountIds.has(id)
    )

    if (normalizedIncludedAccountIds.includes(accountId)) {
      return
    }

    await this.database.setUnifiedInboxIncludedAccountIds([
      ...normalizedIncludedAccountIds,
      accountId
    ])
  }

  private async ensureAccountExists(accountId: string): Promise<MailAccount> {
    // A mailbox being removed takes no more work: what asks now would find it half gone.
    if (this.leaving.has(accountId)) {
      throw new Error(messages(MESSAGES).mailboxLeaving)
    }

    const account = await this.database.getStoredAccountById(accountId)

    if (!account) {
      throw new Error(messages(MESSAGES).mailboxGone)
    }

    return account
  }
}
