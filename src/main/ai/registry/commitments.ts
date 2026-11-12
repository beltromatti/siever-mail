import { messages } from '../../i18n'
import { placeholders, type Sql } from '../sql'
import { REASONS, REFUSALS } from './registry.messages'
import {
  RegistryRefusal,
  lookedAt,
  RevisionConflict,
  type Actor,
  type CommitmentHistoryEntry,
  type CommitmentKind,
  type CommitmentOrigin,
  type CommitmentRecord,
  type CommitmentStatus,
  type Evidence,
  type ThreadRef
} from './types'

interface ItemRow {
  id: number
  account_id: string | null
  thread_id: string | null
  message_key: string | null
  event_key: string | null
  project_id: string | null
  kind: string
  text: string
  due: string | null
  status: string
  until: string | null
  closed_by: string | null
  reason: string | null
  evidence_key: string | null
  question: string | null
  created_by: string
  run_id: string | null
  revision: number
  created_at: number
  updated_at: number | null
  closed_at: number | null
}

const COLUMNS = `id, account_id, thread_id, message_key, event_key, project_id, kind, text, due, status, until,
  closed_by, reason, evidence_key, question, created_by, run_id, revision, created_at, updated_at,
  closed_at`

/** How many times a write is tried again when another writer got there between the read and the write. */
const WRITE_ATTEMPTS = 4

/** Where a row says an open thing comes from. */
function originOf(row: ItemRow): CommitmentOrigin {
  if (row.account_id !== null && row.thread_id !== null && row.message_key !== null) {
    return {
      kind: 'messaggio',
      accountId: row.account_id,
      threadId: row.thread_id,
      messageKey: row.message_key
    }
  }

  if (row.event_key !== null) {
    return { kind: 'evento', eventKey: row.event_key }
  }

  return row.project_id !== null
    ? { kind: 'utente', projectId: row.project_id }
    : { kind: 'utente' }
}

/**
 * An origin as the table's columns — account, conversation, message, event,
 * project: the message's, the event's, or the user's word with the project
 * it is about, if any.
 */
function originColumns(
  origin: CommitmentOrigin
): [string | null, string | null, string | null, string | null, string | null] {
  return origin.kind === 'messaggio'
    ? [origin.accountId, origin.threadId, origin.messageKey, null, null]
    : origin.kind === 'evento'
      ? [null, null, null, origin.eventKey, null]
      : [null, null, null, null, origin.projectId ?? null]
}

function recordOf(row: ItemRow): CommitmentRecord {
  const createdAt = Number(row.created_at)
  return {
    id: Number(row.id),
    origin: originOf(row),
    kind: row.kind as CommitmentKind,
    text: row.text,
    due: row.due,
    status: row.status as CommitmentStatus,
    until: row.until,
    setBy: row.closed_by === 'utente' || row.closed_by === 'sistema' ? row.closed_by : 'segretario',
    reason: row.reason,
    evidenceKey: row.evidence_key,
    question: row.question,
    createdBy:
      row.created_by === 'utente' || row.created_by === 'sistema' ? row.created_by : 'segretario',
    runId: row.run_id,
    revision: Number(row.revision),
    createdAt,
    updatedAt: row.updated_at === null ? createdAt : Number(row.updated_at),
    closedAt: row.closed_at === null ? null : Number(row.closed_at)
  }
}

/** What history keeps of a commitment: the fields a change can touch. */
function snapshotOf(record: CommitmentRecord): Partial<CommitmentRecord> {
  return {
    kind: record.kind,
    text: record.text,
    due: record.due,
    status: record.status,
    until: record.until,
    setBy: record.setBy,
    reason: record.reason,
    evidenceKey: record.evidenceKey,
    question: record.question,
    origin: record.origin,
    revision: record.revision
  }
}

/** The same thing said again with other spacing or punctuation is the same thing. */
export function sameWording(left: string, right: string): boolean {
  const fold = (text: string): string =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  return fold(left) === fold(right)
}

/** A day as AAAA-MM-GG, or null; anything else is refused. */
function dayOrNull(value: string | null | undefined, name: string): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new RegistryRefusal(
      `${name}: una data come AAAA-MM-GG.`,
      undefined,
      messages(REFUSALS).notADate(name)
    )
  }

  return value
}

/**
 * Where open things come from, to choose them by: conversations, events,
 * and — for what the user said — the projects it is about. Given, a thing
 * must come from one of them; not given, from anywhere.
 */
