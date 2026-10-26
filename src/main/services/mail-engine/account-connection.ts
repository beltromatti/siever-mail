import { EventEmitter } from 'node:events'

import { net } from 'electron'
import {
  ImapFlow,
  type CopyResponseObject,
  type ExistsEvent,
  type ExpungeEvent,
  type FetchMessageObject,
  type FetchQueryObject,
  type FlagsEvent,
  type ListResponse,
  type SearchObject,
  type StatusObject
} from 'imapflow'
import type { ParsedMail } from 'mailparser'

import { extractErrorDetails, logMainError } from '@main/utils/error-utils'
import type {
  AccountConnectionState,
  AccountConnectionStatus,
  FetchedMessageDetail,
  FetchedMessageSummary,
  MailFolder,
  MailMessageSummary,
  MessageRef
} from '@shared/models'
import { folderForRole, folderRoleLabel, type FolderRole } from '@shared/folders'
import { deriveSenderKey, deriveSenderName } from '@shared/sender'

import type { AppDatabase, FolderSyncState } from '../database'
import type { GoogleOAuthService } from '../google-oauth'

import {
  formatSubject,
  hasAttachmentInStructure,
  internalDateToIso,
  mapAddresses,
  mapFetchedToDetail,
  mergeSummaryAndParsedIntoDetail
} from './message-mapper'
import { collectFetchResults, formatUidSet } from './fetch-results'
import { extractPreview } from './preview'
import { intersectUids, SERVER_SEARCH_MATCH_LIMIT } from './server-search'
import { attachmentFileName, parseMessageSource } from './message-parts'
import {
  PARTIAL_BODY_THRESHOLD_BYTES,
  buildPartSource,
  buildPartialSource,
  decodedPartSize,
  partHeaderKey,
  planPartialBody
} from './message-skeleton'
import {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_MAX_IDLE_TIME_MS,
  IMAP_SOCKET_TIMEOUT_MS,
  imapEncryption,
  resolveImapAuth,
  type AccountWithSecret
} from './mail-transport'

// Bootstrap batches: envelope-only (no body). 1000 UIDs fit comfortably in a
// single IMAP FETCH because each envelope is tiny — used only for the initial
// bulk sync where we want the list to populate as fast as possible and defer
// the preview to a follow-up hydration pass.
/** The folder archiving creates on a server that has none. */
const ARCHIVE_FOLDER_NAME = 'Archivio'
/** The Bozze created for an account without one; servers know the name as \Drafts. */
const DRAFTS_FOLDER_NAME = 'Bozze'

const BOOTSTRAP_ENVELOPE_BATCH_SIZE = 1000
// The first batch of a first sync is the first screen of the list: small,
// so its rows show in a moment, and its previews are fetched right after it,
// before the thousands of envelopes behind.
const BOOTSTRAP_FIRST_PAGE_SIZE = 100
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
// The previews filled in ahead, per folder: the newest messages, the ones
// read. An older one is fetched when its row comes into view
// (`hydratePreviews`) — previews cost 32 KB of source each, and filling in
// a 10,000-message inbox ahead downloaded some 300 MB.
const EAGER_HYDRATION_LIMIT = 300
// Previews asked for by rows in view go in batches this size, at the
// priority of what the user looks at.
const VISIBLE_HYDRATION_BATCH_SIZE = 50
// 32 KB leaves a 2-3× margin over the <head><style> block of the heaviest
// marketing senders (Breasy, Wizz Air and similar run 10-20 KB of @media
// queries before <body>), so the preview extractor always has real prose to
// work with. Runs on the sync client only — never on the critical user path.
const PREVIEW_SOURCE_MAX_BYTES = 32 * 1024
const INBOX_SPECIAL_USE = '\\Inbox'
// The newest messages of the inbox whose bodies are kept ready, fetched on
// the sync connection after each sync of it: new mail, and the first screen
// of the list, open at once.
const RECENT_INBOX_BODIES = 25
const BACKGROUND_FOLDER_POLL_INTERVAL_MS = 45_000
const ACTIVE_FOLDER_POLL_INTERVAL_MS = 20_000
const RECONNECT_BACKOFF_INITIAL_MS = 2_000
const RECONNECT_BACKOFF_MAX_MS = 60_000
const FOLDER_POLL_TASK_LABEL = 'folder-poll'
// While the computer reports no network, how often to look again. Cheap: it
// reads a flag Chromium keeps current, no packet leaves the machine.
const OFFLINE_RECHECK_MS = 3_000
// A NOOP normally answers in well under a second; one that takes this long
// is a link that died while the computer slept or changed networks.
const HEALTH_CHECK_TIMEOUT_MS = 20_000

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

/**
 * Why a message's body is wanted, which decides when and how it is fetched:
 *   • `read` — the reading pane shows it. A later read takes the place of
 *     one still waiting its turn: arrowing down a list fetches the message
 *     the pane ends on, not every one it went past;
 *   • `use` — something waits on it (a reply, a forward): it is fetched
 *     however many reads come after;
 *   • `prefetch` — it is likely to be read next. It is fetched on the sync
 *     connection, so what the user asks for never waits behind it.
 */
export type BodyLoadIntent = 'read' | 'use' | 'prefetch'

type BodyLoadSettlement = PromiseWithResolvers<FetchedMessageDetail | null>

interface BodyLoad {
  ref: MessageRef
  size: number
  /** The connection whose queue it waits in. */
  lane: 'primary' | 'sync'
  task: QueuedTask
  /** Why it is wanted; a read is dropped only when nothing else wants it. */
  intents: Set<BodyLoadIntent>
  /** Settles with the body, or null when it was only read and a later read took its place. */
  settlement: BodyLoadSettlement
}

/**
 * How long something the user asked for (open, move, flag, download) waits
 * for a connection that is not there. A reconnect usually takes a few
 * seconds; past this the operation fails and says why, instead of hanging
 * with the change already shown on screen.
 */
const USER_OPERATION_CONNECTION_WAIT_MS = 20_000

interface FolderSyncPlan {
  uidValidity: bigint
  highestModseq: bigint | undefined
  uidNext: number
  exists: number
  previousLastKnownUid: number
  isBootstrap: boolean
  newUids: number[]
  needsReconciliation: boolean
}

export type AccountConnectionSnapshot = Omit<AccountConnectionState, 'accountId'>

export interface FetchedAttachment {
  /** Position in the parsed attachment list — the key the reader uses. */
  index: number
  fileName: string
  content: Buffer
}

