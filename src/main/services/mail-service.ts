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
  AttachmentRef,
  DataStorageBreakdown,
  ListMessagesOptions,
  MailAccount,
  MailAccountSignature,
  MailContactSuggestion,
  MailFolder,
  MailMessageDetail,
  MailMessageListPage,
  MessageRef,
  MoveMessageInput,
  OpenAttachmentResult,
  PickedAttachment,
  RecentFile,
  SavedAttachments,
  ToggleFlaggedInput,
  ToggleSeenInput,
  UiPreferences,
  UnifiedInboxPreferences,
  UnifiedInboxSummary
} from '@shared/models'
import {
  ALL_INBOX_FOLDER_PATH,
  MESSAGE_LIST_PAGE_SIZE,
  READER_ZOOM_MAX,
  READER_ZOOM_MIN
} from '@shared/models'

import {
  accountAttachmentCacheDirectory,
  attachmentCacheRoot,
  clearAttachmentCache,
  directorySize,
  fileSha256,
  isExecutableAttachment,
  markFromInternet,
  openedAttachmentDirectory,
  sha256
} from './attachment-files'
import { AppDatabase } from './database'
import { finalizeUpgradeMigration } from './data-migration'
import { resolveUniqueFilePath, sanitizePathSegment } from './file-utils'
import { GoogleOAuthService } from './google-oauth'
import { MailEngine } from './mail-engine'
import {
  buildRawOutgoingMessage,
  createOutgoingMessagePayload,
  createSmtpTransport,
  verifyImapAccount
} from './mail-engine/mail-transport'
import { applyThemeMode } from '../theme'
import { listRecentFiles } from './recent-files'
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