export interface Places {
  threads?: ReadonlyArray<ThreadRef>
  events?: ReadonlyArray<string>
  projects?: ReadonlyArray<string>
}

/** `Places` as a condition: undefined for anywhere, null for nowhere (all given empty). */
function placesWhere(places: Places): { sql: string; params: unknown[] } | null | undefined {
  if (!places.threads && !places.events && !places.projects) {
    return undefined
  }

  const threads = places.threads ?? []
  const events = places.events ?? []
  const projects = places.projects ?? []
  const conditions = [
    ...threads.map(() => '(account_id = ? AND thread_id = ?)'),
    ...(events.length > 0 ? [`event_key IN (${placeholders(events)})`] : []),
    ...(projects.length > 0 ? [`project_id IN (${placeholders(projects)})`] : [])
  ]

  return conditions.length === 0
    ? null
    : {
        sql: `(${conditions.join(' OR ')})`,
        params: [
          ...threads.flatMap((thread) => [thread.accountId, thread.threadId]),
          ...events,
          ...projects
        ]
      }
}

const STATUS_WORDS: Record<CommitmentStatus, string> = {
  aperta: 'aperta',
  fatta: 'fatta',
  non_serve: 'non serve più',
  rinviata: 'rinviata'
}

/**
 * The commitments — what is open between the user and the world — with
 * their whole life: done, not needed, put off, opened again, each step
 * kept with who took it and why. Every write goes through a revision, so
 * two writers never silently overwrite each other; and what the user
 * decided is not overturned by a run in the background unless a message
 * newer than the decision says otherwise.
 */
export class CommitmentStore {
  constructor(private readonly sql: Sql) {}

  async get(id: number): Promise<CommitmentRecord | null> {
    const row = await this.sql.get<ItemRow>(`SELECT ${COLUMNS} FROM ai_items WHERE id = ?`, id)
    return row ? recordOf(row) : null
  }

  async many(ids: ReadonlyArray<number>): Promise<CommitmentRecord[]> {
    if (ids.length === 0) {
      return []
    }

    const rows = await this.sql.all<ItemRow>(
      `SELECT ${COLUMNS} FROM ai_items WHERE id IN (${placeholders(ids)}) ORDER BY id`,
      ...ids
    )
    return rows.map(recordOf)
  }

  /**
   * These conversations' commitments: those still open or put off, and
   * those that ended in the last `closedWithinDays` — what a reader of the
   * conversation needs, with what was settled lately so it is not opened
   * again.
   */
  async ofThreads(
    threads: ReadonlyArray<ThreadRef>,
    closedWithinDays = 14
  ): Promise<CommitmentRecord[]> {
    return this.ofPlaces({ threads }, closedWithinDays)
  }

  /** The same, of these places: conversations, events, a project — a project's, an event's panel. */
  async ofPlaces(places: Places, closedWithinDays = 14): Promise<CommitmentRecord[]> {
    const where = placesWhere(places)

    if (!where) {
      return []
    }

    const since = Date.now() - closedWithinDays * 24 * 60 * 60 * 1000
    const rows = await this.sql.all<ItemRow>(
      `SELECT ${COLUMNS} FROM ai_items
       WHERE ${where.sql}
         AND (status IN ('aperta', 'rinviata') OR COALESCE(updated_at, created_at) >= ?)
       ORDER BY CASE status WHEN 'aperta' THEN 0 WHEN 'rinviata' THEN 1 ELSE 2 END, created_at`,
      ...where.params,
      since
    )
    return rows.map(recordOf)
  }

  /**
   * What was closed (done, or not needed) since a moment, the latest first:
   * from these places — conversations, events — or anywhere.
   */
  async closedSince(
    since: number,
    filter: Places & { kinds?: ReadonlyArray<CommitmentKind> } = {}
  ): Promise<CommitmentRecord[]> {
    const where = ["status IN ('fatta', 'non_serve')", 'updated_at >= ?']
    const params: unknown[] = [since]

    if (filter.kinds && filter.kinds.length > 0) {
      where.push(`kind IN (${placeholders(filter.kinds)})`)
      params.push(...filter.kinds)
    }

    const places = placesWhere(filter)

    if (places === null) {
      return []
    }

    if (places) {
      where.push(places.sql)
      params.push(...places.params)
    }

    return (
      await this.sql.all<ItemRow>(
        `SELECT ${COLUMNS} FROM ai_items WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 100`,
        ...params
      )
    ).map(recordOf)
  }

