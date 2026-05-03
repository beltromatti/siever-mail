import { BrowserWindow } from 'electron'

import { logMainError } from '@main/utils/error-utils'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AccountConnectionState,
  ActiveMailboxContext,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MessageRef,
  UnifiedInboxSummary
} from '@shared/models'

import type { AppDatabase } from '../database'
import type { GoogleOAuthService } from '../google-oauth'
import { decryptSecret } from '../secure-storage'

import { AccountConnection } from './account-connection'
import type { AccountWithSecret } from './mail-transport'
import { NotificationManager } from './notifications'

export interface MailEngineDependencies {
  database: AppDatabase
  googleOAuthService: GoogleOAuthService
  getMainWindow: () => BrowserWindow | null
}

export class MailEngine {
  private readonly connections = new Map<string, AccountConnection>()
  private readonly notifications = new NotificationManager()
  private activeContext: ActiveMailboxContext | null = null

  constructor(private readonly deps: MailEngineDependencies) {}

  async start(): Promise<void> {
    const accounts = await this.deps.database.getAccounts()
    for (const account of accounts) {
      await this.attachAccount(account.id)
    }
  }

  async stop(): Promise<void> {
    const connections = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(connections.map((connection) => connection.stop()))
    this.notifications.dispose()
  }

  async addAccount(accountId: string): Promise<void> {
    await this.attachAccount(accountId)
  }

  async removeAccount(accountId: string): Promise<void> {
    const connection = this.connections.get(accountId)
    if (connection) {
      this.connections.delete(accountId)
      await connection.stop()
    }
  }

  async requestConnection(accountId: string): Promise<AccountConnection> {
    let connection = this.connections.get(accountId)
    if (!connection) {
      await this.attachAccount(accountId)
      connection = this.connections.get(accountId)
    }
    if (!connection) {
      throw new Error('Account non disponibile.')
    }
    return connection
  }

  setActiveContext(context: ActiveMailboxContext | null): void {
    this.activeContext = context
    for (const [accountId, connection] of this.connections) {
      connection.setActiveContext(
        context && context.accountId === accountId
          ? { accountId, folderPath: context.folderPath, uid: 0 }
          : null
      )
    }
  }

  async refreshAccountFolders(accountId: string): Promise<MailFolder[]> {
    const connection = await this.requestConnection(accountId)
    return connection.refreshFolders()
  }

  async forceSyncFolder(accountId: string, folderPath: string): Promise<void> {
    const connection = await this.requestConnection(accountId)
    await connection.forceSyncFolder(folderPath)
  }

