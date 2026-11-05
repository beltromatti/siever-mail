import { placeholders, type Sql } from '../sql'
import {
  RegistryRefusal,
  RevisionConflict,
  type Actor,
  type MessageAnchor,
  type ReplyKind,
  type ReplyRecord,
  type ReplyStatus,
  type ThreadRef
} from './types'

interface ReplyRow {
  account_id: string
  message_key: string
  thread_id: string
  kind: string
  text: string
  doubts: string
  status: string
  stale_reason: string | null
  revision: number
  run_id: string | null
  created_at: number
  updated_at: number | null
}

const COLUMNS = `account_id, message_key, thread_id, kind, text, doubts, status, stale_reason, revision,
  run_id, created_at, updated_at`

function recordOf(row: ReplyRow): ReplyRecord {
  const createdAt = Number(row.created_at)
  return {
    accountId: row.account_id,
    messageKey: row.message_key,
    threadId: row.thread_id,
    kind: row.kind === 'sollecito' ? 'sollecito' : 'risposta',
    text: row.text,
    doubts: row.doubts,
    status: row.status as ReplyStatus,
    staleReason: row.stale_reason,
    revision: Number(row.revision),
    runId: row.run_id,
    createdAt,
    updatedAt: row.updated_at === null ? createdAt : Number(row.updated_at)
  }
}

/** Statuses in which a reply still waits for the user. */
export const LIVE_REPLY_STATUSES: ReadonlyArray<ReplyStatus> = ['pronta', 'da_rivedere']

/**
 * The replies the Segretario prepared ahead — answers, and reminders after
 * the user's own messages — one per message, local until the user takes
 * one up. A reply goes stale when the conversation moves on after it: it
 * is kept, to look at again, and no longer counted as ready.
 */
export class ReplyStore {
  constructor(private readonly sql: Sql) {}

  async get(accountId: string, messageKey: string): Promise<ReplyRecord | null> {
    const row = await this.sql.get<ReplyRow>(
      `SELECT ${COLUMNS} FROM ai_ready_drafts WHERE account_id = ? AND message_key = ?`,
      accountId,
      messageKey
    )
    return row ? recordOf(row) : null
  }

  /** The replies of these conversations still waiting for the user. */
  async liveOfThreads(threads: ReadonlyArray<ThreadRef>): Promise<ReplyRecord[]> {
    if (threads.length === 0) {
      return []
    }

    const rows = await this.sql.all<ReplyRow>(
      `SELECT ${COLUMNS} FROM ai_ready_drafts
       WHERE status IN ('pronta', 'da_rivedere')
         AND (${threads.map(() => '(account_id = ? AND thread_id = ?)').join(' OR ')})`,
      ...threads.flatMap((thread) => [thread.accountId, thread.threadId])
    )
    return rows.map(recordOf)
  }

  /** The replies in these statuses, the newest first; across all accounts, or these. */
  async withStatus(
    statuses: ReadonlyArray<ReplyStatus>,
    accountIds?: ReadonlyArray<string>
  ): Promise<ReplyRecord[]> {
    if (accountIds && accountIds.length === 0) {
      return []
    }

    const rows = await this.sql.all<ReplyRow>(
      `SELECT ${COLUMNS} FROM ai_ready_drafts
       WHERE status IN (${placeholders(statuses)})
       ${accountIds ? `AND account_id IN (${placeholders(accountIds)})` : ''}
       ORDER BY COALESCE(updated_at, created_at) DESC`,
      ...statuses,
      ...(accountIds ?? [])
    )
    return rows.map(recordOf)
  }