  /** What is open, the nearest due first, then the newest: across all accounts, or these. */
  async open(
    filter: {
      accountIds?: ReadonlyArray<string>
      kinds?: ReadonlyArray<CommitmentKind>
      /** Due on or before this day, AAAA-MM-GG. */
      dueBy?: string
      includeDeferred?: boolean
    } & Places = {}
  ): Promise<CommitmentRecord[]> {
    const where: string[] = [
      filter.includeDeferred ? "status IN ('aperta', 'rinviata')" : "status = 'aperta'"
    ]
    const params: unknown[] = []

    if (filter.accountIds) {
      if (filter.accountIds.length === 0) {
        return []
      }

      where.push(`account_id IN (${placeholders(filter.accountIds)})`)
      params.push(...filter.accountIds)
    }

    if (filter.kinds && filter.kinds.length > 0) {
      where.push(`kind IN (${placeholders(filter.kinds)})`)
      params.push(...filter.kinds)
    }

    if (filter.dueBy) {
      where.push('due IS NOT NULL AND due <= ?')
      params.push(filter.dueBy)
    }

    const places = placesWhere(filter)

    if (places === null) {
      return []
    }

    if (places) {
      where.push(places.sql)
      params.push(...places.params)
    }

    const rows = await this.sql.all<ItemRow>(
      `SELECT ${COLUMNS} FROM ai_items WHERE ${where.join(' AND ')}
       ORDER BY due IS NULL, due, created_at DESC`,
      ...params
    )
    return rows.map(recordOf)
  }

  /**
   * Opens a commitment, from where it comes: a message, an event, or the
   * user's word. The same thing already open from the same place — the
   * conversation, the event, or the user's word —, worded alike, is the one
   * returned: opening twice opens once. The same thing the user closed is
   * not opened again from the background: from a message, unless the
   * message is newer than their decision; from an event, at all — a newer
   * fact opens it again with `riapri`, saying which.
   */
  async create(
    origin: CommitmentOrigin & { dateIso?: string },
    input: { kind: CommitmentKind; text: string; due?: string | null; question?: string | null },
    actor: Actor
  ): Promise<{ record: CommitmentRecord; created: boolean; historyId: number | null }> {
    const text = input.text.trim()

    if (!text) {
      throw new RegistryRefusal(
        'Una cosa aperta ha bisogno di un testo.',
        undefined,
        messages(REFUSALS).itemNeedsText
      )
    }

    const due = dayOrNull(input.due, 'scadenza')
    const sameKind = (await this.fromSamePlace(origin, input.kind)).filter((candidate) =>
      sameWording(candidate.text, text)
    )
    const existing = sameKind.find(
      (candidate) => candidate.status === 'aperta' || candidate.status === 'rinviata'
    )

    if (existing) {
      return { record: existing, created: false, historyId: null }
    }

    const decided = actor.background
      ? sameKind.find(
          (candidate) =>
            candidate.setBy === 'utente' &&
            (candidate.status === 'fatta' || candidate.status === 'non_serve')
        )
      : undefined

    if (
      decided &&
      !(
        origin.kind === 'messaggio' &&
        origin.dateIso &&
        Date.parse(origin.dateIso) > decided.updatedAt
      )
    ) {
      // Only a message newer than the decision can change it from the background: said so, not
      // a way that the user's word would then refuse.
      throw new RegistryRefusal(
        `L'utente ha già segnato questa cosa come ${decided.status === 'fatta' ? 'fatta' : 'non serve'} (#${decided.id}): ${
          origin.kind === 'messaggio'
            ? 'il messaggio non è più recente della sua decisione, quindi non riaprirla. Se un messaggio arrivato dopo la contraddice, riaprila (`riapri`) indicandolo come `prova`.'
            : 'è una sua decisione, lasciala com’è.'
        }`,
        decided
      )
    }

    const now = Date.now()
    const row = await this.sql.get<ItemRow>(
      `INSERT INTO ai_items (
        account_id, thread_id, message_key, event_key, project_id, kind, text, due, status, until,
        closed_by, reason, evidence_key, question, created_by, run_id, revision, created_at,
        updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aperta', NULL, ?, NULL, NULL, ?, ?, ?, 1, ?, ?, NULL)
      RETURNING ${COLUMNS}`,
      ...originColumns(origin),
      input.kind,
      text,
      due,
      actor.by,
      input.question?.trim() || null,
      actor.by,
      actor.runId ?? null,
      now,
      now
    )

    if (!row) {
      throw new Error('The commitment just written could not be read back.')
    }

    const record = recordOf(row)
    const historyId = await this.addHistory(
      record.id,
      actor,
      'apri',
      null,
      snapshotOf(record),
      null
    )
    return { record, created: true, historyId }
  }

