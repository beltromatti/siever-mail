import { randomUUID } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { basename, join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'

import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { NodeHtmlMarkdown } from 'node-html-markdown'

import type {
  ExtensionDatabaseHandle,
  ExtensionMain,
  ExtensionMailEngineHandle,
  ExtensionMainContext
} from '@app/extension/types'
import { z } from 'zod'

import type { RuntimeConfig } from '@main/config/env'
import type { DiscoveredMailSettings } from '@shared/connections'
import { logMainError } from '@main/utils/error-utils'
import type {
  AccountConnectionState,
  ActiveMailboxContext,
  AddImapAccountInput,
  AppBootstrap,
  ComposeMailInput,
  CreateFolderInput,
  MoveMessagesToRoleInput,
  RenameFolderInput,
  AttachmentRef,
  CopiedAttachment,
  DataStorageBreakdown,
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
  NotificationPreferences,
  NotificationStatus,
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
  MAX_MESSAGES_PER_ACTION,
  MESSAGE_LIST_PAGE_SIZE,
  READER_ZOOM_MAX,
  READER_ZOOM_MIN
} from '@shared/models'
import { parseSearchQuery } from '@shared/search'

import {
  accountAttachmentCacheDirectory,
  attachmentCacheRoot,
  attachmentCopyDirectory,
  clearAttachmentCache,
  directorySize,
  fileSha256,
  isExecutableAttachment,
  markFromInternet,
  sha256
} from './attachment-files'
import { APP_ID } from '@main/app-identity'
import { getAppWindow } from '@main/app-window'
import { SegretarioService } from '@main/ai/segretario-service'
import { CalendarService } from '@main/calendar/calendar-service'
import { GOOGLE_CALENDAR_SCOPE } from '@main/calendar/google-calendar'
import { invitationParties, invitationReply, occurrenceIn } from '@main/calendar/icalendar'
import { parseInvitation } from '@main/calendar/ics'
import { isIcsAttachment, type CalendarResponse, type MessageInvitation } from '@shared/calendar'
import type { MessageLocation, SegretarioMailPort } from '@main/ai/agent/tool-types'
import { AppBadge } from './app-badge'
import { DraftService, draftRefKey } from './drafts'
import { AppDatabase, type MessageListView } from './database'
import { finalizeUpgradeMigration } from './data-migration'
import { resolveUniqueFilePath, sanitizePathSegment } from './file-utils'
import { GOOGLE_MAIL_SCOPE, GoogleOAuthService } from './google-oauth'
import { discoverMailSettings } from './mail-discovery'
import { MailTokenBroker } from './mail-tokens'
import { MicrosoftOAuthService } from './microsoft-oauth'
import { MailEngine } from './mail-engine'
import { indexedFolderPaths } from './mail-engine/mail-indexer'
import { imapSearchGroups } from './mail-engine/server-search'
import {
  buildRawOutgoingMessage,
  createOutgoingMessagePayload,
  createSmtpTransport,
  verifyImapAccount,
  type AccountWithSecret,
  type OutgoingMessagePayload
} from './mail-engine/mail-transport'
import { updateAppMenuAi, updateAppMenuShortcuts } from '../app-menu'
import { applyThemeMode } from '../theme'
import { ensurePathReachable, rememberMountedShares } from './network-volumes'
import { isUserFile, listRecentFiles, privateFolders } from './recent-files'
import { decryptSecret, encryptSecret } from './secure-storage'
import { watchSystemSleep } from './system-sleep'

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
      error: (issue) => `«${String(issue.input)}» non è un indirizzo email valido.`
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
    error: 'Aggiungi almeno un destinatario.'
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

/** What the "Allega" menu calls the files it remembers from each place. */
const SENT_ATTACHMENT_ACTIVITY = 'Allegato a un messaggio'
const SAVED_ATTACHMENT_ACTIVITY = 'Salvato da un messaggio'
const RECENT_FILES_OFFERED = 8
const activeMailboxContextSchema = z.object({
  accountId: z.string().trim().min(1),
  folderPath: z.string().trim().min(1)
})
const MAX_ACCOUNT_SIGNATURE_HTML_LENGTH = 32000
const accountSignatureInputSchema = z.object({
  accountId: z.string().trim().min(1),
  html: z.string().max(MAX_ACCOUNT_SIGNATURE_HTML_LENGTH)
})
const notificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  mutedAccountIds: z.array(z.string().trim().min(1)).max(200),
  showPreview: z.boolean(),
  onlyImportant: z.boolean(),
  sound: z.boolean(),
  badge: z.boolean()
})

