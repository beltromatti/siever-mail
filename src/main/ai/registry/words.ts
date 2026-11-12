import { workTargetKey, type PendingWords, type WorkTarget } from '@shared/segretario'

import { placeholders, type Sql } from '../sql'

/** The lessons that are the user's words on a thing, waiting for the Segretario to take them in. */
export const WORDS_LESSONS = ['da_correggere', 'risposta'] as const

export type WordsLesson = (typeof WORDS_LESSONS)[number]

/** The user's words on a thing, as a lesson keeps them. */
export interface GivenWords {
  id: number
  kind: WordsLesson
  target: WorkTarget
  words: string
  at: number
  /** The reflection taking them in now; null while they wait. */
  reflectionId: string | null
}

function isTarget(value: unknown): value is WorkTarget {
  return (
    typeof value === 'object' && value !== null && typeof (value as WorkTarget).kind === 'string'
  )
}

/**
 * The user's words on what the Segretario wrote (vision §10.1): lessons like
 * the others — in the reflection's table, taken in by it, in order with
 * the rest — that also show on their thing until the Segretario has put it
 * right. A reflection done takes them away with what it learnt; one that
 * fails leaves them waiting. They are few, and read whole: the thing they
 * are about is in their words (`oggetto`), which follow an event that moves
 * as every key the registry keeps does.
 */
export class WordStore {
  constructor(private readonly sql: Sql) {}

  /** Gives the user's words on a thing: what is wrong with it, or the answer to its question. */
  async give(
    kind: WordsLesson,
    target: WorkTarget,
    words: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.sql.run(
      'INSERT INTO ai_lessons (kind, payload_json, created_at, reflection_id) VALUES (?, ?, ?, NULL)',
      kind,
      JSON.stringify({ oggetto: target, parole: words, ...payload }),
      Date.now()
    )
  }

  /** Every word given and not yet taken in, the oldest first. */
  async all(): Promise<GivenWords[]> {
    const rows = await this.sql.all<{
      id: number
      kind: WordsLesson
      payload_json: string
      created_at: number
      reflection_id: string | null
    }>(
      `SELECT id, kind, payload_json, created_at, reflection_id FROM ai_lessons
       WHERE kind IN (${placeholders(WORDS_LESSONS)}) ORDER BY id`,
      ...WORDS_LESSONS
    )

    return rows.flatMap((row) => {
      const payload = JSON.parse(row.payload_json) as { oggetto?: unknown; parole?: unknown }

      return isTarget(payload.oggetto)
        ? [
            {
              id: Number(row.id),
              kind: row.kind,
              target: payload.oggetto,
              words: String(payload.parole ?? ''),
              at: Number(row.created_at),
              reflectionId: row.reflection_id
            }
          ]
        : []
    })
  }

  /**
   * The words waiting on these things, by `workTargetKey`: a correction —
   * the thing shows dimmed — before an answer, and of each the latest.
   */
  async pending(targets: ReadonlyArray<WorkTarget>): Promise<Map<string, PendingWords>> {
    const wanted = new Set(targets.map(workTargetKey))
    const found = new Map<string, PendingWords>()

    if (wanted.size === 0) {
      return found
    }

    for (const given of await this.all()) {
      const key = workTargetKey(given.target)

      if (!wanted.has(key)) {
        continue
      }

      const words: PendingWords = {
        kind: given.kind === 'da_correggere' ? 'correzione' : 'risposta',
        words: given.words,
        at: given.at
      }
      const before = found.get(key)

      if (!before || before.kind === words.kind || words.kind === 'correzione') {
        found.set(key, words)
      }
    }

    return found
  }

  /**
   * Takes back the user's words on a thing. Resolves with those a
   * reflection was taking in already: it may have acted on them.
   */
  async withdraw(target: WorkTarget): Promise<GivenWords[]> {
    const key = workTargetKey(target)
    const given = (await this.all()).filter((words) => workTargetKey(words.target) === key)

    if (given.length > 0) {
      await this.sql.run(
        `DELETE FROM ai_lessons WHERE id IN (${placeholders(given)})`,
        ...given.map((words) => words.id)
      )
    }

    return given.filter((words) => words.reflectionId !== null)
  }

  /**
   * Whether a run is taking in the user's words on a thing: it carries their
   * word on it, which what they decided before gives way to.
   */
  async carriedBy(runId: string | null | undefined, target: WorkTarget): Promise<boolean> {
    if (!runId) {
      return false
    }

    const key = workTargetKey(target)
    return (await this.all()).some(
      (words) => words.reflectionId === runId && workTargetKey(words.target) === key
    )
  }
}