const composeSchema = z.object({
  accountId: z.string().trim().min(1),
  to: z.array(z.string().trim().email()),
  cc: z.array(z.string().trim().email()),
  bcc: z.array(z.string().trim().email()),
  subject: z.string().trim().min(1),
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

const messageRefSchema = z.object({
  accountId: z.string().trim().min(1),
  folderPath: z.string().trim().min(1),
  uid: z.number().int().positive()
})
const attachmentRefSchema = z.object({
  ref: messageRefSchema,
  attachmentId: z.string().trim().min(1)
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
  readerZoom: z.number().int().min(READER_ZOOM_MIN).max(READER_ZOOM_MAX)
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
  // The copy each opened attachment was last written to, and what it held,
  // keyed by its folder: reopening an untouched copy needs no download.
  private readonly openedAttachments = new Map<string, { filePath: string; digest: string }>()

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
      recordRecentFiles: (paths, activity) => this.database.recordRecentFiles(paths, activity)
    }

    await extension.install(context)
    this.extension = extension
  }

  async bootstrap(): Promise<AppBootstrap> {
    await this.database.ensureContactSuggestionsSeeded()

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
    this.database.queueContactSuggestions([
      {
        email: account.email,
        name: account.displayName
      }
    ])
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
    this.database.queueContactSuggestions([
      {
        email: account.email,
        name: account.displayName
      }
    ])
    await this.engine.addAccount(account.id)
    return account
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.ensureAccountExists(accountId)
    await this.engine.removeAccount(accountId)
    await this.database.clearAccountData(accountId)
    await this.database.deleteAccount(accountId)
    await this.dropOpenedAttachments(accountId)
  }

  async markAccountLastViewed(accountId: string): Promise<void> {
    await this.ensureAccountExists(accountId)
    await this.database.markAccountLastViewed(accountId)
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

  async getUnifiedInboxSummary(): Promise<UnifiedInboxSummary> {
    return this.engine.computeUnifiedInboxSummary()
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

  async getUnifiedInboxPreferences(): Promise<UnifiedInboxPreferences> {
    const accounts = await this.database.getAccounts()
    const includedAccountIds = await this.resolveEffectiveUnifiedInboxAccountIds(accounts)

    return {
      includedAccountIds
    }
  }

  async setUnifiedInboxIncludedAccounts(accountIds: string[]): Promise<UnifiedInboxPreferences> {
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

  async listMessages(
    accountId: string,
    folderPath: string,
    options?: ListMessagesOptions
  ): Promise<MailMessageListPage> {
    if (folderPath === ALL_INBOX_FOLDER_PATH) {
      return this.listAllInboxMessages(options)
    }

    await this.ensureAccountExists(accountId)

    const limit = normalizeMessageListLimit(options?.limit)
    const query = options?.query?.trim()
    const sort = options?.sort
    const grouping = options?.grouping
    const filter = options?.filter
    const messages = await this.database.listMessages(
      accountId,
      folderPath,
      limit,
      query,
      sort,
      grouping,
      filter
    )
    const totalInQuery = await this.database.countMessages(accountId, folderPath, query, filter)
    const folder = await this.database.getFolder(accountId, folderPath)
    // A narrowed view reports what it actually holds; only the unfiltered
    // folder can lean on the server-side message count, which knows about
    // rows the local cache has not pulled down yet.
    const isNarrowed = Boolean(query) || (filter && filter !== 'all')
    const folderTotal = isNarrowed ? totalInQuery : (folder?.messageCount ?? totalInQuery)
    const total = Math.max(totalInQuery, folderTotal)

    return {
      messages,
      total,
      hasMore: total > messages.length,
      limit,
      folderLastSyncedAt: folder?.lastSyncedAt
    }
  }

  private async listAllInboxMessages(options?: ListMessagesOptions): Promise<MailMessageListPage> {
    const limit = normalizeMessageListLimit(options?.limit)
    const query = options?.query?.trim()
    const sort = options?.sort
    const filter = options?.filter
    const mailboxes = await this.engine.resolveUnifiedInboxMailboxes()

    if (mailboxes.length === 0) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        limit
      }
    }

    const messages = await this.database.listMessagesInMailboxes(
      mailboxes,
      limit,
      query,
      sort,
      options?.grouping,
      filter
    )
    const isNarrowed = Boolean(query) || (filter && filter !== 'all')
    const totalInQuery = isNarrowed
      ? await this.database.countMessagesInMailboxes(mailboxes, query, filter)
      : await this.computeUnifiedMessageCount(mailboxes)
    const summary = await this.engine.computeUnifiedInboxSummary()
    const folderTotal = isNarrowed ? totalInQuery : summary.messageCount
    const total = Math.max(totalInQuery, folderTotal)

    return {
      messages,
      total,
      hasMore: total > messages.length,
      limit,
      folderLastSyncedAt: summary.lastSyncedAt
    }
  }

  private async computeUnifiedMessageCount(
    mailboxes: Array<{ accountId: string; folderPath: string }>
  ): Promise<number> {
    let total = 0
    for (const mailbox of mailboxes) {
      const folder = await this.database.getFolder(mailbox.accountId, mailbox.folderPath)
      total += folder?.messageCount ?? 0
    }
    return total
  }

  async getMessage(ref: MessageRef): Promise<MailMessageDetail> {
    await this.ensureAccountExists(ref.accountId)

    const cached = await this.database.getMessage(ref)
    if (cached && (cached.html !== undefined || cached.text !== undefined)) {
      return cached
    }

    const fetched = await this.engine.fetchMessageDetail(ref)

    await this.database.updateMessageBody(
      ref,
      fetched.html,
      fetched.text,
      fetched.bcc,
      fetched.attachments
    )

    return (await this.database.getMessage(ref)) ?? { ...fetched, senderLabel: fetched.senderName }
  }

  async moveMessage(input: MoveMessageInput): Promise<void> {
    await this.ensureAccountExists(input.accountId)
    await this.engine.moveMessage(
      { accountId: input.accountId, folderPath: input.folderPath, uid: input.uid },
      input.destinationFolderPath
    )
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this.ensureAccountExists(ref.accountId)
    await this.engine.deleteMessage(ref)
  }

  async archiveMessage(ref: MessageRef): Promise<void> {
    await this.ensureAccountExists(ref.accountId)
    await this.engine.archiveMessage(ref)
  }

  async toggleSeen(input: ToggleSeenInput): Promise<void> {
    await this.ensureAccountExists(input.accountId)
    await this.engine.toggleSeen(
      { accountId: input.accountId, folderPath: input.folderPath, uid: input.uid },
      input.seen
    )
  }

  async toggleFlagged(input: ToggleFlaggedInput): Promise<void> {
    await this.ensureAccountExists(input.accountId)
    await this.engine.toggleFlagged(
      { accountId: input.accountId, folderPath: input.folderPath, uid: input.uid },
      input.flagged
    )
  }

  async sendMail(input: ComposeMailInput): Promise<void> {
    const payload = composeSchema.parse(input)
    const stored = await this.database.getStoredAccountById(payload.accountId)
    if (!stored) {
      throw new Error('Account non trovato.')
    }

    const account = {
      ...stored,
      secret: decryptSecret(stored.encryptedSecret)
    }

    const outgoing = createOutgoingMessagePayload(account, payload)
    const rawOutgoing = account.type === 'imap' ? await buildRawOutgoingMessage(outgoing) : null
    const transport = await createSmtpTransport(account, this.googleOAuthService)

    try {
      const result = await transport.sendMail(outgoing)

      this.database.queueContactSuggestions([
        ...payload.to.map((email) => ({ email })),
        ...payload.cc.map((email) => ({ email })),
        ...payload.bcc.map((email) => ({ email }))
      ])
      await this.database.recordRecentFiles(
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
    await this.database.ensureContactSuggestionsSeeded()

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
          id: 'opened-attachments',
          label: 'Allegati aperti',
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
    await this.dropOpenedAttachments(accountId)
    await this.engine.addAccount(accountId)
  }

  private async dropOpenedAttachments(accountId?: string): Promise<void> {
    const scope = accountId ? accountAttachmentCacheDirectory(accountId) : attachmentCacheRoot()

    for (const directory of this.openedAttachments.keys()) {
      if (directory.startsWith(scope)) {
        this.openedAttachments.delete(directory)
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
    await this.dropOpenedAttachments()
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
    const index = parseAttachmentIndex(attachmentId)
    const listed = message.attachments.find((attachment) => attachment.id === attachmentId)

    if (!listed) {
      throw new Error('Allegato non disponibile per questo messaggio.')
    }

    if (isExecutableAttachment(listed.fileName)) {
      return { status: 'blocked' }
    }

    const directory = openedAttachmentDirectory(ref.accountId, [
      ref.folderPath,
      ref.uid,
      message.messageId ?? message.date,
      index
    ])
    const known = this.openedAttachments.get(directory)
    let filePath =
      known && (await fileSha256(known.filePath)) === known.digest ? known.filePath : null

    if (!filePath) {
      const [attachment] = await this.engine.fetchAttachments(ref, [index])
      const digest = sha256(attachment.content)
      const target = join(directory, sanitizePathSegment(attachment.fileName, 'allegato'))
      const existingDigest = await fileSha256(target)

      if (existingDigest === digest) {
        filePath = target
      } else {
        await mkdir(directory, { recursive: true })
        filePath = existingDigest
          ? await resolveUniqueFilePath(directory, basename(target))
          : target
        await writeFile(filePath, attachment.content)
        await markFromInternet(filePath)
      }

      this.openedAttachments.set(directory, { filePath, digest })
    }

    const failure = await shell.openPath(filePath)
    return failure ? { status: 'no-application' } : { status: 'opened' }
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

    const [attachment] = await this.engine.fetchAttachments(ref, [
      parseAttachmentIndex(attachmentId)
    ])
    await writeFile(choice.filePath, attachment.content)
    await markFromInternet(choice.filePath)
    await this.database.recordRecentFiles([choice.filePath], SAVED_ATTACHMENT_ACTIVITY)

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
    await this.requireMessage(ref)

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

    const attachments = await this.engine.fetchAttachments(ref)
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

    await this.database.recordRecentFiles(filePaths, SAVED_ATTACHMENT_ACTIVITY)
    return { directory, filePaths }
  }

  revealFile(filePath: string): void {
    shell.showItemInFolder(z.string().min(1).parse(filePath))
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
    await this.dropOpenedAttachments()
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