type AccountConnectionEvents = {
  state: (state: AccountConnectionSnapshot) => void
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

/**
 * How many UIDs one command names. The set is written in ranges, but a
 * scattered selection can still make a long line, and servers cap those.
 */
const UID_COMMAND_CHUNK = 500
/** Messages whose raw source one command fetches: a handful, however large each may be. */
const RAW_SOURCE_BATCH_SIZE = 8

/** A message as the server stores it, with a parsed view of it. */
export interface RawMessage {
  source: Buffer
  /**
   * The parse leaves `cid:` references in the HTML alone, so the sender's
   * attachments can be told apart from the images the body shows (see
   * `partitionMessageAttachments`).
   */
  parsed: ParsedMail
  internalDate: string
}

/**
 * How many messages of the selected mailbox are unread. A server with
 * ESEARCH counts them; otherwise it lists them — every UID of thousands of
 * unread messages, at each sync of the folder, only to be counted.
 */
async function countUnseen(client: ImapFlow): Promise<number> {
  const result = await client.search({ seen: false }, { uid: true, returnOptions: ['COUNT'] })

  if (Array.isArray(result)) {
    return result.length
  }

  return result ? (result.count ?? 0) : 0
}

/** IMAP spells the inbox INBOX, in any case. */
function isInboxPath(folderPath: string): boolean {
  return folderPath.toUpperCase() === 'INBOX'
}

/**
 * The folders that can hold mail. A \\Noselect mailbox is only a parent in
 * the hierarchy ("[Gmail]"); its children are listed by themselves.
 */
function selectableMailboxes(mailboxes: ReadonlyArray<ListResponse>): ListResponse[] {
  return mailboxes.filter(
    (mailbox) => !mailbox.flags.has('\\Noselect') && !mailbox.flags.has('\\NonExistent')
  )
}

/** Takes the queue's next task: the first of the highest priority waiting. */
function pickNextTask(queue: QueuedTask[]): QueuedTask | null {
  for (const priority of PRIORITY_ORDER) {
    const index = queue.findIndex((task) => task.priority === priority)

    if (index >= 0) {
      return queue.splice(index, 1)[0] ?? null
    }
  }

  return null
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

/**
 * Moves messages of the selected mailbox, and throws when the server did
 * not. imapflow reports a refused MOVE (a folder that does not exist, a
 * full quota) as `false` instead of an error, which let messages vanish
 * here while they stayed where they were. And on a server without MOVE its
 * own copy-then-delete deletes the originals even when the copy was
 * refused, so that path is spelled out here, in order, checking each step.
 *
 * Resolves with what a server with UIDPLUS says about the destination: its
 * UIDVALIDITY and the UID each message has there.
 */
async function moveOnServer(
  client: ImapFlow,
  uids: number[],
  destination: string
): Promise<CopyResponseObject> {
  const range = formatUidSet(uids)

  if (client.capabilities.has('MOVE')) {
    const moved = await client.messageMove(range, destination, { uid: true })

    if (!moved) {
      throw new Error(`Il server non ha spostato i messaggi in «${destination}».`)
    }
    return moved
  }

  const copied = await client.messageCopy(range, destination, { uid: true })

  if (!copied) {
    throw new Error(`Il server non ha copiato i messaggi in «${destination}».`)
  }

  if (!(await client.messageDelete(range, { uid: true }))) {
    throw new Error(
      `I messaggi sono stati copiati in «${destination}» ma il server non li ha rimossi dalla cartella di origine.`
    )
  }

  return copied
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
  // An "Archivio" folder being created for the first archive, shared by
  // every archive that asks for it meanwhile.
  private archiveFolderCreation: Promise<MailFolder> | null = null
  private syncClient: ImapFlow | null = null
  private running = false
  private shuttingDown = false
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
  // Bodies being fetched, by folder and UID: whoever else wants one meanwhile
  // waits on the same fetch.
  private readonly bodyLoads = new Map<string, BodyLoad>()
  // The reading pane's fetch while it waits its turn (see `BodyLoadIntent`).
  private waitingRead: BodyLoad | null = null
  // Previews queued or being fetched, by folder and UID: asked again, they
  // are not fetched twice.
  private readonly hydratingPreviews = new Set<string>()
  /**
   * The UIDs taken out of each folder this session — moved, deleted, a
   * draft superseded or sent. A sync that read one off the server just
   * before it went would otherwise put it back in the list after it left;
   * a UID is never given again under the same UIDVALIDITY.
   */
  private readonly removedUids = new Map<string, Set<number>>()
  // A server search waiting its turn (see `searchMessages`).
  private waitingSearch: { task: QueuedTask; settle: (uids: null) => void } | null = null
  private status: AccountConnectionStatus = 'disconnected'
  private lastError: { message: string; authFailed: boolean } | null = null
  private lastContactAt: number | undefined
  // Folders downloading their mail for the first time: what "syncing" means
  // to the user. Incremental catch-ups take a second and are not reported.
  private readonly bootstrappingFolders = new Set<string>()
  // Resolves the pause between reconnect attempts early (see `nudge`).
  private wakeRetry: (() => void) | null = null

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

  getState(): AccountConnectionSnapshot {
    return {
      status: this.status,
      syncing: this.status === 'connected' && this.bootstrappingFolders.size > 0,
      errorMessage: this.status === 'error' ? this.lastError?.message : undefined,
      authFailed: this.status === 'error' ? this.lastError?.authFailed : undefined,
      lastContactAt: this.lastContactAt
    }
  }

  /**
   * Checks the link now rather than on the next timer — after the computer
   * wakes up, the screen unlocks or the network changes. A connection
   * waiting to retry retries at once, from a fresh backoff; a live one has
   * to answer a NOOP or is torn down and rebuilt, then catches up on every
   * folder in case something arrived while it could not hear.
   */
  nudge(): void {
    if (!this.running) {
      return
    }

    if (this.wakeRetry) {
      this.backoffMs = RECONNECT_BACKOFF_INITIAL_MS
      this.wakeRetry()
      return
    }

    if (this.primaryClient && this.syncClient) {
      void this.verifyConnection()
    }
  }

  /**
   * Asks the server about every folder now — "Controlla nuova posta" —
   * instead of on the next poll. A link that is down retries at once.
   */
  checkNow(): void {
    if (this.primaryClient?.usable && this.syncClient?.usable) {
      this.enqueueFolderPoll('user')
      return
    }

    this.nudge()
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

    this.folderPollInterval = setInterval(
      () => this.enqueueFolderPoll('background'),
      BACKGROUND_FOLDER_POLL_INTERVAL_MS
    )
  }

  /**
   * Queues a STATUS sweep of every folder, unless one is already waiting: a
   * long bootstrap would otherwise stack a sweep every interval and then
   * run them back to back.
   */
  private enqueueFolderPoll(priority: TaskPriority): void {
    if (this.syncQueue.some((task) => task.label === FOLDER_POLL_TASK_LABEL)) {
      return
    }

    this.enqueueSyncCommand(
      async () => {
        if (this.syncClient?.usable) {
          await this.reviewFolders({ connecting: false })
          this.refreshUnwatchedActiveFolderSoon()
        }
      },
      FOLDER_POLL_TASK_LABEL,
      priority
    )
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    this.running = false
    // The loop may be parked between attempts; let it see `running` is off.
    this.wakeRetry?.()

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

  /**
   * Fetches a message's body, stores it with the message and resolves with
   * it — or, for a read, with null when a later read took its place (see
   * `BodyLoadIntent`). `size` is the message's size, which decides whether
   * its attachments come with it (see `PARTIAL_BODY_THRESHOLD_BYTES`).
   */
  loadMessageBody(
    ref: MessageRef,
    size: number,
    intent: 'use' | 'prefetch'
  ): Promise<FetchedMessageDetail>
  loadMessageBody(
    ref: MessageRef,
    size: number,
    intent: BodyLoadIntent
  ): Promise<FetchedMessageDetail | null>
  loadMessageBody(
    ref: MessageRef,
    size: number,
    intent: BodyLoadIntent
  ): Promise<FetchedMessageDetail | null> {
    const key = `${ref.folderPath}\u0000${ref.uid}`
    const load =
      this.bodyLoads.get(key) ??
      (intent === 'prefetch'
        ? this.queueBodyLoad(key, ref, size, 'sync', 'active-sync')
        : this.queueBodyLoad(key, ref, size, 'primary', 'user'))

    load.intents.add(intent)

    // A prefetch the user now waits on is fetched as what they asked for.
    if (intent !== 'prefetch' && load.lane === 'sync' && this.isWaiting(load)) {
      this.moveBodyLoad(load, 'primary')
    }

    if (intent === 'read') {
      if (this.waitingRead && this.waitingRead !== load) {
        this.giveWay(this.waitingRead)
      }

      this.waitingRead = load
    }

    return load.settlement.promise
  }

  private queueBodyLoad(
    key: string,
    ref: MessageRef,
    size: number,
    lane: BodyLoad['lane'],
    priority: TaskPriority
  ): BodyLoad {
    const settlement: BodyLoadSettlement = Promise.withResolvers()
    const load: BodyLoad = {
      ref,
      size,
      lane,
      task: this.queueBodyFetch(ref, size, lane, priority, settlement),
      intents: new Set(),
      settlement
    }

    void settlement.promise
      .catch(() => undefined)
      .finally(() => {
        if (this.bodyLoads.get(key) === load) {
          this.bodyLoads.delete(key)
        }

        if (this.waitingRead === load) {
          this.waitingRead = null
        }
      })

    this.bodyLoads.set(key, load)
    return load
  }

  /**
   * Queues the fetch of a body on a connection, settling `settlement` with
   * it. The primary connection runs everything at 'user' priority.
   */
  private queueBodyFetch(
    ref: MessageRef,
    size: number,
    lane: BodyLoad['lane'],
    priority: TaskPriority,
    settlement: BodyLoadSettlement
  ): QueuedTask {
    const label = `load-body:${ref.folderPath}:${ref.uid}`

    if (lane === 'primary') {
      const operation = this.queuePrimaryOperation(
        () => this.fetchAndStoreBody(this.requirePrimary(), ref, size),
        label
      )
      operation.promise.then(settlement.resolve, settlement.reject)
      return operation.task
    }

    const task: QueuedTask = {
      priority,
      label,
      run: async () => {
        try {
          settlement.resolve(await this.fetchAndStoreBody(this.requireSync(), ref, size))
        } catch (error) {
          settlement.reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    this.syncQueue.push(task)
    this.startSyncWorkerIfNeeded()
    return task
  }

  /** Whether a body load still waits its turn, rather than being under way or done. */
  private isWaiting(load: BodyLoad): boolean {
    return (load.lane === 'primary' ? this.primaryQueue : this.syncQueue).includes(load.task)
  }

  private moveBodyLoad(load: BodyLoad, lane: BodyLoad['lane']): void {
    const queue = load.lane === 'primary' ? this.primaryQueue : this.syncQueue
    queue.splice(queue.indexOf(load.task), 1)
    load.lane = lane
    load.task = this.queueBodyFetch(
      load.ref,
      load.size,
      lane,
      lane === 'primary' ? 'user' : 'active-sync',
      load.settlement
    )
  }

  /**
   * Keeps the bodies of the inbox's newest messages ready (see
   * `RECENT_INBOX_BODIES`), behind everything else the sync connection has
   * to do. One that fails is fetched when it is read.
   */
  private async prefetchRecentBodies(folderPath: string): Promise<void> {
    const missing = await this.database.listRecentMessagesWithoutBody(
      this.account.id,
      folderPath,
      RECENT_INBOX_BODIES
    )

    for (const { uid, size } of missing) {
      const ref = { accountId: this.account.id, folderPath, uid }
      const key = `${folderPath}\u0000${uid}`

      if (!this.bodyLoads.has(key)) {
        const load = this.queueBodyLoad(key, ref, size, 'sync', 'background')
        load.intents.add('prefetch')
        load.settlement.promise.catch(() => undefined)
      }
    }
  }

  /**
   * A read that a later one replaced before its turn came: dropped, unless
   * something else wants the message too — a reply waiting on it keeps its
   * turn, a prefetch goes back to the sync connection.
   */
  private giveWay(load: BodyLoad): void {
    // Under way already: it lands in a moment either way.
    if (!this.isWaiting(load)) {
      return
    }

    load.intents.delete('read')

    if (load.intents.has('use')) {
      return
    }

    if (load.intents.has('prefetch')) {
      this.moveBodyLoad(load, 'sync')
      return
    }

    const queue = load.lane === 'primary' ? this.primaryQueue : this.syncQueue
    queue.splice(queue.indexOf(load.task), 1)
    this.bodyLoads.delete(`${load.ref.folderPath}\u0000${load.ref.uid}`)
    load.settlement.resolve(null)
  }

  private async fetchAndStoreBody(
    client: ImapFlow,
    ref: MessageRef,
    size: number
  ): Promise<FetchedMessageDetail> {
    const lock = await client.getMailboxLock(ref.folderPath)
    let detail: FetchedMessageDetail

    try {
      detail =
        size > PARTIAL_BODY_THRESHOLD_BYTES
          ? await this.fetchBodyWithoutAttachments(client, ref)
          : await this.fetchWholeBody(client, ref)
    } finally {
      lock.release()
    }

    const updated = await this.database.updateMessageBody(ref, detail)

    if (updated) {
      this.emit('messages', {
        accountId: this.account.id,
        folderPath: ref.folderPath,
        added: [],
        updated: [updated],
        removedUids: [],
        bootstrap: false
      })
    }

    return detail
  }

  private async fetchWholeBody(client: ImapFlow, ref: MessageRef): Promise<FetchedMessageDetail> {
    const fetched = await this.fetchOneRequested(client, ref, {
      threadId: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
      source: true
    })

    return mapFetchedToDetail(this.account.id, ref.folderPath, fetched)
  }

  /**
   * A large message's body without its attachments: its structure first,
   * then the text and the pictures the text draws, rebuilt into the message
   * it is with every file left empty (see `buildPartialSource`). The files
   * are listed with their size and come down one by one when opened.
   */
  private async fetchBodyWithoutAttachments(
    client: ImapFlow,
    ref: MessageRef
  ): Promise<FetchedMessageDetail> {
    const head = (
      await this.fetchRequested(client, ref.folderPath, [ref.uid], {
        threadId: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
        headers: true
      })
    ).get(ref.uid)

    if (!head?.envelope || !head.bodyStructure || !head.headers) {
      throw new Error('Messaggio non disponibile sul server.')
    }

    const plan = planPartialBody(head.bodyStructure)

    // A message of a single part has nothing to leave out.
    if (!plan) {
      return this.fetchWholeBody(client, ref)
    }

    const parts = (
      await this.fetchRequested(client, ref.folderPath, [ref.uid], {
        bodyParts: [...plan.headerParts.map(partHeaderKey), ...plan.contentParts]
      })
    ).get(ref.uid)?.bodyParts

    if (!parts) {
      throw new Error('Messaggio non disponibile sul server.')
    }

    const parsed = await parseMessageSource(
      buildPartialSource(head.headers, head.bodyStructure, parts)
    )
    const detail = mergeSummaryAndParsedIntoDetail(this.account.id, ref.folderPath, head, parsed)

    return {
      ...detail,
      attachments: detail.attachments.map((attachment) => {
        const omitted = attachment.part ? plan.omittedParts.get(attachment.part) : undefined
        return omitted ? { ...attachment, size: decodedPartSize(omitted) } : attachment
      })
    }
  }

  /**
   * The messages of a folder the server finds for a search (see
   * `imapSearchGroups`) — over their whole text, which the cache holds only
   * for the messages downloaded — the newest first, at most
   * `SERVER_SEARCH_MATCH_LIMIT`. On the sync connection, so reading mail
   * never waits behind it. A search still waiting when the next one comes
   * gives way and resolves null: the user has typed on.
   */
  searchMessages(
    folderPath: string,
    groups: ReadonlyArray<SearchObject>
  ): Promise<number[] | null> {
    const { promise, resolve, reject } = Promise.withResolvers<number[] | null>()

    if (this.waitingSearch) {
      const index = this.syncQueue.indexOf(this.waitingSearch.task)

      if (index >= 0) {
        this.syncQueue.splice(index, 1)
        this.waitingSearch.settle(null)
      }
    }

    const task: QueuedTask = {
      priority: 'user',
      label: `search:${folderPath}`,
      run: async () => {
        if (this.waitingSearch?.task === task) {
          this.waitingSearch = null
        }

        try {
          resolve(await this.runSearch(folderPath, groups))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    this.waitingSearch = { task, settle: resolve }
    this.syncQueue.push(task)
    this.startSyncWorkerIfNeeded()
    return promise
  }

  private async runSearch(
    folderPath: string,
    groups: ReadonlyArray<SearchObject>
  ): Promise<number[]> {
    const client = this.requireSync()
    const lock = await client.getMailboxLock(folderPath)

    try {
      let matches: number[] | null = null

      for (const criteria of groups) {
        const found = await client.search(criteria, { uid: true })
        const uids = Array.isArray(found) ? found : []
        matches = matches === null ? uids : intersectUids(matches, uids)

        if (matches.length === 0) {
          break
        }
      }

      return (matches ?? []).sort((left, right) => right - left).slice(0, SERVER_SEARCH_MATCH_LIMIT)
    } finally {
      lock.release()
    }
  }

  /** Marks messages of one folder read or unread, in one command. */
  async setSeen(folderPath: string, uids: number[], seen: boolean): Promise<void> {
    await this.setKeyword(folderPath, uids, '\\Seen', seen, 'set-seen')
  }

  /**
   * Adds or removes the IMAP `\\Flagged` keyword — the "contrassegna" of
   * Outlook and iOS Mail. It is server-side state, so the change shows up
   * on every other client of the account without any extra plumbing.
   */
  async setFlagged(folderPath: string, uids: number[], flagged: boolean): Promise<void> {
    await this.setKeyword(folderPath, uids, '\\Flagged', flagged, 'set-flagged')
  }

  /**
   * Single path for one-keyword mutations: push the change to the server,
   * then reconcile just that keyword locally. Deliberately does NOT rewrite
   * the whole flag set — doing so is how marking a message read used to
   * wipe its flag until the next resync.
   */
  private async setKeyword(
    folderPath: string,
    uids: number[],
    keyword: string,
    present: boolean,
    operationLabel: string
  ): Promise<void> {
    await this.runUserOperation(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(folderPath)

      try {
        for (const part of chunk(uids, UID_COMMAND_CHUNK)) {
          const range = formatUidSet(part)
          const stored = present
            ? await client.messageFlagsAdd(range, [keyword], { uid: true })
            : await client.messageFlagsRemove(range, [keyword], { uid: true })

          if (!stored) {
            throw new Error('Il server non ha aggiornato i messaggi.')
          }
        }
      } finally {
        lock.release()
      }

      const updated = await this.database.setMessagesFlag(
        this.account.id,
        folderPath,
        uids,
        keyword,
        present
      )

      if (updated.length > 0) {
        this.emit('messages', {
          accountId: this.account.id,
          folderPath,
          added: [],
          updated,
          removedUids: [],
          bootstrap: false
        })
      }
    }, `${operationLabel}:${folderPath}:${uids.length}`)
  }

  /**
   * Moves messages of one folder to another of the account, in one command.
   * They show in the destination at once, under the UIDs the server gave
   * them there, with whatever of them was already downloaded.
   */
  async moveMessages(
    folderPath: string,
    uids: number[],
    destinationFolderPath: string,
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<void> {
    if (destinationFolderPath === folderPath) {
      return
    }

    await this.runUserOperation(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(folderPath)
      const uidMap = new Map<number, number>()
      let destinationUidValidity: bigint | undefined

      try {
        for (const part of chunk(uids, UID_COMMAND_CHUNK)) {
          if (options.markAsSeenBeforeMove) {
            await client.messageFlagsAdd(formatUidSet(part), ['\\Seen'], { uid: true })
            await this.database.setMessagesFlag(this.account.id, folderPath, part, '\\Seen', true)
          }

          const moved = await moveOnServer(client, part, destinationFolderPath)
          destinationUidValidity = moved.uidValidity
          moved.uidMap?.forEach((destinationUid, sourceUid) =>
            uidMap.set(sourceUid, destinationUid)
          )
        }
      } finally {
        lock.release()
      }

      // The UIDs are only worth keeping under the UIDVALIDITY the cache knows
      // the destination by; otherwise its next sync starts it over anyway.
      const destinationState = await this.database.getFolderSyncState(
        this.account.id,
        destinationFolderPath
      )
      const relocated =
        destinationUidValidity !== undefined &&
        destinationState?.uidValidity === destinationUidValidity
          ? await this.database.relocateMessages(
              this.account.id,
              folderPath,
              destinationFolderPath,
              uidMap
            )
          : []

      await this.forgetMessages(folderPath, uids)

      if (relocated.length > 0) {
        // Not new mail: no notification, now or when the destination syncs.
        this.emit('messages', {
          accountId: this.account.id,
          folderPath: destinationFolderPath,
          added: relocated,
          updated: [],
          removedUids: [],
          bootstrap: true
        })
      }

      this.incrementalSyncFolder(folderPath, 'background')
      this.incrementalSyncFolder(destinationFolderPath, 'background')
    }, `move:${folderPath}:${uids.length}`)
  }

  /**
   * Takes messages that left a folder out of the cache, and tells every view
   * at once — the list they were in, Tutti gli account, a search.
   */
  private async forgetMessages(folderPath: string, uids: number[]): Promise<void> {
    const removed = this.removedUids.get(folderPath) ?? new Set<number>()
    uids.forEach((uid) => removed.add(uid))
    this.removedUids.set(folderPath, removed)

    await this.database.deleteMessageUids(this.account.id, folderPath, uids)
    this.emit('messages', {
      accountId: this.account.id,
      folderPath,
      added: [],
      updated: [],
      removedUids: uids,
      bootstrap: false
    })
  }

  /**
   * Files a version of a draft in the account's Bozze — created when the
   * account has none — and deletes the version it replaces for good: a
   * superseded draft is nobody's message. Resolves with where the new
   * version is; its UID is what the server reports, or what a search for
   * its Message-ID finds, or null.
   */
  async saveDraft(
    raw: Buffer,
    messageId: string,
    replace: { folderPath: string; uid: number } | null
  ): Promise<{ folderPath: string; uid: number | null }> {
    const drafts =
      folderForRole(await this.database.listFolders(this.account.id), '\\Drafts') ??
      (await this.createFolder(DRAFTS_FOLDER_NAME, null))

    const saved = await this.runUserOperation(async () => {
      const client = this.requirePrimary()
      const appended = await client.append(drafts.path, raw, ['\\Draft', '\\Seen'], new Date())

      if (!appended) {
        throw new Error('Il server non ha salvato la bozza.')
      }

      let uid = appended.uid ?? null

      if (uid === null) {
        const lock = await client.getMailboxLock(drafts.path)

        try {
          const found = await client.search({ header: { 'message-id': messageId } }, { uid: true })
          uid = Array.isArray(found) && found.length > 0 ? Math.max(...found) : null
        } finally {
          lock.release()
        }
      }

      if (replace && !(replace.folderPath === drafts.path && replace.uid === uid)) {
        await this.purgeOnServer(client, replace.folderPath, [replace.uid])
      }

      return { folderPath: drafts.path, uid }
    }, `save-draft:${drafts.path}`)

    this.incrementalSyncFolder(drafts.path, 'active-sync')
    return saved
  }

  /** Deletes messages for good, as `purgeOnServer` does — superseded drafts, a draft sent. */
  async purgeMessages(folderPath: string, uids: number[]): Promise<void> {
    await this.runUserOperation(
      () => this.purgeOnServer(this.requirePrimary(), folderPath, uids),
      `purge:${folderPath}:${uids.length}`
    )
  }

  /**
   * Deletes `uids` of `folderPath` for good. Gmail keeps in "Tutti i
   * messaggi" what is expunged from any other folder, so there they go to
   * the Trash first and are expunged from it, as Gmail's own deletion does.
   */
  private async purgeOnServer(client: ImapFlow, folderPath: string, uids: number[]): Promise<void> {
    const trash = folderForRole(await this.database.listFolders(this.account.id), '\\Trash')
    let target = { folderPath, uids }

    if (client.capabilities.has('X-GM-EXT-1') && trash && trash.path !== folderPath) {
      const lock = await client.getMailboxLock(folderPath)
      let moved: CopyResponseObject

      try {
        moved = await moveOnServer(client, uids, trash.path)
      } finally {
        lock.release()
      }

      await this.forgetMessages(folderPath, uids)
      target = {
        folderPath: trash.path,
        uids: uids.flatMap((uid) => moved.uidMap?.get(uid) ?? [])
      }
    }

    // Without the UIDs the Trash gave them, they stay there until it empties.
    if (target.uids.length === 0) {
      return
    }

    const lock = await client.getMailboxLock(target.folderPath)

    try {
      if (!(await client.messageDelete(formatUidSet(target.uids), { uid: true }))) {
        throw new Error('Il server non ha eliminato la versione precedente della bozza.')
      }
    } finally {
      lock.release()
    }

    await this.forgetMessages(target.folderPath, target.uids)
  }

  async moveMessagesToTrash(
    folderPath: string,
    uids: number[],
    options: { markAsSeenBeforeMove?: boolean } = {}
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const trash = folderForRole(await this.database.listFolders(this.account.id), '\\Trash')

    if (!trash || trash.path === folderPath) {
      if (options.markAsSeenBeforeMove) {
        await this.setSeen(folderPath, uids, true)
      }

      return { sourceFolder: folderPath, destinationFolder: trash?.path }
    }

    await this.moveMessages(folderPath, uids, trash.path, options)
    return { sourceFolder: folderPath, destinationFolder: trash.path }
  }

  /**
   * Deleting moves messages to the Trash; ones already there, or on an
   * account without a Trash, are deleted for good — as every client does.
   */
  async deleteMessages(
    folderPath: string,
    uids: number[]
  ): Promise<{ sourceFolder: string; destinationFolder?: string }> {
    const trash = folderForRole(await this.database.listFolders(this.account.id), '\\Trash')

    if (trash && trash.path !== folderPath) {
      await this.moveMessages(folderPath, uids, trash.path)
      return { sourceFolder: folderPath, destinationFolder: trash.path }
    }

    await this.runUserOperation(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(folderPath)

      try {
        for (const part of chunk(uids, UID_COMMAND_CHUNK)) {
          if (!(await client.messageDelete(formatUidSet(part), { uid: true }))) {
            throw new Error('Il server non ha eliminato i messaggi.')
          }
        }
      } finally {
        lock.release()
      }

      await this.forgetMessages(folderPath, uids)
      this.incrementalSyncFolder(folderPath, 'background')
    }, `delete:${folderPath}:${uids.length}`)

    return { sourceFolder: folderPath }
  }

  /**
   * Moves messages to the account's folder for a role — what dropping them
   * on a folder of "Tutti gli account" does: each account's own Spam, its own
   * Archivio (created where there is none, as archiving creates it).
   * Messages already there stay.
   */
  async moveMessagesToRole(folderPath: string, uids: number[], role: FolderRole): Promise<void> {
    const target =
      role === '\\Archive'
        ? await this.resolveArchiveFolder()
        : folderForRole(await this.database.listFolders(this.account.id), role)

    if (!target) {
      throw new Error(`${this.account.email} non ha una cartella «${folderRoleLabel(role)}».`)
    }

    if (target.path !== folderPath) {
      await this.moveMessages(folderPath, uids, target.path)
    }
  }

  async archiveMessages(
    folderPath: string,
    uids: number[]
  ): Promise<{ sourceFolder: string; destinationFolder: string }> {
    const archiveFolder = await this.resolveArchiveFolder()

    if (archiveFolder.path === folderPath) {
      throw new Error("I messaggi sono già nell'archivio.")
    }

    await this.moveMessages(folderPath, uids, archiveFolder.path)
    return { sourceFolder: folderPath, destinationFolder: archiveFolder.path }
  }

  /**
   * Where archiving puts a message, decided as the big clients decide it:
   * the account's archive folder, flagged `\Archive` or named so; on Gmail,
   * "Tutti i messaggi" — archiving there is leaving the inbox, every other
   * label stays; anywhere else an "Archivio" folder, created the first time,
   * as Thunderbird and Apple Mail create theirs. Several messages archived
   * at once share a single creation.
   */
  private async resolveArchiveFolder(): Promise<MailFolder> {
    const archive = folderForRole(await this.database.listFolders(this.account.id), '\\Archive')

    if (archive) {
      return archive
    }

    this.archiveFolderCreation ??= this.createArchiveFolder().finally(() => {
      this.archiveFolderCreation = null
    })

    return this.archiveFolderCreation
  }

  private async createArchiveFolder(): Promise<MailFolder> {
    return this.createFolder(ARCHIVE_FOLDER_NAME, null)
  }

  /** Marks every message of a folder read, on the server and here, in one command. */
  async markFolderRead(folderPath: string): Promise<void> {
    await this.runUserOperation(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(folderPath)

      try {
        const mailbox = client.mailbox

        if (mailbox && typeof mailbox !== 'boolean' && mailbox.exists > 0) {
          await client.messageFlagsAdd('1:*', ['\\Seen'])
        }
      } finally {
        lock.release()
      }

      await this.database.markFolderRead(this.account.id, folderPath)
    }, `mark-folder-read:${folderPath}`)

    this.incrementalSyncFolder(folderPath, 'active-sync')
  }

  /**
   * Gives a folder another name, where it is. Its messages come back under
   * the new name with the next sync; the subfolders move with it.
   */
  async renameFolder(folderPath: string, name: string): Promise<MailFolder> {
    const folders = await this.database.listFolders(this.account.id)
    const folder = folders.find((candidate) => candidate.path === folderPath)

    if (!folder) {
      throw new Error('La cartella non è più sul server.')
    }

    if (folder.delimiter && name.includes(folder.delimiter)) {
      throw new Error(`Il nome di una cartella non può contenere «${folder.delimiter}».`)
    }

    const separatorIndex = folder.delimiter ? folderPath.lastIndexOf(folder.delimiter) : -1
    const requestedPath =
      separatorIndex >= 0 ? `${folderPath.slice(0, separatorIndex + 1)}${name}` : name
    const path = await this.runUserOperation(async () => {
      const renamed = await this.requirePrimary().mailboxRename(folderPath, requestedPath)

      if (!renamed?.newPath) {
        throw new Error(`Il server non ha rinominato la cartella in «${name}».`)
      }

      return renamed.newPath
    }, `rename-folder:${folderPath}`)
    const renamed = (await this.refreshFolders()).find((candidate) => candidate.path === path)

    if (!renamed) {
      throw new Error(`Il server non mostra la cartella «${name}».`)
    }

    this.incrementalSyncFolder(path, 'active-sync')
    return renamed
  }

  /**
   * Creates a folder — inside `parentPath`, or at the top of the account —
   * and resolves with it as the folder list now has it.
   */
  async createFolder(name: string, parentPath: string | null): Promise<MailFolder> {
    const folders = await this.database.listFolders(this.account.id)
    const parent = parentPath ? folders.find((folder) => folder.path === parentPath) : null

    if (parentPath && !parent?.delimiter) {
      throw new Error('La cartella in cui crearla non è più sul server.')
    }

    // A name, not a path: the server's separator in it would nest the folder
    // where nobody asked.
    const delimiter = parent?.delimiter ?? folders.find((folder) => folder.delimiter)?.delimiter

    if (delimiter && name.includes(delimiter)) {
      throw new Error(`Il nome di una cartella non può contenere «${delimiter}».`)
    }

    const requestedPath = parent ? `${parent.path}${parent.delimiter}${name}` : name
    const path = await this.runUserOperation(async () => {
      const created = await this.requirePrimary().mailboxCreate(requestedPath)

      if (!created?.path) {
        throw new Error(`Il server non ha creato la cartella «${name}».`)
      }

      return created.path
    }, `create-folder:${requestedPath}`)
    const folder = (await this.refreshFolders()).find((candidate) => candidate.path === path)

    if (!folder) {
      throw new Error(`Il server non mostra la cartella «${name}» appena creata.`)
    }

    return folder
  }

  async appendToSent(rawMessage: Buffer, messageId: string): Promise<string | null> {
    const sentFolder = folderForRole(await this.database.listFolders(this.account.id), '\\Sent')

    if (!sentFolder) {
      return null
    }

    await this.enqueueBackgroundOperation(async () => {
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

  /**
   * The raw sources of `uids`, for filing them elsewhere: fetched a few at
   * a time — one command a batch, each its own user operation, so reading
   * mail goes on in between — and handed to `onMessage` while the next
   * batch downloads. Resolves with the UIDs the server no longer has; a
   * rejection of `onMessage` stops the rest.
   */
  async fetchRawSources(
    folderPath: string,
    uids: ReadonlyArray<number>,
    onMessage: (uid: number, message: RawMessage) => Promise<void>
  ): Promise<number[]> {
    const missing: number[] = []
    let handing: Promise<unknown> = Promise.resolve()

    for (const batch of chunk(uids, RAW_SOURCE_BATCH_SIZE)) {
      const fetched = await this.runUserOperation(async () => {
        const client = this.requirePrimary()
        const lock = await client.getMailboxLock(folderPath)

        try {
          return await this.fetchRequested(client, folderPath, batch, {
            internalDate: true,
            source: true
          })
        } finally {
          lock.release()
        }
      }, `fetch-raw:${folderPath}:${batch.length}`)

      await handing
      handing = Promise.all(
        batch.map(async (uid) => {
          const message = fetched.get(uid)

          if (!message?.source) {
            missing.push(uid)
            return
          }

          await onMessage(uid, {
            source: message.source,
            parsed: await parseMessageSource(message.source),
            internalDate: internalDateToIso(message.internalDate)
          })
        })
      )
      // Awaited with the next batch; marked handled meanwhile, so a failure
      // waits for it instead of surfacing as unhandled.
      handing.catch(() => undefined)
    }

    await handing
    return missing
  }

  /**
   * Attachments of one message, by their position in its parsed list of
   * parts (as the reader's attachment ids carry it). A large message gives
   * each file from its own part, in one command; a smaller one from a
   * single download of the whole message.
   */
  async fetchAttachments(
    ref: MessageRef,
    attachments: ReadonlyArray<{ index: number; part?: string }>,
    messageSize: number
  ): Promise<FetchedAttachment[]> {
    return this.runUserOperation(async () => {
      const client = this.requirePrimary()
      const lock = await client.getMailboxLock(ref.folderPath)

      try {
        const parts = attachments.map(({ part }) => part)

        if (
          messageSize > PARTIAL_BODY_THRESHOLD_BYTES &&
          parts.every((part): part is string => Boolean(part))
        ) {
          return await this.fetchAttachmentParts(client, ref, attachments, parts)
        }

        const fetched = await this.fetchOneRequested(client, ref, { source: true })
        const parsed = await parseMessageSource(fetched.source as Buffer)

        return attachments.map(({ index }) => {
          const attachment = parsed.attachments[index]

          if (!attachment) {
            throw new Error('Allegato non disponibile per questo messaggio.')
          }

          return {
            index,
            fileName: attachmentFileName(attachment, index),
            content: Buffer.from(attachment.content)
          }
        })
      } finally {
        lock.release()
      }
    }, `fetch-attachments:${ref.folderPath}:${ref.uid}`)
  }

  private async fetchAttachmentParts(
    client: ImapFlow,
    ref: MessageRef,
    attachments: ReadonlyArray<{ index: number }>,
    parts: ReadonlyArray<string>
  ): Promise<FetchedAttachment[]> {
    const fetched = (
      await this.fetchRequested(client, ref.folderPath, [ref.uid], {
        bodyParts: parts.flatMap((part) => [partHeaderKey(part), part])
      })
    ).get(ref.uid)?.bodyParts

    return Promise.all(
      attachments.map(async ({ index }, position) => {
        const part = parts[position]
        const header = fetched?.get(partHeaderKey(part))
        const content = fetched?.get(part)

        if (!header || !content) {
          throw new Error('Allegato non disponibile per questo messaggio.')
        }

        const [attachment] = (await parseMessageSource(buildPartSource(header, content)))
          .attachments

        if (!attachment) {
          throw new Error('Allegato non disponibile per questo messaggio.')
        }

        return {
          index,
          fileName: attachmentFileName(attachment, index),
          content: Buffer.from(attachment.content)
        }
      })
    )
  }

  /**
   * Fetches `query` for the messages `uids` of the mailbox `client` has
   * open, and keeps only the answers about them (see `collectFetchResults`).
   * What the server volunteered about other messages is their new flags,
   * and is applied as such.
   */
  private async fetchRequested(
    client: ImapFlow,
    folderPath: string,
    uids: ReadonlyArray<number>,
    query: FetchQueryObject
  ): Promise<Map<number, FetchMessageObject>> {
    if (uids.length === 0) {
      return new Map()
    }

    const answers = await client.fetchAll(
      formatUidSet(uids),
      { ...query, uid: true },
      { uid: true }
    )
    const { requested, unsolicited } = collectFetchResults(answers, new Set(uids))
    await this.applyUnsolicitedFlags(folderPath, unsolicited)
    return requested
  }

  /** One message's `query`, which must bring its source back: the message is gone otherwise. */
  private async fetchOneRequested(
    client: ImapFlow,
    ref: MessageRef,
    query: FetchQueryObject
  ): Promise<FetchMessageObject> {
    const fetched = (await this.fetchRequested(client, ref.folderPath, [ref.uid], query)).get(
      ref.uid
    )

    if (!fetched?.source) {
      throw new Error('Messaggio non disponibile sul server.')
    }

    return fetched
  }

  private async applyUnsolicitedFlags(
    folderPath: string,
    answers: ReadonlyArray<FetchMessageObject>
  ): Promise<void> {
    const updated: MailMessageSummary[] = []

    for (const answer of answers) {
      if (typeof answer.uid !== 'number' || !answer.flags) {
        continue
      }

      const summary = await this.database.replaceMessageFlags(
        this.account.id,
        folderPath,
        answer.uid,
        [...answer.flags]
      )

      if (summary) {
        updated.push(summary)
      }
    }

    if (updated.length > 0) {
      this.emit('messages', {
        accountId: this.account.id,
        folderPath,
        added: [],
        updated,
        removedUids: [],
        bootstrap: false
      })
    }
  }

  private setStatus(status: AccountConnectionStatus, error?: unknown): void {
    const nextError =
      status === 'error' && error !== undefined
        ? {
            message: error instanceof Error ? error.message : String(error),
            authFailed: extractErrorDetails(error).authenticationFailed === true
          }
        : this.lastError

    if (
      this.status === status &&
      nextError?.message === this.lastError?.message &&
      nextError?.authFailed === this.lastError?.authFailed
    ) {
      return
    }

    console.info(
      `[mail-engine] ${this.account.email}: ${this.status} -> ${status}` +
        (status === 'error' && nextError ? ` (${nextError.message})` : '')
    )
    this.status = status
    this.lastError = status === 'connected' ? null : nextError
    this.emitState()
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }

  /** The server just answered: the link is demonstrably alive. */
  private markContact(): void {
    this.lastContactAt = Date.now()
  }

  private async runConnectionLoop(): Promise<void> {
    while (this.running) {
      if (!net.isOnline()) {
        this.setStatus('offline')
        await this.waitBeforeRetry(OFFLINE_RECHECK_MS)
        continue
      }

      let primary: ImapFlow | null = null
      let sync: ImapFlow | null = null

      try {
        // First contact reads "connecting" and a dropped link "reconnecting".
        // A failed attempt stays "error" through the retries that follow:
        // flipping back on every retry made the badge flicker between
        // "reconnecting" and "lost" for as long as the server was down.
        if (this.status === 'disconnected') {
          this.setStatus('connecting')
        } else if (this.status === 'offline') {
          this.setStatus('reconnecting')
        }

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
          this.markContact()
          this.incrementalSyncFolder(event.path, 'active-sync')
        })
        primary.on('expunge', (event: ExpungeEvent) => {
          this.markContact()
          this.enqueueSyncCommand(
            async () => {
              await this.handleExpungeEvent(event)
            },
            `expunge:${event.path}`,
            'active-sync'
          )
        })
        primary.on('flags', (event: FlagsEvent) => {
          this.markContact()
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

        this.markContact()
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

        const { error: closeError } = await closedPromise
        this.primaryClient = null
        this.syncClient = null
        await this.safeShutdownClients(primary, sync)
        primary = null
        sync = null

        if (this.shuttingDown) {
          return
        }

        this.bootstrappingFolders.clear()
        this.setStatus(net.isOnline() ? 'reconnecting' : 'offline')

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
        this.bootstrappingFolders.clear()
        logMainError('IMAP connection error', error, {
          accountId: this.account.id
        })
        this.setStatus(net.isOnline() ? 'error' : 'offline', error)
      }

      // Offline, the top of the loop does the waiting — and retries the
      // moment the network is back instead of after a grown backoff.
      if (this.running && net.isOnline()) {
        await this.waitBeforeRetry(this.nextBackoffDelay())
      }
    }

    this.setStatus('disconnected')
  }

  private buildClient(auth: Awaited<ReturnType<typeof resolveImapAuth>>): ImapFlow {
    return new ImapFlow({
      host: this.account.imapHost,
      port: this.account.imapPort,
      ...imapEncryption(this.account.imapSecure),
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

  private nextBackoffDelay(): number {
    const delay = this.backoffMs
    this.backoffMs = Math.min(
      RECONNECT_BACKOFF_MAX_MS,
      Math.max(RECONNECT_BACKOFF_INITIAL_MS, this.backoffMs * 2)
    )
    return delay
  }

  /** A pause `nudge` and `stop` can cut short. */
  private waitBeforeRetry(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(wake, delayMs)

      function wake(): void {
        clearTimeout(timer)
        resolve()
      }

      this.wakeRetry = () => {
        this.wakeRetry = null
        wake()
      }
    }).finally(() => {
      this.wakeRetry = null
    })
  }

  /**
   * Proves both links are alive with a NOOP each, or tears them down so the
   * loop rebuilds them. With the network up, a link busy with a task is left
   * alone: a dead socket fails that task by itself, and a NOOP queued behind
   * a long download would read as a timeout that never happened. Without a
   * network the links are as good as gone, so the badge says so at once and
   * both are probed regardless, instead of waiting for TCP to notice.
   */
  private async verifyConnection(): Promise<void> {
    const primary = this.primaryClient
    const sync = this.syncClient

    if (!primary || !sync) {
      return
    }

    const offline = !net.isOnline()

    if (offline) {
      this.setStatus('offline')
    }

    const probes = offline
      ? [primary, sync]
      : [this.primaryWorkerActive ? null : primary, this.syncWorkerActive ? null : sync].filter(
          (client): client is ImapFlow => client !== null
        )

    if (probes.length === 0) {
      return
    }

    try {
      await Promise.all(probes.map((client) => this.noopWithin(client, HEALTH_CHECK_TIMEOUT_MS)))
    } catch (error) {
      logMainError('IMAP link failed its health check; reconnecting', error, {
        accountId: this.account.id
      })
      // Closing one client resolves the loop's close watcher, which drops
      // both and reconnects.
      primary.close()
      return
    }

    this.markContact()

    if (this.status === 'offline') {
      this.setStatus('connected')
    }

    this.enqueueFolderPoll('active-sync')
  }

  private async noopWithin(client: ImapFlow, timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined

    try {
      await Promise.race([
        client.noop(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('NOOP timed out')), timeoutMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
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
    await this.reviewFolders({ connecting: true })

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

    if (!preferred) {
      return
    }

    const lock = await this.primaryClient.getMailboxLock(preferred.path)
    try {
      // Lock released immediately; imapflow starts IDLE on the now-selected mailbox.
    } finally {
      lock.release()
    }
  }

  private async syncFolderList(): Promise<MailFolder[]> {
    return this.storeFolderList(selectableMailboxes(await this.listMailboxes()))
  }

  /** The account's folders, each with its status — one command on a server with LIST-STATUS. */
  private async listMailboxes(): Promise<ListResponse[]> {
    const mailboxes = await this.requireSync().list({
      statusQuery: {
        messages: true,
        unseen: true,
        uidValidity: true,
        highestModseq: true,
        uidNext: true
      }
    })

    this.markContact()
    return mailboxes
  }

  /** Stores the folder list the server gave, and tells the views. */
  private async storeFolderList(mailboxes: ReadonlyArray<ListResponse>): Promise<MailFolder[]> {
    await this.database.replaceFolders(
      this.account.id,
      mailboxes.map((mailbox) => this.folderOf(mailbox))
    )
    // Read back rather than emit the server's order: the sidebar must list
    // folders the same way whether it loaded them or was told they changed.
    const folders = await this.database.listFolders(this.account.id)
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

  private folderOf(mailbox: ListResponse): MailFolder {
    return {
      id: `${this.account.id}:${mailbox.path}`,
      accountId: this.account.id,
      path: mailbox.path,
      name: mailbox.name,
      delimiter: mailbox.delimiter,
      // Gmail marks "Importanti" with \Important (RFC 8457), which imapflow
      // does not count among the special uses.
      specialUse:
        mailbox.specialUse ?? (mailbox.flags.has('\\Important') ? '\\Important' : undefined),
      messageCount: mailbox.status?.messages ?? 0,
      unseenCount: mailbox.status?.unseen ?? 0
    }
  }

  /**
   * Compares every folder with what the server reports of it — one LIST,
   * one command for the whole account where the server has LIST-STATUS —
   * and syncs those that changed: on connecting, at each poll, when the
   * user checks for mail. The others only take the counts the server gave.
   */
  private async reviewFolders({ connecting }: { connecting: boolean }): Promise<void> {
    const known = new Map(
      (await this.database.listFolders(this.account.id)).map((folder) => [folder.path, folder])
    )
    const mailboxes = selectableMailboxes(await this.listMailboxes())
    const folders = mailboxes.map((mailbox) => this.folderOf(mailbox))

    // A folder created, removed or renamed elsewhere shows up here.
    if (
      connecting ||
      folders.length !== known.size ||
      folders.some((folder) => {
        const stored = known.get(folder.path)
        return (
          !stored ||
          stored.name !== folder.name ||
          stored.specialUse !== folder.specialUse ||
          stored.delimiter !== folder.delimiter
        )
      })
    ) {
      await this.storeFolderList(mailboxes)
    }

    // The inbox first: it is what the user looks at.
    const ordered = [...mailboxes].sort(
      (left, right) => Number(!isInboxPath(left.path)) - Number(!isInboxPath(right.path))
    )

    for (const mailbox of ordered) {
      const status = mailbox.status
      const folder = known.get(mailbox.path)

      // The server could not say: the next review asks again.
      if (!status) {
        continue
      }

      const state = await this.database.getFolderSyncState(this.account.id, mailbox.path)

      if (!folder || this.folderChanged(folder, status, state)) {
        this.incrementalSyncFolder(
          mailbox.path,
          this.isInSight(mailbox.path) ? 'active-sync' : 'background'
        )
        continue
      }

      // Previews a sync stopped short of filling, the last time.
      if (connecting) {
        this.enqueueHydrationSchedule(mailbox.path)
      }

      if (
        typeof status.messages === 'number' &&
        typeof status.unseen === 'number' &&
        (status.messages !== folder.messageCount || status.unseen !== folder.unseenCount)
      ) {
        await this.database.updateFolderCounts(
          this.account.id,
          mailbox.path,
          status.messages,
          status.unseen
        )
        this.emit('folder-counts', {
          accountId: this.account.id,
          folderPath: mailbox.path,
          messageCount: status.messages,
          unseenCount: status.unseen
        })
      }
    }
  }

  /**
   * Whether a folder's mail changed since it was last synced: never synced,
   * another UIDVALIDITY, another count, a higher UIDNEXT. A change of
   * HIGHESTMODSEQ alone is a change of flags — caught up at once for the
   * folders in sight, and for any other when it is opened. Gmail keeps that
   * number for the whole account, so every folder reports a change at every
   * change anywhere: syncing them all for it read every folder at every poll.
   */
  private folderChanged(
    folder: MailFolder,
    status: StatusObject,
    state: FolderSyncState | null
  ): boolean {
    if (!state?.lastSyncedAt) {
      return true
    }

    if (
      (typeof status.uidValidity === 'bigint' && status.uidValidity !== state.uidValidity) ||
      (typeof status.messages === 'number' && status.messages !== folder.messageCount) ||
      (typeof status.uidNext === 'number' && status.uidNext !== state.uidNext)
    ) {
      return true
    }

    return (
      typeof status.highestModseq === 'bigint' &&
      status.highestModseq !== state.highestModseq &&
      this.isInSight(folder.path)
    )
  }

  /** The inbox, which notifications and Tutti gli account follow, and the folder open. */
  private isInSight(folderPath: string): boolean {
    return (
      isInboxPath(folderPath) ||
      (this.lastActiveContext?.accountId === this.account.id &&
        this.lastActiveContext.folderPath === folderPath)
    )
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
      this.removedUids.delete(folderPath)
      await this.database.resetFolderSyncState(this.account.id, folderPath)
      await this.database.updateFolderSyncState(this.account.id, folderPath, {
        uidValidity: serverUidValidity
      })
    }
  }

  /**
   * Queues a sync of a folder on the sync connection. One already waiting
   * covers this one too — it reads the folder when its turn comes — and
   * takes the higher priority of the two.
   */
  private incrementalSyncFolder(folderPath: string, priority: TaskPriority): void {
    const label = `sync:${folderPath}`
    const waiting = this.syncQueue.find((task) => task.label === label)

    if (waiting) {
      if (PRIORITY_ORDER.indexOf(priority) < PRIORITY_ORDER.indexOf(waiting.priority)) {
        waiting.priority = priority
      }
      return
    }

    // The sync runs at the priority its task has by then.
    const task: QueuedTask = {
      priority,
      label,
      run: () => this.runFolderSync(folderPath, task.priority)
    }

    this.syncQueue.push(task)
    this.startSyncWorkerIfNeeded()
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
    //   * BOOTSTRAP mode — envelope-only batches (no body), the newest
    //     BOOTSTRAP_FIRST_PAGE_SIZE first: the first screen of the list
    //     shows in a moment with subject+sender+date and a "Caricamento
    //     anteprima…" placeholder, and its previews are fetched right after
    //     it, ahead of the thousands of envelopes behind. A separate
    //     HydSched task enqueued below later fills in the newest others
    //     (see EAGER_HYDRATION_LIMIT). This is the only way to keep
    //     first-sync fast when there are thousands of messages — fetching
    //     8 MB of bodies per batch would block the list for minutes.
    //
    //   * INCREMENTAL mode — envelope + first PREVIEW_SOURCE_MAX_BYTES of
    //     source in the SAME FETCH. Every row lands with preview ready. This
    //     is the path for IDLE-pushed new messages and post-reconnect
    //     catchups: notifications fire immediately with the real snippet,
    //     and there is no second round-trip to patch the row later.
    //
    // Smaller batch sizes for incremental because each message carries ~32 KB
    // of body — a 250-batch is ~8 MB on the wire and lands in a second or two.
    // A first sync's thousands of envelopes behind its first screen wait for
    // whatever the user opens meanwhile.
    const bulkPriority: TaskPriority = plan.isBootstrap ? 'background' : priority

    if (plan.newUids.length > 0) {
      if (plan.isBootstrap) {
        this.setFolderBootstrapping(folderPath, true)
      }

      const sortedUids = [...plan.newUids].sort((a, b) => b - a)
      const batches = plan.isBootstrap
        ? [
            sortedUids.slice(0, BOOTSTRAP_FIRST_PAGE_SIZE),
            ...chunk(sortedUids.slice(BOOTSTRAP_FIRST_PAGE_SIZE), BOOTSTRAP_ENVELOPE_BATCH_SIZE)
          ]
        : chunk(sortedUids, INCREMENTAL_BATCH_SIZE)

      batches.forEach((batch, index) => {
        const label = plan.isBootstrap
          ? `envelope-batch:${folderPath}:${index + 1}`
          : `incremental-batch:${folderPath}:${index + 1}`

        this.enqueueSyncCommand(
          async () => {
            await this.processSyncBatch(folderPath, batch, {
              previews: !plan.isBootstrap,
              arrivals: !plan.isBootstrap
            })
          },
          label,
          index === 0 ? priority : bulkPriority
        )

        if (plan.isBootstrap && index === 0) {
          this.queueHydration(folderPath, batch, priority, VISIBLE_HYDRATION_BATCH_SIZE)
        }
      })
    }

    // Finalize: reconciliation + folder state + counts. Runs after all
    // envelope batches at the priority of the last thanks to
    // FIFO-within-priority.
    this.enqueueSyncCommand(
      async () => {
        await this.finalizeFolderSync(folderPath, plan)
      },
      `sync-finalize:${folderPath}`,
      plan.newUids.length > BOOTSTRAP_FIRST_PAGE_SIZE ? bulkPriority : priority
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
    this.enqueueHydrationSchedule(folderPath)
  }

  /**
   * Queues the fill-in of a folder's missing previews, unless a schedule is
   * waiting already: each sync of the folder asks for it. Previews already
   * queued are not queued twice (see `queueHydration`).
   */
  private enqueueHydrationSchedule(folderPath: string): void {
    const label = `hydrate-schedule:${folderPath}`

    if (this.syncQueue.some((task) => task.label === label)) {
      return
    }

    this.enqueueSyncCommand(
      async () => {
        await this.scheduleHydrationForFolder(folderPath)
      },
      label,
      'background'
    )
  }

  private async prepareFolderSyncPlan(folderPath: string): Promise<FolderSyncPlan | null> {
    if (!this.syncClient?.usable) {
      return null
    }

    const client = this.syncClient
    const alreadyOpen = typeof client.mailbox !== 'boolean' && client.mailbox?.path === folderPath
    const lock = await client.getMailboxLock(folderPath)

    try {
      // A folder this connection had open already reports what it last
      // heard of it, which can be seconds behind what the server pushed to
      // the IDLE connection — a move elsewhere then stayed in the list
      // until the next poll. A NOOP brings the pending news in first.
      if (alreadyOpen) {
        await client.noop()
      }

      const mailbox = client.mailbox
      if (!mailbox || typeof mailbox === 'boolean' || mailbox.path !== folderPath) {
        return null
      }

      const serverUidValidity = mailbox.uidValidity as bigint
      const serverHighestModseq = mailbox.highestModseq
      const serverUidNext = mailbox.uidNext
      const exists = mailbox.exists

      const state = await this.database.getFolderSyncState(this.account.id, folderPath)
      if (state?.uidValidity && state.uidValidity !== serverUidValidity) {
        this.removedUids.delete(folderPath)
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
          uidNext: serverUidNext,
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
        uidNext: serverUidNext,
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

  /**
   * Fetches and stores one batch of a folder's messages:
   *   • with their previews in the same FETCH, or as envelopes alone — the
   *     bulk of a first sync, whose previews are filled in afterwards;
   *   • as new arrivals, which notifications announce, or as mail that was
   *     already there: the first sync of a folder, and messages the server
   *     has but the cache lost (see `reconcileLocalAgainstServer`).
   */
  private async processSyncBatch(
    folderPath: string,
    batch: number[],
    { previews, arrivals }: { previews: boolean; arrivals: boolean }
  ): Promise<void> {
    if (!this.syncClient?.usable) {
      return
    }

    const client = this.syncClient
    const lock = await client.getMailboxLock(folderPath)

    try {
      const summaries = await this.fetchSummariesForUids(folderPath, batch, {
        includeBody: previews
      })
      if (summaries.length === 0) {
        return
      }

      const result = await this.database.upsertMessageSummaries(
        this.account.id,
        folderPath,
        summaries
      )
      // Read before they left the folder, written after: they stay out.
      const removed = this.removedUids.get(folderPath)
      const stays = (message: { uid: number }): boolean => !removed?.has(message.uid)
      const gone = summaries.filter((summary) => !stays(summary)).map((summary) => summary.uid)

      if (gone.length > 0) {
        await this.database.deleteMessageUids(this.account.id, folderPath, gone)
      }

      const added = result.added.filter(stays)
      const updated = result.updated.filter(stays)

      if (added.length > 0 || updated.length > 0) {
        this.emit('messages', {
          accountId: this.account.id,
          folderPath,
          added,
          updated,
          removedUids: [],
          bootstrap: !arrivals
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

    // 'background': hydration is cosmetic preview fill-in, it must never
    // outrank any folder's envelope/finalize phase — which is what actually
    // unblocks the UI. See the commentary on the caller in runFolderSync.
    this.queueHydration(
      folderPath,
      unhydratedUids.slice(0, EAGER_HYDRATION_LIMIT),
      'background',
      HYDRATION_BATCH_SIZE
    )
  }

  /**
   * Fills in the previews of rows in view that have none yet — rows older
   * than those filled in ahead — at the priority of what the user looks at.
   */
  hydratePreviews(folderPath: string, uids: ReadonlyArray<number>): void {
    this.queueHydration(folderPath, uids, 'active-sync', VISIBLE_HYDRATION_BATCH_SIZE)
  }

  /** Queues the previews of `uids` not queued already, in batches of `batchSize`. */
  private queueHydration(
    folderPath: string,
    uids: ReadonlyArray<number>,
    priority: TaskPriority,
    batchSize: number
  ): void {
    const key = (uid: number): string => `${folderPath}\u0000${uid}`
    const wanted = uids.filter((uid) => !this.hydratingPreviews.has(key(uid)))

    for (const batch of chunk(wanted, batchSize)) {
      batch.forEach((uid) => this.hydratingPreviews.add(key(uid)))

      this.enqueueSyncCommand(
        async () => {
          try {
            await this.processHydrationBatch(folderPath, batch)
          } finally {
            batch.forEach((uid) => this.hydratingPreviews.delete(key(uid)))
          }
        },
        `hydrate-batch:${folderPath}:${batch[0]}`,
        priority
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
    try {
      await this.writeFolderSyncState(folderPath, plan)
    } finally {
      this.setFolderBootstrapping(folderPath, false)
    }

    if (isInboxPath(folderPath)) {
      await this.prefetchRecentBodies(folderPath)
    }
  }

  private setFolderBootstrapping(folderPath: string, bootstrapping: boolean): void {
    const wasSyncing = this.getState().syncing

    if (bootstrapping) {
      this.bootstrappingFolders.add(folderPath)
    } else {
      this.bootstrappingFolders.delete(folderPath)
    }

    if (this.getState().syncing !== wasSyncing) {
      this.emitState()
    }
  }

  private async writeFolderSyncState(folderPath: string, plan: FolderSyncPlan): Promise<void> {
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
        uidNext: plan.uidNext,
        lastSyncedAt: syncedAt
      })

      const unseenCount = await countUnseen(client)

      await this.database.updateFolderCounts(this.account.id, folderPath, plan.exists, unseenCount)
      this.markContact()

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
      uidNext: plan.uidNext,
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

    // Only the flags are read: what CHANGEDSINCE reports is a change of
    // flags, and an envelope never changes.
    for await (const message of client.fetch(
      { all: true },
      { uid: true, flags: true },
      { uid: true, changedSince: sinceModseq }
    )) {
      if (typeof message.uid !== 'number' || !message.flags) {
        continue
      }

      const flags = [...message.flags]
      const updatedSummary = await this.database.replaceMessageFlags(
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
  ): Promise<FetchedMessageSummary[]> {
    // Shared fetch request — the only difference between bootstrap and
    // incremental mode is whether we ask IMAP for the first 32 KB of source in
    // the same round-trip. For bootstrap (large batches of thousands of msgs)
    // we skip it and defer to the hydration pass, so the initial list
    // populates as fast as possible. For incremental (handful of new msgs)
    // we include it and extract the preview right here, so the row lands in
    // the DB with previewHydrated=true and notifications fire with snippet.
    const fetchedMessages = await this.fetchRequested(this.requireSync(), folderPath, uids, {
      threadId: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
      ...(options.includeBody ? { source: { start: 0, maxLength: PREVIEW_SOURCE_MAX_BYTES } } : {})
    })
    const summaries: FetchedMessageSummary[] = []

    for (const fetched of fetchedMessages.values()) {
      const envelope = fetched.envelope

      // A message is never stored from less than its envelope: without it
      // there is no sender, subject or date to show. It is fetched again by
      // the next sync of the folder.
      if (!envelope) {
        continue
      }

      const flags = [...(fetched.flags ?? new Set<string>())]
      const subject = formatSubject(envelope.subject)

      let preview = ''
      let previewHydrated = false
      if (options.includeBody && fetched.source) {
        try {
          const parsed = await parseMessageSource(fetched.source)
          preview = extractPreview(parsed, subject)
          previewHydrated = true
        } catch {
          // Parse failed on truncated source — leave unhydrated, the hydration
          // pass will try again with a fresh fetch later.
          preview = ''
          previewHydrated = false
        }
      }

      const from = mapAddresses(envelope.from)

      summaries.push({
        accountId: this.account.id,
        folderPath,
        uid: fetched.uid,
        threadId: fetched.threadId,
        messageId: envelope.messageId,
        subject,
        from,
        to: mapAddresses(envelope.to),
        cc: mapAddresses(envelope.cc),
        date: internalDateToIso(fetched.internalDate),
        preview,
        previewHydrated,
        flags,
        isRead: flags.includes('\\Seen'),
        isFlagged: flags.includes('\\Flagged'),
        hasAttachments: hasAttachmentInStructure(fetched.bodyStructure),
        size: fetched.size ?? 0,
        senderName: deriveSenderName(from),
        senderKey: deriveSenderKey(from)
      })
    }

    return summaries
  }

  private async fetchPreviewsForUids(
    folderPath: string,
    uids: number[]
  ): Promise<Array<{ uid: number; preview: string }>> {
    // Partial-body fetch: we grab enough bytes to cover the headers + a usable
    // body prefix. The preview extractor handles truncation and marketing-email
    // boilerplate.
    const fetchedMessages = await this.fetchRequested(this.requireSync(), folderPath, uids, {
      envelope: true,
      source: { start: 0, maxLength: PREVIEW_SOURCE_MAX_BYTES }
    })
    const results: Array<{ uid: number; preview: string }> = []

    for (const fetched of fetchedMessages.values()) {
      if (!fetched.envelope) {
        continue
      }

      const subject = formatSubject(fetched.envelope.subject)
      let preview = subject

      if (fetched.source) {
        try {
          const parsed = await parseMessageSource(fetched.source)
          preview = extractPreview(parsed, subject)
        } catch {
          preview = subject
        }
      }

      results.push({ uid: fetched.uid, preview })
    }

    return results
  }

  /**
   * Makes the cache hold exactly the folder's messages, both ways: rows for
   * messages the server no longer has go, and messages it has but the cache
   * lacks come back. The second way matters on Gmail: archiving moves a
   * message into "Tutti i messaggi", where it already is, and for a moment
   * the folder lists it no more — a reconciliation then drops it, and since
   * its UID is below the highest known one, fetching only new UIDs would
   * never bring it back.
   */
  private async reconcileLocalAgainstServer(folderPath: string): Promise<void> {
    const client = this.requireSync()
    const localUids = await this.database.listAllMessageUids(this.account.id, folderPath)

    if (localUids.length === 0) {
      return
    }

    const serverUids = await client.search({ uid: '1:*' }, { uid: true })
    const serverUidList = Array.isArray(serverUids) ? serverUids : []
    const serverUidSet = new Set(serverUidList)
    const localUidSet = new Set(localUids)
    const staleUids = localUids.filter((uid) => !serverUidSet.has(uid))
    const missingUids = serverUidList
      .filter((uid) => !localUidSet.has(uid))
      .sort((left, right) => right - left)

    // Queued behind this pass, like new arrivals, so the lock is released first.
    for (let index = 0; index < missingUids.length; index += INCREMENTAL_BATCH_SIZE) {
      const batch = missingUids.slice(index, index + INCREMENTAL_BATCH_SIZE)
      this.enqueueSyncCommand(
        async () => {
          await this.processSyncBatch(folderPath, batch, { previews: true, arrivals: false })
        },
        `recovery-batch:${folderPath}:${index / INCREMENTAL_BATCH_SIZE + 1}`,
        'background'
      )
    }

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
    const summary = await this.database.replaceMessageFlags(
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

  /**
   * The folder open, when IDLE watches another one, is looked at again well
   * before the next poll: IDLE pushes changes to one folder only.
   */
  private refreshUnwatchedActiveFolderSoon(): void {
    const idleFolderPath =
      this.primaryClient?.mailbox && typeof this.primaryClient.mailbox !== 'boolean'
        ? this.primaryClient.mailbox.path
        : null
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

  // ───────────────────────────── Primary queue ─────────────────────────────
  // User-initiated operations (click to open, toggle flag, move, delete, send,
  // attachment download, switch active folder). Always 'user' priority — the
  // queue is single-priority by design: we never want a user op to wait behind
  // another user op that hasn't finished yet, and anything that can wait
  // (bodies fetched ahead of time) runs on the sync connection instead.

  private enqueuePrimaryCommand(run: () => Promise<void>, label: string): void {
    this.primaryQueue.push({ priority: 'user', label, run })
    this.startPrimaryWorkerIfNeeded()
  }

  /**
   * Queues something the user is waiting on and settles with its outcome.
   *
   * While the account has no usable connection the operation waits, since
   * a reconnect is usually seconds away, but not for ever: after
   * `USER_OPERATION_CONNECTION_WAIT_MS` without one it leaves the queue and
   * fails, so the interface can undo what it already showed. An account
   * whose credentials were refused fails at once — no reconnect will come.
   */
  private runUserOperation<T>(run: () => Promise<T>, label: string): Promise<T> {
    return this.queuePrimaryOperation(run, label).promise
  }

  /** `runUserOperation`, with its task to withdraw while it still waits. */
  private queuePrimaryOperation<T>(
    run: () => Promise<T>,
    label: string
  ): { promise: Promise<T>; task: QueuedTask } {
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    let waitTimer: ReturnType<typeof setTimeout> | undefined

    const task: QueuedTask = {
      priority: 'user',
      label,
      run: async () => {
        clearTimeout(waitTimer)

        try {
          resolve(await run())
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    if (this.status === 'error' && this.lastError?.authFailed) {
      reject(new Error(`Accesso a ${this.account.email} non riuscito: ricollega l'account.`))
      return { promise, task }
    }

    const checkStillWaiting = (): void => {
      const index = this.primaryQueue.indexOf(task)

      if (index < 0) {
        return
      }

      // Connected but busy with earlier operations: keep its turn.
      if (this.primaryClient?.usable) {
        waitTimer = setTimeout(checkStillWaiting, USER_OPERATION_CONNECTION_WAIT_MS)
        return
      }

      this.primaryQueue.splice(index, 1)
      reject(
        new Error(
          this.status === 'offline'
            ? 'Nessuna connessione a internet: operazione non eseguita.'
            : `Il server di ${this.account.email} non risponde: operazione non eseguita.`
        )
      )
    }

    waitTimer = setTimeout(checkStillWaiting, USER_OPERATION_CONNECTION_WAIT_MS)
    this.primaryQueue.push(task)
    this.startPrimaryWorkerIfNeeded()
    return { promise, task }
  }

  /**
   * Queues work nobody waits on at the screen, such as filing a sent copy.
   * It runs whenever the connection is there, however long that takes.
   */
  private enqueueBackgroundOperation(run: () => Promise<void>, label: string): Promise<void> {
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

  private async runSyncWorker(): Promise<void> {
    try {
      while (this.syncQueue.length > 0) {
        if (!this.syncClient?.usable) {
          this.debugLog(
            `sync worker paused: syncClient not usable (queue=${this.syncQueue.length})`
          )
          break
        }
        const task = pickNextTask(this.syncQueue)
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
