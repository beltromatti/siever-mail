import { defineMessages } from '@shared/i18n'
import type { HandleLink } from '@shared/segretario'
import { unlinked } from '@shared/segretario-links'

import { messages } from '../../i18n'
import type { Sql } from '../sql'
import { lookedAt, RevisionConflict } from './types'

/** A write that never settles: the step that tried it fails, and its line says why. */
const ERRORS = defineMessages({
  letterRestless: {
    en: (day: string) => `The letter of ${day} can’t be written: it keeps changing.`,
    it: (day: string) => `La lettera del ${day} non si scrive: cambia di continuo.`,
    de: (day: string) => `Der Brief vom ${day} lässt sich nicht schreiben: Er ändert sich ständig.`
  },
  prepRestless: {
    en: (eventKey: string) => `The briefing for ${eventKey} can’t be written: it keeps changing.`,
    it: (eventKey: string) => `La preparazione di ${eventKey} non si scrive: cambia di continuo.`,
    de: (eventKey: string) =>
      `Die Vorbereitung für ${eventKey} lässt sich nicht schreiben: Sie ändert sich ständig.`
  }
})

/** Who wrote words that stay as they are now: the Segretario, or the user rewriting them (§10.1). */
export type WrittenBy = 'segretario' | 'utente'

function writtenBy(value: string | null): WrittenBy {
  return value === 'utente' ? 'utente' : 'segretario'
}

export interface DayLetter {
  day: string
  text: string
  /** What its short names stand for. */
  links: HandleLink[]
  writtenAt: number
  writtenBy: WrittenBy
}

