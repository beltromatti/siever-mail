import { messages } from '../../i18n'
import { placeholders, type Sql } from '../sql'
import { REFUSALS } from './registry.messages'
import {
  lookedAt,
  RegistryRefusal,
  RevisionConflict,
  type Actor,
  type MessageAnchor,
  type NoteNature,
  type NotePriority,
  type NoteRecord,
  type ThreadRef
} from './types'

interface NoteRow {
  account_id: string
  message_key: string
  thread_id: string
  direction: string
  summary: string
  state: string
  priority: string
  reason: string
  due: string | null
  message_date: string
  twin_account_id: string | null
  revision: number
  run_id: string | null
  written_by: string
  created_at: number
  updated_at: number | null
}

const COLUMNS = `account_id, message_key, thread_id, direction, summary, state, priority, reason, due,
  message_date, twin_account_id, revision, run_id, written_by, created_at, updated_at`

const NATURES: ReadonlyArray<NoteNature> = [
  'da_rispondere',
  'da_fare',
  'in_attesa',
  'informativo',
  'rumore'
]
const PRIORITIES: ReadonlyArray<NotePriority> = ['alta', 'media', 'bassa']

function recordOf(row: NoteRow): NoteRecord {
  const createdAt = Number(row.created_at)
  return {
    accountId: row.account_id,
    messageKey: row.message_key,
    threadId: row.thread_id,
    direction: row.direction === 'out' ? 'out' : 'in',
    summary: row.summary,
    nature: row.state as NoteNature,
    priority: row.priority as NotePriority,
    reason: row.reason,
    due: row.due,
    messageDate: row.message_date,
    twinAccountId: row.twin_account_id,
    revision: Number(row.revision),
    runId: row.run_id,
    writtenBy:
      row.written_by === 'utente' || row.written_by === 'sistema' ? row.written_by : 'segretario',
    createdAt,
    updatedAt: row.updated_at === null ? createdAt : Number(row.updated_at)
  }
}

export interface NoteInput {
  summary: string
  nature: NoteNature
  priority: NotePriority
  reason: string
  due: string | null
}

/**
 * The notes: what each message said for the user when it came. History —
 * written as the message is read, corrected only when it was read wrong.
 * That it was read is the system's mark (`ReadMarks`), not the note's.
 */
export class NoteStore {
  constructor(private readonly sql: Sql) {}

  async get(accountId: string, messageKey: string): Promise<NoteRecord | null> {
    const row = await this.sql.get<NoteRow>(
      `SELECT ${COLUMNS} FROM ai_notes WHERE account_id = ? AND message_key = ?`,
      accountId,
      messageKey
    )
    return row ? recordOf(row) : null
  }

