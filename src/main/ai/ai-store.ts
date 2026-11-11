import {
  DEFAULT_SEGRETARIO_PREFERENCES,
  type ActivityStatus,
  type ActivitySummary,
  type ActivityVisibility,
  type SegretarioPreferences,
  type SegretarioStatus
} from '@shared/segretario'

import { decryptSecret, encryptSecret } from '../services/secure-storage'
import type { TaskKind } from './agent/tool-types'
import type { ChatUsage } from './openrouter'
import type { RegistryChange } from './registry/types'
import { placeholders, type Sql } from './sql'

const SETTINGS_ID = 1

/** An event of an activity as it is stored: its type and what it carries. */
export interface StoredEvent<T = unknown> {
  id: number
  type: string
  payload: T
  createdAt: number
}

interface ActivityRow {
  id: string
  kind: string
  title: string
  status: string
  created_at: number
  updated_at: number
  unseen: number
  cost: number
  visibility: string | null
  work_id: string | null
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function summaryOf(row: ActivityRow): ActivitySummary {
  return {
    id: row.id,
    task: row.kind as TaskKind,
    title: row.title,
    status: row.status as ActivityStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    unseen: Number(row.unseen) === 1,
    cost: Number(row.cost),
    visibility: (row.visibility as ActivityVisibility | null) ?? 'pannello'
  }
}

/** A run in the diary, with what it changed. */
export interface WorkEntry {
  activityId: string
  task: TaskKind
  title: string
  status: ActivityStatus
  createdAt: number
  changes: RegistryChange[]
}

/** Runs read at a time when the diary is searched. */
const WORK_PAGE = 300

interface ReadingRow {
  connection_key: string
  days: number | null
  reason: string | null
  set_by: string | null
  set_at: number | null
  looked_from: number | null
  looked_until: number | null
}

/** How far a connection is read, as kept: what was decided (null days: not yet), and how far its events were looked at. */
export interface StoredReading {
  key: string
  days: number | null
  reason: string | null
  setBy: 'segretario' | 'utente' | null
  setAt: number | null
  lookedFrom: number | null
  lookedUntil: number | null
}

function readingOf(row: ReadingRow): StoredReading {
  const number = (value: number | null): number | null => (value === null ? null : Number(value))
  return {
    key: row.connection_key,
    days: number(row.days),
    reason: row.reason,
    setBy: row.set_by === 'utente' || row.set_by === 'segretario' ? row.set_by : null,
    setAt: number(row.set_at),
    lookedFrom: number(row.looked_from),
    lookedUntil: number(row.looked_until)
  }
}

/**
 * The Segretario's own bookkeeping: its settings and key, what it cost,
 * its runs and their logs, which connections it knows, what it has to
 * learn from, the drafts it wrote, the searches kept. The user's work —
 * notes, commitments, projects, replies — is the registry's; the memory is
 * the notebook's.
 */
/** What forgetting a connection touched: the projects it was in, the runs taken from the diary. */
export interface ForgottenConnection {
  projects: string[]
  activities: string[]
}

export class AiStore {
  constructor(private readonly sql: Sql) {}

  /* ─────────────────────────── settings and key ─────────────────────────── */

  async getApiKey(): Promise<string | null> {
    const row = await this.sql.get<{ encrypted_api_key: string | null }>(
      'SELECT encrypted_api_key FROM ai_settings WHERE id = ?',
      SETTINGS_ID
    )
    return row?.encrypted_api_key ? decryptSecret(row.encrypted_api_key) : null
  }

