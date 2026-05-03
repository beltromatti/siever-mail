import { EventEmitter } from 'node:events'

import { ImapFlow, type ExistsEvent, type ExpungeEvent, type FlagsEvent } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { ParsedMail } from 'mailparser'

import { logMainError } from '@main/utils/error-utils'
import type {
  AccountConnectionStatus,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MessageRef
} from '@shared/models'

import type { AppDatabase } from '../database'
import type { GoogleOAuthService } from '../google-oauth'

import {
  formatSubject,
  hasAttachmentInStructure,
  internalDateToIso,
  mapAddresses,
  mapFetchedToDetail
} from './message-mapper'
import { extractPreview, parseMessagePayload } from './preview'
import {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_MAX_IDLE_TIME_MS,
  IMAP_SOCKET_TIMEOUT_MS,
  resolveImapAuth,
  type AccountWithSecret
} from './mail-transport'

// Bootstrap batches: envelope-only (no body). 1000 UIDs fit comfortably in a
// single IMAP FETCH because each envelope is tiny — used only for the initial
// bulk sync where we want the list to populate as fast as possible and defer
// the preview to a follow-up hydration pass.
const BOOTSTRAP_ENVELOPE_BATCH_SIZE = 1000
// Incremental batches: envelope + first PREVIEW_SOURCE_MAX_BYTES of source,
// all in one FETCH. This is the path taken for every folder AFTER its initial
// bootstrap has completed — IDLE-pushed new messages, periodic catchups,
// post-reconnect deltas. One round-trip means the preview is ready the moment
// the row lands in the DB, so notifications fire with the real snippet and
// there is never a "Caricamento anteprima…" flicker on steady-state inbox
// traffic.
const INCREMENTAL_BATCH_SIZE = 250
// Hydration batches: catch-up pass that fills previews for any row whose
// previewHydrated is still false (only happens when a bootstrap was interrupted
// mid-way and the app restarted). Matches INCREMENTAL_BATCH_SIZE because the
// IMAP cost per message is the same shape.
const HYDRATION_BATCH_SIZE = 250
// 32 KB leaves a 2-3× margin over the <head><style> block of the heaviest
// marketing senders (Breasy, Wizz Air and similar run 10-20 KB of @media
// queries before <body>), so the preview extractor always has real prose to
// work with. Runs on the sync client only — never on the critical user path.
const PREVIEW_SOURCE_MAX_BYTES = 32 * 1024
const INBOX_SPECIAL_USE = '\\Inbox'
const BACKGROUND_FOLDER_POLL_INTERVAL_MS = 45_000
const ACTIVE_FOLDER_POLL_INTERVAL_MS = 20_000
const RECONNECT_BACKOFF_INITIAL_MS = 2_000
const RECONNECT_BACKOFF_MAX_MS = 60_000

// Task scheduling priorities. The sync worker always drains higher priorities
// first, so a freshly-opened folder (active-sync) jumps ahead of the historical
// bootstrap (background). The primary queue uses 'user' exclusively.
type TaskPriority = 'user' | 'active-sync' | 'background'
const PRIORITY_ORDER: TaskPriority[] = ['user', 'active-sync', 'background']

interface QueuedTask {
  priority: TaskPriority
  label: string
  run: () => Promise<void>
}

interface FolderSyncPlan {
  uidValidity: bigint
  highestModseq: bigint | undefined
  exists: number
  previousLastKnownUid: number
  isBootstrap: boolean
  newUids: number[]
  needsReconciliation: boolean
}

type AccountConnectionEvents = {
  status: (status: AccountConnectionStatus, error?: Error) => void
  folders: (folders: MailFolder[]) => void
  'folder-counts': (update: {
    accountId: string
    folderPath: string
    messageCount: number
    unseenCount: number
    lastSyncedAt?: number
  }) => void
  messages: (event: {
    accountId: string
    folderPath: string
    added: MailMessageSummary[]
    updated: MailMessageSummary[]
    removedUids: number[]
    bootstrap: boolean
  }) => void
}

export class AccountConnection extends EventEmitter {
  // Two dedicated IMAP connections per account, matching Gmail/Outlook desktop
  // clients:
  //   - primaryClient: IDLE on the user's active folder + all user-initiated
  //     operations (click to open a message, toggle flag, move, delete, send,
  //     download attachment). Never runs bulk sync, so it stays responsive
  //     under load.
  //   - syncClient: bootstrap, folder polling, per-folder incremental sync,
  //     envelope fetches, and preview-hydration batches. Can be busy for
  //     minutes on the initial bootstrap of a large account without ever
  //     blocking user interactions.
  private primaryClient: ImapFlow | null = null
  private syncClient: ImapFlow | null = null
  private running = false
  private shuttingDown = false
  private restartTimer: NodeJS.Timeout | null = null
  private backoffMs = RECONNECT_BACKOFF_INITIAL_MS
  private folderPollInterval: NodeJS.Timeout | null = null
  private connectionLoopPromise: Promise<void> | null = null
  private lastActiveContext: MessageRef | null = null
  // Two queues, two workers. Tasks submitted to primaryQueue run on
  // primaryClient; tasks submitted to syncQueue run on syncClient. The queues
  // don't compete — each runs at full speed on its own TCP connection.
  private readonly primaryQueue: QueuedTask[] = []
  private readonly syncQueue: QueuedTask[] = []
  private primaryWorkerActive = false
  private syncWorkerActive = false
  private status: AccountConnectionStatus = 'disconnected'

  constructor(
    private readonly database: AppDatabase,
    private readonly googleOAuthService: GoogleOAuthService,
    private account: AccountWithSecret
  ) {
    super()
  }

  override on<E extends keyof AccountConnectionEvents>(
    event: E,
    listener: AccountConnectionEvents[E]
  ): this {
    return super.on(event, listener)
  }

  override emit<E extends keyof AccountConnectionEvents>(
    event: E,
    ...args: Parameters<AccountConnectionEvents[E]>
  ): boolean {
    return super.emit(event, ...args)
  }

  updateAccount(account: AccountWithSecret): void {
    this.account = account
  }

  getStatus(): AccountConnectionStatus {
    return this.status
  }