  /**
   * The commitments of a kind from the same place as `origin`, whatever
   * their state: the conversation of a message, the event, or the user's
   * word — what a new one may repeat.
   */
  private async fromSamePlace(
    origin: CommitmentOrigin,
    kind: CommitmentKind
  ): Promise<CommitmentRecord[]> {
    const [where, ...params] =
      origin.kind === 'messaggio'
        ? ['account_id = ? AND thread_id = ?', origin.accountId, origin.threadId]
        : origin.kind === 'evento'
          ? ['event_key = ?', origin.eventKey]
          : ['message_key IS NULL AND event_key IS NULL']

    return (
      await this.sql.all<ItemRow>(
        `SELECT ${COLUMNS} FROM ai_items WHERE ${where} AND kind = ?`,
        ...params,
        kind
      )
    ).map(recordOf)
  }

  /** Changes what a commitment says: its words, its date, its kind, the question it asks. */
  async edit(
    id: number,
    changes: {
      text?: string
      due?: string | null
      kind?: CommitmentKind
      question?: string | null
      /** Where it comes from, put right: a message or an event it was not given, the project of the user's word. */
      origin?: CommitmentOrigin
    },
    actor: Actor,
    options: { seenRevision?: number; evidence?: Evidence; reason?: string } = {}
  ): Promise<{ record: CommitmentRecord; historyId: number }> {
    const due = changes.due === undefined ? undefined : dayOrNull(changes.due, 'scadenza')

    return this.write(
      id,
      actor,
      options,
      'aggiorna',
      (current) => ({
        text: changes.text?.trim() || current.text,
        due: due === undefined ? current.due : due,
        kind: changes.kind ?? current.kind,
        question:
          changes.question === undefined ? current.question : changes.question?.trim() || null,
        origin: changes.origin ?? current.origin,
        // What the user corrected is theirs: a run alone does not change it back.
        setBy: actor.by === 'utente' ? 'utente' : current.setBy
      }),
      options.reason ?? null
    )
  }

  /**
   * Done, not needed, put off until a day, or open again. Closing what is
   * already closed the same way changes nothing.
   */
  async setStatus(
    id: number,
    status: CommitmentStatus,
    actor: Actor,
    options: {
      seenRevision?: number
      evidence?: Evidence
      reason?: string | null
      until?: string | null
    } = {}
  ): Promise<{ record: CommitmentRecord; historyId: number | null }> {
    const until = status === 'rinviata' ? dayOrNull(options.until, 'fino a') : null

    if (status === 'rinviata' && !until) {
      throw new RegistryRefusal(
        'Per rinviare serve il giorno in cui torna aperta (`fino_a`).',
        undefined,
        messages(REFUSALS).postponeNeedsDay
      )
    }

    const current = await this.require(id)

    const unchanged = current.status === status && current.until === until

    // The same status again is nothing — unless it answers a question asked about it.
    if (unchanged && current.question === null) {
      return { record: current, historyId: null }
    }

    const action = unchanged
      ? 'conferma'
      : status === 'aperta'
        ? 'riapri'
        : status === 'rinviata'
          ? 'rinvia'
          : status === 'fatta'
            ? 'fatta'
            : 'non_serve'

    return this.write(
      id,
      actor,
      options,
      action,
      () => ({
        status,
        until,
        setBy: actor.by,
        reason: options.reason?.trim() || null,
        evidenceKey: options.evidence?.messageKey ?? null,
        // Whatever it asked the user, a decision answers.
        question: null
      }),
      options.reason ?? null
    )
  }

  /**
   * Several commitments that are one: the first is kept, the others close
   * as not needed, pointing to it.
   */
  async merge(
    keepId: number,
    dropIds: ReadonlyArray<number>,
    actor: Actor
  ): Promise<Array<{ record: CommitmentRecord; historyId: number | null }>> {
    const kept = await this.require(keepId)
    const dropped = dropIds.filter((candidate) => candidate !== keepId)
    const results: Array<{ record: CommitmentRecord; historyId: number | null }> = []

    // All or none: each one is looked at before any is closed.
    for (const id of dropped) {
      const record = await this.require(id)

      if (actor.background && record.setBy === 'utente') {
        throw new RegistryRefusal(
          `Su #${record.id} («${record.text}») ha deciso l'utente: non unirla da solo.`,
          record
        )
      }
    }

    for (const id of dropped) {
      results.push(
        await this.setStatus(id, 'non_serve', actor, {
          reason: messages(REASONS).sameAs(kept.text, kept.id)
        })
      )
    }

    return results
  }

