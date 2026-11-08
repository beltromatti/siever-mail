import { randomUUID } from 'node:crypto'

import { placeholders, type Sql } from '../sql'
import {
  RegistryRefusal,
  type Actor,
  type ProposalRecord,
  type ProposalStatus,
  type ThreadRef
} from './types'

interface ProposalRow {
  id: string
  kind: string
  account_id: string | null
  message_key: string | null
  thread_id: string | null
  title: string
  payload_json: string
  status: string
  run_id: string | null
  revision: number
  created_at: number
  decided_at: number | null
  result_json: string | null
}

function proposalOf(row: ProposalRow): ProposalRecord {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id,
    messageKey: row.message_key,
    threadId: row.thread_id,
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    status: row.status as ProposalStatus,
    runId: row.run_id,
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at),
    result: row.result_json ? (JSON.parse(row.result_json) as Record<string, unknown>) : null
  }
}

/**
 * The proposals: what the Segretario recommends and may not do alone — an
 * event that would invite others, a message to copy into a company archive.
 * One open proposal of a kind per message: proposing again updates it.
 */
export class ProposalStore {
  constructor(private readonly sql: Sql) {}

  async get(id: string): Promise<ProposalRecord | null> {
    const row = await this.sql.get<ProposalRow>('SELECT * FROM ai_proposals WHERE id = ?', id)
    return row ? proposalOf(row) : null
  }

  async propose(
    input: {
      kind: string
      title: string
      payload: Record<string, unknown>
      accountId?: string | null
      messageKey?: string | null
      threadId?: string | null
      /**
       * The open proposal this one takes the place of. Without it, a proposal
       * of the same kind on the same message is written over — one archiving
       * per message — unless the kind is one a message can hold several of
       * (`perMessage: false`: two appointments in one mail are two events).
       */
      replaces?: string | null
      perMessage?: boolean
    },
    actor: Actor
  ): Promise<{ record: ProposalRecord; created: boolean }> {
    const title = input.title.trim()

    if (!title) {
      throw new RegistryRefusal('Una proposta ha bisogno di un titolo.')
    }

    const existing = input.replaces
      ? await this.sql.get<ProposalRow>(
          "SELECT * FROM ai_proposals WHERE id = ? AND status = 'aperta'",
          input.replaces
        )
      : input.perMessage !== false && input.accountId && input.messageKey
        ? await this.sql.get<ProposalRow>(
            `SELECT * FROM ai_proposals
             WHERE kind = ? AND account_id = ? AND message_key = ? AND status = 'aperta'`,
            input.kind,
            input.accountId,
            input.messageKey
          )
        : null

    // Written over only while it is still open: one the user answered meanwhile keeps their
    // answer, and this becomes a proposal of its own.
    if (
      existing &&
      (await this.sql.run(
        `UPDATE ai_proposals SET title = ?, payload_json = ?, run_id = ?, revision = revision + 1
         WHERE id = ? AND status = 'aperta'`,
        title,
        JSON.stringify(input.payload),
        actor.runId ?? null,
        existing.id
      )) === 1
    ) {
      return { record: (await this.get(existing.id))!, created: false }
    }

    const id = randomUUID()
    await this.sql.run(
      `INSERT INTO ai_proposals (
        id, kind, account_id, message_key, thread_id, title, payload_json, status, run_id,
        created_at, decided_at, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'aperta', ?, ?, NULL, NULL)`,
      id,
      input.kind,
      input.accountId ?? null,
      input.messageKey ?? null,
      input.threadId ?? null,
      title,
      JSON.stringify(input.payload),
      actor.runId ?? null,
      Date.now()
    )
    return { record: (await this.get(id))!, created: true }
  }

  /** The user accepted (with what they changed, to learn from) or set it aside. */
  async decide(
    id: string,
    status: Exclude<ProposalStatus, 'aperta'>,
    result: Record<string, unknown> | null = null
  ): Promise<ProposalRecord> {
    const changed = await this.sql.run(
      `UPDATE ai_proposals SET status = ?, decided_at = ?, result_json = ?
       WHERE id = ? AND status = 'aperta'`,
      status,
      Date.now(),
      result ? JSON.stringify(result) : null,
      id
    )
    const record = await this.get(id)

    if (!record) {
      throw new RegistryRefusal('Questa proposta non c’è più.')
    }

    if (changed === 0 && record.status !== status) {
      throw new RegistryRefusal('Questa proposta è già stata decisa.', record)
    }

    return record
  }

  /** The open proposals, the newest first: of a kind, of these messages, or all. */
  async open(
    filter: {
      kind?: string
      messages?: ReadonlyArray<{ accountId: string; messageKey: string }>
      threads?: ReadonlyArray<ThreadRef>
    } = {}
  ): Promise<ProposalRecord[]> {
    const where = ["status = 'aperta'"]
    const params: unknown[] = []

    if (filter.kind) {
      where.push('kind = ?')
      params.push(filter.kind)
    }

    if (filter.messages) {
      if (filter.messages.length === 0) {
        return []
      }

      where.push(
        `(${filter.messages.map(() => '(account_id = ? AND message_key = ?)').join(' OR ')})`
      )
      params.push(...filter.messages.flatMap((message) => [message.accountId, message.messageKey]))
    }

    if (filter.threads) {
      if (filter.threads.length === 0) {
        return []
      }

      where.push(`(${filter.threads.map(() => '(account_id = ? AND thread_id = ?)').join(' OR ')})`)
      params.push(...filter.threads.flatMap((thread) => [thread.accountId, thread.threadId]))
    }

    const rows = await this.sql.all<ProposalRow>(
      `SELECT * FROM ai_proposals WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
      ...params
    )
    return rows.map(proposalOf)
  }

  /** The proposals still waiting on these messages — of one kind, or any — no longer hold. */
  async supersedeFor(
    accountId: string,
    messageKeys: ReadonlyArray<string>,
    kind?: string
  ): Promise<number> {
    if (messageKeys.length === 0) {
      return 0
    }

    return this.sql.run(
      `UPDATE ai_proposals SET status = 'superata', decided_at = ?
       WHERE status = 'aperta' AND account_id = ? AND message_key IN (${placeholders(messageKeys)})
       ${kind ? 'AND kind = ?' : ''}`,
      Date.now(),
      accountId,
      ...messageKeys,
      ...(kind ? [kind] : [])
    )
  }
}