export interface MeetingPrep {
  text: string
  links: HandleLink[]
  writtenAt: number
  writtenBy: WrittenBy
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
      written_by: string | null
    }>('SELECT day, text, links_json, created_at, written_by FROM ai_briefings WHERE day = ?', day)
    return row
      ? {
          day: row.day,
          text: row.text,
          links: JSON.parse(row.links_json) as HandleLink[],
          writtenAt: Number(row.created_at),
          writtenBy: writtenBy(row.written_by)
        }
      : null
  }

  /**
   * Writes a day's letter — over that day's only if it is the one the run saw
   * (§4.6): `seenAt`, when the one it read was written; 0, that there was
   * none; `UNSEEN`, that it never looked. A letter is a day's: a new day's
   * starts from the state, not over yesterday's (§3.4). `by`: the user
   * rewriting it, whose words the next rewrite starts from (§10.1).
   */
  async saveLetter(
    day: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    seenAt?: number,
    by: WrittenBy = 'segretario'
  ): Promise<DayLetter> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.letter(day)

      if (current && seenAt !== undefined && current.writtenAt !== seenAt) {
        const at = new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(
          new Date(current.writtenAt)
        )
        const byUser = current.writtenBy === 'utente' ? ", dall'utente" : ''
        throw new RevisionConflict(
          `${
            lookedAt(seenAt) === 'mai'
              ? `La lettera di oggi c'è già, scritta alle ${at}${byUser}, e non l'hai ancora letta`
              : `La lettera di oggi è stata riscritta alle ${at}${byUser}, da quando l'hai letta`
          }: dice «${unlinked(current.text)}». Se la tua vale ancora, riscrivila partendo da lì${
            byUser ? ': le parole dell’utente restano le sue' : ''
          }.`,
          { revision: current.writtenAt }
        )
      }

      const writtenAt = Math.max(Date.now(), (current?.writtenAt ?? 0) + 1)
      const changed = current
        ? await this.sql.run(
            `UPDATE ai_briefings SET text = ?, links_json = ?, created_at = ?, written_by = ?
             WHERE day = ? AND created_at = ?`,
            text.trim(),
            JSON.stringify(links),
            writtenAt,
            by,
            day,
            current.writtenAt
          )
        : await this.sql.run(
            `INSERT INTO ai_briefings (day, text, basis, links_json, created_at, written_by)
             VALUES (?, ?, '[]', ?, ?, ?)
             ON CONFLICT(day) DO NOTHING`,
            day,
            text.trim(),
            JSON.stringify(links),
            writtenAt,
            by
          )

      if (changed === 1) {
        return { day, text: text.trim(), links: [...links], writtenAt, writtenBy: by }
      }
    }

    throw new Error(messages(ERRORS).letterRestless(day))
  }

  async prep(eventKey: string): Promise<MeetingPrep | null> {
    const row = await this.sql.get<{
      text: string
      links_json: string
      written_at: number
      written_by: string | null
    }>(
      'SELECT text, links_json, written_at, written_by FROM ai_event_preps WHERE event_key = ?',
      eventKey
    )
    return row
      ? {
          text: row.text,
          links: JSON.parse(row.links_json) as HandleLink[],
          writtenAt: Number(row.written_at),
          writtenBy: writtenBy(row.written_by)
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
      written_by: string | null
    }>(
      `SELECT event_key, text, links_json, written_at, written_by FROM ai_event_preps
       WHERE event_key IN (${eventKeys.map(() => '?').join(', ')})`,
      ...eventKeys
    )
    return new Map(
      rows.map((row) => [
        row.event_key,
        {
          text: row.text,
          links: JSON.parse(row.links_json) as HandleLink[],
          writtenAt: Number(row.written_at),
          writtenBy: writtenBy(row.written_by)
        }
      ])
    )
  }

  /**
   * Writes a meeting's preparation — over the one there only if it is the one
   * the run saw (§4.6): `seenAt`, when the one it read was written; 0, that
   * there was none; `UNSEEN`, that it never looked. `by`: the user
   * rewriting it, whose words the next rewrite starts from (§10.1).
   */
  async savePrep(
    eventKey: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    runId: string | null,
    seenAt?: number,
    by: WrittenBy = 'segretario'
  ): Promise<MeetingPrep> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.prep(eventKey)

      if (current && seenAt !== undefined && current.writtenAt !== seenAt) {
        const byUser = current.writtenBy === 'utente'
        throw new RevisionConflict(
          `${
            lookedAt(seenAt) === 'mai'
              ? `Questo evento ha già una preparazione${byUser ? ', scritta dall’utente' : ''}, e non l’hai ancora letta`
              : lookedAt(seenAt) === 'comparsa'
                ? `Da quando l’hai letto, questo evento ha avuto una preparazione${byUser ? ', dall’utente' : ''}`
                : `La preparazione di questo evento è cambiata da quando l’hai letta${byUser ? ', per mano dell’utente' : ''}`
          }: dice «${unlinked(current.text)}». Se la tua vale ancora, riscrivila tenendo ciò che serve${
            byUser ? ': le parole dell’utente restano le sue' : ''
          }.`,
          { revision: current.writtenAt }
        )
      }

      const now = Math.max(Date.now(), (current?.writtenAt ?? 0) + 1)
      const changed = current
        ? await this.sql.run(
            `UPDATE ai_event_preps SET text = ?, links_json = ?, run_id = ?, written_at = ?, written_by = ?
             WHERE event_key = ? AND written_at = ?`,
            text.trim(),
            JSON.stringify(links),
            runId,
            now,
            by,
            eventKey,
            current.writtenAt
          )
        : await this.sql.run(
            `INSERT INTO ai_event_preps (event_key, text, links_json, run_id, written_at, written_by)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(event_key) DO NOTHING`,
            eventKey,
            text.trim(),
            JSON.stringify(links),
            runId,
            now,
            by
          )

      if (changed === 1) {
        return { text: text.trim(), links: [...links], writtenAt: now, writtenBy: by }
      }
    }

    throw new Error(messages(ERRORS).prepRestless(eventKey))
  }

  async clear(): Promise<void> {
    await this.sql.run('DELETE FROM ai_briefings')
    await this.sql.run('DELETE FROM ai_event_preps')
  }
}