  /**
   * Prepares the reply to a message, or writes it again: it is ready, and
   * what made it stale no longer holds. One the user already used or set
   * aside is not offered again from the background.
   */
  async save(
    anchor: MessageAnchor,
    input: { kind: ReplyKind; text: string; doubts: string },
    actor: Actor
  ): Promise<{ record: ReplyRecord; created: boolean }> {
    const text = input.text.trim()

    if (!text) {
      throw new RegistryRefusal('Il testo della risposta è vuoto.')
    }

    const current = await this.get(anchor.accountId, anchor.messageKey)

    if (
      current &&
      (current.status === 'usata' || current.status === 'scartata') &&
      actor.background
    ) {
      throw new RegistryRefusal(
        current.status === 'usata'
          ? 'L’utente ha già usato la risposta preparata per questo messaggio.'
          : 'L’utente ha scartato la risposta preparata per questo messaggio: non riproporla.',
        current
      )
    }

    const now = Date.now()
    await this.sql.run(
      `INSERT INTO ai_ready_drafts (
        account_id, message_key, thread_id, kind, text, doubts, status, stale_reason, revision,
        run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pronta', NULL, 1, ?, ?, ?)
      ON CONFLICT(account_id, message_key) DO UPDATE SET
        thread_id = excluded.thread_id, kind = excluded.kind, text = excluded.text,
        doubts = excluded.doubts, status = 'pronta', stale_reason = NULL,
        revision = ai_ready_drafts.revision + 1, run_id = excluded.run_id,
        updated_at = excluded.updated_at`,
      anchor.accountId,
      anchor.messageKey,
      anchor.threadId,
      input.kind,
      text,
      input.doubts.trim(),
      actor.runId ?? null,
      now,
      now
    )
    return { record: (await this.get(anchor.accountId, anchor.messageKey))!, created: !current }
  }

  /**
   * Changes where a reply stands: used, set aside, confirmed (`pronta`
   * again), stale, overtaken. Returns null when there is none.
   */
  async setStatus(
    accountId: string,
    messageKey: string,
    status: ReplyStatus,
    actor: Actor,
    options: { reason?: string | null; seenRevision?: number } = {}
  ): Promise<ReplyRecord | null> {
    const current = await this.get(accountId, messageKey)

    if (!current) {
      return null
    }

    if (options.seenRevision !== undefined && options.seenRevision !== current.revision) {
      throw new RevisionConflict(
        `La risposta preparata è cambiata da quando l’hai letta: ora è ${
          current.status === 'pronta' ? 'pronta' : current.status.replace('_', ' ')
        }, e dice «${current.text.length > 600 ? `${current.text.slice(0, 600)}…` : current.text}». Se ciò che volevi fare vale ancora, rifallo.`,
        current
      )
    }

    if (
      actor.background &&
      (current.status === 'usata' || current.status === 'scartata') &&
      status !== current.status
    ) {
      throw new RegistryRefusal('L’utente ha già deciso di questa risposta.', current)
    }

    await this.sql.run(
      `UPDATE ai_ready_drafts SET status = ?, stale_reason = ?, revision = revision + 1, updated_at = ?
       WHERE account_id = ? AND message_key = ?`,
      status,
      status === 'da_rivedere' ? (options.reason?.trim() ?? null) : null,
      Date.now(),
      accountId,
      messageKey
    )
    return this.get(accountId, messageKey)
  }

  /**
   * A message came in a conversation after replies were prepared for its
   * earlier messages: those are to be looked at again. Returns them.
   */
  async markStaleBefore(
    thread: ThreadRef,
    beforeIso: string,
    reason: string
  ): Promise<ReplyRecord[]> {
    const stale = (
      await this.sql.all<ReplyRow>(
        `SELECT r.account_id, r.message_key, r.thread_id, r.kind, r.text, r.doubts, r.status,
           r.stale_reason, r.revision, r.run_id, r.created_at, r.updated_at
         FROM ai_ready_drafts r
         JOIN ai_notes n ON n.account_id = r.account_id AND n.message_key = r.message_key
         WHERE r.account_id = ? AND r.thread_id = ? AND r.status = 'pronta' AND n.message_date < ?
           AND r.updated_at < ?`,
        thread.accountId,
        thread.threadId,
        beforeIso,
        // A reply written or confirmed after the newer message came knows it already.
        Date.parse(beforeIso)
      )
    ).map(recordOf)

    for (const reply of stale) {
      await this.setStatus(
        reply.accountId,
        reply.messageKey,
        'da_rivedere',
        { by: 'sistema' },
        {
          reason
        }
      )
    }

    return stale
  }
}
