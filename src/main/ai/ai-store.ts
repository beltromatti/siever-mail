import type { PrismaClient } from '@prisma/client'

import { Prisma, type AiItem, type AiNote } from '@prisma/client'

import type { SegretarioView } from '@shared/folders'

import {
  DEFAULT_SEGRETARIO_PREFERENCES,
  type ActivityKind,
  type Commitment,
  type CommitmentKind,
  type MessageNote,
  type NotePriority,
  type NoteState,
  type ThreadBrief,
  type ActivityStatus,
  type ActivitySummary,
  type SegretarioPreferences,
  type SegretarioStatus
} from '@shared/segretario'

import { decryptSecret, encryptSecret } from '../services/secure-storage'
import type { ChatUsage } from './openrouter'

const SETTINGS_ID = 1

/** An event of an activity as it is stored: its type and what it carries. */
export interface StoredEvent<T = unknown> {
  id: number
  type: string
  payload: T
  createdAt: number
}

export interface MemoryDocument {
  path: string
  content: string
  createdAt: number
  updatedAt: number
}

/** What the user owes in a conversation, as opposed to what they wait for. */
const OWED_KINDS: ReadonlyArray<CommitmentKind> = ['ti_chiedono', 'hai_promesso', 'da_fare']

function noteOf(row: AiNote): MessageNote {
  return {
    accountId: row.accountId,
    messageKey: row.messageKey,
    threadId: row.threadId,
    direction: row.direction === 'out' ? 'out' : 'in',
    summary: row.summary,
    state: row.state as NoteState,
    priority: row.priority as NotePriority,
    reason: row.reason,
    due: row.due,
    messageDate: row.messageDate,
    dismissedAt: row.dismissedAt === null ? null : Number(row.dismissedAt)
  }
}

