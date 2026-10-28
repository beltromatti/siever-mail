import { randomUUID } from 'node:crypto'

import { Prisma, type AiTopic, type PrismaClient } from '@prisma/client'

import type { ExtensionTopic } from '@app/extension/types'
import type { Topic } from '@shared/segretario'

import { nameForm, nameForms, saysAnyName } from './topic-names'

/** How many of the extension's topics, the most recent, are offered for every message. */
const CURRENT_EXTENSION_TOPICS = 100
/** A topic a conversation joined within this long is offered for every message. */
const CURRENT_FOR_MS = 120 * 24 * 60 * 60 * 1000

/** A topic as the catalogue the model files conversations against lists it. */
export interface CatalogTopic {
  id: string
  title: string
  description: string | null
  /**
   * Offered for every message: one a conversation joined lately, or among
   * the extension's most recent. The others are offered when named.
   */
  current: boolean
  /** The words that name it in mail, in their compared form (see `nameForm`); none for the Segretario's own. */
  names: string[]
}

/**
 * The topics and which conversations belong to them. A conversation is in
 * one topic at most; the Segretario links it as it reads it, the user can
 * move it, and a link the user made is not undone by the Segretario.
 */
export class TopicStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * The extension's topics as it lists them now: new ones added, the
   * others brought up to date, those it no longer lists forgotten — or
   * closed, when conversations are in them. A topic the Segretario made
   * for what turns out to be one of them joins it.
   */
  async syncExtensionTopics(topics: ReadonlyArray<ExtensionTopic>): Promise<void> {
    const now = BigInt(Date.now())
    const listed = new Set(topics.map((topic) => topic.key))

    for (const [rank, topic] of topics.entries()) {
      const data = {
        title: topic.title,
        description: topic.description ?? null,
        folderPath: topic.folderPath ?? null,
        aliases: topic.aliases?.length ? JSON.stringify(topic.aliases) : null,
        rank
      }

      await this.prisma.aiTopic.upsert({
        where: { externalKey: topic.key },
        create: {
          id: randomUUID(),
          externalKey: topic.key,
          origin: 'extension',
          createdAt: now,
          updatedAt: now,
          ...data
        },
        update: data
      })
    }

    for (const gone of await this.prisma.aiTopic.findMany({
      where: { origin: 'extension', externalKey: { notIn: [...listed] } }
    })) {
      const linked = await this.prisma.aiTopicThread.count({ where: { topicId: gone.id } })

      if (linked === 0) {
        await this.prisma.aiTopic.delete({ where: { id: gone.id } })
      } else if (gone.archivedAt === null) {
        await this.prisma.aiTopic.update({ where: { id: gone.id }, data: { archivedAt: now } })
      }
    }

    await this.joinNamedTopics()
  }

  /**
   * The extension topic a title names, when it names one alone: what the
   * Segretario files a conversation into instead of making a topic of it.
   */
  async extensionTopicNamedBy(title: string): Promise<string | null> {
    const formed = nameForm(title)
    const named = (
      await this.prisma.aiTopic.findMany({
        where: { origin: 'extension', archivedAt: null, aliases: { not: null } },
        select: { id: true, aliases: true }
      })
    ).filter((topic) => saysAnyName(formed, aliasesOf(topic)))

    return named.length === 1 ? named[0].id : null
  }

  /** Topics the Segretario made, folded into the extension topic their title names. */
  private async joinNamedTopics(): Promise<void> {
    const own = await this.prisma.aiTopic.findMany({ where: { origin: 'segretario' } })

    for (const topic of own) {
      const into = await this.extensionTopicNamedBy(topic.title)

      if (into) {
        await this.prisma.$transaction([
          this.prisma.aiTopicThread.updateMany({
            where: { topicId: topic.id },
            data: { topicId: into }
          }),
          this.prisma.aiTopic.update({
            where: { id: into },
            data: { activeAt: topic.activeAt, updatedAt: BigInt(Date.now()) }
          }),
          this.prisma.aiTopic.delete({ where: { id: topic.id } })
        ])
      }
    }
  }

  async createTopic(title: string, origin: 'segretario' | 'utente'): Promise<string> {
    const now = BigInt(Date.now())
    const id = randomUUID()

    await this.prisma.aiTopic.create({
      data: { id, title, origin, activeAt: now, createdAt: now, updatedAt: now }
    })
    return id
  }

  /**
   * The topics conversations can be filed into, in the order they came: a
   * list that only grows at the end, so its keys hold from one message to
   * the next.
   */
  async catalog(): Promise<CatalogTopic[]> {
    const rows = await this.prisma.aiTopic.findMany({
      where: { archivedAt: null },
      orderBy: [{ createdAt: 'asc' }, { rank: 'asc' }, { id: 'asc' }]
    })
    const since = BigInt(Date.now() - CURRENT_FOR_MS)

    return rows.map((topic) => ({
      id: topic.id,
      title: topic.title,
      description: topic.gist ?? topic.description,
      current:
        (topic.activeAt !== null && topic.activeAt >= since) ||
        (topic.rank !== null && topic.rank < CURRENT_EXTENSION_TOPICS),
      names: aliasesOf(topic)
    }))
  }

  async threadTopic(
    accountId: string,
    threadId: string
  ): Promise<{ topic: AiTopic; linkedBy: string } | null> {
    const link = await this.prisma.aiTopicThread.findUnique({
      where: { accountId_threadId: { accountId, threadId } }
    })

    if (!link) {
      return null
    }

    const topic = await this.prisma.aiTopic.findUnique({ where: { id: link.topicId } })
    return topic ? { topic, linkedBy: link.linkedBy } : null
  }

  /**
   * Files a conversation into a topic — or out of any, with null. The
   * Segretario's filing never overrides the user's.
   */
  async link(
    accountId: string,
    threadId: string,
    topicId: string | null,
    by: 'segretario' | 'utente'
  ): Promise<boolean> {
    const current = await this.prisma.aiTopicThread.findUnique({
      where: { accountId_threadId: { accountId, threadId } }
    })

    if (by === 'segretario' && current?.linkedBy === 'utente') {
      return false
    }

    if (topicId === null) {
      await this.prisma.aiTopicThread.deleteMany({ where: { accountId, threadId } })
      await this.dropIfEmpty(current?.topicId)
      return current !== null
    }

    if (current?.topicId === topicId && current.linkedBy === by) {
      return false
    }

    const now = BigInt(Date.now())

    await this.prisma.$transaction([
      this.prisma.aiTopicThread.upsert({
        where: { accountId_threadId: { accountId, threadId } },
        create: { accountId, threadId, topicId, linkedBy: by, createdAt: now },
        update: { topicId, linkedBy: by }
      }),
      this.prisma.aiTopic.update({
        where: { id: topicId },
        data: { activeAt: now, updatedAt: now }
      })
    ])

    if (current && current.topicId !== topicId) {
      await this.dropIfEmpty(current.topicId)
    }

    return true
  }

  /** A topic the Segretario made, left without conversations, was a guess: it goes. */
  private async dropIfEmpty(topicId: string | undefined): Promise<void> {
    if (!topicId || (await this.prisma.aiTopicThread.count({ where: { topicId } })) > 0) {
      return
    }

    await this.prisma.aiTopic.deleteMany({ where: { id: topicId, origin: 'segretario' } })
  }

  /** The topic each conversation is in, in the order asked; null for one in none. */
  async topicIdsOf(
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ): Promise<Array<string | null>> {
    if (threads.length === 0) {
      return []
    }

    const links = await this.prisma.aiTopicThread.findMany({
      where: { OR: threads.map(({ accountId, threadId }) => ({ accountId, threadId })) },
      select: { accountId: true, threadId: true, topicId: true }
    })
    const byThread = new Map(
      links.map((link) => [`${link.accountId}\u0000${link.threadId}`, link.topicId])
    )

    return threads.map(
      ({ accountId, threadId }) => byThread.get(`${accountId}\u0000${threadId}`) ?? null
    )
  }

  /** The conversations of a topic among some accounts'. */
  async threadsOf(
    topicId: string,
    accountIds: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; threadId: string }>> {
    return this.prisma.aiTopicThread.findMany({
      where: { topicId, accountId: { in: [...accountIds] } },
      select: { accountId: true, threadId: true }
    })
  }

  async getTopic(id: string): Promise<AiTopic | null> {
    return this.prisma.aiTopic.findUnique({ where: { id } })
  }

  /**
   * Every topic with how many conversations it holds among some accounts',
   * what is open in them and when the last of them moved — the busiest
   * and most recent first.
   */
  async listTopics(accountIds: ReadonlyArray<string>): Promise<Topic[]> {
    const topics = await this.prisma.aiTopic.findMany()

    if (topics.length === 0 || accountIds.length === 0) {
      return topics.map((topic) => topicOf(topic, 0, 0, null))
    }

    const counts = await this.prisma.$queryRaw<
      Array<{
        topicId: string
        conversations: bigint
        openCommitments: bigint
        lastActivity: string | null
      }>
    >`
      SELECT t.topic_id AS topicId,
        COUNT(*) AS conversations,
        COALESCE(SUM((
          SELECT COUNT(*) FROM ai_items i
          WHERE i.account_id = t.account_id AND i.thread_id = t.thread_id AND i.status = 'aperto'
        )), 0) AS openCommitments,
        MAX((
          SELECT MAX(n.message_date) FROM ai_notes n
          WHERE n.account_id = t.account_id AND n.thread_id = t.thread_id
        )) AS lastActivity
      FROM ai_topic_threads t
      WHERE t.account_id IN (${Prisma.join([...accountIds])})
      GROUP BY t.topic_id
    `
    const byTopic = new Map(counts.map((row) => [row.topicId, row]))

    return topics
      .map((topic) => {
        const row = byTopic.get(topic.id)
        return topicOf(
          topic,
          Number(row?.conversations ?? 0),
          Number(row?.openCommitments ?? 0),
          row?.lastActivity ? Date.parse(row.lastActivity) : null
        )
      })
      .sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) ||
          a.title.localeCompare(b.title)
      )
  }

  /**
   * The topics whose gist is missing or outgrown: those with conversations
   * and none yet, or twice as many as when it was written.
   */
  async needingGist(): Promise<Array<{ id: string; conversations: number }>> {
    const counts = await this.prisma.aiTopicThread.groupBy({ by: ['topicId'], _count: true })
    const topics = new Map(
      (
        await this.prisma.aiTopic.findMany({
          where: { id: { in: counts.map((row) => row.topicId) }, archivedAt: null },
          select: { id: true, gist: true, gistConversations: true }
        })
      ).map((topic) => [topic.id, topic])
    )

    return counts.flatMap(({ topicId, _count: conversations }) => {
      const topic = topics.get(topicId)
      const outgrown =
        topic?.gistConversations !== null &&
        topic?.gistConversations !== undefined &&
        conversations >= topic.gistConversations * 2 &&
        conversations - topic.gistConversations >= 2

      return topic && (topic.gist === null || outgrown) ? [{ id: topicId, conversations }] : []
    })
  }

  async setGist(id: string, gist: string, conversations: number): Promise<void> {
    await this.prisma.aiTopic.update({
      where: { id },
      data: { gist, gistConversations: conversations }
    })
  }

  async setState(id: string, state: string): Promise<void> {
    await this.prisma.aiTopic.update({
      where: { id },
      data: { state, stateAt: BigInt(Date.now()) }
    })
  }

  async update(id: string, change: { title?: string; archived?: boolean }): Promise<void> {
    await this.prisma.aiTopic.update({
      where: { id },
      data: {
        ...(change.title !== undefined ? { title: change.title } : {}),
        ...(change.archived !== undefined
          ? { archivedAt: change.archived ? BigInt(Date.now()) : null }
          : {}),
        updatedAt: BigInt(Date.now())
      }
    })
  }

  /** An account was removed: its conversations leave their topics. */
  async forgetAccount(accountId: string): Promise<void> {
    await this.prisma.aiTopicThread.deleteMany({ where: { accountId } })
  }

  async clear(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiTopicThread.deleteMany(),
      this.prisma.aiTopic.deleteMany()
    ])
  }
}

function aliasesOf(topic: Pick<AiTopic, 'aliases'>): string[] {
  return topic.aliases ? nameForms(JSON.parse(topic.aliases) as string[]) : []
}

function topicOf(
  topic: AiTopic,
  conversations: number,
  openCommitments: number,
  lastActivityAt: number | null
): Topic {
  return {
    id: topic.id,
    title: topic.title,
    description: topic.description,
    folderPath: topic.folderPath,
    origin: topic.origin === 'extension' || topic.origin === 'utente' ? topic.origin : 'segretario',
    externalKey: topic.externalKey,
    gist: topic.gist,
    state: topic.state,
    stateAt: topic.stateAt === null ? null : Number(topic.stateAt),
    lastActivityAt,
    conversations,
    openCommitments,
    archived: topic.archivedAt !== null
  }
}
