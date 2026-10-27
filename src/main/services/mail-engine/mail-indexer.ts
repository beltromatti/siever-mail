import type { FetchMessageObject, ImapFlow } from 'imapflow'

import type { MailFolder, MailMessageSummary } from '@shared/models'
import { folderRole } from '@shared/folders'

import type { AppDatabase, StoredBodyInput } from '../database'
import { formatUidSet } from './fetch-results'
import { mergeSummaryAndParsedIntoDetail } from './message-mapper'
import { parseMessageSource } from './message-parts'
import {
  buildPartialSource,
  buildPartSource,
  decodedPartSize,
  partHeaderKey,
  planPartialBody,
  type PartialBodyPlan
} from './message-skeleton'

/** Messages read per round: one structure fetch, then a fetch per shape of message. */
const INDEX_BATCH_SIZE = 60
/** A breath between rounds, so the index never crowds the machine or the server. */
const INDEX_ROUND_PAUSE_MS = 150
/** With nothing left to read, how often the indexer looks again on its own. */
const INDEX_IDLE_RECHECK_MS = 60_000
/** A connection that would not open is tried again after this. */
const INDEX_RETRY_DELAY_MS = 30_000
/**
 * A message of a single text part — no structure to pick the text out of —
 * is read up to this much: a few megabytes of HTML newsletter carry no
 * more words worth finding than its first megabyte.
 */
const SINGLE_PART_TEXT_LIMIT = 1024 * 1024

/** Where the indexer stands, for the views. */
export interface IndexProgress {
  /** Messages the account's indexed folders hold. */
  total: number
  /** Those whose words the index has. */
  indexed: number
}

export interface MailIndexerHost {
  accountId: string
  database: AppDatabase
  /** Whether the account's own connection is up: the indexer rests while it is not. */
  isConnected(): boolean
  /** A new connection to the server, for the indexer alone. */
  openClient(): Promise<ImapFlow>
  onRowsUpdated(rows: ReadonlyArray<MailMessageSummary>): void
  onProgress(progress: IndexProgress): void
  onError(message: string, error: unknown): void
}

/**
 * The folders whose messages are indexed. On Gmail every message is in
 * "Tutti i messaggi" whatever its labels, so that folder alone holds them
 * all — each read once — with Bozze beside it. Elsewhere every folder but
 * Spam and the Trash: what was thrown away or never wanted is not what the
 * user, or the Segretario, looks things up in.
 */
export function indexedFolderPaths(folders: ReadonlyArray<MailFolder>): string[] {
  const allMail = folders.find((folder) => folder.specialUse === '\\All')

  if (allMail) {
    return [
      allMail.path,
      ...folders.filter((folder) => folderRole(folder) === '\\Drafts').map((folder) => folder.path)
    ]
  }

  return folders
    .filter((folder) => {
      const role = folderRole(folder)
      return role !== '\\Junk' && role !== '\\Trash'
    })
    .map((folder) => folder.path)
}

interface PlannedMessage {
  messageKey: string
  head: FetchMessageObject
  /** Null for a message of a single part, read whole up to the limit. */
  plan: PartialBodyPlan | null
}

/**
 * Downloads the text of every message of an account, newest first, and
 * keeps it in the cache with its words in the full-text index — so a
 * search, the user's or the Segretario's, never misses a message for not
 * having opened it. It reads on a connection of its own, so the user and
 * the sync never wait behind it, and only the parts that carry text: the
 * files are left on the server until they are opened. A message whose text
 * draws pictures is kept at the text level, and the reader fetches the
 * rest when it is opened; the others are kept as the reader shows them.
 *
 * It picks up where it left off at every launch — what is stored is
 * stored — and rests when there is nothing left, until new mail comes.
 */
export class MailIndexer {
  private client: ImapFlow | null = null
  private running = false
  private loop: Promise<void> | null = null
  private wakeUp: (() => void) | null = null
  /** Messages that could not be read this session: not asked for again until the next. */
  private readonly unreadable = new Set<string>()

  constructor(private readonly host: MailIndexerHost) {}

  start(): void {
    if (this.running) {
      this.poke()
      return
    }

    this.running = true
    this.loop = this.run().catch((error) => {
      this.host.onError('Index loop stopped unexpectedly', error)
    })
  }

  /** Something new may be there to read: an indexer at rest looks now. */
  poke(): void {
    this.wakeUp?.()
  }

  async stop(): Promise<void> {
    this.running = false
    this.poke()
    await this.loop
    this.loop = null
    await this.closeClient()
  }

  private async run(): Promise<void> {
    while (this.running) {
      if (!this.host.isConnected()) {
        await this.closeClient()
        await this.rest(INDEX_RETRY_DELAY_MS)
        continue
      }

      const folders = indexedFolderPaths(await this.host.database.listFolders(this.host.accountId))
      const batch = await this.host.database.listMessagesNeedingBody(
        this.host.accountId,
        folders,
        INDEX_BATCH_SIZE,
        this.unreadable
      )

      if (batch.length === 0) {
        this.host.onProgress(await this.host.database.indexProgress(this.host.accountId, folders))
        await this.rest(INDEX_IDLE_RECHECK_MS)
        continue
      }

      let client: ImapFlow

      try {
        client = await this.openClient()
      } catch (error) {
        this.host.onError('Index connection could not open', error)
        await this.rest(INDEX_RETRY_DELAY_MS)
        continue
      }

      const byFolder = new Map<string, typeof batch>()

      for (const item of batch) {
        const folder = byFolder.get(item.folderPath) ?? []
        folder.push(item)
        byFolder.set(item.folderPath, folder)
      }

      for (const [folderPath, items] of byFolder) {
        if (!this.running) {
          break
        }

        try {
          await this.indexFolderBatch(client, folderPath, items)
        } catch (error) {
          // The connection broke, or the folder went: the next round
          // starts on a fresh connection and whatever is still missing.
          this.host.onError(`Indexing ${folderPath} failed`, error)
          await this.closeClient()
          break
        }
      }

      this.host.onProgress(await this.host.database.indexProgress(this.host.accountId, folders))
      await this.rest(INDEX_ROUND_PAUSE_MS)
    }
  }

