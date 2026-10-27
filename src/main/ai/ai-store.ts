import type { PrismaClient } from '@prisma/client'

import {
  DEFAULT_SEGRETARIO_PREFERENCES,
  type ActivityKind,
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

  /** Everything but the key and the settings: what "Elimina tutti i dati" empties. */
  async clearData(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiEvent.deleteMany(),
      this.prisma.aiActivity.deleteMany(),
      this.prisma.aiMemory.deleteMany(),
      this.prisma.aiUsage.deleteMany()
    ])
  }
}
