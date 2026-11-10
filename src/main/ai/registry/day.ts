import type { HandleLink } from '@shared/segretario'

import type { Sql } from '../sql'

export interface DayLetter {
  day: string
  text: string
  /** What its short names stand for. */
  links: HandleLink[]
  writtenAt: number
}

export interface MeetingPrep {
  text: string
  links: HandleLink[]
  writtenAt: number
}

/** What the user was told of an event, and when: one line for each change that could not wait (§13.3). */
export interface EventAlert {
  text: string
  toldAt: number
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
    const row = await this.sql.get<{
      day: string
      text: string
      links_json: string
      created_at: number
    }>('SELECT day, text, links_json, created_at FROM ai_briefings WHERE day = ?', day)
    return row
      ? {
          day: row.day,
          text: row.text,
          links: JSON.parse(row.links_json) as HandleLink[],
          writtenAt: Number(row.created_at)
        }
      : null
  }

  async saveLetter(
    day: string,
    text: string,
    links: ReadonlyArray<HandleLink>
  ): Promise<DayLetter> {
    const writtenAt = Date.now()
    await this.sql.run(
      `INSERT INTO ai_briefings (day, text, basis, links_json, created_at) VALUES (?, ?, '[]', ?, ?)
       ON CONFLICT(day) DO UPDATE SET text = excluded.text, links_json = excluded.links_json,
         created_at = excluded.created_at`,
      day,
      text.trim(),
      JSON.stringify(links),
      writtenAt
    )
    return { day, text: text.trim(), links: [...links], writtenAt }
  }

  async prep(eventKey: string): Promise<MeetingPrep | null> {
    const row = await this.sql.get<{ text: string; links_json: string; written_at: number }>(
      'SELECT text, links_json, written_at FROM ai_event_preps WHERE event_key = ?',
      eventKey
    )
    return row
      ? {
          text: row.text,
          links: JSON.parse(row.links_json) as HandleLink[],
          writtenAt: Number(row.written_at)
        }
      : null
  }

  async preps(eventKeys: ReadonlyArray<string>): Promise<Map<string, MeetingPrep>> {
    if (eventKeys.length === 0) {
      return new Map()
    }

    const rows = await this.sql.all<{
      event_key: string
      text: string
      links_json: string
      written_at: number
    }>(
      `SELECT event_key, text, links_json, written_at FROM ai_event_preps
       WHERE event_key IN (${eventKeys.map(() => '?').join(', ')})`,
      ...eventKeys
    )
    return new Map(
      rows.map((row) => [
        row.event_key,
        {
          text: row.text,
          links: JSON.parse(row.links_json) as HandleLink[],
          writtenAt: Number(row.written_at)
        }
      ])
    )
  }

  async savePrep(
    eventKey: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    runId: string | null
  ): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_event_preps (event_key, text, links_json, run_id, written_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO UPDATE SET text = excluded.text, links_json = excluded.links_json,
         run_id = excluded.run_id, written_at = excluded.written_at`,
      eventKey,
      text.trim(),
      JSON.stringify(links),
      runId,
      Date.now()
    )
  }

  /** Keeps what the user was told of an event: it stays with the event, as a message's with its note. */
  async recordAlert(eventKey: string, text: string, runId: string | null): Promise<void> {
    await this.sql.run(
      'INSERT INTO ai_event_alerts (event_key, text, run_id, told_at) VALUES (?, ?, ?, ?)',
      eventKey,
      text.trim(),
      runId,
      Date.now()
    )
  }

  /** What the user was told of an event, the oldest first. */
  async alerts(eventKey: string): Promise<EventAlert[]> {
    const rows = await this.sql.all<{ text: string; told_at: number }>(
      'SELECT text, told_at FROM ai_event_alerts WHERE event_key = ? ORDER BY told_at, id',
      eventKey
    )
    return rows.map((row) => ({ text: row.text, toldAt: Number(row.told_at) }))
  }

  async clear(): Promise<void> {
    await this.sql.run('DELETE FROM ai_briefings')
    await this.sql.run('DELETE FROM ai_event_preps')
    await this.sql.run('DELETE FROM ai_event_alerts')
  }
}
