import { BrowserWindow, net, powerMonitor } from 'electron'
import type { SearchObject } from 'imapflow'

import { diagnostics } from '@main/diagnostics/log'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AccountConnectionState,
  ConnectionRefusal,
  MessagesActionResult,
  ActiveMailboxContext,
  FetchedMessageDetail,
  MailFolder,
  MailMessageSummary,
  MessageRef,
  UnifiedFolderSummary
} from '@shared/models'
import { folderForRole, UNIFIED_FOLDER_ROLES, type FolderRole } from '@shared/folders'
import type { NotificationCenter } from '@main/notifications/center'

import type { AppDatabase } from '../database'
import type { MailTokens } from '../mail-tokens'
import { decryptSecret } from '../secure-storage'
import { watchSystemSleep } from '../system-sleep'

import {
  AccountConnection,
  type BodyLoadIntent,
  type FetchedAttachment,
  type RawMessage,
  type TaskPriority
} from './account-connection'
import type { AccountWithSecret } from './mail-transport'
import { MailNotifications } from './notifications'

const log = diagnostics('mail')

export interface MailEngineDependencies {
  database: AppDatabase
  tokens: MailTokens
  getMainWindow: () => BrowserWindow | null
  /** The unread messages of every account's Posta in arrivo, whenever a count may have changed. */
  onInboxUnreadChange: (count: number) => void
  /** Messages had their text indexed, or went away: what reads the mail may look again. */
  onMailChanged: () => void
  /** An account's server turned it down for good: it stopped, and the user is to be told. */
  onRefused: (accountId: string, refusal: ConnectionRefusal, detail: string) => void
  /** The app's notifications: new mail is told through them (§13.3). */
  notifications: NotificationCenter
}

// How often to compare the network state with the last one seen. Reading it
// is free; Electron has no event for it in the main process.
const NETWORK_WATCH_INTERVAL_MS = 3_000

export class MailEngine {
  private readonly connections = new Map<string, AccountConnection>()
  private readonly notifications: MailNotifications
  private activeContext: ActiveMailboxContext | null = null
  private networkWatch: NodeJS.Timeout | null = null
  private unwatchSleep: (() => void) | null = null
  /** The computer is asleep: every account's links are closed until it wakes. */
  private asleep = false

  constructor(private readonly deps: MailEngineDependencies) {
    this.notifications = new MailNotifications({
      center: deps.notifications,
      actions: {
        markRead: (ref) => this.setMessagesSeen([ref], true),
        archive: (ref) => this.archiveMessages([ref])
      }
    })
  }

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
   * Going to sleep, every account closes its links (see
   * `AccountConnection.suspend`) and opens them again on waking — mail that
   * arrived during the night shows up as soon as the lid opens. Waking up,
   * unlocking the screen and the network coming or going all leave the
   * links in doubt besides — a sleep the system never announced: every
   * account checks itself right then, instead of on its next timer.
   */
  private watchSystemEvents(): void {
    this.unwatchSleep = watchSystemSleep((asleep) => {
      this.asleep = asleep

      for (const connection of this.connections.values()) {
        if (asleep) {
          connection.suspend()
        } else {
          connection.resume()
        }
      }
    })
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
    this.unwatchSleep?.()
    this.unwatchSleep = null
    powerMonitor.removeListener('resume', this.nudgeConnections)
    powerMonitor.removeListener('unlock-screen', this.nudgeConnections)

    if (this.networkWatch) {
      clearInterval(this.networkWatch)
      this.networkWatch = null
    }
  }

  /** Whether the Segretario reads new mail as it comes: notifications may wait for its reading. */
  setSegretarioReading(reading: boolean): void {
    this.notifications.setSegretarioReading(reading)
  }

  /** Messages the Segretario read: a new one waiting for its reading is not told. */
  messagesRead(accountId: string, messageKeys: ReadonlyArray<string>): void {
    this.notifications.read(accountId, messageKeys)
  }