  start(): void {
    if (this.running) {
      return
    }

    this.running = true
    this.shuttingDown = false
    this.connectionLoopPromise = this.runConnectionLoop().catch((error) => {
      logMainError('Account connection loop crashed unexpectedly', error, {
        accountId: this.account.id
      })
    })

    this.folderPollInterval = setInterval(() => {
      this.enqueueSyncCommand(
        async () => {
          if (this.syncClient?.usable) {
            await this.pollFolderStatuses()
          }
        },
        'folder-poll',
        'background'
      )
    }, BACKGROUND_FOLDER_POLL_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    this.running = false

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (this.folderPollInterval) {
      clearInterval(this.folderPollInterval)
      this.folderPollInterval = null
    }

    const primary = this.primaryClient
    const sync = this.syncClient
    this.primaryClient = null
    this.syncClient = null

    await Promise.allSettled(
      [primary, sync]
        .filter((client): client is ImapFlow => client !== null)
        .map(async (client) => {
          try {
            await client.logout()
          } catch {
            try {
              client.close()
            } catch {
              // ignore
            }
          }
        })
    )

    try {
      await this.connectionLoopPromise
    } catch {
      // ignore
    }

    this.setStatus('disconnected')
  }

  setActiveContext(context: MessageRef | null): void {
    const previousPath =
      this.lastActiveContext?.accountId === this.account.id
        ? this.lastActiveContext.folderPath
        : null
    this.lastActiveContext = context

    const nextPath = context?.accountId === this.account.id ? context.folderPath : null

    if (nextPath && nextPath !== previousPath) {
      // Switch primary IDLE to the folder the user is now viewing so we catch
      // new-message events on it in real time.
      if (this.primaryClient?.usable) {
        this.enqueuePrimaryCommand(async () => {
          await this.selectIdleMailbox()
        }, `idle-switch:${nextPath}`)
      }
      // Fast-forward sync of that folder at 'active-sync' priority so its
      // contents show up as quickly as possible — this jumps the sync queue
      // ahead of background bootstrap work on other folders.
      this.incrementalSyncFolder(nextPath, 'active-sync')
    }
  }

  async refreshFolders(): Promise<MailFolder[]> {
    let result: MailFolder[] = []
    await this.enqueueSyncCommandAwaitable(
      async () => {
        result = await this.syncFolderList()
      },
      'refresh-folders',
      'user'
    )
    return result
  }

  async forceSyncFolder(folderPath: string): Promise<void> {
    await this.enqueueSyncCommandAwaitable(
      async () => {
        this.incrementalSyncFolder(folderPath, 'user')
      },
      `force-sync:${folderPath}`,
      'user'
    )
  }

  async fetchMessageDetail(ref: MessageRef): Promise<MailMessageDetail> {
    return this.enqueuePrimaryWithReturn<MailMessageDetail>(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        const fetched = await client.fetchOne(
          String(ref.uid),
          {
            uid: true,
            threadId: true,
            envelope: true,
            flags: true,
            internalDate: true,
            size: true,
            bodyStructure: true,
            source: true
          },
          { uid: true }
        )

        if (!fetched) {
          throw new Error('Messaggio non disponibile sul server.')
        }

        return mapFetchedToDetail(this.account.id, ref.folderPath, fetched)
      } finally {
        lock.release()
      }
    }, `fetch-detail:${ref.folderPath}:${ref.uid}`)
  }

  async fetchRawSource(ref: MessageRef): Promise<Buffer> {
    return this.enqueuePrimaryWithReturn<Buffer>(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        const fetched = await client.fetchOne(
          String(ref.uid),
          { uid: true, source: true },
          { uid: true }
        )

        if (!fetched || !fetched.source) {
          throw new Error('Messaggio non disponibile sul server.')
        }

        return fetched.source
      } finally {
        lock.release()
      }
    }, `fetch-source:${ref.folderPath}:${ref.uid}`)
  }

  async toggleSeen(ref: MessageRef, seen: boolean): Promise<void> {
    await this.enqueuePrimaryCommandAwaitable(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        if (seen) {
          await client.messageFlagsAdd(String(ref.uid), ['\\Seen'], { uid: true })
        } else {
          await client.messageFlagsRemove(String(ref.uid), ['\\Seen'], { uid: true })
        }
      } finally {
        lock.release()
      }

      await this.database.updateMessageFlags(
        this.account.id,
        ref.folderPath,
        ref.uid,
        seen ? ['\\Seen'] : []
      )
    }, `toggle-seen:${ref.folderPath}:${ref.uid}`)
  }

  async moveMessage(
    ref: MessageRef,
    destinationFolderPath: string,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<void> {
    await this.enqueuePrimaryCommandAwaitable(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        if (options.markAsSeenBeforeMove) {
          await client.messageFlagsAdd(String(ref.uid), ['\\Seen'], { uid: true })
        }

        await client.messageMove(String(ref.uid), destinationFolderPath, { uid: true })
      } finally {
        lock.release()
      }

      await this.database.deleteMessage(ref)
      this.incrementalSyncFolder(ref.folderPath, 'background')
      this.incrementalSyncFolder(destinationFolderPath, 'background')
    }, `move:${ref.folderPath}:${ref.uid}`)
  }

  async moveMessageToTrash(
    ref: MessageRef,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const trash = await this.findFolderBySpecialUse(['\\Trash'], ['trash', 'cestino'])

    if (!trash || trash.path === ref.folderPath) {
      if (options.markAsSeenBeforeMove) {
        await this.toggleSeen(ref, true)
      }

      return { sourceFolder: ref.folderPath, destinationFolder: trash?.path }
    }

    await this.moveMessage(ref, trash.path, options)
    return { sourceFolder: ref.folderPath, destinationFolder: trash.path }
  }

  async deleteMessage(
    ref: MessageRef
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const trash = await this.findFolderBySpecialUse(['\\Trash'], ['trash', 'cestino'])

    if (trash) {
      await this.moveMessage(ref, trash.path)
      return { sourceFolder: ref.folderPath, destinationFolder: trash.path }
    }

    await this.enqueuePrimaryCommandAwaitable(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        await client.messageDelete(String(ref.uid), { uid: true })
      } finally {
        lock.release()
      }

      await this.database.deleteMessage(ref)
      this.incrementalSyncFolder(ref.folderPath, 'background')
    }, `delete:${ref.folderPath}:${ref.uid}`)

    return { sourceFolder: ref.folderPath }
  }

  async archiveMessage(
    ref: MessageRef
  ): Promise<{ sourceFolder: string; destinationFolder: string }> {
    const archiveFolder = await this.findFolderBySpecialUse(['\\Archive'], ['archive', 'archivio'])

    if (!archiveFolder) {
      throw new Error("Cartella Archivio non disponibile per l'account.")
    }

    await this.moveMessage(ref, archiveFolder.path)
    return { sourceFolder: ref.folderPath, destinationFolder: archiveFolder.path }
  }

  async appendToSent(rawMessage: Buffer, messageId: string): Promise<string | null> {
    const sentFolder = await this.findFolderBySpecialUse(
      ['\\Sent'],
      ['sent', 'inviate', 'inviata', 'gesendet', 'envoyes', 'enviados']
    )

    if (!sentFolder) {
      return null
    }

    await this.enqueuePrimaryCommandAwaitable(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(sentFolder.path)

      try {
        if (messageId) {
          const existingUids = await client.search(
            { header: { 'Message-ID': messageId } },
            { uid: true }
          )

          if (Array.isArray(existingUids) && existingUids.length > 0) {
            return
          }
        }

        await client.append(sentFolder.path, rawMessage, ['\\Seen'], new Date())
      } finally {
        lock.release()
      }

      this.incrementalSyncFolder(sentFolder.path, 'background')
    }, `append-sent:${sentFolder.path}`)

    return sentFolder.path
  }

  async fetchMessageRawSource(ref: MessageRef): Promise<{
    source: Buffer
    parsed: ParsedMail
    internalDate: string
  }> {
    return this.enqueuePrimaryWithReturn(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        const fetched = await client.fetchOne(
          String(ref.uid),
          { uid: true, envelope: true, internalDate: true, source: true },
          { uid: true }
        )

        if (!fetched || !fetched.source) {
          throw new Error('Messaggio non disponibile sul server.')
        }

        const parsed = await simpleParser(fetched.source)
        return {
          source: fetched.source,
          parsed,
          internalDate: internalDateToIso(fetched.internalDate)
        }
      } finally {
        lock.release()
      }
    }, `fetch-archive:${ref.folderPath}:${ref.uid}`)
  }

  async fetchAttachmentForDownload(
    ref: MessageRef,
    attachmentIndex: number
  ): Promise<{ fileName: string; contentType: string; content: Buffer }> {
    return this.enqueuePrimaryWithReturn(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        const fetched = await client.fetchOne(
          String(ref.uid),
          { uid: true, source: true },
          { uid: true }
        )

        if (!fetched || !fetched.source) {
          throw new Error('Messaggio non disponibile sul server.')
        }

        const parsed = await simpleParser(fetched.source)
        const attachment = parsed.attachments[attachmentIndex]

        if (!attachment) {
          throw new Error('Allegato non disponibile per questo messaggio.')
        }

        return {
          fileName: attachment.filename || `allegato-${attachmentIndex + 1}`,
          contentType: attachment.contentType || 'application/octet-stream',
          content: Buffer.from(attachment.content)
        }
      } finally {
        lock.release()
      }
    }, `download-attachment:${ref.folderPath}:${ref.uid}:${attachmentIndex}`)
  }

  private setStatus(status: AccountConnectionStatus, error?: Error): void {
    if (this.status === status) {
      return
    }
    this.status = status
    this.emit('status', status, error)
  }

  private async runConnectionLoop(): Promise<void> {
    while (this.running) {
      let primary: ImapFlow | null = null
      let sync: ImapFlow | null = null

      try {
        this.setStatus(this.status === 'disconnected' ? 'connecting' : 'reconnecting')

        // Auth is resolved once and reused for both clients — for OAuth this
        // means we don't burn two token refreshes on every reconnect.
        const auth = await resolveImapAuth(this.account, this.googleOAuthService)

        primary = this.buildClient(auth)
        sync = this.buildClient(auth)
        this.primaryClient = primary
        this.syncClient = sync

        primary.on('exists', (event: ExistsEvent) => {
          // IDLE lives on the primary connection; forward the event to the
          // sync client's queue so the bulk sync fetches the new envelope
          // (and hydrates its preview) without pausing IDLE.
          this.incrementalSyncFolder(event.path, 'active-sync')
        })
        primary.on('expunge', (event: ExpungeEvent) => {
          this.enqueueSyncCommand(
            async () => {
              await this.handleExpungeEvent(event)
            },
            `expunge:${event.path}`,
            'active-sync'
          )
        })
        primary.on('flags', (event: FlagsEvent) => {
          this.enqueueSyncCommand(
            async () => {
              await this.handleFlagsEvent(event)
            },
            `flags:${event.path}:${event.uid ?? event.seq}`,
            'active-sync'
          )
        })

        const closedPromise = Promise.race([
          this.createCloseWatcher(primary, 'primary'),
          this.createCloseWatcher(sync, 'sync')
        ])

        await Promise.all([primary.connect(), sync.connect()])

        this.setStatus('connected')
        this.backoffMs = RECONNECT_BACKOFF_INITIAL_MS
        this.startPrimaryWorkerIfNeeded()
        this.startSyncWorkerIfNeeded()

        this.enqueueSyncCommand(
          async () => {
            await this.bootstrapAfterConnect()
          },
          'bootstrap',
          'background'
        )

        const { closedBy, error: closeError } = await closedPromise
        void closedBy
        this.primaryClient = null
        this.syncClient = null
        await this.safeShutdownClients(primary, sync)
        primary = null
        sync = null

        if (this.shuttingDown) {
          return
        }

        if (closeError) {
          logMainError('IMAP connection closed with error', closeError, {
            accountId: this.account.id
          })
        }
      } catch (error) {
        this.primaryClient = null
        this.syncClient = null
        await this.safeShutdownClients(primary, sync)
        primary = null
        sync = null
        logMainError('IMAP connection error', error, {
          accountId: this.account.id
        })
        this.setStatus('error', error instanceof Error ? error : new Error(String(error)))
      }

      if (!this.running) {
        break
      }

      await this.sleepWithBackoff()
    }

    this.setStatus('disconnected')
  }

  private buildClient(auth: Awaited<ReturnType<typeof resolveImapAuth>>): ImapFlow {
    return new ImapFlow({
      host: this.account.imapHost,
      port: this.account.imapPort,
      secure: this.account.imapSecure,
      auth,
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
      disableAutoIdle: false,
      maxIdleTime: IMAP_MAX_IDLE_TIME_MS,
      qresync: true,
      missingIdleCommand: 'STATUS',
      logger: false
    })
  }

  private createCloseWatcher(
    client: ImapFlow,
    label: 'primary' | 'sync'
  ): Promise<{ closedBy: 'primary' | 'sync'; error: Error | null }> {
    return new Promise((resolve) => {
      const onClose = (): void => {
        client.removeListener('error', onError)
        resolve({ closedBy: label, error: null })
      }
      const onError = (error: Error): void => {
        client.removeListener('close', onClose)
        resolve({ closedBy: label, error })
      }
      client.once('close', onClose)
      client.once('error', onError)
    })
  }

  private async safeShutdownClients(...clients: Array<ImapFlow | null>): Promise<void> {
    await Promise.allSettled(
      clients
        .filter((client): client is ImapFlow => client !== null)
        .map(async (client) => {
          try {
            await client.logout()
          } catch {
            try {
              client.close()
            } catch {
              // ignore
            }
          }
        })
    )
  }

  private async sleepWithBackoff(): Promise<void> {
    const delay = this.backoffMs
    this.backoffMs = Math.min(
      RECONNECT_BACKOFF_MAX_MS,
      Math.max(RECONNECT_BACKOFF_INITIAL_MS, this.backoffMs * 2)
    )

    await new Promise<void>((resolve) => {
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        resolve()
      }, delay)
    })
  }

  private requirePrimary(): ImapFlow {
    if (!this.primaryClient?.usable) {
      throw new Error('Connessione IMAP non disponibile.')
    }
    return this.primaryClient
  }

  private requireSync(): ImapFlow {
    if (!this.syncClient?.usable) {
      throw new Error('Connessione IMAP di sync non disponibile.')
    }
    return this.syncClient
  }

  private async bootstrapAfterConnect(): Promise<void> {
    const folders = await this.syncFolderList()

    // Order folders so INBOX is scheduled first, then the rest in their natural order.
    // All folder syncs enter the command queue at 'background' priority: INBOX therefore
    // fills first by queue order, while user clicks, IDLE deltas and active-folder
    // selections interleave at higher priorities as they arrive.
    const selectable = folders.filter((folder) => !this.isFolderNonSelectable(folder))
    const ordered = selectable.slice().sort((a, b) => {
      const aIsInbox = a.specialUse === INBOX_SPECIAL_USE ? 0 : 1
      const bIsInbox = b.specialUse === INBOX_SPECIAL_USE ? 0 : 1
      return aIsInbox - bIsInbox
    })

    for (const folder of ordered) {
      this.enqueueSyncCommand(
        async () => {
          await this.runFolderSync(folder.path, 'background')
        },
        `bootstrap-sync:${folder.path}`,
        'background'
      )
    }

    // Put IDLE on the user's active folder (or INBOX) on the PRIMARY client as
    // soon as it comes up — this is how we catch new-message events in real
    // time while the sync client grinds through the historical bootstrap.
    this.enqueuePrimaryCommand(async () => {
      await this.selectIdleMailbox()
    }, 'idle-select')
  }

  private async selectIdleMailbox(): Promise<void> {
    // IDLE runs on primaryClient only — this selects the preferred mailbox so
    // imapflow enters IDLE on it and relays exists/expunge/flags events.
    if (!this.primaryClient?.usable) {
      return
    }

    const folders = await this.database.listFolders(this.account.id)
    const activePath =
      this.lastActiveContext?.accountId === this.account.id
        ? this.lastActiveContext.folderPath
        : null

    const preferred =
      (activePath && folders.find((folder) => folder.path === activePath)) ||
      folders.find((folder) => folder.specialUse === INBOX_SPECIAL_USE) ||
      folders[0] ||
      null

    if (!preferred || this.isFolderNonSelectable(preferred)) {
      return
    }

    const lock = await this.primaryClient.getMailboxLock(preferred.path)
    try {
      // Lock released immediately; imapflow starts IDLE on the now-selected mailbox.
    } finally {
      lock.release()
    }
  }

  private isFolderNonSelectable(folder: MailFolder): boolean {
    // Heuristic: mailboxes whose path ends with '/[Gmail]' are container-only; imapflow surfaces them
    // but SELECT would fail. Keep conservative and allow engine to catch and skip.
    return folder.path === '[Gmail]' || folder.path === '[Google Mail]'
  }

  private async syncFolderList(): Promise<MailFolder[]> {
    const client = this.requireSync()

    const mailboxes = await client.list({
      statusQuery: {
        messages: true,
        unseen: true,
        uidValidity: true,
        highestModseq: true,
        uidNext: true
      }
    })

    const folders: MailFolder[] = mailboxes.map((mailbox) => ({
      id: `${this.account.id}:${mailbox.path}`,
      accountId: this.account.id,
      path: mailbox.path,
      name: mailbox.name,
      delimiter: mailbox.delimiter,
      specialUse: mailbox.specialUse,
      messageCount: mailbox.status?.messages ?? 0,
      unseenCount: mailbox.status?.unseen ?? 0
    }))

    await this.database.replaceFolders(this.account.id, folders)
    this.emit('folders', folders)

    for (const mailbox of mailboxes) {
      if (typeof mailbox.status?.uidValidity !== 'undefined') {
        await this.checkAndResetIfUidValidityChanged(
          mailbox.path,
          mailbox.status.uidValidity as bigint
        )
      }
    }

    return folders
  }

  private async checkAndResetIfUidValidityChanged(
    folderPath: string,
    serverUidValidity: bigint
  ): Promise<void> {
    const state = await this.database.getFolderSyncState(this.account.id, folderPath)

    if (!state || typeof state.uidValidity === 'undefined') {
      await this.database.updateFolderSyncState(this.account.id, folderPath, {
        uidValidity: serverUidValidity
      })
      return
    }

    if (state.uidValidity !== serverUidValidity) {
      await this.database.resetFolderSyncState(this.account.id, folderPath)
      await this.database.updateFolderSyncState(this.account.id, folderPath, {
        uidValidity: serverUidValidity
      })
    }
  }

  private incrementalSyncFolder(folderPath: string, priority: TaskPriority): void {
    // Public entry: schedules the folder-sync orchestrator on the sync queue so
    // it runs on syncClient and plays nicely with priority scheduling. Caller
    // does NOT await individual batches — state + counts + preview updates
    // are emitted progressively as the envelope / finalize / hydration phases
    // land.
    this.enqueueSyncCommand(
      async () => {
        await this.runFolderSync(folderPath, priority)
      },
      `sync:${folderPath}`,
      priority
    )
  }

  private async runFolderSync(folderPath: string, priority: TaskPriority): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    const plan = await this.prepareFolderSyncPlan(folderPath)
    if (!plan) {
      return
    }

    if (plan.exists === 0) {
      // Empty mailbox: drop any stale cache and publish zeroed counts in one shot.
      await this.applyEmptyFolderState(folderPath, plan)
      return
    }

    // PHASE 1 — fetch the new UIDs for this folder.
    //
    // Two modes, picked by plan.isBootstrap (which is true iff the folder has
    // never been sync'd before on this install OR a previous bootstrap was
    // interrupted before the finalize task could run):
    //
    //   * BOOTSTRAP mode — envelope-only batches (no body). The UI populates
    //     almost instantly with subject+sender+date and a "Caricamento
    //     anteprima…" placeholder in place of the preview. A separate
    //     HydSched task enqueued below later fills each row's preview in the
    //     background. This is the only way to keep first-sync fast when there
    //     are thousands of messages — fetching 8 MB of bodies per batch would
    //     block the list for minutes.
    //
    //   * INCREMENTAL mode — envelope + first PREVIEW_SOURCE_MAX_BYTES of
    //     source in the SAME FETCH. Every row lands with preview ready. This
    //     is the path for IDLE-pushed new messages and post-reconnect
    //     catchups: notifications fire immediately with the real snippet,
    //     and there is no second round-trip to patch the row later.
    //
    // Smaller batch sizes for incremental because each message carries ~32 KB
    // of body — a 250-batch is ~8 MB on the wire and lands in a second or two.
    if (plan.newUids.length > 0) {
      const sortedUids = [...plan.newUids].sort((a, b) => b - a)
      const batchSize = plan.isBootstrap ? BOOTSTRAP_ENVELOPE_BATCH_SIZE : INCREMENTAL_BATCH_SIZE
      for (let index = 0; index < sortedUids.length; index += batchSize) {
        const batch = sortedUids.slice(index, index + batchSize)
        const batchNumber = Math.floor(index / batchSize) + 1
        const label = plan.isBootstrap
          ? `envelope-batch:${folderPath}:${batchNumber}`
          : `incremental-batch:${folderPath}:${batchNumber}`
        this.enqueueSyncCommand(
          async () => {
            await this.processSyncBatch(folderPath, batch, plan.isBootstrap)
          },
          label,
          priority
        )
      }
    }

    // Finalize: reconciliation + folder state + counts. Runs after all
    // envelope batches at the same priority thanks to FIFO-within-priority.
    this.enqueueSyncCommand(
      async () => {
        await this.finalizeFolderSync(folderPath, plan)
      },
      `sync-finalize:${folderPath}`,
      priority
    )

    // PHASE 2 — preview hydration. After envelopes are persisted, we fetch a
    // small body prefix for any message that doesn't yet have a hydrated
    // preview and patch the row.
    //
    // Hydration is ALWAYS scheduled at 'background': the list is already
    // usable with just the envelope (subject, sender, date), and letting a
    // 6k-message INBOX hydration steal the 'active-sync' slot from a newly
    // clicked folder's envelope phase is the real-world stall the user
    // reported. 'active-sync' must be reserved for what unblocks the UI
    // (envelope + finalize), not for background cosmetics (preview text).
    //
    // De-dup: runFolderSync runs twice when setActiveContext fires the same
    // folder as bootstrap (startup auto-selects INBOX -> an active-sync Orch;
    // bootstrap also enqueues a bg Orch). Without this guard each orchestrator
    // would enqueue another hydrate-schedule, and each would re-fetch the
    // still-unhydrated UIDs on top of the already-scheduled batches — doubling
    // the hydration work.
    const hydrateScheduleLabel = `hydrate-schedule:${folderPath}`
    const alreadyScheduled = this.syncQueue.some((task) => task.label === hydrateScheduleLabel)
    if (!alreadyScheduled) {
      this.enqueueSyncCommand(
        async () => {
          await this.scheduleHydrationForFolder(folderPath)
        },
        hydrateScheduleLabel,
        'background'
      )
    }
  }

  private async prepareFolderSyncPlan(folderPath: string): Promise<FolderSyncPlan | null> {
    if (!this.syncClient?.usable) {
      return null
    }

    const client = this.syncClient
    const lock = await client.getMailboxLock(folderPath)

    try {
      const mailbox = client.mailbox
      if (!mailbox || typeof mailbox === 'boolean' || mailbox.path !== folderPath) {
        return null
      }

      const serverUidValidity = mailbox.uidValidity as bigint
      const serverHighestModseq = mailbox.highestModseq
      const exists = mailbox.exists

      const state = await this.database.getFolderSyncState(this.account.id, folderPath)
      if (state?.uidValidity && state.uidValidity !== serverUidValidity) {
        await this.database.resetFolderSyncState(this.account.id, folderPath)
      }

      const freshState = await this.database.getFolderSyncState(this.account.id, folderPath)
      const previousHighestModseq = freshState?.highestModseq
      const previousLastKnownUid = freshState?.lastKnownUid ?? 0
      const isBootstrap = previousLastKnownUid === 0

      if (exists === 0) {
        return {
          uidValidity: serverUidValidity,
          highestModseq: serverHighestModseq,
          exists: 0,
          previousLastKnownUid,
          isBootstrap,
          newUids: [],
          needsReconciliation: false
        }
      }

      // CONDSTORE/QRESYNC: catch up on flag changes for the mailbox window while we
      // still hold the lock — it's cheap (one FETCH CHANGEDSINCE) and avoids a second
      // round-trip later.
      if (
        previousHighestModseq &&
        serverHighestModseq &&
        previousHighestModseq !== serverHighestModseq
      ) {
        await this.fetchChangesSinceModseq(folderPath, previousHighestModseq)
      }

      const localUids = await this.database.listAllMessageUids(this.account.id, folderPath)
      const localSet = new Set(localUids)

      // On bootstrap we ask the server for the full UID set (1:*) — we might
      // be resuming an interrupted bootstrap, in which case the DB already has
      // some of the folder's messages and we only want to fetch what's
      // missing. On incremental sync we use a narrow range above
      // previousLastKnownUid so we don't pull the whole mailbox on every
      // poll.
      //
      // The localSet filter makes bootstrap idempotent: killing the app
      // mid-sync and reopening does not redownload the rows that were already
      // persisted — it picks up exactly where it left off.
      let newUids: number[]
      if (isBootstrap) {
        const allServerUids = await client.search({ uid: '1:*' }, { uid: true })
        newUids = Array.isArray(allServerUids)
          ? allServerUids.filter((uid) => !localSet.has(uid))
          : []
      } else {
        const searchRange = `${previousLastKnownUid + 1}:*`
        const serverUidsForWindow = await client.search({ uid: searchRange }, { uid: true })
        newUids = Array.isArray(serverUidsForWindow)
          ? serverUidsForWindow.filter((uid) => uid > previousLastKnownUid && !localSet.has(uid))
          : []
      }

      // Detect VANISHED/expunge drift cheaply: if local count + truly new UIDs
      // still doesn't match server EXISTS, the finalize pass will do a full
      // reconciliation.
      const needsReconciliation = localUids.length + newUids.length !== exists

      return {
        uidValidity: serverUidValidity,
        highestModseq: serverHighestModseq,
        exists,
        previousLastKnownUid,
        isBootstrap,
        newUids,
        needsReconciliation
      }
    } finally {
      lock.release()
    }
  }

  private async processSyncBatch(
    folderPath: string,
    batch: number[],
    bootstrap: boolean
  ): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    const client = this.syncClient
    const lock = await client.getMailboxLock(folderPath)

    try {
      // Bootstrap batches are envelope-only (hydration later). Incremental
      // batches fetch envelope AND the preview body prefix in the same FETCH,
      // so the row lands with a real, hydrated preview and notifications can
      // fire with the snippet immediately.
      const summaries = bootstrap
        ? await this.fetchSummariesForUids(folderPath, batch, { includeBody: false })
        : await this.fetchSummariesForUids(folderPath, batch, { includeBody: true })
      if (summaries.length === 0) {
        return
      }

      const result = await this.database.upsertMessageSummaries(
        this.account.id,
        folderPath,
        summaries
      )

      if (result.added.length > 0 || result.updated.length > 0) {
        this.emit('messages', {
          accountId: this.account.id,
          folderPath,
          added: result.added,
          updated: result.updated,
          removedUids: [],
          bootstrap
        })
      }
    } finally {
      lock.release()
    }
  }

  private async scheduleHydrationForFolder(folderPath: string): Promise<void> {
    const unhydratedUids = await this.database.listUnhydratedMessageUids(
      this.account.id,
      folderPath
    )
    if (unhydratedUids.length === 0) {
      return
    }

    // Always 'background': hydration is cosmetic preview fill-in, it must never
    // outrank any folder's envelope/finalize phase — which is what actually
    // unblocks the UI. See the commentary on the caller in runFolderSync.
    for (let index = 0; index < unhydratedUids.length; index += HYDRATION_BATCH_SIZE) {
      const batch = unhydratedUids.slice(index, index + HYDRATION_BATCH_SIZE)
      const batchNumber = Math.floor(index / HYDRATION_BATCH_SIZE) + 1
      this.enqueueSyncCommand(
        async () => {
          await this.processHydrationBatch(folderPath, batch)
        },
        `hydrate-batch:${folderPath}:${batchNumber}`,
        'background'
      )
    }
  }

  private async processHydrationBatch(folderPath: string, batch: number[]): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    const client = this.syncClient
    const lock = await client.getMailboxLock(folderPath)

    try {
      const updates = await this.fetchPreviewsForUids(folderPath, batch)
      if (updates.length === 0) {
        return
      }

      const updated = await this.database.updateMessagePreviews(
        this.account.id,
        folderPath,
        updates
      )

      if (updated.length > 0) {
        // bootstrap=false because hydration is never the first time the user
        // sees the row — the envelope phase already emitted it. This prevents
        // notifications for messages whose preview is only just arriving.
        this.emit('messages', {
          accountId: this.account.id,
          folderPath,
          added: [],
          updated,
          removedUids: [],
          bootstrap: false
        })
      }
    } finally {
      lock.release()
    }
  }

  private async finalizeFolderSync(folderPath: string, plan: FolderSyncPlan): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    const client = this.syncClient
    const lock = await client.getMailboxLock(folderPath)

    try {
      if (plan.needsReconciliation) {
        await this.reconcileLocalAgainstServer(folderPath)
      }

      // Compute maxKnownUid from what's actually in the DB now — this covers
      // the resumed-bootstrap case where the DB already had the highest UID
      // from a previous session, so plan.newUids (the MISSING set) would
      // understate the true max. Reading localUids post-batch guarantees the
      // mark advances past everything we've persisted.
      const currentLocalUids = await this.database.listAllMessageUids(this.account.id, folderPath)
      const maxKnownUid =
        currentLocalUids.length > 0
          ? Math.max(plan.previousLastKnownUid, ...currentLocalUids)
          : plan.previousLastKnownUid
      const syncedAt = Date.now()

      await this.database.updateFolderSyncState(this.account.id, folderPath, {
        uidValidity: plan.uidValidity,
        highestModseq: plan.highestModseq,
        lastKnownUid: maxKnownUid,
        lastSyncedAt: syncedAt
      })

      const unseenCountSearch = await client.search({ seen: false }, { uid: true })
      const unseenCount = Array.isArray(unseenCountSearch) ? unseenCountSearch.length : 0

      await this.database.updateFolderCounts(this.account.id, folderPath, plan.exists, unseenCount)

      this.emit('folder-counts', {
        accountId: this.account.id,
        folderPath,
        messageCount: plan.exists,
        unseenCount,
        lastSyncedAt: syncedAt
      })
    } finally {
      lock.release()
    }
  }

  private async applyEmptyFolderState(folderPath: string, plan: FolderSyncPlan): Promise<void> {
    const staleUids = await this.database.listAllMessageUids(this.account.id, folderPath)
    if (staleUids.length > 0) {
      await this.database.deleteMessageUids(this.account.id, folderPath, staleUids)
      this.emit('messages', {
        accountId: this.account.id,
        folderPath,
        added: [],
        updated: [],
        removedUids: staleUids,
        bootstrap: false
      })
    }

    const syncedAt = Date.now()
    await this.database.updateFolderSyncState(this.account.id, folderPath, {
      uidValidity: plan.uidValidity,
      highestModseq: plan.highestModseq,
      lastKnownUid: 0,
      lastSyncedAt: syncedAt
    })
    await this.database.updateFolderCounts(this.account.id, folderPath, 0, 0)
    this.emit('folder-counts', {
      accountId: this.account.id,
      folderPath,
      messageCount: 0,
      unseenCount: 0,
      lastSyncedAt: syncedAt
    })
  }

  private async fetchChangesSinceModseq(folderPath: string, sinceModseq: bigint): Promise<void> {
    const client = this.requireSync()
    const updates: MailMessageSummary[] = []

    for await (const message of client.fetch(
      { all: true },
      {
        uid: true,
        flags: true,
        threadId: true,
        envelope: true,
        internalDate: true,
        size: true,
        bodyStructure: true
      },
      { uid: true, changedSince: sinceModseq }
    )) {
      const flags = [...(message.flags ?? new Set<string>())]
      const updatedSummary = await this.database.updateMessageFlags(
        this.account.id,
        folderPath,
        message.uid,
        flags
      )

      if (updatedSummary) {
        updates.push(updatedSummary)
      }
    }

    if (updates.length > 0) {
      this.emit('messages', {
        accountId: this.account.id,
        folderPath,
        added: [],
        updated: updates,
        removedUids: [],
        bootstrap: false
      })
    }
  }

  private async fetchSummariesForUids(
    folderPath: string,
    uids: number[],
    options: { includeBody: boolean }
  ): Promise<MailMessageSummary[]> {
    if (uids.length === 0) {
      return []
    }

    const client = this.requireSync()
    const uidSequence = uids.join(',')
    const summaries: MailMessageSummary[] = []

    // Shared fetch request — the only difference between bootstrap and
    // incremental mode is whether we ask IMAP for the first 32 KB of source in
    // the same round-trip. For bootstrap (large batches of thousands of msgs)
    // we skip it and defer to the hydration pass, so the initial list
    // populates as fast as possible. For incremental (handful of new msgs)
    // we include it and extract the preview right here, so the row lands in
    // the DB with previewHydrated=true and notifications fire with snippet.
    const fetchOptions: Parameters<typeof client.fetchAll>[1] = {
      uid: true,
      threadId: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true
    }
    if (options.includeBody) {
      fetchOptions.source = { start: 0, maxLength: PREVIEW_SOURCE_MAX_BYTES }
    }
    const fetchedMessages = await client.fetchAll(uidSequence, fetchOptions, { uid: true })

    for (const fetched of fetchedMessages) {
      const envelope = fetched.envelope
      const flags = [...(fetched.flags ?? new Set<string>())]
      const subject = formatSubject(envelope?.subject)

      let preview = ''
      let previewHydrated = false
      if (options.includeBody && fetched.source) {
        try {
          const parsed = await parseMessagePayload(fetched.source)
          preview = extractPreview(parsed, subject)
          previewHydrated = true
        } catch {
          // Parse failed on truncated source — leave unhydrated, the hydration
          // pass will try again with a fresh fetch later.
          preview = ''
          previewHydrated = false
        }
      }

      summaries.push({
        accountId: this.account.id,
        folderPath,
        uid: fetched.uid,
        threadId: fetched.threadId,
        messageId: envelope?.messageId,
        subject,
        from: mapAddresses(envelope?.from),
        to: mapAddresses(envelope?.to),
        cc: mapAddresses(envelope?.cc),
        date: internalDateToIso(fetched.internalDate),
        preview,
        previewHydrated,
        flags,
        isRead: flags.includes('\\Seen'),
        hasAttachments: hasAttachmentInStructure(fetched.bodyStructure),
        size: fetched.size ?? 0
      })
    }

    return summaries
  }

  private async fetchPreviewsForUids(
    _folderPath: string,
    uids: number[]
  ): Promise<Array<{ uid: number; preview: string }>> {
    if (uids.length === 0) {
      return []
    }

    const client = this.requireSync()
    const uidSequence = uids.join(',')
    const results: Array<{ uid: number; preview: string }> = []

    // Partial-body fetch: we grab enough bytes to cover the headers + a usable
    // body prefix. The preview extractor handles truncation and marketing-email
    // boilerplate, so 8KB is plenty for a meaningful snippet.
    const fetchedMessages = await client.fetchAll(
      uidSequence,
      {
        uid: true,
        envelope: true,
        source: {
          start: 0,
          maxLength: PREVIEW_SOURCE_MAX_BYTES
        }
      },
      { uid: true }
    )

    for (const fetched of fetchedMessages) {
      const subject = formatSubject(fetched.envelope?.subject)
      let preview = subject

      if (fetched.source) {
        try {
          const parsed = await parseMessagePayload(fetched.source)
          preview = extractPreview(parsed, subject)
        } catch {
          preview = subject
        }
      }

      results.push({ uid: fetched.uid, preview })
    }

    return results
  }

  private async reconcileLocalAgainstServer(folderPath: string): Promise<void> {
    const client = this.requireSync()
    const localUids = await this.database.listAllMessageUids(this.account.id, folderPath)

    if (localUids.length === 0) {
      return
    }

    const serverUids = await client.search({ uid: '1:*' }, { uid: true })
    const serverUidSet = new Set(Array.isArray(serverUids) ? serverUids : [])
    const staleUids = localUids.filter((uid) => !serverUidSet.has(uid))

    if (staleUids.length === 0) {
      return
    }

    await this.database.deleteMessageUids(this.account.id, folderPath, staleUids)
    this.emit('messages', {
      accountId: this.account.id,
      folderPath,
      added: [],
      updated: [],
      removedUids: staleUids,
      bootstrap: false
    })
  }

  private async handleExpungeEvent(event: ExpungeEvent): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    this.incrementalSyncFolder(event.path, 'active-sync')
  }

  private async handleFlagsEvent(event: FlagsEvent): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    if (typeof event.uid !== 'number') {
      // Without UID we cannot target persistence precisely; trigger an incremental pass.
      this.incrementalSyncFolder(event.path, 'active-sync')
      return
    }

    const flags = [...event.flags]
    const summary = await this.database.updateMessageFlags(
      this.account.id,
      event.path,
      event.uid,
      flags
    )

    if (summary) {
      this.emit('messages', {
        accountId: this.account.id,
        folderPath: event.path,
        added: [],
        updated: [summary],
        removedUids: [],
        bootstrap: false
      })
    }
  }

  private async pollFolderStatuses(): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    const syncClient = this.syncClient
    const folders = await this.database.listFolders(this.account.id)
    // IDLE runs on primaryClient — skip the mailbox IDLE is currently watching,
    // it already pushes exists/expunge/flags events in real time.
    const idleFolderPath =
      this.primaryClient?.mailbox && typeof this.primaryClient.mailbox !== 'boolean'
        ? this.primaryClient.mailbox.path
        : null

    let anySyncRun = false

    for (const folder of folders) {
      if (this.isFolderNonSelectable(folder)) {
        continue
      }

      if (idleFolderPath && folder.path === idleFolderPath) {
        continue
      }

      try {
        const status = await syncClient.status(folder.path, {
          messages: true,
          unseen: true,
          uidValidity: true,
          highestModseq: true
        })

        const state = await this.database.getFolderSyncState(this.account.id, folder.path)
        const hasChanges =
          (typeof status.highestModseq === 'bigint' &&
            (!state?.highestModseq || state.highestModseq !== status.highestModseq)) ||
          (typeof status.messages === 'number' && status.messages !== folder.messageCount) ||
          (typeof status.uidValidity === 'bigint' && state?.uidValidity !== status.uidValidity)

        if (hasChanges) {
          this.incrementalSyncFolder(folder.path, 'background')
          anySyncRun = true
        } else if (
          typeof status.messages === 'number' &&
          typeof status.unseen === 'number' &&
          (status.messages !== folder.messageCount || status.unseen !== folder.unseenCount)
        ) {
          await this.database.updateFolderCounts(
            this.account.id,
            folder.path,
            status.messages,
            status.unseen
          )
          this.emit('folder-counts', {
            accountId: this.account.id,
            folderPath: folder.path,
            messageCount: status.messages,
            unseenCount: status.unseen
          })
        }
      } catch (error) {
        logMainError('Folder STATUS poll failed', error, {
          accountId: this.account.id,
          folderPath: folder.path
        })
      }
    }

    // Nudge IDLE back to the preferred mailbox if the user switched folders in
    // the meantime. Harmless no-op otherwise.
    if (anySyncRun) {
      this.enqueuePrimaryCommand(async () => {
        await this.selectIdleMailbox()
      }, 'idle-refresh')
    }

    // If the user is browsing a non-idling folder right now, refresh it more
    // aggressively than the normal poll interval so incoming changes appear
    // instantly. This fires on the sync queue.
    const activePath =
      this.lastActiveContext?.accountId === this.account.id
        ? this.lastActiveContext.folderPath
        : null

    if (activePath && idleFolderPath && activePath !== idleFolderPath) {
      setTimeout(() => {
        if (this.syncClient?.usable) {
          this.incrementalSyncFolder(activePath, 'active-sync')
        }
      }, ACTIVE_FOLDER_POLL_INTERVAL_MS)
    }
  }

  private async findFolderBySpecialUse(
    specialUses: string[],
    nameHints: string[]
  ): Promise<MailFolder | null> {
    const folders = await this.database.listFolders(this.account.id)

    for (const flag of specialUses) {
      const found = folders.find(
        (folder) => folder.specialUse?.toLowerCase() === flag.toLowerCase()
      )
      if (found) {
        return found
      }
    }

    const normalize = (value: string): string =>
      value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()

    const hintSet = new Set(nameHints.map(normalize))

    for (const folder of folders) {
      if (hintSet.has(normalize(folder.name)) || hintSet.has(normalize(folder.path))) {
        return folder
      }
    }

    return null
  }

  // ───────────────────────────── Primary queue ─────────────────────────────
  // User-initiated operations (click to open, toggle flag, move, delete, send,
  // attachment download, switch active folder). Always 'user' priority — the
  // queue is single-priority by design: we never want a user op to wait behind
  // another user op that hasn't finished yet, and there's nothing in this
  // queue that should be deprioritised.

  private enqueuePrimaryCommand(run: () => Promise<void>, label: string): void {
    this.primaryQueue.push({ priority: 'user', label, run })
    this.startPrimaryWorkerIfNeeded()
  }

  private async enqueuePrimaryCommandAwaitable(
    run: () => Promise<void>,
    label: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.primaryQueue.push({
        priority: 'user',
        label,
        run: async () => {
          try {
            await run()
            resolve()
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })
      this.startPrimaryWorkerIfNeeded()
    })
  }

  private async enqueuePrimaryWithReturn<T>(run: () => Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.primaryQueue.push({
        priority: 'user',
        label,
        run: async () => {
          try {
            resolve(await run())
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })
      this.startPrimaryWorkerIfNeeded()
    })
  }

  private startPrimaryWorkerIfNeeded(): void {
    if (this.primaryWorkerActive) {
      return
    }
    this.primaryWorkerActive = true
    void this.runPrimaryWorker()
  }

  private async runPrimaryWorker(): Promise<void> {
    try {
      while (this.primaryQueue.length > 0) {
        if (!this.primaryClient?.usable) {
          break
        }
        const task = this.primaryQueue.shift()
        if (!task) {
          break
        }
        try {
          await task.run()
        } catch (error) {
          logMainError('Mail engine primary task failed', error, {
            accountId: this.account.id,
            taskLabel: task.label
          })
        }
      }
    } finally {
      this.primaryWorkerActive = false
    }

    if (this.primaryQueue.length > 0 && this.primaryClient?.usable) {
      this.startPrimaryWorkerIfNeeded()
    }
  }

  // ────────────────────────────── Sync queue ──────────────────────────────
  // Bootstrap, polling, per-folder envelope + hydration, IDLE-triggered
  // incremental syncs. Multi-priority: 'active-sync' jumps ahead of
  // 'background' so the folder the user is looking at hydrates first.

  private enqueueSyncCommand(
    run: () => Promise<void>,
    label: string,
    priority: TaskPriority
  ): void {
    this.syncQueue.push({ priority, label, run })
    this.debugLog(`enqueue sync: ${label} (${priority}) queue=${this.syncQueue.length}`)
    this.startSyncWorkerIfNeeded()
  }

  private async enqueueSyncCommandAwaitable(
    run: () => Promise<void>,
    label: string,
    priority: TaskPriority
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.syncQueue.push({
        priority,
        label,
        run: async () => {
          try {
            await run()
            resolve()
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })
      this.startSyncWorkerIfNeeded()
    })
  }

  private startSyncWorkerIfNeeded(): void {
    if (this.syncWorkerActive) {
      return
    }
    this.syncWorkerActive = true
    void this.runSyncWorker()
  }

  private pickNextSyncTask(): QueuedTask | null {
    // Scan priorities in order and pick the first pending task of that tier,
    // preserving FIFO within the same priority.
    for (const priority of PRIORITY_ORDER) {
      const index = this.syncQueue.findIndex((task) => task.priority === priority)
      if (index >= 0) {
        return this.syncQueue.splice(index, 1)[0] ?? null
      }
    }
    return null
  }

  private async runSyncWorker(): Promise<void> {
    try {
      while (this.syncQueue.length > 0) {
        if (!this.syncClient?.usable) {
          this.debugLog(
            `sync worker paused: syncClient not usable (queue=${this.syncQueue.length})`
          )
          break
        }
        const task = this.pickNextSyncTask()
        if (!task) {
          break
        }
        const startedAt = Date.now()
        this.debugLog(
          `sync task start: ${task.label} (${task.priority}) queue=${this.syncQueue.length}`
        )
        try {
          await task.run()
        } catch (error) {
          logMainError('Mail engine sync task failed', error, {
            accountId: this.account.id,
            taskLabel: task.label
          })
        }
        this.debugLog(
          `sync task done : ${task.label} (${task.priority}) took=${Date.now() - startedAt}ms`
        )
      }
    } finally {
      this.syncWorkerActive = false
    }

    if (this.syncQueue.length > 0 && this.syncClient?.usable) {
      this.startSyncWorkerIfNeeded()
    } else if (this.syncQueue.length > 0) {
      this.debugLog(
        `sync worker exit with ${this.syncQueue.length} pending tasks and syncClient unusable`
      )
    }
  }

  private debugLog(message: string): void {
    if (process.env.DEBUG_MAIL_ENGINE !== '1') return
    const elapsed = Date.now()
    console.log(`[mail-engine ${this.account.email} ${elapsed}] ${message}`)
  }
}
