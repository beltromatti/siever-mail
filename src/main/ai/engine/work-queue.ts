import { randomUUID } from 'node:crypto'

import { placeholders, type Sql } from '../sql'

/**
 * `in_coda` waiting for its turn; `al_lavoro` running; `fatto`;
 * `da_riprovare` cut short by a quit, the sleep or a refused key, to start
 * again; `fallito` when it did not do its work — left so until the user
 * tries it again or new work on the same matter takes its place;
 * `annullato`.
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
    /** Asked by the user: a unit waiting for it starts now, not when it was to. */
    now?: boolean
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
             not_before = CASE WHEN ? THEN ? WHEN status = 'in_coda' THEN MAX(not_before, ?)
               ELSE not_before END,
             updated_at = ?
           WHERE id = ? AND status IN (${placeholders(WAITING)})`,
          JSON.stringify(scope),
          input.priority,
          input.now ? 1 : 0,
          notBefore,
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
  async ready(limit: number, now = Date.now(), offset = 0): Promise<WorkUnit[]> {
    const rows = await this.sql.all<WorkRow>(
      `SELECT * FROM ai_work WHERE status IN (${placeholders(WAITING)}) AND not_before <= ?
       ORDER BY priority, created_at LIMIT ? OFFSET ?`,
      ...WAITING,
      now,
      limit,
      offset
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

  /** Done: an earlier failure of the same scope is done with it — it no longer waits for "Riprova". */
  async complete(id: string): Promise<void> {
    const now = Date.now()
    await this.sql.run(
      "UPDATE ai_work SET status = 'fatto', last_error = NULL, updated_at = ? WHERE id = ?",
      now,
      id
    )
    await this.sql.run(
      `UPDATE ai_work SET status = 'annullato', updated_at = ?
       WHERE status = 'fallito' AND scope_key = (SELECT scope_key FROM ai_work WHERE id = ?)`,
      now,
      id
    )
  }

  /**
   * A unit did not finish. Cut short by a quit, the sleep or a refused key
   * (`retry`), it waits to start again, as it was; otherwise it failed, and
   * stays failed. One unit waits per scope: when what came for the same
   * scope waits already, that unit takes this one's place.
   */
  async fail(id: string, error: string, options: { retry: boolean }): Promise<WorkStatus> {
    const unit = await this.get(id)

    if (!unit) {
      return 'annullato'
    }

    const attempts = options.retry ? Math.max(unit.attempts - 1, 0) : unit.attempts
    const status: WorkStatus = options.retry ? 'da_riprovare' : 'fallito'
    const message = error.slice(0, 1000)

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const waiting = status === 'da_riprovare' ? await this.waitingFor(unit.scopeKey) : null

      if (waiting && waiting.id !== id) {
        await this.sql.run(
          'UPDATE ai_work SET attempts = MAX(attempts, ?), last_error = ?, updated_at = ? WHERE id = ?',
          attempts,
          message,
          Date.now(),
          waiting.id
        )
        await this.sql.run(
          "UPDATE ai_work SET status = 'annullato', last_error = ?, updated_at = ? WHERE id = ?",
          message,
          Date.now(),
          id
        )
        return status
      }

      try {
        await this.sql.run(
          `UPDATE ai_work SET status = ?, attempts = ?, last_error = ?, not_before = ?, updated_at = ?
           WHERE id = ?`,
          status,
          attempts,
          message,
          Date.now(),
          Date.now(),
          id
        )
        return status
      } catch (failure) {
        // Work for the same scope was queued between the look and the write: it takes the place.
        if (!String(failure).includes('UNIQUE')) {
          throw failure
        }
      }
    }

    throw new Error(`Could not put back the work for ${unit.scopeKey}.`)
  }

  async cancel(id: string): Promise<void> {
    await this.sql.run(
      `UPDATE ai_work SET status = 'annullato', updated_at = ? WHERE id = ? AND status <> 'fatto'`,
      Date.now(),
      id
    )
  }

  /**
   * Cancels the waiting work — the AI switched off — or the work on what goes
   * away (a connection removed: `scopePrefix`), its failures too.
   */
  async cancelWaiting(filter: { task?: string; scopePrefix?: string } = {}): Promise<number> {
    const statuses: WorkStatus[] = filter.scopePrefix ? [...WAITING, 'fallito'] : [...WAITING]
    return this.sql.run(
      `UPDATE ai_work SET status = 'annullato', updated_at = ?
       WHERE status IN (${placeholders(statuses)})
       ${filter.task ? 'AND task = ?' : ''} ${filter.scopePrefix ? 'AND scope_key LIKE ?' : ''}`,
      Date.now(),
      ...statuses,
      ...(filter.task ? [filter.task] : []),
      ...(filter.scopePrefix ? [`${filter.scopePrefix}%`] : [])
    )
  }

  /** Work a quit left running waits again: it starts over. */
  async recover(): Promise<number> {
    // Work cut short whose scope has a unit waiting already — what came while it ran — is
    // done by that one; of two cut short for one scope, the later stays.
    await this.sql.run(
      `DELETE FROM ai_work WHERE status = 'al_lavoro' AND (
        scope_key IN (SELECT scope_key FROM ai_work WHERE status IN ('in_coda', 'da_riprovare'))
        OR rowid NOT IN (SELECT MAX(rowid) FROM ai_work WHERE status = 'al_lavoro' GROUP BY scope_key)
      )`
    )
    return this.sql.run(
      "UPDATE ai_work SET status = 'in_coda', attempts = MAX(attempts - 1, 0), updated_at = ? WHERE status = 'al_lavoro'",
      Date.now()
    )
  }

  /** Whether a unit of this scope waits or runs: asking again adds nothing. */
  async inProgress(scopeKey: string): Promise<boolean> {
    return (
      (await this.sql.get(
        `SELECT 1 AS found FROM ai_work WHERE scope_key = ?
         AND status IN ('in_coda', 'da_riprovare', 'al_lavoro') LIMIT 1`,
        scopeKey
      )) !== null
    )
  }

  /**
   * Whether work for a scope waits, runs, or failed: then it is not queued
   * again — a failure is not tried again by itself (§13ter.2): where the
   * user waited for it, they say "Riprova"; in the background it ended.
   */
  async busy(scopeKey: string): Promise<boolean> {
    return (
      (await this.sql.get(
        `SELECT 1 AS found FROM ai_work WHERE scope_key = ?
         AND status IN ('in_coda', 'da_riprovare', 'al_lavoro', 'fallito') LIMIT 1`,
        scopeKey
      )) !== null
    )
  }

  /**
   * Of these scopes, those whose work failed, with when it failed last: the
   * planning queues them again only for what came after.
   */
  async failedAt(scopeKeys: ReadonlyArray<string>): Promise<Map<string, number>> {
    if (scopeKeys.length === 0) {
      return new Map()
    }

    const rows = await this.sql.all<{ scope_key: string; failed_at: number }>(
      `SELECT scope_key, MAX(updated_at) AS failed_at FROM ai_work
       WHERE status = 'fallito' AND scope_key IN (${placeholders(scopeKeys)})
       GROUP BY scope_key`,
      ...scopeKeys
    )
    return new Map(rows.map((row) => [row.scope_key, Number(row.failed_at)]))
  }

  /** A task's units that failed, the newest first. */
  async failed(task: string): Promise<WorkUnit[]> {
    const rows = await this.sql.all<WorkRow>(
      "SELECT * FROM ai_work WHERE task = ? AND status = 'fallito' ORDER BY updated_at DESC",
      task
    )
    return rows.map((row) => unitOf(row))
  }

  /**
   * Tries these failed units again, now: the user asked, where they waited
   * for the result (§13ter.2). One unit waits per scope: the latest failure
   * of each is tried, unless work for it waits already; the others are let go.
   */
  async retryFailed(ids: ReadonlyArray<string>): Promise<number> {
    if (ids.length === 0) {
      return 0
    }

    const failed = await this.sql.all<WorkRow>(
      `SELECT * FROM ai_work WHERE status = 'fallito' AND id IN (${placeholders(ids)})
       ORDER BY updated_at DESC`,
      ...ids
    )
    const tried = new Set<string>()

    for (const row of failed) {
      const now = Date.now()

      if (tried.has(row.scope_key) || (await this.waitingFor(row.scope_key))) {
        await this.sql.run(
          "UPDATE ai_work SET status = 'annullato', updated_at = ? WHERE id = ?",
          now,
          row.id
        )
      } else {
        await this.sql.run(
          `UPDATE ai_work SET status = 'in_coda', attempts = 0, not_before = ?, updated_at = ?
           WHERE id = ?`,
          now,
          now,
          row.id
        )
        tried.add(row.scope_key)
      }
    }

    return tried.size
  }

  /**
   * The units of a piece of work made of many — a calendar's first look, by
   * its blocks — whose scopes begin the same: waiting, running, done (until
   * forgotten) or failed; not those let go.
   */
  async within(scopePrefix: string): Promise<WorkUnit[]> {
    const rows = await this.sql.all<WorkRow>(
      `SELECT * FROM ai_work WHERE substr(scope_key, 1, ?) = ? AND status <> 'annullato'`,
      scopePrefix.length,
      scopePrefix
    )
    return rows.map((row) => unitOf(row))
  }

  /**
   * Forgets a piece of work made of many — a calendar's first look, done
   * again — its units waiting, done or failed: what was done of it is no
   * longer how things stand.
   */
  async forgetWithin(scopePrefix: string): Promise<void> {
    await this.sql.run(
      `DELETE FROM ai_work WHERE substr(scope_key, 1, ?) = ? AND status <> 'al_lavoro'`,
      scopePrefix.length,
      scopePrefix
    )
  }

  /** A task's units waiting or running. */
  async units(task: string): Promise<WorkUnit[]> {
    const rows = await this.sql.all<WorkRow>(
      `SELECT * FROM ai_work WHERE task = ? AND status IN ('in_coda', 'da_riprovare', 'al_lavoro')`,
      task
    )
    return rows.map((row) => unitOf(row))
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

  /**
   * Forgets work long done or let go. A failure stays: it is how the same
   * work is not done again by itself.
   */
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