  /**
   * Whether anything open changed since a moment — opened, closed, put off,
   * moved — other than by the day's own run, which writes the letter that
   * would be behind.
   */
  async changedSince(since: number): Promise<boolean> {
    return (
      (await this.sql.get(
        `SELECT 1 AS found FROM ai_items WHERE updated_at > ?
           AND (run_id IS NULL OR run_id NOT IN (SELECT id FROM ai_activities WHERE kind = 'giornata'))
         LIMIT 1`,
        since
      )) !== null
    )
  }

  /** What was put off until today opens again, by the app: the day came. */
  async wakeDeferred(today: string): Promise<CommitmentRecord[]> {
    const due = (
      await this.sql.all<ItemRow>(
        `SELECT ${COLUMNS} FROM ai_items WHERE status = 'rinviata' AND until IS NOT NULL AND until <= ?`,
        today
      )
    ).map(recordOf)
    const woken: CommitmentRecord[] = []

    for (const record of due) {
      const { record: opened } = await this.setStatus(
        record.id,
        'aperta',
        { by: 'sistema' },
        { reason: messages(REASONS).dayCame(record.until) }
      )
      woken.push(opened)
    }

    return woken
  }

  async history(id: number): Promise<CommitmentHistoryEntry[]> {
    const rows = await this.sql.all<{
      id: number
      item_id: number
      at: number
      actor: string
      run_id: string | null
      action: string
      before_json: string | null
      after_json: string
      reason: string | null
    }>('SELECT * FROM ai_item_history WHERE item_id = ? ORDER BY id', id)

    return rows.map((row) => ({
      id: Number(row.id),
      itemId: Number(row.item_id),
      at: Number(row.at),
      actor: row.actor as CommitmentHistoryEntry['actor'],
      runId: row.run_id,
      action: row.action,
      before: row.before_json ? (JSON.parse(row.before_json) as Partial<CommitmentRecord>) : null,
      after: JSON.parse(row.after_json) as Partial<CommitmentRecord>,
      reason: row.reason
    }))
  }

