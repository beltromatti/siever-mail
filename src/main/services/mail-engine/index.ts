import { BrowserWindow, net, powerMonitor } from 'electron'

import { logMainError } from '@main/utils/error-utils'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AccountConnectionState,
  MessagesActionResult,
  ActiveMailboxContext,
  FetchedMessageDetail,
  MailFolder,
  MailMessageSummary,
  MessageRef,
  UnifiedInboxSummary
} from '@shared/models'

import type { AppDatabase } from '../database'
import type { GoogleOAuthService } from '../google-oauth'
import { decryptSecret } from '../secure-storage'

import {
  AccountConnection,
  type BodyLoadIntent,
  type FetchedAttachment
} from './account-connection'
import type { AccountWithSecret } from './mail-transport'
import { NotificationManager } from './notifications'

export interface MailEngineDependencies {
  database: AppDatabase
  googleOAuthService: GoogleOAuthService
  getMainWindow: () => BrowserWindow | null
}

// How often to compare the network state with the last one seen. Reading it
// is free; Electron has no event for it in the main process.
const NETWORK_WATCH_INTERVAL_MS = 3_000

export class MailEngine {
  private readonly connections = new Map<string, AccountConnection>()
  private readonly notifications = new NotificationManager()
  private activeContext: ActiveMailboxContext | null = null
  private networkWatch: NodeJS.Timeout | null = null

  constructor(private readonly deps: MailEngineDependencies) {}

  async start(): Promise<void> {
    const accounts = await this.deps.database.getAccounts()
    for (const account of accounts) {
      await this.attachAccount(account.id)
    }

    this.watchSystemEvents()
  }

  async stop(): Promise<void> {
    this.unwatchSystemEvents()
    const connections = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(connections.map((connection) => connection.stop()))
    this.notifications.dispose()
  }

  /**
   * Waking up, unlocking the screen and the network coming or going all
   * leave the IMAP links in doubt. Every account checks itself right then,
   * instead of on its next timer — mail that arrived during the night shows
   * up as soon as the lid opens.
   */
  private watchSystemEvents(): void {
    powerMonitor.on('resume', this.nudgeConnections)
    powerMonitor.on('unlock-screen', this.nudgeConnections)

    let wasOnline = net.isOnline()
    this.networkWatch = setInterval(() => {
      const online = net.isOnline()

      if (online !== wasOnline) {
        wasOnline = online
        this.nudgeConnections()
      }
    }, NETWORK_WATCH_INTERVAL_MS)
  }

  private unwatchSystemEvents(): void {
    powerMonitor.removeListener('resume', this.nudgeConnections)
    powerMonitor.removeListener('unlock-screen', this.nudgeConnections)

    if (this.networkWatch) {
      clearInterval(this.networkWatch)
      this.networkWatch = null
    }
  }

  /** "Controlla nuova posta": every account looks at once instead of on its next poll. */
  checkNow(): void {
    for (const connection of this.connections.values()) {
      connection.checkNow()
    }
  }

  private readonly nudgeConnections = (): void => {
    for (const connection of this.connections.values()) {
      connection.nudge()
    }
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

  /**
   * Snapshot of the current connection state for every account the
   * engine knows about. Lets the renderer recover the truth at any
   * point — its `onAccountConnectionChanged` subscription only sees
   * STATE TRANSITIONS, so anything that already happened before the
   * subscription was set up (typically the initial 'connecting' →
   * 'connected' burst during bootstrap) would otherwise stay invisible
   * and force the badge to fall back to "Connessione persa".
   *
   * Accounts that don't have an active `AccountConnection` (deleted
   * mid-call, race with `removeAccount`, etc.) are simply omitted —
   * the renderer treats a missing entry as "unknown" and leaves its
   * existing value alone.
   */
  snapshotAccountConnectionStates(): AccountConnectionState[] {
    return [...this.connections].map(([accountId, connection]) => ({
      accountId,
      ...connection.getState()
    }))
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

  /** See `AccountConnection.loadMessageBody`. */
  async loadMessageBody(
    ref: MessageRef,
    size: number,
    intent: 'use' | 'prefetch'
  ): Promise<FetchedMessageDetail>
  async loadMessageBody(
    ref: MessageRef,
    size: number,
    intent: BodyLoadIntent
  ): Promise<FetchedMessageDetail | null>
  async loadMessageBody(
    ref: MessageRef,
    size: number,
    intent: BodyLoadIntent
  ): Promise<FetchedMessageDetail | null> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.loadMessageBody(ref, size, intent)
  }

  /**
   * Runs an action on messages grouped the way IMAP acts on them — one
   * folder of one account per command — every group at once. A group the
   * server refused is reported with its messages; the others stand.
   */
  private async onMessages(
    refs: ReadonlyArray<MessageRef>,
    action: (connection: AccountConnection, folderPath: string, uids: number[]) => Promise<unknown>
  ): Promise<MessagesActionResult> {
    const groups = new Map<string, MessageRef[]>()

    for (const ref of refs) {
      const key = `${ref.accountId}\u0000${ref.folderPath}`
      groups.set(key, [...(groups.get(key) ?? []), ref])
    }

    const batches = [...groups.values()]
    const outcomes = await Promise.allSettled(
      batches.map(async (batch) => {
        const connection = await this.requestConnection(batch[0].accountId)
        await action(
          connection,
          batch[0].folderPath,
          batch.map((ref) => ref.uid)
        )
      })
    )
    const failed: MessageRef[] = []
    let error: string | undefined

    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        failed.push(...batches[index])
        error ??= outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      }
    })

    return { failed, error }
  }

  async setMessagesSeen(
    refs: ReadonlyArray<MessageRef>,
    seen: boolean
  ): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.setSeen(folderPath, uids, seen)
    )
  }

  async setMessagesFlagged(
    refs: ReadonlyArray<MessageRef>,
    flagged: boolean
  ): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.setFlagged(folderPath, uids, flagged)
    )
  }

  /**
   * Moves messages to a folder of their account. A folder belongs to one
   * account, so messages of any other are refused with the reason.
   */
  async moveMessages(
    refs: ReadonlyArray<MessageRef>,
    destinationFolderPath: string
  ): Promise<MessagesActionResult> {
    const accountId = refs[0]?.accountId
    const foreign = refs.filter((ref) => ref.accountId !== accountId)
    const result = await this.onMessages(
      refs.filter((ref) => ref.accountId === accountId),
      (connection, folderPath, uids) =>
        connection.moveMessages(folderPath, uids, destinationFolderPath)
    )

    return foreign.length === 0
      ? result
      : {
          failed: [...result.failed, ...foreign],
          error:
            result.error ??
            'Ogni cartella appartiene a un solo account: i messaggi di altri account non sono stati spostati.'
        }
  }

  async deleteMessages(refs: ReadonlyArray<MessageRef>): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.deleteMessages(folderPath, uids)
    )
  }

  async archiveMessages(refs: ReadonlyArray<MessageRef>): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.archiveMessages(folderPath, uids)
    )
  }

  async moveMessageToTrash(
    ref: MessageRef,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.moveMessagesToTrash(ref.folderPath, [ref.uid], options)
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

  async fetchAttachments(
    ref: MessageRef,
    attachments: ReadonlyArray<{ index: number; part?: string }>,
    messageSize: number
  ): Promise<FetchedAttachment[]> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.fetchAttachments(ref, attachments, messageSize)
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

    connection.on('state', (snapshot) => {
      const state: AccountConnectionState = { accountId, ...snapshot }
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
