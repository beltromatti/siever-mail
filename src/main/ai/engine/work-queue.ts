import { randomUUID } from 'node:crypto'

import { placeholders, type Sql } from '../sql'

/**
 * `in_coda` waiting for its turn; `al_lavoro` running; `fatto`;
 * `da_riprovare` after a failure, from `notBefore`; `fallito` after too
 * many; `annullato`.
 */
export type WorkStatus =
  'in_coda' | 'al_lavoro' | 'fatto' | 'da_riprovare' | 'fallito' | 'annullato'

const WAITING: ReadonlyArray<WorkStatus> = ['in_coda', 'da_riprovare']

export interface WorkUnit<Scope = unknown> {
  id: string
  /** The task it is for: `lettura`, `giornata`, `punto`… */
  task: string
  /** What makes two units the same work: one waits per scope, what comes for it joins it. */
  scopeKey: string
  scope: Scope
  /** Lower comes first. */
  priority: number
  status: WorkStatus
  attempts: number
  notBefore: number
  activityId: string | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

interface WorkRow {
  id: string
  task: string
  scope_key: string
  scope_json: string
  priority: number
  status: string
  attempts: number
  not_before: number
  activity_id: string | null
  last_error: string | null
  created_at: number
  updated_at: number
}

function unitOf<Scope>(row: WorkRow): WorkUnit<Scope> {
  return {
    id: row.id,
    task: row.task,
    scopeKey: row.scope_key,
    scope: JSON.parse(row.scope_json) as Scope,
    priority: Number(row.priority),
    status: row.status as WorkStatus,
    attempts: Number(row.attempts),
    notBefore: Number(row.not_before),
    activityId: row.activity_id,
    lastError: row.last_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

/** How long a failed unit waits before it is tried again, by how many times it failed. */
export function retryDelayMs(attempts: number): number {
  return [60_000, 5 * 60_000, 30 * 60_000][Math.min(Math.max(attempts - 1, 0), 2)]
}

/**
 * The Segretario's work, kept in the database: what is to be done, by
 * whom, from when. It survives a quit — what was running is waiting again
 * at the next start — and holds one waiting unit per scope, so three
 * messages of a conversation that arrive together are one reading.
 */
export class WorkQueue {
  constructor(private readonly sql: Sql) {}

  /**
   * Asks for work. If a unit for the same scope is already waiting, it is
   * that one: its scope is merged with the new one, it moves to the more
   * urgent priority, and — for work that gathers what comes in a burst —
   * its start moves to `delayMs` from now.
   */
  async enqueue<Scope>(input: {
    task: string
    scopeKey: string
    scope: Scope
    priority: number
    delayMs?: number
    merge?: (waiting: Scope, incoming: Scope) => Scope
  }): Promise<WorkUnit<Scope>> {
    const now = Date.now()
    const notBefore = now + (input.delayMs ?? 0)

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const waiting = await this.waitingFor<Scope>(input.scopeKey)

      if (waiting) {
        const scope = input.merge ? input.merge(waiting.scope, input.scope) : input.scope
        const changed = await this.sql.run(
          `UPDATE ai_work SET scope_json = ?, priority = MIN(priority, ?),
             not_before = CASE WHEN status = 'in_coda' THEN MAX(not_before, ?) ELSE not_before END,
             updated_at = ?
           WHERE id = ? AND status IN (${placeholders(WAITING)})`,
          JSON.stringify(scope),
          input.priority,
          notBefore,
          now,
          waiting.id,
          ...WAITING
        )

        if (changed === 1) {
          return (await this.get<Scope>(waiting.id))!
        }

        // It started meanwhile: what came now is a new unit.
        continue
      }

      try {
        const id = randomUUID()
        await this.sql.run(
          `INSERT INTO ai_work (
            id, task, scope_key, scope_json, priority, status, attempts, not_before, activity_id,
            last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'in_coda', 0, ?, NULL, NULL, ?, ?)`,
          id,
          input.task,
          input.scopeKey,
          JSON.stringify(input.scope),
          input.priority,
          notBefore,
          now,
          now
        )
        return (await this.get<Scope>(id))!
      } catch (error) {
        // Another caller queued the same scope between the look and the write.
        if (!String(error).includes('UNIQUE')) {
          throw error
        }
      }
    }

    throw new Error(`Could not queue work for ${input.scopeKey}.`)
  }

  async get<Scope = unknown>(id: string): Promise<WorkUnit<Scope> | null> {
    const row = await this.sql.get<WorkRow>('SELECT * FROM ai_work WHERE id = ?', id)
    return row ? unitOf<Scope>(row) : null
  }

  async waitingFor<Scope = unknown>(scopeKey: string): Promise<WorkUnit<Scope> | null> {
    const row = await this.sql.get<WorkRow>(
      `SELECT * FROM ai_work WHERE scope_key = ? AND status IN (${placeholders(WAITING)})`,
      scopeKey,
      ...WAITING
    )
    return row ? unitOf<Scope>(row) : null
  }

  /** The units that may start now, the most urgent first, then the oldest. */
  async ready(limit: number, now = Date.now()): Promise<WorkUnit[]> {
    const rows = await this.sql.all<WorkRow>(
      `SELECT * FROM ai_work WHERE status IN (${placeholders(WAITING)}) AND not_before <= ?
       ORDER BY priority, created_at LIMIT ?`,
      ...WAITING,
      now,
      limit
    )
    return rows.map((row) => unitOf(row))
  }

  /** When the next waiting unit may start, epoch ms; null when nothing waits. */
  async nextStart(): Promise<number | null> {
    const row = await this.sql.get<{ next: number | null }>(
      `SELECT MIN(not_before) AS next FROM ai_work WHERE status IN (${placeholders(WAITING)})`,
      ...WAITING
    )
    return row?.next === null || row?.next === undefined ? null : Number(row.next)
  }

  /** Takes a unit to run; false when another took it, or it is no longer waiting. */
  async claim(id: string): Promise<boolean> {
    return (
      (await this.sql.run(
        `UPDATE ai_work SET status = 'al_lavoro', attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status IN (${placeholders(WAITING)})`,
        Date.now(),
        id,
        ...WAITING
      )) === 1
    )
  }

  async attachActivity(id: string, activityId: string): Promise<void> {
    await this.sql.run(
      'UPDATE ai_work SET activity_id = ?, updated_at = ? WHERE id = ?',
      activityId,
      Date.now(),
      id
    )
  }

  async complete(id: string): Promise<void> {
    await this.sql.run(
      "UPDATE ai_work SET status = 'fatto', last_error = NULL, updated_at = ? WHERE id = ?",
      Date.now(),
      id
    )
  }

  /**
   * A unit failed. One that may be tried again waits from `notBefore`;
   * a failure that is not the work's own — the network, the provider —
   * does not count against it.
   */
  async fail(
    id: string,
    error: string,
    options: { retry: boolean; counts: boolean; maxAttempts: number }
  ): Promise<WorkStatus> {
    const unit = await this.get(id)

    if (!unit) {
      return 'annullato'
    }

    const attempts = options.counts ? unit.attempts : Math.max(unit.attempts - 1, 0)
    const status: WorkStatus =
      options.retry && attempts < options.maxAttempts ? 'da_riprovare' : 'fallito'

    await this.sql.run(
      `UPDATE ai_work SET status = ?, attempts = ?, last_error = ?, not_before = ?, updated_at = ?
       WHERE id = ?`,
      status,
      attempts,
      error.slice(0, 1000),
      Date.now() + retryDelayMs(Math.max(attempts, 1)),
      Date.now(),
      id
    )
    return status
  }

  async cancel(id: string): Promise<void> {
    await this.sql.run(
      `UPDATE ai_work SET status = 'annullato', updated_at = ? WHERE id = ? AND status <> 'fatto'`,
      Date.now(),
      id
    )
  }

  /** Cancels all waiting work of a task — the AI switched off, a connection removed. */
  async cancelWaiting(filter: { task?: string; scopePrefix?: string } = {}): Promise<number> {
    return this.sql.run(
      `UPDATE ai_work SET status = 'annullato', updated_at = ?
       WHERE status IN (${placeholders(WAITING)})
       ${filter.task ? 'AND task = ?' : ''} ${filter.scopePrefix ? 'AND scope_key LIKE ?' : ''}`,
      Date.now(),
      ...WAITING,
      ...(filter.task ? [filter.task] : []),
      ...(filter.scopePrefix ? [`${filter.scopePrefix}%`] : [])
    )
  }

  /** Work a quit left running waits again: it starts over. */
  async recover(): Promise<number> {
    return this.sql.run(
      "UPDATE ai_work SET status = 'in_coda', attempts = MAX(attempts - 1, 0), updated_at = ? WHERE status = 'al_lavoro'",
      Date.now()
    )
  }

  /** Whether a scope failed for good lately: not asked for again until the user says so. */
  async failedSince(scopeKeys: ReadonlyArray<string>, sinceMs: number): Promise<Set<string>> {
    if (scopeKeys.length === 0) {
      return new Set()
    }

    const rows = await this.sql.all<{ scope_key: string }>(
      `SELECT DISTINCT scope_key FROM ai_work WHERE status = 'fallito' AND updated_at >= ?
       AND scope_key IN (${placeholders(scopeKeys)})`,
      sinceMs,
      ...scopeKeys
    )
    return new Set(rows.map((row) => row.scope_key))
  }

  /** The units that failed for good, the newest first. */
  async failed(limit = 50): Promise<WorkUnit[]> {
    const rows = await this.sql.all<WorkRow>(
      "SELECT * FROM ai_work WHERE status = 'fallito' ORDER BY updated_at DESC LIMIT ?",
      limit
    )
    return rows.map((row) => unitOf(row))
  }

  /** Tries failed work again, now: the user asked. */
  async retryFailed(ids?: ReadonlyArray<string>): Promise<number> {
    return this.sql.run(
      `UPDATE ai_work SET status = 'in_coda', attempts = 0, not_before = ?, updated_at = ?
       WHERE status = 'fallito' ${ids ? `AND id IN (${placeholders(ids)})` : ''}`,
      Date.now(),
      Date.now(),
      ...(ids ?? [])
    )
  }

  /** How much of each task waits, runs and failed: the progress the interface shows. */
  async counts(): Promise<
    Array<{ task: string; status: WorkStatus; count: number; priority: number }>
  > {
    const rows = await this.sql.all<{
      task: string
      status: string
      count: number
      priority: number
    }>(
      `SELECT task, status, COUNT(*) AS count, MIN(priority) AS priority FROM ai_work
       WHERE status IN ('in_coda', 'da_riprovare', 'al_lavoro', 'fallito')
       GROUP BY task, status`
    )
    return rows.map((row) => ({
      task: row.task,
      status: row.status as WorkStatus,
      count: Number(row.count),
      priority: Number(row.priority)
    }))
  }

  /** Forgets finished work older than a while. */
  async prune(olderThanMs: number): Promise<void> {
    await this.sql.run(
      "DELETE FROM ai_work WHERE status IN ('fatto', 'annullato') AND updated_at < ?",
      Date.now() - olderThanMs
    )
  }

  async clear(): Promise<void> {
    await this.sql.run('DELETE FROM ai_work')
  }
}