/** Recipients a draft keeps, as typed — valid addresses or not. */
const MAX_DRAFT_RECIPIENTS = 2_000
/** Long enough for the drafts being written to reach Bozze; never long enough to hold the quit up. */
const DRAFT_FLUSH_ON_QUIT_MS = 4_000

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

/** The system pages where the user allows an app's notifications. */
const SYSTEM_NOTIFICATION_SETTINGS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${APP_ID}`,
  win32: 'ms-settings:notifications'
}

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
  shortcutOverrides: z.record(z.string(), z.string())
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

  const hasEmbeddedMedia = /<(?:img|svg|video|audio)\b/i.test(trimmed)
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
      reject(init.signal?.reason ?? new Error('Interrotto.'))
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
const INVITATION_ANSWERS: Readonly<
  Record<Exclude<CalendarResponse, 'needsAction'>, { subject: string; body: string }>
> = {
  accepted: { subject: 'Accettato', body: 'ha accettato' },
  tentative: { subject: 'Accettato provvisoriamente', body: 'ha accettato provvisoriamente' },
  declined: { subject: 'Rifiutato', body: 'ha rifiutato' }
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

export class MailService {
  private readonly database: AppDatabase
  private readonly googleOAuthService: GoogleOAuthService
  private readonly microsoftOAuthService: MicrosoftOAuthService
  /** The tokens of the mailboxes signed in with Google or Microsoft. */
  private readonly tokens: MailTokenBroker
  private readonly engine: MailEngine
  private readonly badge: AppBadge
  private readonly drafts: DraftService
  /** SIEVER Mail's agent (see `src/main/ai`). */
  readonly segretario: SegretarioService
  readonly calendar: CalendarService
  private extension: ExtensionMain | null = null
  private unwatchSleep: (() => void) | null = null
  private storageReady: Promise<void> | null = null
  // The copy of each attachment last written, and what it held, keyed by its
  // folder: an untouched copy is used again without a download.
  private readonly attachmentCopies = new Map<string, { filePath: string; digest: string }>()

  constructor(config: RuntimeConfig) {
    const userDataPath = app.getPath('userData')
    mkdirSync(userDataPath, { recursive: true })
    const dbPath = join(userDataPath, 'siever-mail.sqlite')
    this.database = new AppDatabase(dbPath)
    this.googleOAuthService = new GoogleOAuthService(config)
    this.microsoftOAuthService = new MicrosoftOAuthService(config)
    this.tokens = new MailTokenBroker(
      this.googleOAuthService,
      this.microsoftOAuthService,
      (accountId, secret) => this.database.setAccountSecret(accountId, encryptSecret(secret))
    )
    this.badge = new AppBadge(getAppWindow)
    this.engine = new MailEngine({
      database: this.database,
      tokens: this.tokens,
      getMainWindow: getAppWindow,
      onInboxUnreadChange: (count) => this.badge.setCount(count),
      onMailChanged: () => this.segretario.mailChanged()
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
    this.calendar = new CalendarService({
      database: this.database,
      oauth: this.googleOAuthService,
      microsoft: this.microsoftOAuthService,
      fetch: (input, init) => net.fetch(input, init),
      send: (channel, payload) => getAppWindow()?.webContents.send(channel, payload),
      parentWindow: () => getAppWindow(),
      onDisconnected: (connectionId, names) =>
        void this.segretario
          .forgetCalendar(connectionId, names)
          .catch((error: unknown) =>
            logMainError('The Segretario could not let go of a calendar', error)
          )
    })
    this.segretario = new SegretarioService({
      database: this.database,
      mail: this.segretarioMailPort(),
      fetch: (input, init) => net.fetch(input, init),
      send: (channel, payload) => getAppWindow()?.webContents.send(channel, payload),
      onReadingChange: (reading) => this.engine.setSegretarioReading(reading),
      onEnabledChange: (on) => updateAppMenuAi(on),
      onNoteWritten: (note) => this.engine.noteWritten(note),
      calendar: {
        calendars: () => this.calendar.calendars(),
        connections: () => this.calendar.listConnections(),
        events: (fromIso, toIso) => this.calendar.events(fromIso, toIso),
        event: (eventKey) => this.calendar.event(eventKey),
        create: (event) => this.calendar.create(event),
        update: (eventKey, change) => this.calendar.update(eventKey, change),
        remove: (eventKey) => this.calendar.remove(eventKey),
        respond: (eventKey, response) => this.calendar.respond(eventKey, response),
        changesSince: (afterId, limit) => this.calendar.changesSince(afterId, limit),
        latestChangeId: () => this.calendar.latestChangeId()
      }
    })
  }

  /**
   * What the Segretario reaches of the mail: the same operations the
   * user's own clicks call, so its work shows in the views as theirs does.
   */
  private segretarioMailPort(): SegretarioMailPort {
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
      unreadConversations: async (sinceIso, limit) => {
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
          const rows = await this.database.listUnnotedConversations(
            account.id,
            segretarioFolders(await this.database.listFolders(account.id)),
            sinceIso,
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
      readingProgress: async (sinceIso, accountIds) => {
        let read = 0
        let total = 0

        for (const account of (await this.database.getAccounts()).filter(
          (candidate) => !accountIds || accountIds.includes(candidate.id)
        )) {
          const progress = await this.database.noteProgress(
            account.id,
            segretarioFolders(await this.database.listFolders(account.id)),
            sinceIso
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
      readMessage: async (ref) => {
        await this.ensureAccountExists(ref.accountId)
        let message = await this.database.getMessage(ref)

        if (!message) {
          throw new Error('Il messaggio non è più in questa cartella.')
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
          ...message,
          attachments: body?.attachments ?? message.attachments,
          replyTo: body?.replyTo ?? message.replyTo,
          references: body?.references ?? message.references,
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
          throw new Error('Allegato non disponibile per questo messaggio.')
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

  /**
   * Opens the database, reconciles its schema and finishes any upgrade
   * migration on it — purging the resyncable cache, or putting the user
   * data back after a failed upgrade — without touching the network.
   *
   * Everything the interface asks for waits on this (see
   * `register-mail-ipc`): the window loads alongside, and must never read
   * rows the migration is about to purge or restore. The migration runs on
   * the host's own connection on purpose: a second handle to the same file
   * would contend on the WAL and make `VACUUM` fail with SQLITE_BUSY.
   */
  openStorage(): Promise<void> {
    this.storageReady ??= this.database.waitUntilReady().then(() =>
      finalizeUpgradeMigration({
        run: (sql, params) => this.database.runRawSql(sql, params),
        all: (sql, params) => this.database.runRawSqlQuery(sql, params)
      })
    )

    return this.storageReady
  }

  async start(): Promise<void> {
    void rememberMountedShares().catch((error: unknown) =>
      logMainError('Reading the mounted network shares failed', error)
    )
    try {
      this.applyNotificationPreferences(await this.database.getNotificationPreferences())
      this.badge.setCount(await this.engine.inboxUnreadCount())
      await this.engine.start()
      await this.drafts.resume()
    } finally {
      // The calendar and the Segretario open whatever the mail did, so what waits for them
      // never hangs; one failing to open leaves the others working.
      await this.calendar
        .open()
        .catch((error: unknown) => logMainError('The calendar did not open', error))
      // A run the computer's sleep would cut short does not start, and waits for it to wake.
      this.unwatchSleep = watchSystemSleep((asleep) => this.segretario.setSystemAsleep(asleep))
      await this.segretario
        .open()
        .catch((error: unknown) => logMainError('The Segretario did not open', error))
    }
  }

  /** The app could not start: what waits for the calendar or the Segretario is told, not left waiting. */
  abandonStartup(error: unknown): void {
    this.calendar.abandon(error)
    this.segretario.abandon(error)
  }

  /** The window loaded anew: what only its page can draw is drawn again. */
  windowLoaded(): void {
    this.badge.redraw()
  }

  private applyNotificationPreferences(preferences: NotificationPreferences): void {
    this.engine.setNotificationPreferences(preferences)
    this.badge.setEnabled(preferences.badge)
  }

  async getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.database.getNotificationPreferences()
  }

  async setNotificationPreferences(
    input: NotificationPreferences
  ): Promise<NotificationPreferences> {
    const payload = notificationPreferencesSchema.parse(input)
    const accountIds = new Set((await this.database.getAccounts()).map((account) => account.id))
    const preferences: NotificationPreferences = {
      ...payload,
      mutedAccountIds: [...new Set(payload.mutedAccountIds)].filter((id) => accountIds.has(id))
    }

    await this.database.setNotificationPreferences(preferences)
    this.applyNotificationPreferences(preferences)
    return preferences
  }

  getNotificationStatus(): NotificationStatus {
    return this.engine.notificationStatus()
  }

  showTestNotification(): Promise<NotificationStatus> {
    return this.engine.showTestNotification()
  }

  async openNotificationSettings(): Promise<void> {
    const page = SYSTEM_NOTIFICATION_SETTINGS[process.platform]

    if (!page) {
      throw new Error('Su questo sistema le notifiche si regolano dalle impostazioni del desktop.')
    }

    await shell.openExternal(page)
  }

  setTaskbarBadgeImage(dataUrl: string | null, description: string): void {
    const image = z
      .string()
      .startsWith('data:image/png;base64,')
      .max(200_000)
      .nullable()
      .parse(dataUrl)
    this.badge.setOverlayImage(image, z.string().max(200).parse(description))
  }

  async stop(): Promise<void> {
    try {
      await this.extension?.uninstall?.()
    } catch (error) {
      logMainError('Extension teardown failed', error)
    }

    this.calendar.stop()
    this.unwatchSleep?.()
    this.unwatchSleep = null
    await this.segretario.stop()

    // What is being written reaches Bozze before the connections close.
    await this.drafts
      .flushAll(DRAFT_FLUSH_ON_QUIT_MS)
      .catch((error: unknown) => logMainError('Filing drafts on quit failed', error))
    await this.engine.stop()
    this.database.close()
  }

  /**
   * Builds the host-provided context surface and hands it to the
   * extension's `install()` hook. Called once after the engine is
   * started so the extension can run its own DDL and register IPC
   * handlers backed by the same SQLite connection.
   */
  async installExtension(extension: ExtensionMain): Promise<void> {
    const databaseHandle: ExtensionDatabaseHandle = {
      applyDdl: (sql) => this.database.runRawSql(sql),
      query: (sql, params) => this.database.runRawSqlQuery(sql, params),
      execute: async (sql, params) => {
        await this.database.runRawSql(sql, params)
      }
    }

    const mailEngineHandle: ExtensionMailEngineHandle = {
      fetchMessageRawSources: (refs, onMessage) =>
        this.engine.fetchMessageRawSources(refs, onMessage),
      archiveMessages: (refs) => this.archiveMessages(refs)
    }

    const context: ExtensionMainContext = {
      app,
      ipcMain,
      userDataDirectoryPath: app.getPath('userData'),
      database: databaseHandle,
      mailEngine: mailEngineHandle,
      getMainWindow: getAppWindow,
      recordRecentFiles: (paths, activity) => this.recordRecentFiles(paths, activity),
      // A copy is only saved once it is recorded: the record is what keeps it from being saved
      // twice and the message from being archived without it, so a record that fails is a save
      // that failed.
      copiesSaved: async (entries) => {
        const refKey = (ref: MessageRef): string =>
          `${ref.accountId}\u0000${ref.folderPath}\u0000${ref.uid}`

        try {
          await this.segretario.whenReady()
          const identities = new Map(
            (await this.database.messageIdentities(entries.map((entry) => entry.ref))).map(
              (identity) => [refKey(identity.ref), identity]
            )
          )

          await this.segretario.copiesSaved(
            entries.map((entry) => {
              const identity = identities.get(refKey(entry.ref))

              if (!identity) {
                throw new Error(
                  'Il messaggio non è più nella sua cartella: si è spostato mentre veniva salvato.'
                )
              }

              return {
                ref: entry.ref,
                messageKey: identity.messageKey,
                threadId: identity.threadId,
                fromAddress: identity.fromAddress,
                destination: entry.destination,
                files: entry.files,
                proposals: entry.proposals ?? []
              }
            })
          )
        } catch (error) {
          logMainError('Copies saved outside the mail could not be recorded', error)
          throw new Error(
            `SIEVER Mail non è riuscito a registrare la copia, che è stata tolta: il messaggio non viene archiviato. ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        }
      },
      // What is known of earlier copies. Not knowing it is no answer: a copy saved before would
      // be saved again, so the save does not start.
      savedCopies: async (refs) => {
        const copies: Array<{ ref: MessageRef; destination: string; files: string[] }> = []

        try {
          await this.segretario.whenReady()

          for (const identity of await this.database.messageIdentities(refs)) {
            for (const copy of await this.segretario.copiesOf(
              identity.ref.accountId,
              identity.messageKey
            )) {
              copies.push({ ref: identity.ref, destination: copy.destination, files: copy.files })
            }
          }
        } catch (error) {
          logMainError('Copies saved outside the mail could not be read', error)
          throw new Error(
            `SIEVER Mail non riesce a leggere le copie già salvate, e salvandole ancora le farebbe doppie: nessun messaggio è stato salvato. ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        }

        return copies
      },
      proposalDecided: async (id, accepted, result) => {
        try {
          await this.segretario.whenReady()
          await this.segretario.decideProposal(id, accepted, result ?? undefined)
        } catch (error) {
          logMainError('A proposal decided could not be recorded', error)
        }
      },
      adoptShortcutOverride: async (commandId, chord) => {
        const preferences = await this.database.getUiPreferences()

        if (preferences.shortcutOverrides[commandId] === undefined) {
          await this.database.setUiPreferences({
            ...preferences,
            shortcutOverrides: { ...preferences.shortcutOverrides, [commandId]: chord }
          })
        }
      }
    }

    await extension.install(context)
    this.extension = extension
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

    const account = await this.database.createAccount({
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

    await this.includeAccountInUnifiedInbox(account.id)
    this.database.learnContacts([{ address: account.email, name: account.displayName }])
    await this.engine.addAccount(account.id)
    await this.introduceNotifications(account)
    return account
  }

  /**
   * A Google account, in one consent: its mail and — when asked — its
   * calendar, two connections that came with the same access. An account
   * whose mail is here already only adds the calendar.
   */
  async addGoogleAccount(
    parentWindow: BrowserWindow | undefined,
    options: { calendar: boolean }
  ): Promise<MailAccount> {
    if (!this.googleOAuthService.isConfigured()) {
      throw new Error('Google OAuth is not configured in this environment.')
    }

    const oauthResult = await this.googleOAuthService.authorize(parentWindow, {
      scopes: options.calendar ? [GOOGLE_MAIL_SCOPE, GOOGLE_CALENDAR_SCOPE] : [GOOGLE_MAIL_SCOPE],
      title: options.calendar ? 'Collega la posta e il calendario di Google' : 'Collega Gmail'
    })

    if (!oauthResult.scopes.includes(GOOGLE_MAIL_SCOPE)) {
      throw new Error(
        "Google non ha dato l'accesso alla posta: rifallo lasciando selezionata la casella della posta."
      )
    }

    const known = (await this.database.getAccounts()).find(
      (candidate) => candidate.email.toLowerCase() === oauthResult.email.toLowerCase()
    )
    const withCalendar = options.calendar && oauthResult.scopes.includes(GOOGLE_CALENDAR_SCOPE)

    if (known) {
      if (!withCalendar) {
        throw new Error(`La posta di ${known.email} è già collegata.`)
      }

      await this.calendar.addGoogle(oauthResult.email, oauthResult.refreshToken, oauthResult.scopes)
      return known
    }

    const account = await this.database.createAccount({
      id: randomUUID(),
      type: 'gmail',
      email: oauthResult.email,
      displayName: oauthResult.displayName,
      username: oauthResult.email,
      authType: 'oauth',
      encryptedSecret: encryptSecret(oauthResult.refreshToken),
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapSecure: true,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true
    })

    await this.includeAccountInUnifiedInbox(account.id)
    this.database.learnContacts([{ address: account.email, name: account.displayName }])
    await this.engine.addAccount(account.id)
    await this.introduceNotifications(account)

    // The calendar came with the same consent; a problem reading it is the calendar's, not the mail's.
    if (withCalendar) {
      await this.calendar
        .addGoogle(oauthResult.email, oauthResult.refreshToken, oauthResult.scopes)
        .catch((error: unknown) =>
          logMainError('Google calendar not connected with its account', error, {
            accountId: account.id
          })
        )
    }

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

  /** Stops waiting for a sign-in left in the browser. */
  cancelSignIn(): void {
    this.microsoftOAuthService.cancelSignIn()
  }

  /**
   * A Microsoft account — Microsoft 365, Outlook.com — in one consent: its
   * mailbox over IMAP and SMTP and — when asked — its calendar over Graph.
   * An account whose mail is here already only adds the calendar.
   */
  async addMicrosoftAccount(options: { calendar: boolean }): Promise<MailAccount> {
    if (!this.microsoftOAuthService.isConfigured()) {
      throw new Error("L'accesso con Microsoft non è attivo in questa versione di SIEVER Mail.")
    }

    // Only the scopes of what is turned on: a mailbox alone does not ask for the calendar.
    const granted = await this.microsoftOAuthService.authorize(undefined, {
      mail: true,
      calendar: options.calendar
    })
    const known = (await this.database.getAccounts()).find(
      (candidate) => candidate.email.toLowerCase() === granted.email.toLowerCase()
    )

    if (known) {
      if (!options.calendar) {
        throw new Error(`La posta di ${known.email} è già collegata.`)
      }

      await this.calendar.addMicrosoft(granted.email, granted.secret)
      return known
    }

    const account = await this.database.createAccount({
      id: randomUUID(),
      type: 'imap',
      email: granted.email,
      displayName: granted.displayName,
      username: granted.email,
      authType: 'oauth',
      encryptedSecret: encryptSecret(granted.secret),
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecure: true,
      // Outlook.com sends through its own server; Microsoft 365 through Office 365's.
      smtpHost: granted.personal ? 'smtp-mail.outlook.com' : 'smtp.office365.com',
      smtpPort: 587,
      smtpSecure: false
    })

    await this.includeAccountInUnifiedInbox(account.id)
    this.database.learnContacts([{ address: account.email, name: account.displayName }])
    await this.engine.addAccount(account.id)
    await this.introduceNotifications(account)

    if (options.calendar) {
      await this.calendar.addMicrosoft(granted.email, granted.secret).catch((error: unknown) =>
        logMainError('Microsoft calendar not connected with its account', error, {
          accountId: account.id
        })
      )
    }

    return account
  }

  /**
   * The first account connected says, in a notification, that new mail
   * will be announced so — which is when macOS asks the user to allow the
   * app's notifications: in context, not hours later on the first message.
   */
  private async introduceNotifications(account: MailAccount): Promise<void> {
    if ((await this.database.getAccounts()).length === 1) {
      this.engine.showNotice(
        'SIEVER Mail è pronta',
        `Ti avviserà qui quando arriva nuova posta per ${account.email}.`
      )
    }
  }

  async removeAccount(accountId: string): Promise<void> {
    const account = await this.ensureAccountExists(accountId)
    await this.segretario.forgetAccount(accountId, account.email)
    await this.calendar.mailAccountRemoved(accountId)
    await this.engine.removeAccount(accountId)
    await this.database.clearAccountData(accountId)
    await this.database.deleteAccount(accountId)
    await this.dropAttachmentCopies(accountId)
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
      return message
    }

    const fetched = await this.engine.loadMessageBody(ref, size, 'read')
    return fetched ? this.storedDetail(ref, fetched) : null
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

  async sendMail(input: ComposeMailInput): Promise<void> {
    const payload = composeSchema.parse(input)
    const stored = await this.database.getStoredAccountById(payload.accountId)
    if (!stored) {
      throw new Error('Account non trovato.')
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

      throw error
    }

    if (payload.draftId) {
      void this.drafts
        .sent(payload.draftId)
        .catch((error: unknown) => logMainError('Deleting the sent draft failed', error))
    }

    // The message has gone: counting who it went to must not turn that into a failure.
    void this.database
      .recordContactsWritten([...payload.to, ...payload.cc, ...payload.bcc])
      .catch((error: unknown) => logMainError('Counting the recipients failed', error))
    await this.recordRecentFiles(
      payload.attachments.map((attachment) => attachment.path),
      SENT_ATTACHMENT_ACTIVITY
    )
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
    const transport = await createSmtpTransport(account, this.tokens)

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
          logMainError('Filing the sent copy failed', error, { accountId: account.id })
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
      const response = await net.fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers }
      })

      if (!response.ok) {
        throw new Error(
          `Microsoft non ha inviato il messaggio (${response.status}): ${await response.text()}`
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

  discardDraft(id: string): Promise<void> {
    return this.drafts.discard(z.string().uuid().parse(id))
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

  async setAccountSignature(accountId: string, html: string): Promise<MailAccountSignature | null> {
    const payload = accountSignatureInputSchema.parse({
      accountId,
      html
    })
    await this.ensureAccountExists(payload.accountId)

    return this.database.setAccountSignature(
      payload.accountId,
      normalizeAccountSignatureHtml(payload.html)
    )
  }

  /**
   * The database's share per account, plus the copies of opened
   * attachments on disk beside it — everything local that the data
   * settings let the user empty.
   */
  async getDataStorageBreakdown(): Promise<DataStorageBreakdown> {
    const [database, openedAttachmentsBytes] = await Promise.all([
      this.database.getDataStorageBreakdown(),
      directorySize(attachmentCacheRoot())
    ])

    return {
      totalBytes: database.totalBytes + openedAttachmentsBytes,
      sections: [
        ...database.sections,
        {
          id: 'attachment-copies',
          label: 'Copie degli allegati',
          kind: 'files',
          sizeBytes: openedAttachmentsBytes
        }
      ]
    }
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

  async clearAllDataKeepAccounts(): Promise<void> {
    const accounts = await this.database.getAccounts()

    // Stop every connection in parallel before we touch the DB: each stop awaits
    // its own IMAP logout + command-worker drain, so the slowest account doesn't
    // serialize the others. The wipe then runs on a quiesced state.
    await Promise.allSettled(accounts.map((account) => this.engine.removeAccount(account.id)))

    await this.database.clearAllDataKeepAccounts()
    await this.dropAttachmentCopies()
    await this.segretario.clearData()
    await this.calendar.clearData()
    await this.extension?.clearData()

    // Re-bootstrap all accounts in parallel. engine.addAccount returns once the
    // AccountConnection is created and its connection loop is started; the IMAP
    // connects and the bootstrap then run concurrently across accounts.
    await Promise.allSettled(accounts.map((account) => this.engine.addAccount(account.id)))
  }

  async pickAttachments(parentWindow?: BrowserWindow): Promise<PickedAttachment[]> {
    const options = {
      title: 'Allega file',
      buttonLabel: 'Allega',
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
      throw new Error('Allegato non disponibile per questo messaggio.')
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
      throw new Error('Allegato non disponibile per questo messaggio.')
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
        const target = join(directory, sanitizePathSegment(attachment.fileName, 'allegato'))
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
      throw new Error('Allegato non disponibile per questo messaggio.')
    }

    const options = {
      title: 'Salva allegato',
      buttonLabel: 'Salva',
      defaultPath: sanitizePathSegment(listed.fileName, 'allegato')
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
    await this.recordRecentFiles([choice.filePath], SAVED_ATTACHMENT_ACTIVITY)

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
      title: 'Salva tutti gli allegati',
      buttonLabel: 'Salva qui',
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
        sanitizePathSegment(attachment.fileName, 'allegato')
      )
      await writeFile(filePath, attachment.content)
      await markFromInternet(filePath)
      filePaths.push(filePath)
    }

    await this.recordRecentFiles(filePaths, SAVED_ATTACHMENT_ACTIVITY)
    return { directory, filePaths }
  }

  revealFile(filePath: string): void {
    shell.showItemInFolder(z.string().min(1).parse(filePath))
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
  private async recordRecentFiles(paths: ReadonlyArray<string>, activity: string): Promise<void> {
    const folders = privateFolders()
    await this.database.recordRecentFiles(
      paths.filter((path) => isUserFile(path, folders)),
      activity
    )
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
      paths.map(async (filePath) => {
        // A file on a share the restart left unmounted is still there.
        await ensurePathReachable(filePath)
        const stats = await stat(filePath).catch(() => null)

        if (!stats) {
          throw new Error(`${basename(filePath)} non è più disponibile.`)
        }

        if (!stats.isFile()) {
          throw new Error(`${basename(filePath)} è una cartella: si possono allegare solo file.`)
        }

        return { path: filePath, name: basename(filePath), size: stats.size }
      })
    )
  }

  async clearAttachmentCache(): Promise<void> {
    await this.dropAttachmentCopies()
  }

  /** The iCalendar file a message carries, as text; null when it carries none. */
  private async invitationText(ref: MessageRef): Promise<string | null> {
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

  /** The calendar invitation a message carries, with its event in any connected calendar. */
  async calendarInvitation(ref: MessageRef): Promise<MessageInvitation | null> {
    const text = await this.invitationText(ref)
    const invitation = text ? parseInvitation(text) : null

    if (!text || !invitation) {
      return null
    }

    const connected = (await this.calendar.listConnections()).length > 0
    // The occurrence the invitation is about (its RECURRENCE-ID), not the series' next one.
    const event = connected
      ? await this.calendar.eventByUid(invitation.uid, ref.accountId, invitation.instance)
      : null
    const { organizer } = invitationParties(text)
    const said = occurrenceIn(text, null, [])
    const own = new Set(
      (await this.database.getAccounts()).map((account) => account.email.toLowerCase())
    )

    return {
      method: invitation.method,
      summary: invitation.summary,
      event,
      calendarConnected: connected,
      organizer,
      when: said
        ? { start: said.start, end: said.end, allDay: said.allDay, location: said.location }
        : null,
      answerByMail:
        !event && invitation.method === 'REQUEST' && organizer !== null && !own.has(organizer),
      series: invitation.series
    }
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
      throw new Error('L’invito non c’è più.')
    }

    const account = { ...stored, secret: decryptSecret(stored.encryptedSecret) }
    const addresses = (await this.database.getAccounts()).map((candidate) => candidate.email)
    const reply = invitationReply(
      text,
      { addresses, address: account.email, name: account.displayName },
      response
    )
    const said = INVITATION_ANSWERS[response]

    await this.deliver(account, {
      from: { name: account.displayName, address: account.email },
      to: [{ address: reply.organizer }],
      cc: [],
      bcc: [],
      subject: `${said.subject}: ${reply.summary}`,
      text: `${account.displayName} ${said.body} l’invito «${reply.summary}».`,
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
    const account = await this.database.getStoredAccountById(accountId)

    if (!account) {
      throw new Error('Account not found.')
    }

    return account
  }
}