function commitmentOf(row: AiItem): Commitment {
  return {
    id: row.id,
    accountId: row.accountId,
    threadId: row.threadId,
    messageKey: row.messageKey,
    kind: row.kind as CommitmentKind,
    text: row.text,
    due: row.due,
    status: row.status === 'chiuso' ? 'chiuso' : 'aperto',
    createdAt: Number(row.createdAt),
    closedAt: row.closedAt === null ? null : Number(row.closedAt),
    closedBy: row.closedBy === 'utente' || row.closedBy === 'segretario' ? row.closedBy : null
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/**
 * The Segretario's own tables: its settings and key, what it cost, its
 * activities and their logs, its memory. User data — kept across updates,
 * emptied by "Elimina tutti i dati" except the key and the settings.
 */
export class AiStore {
  constructor(private readonly prisma: PrismaClient) {}

  /* ─────────────────────────── settings and key ─────────────────────────── */

  async getApiKey(): Promise<string | null> {
    const row = await this.prisma.aiSettings.findUnique({ where: { id: SETTINGS_ID } })
    return row?.encryptedApiKey ? decryptSecret(row.encryptedApiKey) : null
  }

  async setApiKey(key: string | null, status: SegretarioStatus): Promise<void> {
    const data = {
      encryptedApiKey: key ? encryptSecret(key) : null,
      keyStatusJson: JSON.stringify(status),
      updatedAt: BigInt(Date.now())
    }

    await this.prisma.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data
    })
  }

  async getStoredStatus(): Promise<SegretarioStatus | null> {
    const row = await this.prisma.aiSettings.findUnique({ where: { id: SETTINGS_ID } })
    return row ? parseJson<SegretarioStatus | null>(row.keyStatusJson, null) : null
  }

  async setStoredStatus(status: SegretarioStatus): Promise<void> {
    await this.prisma.aiSettings.updateMany({
      where: { id: SETTINGS_ID },
      data: { keyStatusJson: JSON.stringify(status), updatedAt: BigInt(Date.now()) }
    })
  }

  async getPreferences(): Promise<SegretarioPreferences> {
    const row = await this.prisma.aiSettings.findUnique({ where: { id: SETTINGS_ID } })
    return {
      ...DEFAULT_SEGRETARIO_PREFERENCES,
      ...(row ? parseJson<Partial<SegretarioPreferences>>(row.preferencesJson, {}) : {})
    }
  }

  async setPreferences(preferences: SegretarioPreferences): Promise<SegretarioPreferences> {
    const data = { preferencesJson: JSON.stringify(preferences), updatedAt: BigInt(Date.now()) }

    await this.prisma.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data
    })

    return this.getPreferences()
  }

  /* ──────────────────────────────── usage ──────────────────────────────── */

  async recordUsage(entry: {
    activityId: string | null
    purpose: string
    model: string | null
    provider: string | null
    usage: ChatUsage
  }): Promise<void> {
    await this.prisma.aiUsage.create({
      data: {
        createdAt: BigInt(Date.now()),
        activityId: entry.activityId,
        purpose: entry.purpose,
        model: entry.model,
        provider: entry.provider,
        promptTokens: entry.usage.promptTokens,
        cachedTokens: entry.usage.cachedTokens,
        completionTokens: entry.usage.completionTokens,
        reasoningTokens: entry.usage.reasoningTokens,
        cost: entry.usage.cost
      }
    })

    if (entry.activityId) {
      await this.prisma.aiActivity.updateMany({
        where: { id: entry.activityId },
        data: { cost: { increment: entry.usage.cost } }
      })
    }
  }

  /** What was spent since `since`, in dollars. */
  async spentSince(since: number): Promise<number> {
    const total = await this.prisma.aiUsage.aggregate({
      where: { createdAt: { gte: BigInt(since) } },
      _sum: { cost: true }
    })

    return total._sum.cost ?? 0
  }

  /* ───────────────────────────── activities ───────────────────────────── */

  async createActivity(activity: {
    id: string
    kind: ActivityKind
    title: string
    status: ActivityStatus
  }): Promise<ActivitySummary> {
    const now = BigInt(Date.now())
    const row = await this.prisma.aiActivity.create({
      data: { ...activity, createdAt: now, updatedAt: now }
    })

    return this.summaryOf(row)
  }

  async updateActivity(
    id: string,
    changes: Partial<{ title: string; status: ActivityStatus; unseen: boolean }>
  ): Promise<ActivitySummary | null> {
    const rows = await this.prisma.aiActivity.updateMany({
      where: { id },
      data: { ...changes, updatedAt: BigInt(Date.now()) }
    })

    return rows.count > 0 ? this.getActivity(id) : null
  }

  async getActivity(id: string): Promise<ActivitySummary | null> {
    const row = await this.prisma.aiActivity.findUnique({ where: { id } })
    return row ? this.summaryOf(row) : null
  }

  async listActivities(): Promise<ActivitySummary[]> {
    const rows = await this.prisma.aiActivity.findMany({ orderBy: { updatedAt: 'desc' } })
    return rows.map((row) => this.summaryOf(row))
  }

  async deleteActivity(id: string): Promise<void> {
    await this.prisma.aiActivity.deleteMany({ where: { id } })
  }

  /** Activities a quit left at work: they cannot go on, and say so. */
  async listUnfinished(): Promise<ActivitySummary[]> {
    const rows = await this.prisma.aiActivity.findMany({
      where: { status: { in: ['running', 'waiting'] } }
    })
    return rows.map((row) => this.summaryOf(row))
  }

  async appendEvent<T>(activityId: string, type: string, payload: T): Promise<StoredEvent<T>> {
    const now = Date.now()
    const row = await this.prisma.aiEvent.create({
      data: {
        activityId,
        type,
        payloadJson: JSON.stringify(payload),
        createdAt: BigInt(now)
      }
    })

    await this.prisma.aiActivity.updateMany({
      where: { id: activityId },
      data: { updatedAt: BigInt(now) }
    })

    return { id: row.id, type, payload, createdAt: now }
  }

  /** Replaces what an event carries: a tool's line once it finished, a confirmation once given. */
  async updateEvent<T>(id: number, payload: T): Promise<void> {
    await this.prisma.aiEvent.update({
      where: { id },
      data: { payloadJson: JSON.stringify(payload) }
    })
  }

  async listEvents(activityId: string): Promise<StoredEvent[]> {
    const rows = await this.prisma.aiEvent.findMany({
      where: { activityId },
      orderBy: { id: 'asc' }
    })

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: parseJson<unknown>(row.payloadJson, null),
      createdAt: Number(row.createdAt)
    }))
  }

  private summaryOf(row: {
    id: string
    kind: string
    title: string
    status: string
    createdAt: bigint
    updatedAt: bigint
    unseen: boolean
    cost: number
  }): ActivitySummary {
    return {
      id: row.id,
      kind: row.kind as ActivityKind,
      title: row.title,
      status: row.status as ActivityStatus,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      unseen: row.unseen,
      cost: row.cost
    }
  }

  /* ──────────────────────────────── memory ──────────────────────────────── */

  async listMemory(): Promise<MemoryDocument[]> {
    const rows = await this.prisma.aiMemory.findMany({ orderBy: { path: 'asc' } })
    return rows.map((row) => ({
      path: row.path,
      content: row.content,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }))
  }

  async readMemory(path: string): Promise<MemoryDocument | null> {
    const row = await this.prisma.aiMemory.findUnique({ where: { path } })

    if (!row) {
      return null
    }

    await this.prisma.aiMemory.update({ where: { path }, data: { readAt: BigInt(Date.now()) } })
    return {
      path: row.path,
      content: row.content,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }
  }

  async writeMemory(path: string, content: string): Promise<void> {
    const now = BigInt(Date.now())

    await this.prisma.aiMemory.upsert({
      where: { path },
      create: { path, content, createdAt: now, updatedAt: now, readAt: now },
      update: { content, updatedAt: now }
    })
  }

  async deleteMemory(path: string): Promise<boolean> {
    const result = await this.prisma.aiMemory.deleteMany({ where: { path } })
    return result.count > 0
  }

  async renameMemory(from: string, to: string): Promise<void> {
    await this.prisma.aiMemory.update({
      where: { path: from },
      data: { path: to, updatedAt: BigInt(Date.now()) }
    })
  }

  async clearMemory(): Promise<void> {
    await this.prisma.aiMemory.deleteMany()
  }

  /* ───────────────────────── getting to know the user ───────────────────────── */

  async listLearning(): Promise<
    Array<{ accountId: string; activityId: string | null; finishedAt: number | null }>
  > {
    const rows = await this.prisma.aiLearning.findMany()
    return rows.map((row) => ({
      accountId: row.accountId,
      activityId: row.activityId,
      finishedAt: row.finishedAt === null ? null : Number(row.finishedAt)
    }))
  }

  async startLearning(accountId: string, activityId: string): Promise<void> {
    const data = { activityId, startedAt: BigInt(Date.now()), finishedAt: null }

    await this.prisma.aiLearning.upsert({
      where: { accountId },
      create: { accountId, ...data },
      update: data
    })
  }

  /** The activity that got to know an account ended: done, or to begin again another time. */
  async endLearning(activityId: string, done: boolean): Promise<void> {
    if (done) {
      await this.prisma.aiLearning.updateMany({
        where: { activityId },
        data: { finishedAt: BigInt(Date.now()) }
      })
    } else {
      await this.prisma.aiLearning.deleteMany({ where: { activityId, finishedAt: null } })
    }
  }

  /** Forgets that an account, or all of them, were got to know. */
  async resetLearning(accountId?: string): Promise<void> {
    await this.prisma.aiLearning.deleteMany(accountId ? { where: { accountId } } : undefined)
  }

  /* ──────────────────────── lessons for the reflection ──────────────────────── */

  async addLesson(kind: string, payload: unknown): Promise<void> {
    await this.prisma.aiLesson.create({
      data: { kind, payloadJson: JSON.stringify(payload), createdAt: BigInt(Date.now()) }
    })
  }

  /** The lessons no reflection has taken in yet, the oldest first. */
  async pendingLessons(): Promise<
    Array<{ id: number; kind: string; payload: unknown; createdAt: number }>
  > {
    const rows = await this.prisma.aiLesson.findMany({
      where: { reflectionId: null },
      orderBy: { id: 'asc' }
    })
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payloadJson) as unknown,
      createdAt: Number(row.createdAt)
    }))
  }

  async claimLessons(ids: number[], reflectionId: string): Promise<void> {
    await this.prisma.aiLesson.updateMany({ where: { id: { in: ids } }, data: { reflectionId } })
  }

  /** A reflection ended: what it took in is kept as learnt, or handed to the next one. */
  async endReflection(reflectionId: string, done: boolean): Promise<void> {
    if (done) {
      await this.prisma.aiLesson.deleteMany({ where: { reflectionId } })
    } else {
      await this.prisma.aiLesson.updateMany({
        where: { reflectionId },
        data: { reflectionId: null }
      })
    }
  }

  /** When the last reflection began, epoch ms; null if none has. */
  async lastReflectionAt(): Promise<number | null> {
    const row = await this.prisma.aiActivity.findFirst({
      where: { kind: 'riflessione' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    })
    return row ? Number(row.createdAt) : null
  }

  /* ───────────────────────── the drafts it wrote ───────────────────────── */

  async recordDraft(draft: {
    draftId: string
    activityId: string
    accountId: string
    text: string
  }): Promise<void> {
    const data = { ...draft, createdAt: BigInt(Date.now()) }

    await this.prisma.aiDraft.upsert({
      where: { draftId: draft.draftId },
      create: data,
      update: data
    })
  }

  /** A draft the Segretario wrote, taken out of the record: it has been sent or thrown away. */
  async takeDraft(
    draftId: string
  ): Promise<{ activityId: string; accountId: string; text: string } | null> {
    const row = await this.prisma.aiDraft.findUnique({ where: { draftId } })

    if (!row) {
      return null
    }

    await this.prisma.aiDraft.delete({ where: { draftId } })
    return { activityId: row.activityId, accountId: row.accountId, text: row.text }
  }

  async pruneDrafts(olderThan: number): Promise<void> {
    await this.prisma.aiDraft.deleteMany({ where: { createdAt: { lt: BigInt(olderThan) } } })
  }

  /* ─────────────────────────── notes on the mail ─────────────────────────── */

  /**
   * What triage made of a message: its note, the things it opened in the
   * conversation and those it closed — only ever this conversation's.
   */
  async saveTriage(
    note: Omit<MessageNote, 'dismissedAt'>,
    opened: ReadonlyArray<{ kind: CommitmentKind; text: string; due: string | null }>,
    closedIds: ReadonlyArray<number>
  ): Promise<void> {
    const now = BigInt(Date.now())
    const data = { ...note, createdAt: now, dismissedAt: null }

    await this.prisma.$transaction([
      this.prisma.aiNote.upsert({
        where: { accountId_messageKey: { accountId: note.accountId, messageKey: note.messageKey } },
        create: data,
        update: data
      }),
      this.prisma.aiItem.createMany({
        data: opened.map((item) => ({
          accountId: note.accountId,
          threadId: note.threadId,
          messageKey: note.messageKey,
          kind: item.kind,
          text: item.text,
          due: item.due,
          status: 'aperto',
          createdAt: now
        }))
      }),
      this.prisma.aiItem.updateMany({
        where: {
          id: { in: [...closedIds] },
          accountId: note.accountId,
          threadId: note.threadId,
          status: 'aperto'
        },
        data: { status: 'chiuso', closedAt: now, closedBy: 'segretario' }
      })
    ])
  }

  async getNotes(
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<MessageNote[]> {
    const byAccount = new Map<string, string[]>()

    for (const message of messages) {
      byAccount.set(message.accountId, [
        ...(byAccount.get(message.accountId) ?? []),
        message.messageKey
      ])
    }

    const rows = await Promise.all(
      [...byAccount].map(([accountId, keys]) =>
        this.prisma.aiNote.findMany({ where: { accountId, messageKey: { in: keys } } })
      )
    )
    return rows.flat().map(noteOf)
  }

  /** A conversation's latest note and what is open in it, then what closed lately. */
  async threadBrief(accountId: string, threadId: string): Promise<ThreadBrief> {
    const [note, items] = await Promise.all([
      this.prisma.aiNote.findFirst({
        where: { accountId, threadId },
        orderBy: { messageDate: 'desc' }
      }),
      this.prisma.aiItem.findMany({
        where: { accountId, threadId },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }]
      })
    ])

    return { note: note ? noteOf(note) : null, commitments: items.map(commitmentOf) }
  }

  async openCommitments(accountId: string, threadId: string): Promise<Commitment[]> {
    const rows = await this.prisma.aiItem.findMany({
      where: { accountId, threadId, status: 'aperto' },
      orderBy: { createdAt: 'asc' }
    })
    return rows.map(commitmentOf)
  }

  /** The user closed something open; its conversation, for the views to refresh. */
  async closeCommitment(id: number): Promise<{ accountId: string; threadId: string } | null> {
    const row = await this.prisma.aiItem.findUnique({ where: { id } })

    if (!row) {
      return null
    }

    await this.prisma.aiItem.update({
      where: { id },
      data: { status: 'chiuso', closedAt: BigInt(Date.now()), closedBy: 'utente' }
    })
    return { accountId: row.accountId, threadId: row.threadId }
  }

  /**
   * The user handled a conversation: its note stops asking, and what the
   * user owed in it — asked of them, promised, to do — is closed. What they
   * wait for stays open.
   */
  async dismissNote(accountId: string, messageKey: string): Promise<MessageNote | null> {
    const row = await this.prisma.aiNote.findUnique({
      where: { accountId_messageKey: { accountId, messageKey } }
    })

    if (!row) {
      return null
    }

    const now = BigInt(Date.now())
    const [note] = await this.prisma.$transaction([
      this.prisma.aiNote.update({
        where: { accountId_messageKey: { accountId, messageKey } },
        data: { dismissedAt: now }
      }),
      this.prisma.aiItem.updateMany({
        where: {
          accountId,
          threadId: row.threadId,
          status: 'aperto',
          kind: { in: [...OWED_KINDS] }
        },
        data: { status: 'chiuso', closedAt: now, closedBy: 'utente' }
      })
    ])
    return noteOf(note)
  }

  /**
   * The conversations a view of the Segretario's holds, by the message of
   * each its latest note is for: `da-gestire` when that note asks a reply
   * or an action and was not handled, or something the user owes is open;
   * `in-attesa` when it waits on someone, or something awaited is open.
   */
  async viewMessages(
    view: SegretarioView,
    accountIds: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; messageKey: string }>> {
    if (accountIds.length === 0) {
      return []
    }

    const states = view === 'da-gestire' ? ['da_rispondere', 'da_fare'] : ['in_attesa']
    const kinds = view === 'da-gestire' ? [...OWED_KINDS] : ['aspetti']

    return this.prisma.$queryRaw<Array<{ accountId: string; messageKey: string }>>`
      WITH latest AS (
        SELECT n.account_id, n.thread_id, n.message_key, n.state, n.dismissed_at
        FROM ai_notes n
        WHERE n.account_id IN (${Prisma.join([...accountIds])})
          AND n.message_date = (
            SELECT MAX(o.message_date) FROM ai_notes o
            WHERE o.account_id = n.account_id AND o.thread_id = n.thread_id
          )
      )
      SELECT l.account_id AS accountId, l.message_key AS messageKey
      FROM latest l
      WHERE (l.dismissed_at IS NULL AND l.state IN (${Prisma.join(states)}))
        OR EXISTS (
          SELECT 1 FROM ai_items i
          WHERE i.account_id = l.account_id AND i.thread_id = l.thread_id
            AND i.status = 'aperto' AND i.kind IN (${Prisma.join(kinds)})
        )
    `
  }

  /** An account was removed: what the Segretario kept about it alone goes with it. */
  async forgetAccount(accountId: string, accountNotePath: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiLearning.deleteMany({ where: { accountId } }),
      this.prisma.aiDraft.deleteMany({ where: { accountId } }),
      this.prisma.aiNote.deleteMany({ where: { accountId } }),
      this.prisma.aiItem.deleteMany({ where: { accountId } }),
      this.prisma.aiMemory.deleteMany({ where: { path: accountNotePath } })
    ])
  }

  /** Everything but the key and the settings: what "Elimina tutti i dati" empties. */
  async clearData(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiEvent.deleteMany(),
      this.prisma.aiActivity.deleteMany(),
      this.prisma.aiMemory.deleteMany(),
      this.prisma.aiUsage.deleteMany(),
      this.prisma.aiLearning.deleteMany(),
      this.prisma.aiLesson.deleteMany(),
      this.prisma.aiDraft.deleteMany(),
      this.prisma.aiNote.deleteMany(),
      this.prisma.aiItem.deleteMany()
    ])
  }
}
