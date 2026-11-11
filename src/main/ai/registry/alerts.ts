import type { Sql } from '../sql'

/** What `avvisa` is about: a message that came, or an event that changed. */
export type AlertTarget =
  { kind: 'message'; accountId: string; messageKey: string } | { kind: 'event'; eventKey: string }

/**
 * A line the Segretario said to tell the user, and when; `delivered`, that
 * it reached them — not where the user does not take its word (the
 * notifications off, the mailbox muted, every message wanted as it is).
 */
export interface Alert {
  text: string
  toldAt: number
  runId: string | null
  delivered: boolean
}

/**
 * What the Segretario told the user, thing by thing (§13.3): an action, kept
 * with what it was about — a message once, an event once for each change —
 * so a later run finds it reading that thing. Kept even where it did not
 * arrive: a copy of the message come to another mailbox is told there.
 * Never shown in the interface: the notification was its way of arriving.
 */
export class AlertStore {
  constructor(private readonly sql: Sql) {}

  async told(
    target: AlertTarget,
    text: string,
    runId: string | null,
    delivered = true
  ): Promise<void> {
    await this.sql.run(
      'INSERT INTO ai_alerts (account_id, message_key, event_key, text, run_id, told_at, delivered) VALUES (?, ?, ?, ?, ?, ?, ?)',
      target.kind === 'message' ? target.accountId : null,
      target.kind === 'message' ? target.messageKey : null,
      target.kind === 'event' ? target.eventKey : null,
      text.trim(),
      runId,
      Date.now(),
      delivered ? 1 : 0
    )
  }

  /** What the Segretario said to tell of a thing, the oldest first. */
  async of(target: AlertTarget): Promise<Alert[]> {
    const rows = await this.sql.all<{
      text: string
      told_at: number
      run_id: string | null
      delivered: number
    }>(
      `SELECT text, told_at, run_id, delivered FROM ai_alerts WHERE ${
        target.kind === 'message' ? 'account_id = ? AND message_key = ?' : 'event_key = ?'
      } ORDER BY told_at, id`,
      ...(target.kind === 'message' ? [target.accountId, target.messageKey] : [target.eventKey])
    )
    return rows.map((row) => ({
      text: row.text,
      toldAt: Number(row.told_at),
      runId: row.run_id,
      delivered: Number(row.delivered) !== 0
    }))
  }
}
