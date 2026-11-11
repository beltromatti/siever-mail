import { placeholders, type Sql } from '../sql'

/**
 * That a message was read (§4.1): the system's mark, set as the reading that
 * had it ends — or for a copy of a message read in another account —, never
 * the model's. What the planner asks of the mail, as the change log's point
 * is what it asks of a calendar; a note says what the message wanted, not
 * that it was read.
 */
export class ReadMarks {
  constructor(private readonly sql: Sql) {}

  /** `twinAccountId`: read there, a copy — the mark goes with that account (§11.4). */
  async mark(
    accountId: string,
    messageKeys: ReadonlyArray<string>,
    runId: string | null,
    twinAccountId: string | null = null
  ): Promise<void> {
    const now = Date.now()

    for (const messageKey of messageKeys) {
      await this.sql.run(
        `INSERT INTO ai_read (account_id, message_key, run_id, read_at, twin_account_id)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, message_key) DO NOTHING`,
        accountId,
        messageKey,
        runId,
        now,
        twinAccountId
      )
    }
  }

  /** Of these messages of an account, those read. */
  async read(accountId: string, messageKeys: ReadonlyArray<string>): Promise<Set<string>> {
    if (messageKeys.length === 0) {
      return new Set()
    }

    const rows = await this.sql.all<{ message_key: string }>(
      `SELECT message_key FROM ai_read WHERE account_id = ? AND message_key IN (${placeholders(messageKeys)})`,
      accountId,
      ...messageKeys
    )
    return new Set(rows.map((row) => row.message_key))
  }
}