  /**
   * Puts a commitment back as it was before a change — a step of the
   * Segretario's the user undoes. Only while nothing changed it since: a
   * later change is not thrown away by an undo of an earlier one.
   */
  async undo(
    historyId: number,
    actor: Actor
  ): Promise<{ record: CommitmentRecord; historyId: number | null } | null> {
    const row = await this.sql.get<{
      item_id: number
      action: string
      before_json: string | null
      after_json: string
    }>(
      'SELECT item_id, action, before_json, after_json FROM ai_item_history WHERE id = ?',
      historyId
    )

    if (!row) {
      return null
    }

    const current = await this.require(Number(row.item_id))
    const after = JSON.parse(row.after_json) as Partial<CommitmentRecord>

    if (after.revision !== current.revision) {
      throw new RegistryRefusal(
        'Dopo questa modifica la cosa è cambiata ancora: non la rimetto com’era.',
        current,
        messages(REFUSALS).changedSinceUndo
      )
    }

    if (!row.before_json) {
      // Undoing an opening: it was not needed.
      return this.setStatus(current.id, 'non_serve', actor, {
        reason: messages(REASONS).undone
      })
    }

    // Kept before version 5, a snapshot named the message alone: its account is the same now.
    const before = JSON.parse(row.before_json) as Partial<CommitmentRecord> & {
      threadId?: string
      messageKey?: string
    }
    const origin: CommitmentOrigin =
      before.origin ??
      (before.threadId && before.messageKey && current.origin.kind === 'messaggio'
        ? {
            kind: 'messaggio',
            accountId: current.origin.accountId,
            threadId: before.threadId,
            messageKey: before.messageKey
          }
        : current.origin)
    return this.write(
      current.id,
      actor,
      {},
      'annulla',
      () => ({
        kind: before.kind,
        text: before.text,
        due: before.due,
        status: before.status,
        until: before.until,
        setBy: actor.by,
        reason: before.reason ?? null,
        evidenceKey: before.evidenceKey ?? null,
        question: before.question ?? null,
        origin
      }),
      'Annullato.'
    )
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private async require(id: number): Promise<CommitmentRecord> {
    const record = await this.get(id)

    if (!record) {
      throw new RegistryRefusal(
        `Non esiste una cosa aperta #${id}.`,
        undefined,
        messages(REFUSALS).itemGone(id)
      )
    }

    return record
  }

  /**
   * One write: read, check, write if nobody wrote in between — tried again
   * when somebody did and the caller was not working from an older look.
   */
  private async write(
    id: number,
    actor: Actor,
    options: { seenRevision?: number; evidence?: Evidence },
    action: string,
    change: (current: CommitmentRecord) => Partial<CommitmentRecord>,
    reason: string | null
  ): Promise<{ record: CommitmentRecord; historyId: number }> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const current = await this.require(id)

      if (options.seenRevision !== undefined && options.seenRevision !== current.revision) {
        const now = `${STATUS_WORDS[current.status]}${
          current.setBy === 'utente' ? ', per mano dell’utente' : ''
        } («${current.text}»${current.due ? `, entro ${current.due}` : ''})`
        throw new RevisionConflict(
          lookedAt(options.seenRevision) === 'mai'
            ? `Non hai ancora letto la cosa #${id}: è ${now}. Se ciò che volevi fare vale ancora, rifallo.`
            : `La cosa #${id} è cambiata da quando l'hai letta: ora è ${now}. Se ciò che volevi fare vale ancora, rifallo.`,
          current
        )
      }

      await this.guard(current, actor, options.evidence)

      const next = { ...current, ...change(current) }
      const now = Date.now()
      const closing = next.status === 'fatta' || next.status === 'non_serve'
      const changed = await this.sql.run(
        `UPDATE ai_items SET kind = ?, text = ?, due = ?, status = ?, until = ?, closed_by = ?,
           reason = ?, evidence_key = ?, question = ?, account_id = ?, thread_id = ?,
           message_key = ?, event_key = ?, project_id = ?, closed_at = ?, run_id = COALESCE(?, run_id),
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        next.kind,
        next.text,
        next.due,
        next.status,
        next.until,
        next.setBy,
        next.reason,
        next.evidenceKey,
        next.question,
        ...originColumns(next.origin),
        closing ? (current.closedAt ?? now) : null,
        actor.runId ?? null,
        now,
        id,
        current.revision
      )

      if (changed === 1) {
        const record = await this.require(id)
        const historyId = await this.addHistory(
          id,
          actor,
          action,
          snapshotOf(current),
          snapshotOf(record),
          reason
        )
        return { record, historyId }
      }
    }

    throw new RegistryRefusal(
      `La cosa #${id} cambia di continuo: riprova tra poco.`,
      undefined,
      messages(REFUSALS).itemKeepsChanging(id)
    )
  }

  /**
   * The user's word holds against a run in the background: it changes
   * what the user decided only with a message that came after the
   * decision, given as the proof. That the message is about the same thing
   * is the Segretario's judgement; that it is newer, the registry's.
   */
  private async guard(current: CommitmentRecord, actor: Actor, evidence?: Evidence): Promise<void> {
    if (actor.by !== 'segretario' || !actor.background || current.setBy !== 'utente') {
      return
    }

    const evidenceAt = evidence ? Date.parse(evidence.dateIso) : Number.NaN

    if (!(evidenceAt > current.updatedAt)) {
      throw new RegistryRefusal(
        `L'utente ha deciso lui su #${current.id} («${current.text}», ${STATUS_WORDS[current.status]}) il ${new Date(
          current.updatedAt
        ).toLocaleString(
          'it-IT'
        )}: cambiala solo se un messaggio arrivato dopo lo giustifica, e indicalo come prova.`,
        current
      )
    }
  }

  private async addHistory(
    itemId: number,
    actor: Actor,
    action: string,
    before: Partial<CommitmentRecord> | null,
    after: Partial<CommitmentRecord>,
    reason: string | null
  ): Promise<number> {
    const row = await this.sql.get<{ id: number }>(
      `INSERT INTO ai_item_history (item_id, at, actor, run_id, action, before_json, after_json, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      itemId,
      Date.now(),
      actor.by,
      actor.runId ?? null,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      reason
    )
    return Number(row?.id ?? 0)
  }
}
