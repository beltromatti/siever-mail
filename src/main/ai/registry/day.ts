import type { HandleLink } from '@shared/segretario'
import { unlinked } from '@shared/segretario-links'

import type { Sql } from '../sql'
import { lookedAt, RevisionConflict } from './types'

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

  /**
   * Writes a day's letter — over that day's only if it is the one the run saw
   * (§4.6): `seenAt`, when the one it read was written; 0, that there was
   * none; `UNSEEN`, that it never looked. A letter is a day's: a new day's
   * starts from the state, not over yesterday's (§3.4).
   */
  async saveLetter(
    day: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    seenAt?: number
  ): Promise<DayLetter> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.letter(day)

      if (current && seenAt !== undefined && current.writtenAt !== seenAt) {
        const at = new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(
          new Date(current.writtenAt)
        )
        throw new RevisionConflict(
          `${
            lookedAt(seenAt) === 'mai'
              ? `La lettera di oggi c'è già, scritta alle ${at}, e non l'hai ancora letta`
              : `La lettera di oggi è stata riscritta alle ${at}, da quando l'hai letta`
          }: dice «${unlinked(current.text)}». Se la tua vale ancora, riscrivila partendo da lì.`,
          { revision: current.writtenAt }
        )
      }

      const writtenAt = Math.max(Date.now(), (current?.writtenAt ?? 0) + 1)
      const changed = current
        ? await this.sql.run(
            'UPDATE ai_briefings SET text = ?, links_json = ?, created_at = ? WHERE day = ? AND created_at = ?',
            text.trim(),
            JSON.stringify(links),
            writtenAt,
            day,
            current.writtenAt
          )
        : await this.sql.run(
            `INSERT INTO ai_briefings (day, text, basis, links_json, created_at) VALUES (?, ?, '[]', ?, ?)
             ON CONFLICT(day) DO NOTHING`,
            day,
            text.trim(),
            JSON.stringify(links),
            writtenAt
          )

      if (changed === 1) {
        return { day, text: text.trim(), links: [...links], writtenAt }
      }
    }

    throw new Error(`La lettera del ${day} non si scrive: cambia di continuo.`)
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

  /**
   * Writes a meeting's preparation — over the one there only if it is the one
   * the run saw (§4.6): `seenAt`, when the one it read was written; 0, that
   * there was none; `UNSEEN`, that it never looked.
   */
  async savePrep(
    eventKey: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    runId: string | null,
    seenAt?: number
  ): Promise<MeetingPrep> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.prep(eventKey)

      if (current && seenAt !== undefined && current.writtenAt !== seenAt) {
        throw new RevisionConflict(
          `${
            lookedAt(seenAt) === 'mai'
              ? 'Questo evento ha già una preparazione, e non l’hai ancora letta'
              : lookedAt(seenAt) === 'comparsa'
                ? 'Da quando l’hai letto, questo evento ha avuto una preparazione'
                : 'La preparazione di questo evento è cambiata da quando l’hai letta'
          }: dice «${unlinked(current.text)}». Se la tua vale ancora, riscrivila tenendo ciò che serve.`,
          { revision: current.writtenAt }
        )
      }

      const now = Math.max(Date.now(), (current?.writtenAt ?? 0) + 1)
      const changed = current
        ? await this.sql.run(
            `UPDATE ai_event_preps SET text = ?, links_json = ?, run_id = ?, written_at = ?
             WHERE event_key = ? AND written_at = ?`,
            text.trim(),
            JSON.stringify(links),
            runId,
            now,
            eventKey,
            current.writtenAt
          )
        : await this.sql.run(
            `INSERT INTO ai_event_preps (event_key, text, links_json, run_id, written_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(event_key) DO NOTHING`,
            eventKey,
            text.trim(),
            JSON.stringify(links),
            runId,
            now
          )

      if (changed === 1) {
        return { text: text.trim(), links: [...links], writtenAt: now }
      }
    }

    throw new Error(`La preparazione di ${eventKey} non si scrive: cambia di continuo.`)
  }

  async clear(): Promise<void> {
    await this.sql.run('DELETE FROM ai_briefings')
    await this.sql.run('DELETE FROM ai_event_preps')
  }
}