  /** What the Segretario says of a message that came: told now, with its line. */
  alert(accountId: string, messageKey: string, line: string): 'told' | 'off' | 'not-new' {
    return this.notifications.alert(accountId, messageKey, line)
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

  /** Whether an account's server turned it down for good: it stopped, until put right. */
  accountRefusal(accountId: string): ConnectionRefusal | null {
    return this.connections.get(accountId)?.getState().refused ?? null
  }

  /**
   * An account put right — its secret replaced, or the server fixed: its
   * connection signs in again with what is stored now, at once.
   */
  async reconnectAccount(accountId: string): Promise<void> {
    const stored = await this.deps.database.getStoredAccountById(accountId)
    const connection = this.connections.get(accountId)

    if (!stored || !connection) {
      throw new Error('Questa casella non è più collegata.')
    }

    await connection.reconnect({ ...stored, secret: decryptSecret(stored.encryptedSecret) })
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
      const group = groups.get(key) ?? []
      group.push(ref)
      groups.set(key, group)
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

  /**
   * See `AccountConnection.moveMessagesToRole`; messages of any account.
   * Archivio is where archiving puts them, so they are archived.
   */
  async moveMessagesToRole(
    refs: ReadonlyArray<MessageRef>,
    role: FolderRole
  ): Promise<MessagesActionResult & { stayed?: MessageRef[] }> {
    if (role === '\\Archive') {
      return this.archiveMessages(refs)
    }

    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.moveMessagesToRole(folderPath, uids, role)
    )
  }

  async deleteMessages(refs: ReadonlyArray<MessageRef>): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.deleteMessages(folderPath, uids)
    )
  }

  /**
   * Archives messages of any account, each as its provider means it (see
   * `AccountConnection.archive`) — "Archivia" wherever it is asked, from a
   * notification as from the Segretario. What could not be archived is said
   * by the refs given; `stayed` are those archived already, left as they
   * were, and `kept` those still where they were shown (see
   * `MessagesActionResult.kept`).
   */
  async archiveMessages(
    refs: ReadonlyArray<MessageRef>
  ): Promise<MessagesActionResult & { stayed: MessageRef[]; kept: MessageRef[] }> {
    const byAccount = new Map<string, MessageRef[]>()

    for (const ref of refs) {
      const ofAccount = byAccount.get(ref.accountId) ?? []
      ofAccount.push(ref)
      byAccount.set(ref.accountId, ofAccount)
    }

    const groups = [...byAccount]
    const outcomes = await Promise.allSettled(
      groups.map(async ([accountId, ofAccount]) =>
        (await this.requestConnection(accountId)).archive(ofAccount)
      )
    )
    const failed: MessageRef[] = []
    const stayed: MessageRef[] = []
    const kept: MessageRef[] = []
    let error: string | undefined

    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        failed.push(...outcome.value.failed)
        stayed.push(...outcome.value.stayed)
        kept.push(...outcome.value.kept)
        error ??= outcome.value.error
        return
      }

      failed.push(...groups[index][1])
      error ??= outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
    })

    return { failed, error, stayed, kept }
  }

  /** See `AccountConnection.saveDraft`. */
  async saveDraft(
    accountId: string,
    raw: Buffer,
    messageId: string,
    replace: { folderPath: string; uid: number } | null
  ): Promise<{ folderPath: string; uid: number | null }> {
    const connection = await this.requestConnection(accountId)
    return connection.saveDraft(raw, messageId, replace)
  }

  /** Deletes messages, of any account, for good (see `AccountConnection.purgeMessages`). */
  async purgeMessages(refs: ReadonlyArray<MessageRef>): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.purgeMessages(folderPath, uids)
    )
  }

  /** Moves messages, of any account, to each one's Trash — read first, when asked. */
  async moveMessagesToTrash(
    refs: ReadonlyArray<MessageRef>,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<MessagesActionResult> {
    return this.onMessages(refs, (connection, folderPath, uids) =>
      connection.moveMessagesToTrash(folderPath, uids, options)
    )
  }

  async appendToSent(
    accountId: string,
    rawMessage: Buffer,
    messageId: string
  ): Promise<string | null> {
    const connection = await this.requestConnection(accountId)
    return connection.appendToSent(rawMessage, messageId)
  }

  /**
   * The raw sources of `refs`, of any account and folder, each handed to
   * `onMessage` as it arrives (see `AccountConnection.fetchRawSources`).
   * Resolves with the messages no longer on their server.
   */
  async fetchMessageRawSources(
    refs: ReadonlyArray<MessageRef>,
    onMessage: (ref: MessageRef, message: RawMessage) => Promise<void>
  ): Promise<{ missing: MessageRef[]; unread: Array<{ ref: MessageRef; message: string }> }> {
    const groups = new Map<string, MessageRef[]>()

    for (const ref of refs) {
      const key = `${ref.accountId}\u0000${ref.folderPath}`
      const group = groups.get(key) ?? []
      group.push(ref)
      groups.set(key, group)
    }

    const missing: MessageRef[] = []
    const unread: Array<{ ref: MessageRef; message: string }> = []

    // Each folder on its own: an account that fails does not hold the others' messages.
    for (const group of groups.values()) {
      const { accountId, folderPath } = group[0]
      const handed = new Set<number>()

      try {
        const connection = await this.requestConnection(accountId)
        const lost = await connection.fetchRawSources(
          folderPath,
          group.map((ref) => ref.uid),
          async (uid, message) => {
            handed.add(uid)
            await onMessage({ accountId, folderPath, uid }, message)
          }
        )

        missing.push(...lost.map((uid) => ({ accountId, folderPath, uid })))
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : 'Download dei messaggi non riuscito.'
        unread.push(...group.filter((ref) => !handed.has(ref.uid)).map((ref) => ({ ref, message })))
      }
    }

    return { missing, unread }
  }

  /** See `AccountConnection.markFolderRead`. */
  async markFolderRead(mailbox: { accountId: string; folderPath: string }): Promise<void> {
    const connection = await this.requestConnection(mailbox.accountId)
    await connection.markFolderRead(mailbox.folderPath)
  }

  /** See `AccountConnection.renameFolder`. */
  async renameFolder(accountId: string, folderPath: string, name: string): Promise<MailFolder> {
    const connection = await this.requestConnection(accountId)
    return connection.renameFolder(folderPath, name)
  }

  /** See `AccountConnection.createFolder`. */
  async createFolder(
    accountId: string,
    name: string,
    parentPath: string | null
  ): Promise<MailFolder> {
    const connection = await this.requestConnection(accountId)
    return connection.createFolder(name, parentPath)
  }

  /** See `AccountConnection.searchMessages`. */
  async searchMessages(
    mailbox: { accountId: string; folderPath: string },
    groups: ReadonlyArray<SearchObject>,
    asked?: { priority: TaskPriority }
  ): Promise<number[] | null> {
    const connection = await this.requestConnection(mailbox.accountId)
    return connection.searchMessages(mailbox.folderPath, groups, asked)
  }

  /** See `AccountConnection.hydratePreviews`; messages of any account and folder. */
  async hydratePreviews(refs: ReadonlyArray<MessageRef>): Promise<void> {
    const groups = new Map<string, MessageRef[]>()

    for (const ref of refs) {
      const key = `${ref.accountId}\u0000${ref.folderPath}`
      const group = groups.get(key) ?? []
      group.push(ref)
      groups.set(key, group)
    }

    for (const group of groups.values()) {
      const connection = await this.requestConnection(group[0].accountId)
      connection.hydratePreviews(
        group[0].folderPath,
        group.map((ref) => ref.uid)
      )
    }
  }

  async fetchAttachments(
    ref: MessageRef,
    attachments: ReadonlyArray<{ index: number; part?: string }>,
    messageSize: number
  ): Promise<FetchedAttachment[]> {
    const connection = await this.requestConnection(ref.accountId)
    return connection.fetchAttachments(ref, attachments, messageSize)
  }

  /**
   * The folders of "Tutti gli account", one per role, each counting its
   * folders across the accounts included. A role no included account has a
   * folder for is left out.
   */
  async computeUnifiedFolderSummaries(): Promise<UnifiedFolderSummary[]> {
    const foldersByAccount = await this.includedAccountFolders()
    const summaries: UnifiedFolderSummary[] = []

    for (const role of UNIFIED_FOLDER_ROLES) {
      const folders = foldersByAccount.flatMap((folders) => {
        const folder = folderForRole(folders, role)
        return folder ? [folder] : []
      })

      if (folders.length === 0) {
        continue
      }

      summaries.push({
        role,
        messageCount: folders.reduce((total, folder) => total + folder.messageCount, 0),
        unseenCount: folders.reduce((total, folder) => total + folder.unseenCount, 0),
        lastSyncedAt: folders.reduce<number | undefined>(
          (latest, folder) =>
            folder.lastSyncedAt !== undefined &&
            (latest === undefined || folder.lastSyncedAt > latest)
              ? folder.lastSyncedAt
              : latest,
          undefined
        )
      })
    }

    return summaries
  }

  /** The folders "Tutti gli account" gathers for a role: one per account included. */
  async resolveUnifiedMailboxes(
    role: FolderRole
  ): Promise<Array<{ accountId: string; folderPath: string }>> {
    return (await this.includedAccountFolders()).flatMap((folders) => {
      const folder = folderForRole(folders, role)
      return folder ? [{ accountId: folder.accountId, folderPath: folder.path }] : []
    })
  }

  /** Every folder of each account "Tutti gli account" includes, account by account. */
  private async includedAccountFolders(): Promise<MailFolder[][]> {
    const accounts = await this.deps.database.getAccounts()
    const includedIds = await this.resolveIncludedAccountIds(accounts.map((account) => account.id))
    return Promise.all(includedIds.map((accountId) => this.deps.database.listFolders(accountId)))
  }

  private async resolveIncludedAccountIds(allAccountIds: string[]): Promise<string[]> {
    const configured = await this.deps.database.getUnifiedInboxIncludedAccountIds()

    if (configured === null) {
      return allAccountIds
    }

    const set = new Set(allAccountIds)
    return configured.filter((id) => set.has(id))
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

    const connection = new AccountConnection(this.deps.database, this.deps.tokens, account)
    let indexed = 0

    connection.on('state', (snapshot) => {
      const state: AccountConnectionState = { accountId, ...snapshot }
      this.broadcast(IPC_CHANNELS.accountConnectionChanged, state)

      // More of the mail can be read now: a message's words are what the Segretario starts from.
      if (snapshot.index && snapshot.index.indexed > indexed) {
        indexed = snapshot.index.indexed
        this.deps.onMailChanged()
      }
    })

    connection.on('refused', (refusal, detail) => this.deps.onRefused(accountId, refusal, detail))

    connection.on('folders', (folders) => {
      this.broadcast(IPC_CHANNELS.foldersChanged, { accountId, folders })
      void this.emitUnifiedFolderSummaries()
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
      void this.emitUnifiedFolderSummaries()
    })

    connection.on('messages', async (event) => {
      this.broadcast(IPC_CHANNELS.messagesChanged, {
        accountId: event.accountId,
        folderPath: event.folderPath,
        added: event.added,
        updated: event.updated,
        removedUids: event.removedUids
      })

      if (event.removedUids.length > 0) {
        this.deps.onMailChanged()
      }

      // Read, moved or deleted — here or on another device — a message's alert goes.
      this.notifications.withdraw([
        ...event.updated.filter((message) => message.isRead),
        ...event.removedUids.map((uid) => ({ accountId, folderPath: event.folderPath, uid }))
      ])

      if (event.added.length > 0) {
        const folder = await this.deps.database.getFolder(event.accountId, event.folderPath)
        this.notifications.enqueue(
          { id: accountId, email: account.email },
          event.added,
          folder,
          event.bootstrap
        )
      }

      void this.emitUnifiedFolderSummaries()
    })

    this.connections.set(accountId, connection)
    connection.start()

    if (this.asleep) {
      connection.suspend()
    }

    if (this.activeContext && this.activeContext.accountId === accountId) {
      connection.setActiveContext({
        accountId,
        folderPath: this.activeContext.folderPath,
        uid: 0
      })
    }
  }

  /** The counts every account's folders changed: "Tutti gli account" and the icon's badge. */
  private async emitUnifiedFolderSummaries(): Promise<void> {
    try {
      const summaries = await this.computeUnifiedFolderSummaries()
      this.broadcast(IPC_CHANNELS.unifiedFoldersChanged, { summaries })
      this.deps.onInboxUnreadChange(await this.inboxUnreadCount())
    } catch (error) {
      log.error('Unified folder summaries broadcast failed', error)
    }
  }

  /** The unread messages of every account's Posta in arrivo, as Apple Mail's badge counts them. */
  async inboxUnreadCount(): Promise<number> {
    const accounts = await this.deps.database.getAccounts()
    const folders = await Promise.all(
      accounts.map((account) => this.deps.database.listFolders(account.id))
    )

    return folders.reduce(
      (total, accountFolders) =>
        total + (folderForRole(accountFolders, '\\Inbox')?.unseenCount ?? 0),
      0
    )
  }

  private broadcast(channel: string, payload: unknown): void {
    this.deps.getMainWindow()?.webContents.send(channel, payload)
  }
}