  async many(
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<NoteRecord[]> {
    const byAccount = new Map<string, string[]>()

    for (const message of messages) {
      byAccount.set(message.accountId, [
        ...(byAccount.get(message.accountId) ?? []),
        message.messageKey
      ])
    }

    const rows = await Promise.all(
      [...byAccount].map(([accountId, keys]) =>
        this.sql.all<NoteRow>(
          `SELECT ${COLUMNS} FROM ai_notes WHERE account_id = ? AND message_key IN (${placeholders(keys)})`,
          accountId,
          ...keys
        )
      )
    )
    return rows.flat().map(recordOf)
  }

  /** Every note of these conversations, oldest message first. */
  async ofThreads(threads: ReadonlyArray<ThreadRef>): Promise<NoteRecord[]> {
    if (threads.length === 0) {
      return []
    }

    const rows = await this.sql.all<NoteRow>(
      `SELECT ${COLUMNS} FROM ai_notes
       WHERE ${threads.map(() => '(account_id = ? AND thread_id = ?)').join(' OR ')}
       ORDER BY message_date`,
      ...threads.flatMap((thread) => [thread.accountId, thread.threadId])
    )
    return rows.map(recordOf)
  }

  /** The notes written since a moment on messages that say something — noise and copies aside. */
  async writtenSince(sinceMs: number): Promise<NoteRecord[]> {
    const rows = await this.sql.all<NoteRow>(
      `SELECT ${COLUMNS} FROM ai_notes
       WHERE created_at > ? AND state <> 'rumore' AND twin_account_id IS NULL
       ORDER BY message_date`,
      sinceMs
    )
    return rows.map(recordOf)
  }

  /**
   * Writes a message's note — or corrects it. A note the user corrected is
   * not rewritten by a run in the background — unless it carries the user's
   * words on it (§10.1).
   */
  async write(
    anchor: MessageAnchor & { direction: 'in' | 'out'; messageDate: string },
    input: NoteInput,
    actor: Actor,
    options: { twinAccountId?: string | null; seenRevision?: number } = {}
  ): Promise<{ record: NoteRecord; created: boolean }> {
    const summary = input.summary.trim()

    if (!summary) {
      throw new RegistryRefusal(
        'La nota ha bisogno di una sintesi.',
        undefined,
        messages(REFUSALS).noteNeedsSummary
      )
    }

    if (!NATURES.includes(input.nature)) {
      throw new RegistryRefusal(
        `Natura non valida: ${input.nature}. Una di: ${NATURES.join(', ')}.`
      )
    }

    if (!PRIORITIES.includes(input.priority)) {
      throw new RegistryRefusal(
        `Importanza non valida: ${input.priority}. Una di: ${PRIORITIES.join(', ')}.`
      )
    }

    if (input.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.due)) {
      throw new RegistryRefusal(
        'scadenza: una data come AAAA-MM-GG.',
        undefined,
        messages(REFUSALS).notADate('scadenza')
      )
    }

    const now = Date.now()
    const runId = actor.runId ?? null
    const twin = options.twinAccountId ?? null

    // Read, check, write only over what was read: someone writing in between (the user's
    // correction, another run) sends it round again, to be checked against what they wrote.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.get(anchor.accountId, anchor.messageKey)

      if (
        current &&
        options.seenRevision !== undefined &&
        current.revision !== options.seenRevision
      ) {
        const says = `«${current.summary}» (${current.nature}, importanza ${current.priority})`
        const byUser = current.writtenBy === 'utente'
        const look = lookedAt(options.seenRevision)
        throw new RevisionConflict(
          look === 'mai'
            ? `Questo messaggio ha già la sua nota${byUser ? ', dell’utente' : ''}, e non l’hai ancora letta: dice ${says}. Se c’è da correggerla, correggila.`
            : look === 'comparsa'
              ? `Da quando l’hai letto, questo messaggio ha avuto la sua nota${byUser ? ', dall’utente' : ''}: dice ${says}. Se c’è da correggerla, correggila.`
              : `La nota di questo messaggio è cambiata da quando l’hai letta${byUser ? ', per mano dell’utente' : ''}: ora dice ${says}. Se la tua correzione vale ancora, rifalla.`,
          current
        )
      }

      if (current?.writtenBy === 'utente' && actor.background && !actor.onUsersWord) {
        throw new RegistryRefusal(
          'La nota di questo messaggio l’ha corretta l’utente: non la riscrivere.',
          current
        )
      }

      if (!current) {
        const row = await this.sql.get<NoteRow>(
          `INSERT INTO ai_notes (
            account_id, message_key, thread_id, direction, summary, state, priority, reason, due,
            message_date, created_at, dismissed_at, twin_account_id, revision, run_id, written_by,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)
          ON CONFLICT(account_id, message_key) DO NOTHING
          RETURNING ${COLUMNS}`,
          anchor.accountId,
          anchor.messageKey,
          anchor.threadId,
          anchor.direction,
          summary,
          input.nature,
          input.priority,
          input.reason.trim(),
          input.due,
          anchor.messageDate,
          now,
          twin,
          runId,
          actor.by,
          now
        )

        if (row) {
          return { record: recordOf(row), created: true }
        }

        continue
      }

      const changed = await this.sql.run(
        `UPDATE ai_notes SET summary = ?, state = ?, priority = ?, reason = ?, due = ?,
           twin_account_id = ?, run_id = ?, written_by = ?, revision = revision + 1,
           updated_at = ?
         WHERE account_id = ? AND message_key = ? AND revision = ?`,
        summary,
        input.nature,
        input.priority,
        input.reason.trim(),
        input.due,
        twin,
        runId,
        actor.by,
        now,
        anchor.accountId,
        anchor.messageKey,
        current.revision
      )

      if (changed === 1) {
        const record = await this.get(anchor.accountId, anchor.messageKey)
        return { record: record!, created: false }
      }
    }

    throw new RegistryRefusal(
      'La nota di questo messaggio cambia di continuo: riprova tra poco.',
      undefined,
      messages(REFUSALS).noteKeepsChanging
    )
  }
}
