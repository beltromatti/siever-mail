import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

import type {
  ExtensionDatabaseHandle,
  ExtensionMain,
  ExtensionMailEngineHandle,
  ExtensionMainContext
} from '@app/extension/types'
import { z } from 'zod'

import type { RuntimeConfig } from '@main/config/env'
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
  UiPreferences,
  UnifiedFolderSummary,
  UnifiedPreferences
} from '@shared/models'
import { isValidEmailAddress } from '@shared/email-address'
import { UNIFIED_FOLDER_ROLES, unifiedFolderRole, type FolderRole } from '@shared/folders'
import { MESSAGE_LIST_PAGE_SIZE, READER_ZOOM_MAX, READER_ZOOM_MIN } from '@shared/models'
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
import { AppDatabase, type MessageListView } from './database'
import { finalizeUpgradeMigration } from './data-migration'
import { resolveUniqueFilePath, sanitizePathSegment } from './file-utils'
import { GoogleOAuthService } from './google-oauth'
import { MailEngine } from './mail-engine'
import { imapSearchGroups } from './mail-engine/server-search'
import {
  buildRawOutgoingMessage,
  createOutgoingMessagePayload,
  createSmtpTransport,
  verifyImapAccount
} from './mail-engine/mail-transport'
import { updateAppMenuShortcuts } from '../app-menu'
import { applyThemeMode } from '../theme'
import { isUserFile, listRecentFiles, privateFolders } from './recent-files'
import { decryptSecret, encryptSecret } from './secure-storage'

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
/** A selection can be the whole folder; past this it is split by the caller. */
const MAX_MESSAGES_PER_ACTION = 20_000
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

export class MailService {
  private readonly database: AppDatabase
  private readonly googleOAuthService: GoogleOAuthService
  private readonly engine: MailEngine
  private extension: ExtensionMain | null = null
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
    this.engine = new MailEngine({
      database: this.database,
      googleOAuthService: this.googleOAuthService,
      getMainWindow: () =>
        BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
    })
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
    await this.engine.start()
  }

  async stop(): Promise<void> {
    try {
      await this.extension?.uninstall?.()
    } catch (error) {
      logMainError('Extension teardown failed', error)
    }

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
      fetchMessageRawSource: (ref) => this.engine.fetchMessageRawSource(ref),
      moveMessageToTrash: (ref, options) => this.engine.moveMessageToTrash(ref, options)
    }

    const context: ExtensionMainContext = {
      app,
      ipcMain,
      userDataDirectoryPath: app.getPath('userData'),
      database: databaseHandle,
      mailEngine: mailEngineHandle,
      getMainWindow: () =>
        BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null,
      recordRecentFiles: (paths, activity) => this.recordRecentFiles(paths, activity),
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
        googleOAuthReady: this.googleOAuthService.isConfigured()
      },
      accounts: await this.database.getAccounts()
    }
  }

  async addImapAccount(input: AddImapAccountInput): Promise<MailAccount> {
    const payload = imapAccountSchema.parse(input)

    await verifyImapAccount(payload, this.googleOAuthService)

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
    return account
  }

  async addGoogleAccount(parentWindow?: BrowserWindow): Promise<MailAccount> {
    if (!this.googleOAuthService.isConfigured()) {
      throw new Error('Google OAuth is not configured in this environment.')
    }

    const oauthResult = await this.googleOAuthService.authorize(parentWindow)

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
    return account
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.ensureAccountExists(accountId)
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
    const mailboxes = await this.listMailboxes(accountId, folderPath)
    const view: MessageListView = {
      query: options?.query?.trim() || undefined,
      sort: options?.sort,
      grouping: options?.grouping,
      filter: options?.filter,
      serverMatches: options?.serverMatches
        ? messageRefsSchema.parse(options.serverMatches)
        : undefined
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
    const cachedCount = await this.database.countMessagesInMailboxes(mailboxes, {})
    const available = narrowed
      ? await this.database.countMessagesInMailboxes(mailboxes, view)
      : cachedCount
    const folders = await Promise.all(
      mailboxes.map((mailbox) => this.database.getFolder(mailbox.accountId, mailbox.folderPath))
    )
    const serverCount = folders.reduce((total, folder) => total + (folder?.messageCount ?? 0), 0)
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

  /** The mailboxes a list shows: one folder, or those "Tutti gli account" gathers for a role. */
  private async listMailboxes(
    accountId: string,
    folderPath: string
  ): Promise<Array<{ accountId: string; folderPath: string }>> {
    const role = unifiedFolderRole(folderPath)

    if (role) {
      return this.engine.resolveUnifiedMailboxes(role)
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
    const result = await this.engine.moveMessages(payload.refs, payload.destinationFolderPath)
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
    return this.engine.moveMessagesToRole(payload.refs, payload.role)
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
    return this.engine.deleteMessages(payload)
  }

  async archiveMessages(refs: MessageRef[]): Promise<MessagesActionResult> {
    const payload = messageRefsSchema.parse(refs)
    await this.ensureAccountsExist(payload)
    return this.engine.archiveMessages(payload)
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

    const outgoing = createOutgoingMessagePayload(account, payload)
    const rawOutgoing = account.type === 'imap' ? await buildRawOutgoingMessage(outgoing) : null
    const transport = await createSmtpTransport(account, this.googleOAuthService)

    try {
      const result = await transport.sendMail(outgoing)

      // The message has gone: counting who it went to must not turn that into a failure.
      void this.database
        .recordContactsWritten([...payload.to, ...payload.cc, ...payload.bcc])
        .catch((error: unknown) => logMainError('Counting the recipients failed', error))
      await this.recordRecentFiles(
        payload.attachments.map((attachment) => attachment.path),
        SENT_ATTACHMENT_ACTIVITY
      )

      if (account.type === 'imap' && rawOutgoing) {
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
