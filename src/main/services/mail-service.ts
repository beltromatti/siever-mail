import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import type {
  ExtensionDatabaseHandle,
  ExtensionMain,
  ExtensionMailEngineHandle,
  ExtensionMainContext
} from '@app/extension/types'
import { z } from 'zod'

import type { RuntimeConfig } from '@main/config/env'
import type {
  ActiveMailboxContext,
  AddImapAccountInput,
  AppBootstrap,
  ComposeMailInput,
  DataStorageBreakdown,
  DownloadAttachmentInput,
  DownloadAttachmentResult,
  ListMessagesOptions,
  MailAccount,
  MailAccountSignature,
  MailContactSuggestion,
  MailFolder,
  MailMessageDetail,
  MailMessageListPage,
  MessageRef,
  MoveMessageInput,
  PickedAttachment,
  ToggleSeenInput,
  UnifiedInboxPreferences,
  UnifiedInboxSummary
} from '@shared/models'
import { ALL_INBOX_FOLDER_PATH, MESSAGE_LIST_PAGE_SIZE } from '@shared/models'

import { AppDatabase } from './database'
import { resolveUniqueFilePath, sanitizePathSegment } from './file-utils'
import { GoogleOAuthService } from './google-oauth'
import { MailEngine } from './mail-engine'
import {
  buildRawOutgoingMessage,
  createOutgoingMessagePayload,
  createSmtpTransport,
  verifyImapAccount
} from './mail-engine/mail-transport'
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

const downloadAttachmentSchema = z.object({
  ref: z.object({
    accountId: z.string().trim().min(1),
    folderPath: z.string().trim().min(1),
    uid: z.number().int().positive()
  }),
  attachmentId: z.string().trim().min(1)
})
const activeMailboxContextSchema = z.object({
  accountId: z.string().trim().min(1),
  folderPath: z.string().trim().min(1)
})
const MAX_ACCOUNT_SIGNATURE_HTML_LENGTH = 32000
const accountSignatureInputSchema = z.object({
  accountId: z.string().trim().min(1),
  html: z.string().max(MAX_ACCOUNT_SIGNATURE_HTML_LENGTH)
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
        BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
    }

    await extension.install(context)
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
    const messages = await this.database.listMessages(accountId, folderPath, limit, query)
    const totalInQuery = await this.database.countMessages(accountId, folderPath, query)
    const folder = await this.database.getFolder(accountId, folderPath)
    const folderTotal = query ? totalInQuery : (folder?.messageCount ?? totalInQuery)
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
    const mailboxes = await this.engine.resolveUnifiedInboxMailboxes()

    if (mailboxes.length === 0) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        limit
      }
    }

    const messages = await this.database.listMessagesInMailboxes(mailboxes, limit, query)
    const totalInQuery = query
      ? await this.database.countMessagesInMailboxes(mailboxes, query)
      : await this.computeUnifiedMessageCount(mailboxes)
    const summary = await this.engine.computeUnifiedInboxSummary()
    const folderTotal = query ? totalInQuery : summary.messageCount
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

    return (await this.database.getMessage(ref)) ?? fetched
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

      if (account.type === 'imap' && rawOutgoing) {
        const messageId = typeof result?.messageId === 'string' ? result.messageId.trim() : ''
        await this.engine.appendToSent(account.id, rawOutgoing, messageId)
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

  async getDataStorageBreakdown(): Promise<DataStorageBreakdown> {
    return this.database.getDataStorageBreakdown()
  }

  async clearAccountData(accountId: string): Promise<void> {
    await this.ensureAccountExists(accountId)
    await this.engine.removeAccount(accountId)
    await this.database.clearAccountData(accountId)
    await this.engine.addAccount(accountId)
  }

  async clearAllDataKeepAccounts(): Promise<void> {
    const accounts = await this.database.getAccounts()

    // Stop every connection in parallel before we touch the DB: each stop awaits
    // its own IMAP logout + command-worker drain, so the slowest account doesn't
    // serialize the others. The wipe then runs on a quiesced state.
    await Promise.allSettled(accounts.map((account) => this.engine.removeAccount(account.id)))

    await this.database.clearAllDataKeepAccounts()

    // Re-bootstrap all accounts in parallel. engine.addAccount returns once the
    // AccountConnection is created and its connection loop is started; the IMAP
    // connects and the bootstrap then run concurrently across accounts.
    await Promise.allSettled(accounts.map((account) => this.engine.addAccount(account.id)))
  }

  async pickAttachments(): Promise<PickedAttachment[]> {
    const result = await dialog.showOpenDialog({
      title: 'Seleziona allegati',
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled) {
      return []
    }

    return result.filePaths.map((filePath) => ({
      path: filePath,
      name: basename(filePath),
      size: statSync(filePath).size
    }))
  }

  async downloadAttachment(input: DownloadAttachmentInput): Promise<DownloadAttachmentResult> {
    const payload = downloadAttachmentSchema.parse(input)
    const attachmentIndex = parseAttachmentIndex(payload.attachmentId)
    const attachment = await this.engine.fetchAttachmentForDownload(payload.ref, attachmentIndex)
    const downloadsDirectory = app.getPath('downloads')
    await mkdir(downloadsDirectory, { recursive: true })
    const fileName = sanitizePathSegment(attachment.fileName, 'allegato')
    const filePath = await resolveUniqueFilePath(downloadsDirectory, fileName)
    await writeFile(filePath, attachment.content)

    return {
      filePath
    }
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