  async fetchMessageDetail(ref: MessageRef): Promise<MailMessageDetail> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.fetchMessageDetail(ref)
  }

  async fetchRawSource(ref: MessageRef): Promise<Buffer> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.fetchRawSource(ref)
  }

  async toggleSeen(ref: MessageRef, seen: boolean): Promise<void> {
    const connection = await this.requestConnection(ref.accountId)
    await connection.toggleSeen(ref, seen)
  }

  async moveMessage(
    ref: MessageRef,
    destinationFolderPath: string,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<void> {
    const connection = await this.requestConnection(ref.accountId)
    await connection.moveMessage(ref, destinationFolderPath, options)
  }

  async deleteMessage(
    ref: MessageRef
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.deleteMessage(ref)
  }

  async archiveMessage(
    ref: MessageRef
  ): Promise<{ sourceFolder: string; destinationFolder: string }> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.archiveMessage(ref)
  }

  async moveMessageToTrash(
    ref: MessageRef,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.moveMessageToTrash(ref, options)
  }

  async appendToSent(
    accountId: string,
    rawMessage: Buffer,
    messageId: string
  ): Promise<string | null> {
    const connection = await this.requestConnection(accountId)
    return connection.appendToSent(rawMessage, messageId)
  }

  async fetchMessageRawSource(
    ref: MessageRef
  ): Promise<Awaited<ReturnType<AccountConnection['fetchMessageRawSource']>>> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.fetchMessageRawSource(ref)
  }

  async fetchAttachmentForDownload(
    ref: MessageRef,
    attachmentIndex: number
  ): Promise<Awaited<ReturnType<AccountConnection['fetchAttachmentForDownload']>>> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.fetchAttachmentForDownload(ref, attachmentIndex)
  }

  async computeUnifiedInboxSummary(): Promise<UnifiedInboxSummary> {
    const accounts = await this.deps.database.getAccounts()
    const includedIds = await this.resolveIncludedAccountIds(accounts.map((account) => account.id))
    const mailboxes = await this.resolveInboxMailboxes(includedIds)

    if (mailboxes.length === 0) {
      return { messageCount: 0, unseenCount: 0 }
    }

    let messageCount = 0
    let unseenCount = 0
    let latestSync: number | undefined

    for (const mailbox of mailboxes) {
      const folder = await this.deps.database.getFolder(mailbox.accountId, mailbox.folderPath)
      if (!folder) {
        continue
      }
      messageCount += folder.messageCount
      unseenCount += folder.unseenCount
      if (folder.lastSyncedAt && (!latestSync || folder.lastSyncedAt > latestSync)) {
        latestSync = folder.lastSyncedAt
      }
    }

    return {
      messageCount,
      unseenCount,
      lastSyncedAt: latestSync
    }
  }

  async resolveUnifiedInboxMailboxes(): Promise<Array<{ accountId: string; folderPath: string }>> {
    const accounts = await this.deps.database.getAccounts()
    const includedIds = await this.resolveIncludedAccountIds(accounts.map((account) => account.id))
    return this.resolveInboxMailboxes(includedIds)
  }

  private async resolveIncludedAccountIds(allAccountIds: string[]): Promise<string[]> {
    const configured = await this.deps.database.getUnifiedInboxIncludedAccountIds()

    if (configured === null) {
      return allAccountIds
    }

    const set = new Set(allAccountIds)
    return configured.filter((id) => set.has(id))
  }

  private async resolveInboxMailboxes(
    accountIds: string[]
  ): Promise<Array<{ accountId: string; folderPath: string }>> {
    if (accountIds.length === 0) {
      return []
    }

    const mailboxes: Array<{ accountId: string; folderPath: string }> = []

    for (const accountId of accountIds) {
      const folders = await this.deps.database.listFolders(accountId)
      const inbox =
        folders.find((folder) => folder.specialUse?.trim().toLowerCase() === '\\inbox') ||
        folders.find((folder) => folder.path.trim().toLowerCase() === 'inbox') ||
        null

      if (inbox) {
        mailboxes.push({ accountId, folderPath: inbox.path })
      }
    }

    return mailboxes
  }

  private async attachAccount(accountId: string): Promise<void> {
    if (this.connections.has(accountId)) {
      return
    }

    const stored = await this.deps.database.getStoredAccountById(accountId)
    if (!stored) {
      return
    }

    const account: AccountWithSecret = {
      ...stored,
      secret: decryptSecret(stored.encryptedSecret)
    }

    const connection = new AccountConnection(
      this.deps.database,
      this.deps.googleOAuthService,
      account
    )

    connection.on('status', (status, error) => {
      const state: AccountConnectionState = {
        accountId,
        status,
        errorMessage: error?.message,
        lastConnectedAt: status === 'connected' ? Date.now() : undefined,
        lastErrorAt: status === 'error' ? Date.now() : undefined
      }
      this.broadcast(IPC_CHANNELS.accountConnectionChanged, state)
    })

    connection.on('folders', (folders) => {
      this.broadcast(IPC_CHANNELS.foldersChanged, { accountId, folders })
      void this.emitUnifiedInboxSummary()
    })

    connection.on('folder-counts', (update) => {
      this.broadcast(IPC_CHANNELS.messagesChanged, {
        accountId: update.accountId,
        folderPath: update.folderPath,
        added: [] as MailMessageSummary[],
        updated: [] as MailMessageSummary[],
        removedUids: [] as number[],
        folder: update
      })
      void this.emitUnifiedInboxSummary()
    })

    connection.on('messages', async (event) => {
      this.broadcast(IPC_CHANNELS.messagesChanged, {
        accountId: event.accountId,
        folderPath: event.folderPath,
        added: event.added,
        updated: event.updated,
        removedUids: event.removedUids
      })

      if (event.added.length > 0) {
        const folder = await this.deps.database.getFolder(event.accountId, event.folderPath)
        this.notifications.enqueue(event.accountId, event.added, folder, event.bootstrap)
      }

      void this.emitUnifiedInboxSummary()
    })

    this.connections.set(accountId, connection)
    connection.start()

    if (this.activeContext && this.activeContext.accountId === accountId) {
      connection.setActiveContext({
        accountId,
        folderPath: this.activeContext.folderPath,
        uid: 0
      })
    }
  }

  private async emitUnifiedInboxSummary(): Promise<void> {
    try {
      const summary = await this.computeUnifiedInboxSummary()
      this.broadcast(IPC_CHANNELS.unifiedInboxChanged, { summary })
    } catch (error) {
      logMainError('Unified inbox summary broadcast failed', error)
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }
}