  private async indexFolderBatch(
    client: ImapFlow,
    folderPath: string,
    items: ReadonlyArray<{ uid: number; messageKey: string }>
  ): Promise<void> {
    const keyByUid = new Map(items.map((item) => [item.uid, item.messageKey]))
    const lock = await client.getMailboxLock(folderPath, { readOnly: true })
    const entries: Array<{ messageKey: string; level: number; body: StoredBodyInput }> = []

    try {
      const heads = await client.fetchAll(
        formatUidSet([...keyByUid.keys()]),
        {
          uid: true,
          envelope: true,
          internalDate: true,
          size: true,
          flags: true,
          threadId: true,
          emailId: true,
          bodyStructure: true,
          headers: true
        },
        { uid: true }
      )
      const planned: PlannedMessage[] = []

      for (const head of heads) {
        const messageKey = keyByUid.get(head.uid)

        if (!messageKey) {
          continue
        }

        if (!head.bodyStructure || !head.headers || !head.envelope) {
          this.unreadable.add(messageKey)
          continue
        }

        planned.push({
          messageKey,
          head,
          plan: planPartialBody(head.bodyStructure, { pictures: false })
        })
      }

      // Messages of the same shape — the same parts to read — come in one
      // command; a message of a single part comes whole, up to the limit.
      const shapes = new Map<string, PlannedMessage[]>()

      for (const message of planned) {
        const shape = message.plan
          ? JSON.stringify([
              ...message.plan.headerParts.map(partHeaderKey),
              ...message.plan.contentParts
            ])
          : ''
        const sameShape = shapes.get(shape) ?? []
        sameShape.push(message)
        shapes.set(shape, sameShape)
      }

      const contents = new Map<number, FetchMessageObject>()

      for (const [shape, messages] of shapes) {
        const uids = formatUidSet(messages.map((message) => message.head.uid))
        const answers = shape
          ? await client.fetchAll(
              uids,
              { uid: true, bodyParts: JSON.parse(shape) as string[] },
              { uid: true }
            )
          : await client.fetchAll(
              uids,
              { uid: true, source: { start: 0, maxLength: SINGLE_PART_TEXT_LIMIT } },
              { uid: true }
            )

        for (const answer of answers) {
          contents.set(answer.uid, answer)
        }
      }

      for (const message of planned) {
        try {
          const entry = await this.readMessage(folderPath, message, contents.get(message.head.uid))

          if (entry) {
            entries.push(entry)
          } else {
            this.unreadable.add(message.messageKey)
          }
        } catch (error) {
          this.unreadable.add(message.messageKey)
          this.host.onError(`Message ${folderPath}:${message.head.uid} could not be indexed`, error)
        }
      }
    } finally {
      lock.release()
    }

    this.host.onRowsUpdated(
      await this.host.database.storeMessageBodies(this.host.accountId, entries)
    )
  }

  /** One message's text as the index keeps it, from what the server sent of it. */
  private async readMessage(
    folderPath: string,
    { messageKey, head, plan }: PlannedMessage,
    content: FetchMessageObject | undefined
  ): Promise<{ messageKey: string; level: number; body: StoredBodyInput } | null> {
    const headers = head.headers as Buffer
    const structure = head.bodyStructure!
    let source: Buffer
    let complete: boolean

    if (plan) {
      if (!content?.bodyParts) {
        return null
      }

      source = buildPartialSource(headers, structure, content.bodyParts)
      complete = !plan.drawsPictures
    } else if (structure.type.toLowerCase().startsWith('text/')) {
      if (!content?.source) {
        return null
      }

      source = content.source
      complete = content.source.length < SINGLE_PART_TEXT_LIMIT
    } else {
      // A message that is one file and no text: its header says what the
      // file is; its content stays on the server.
      source = buildPartSource(headers, Buffer.alloc(0))
      complete = false
    }

    const detail = mergeSummaryAndParsedIntoDetail(
      this.host.accountId,
      folderPath,
      head,
      await parseMessageSource(source)
    )
    const omitted = plan?.omittedParts

    return {
      messageKey,
      level: complete ? 2 : 1,
      body: {
        ...detail,
        attachments: detail.attachments.map((attachment) => {
          const part = attachment.part ? omitted?.get(attachment.part) : undefined
          return part ? { ...attachment, size: decodedPartSize(part) } : attachment
        })
      }
    }
  }

  private async openClient(): Promise<ImapFlow> {
    if (this.client?.usable) {
      return this.client
    }

    await this.closeClient()
    const client = await this.host.openClient()
    client.on('error', () => undefined)
    client.once('close', () => {
      if (this.client === client) {
        this.client = null
      }
    })
    this.client = client
    return client
  }

  private async closeClient(): Promise<void> {
    const client = this.client
    this.client = null

    if (!client) {
      return
    }

    try {
      await client.logout()
    } catch {
      client.close()
    }
  }

  /** Waits `ms`, or less if poked or stopped. */
  private rest(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)

      function done(): void {
        clearTimeout(timer)
        resolve()
      }

      this.wakeUp = () => {
        this.wakeUp = null
        done()
      }
    })
  }
}
