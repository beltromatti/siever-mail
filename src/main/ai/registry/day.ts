import type { Sql } from '../sql'

export interface DayLetter {
  day: string
  text: string
  writtenAt: number
}

/**
 * What the Segretario writes about a day — the letter at the top of Oggi —
 * and about a meeting, to prepare it. Texts that describe the present:
 * each says when it was written, so the page and the planner can tell how
 * far behind the day it is.
 */
export class DayStore {
  constructor(private readonly sql: Sql) {}

  async letter(day: string): Promise<DayLetter | null> {
    const row = await this.sql.get<{ day: string; text: string; created_at: number }>(
      'SELECT day, text, created_at FROM ai_briefings WHERE day = ?',
      day
    )
    return row ? { day: row.day, text: row.text, writtenAt: Number(row.created_at) } : null
  }

  async saveLetter(day: string, text: string): Promise<DayLetter> {
    const writtenAt = Date.now()
    await this.sql.run(
      `INSERT INTO ai_briefings (day, text, basis, created_at) VALUES (?, ?, '[]', ?)
       ON CONFLICT(day) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`,
      day,
      text.trim(),
      writtenAt
    )
    return { day, text: text.trim(), writtenAt }
  }

  async prep(eventKey: string): Promise<{ text: string; writtenAt: number } | null> {
    const row = await this.sql.get<{ text: string; written_at: number }>(
      'SELECT text, written_at FROM ai_event_preps WHERE event_key = ?',
      eventKey
    )
    return row ? { text: row.text, writtenAt: Number(row.written_at) } : null
  }

  async preps(eventKeys: ReadonlyArray<string>): Promise<Map<string, string>> {
    if (eventKeys.length === 0) {
      return new Map()
    }

    const rows = await this.sql.all<{ event_key: string; text: string }>(
      `SELECT event_key, text FROM ai_event_preps WHERE event_key IN (${eventKeys.map(() => '?').join(', ')})`,
      ...eventKeys
    )
    return new Map(rows.map((row) => [row.event_key, row.text]))
  }

  async savePrep(eventKey: string, text: string, runId: string | null): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_event_preps (event_key, text, run_id, written_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_key) DO UPDATE SET text = excluded.text, run_id = excluded.run_id,
         written_at = excluded.written_at`,
      eventKey,
      text.trim(),
      runId,
      Date.now()
    )
  }

  async clear(): Promise<void> {
    await this.sql.run('DELETE FROM ai_briefings')
    await this.sql.run('DELETE FROM ai_event_preps')
  }
}