  async setApiKey(key: string | null, status: SegretarioStatus): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_settings (id, encrypted_api_key, key_status_json, preferences_json, updated_at)
       VALUES (?, ?, ?, '{}', ?)
       ON CONFLICT(id) DO UPDATE SET encrypted_api_key = excluded.encrypted_api_key,
         key_status_json = excluded.key_status_json, updated_at = excluded.updated_at`,
      SETTINGS_ID,
      key ? encryptSecret(key) : null,
      JSON.stringify(status),
      Date.now()
    )
  }

  async getStoredStatus(): Promise<SegretarioStatus | null> {
    const row = await this.sql.get<{ key_status_json: string }>(
      'SELECT key_status_json FROM ai_settings WHERE id = ?',
      SETTINGS_ID
    )
    return row ? parseJson<SegretarioStatus | null>(row.key_status_json, null) : null
  }

  async setStoredStatus(status: SegretarioStatus): Promise<void> {
    await this.sql.run(
      'UPDATE ai_settings SET key_status_json = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(status),
      Date.now(),
      SETTINGS_ID
    )
  }

  async getPreferences(): Promise<SegretarioPreferences> {
    const row = await this.sql.get<{ preferences_json: string }>(
      'SELECT preferences_json FROM ai_settings WHERE id = ?',
      SETTINGS_ID
    )
    const stored = parseJson<Partial<SegretarioPreferences> & { triage?: boolean }>(
      row?.preferences_json,
      {}
    )

    return {
      ...DEFAULT_SEGRETARIO_PREFERENCES,
      ...stored,
      // Builds before the single switch kept one per function: reading the mail was the Segretario.
      enabled: stored.enabled ?? stored.triage ?? DEFAULT_SEGRETARIO_PREFERENCES.enabled
    }
  }

  async setPreferences(preferences: SegretarioPreferences): Promise<SegretarioPreferences> {
    await this.sql.run(
      `INSERT INTO ai_settings (id, encrypted_api_key, key_status_json, preferences_json, updated_at)
       VALUES (?, NULL, '{}', ?, ?)
       ON CONFLICT(id) DO UPDATE SET preferences_json = excluded.preferences_json, updated_at = excluded.updated_at`,
      SETTINGS_ID,
      JSON.stringify(preferences),
      Date.now()
    )
    return this.getPreferences()
  }

  /** A fact the engine keeps between runs (`ai_meta`): how far it has looked at the calendar. */
  async meta(key: string): Promise<string | null> {
    return (
      (await this.sql.get<{ value: string }>('SELECT value FROM ai_meta WHERE key = ?', key))
        ?.value ?? null
    )
  }

  async deleteMeta(key: string): Promise<void> {
    await this.sql.run('DELETE FROM ai_meta WHERE key = ?', key)
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.sql.run(
      'INSERT INTO ai_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    )
  }

  /* ──────────────────────────────── usage ──────────────────────────────── */

  async recordUsage(entry: {
    activityId: string | null
    purpose: string
    model: string | null
    provider: string | null
    usage: ChatUsage
  }): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_usage (created_at, activity_id, purpose, model, provider, prompt_tokens,
         cached_tokens, completion_tokens, reasoning_tokens, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Date.now(),
      entry.activityId,
      entry.purpose,
      entry.model,
      entry.provider,
      entry.usage.promptTokens,
      entry.usage.cachedTokens,
      entry.usage.completionTokens,
      entry.usage.reasoningTokens,
      entry.usage.cost
    )

    if (entry.activityId) {
      await this.sql.run(
        'UPDATE ai_activities SET cost = cost + ? WHERE id = ?',
        entry.usage.cost,
        entry.activityId
      )
    }
  }

  /** What was spent since `since`, in dollars. */
  async spentSince(since: number): Promise<number> {
    const row = await this.sql.get<{ total: number | null }>(
      'SELECT SUM(cost) AS total FROM ai_usage WHERE created_at >= ?',
      since
    )
    return Number(row?.total ?? 0)
  }

  /** What was spent since `since`, by what it was spent on, the most first. */
  async spentByPurpose(
    since: number
  ): Promise<Array<{ purpose: string; cost: number; calls: number }>> {
    const rows = await this.sql.all<{ purpose: string; cost: number; calls: number }>(
      `SELECT purpose, SUM(cost) AS cost, COUNT(*) AS calls FROM ai_usage WHERE created_at >= ?
       GROUP BY purpose ORDER BY cost DESC`,
      since
    )
    return rows.map((row) => ({
      purpose: row.purpose,
      cost: Number(row.cost),
      calls: Number(row.calls)
    }))
  }

  /* ───────────────────────────── activities ───────────────────────────── */

  async createActivity(activity: {
    id: string
    task: TaskKind
    title: string
    status: ActivityStatus
    visibility: ActivityVisibility
    workId?: string | null
    scope?: unknown
  }): Promise<ActivitySummary> {
    const now = Date.now()
    await this.sql.run(
      `INSERT INTO ai_activities (id, kind, title, status, created_at, updated_at, unseen, cost, task,
         visibility, work_id, scope_json)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      activity.id,
      activity.task,
      activity.title,
      activity.status,
      now,
      now,
      activity.task,
      activity.visibility,
      activity.workId ?? null,
      activity.scope === undefined ? null : JSON.stringify(activity.scope)
    )
    return (await this.getActivity(activity.id))!
  }

  async updateActivity(
    id: string,
    changes: Partial<{
      title: string
      status: ActivityStatus
      unseen: boolean
      visibility: ActivityVisibility
    }>
  ): Promise<ActivitySummary | null> {
    const fields = Object.entries(changes).filter(([, value]) => value !== undefined)

    if (fields.length > 0) {
      await this.sql.run(
        `UPDATE ai_activities SET ${fields.map(([name]) => `${name} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...fields.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value)),
        Date.now(),
        id
      )
    }

    return this.getActivity(id)
  }

  async getActivity(id: string): Promise<ActivitySummary | null> {
    const row = await this.sql.get<ActivityRow>('SELECT * FROM ai_activities WHERE id = ?', id)
    return row ? summaryOf(row) : null
  }

  /** The activities, the most recently moved first: those shown in the panel, or all. */
  async listActivities(visibility?: ActivityVisibility): Promise<ActivitySummary[]> {
    const rows = await this.sql.all<ActivityRow>(
      `SELECT * FROM ai_activities ${visibility ? "WHERE COALESCE(visibility, 'pannello') = ?" : ''}
       ORDER BY updated_at DESC`,
      ...(visibility ? [visibility] : [])
    )
    return rows.map(summaryOf)
  }

  async deleteActivity(id: string): Promise<void> {
    await this.sql.run('DELETE FROM ai_events WHERE activity_id = ?', id)
    await this.sql.run('DELETE FROM ai_activities WHERE id = ?', id)
  }

  /** Activities a quit left at work: they cannot go on, and say so. */
  async listUnfinished(): Promise<ActivitySummary[]> {
    const rows = await this.sql.all<ActivityRow>(
      "SELECT * FROM ai_activities WHERE status IN ('running', 'waiting')"
    )
    return rows.map(summaryOf)
  }

  /** When the last activity of a task began, epoch ms; null if none has. */
  async lastActivityAt(task: TaskKind, status?: ActivityStatus): Promise<number | null> {
    const row = await this.sql.get<{ at: number | null }>(
      `SELECT MAX(created_at) AS at FROM ai_activities WHERE kind = ? ${status ? 'AND status = ?' : ''}`,
      task,
      ...(status ? [status] : [])
    )
    return row?.at === null || row?.at === undefined ? null : Number(row.at)
  }

  async appendEvent<T>(activityId: string, type: string, payload: T): Promise<StoredEvent<T>> {
    const now = Date.now()
    const row = await this.sql.get<{ id: number }>(
      'INSERT INTO ai_events (activity_id, type, payload_json, created_at) VALUES (?, ?, ?, ?) RETURNING id',
      activityId,
      type,
      JSON.stringify(payload),
      now
    )
    await this.sql.run('UPDATE ai_activities SET updated_at = ? WHERE id = ?', now, activityId)
    return { id: Number(row!.id), type, payload, createdAt: now }
  }

  /** Replaces what an event carries: a tool's line once it finished, a confirmation once given. */
  async updateEvent<T>(id: number, payload: T): Promise<void> {
    await this.sql.run(
      'UPDATE ai_events SET payload_json = ? WHERE id = ?',
      JSON.stringify(payload),
      id
    )
  }

  /** The runs since a moment, as stored, the oldest first: for the diagnostics' sessions (§14.4). */
  async activitiesSince(sinceMs: number): Promise<
    Array<{
      id: string
      task: string
      title: string
      status: string
      visibility: string
      createdAt: number
      updatedAt: number
      cost: number
      workId: string | null
      scope: unknown
    }>
  > {
    const rows = await this.sql.all<{
      id: string
      task: string | null
      kind: string
      title: string
      status: string
      visibility: string
      created_at: number
      updated_at: number
      cost: number
      work_id: string | null
      scope_json: string | null
    }>(
      `SELECT id, task, kind, title, status, visibility, created_at, updated_at, cost, work_id, scope_json
       FROM ai_activities WHERE updated_at >= ? ORDER BY created_at`,
      sinceMs
    )
    return rows.map((row) => ({
      id: row.id,
      task: row.task ?? row.kind,
      title: row.title,
      status: row.status,
      visibility: row.visibility,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      cost: Number(row.cost),
      workId: row.work_id,
      scope: row.scope_json ? parseJson<unknown>(row.scope_json, null) : null
    }))
  }

  /** The work queued, running or failed, and what ended since a moment: for the diagnostics. */
  async workSince(sinceMs: number): Promise<Array<Record<string, unknown>>> {
    return this.sql.all(
      `SELECT task, scope_key AS scope, status, priority, attempts, activity_id AS activity,
         last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
       FROM ai_work WHERE status <> 'fatto' OR updated_at >= ? ORDER BY updated_at DESC`,
      sinceMs
    )
  }

  /** How much the registry holds: notes, what is open, projects, replies, proposals, lessons. */
  async registryFigures(): Promise<Record<string, number>> {
    const row = await this.sql.get<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM ai_notes) AS notes,
         (SELECT COUNT(*) FROM ai_items WHERE status = 'aperta') AS openThings,
         (SELECT COUNT(*) FROM ai_items) AS things,
         (SELECT COUNT(*) FROM ai_projects WHERE closed_at IS NULL) AS projects,
         (SELECT COUNT(*) FROM ai_projects WHERE stale_since IS NOT NULL) AS projectsBehind,
         (SELECT COUNT(*) FROM ai_ready_drafts WHERE status = 'pronta') AS readyReplies,
         (SELECT COUNT(*) FROM ai_proposals WHERE status = 'aperta') AS openProposals,
         (SELECT COUNT(*) FROM ai_calendar_roles) AS calendarRolesDecided,
         (SELECT COUNT(*) FROM ai_own_events WHERE yours = 1) AS eventsFoundYours,
         (SELECT COUNT(*) FROM ai_memory) AS memoryNotes,
         (SELECT COUNT(*) FROM ai_lessons WHERE reflection_id IS NULL) AS pendingLessons,
         (SELECT COUNT(*) FROM ai_activities) AS runsKept`
    )
    return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]))
  }

  async listEvents(activityId: string): Promise<StoredEvent[]> {
    const rows = await this.sql.all<{
      id: number
      type: string
      payload_json: string
      created_at: number
    }>(
      'SELECT id, type, payload_json, created_at FROM ai_events WHERE activity_id = ? ORDER BY id',
      activityId
    )
    return rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      payload: parseJson<unknown>(row.payload_json, null),
      createdAt: Number(row.created_at)
    }))
  }

  async getEvent(id: number): Promise<(StoredEvent & { activityId: string }) | null> {
    const row = await this.sql.get<{
      id: number
      activity_id: string
      type: string
      payload_json: string
      created_at: number
    }>('SELECT * FROM ai_events WHERE id = ?', id)
    return row
      ? {
          id: Number(row.id),
          activityId: row.activity_id,
          type: row.type,
          payload: parseJson<unknown>(row.payload_json, null),
          createdAt: Number(row.created_at)
        }
      : null
  }

  /**
   * The runs since a moment, the newest first, each with what it changed:
   * the diary. With `matches`, only those it takes — read a page at a time
   * until there are `limit` of them.
   */
  async recentWork(
    sinceMs: number,
    limit: number,
    matches?: (entry: WorkEntry) => boolean
  ): Promise<WorkEntry[]> {
    const found: WorkEntry[] = []
    const page = matches ? WORK_PAGE : limit
    let after: { createdAt: number; id: string } | null = null

    for (;;) {
      const rows: Array<ActivityRow & { changes_json: string | null }> = await this.sql.all(
        `SELECT a.*, (SELECT e.payload_json FROM ai_events e WHERE e.activity_id = a.id AND e.type = 'changes'
           ORDER BY e.id DESC LIMIT 1) AS changes_json
         FROM ai_activities a
         WHERE a.created_at >= ? ${after ? 'AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))' : ''}
         ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
        sinceMs,
        ...(after ? [after.createdAt, after.createdAt, after.id] : []),
        page
      )

      for (const row of rows) {
        const entry: WorkEntry = {
          activityId: row.id,
          task: row.kind as TaskKind,
          title: row.title,
          status: row.status as ActivityStatus,
          createdAt: Number(row.created_at),
          changes: parseJson<{ changes: RegistryChange[] }>(row.changes_json, { changes: [] })
            .changes
        }

        if (!matches || matches(entry)) {
          found.push(entry)

          if (found.length === limit) {
            return found
          }
        }
      }

      if (rows.length < page) {
        return found
      }

      const last = rows[rows.length - 1]
      after = { createdAt: Number(last.created_at), id: last.id }
    }
  }

  /** Forgets finished background runs older than a while: the diary keeps a few weeks. */
  async pruneActivities(olderThanMs: number): Promise<void> {
    const before = Date.now() - olderThanMs
    await this.sql.run(
      `DELETE FROM ai_events WHERE activity_id IN (
         SELECT id FROM ai_activities WHERE visibility <> 'pannello' AND updated_at < ? AND status NOT IN ('running', 'waiting')
       )`,
      before
    )
    await this.sql.run(
      "DELETE FROM ai_activities WHERE visibility <> 'pannello' AND updated_at < ? AND status NOT IN ('running', 'waiting')",
      before
    )
  }

  /* ───────────────────────── knowing the connections ───────────────────────── */

  async listLearning(): Promise<
    Array<{ accountId: string; activityId: string | null; finishedAt: number | null }>
  > {
    const rows = await this.sql.all<{
      account_id: string
      activity_id: string | null
      finished_at: number | null
    }>('SELECT account_id, activity_id, finished_at FROM ai_learning')
    return rows.map((row) => ({
      accountId: row.account_id,
      activityId: row.activity_id,
      finishedAt: row.finished_at === null ? null : Number(row.finished_at)
    }))
  }

  /**
   * A run gets to know these connections. One known already stays known
   * while it is got to know again — its reading goes on, and a run that
   * does not finish leaves it as it was.
   */
  async startLearning(accountIds: ReadonlyArray<string>, activityId: string): Promise<void> {
    for (const accountId of accountIds) {
      await this.sql.run(
        `INSERT INTO ai_learning (account_id, activity_id, started_at, finished_at) VALUES (?, ?, ?, NULL)
         ON CONFLICT(account_id) DO UPDATE SET activity_id = excluded.activity_id,
           started_at = excluded.started_at`,
        accountId,
        activityId,
        Date.now()
      )
    }
  }

  /** The run that got to know some connections ended: done, or to begin again another time. */
  async endLearning(activityId: string, done: boolean): Promise<void> {
    if (done) {
      await this.sql.run(
        'UPDATE ai_learning SET finished_at = ? WHERE activity_id = ?',
        Date.now(),
        activityId
      )
    } else {
      await this.sql.run(
        'DELETE FROM ai_learning WHERE activity_id = ? AND finished_at IS NULL',
        activityId
      )
    }
  }

  async resetLearning(accountId?: string): Promise<void> {
    await this.sql.run(
      `DELETE FROM ai_learning ${accountId ? 'WHERE account_id = ?' : ''}`,
      ...(accountId ? [accountId] : [])
    )
  }

  /* ─────────────────────── how far each connection is read ─────────────────────── */

  /** What is kept of how far each connection is read: decided, and looked at so far. */
  async readings(): Promise<StoredReading[]> {
    const rows = await this.sql.all<ReadingRow>('SELECT * FROM ai_reading')
    return rows.map(readingOf)
  }

  async reading(key: string): Promise<StoredReading | null> {
    const row = await this.sql.get<ReadingRow>(
      'SELECT * FROM ai_reading WHERE connection_key = ?',
      key
    )
    return row ? readingOf(row) : null
  }

  /** How far back a connection is read from now on, why, and who decided. */
  async setReadingDays(
    key: string,
    days: number,
    reason: string | null,
    by: 'segretario' | 'utente'
  ): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_reading (connection_key, days, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(connection_key) DO UPDATE SET days = excluded.days, reason = excluded.reason,
         set_by = excluded.set_by, set_at = excluded.set_at`,
      key,
      days,
      reason,
      by,
      Date.now()
    )
  }

  /**
   * What reading one message has cost lately, on average — the readings'
   * spending over the notes they wrote since `since` — or null with too few
   * to tell.
   */
  async readingCostPerMessage(since: number): Promise<number | null> {
    const row = await this.sql.get<{ cost: number | null; notes: number }>(
      `SELECT
         (SELECT SUM(u.cost) FROM ai_usage u JOIN ai_activities a ON a.id = u.activity_id
           WHERE a.task = 'lettura' AND u.created_at >= ?) AS cost,
         (SELECT COUNT(*) FROM ai_notes n JOIN ai_activities a ON a.id = n.run_id
           WHERE a.task = 'lettura' AND n.created_at >= ?) AS notes`,
      since,
      since
    )
    const notes = Number(row?.notes ?? 0)
    const cost = Number(row?.cost ?? 0)
    return notes >= 20 && cost > 0 ? cost / notes : null
  }

  /** A calendar to be looked at whole again: what it looked at no longer says what is there. */
  async forgetLooked(key: string): Promise<void> {
    await this.sql.run(
      'UPDATE ai_reading SET looked_from = NULL, looked_until = NULL WHERE connection_key = ?',
      key
    )
  }

  /** How far a calendar's first look has come: from one start to another. */
  async setLooked(key: string, from: number, until: number): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_reading (connection_key, looked_from, looked_until) VALUES (?, ?, ?)
       ON CONFLICT(connection_key) DO UPDATE SET looked_from = excluded.looked_from,
         looked_until = excluded.looked_until`,
      key,
      from,
      until
    )
  }

  /* ──────────────────────── lessons for the reflection ──────────────────────── */

  async addLesson(kind: string, payload: unknown): Promise<void> {
    await this.sql.run(
      'INSERT INTO ai_lessons (kind, payload_json, created_at, reflection_id) VALUES (?, ?, ?, NULL)',
      kind,
      JSON.stringify(payload),
      Date.now()
    )
  }

  /**
   * What the user did to an open thing and then undid teaches nothing: the
   * lessons it left since then, not yet taken in, go.
   */
  async retractLessons(itemId: number, since: number): Promise<void> {
    await this.sql.run(
      `DELETE FROM ai_lessons WHERE reflection_id IS NULL AND created_at >= ?
         AND json_extract(payload_json, '$.impegno') = ?`,
      since,
      itemId
    )
  }

  /** The lessons no reflection has taken in yet, the oldest first. */
  async pendingLessons(): Promise<
    Array<{ id: number; kind: string; payload: unknown; createdAt: number }>
  > {
    const rows = await this.sql.all<{
      id: number
      kind: string
      payload_json: string
      created_at: number
    }>(
      'SELECT id, kind, payload_json, created_at FROM ai_lessons WHERE reflection_id IS NULL ORDER BY id'
    )
    return rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      payload: parseJson<unknown>(row.payload_json, null),
      createdAt: Number(row.created_at)
    }))
  }

  async claimLessons(ids: ReadonlyArray<number>, reflectionId: string): Promise<void> {
    if (ids.length > 0) {
      await this.sql.run(
        `UPDATE ai_lessons SET reflection_id = ? WHERE id IN (${placeholders(ids)})`,
        reflectionId,
        ...ids
      )
    }
  }

  /** A reflection ended: what it took in is kept as learnt, or handed to the next one. */
  async endReflection(reflectionId: string, done: boolean): Promise<void> {
    await this.sql.run(
      done
        ? 'DELETE FROM ai_lessons WHERE reflection_id = ?'
        : 'UPDATE ai_lessons SET reflection_id = NULL WHERE reflection_id = ?',
      reflectionId
    )
  }

  /* ───────────────────────── the drafts it wrote ───────────────────────── */

  async recordDraft(draft: {
    draftId: string
    /** The run that wrote it; null for a reply prepared ahead and taken up. */
    activityId: string | null
    accountId: string
    text: string
    /** The whole draft as it was left (see `draftShape`), when it is one to rewrite later. */
    snapshot?: string | null
  }): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_drafts (draft_id, activity_id, account_id, text, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(draft_id) DO UPDATE SET activity_id = excluded.activity_id, account_id = excluded.account_id,
         text = excluded.text, snapshot = excluded.snapshot, created_at = excluded.created_at`,
      draft.draftId,
      draft.activityId,
      draft.accountId,
      draft.text,
      draft.snapshot ?? null,
      Date.now()
    )
  }

  /** The draft as the Segretario left it: null for one it did not write so. */
  async draftSnapshot(draftId: string): Promise<string | null> {
    const row = await this.sql.get<{ snapshot: string | null }>(
      'SELECT snapshot FROM ai_drafts WHERE draft_id = ?',
      draftId
    )
    return row?.snapshot ?? null
  }

  /** A draft the Segretario wrote, taken out of the record: it has been sent or thrown away. */
  async takeDraft(
    draftId: string
  ): Promise<{ activityId: string | null; accountId: string; text: string } | null> {
    const row = await this.sql.get<{
      activity_id: string | null
      account_id: string
      text: string
    }>('SELECT activity_id, account_id, text FROM ai_drafts WHERE draft_id = ?', draftId)

    if (!row) {
      return null
    }

    await this.sql.run('DELETE FROM ai_drafts WHERE draft_id = ?', draftId)
    return { activityId: row.activity_id, accountId: row.account_id, text: row.text }
  }

  async pruneDrafts(olderThan: number): Promise<void> {
    await this.sql.run('DELETE FROM ai_drafts WHERE created_at < ?', olderThan)
  }

  /* ───────────────────────────── searches kept ───────────────────────────── */

  async saveSearch(entry: {
    id: string
    question: string
    summary: string
    how: string
    search: string
  }): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_saved_searches (id, question, summary, how, search_json, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET question = excluded.question, summary = excluded.summary,
         how = excluded.how, search_json = excluded.search_json`,
      entry.id,
      entry.question,
      entry.summary,
      entry.how,
      entry.search,
      Date.now()
    )
  }

  /** The searches kept as folders, in the order they were kept, each with its search as JSON. */
  async listSavedSearches(): Promise<
    Array<{ id: string; question: string; summary: string; how: string; search: string }>
  > {
    return this.sql.all(
      'SELECT id, question, summary, how, search_json AS search FROM ai_saved_searches ORDER BY created_at'
    )
  }

  async removeSavedSearch(id: string): Promise<void> {
    await this.sql.run('DELETE FROM ai_saved_searches WHERE id = ?', id)
  }

  /* ─────────────────────────────── forgetting ─────────────────────────────── */

  /**
   * A mailbox removed: what the Segretario kept about it alone goes with it —
   * its notes, what was open from its messages, its replies and drafts, its
   * conversations' place in projects, Conoscimi's knowing it, the work and
   * the diary of what was about it only (§11.4). Says the projects that
   * held its conversations, and the runs taken from the diary.
   */
  async forgetAccount(accountId: string): Promise<ForgottenConnection> {
    const projects = await this.sql.all<{ project_id: string }>(
      'SELECT DISTINCT project_id FROM ai_project_threads WHERE account_id = ?',
      accountId
    )
    // Before Conoscimi's knowing it goes: it says which runs knew it alone.
    const activities = await this.forgetRunsOnlyAbout({ accountId, learningKey: accountId })

    for (const table of [
      'ai_learning',
      'ai_drafts',
      'ai_notes',
      'ai_read',
      'ai_alerts',
      'ai_ready_drafts',
      'ai_project_threads',
      'ai_gone'
    ]) {
      await this.sql.run(`DELETE FROM ${table} WHERE account_id = ?`, accountId)
    }

    await this.sql.run(
      'DELETE FROM ai_item_history WHERE item_id IN (SELECT id FROM ai_items WHERE account_id = ?)',
      accountId
    )
    await this.sql.run('DELETE FROM ai_items WHERE account_id = ?', accountId)
    await this.sql.run(
      "UPDATE ai_proposals SET status = 'superata' WHERE account_id = ? AND status = 'aperta'",
      accountId
    )
    await this.sql.run('DELETE FROM ai_work WHERE scope_key LIKE ?', `%:${accountId}:%`)
    await this.sql.run('DELETE FROM ai_reading WHERE connection_key = ?', accountId)
    // The same messages in another account were read here, and carry only a copy of the note:
    // without it, and without its mark, they are read again there, where the work now lives.
    await this.sql.run('DELETE FROM ai_read WHERE twin_account_id = ?', accountId)
    await this.sql.run('DELETE FROM ai_notes WHERE twin_account_id = ?', accountId)
    return { projects: projects.map((row) => row.project_id), activities }
  }

  /**
   * A calendar connection removed: what was kept about its events — how to
   * prepare them, proposals to change them or answer them, what was open
   * from them, their place in projects — and Conoscimi's knowing it go with
   * it, as a mailbox's go with it. Says the projects that held its events,
   * and the runs taken from the diary.
   */
  async forgetCalendar(connectionId: string, learningKey: string): Promise<ForgottenConnection> {
    const ofIt = `${connectionId}\u0000%`
    const projects = await this.sql.all<{ project_id: string }>(
      `SELECT DISTINCT project_id FROM ai_project_resources WHERE kind = 'evento' AND location LIKE ?`,
      ofIt
    )
    const activities = await this.forgetRunsOnlyAbout({ calendarId: connectionId, learningKey })
    await this.sql.run('DELETE FROM ai_event_preps WHERE event_key LIKE ?', ofIt)
    await this.sql.run('DELETE FROM ai_own_events WHERE event_key LIKE ?', ofIt)
    await this.sql.run('DELETE FROM ai_alerts WHERE event_key LIKE ?', ofIt)
    await this.sql.run('DELETE FROM ai_calendar_roles WHERE calendar_key LIKE ?', ofIt)
    await this.sql.run(
      'DELETE FROM ai_item_history WHERE item_id IN (SELECT id FROM ai_items WHERE event_key LIKE ?)',
      ofIt
    )
    await this.sql.run('DELETE FROM ai_items WHERE event_key LIKE ?', ofIt)
    await this.sql.run(
      `DELETE FROM ai_project_resources WHERE kind = 'evento' AND location LIKE ?`,
      ofIt
    )
    await this.sql.run(
      `UPDATE ai_proposals SET status = 'superata', decided_at = ?
       WHERE status = 'aperta' AND kind = 'evento' AND json_extract(payload_json, '$.eventKey') LIKE ?`,
      Date.now(),
      ofIt
    )
    await this.sql.run('DELETE FROM ai_learning WHERE account_id = ?', learningKey)
    await this.sql.run('DELETE FROM ai_reading WHERE connection_key = ?', learningKey)
    await this.sql.run('DELETE FROM ai_meta WHERE key = ?', `calendar_looked:${connectionId}`)
    await this.sql.run(
      'DELETE FROM ai_work WHERE scope_key LIKE ?',
      `calendario-vista:${connectionId}:%`
    )
    return { projects: projects.map((row) => row.project_id), activities }
  }

  /**
   * The diary of what was about one connection only — the readings of a
   * mailbox's messages, the looks at a calendar, a Conoscimi that knew it
   * alone — goes with it: its own data. What mixes the sources (the chat,
   * the day, «Il punto», a Conoscimi of several) is the user's history, and
   * stays; so does what it cost.
   */
  private async forgetRunsOnlyAbout(about: {
    accountId?: string
    calendarId?: string
    learningKey: string
  }): Promise<string[]> {
    const rows = [
      ...(about.accountId
        ? await this.sql.all<{ id: string }>(
            // A reading names its mailbox; one from before it did, by the notes it wrote.
            `SELECT a.id FROM ai_activities a
             WHERE COALESCE(a.task, a.kind) = 'lettura'
               AND COALESCE(json_extract(a.scope_json, '$.accountId'),
                 (SELECT n.account_id FROM ai_notes n WHERE n.run_id = a.id LIMIT 1)) = ?`,
            about.accountId
          )
        : []),
      ...(about.calendarId
        ? await this.sql.all<{ id: string }>(
            `SELECT id FROM ai_activities
             WHERE COALESCE(task, kind) = 'calendario' AND json_extract(scope_json, '$.look') = ?`,
            about.calendarId
          )
        : []),
      ...(await this.sql.all<{ id: string }>(
        `SELECT l.activity_id AS id FROM ai_learning l
         WHERE l.account_id = ? AND l.activity_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM ai_learning o WHERE o.activity_id = l.activity_id AND o.account_id <> l.account_id
           )`,
        about.learningKey
      ))
    ]
    const ids = [...new Set(rows.map((row) => row.id))]

    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500)
      await this.sql.run(
        `DELETE FROM ai_events WHERE activity_id IN (${placeholders(chunk)})`,
        ...chunk
      )
      await this.sql.run(`DELETE FROM ai_activities WHERE id IN (${placeholders(chunk)})`, ...chunk)
    }

    return ids
  }

  /**
   * The connections the Segretario still keeps something of — mailboxes and
   * calendar connections by id — and those Conoscimi had come to know: what
   * belongs to one no longer there is found from these (§11.4).
   */
  async keptConnections(): Promise<{
    mail: Set<string>
    calendars: Set<string>
    known: Set<string>
  }> {
    const mail = await this.sql.all<{ id: string | null }>(
      `SELECT account_id AS id FROM ai_notes
       UNION SELECT twin_account_id FROM ai_notes
       UNION SELECT account_id FROM ai_read
       UNION SELECT account_id FROM ai_alerts WHERE account_id IS NOT NULL
       UNION SELECT account_id FROM ai_items
       UNION SELECT account_id FROM ai_ready_drafts
       UNION SELECT account_id FROM ai_drafts
       UNION SELECT account_id FROM ai_project_threads
       UNION SELECT account_id FROM ai_gone
       UNION SELECT account_id FROM ai_proposals WHERE status = 'aperta'
       UNION SELECT account_id FROM ai_learning WHERE account_id NOT LIKE 'calendario:%'
       UNION SELECT connection_key FROM ai_reading WHERE connection_key NOT LIKE 'calendario:%'
       UNION SELECT json_extract(scope_json, '$.accountId') FROM ai_activities
         WHERE COALESCE(task, kind) = 'lettura'`
    )
    const calendars = await this.sql.all<{ key: string | null }>(
      `SELECT event_key AS key FROM ai_event_preps
       UNION SELECT event_key FROM ai_own_events
       UNION SELECT event_key FROM ai_alerts WHERE event_key IS NOT NULL
       UNION SELECT calendar_key FROM ai_calendar_roles
       UNION SELECT event_key FROM ai_items
       UNION SELECT location FROM ai_project_resources WHERE kind = 'evento'
       UNION SELECT json_extract(payload_json, '$.eventKey') FROM ai_proposals
         WHERE kind = 'evento' AND status = 'aperta'
       UNION SELECT substr(account_id, 12) || char(0) FROM ai_learning WHERE account_id LIKE 'calendario:%'
       UNION SELECT substr(connection_key, 12) || char(0) FROM ai_reading
         WHERE connection_key LIKE 'calendario:%'
       UNION SELECT json_extract(scope_json, '$.look') || char(0) FROM ai_activities
         WHERE COALESCE(task, kind) = 'calendario'`
    )
    const known = await this.sql.all<{ id: string }>('SELECT account_id AS id FROM ai_learning')

    return {
      mail: new Set(mail.flatMap((row) => (row.id ? [row.id] : []))),
      // An event's key and a look's start with their connection, up to the first NUL.
      calendars: new Set(calendars.flatMap((row) => (row.key ? [row.key.split('\u0000')[0]] : []))),
      known: new Set(known.map((row) => row.id))
    }
  }

  /** The Segretario's data gone. */
  async clearData(): Promise<void> {
    for (const table of [
      'ai_events',
      'ai_activities',
      'ai_memory',
      'ai_memory_history',
      'ai_usage',
      'ai_learning',
      'ai_reading',
      'ai_lessons',
      'ai_drafts',
      'ai_notes',
      'ai_read',
      'ai_alerts',
      'ai_item_history',
      'ai_items',
      'ai_ready_drafts',
      'ai_briefings',
      'ai_event_preps',
      'ai_own_events',
      'ai_calendar_roles',
      'ai_projects',
      'ai_project_threads',
      'ai_project_resources',
      'ai_proposals',
      'ai_saved_searches',
      'ai_work',
      'ai_gone'
    ]) {
      await this.sql.run(`DELETE FROM ${table}`)
    }

    // The facts the engine kept go too; the schema's version stays.
    await this.sql.run("DELETE FROM ai_meta WHERE key <> 'schema_version'")
  }
}
