import { defineMessages } from '@shared/i18n'
import { foldSearchText } from '@shared/search'
import { unlinked } from '@shared/segretario-links'

import { messages } from '../../i18n'
import { linksIn } from '../agent/entries'
import { PROMPTS } from '../prompts'
import { RevisionConflict } from '../registry/types'
import {
  numberArg,
  seenKey,
  seenOf,
  stringArg,
  stringListArg,
  ToolConflict,
  ToolInputError,
  type SegretarioTool,
  type TaskKind
} from '../agent/tool-types'
import { countOf, formatDateTime } from './format'

/** The user's day, AAAA-MM-GG, as their clock has it. */
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The steps' lines, as the user sees them in the panel. */
const STEPS = defineMessages({
  readingLetter: {
    en: 'Looking at today’s letter…',
    it: 'Guardo la lettera di oggi…',
    de: 'Sehe mir den heutigen Brief an…'
  },
  writingDay: { en: 'Writing the day…', it: 'Scrivo la giornata…', de: 'Schreibe den Tag…' },
  readLetter: {
    en: 'Looked at today’s letter',
    it: 'Guardata la lettera di oggi',
    de: 'Heutigen Brief angesehen'
  },
  wroteDay: { en: 'Wrote the day', it: 'Scritta la giornata', de: 'Den Tag geschrieben' },
  rereading: { en: 'Rereading…', it: 'Rileggo…', de: 'Lese noch einmal…' },
  allGood: {
    en: 'Reread: all good',
    it: 'Riletto: tutto a posto',
    de: 'Nochmals gelesen: alles in Ordnung'
  },
  warnings: {
    en: (count: number) => `Reread: ${count === 1 ? '1 warning' : `${count} warnings`}`,
    it: (count: number) => `Riletto: ${count === 1 ? '1 avviso' : `${count} avvisi`}`,
    de: (count: number) => `Nochmals gelesen: ${count === 1 ? '1 Hinweis' : `${count} Hinweise`}`
  },
  rereadingWork: {
    en: 'Rereading what I did…',
    it: 'Rileggo cosa ho fatto…',
    de: 'Lese nach, was ich getan habe…'
  },
  readJournal: { en: 'Reread the activity', it: 'Riletto il diario', de: 'Verlauf nachgelesen' }
})

const TASK_WORDS: Record<string, string> = {
  richiesta: 'richiesta dell’utente',
  lettura: 'lettura della posta',
  giornata: 'giornata',
  punto: 'il punto di un progetto',
  calendario: 'calendario',
  // Runs before the writing in the editor became the panel's.
  scrittura: 'scrittura nell’editor',
  revisione: 'revisione prima dell’invio',
  ricerca: 'ricerca in parole',
  conoscimi: 'Conoscimi',
  riflessione: 'riflessione',
  al_passo: 'Al passo'
}

/** Who writes the letter: the day's own work, and the user who asks for it. */
const LETTER_WRITERS: ReadonlyArray<TaskKind> = ['giornata', 'richiesta']

/**
 * The desk's own text (vision §13.1): the letter at the top of Oggi, a day's
 * (§3.4) — shown as it is, and written over the one the run saw that day
 * (§4.6). What the Segretario writes of an event — how to prepare it, whose
 * it is — is that event's note (`nota`); what the user is to know now,
 * `avvisa`.
 */
export const todayTool: SegretarioTool = {
  name: 'oggi',
  description: PROMPTS.tools.oggi,
  parameters: {
    type: 'object',
    properties: {
      lettera: { type: 'string' }
    }
  },
  running: (args) =>
    args.lettera === undefined ? messages(STEPS).readingLetter : messages(STEPS).writingDay,
  readsOnly: (args) => args.lettera === undefined,
  async execute(args, context) {
    const day = localDay()
    const seen = seenKey('letter', day)

    // Without a letter, today's as it is: what a rewrite the same day starts from.
    if (args.lettera === undefined) {
      const current = await context.registry.day.letter(day)
      context.run.seen.set(seen, current?.writtenAt ?? 0)

      return {
        content: current
          ? `La lettera di oggi, scritta alle ${new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(new Date(current.writtenAt))}:\n${unlinked(current.text)}`
          : "Oggi non c'è ancora una lettera.",
        summary: messages(STEPS).readLetter
      }
    }

    const letter = stringArg(args, 'lettera')

    if (!letter) {
      throw new ToolInputError(
        'Indica la `lettera`. Ciò che scrivi di un evento — la preparazione, di chi è — va nella sua nota (`nota`, con `evento`); ciò che l’utente deve sapere adesso, in `avvisa`.'
      )
    }

    // The letter is the whole day seen at once: one conversation's reading would write it
    // from a corner. What matters today goes in the open things, and the day is written again.
    if (!LETTER_WRITERS.includes(context.run.task)) {
      throw new ToolInputError(
        'La lettera di Oggi la scrive il lavoro della giornata, guardando tutto, e la riscrive quando le cose cambiano: quello che conta per oggi mettilo nelle cose aperte con `impegni`, con la sua scadenza, e la giornata ne terrà conto.'
      )
    }

    try {
      const written = await context.registry.saveLetter(
        day,
        letter,
        linksIn(letter, context.handles),
        context.run.actor,
        seenOf(context.run, seen)
      )
      context.run.seen.set(seen, written.writtenAt)
    } catch (error) {
      if (error instanceof RevisionConflict) {
        context.run.seen.set(seen, error.current.revision)
        throw new ToolConflict(error.message)
      }

      throw error
    }

    return {
      content: 'La lettera di oggi è in cima a Oggi.',
      summary: messages(STEPS).wroteDay
    }
  }
}

/** What the reread before sending found: the only way that reread answers. */
export const reviewTool: SegretarioTool = {
  name: 'revisione',
  description: PROMPTS.tools.revisione,
  parameters: {
    type: 'object',
    properties: { avvisi: { type: 'array', items: { type: 'string' } } },
    required: ['avvisi']
  },
  running: () => messages(STEPS).rereading,
  async execute(args, context) {
    if (context.run.task !== 'revisione') {
      throw new ToolInputError(
        '`revisione` serve solo quando rileggi un messaggio che l’utente sta per inviare.'
      )
    }

    const warnings = stringListArg(args, 'avvisi')
      .map((warning) => warning.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    context.run.results.review = warnings
    return {
      content:
        warnings.length === 0
          ? 'Nessun avviso: il messaggio parte.'
          : 'Avvisi mostrati all’utente.',
      summary:
        warnings.length === 0 ? messages(STEPS).allGood : messages(STEPS).warnings(warnings.length)
    }
  }
}

/** The runs one look at the diary shows at most: past them, the search narrows. */
const DIARY_RUNS_SHOWN = 40

/** What the Segretario did lately, run by run, with what it changed: to build on it, and to say it. */
export const journalTool: SegretarioTool = {
  name: 'diario',
  description: PROMPTS.tools.diario,
  parameters: {
    type: 'object',
    properties: {
      giorni: { type: 'integer' },
      cerca: { type: 'string' }
    }
  },
  running: () => messages(STEPS).rereadingWork,
  readsOnly: () => true,
  async execute(args, context) {
    const days = Math.min(30, Math.max(1, numberArg(args, 'giorni') ?? 3))
    const words = foldSearchText(stringArg(args, 'cerca') ?? '')
      .split(/\s+/)
      .filter(Boolean)
    // A run is found by what the diary says of it: its title, its kind, its day, its changes —
    // accents and capitals aside, as the app's search finds.
    const work = (
      await context.store.recentWork(
        Date.now() - days * 24 * 60 * 60 * 1000,
        DIARY_RUNS_SHOWN + 1,
        words.length === 0
          ? undefined
          : (entry) => {
              const said = foldSearchText(
                [
                  entry.title,
                  TASK_WORDS[entry.task] ?? entry.task,
                  formatDateTime(new Date(entry.createdAt).toISOString()),
                  ...entry.changes.map((change) => change.label)
                ].join(' ')
              )
              return words.every((word) => said.includes(word))
            }
      )
    ).filter((entry) => entry.activityId !== context.run.activityId)
    const lines = work.slice(0, DIARY_RUNS_SHOWN).map((entry) => {
      const changes = entry.changes.map((change) => change.label)
      return `${formatDateTime(new Date(entry.createdAt).toISOString())} · ${TASK_WORDS[entry.task] ?? entry.task} · «${entry.title}»${
        entry.status === 'failed' ? ' · non riuscito' : ''
      }${changes.length > 0 ? `\n   ${changes.slice(0, 12).join('\n   ')}${changes.length > 12 ? `\n   …e altre ${changes.length - 12}` : ''}` : ''}`
    })

    return {
      content:
        lines.length === 0
          ? `Nessun lavoro negli ultimi ${countOf(days, 'giorno', 'giorni')}${words.length > 0 ? ' con queste parole' : ''}.`
          : `Il tuo lavoro degli ultimi ${countOf(days, 'giorno', 'giorni')}, dal più recente:\n${lines.join('\n')}${
              work.length > DIARY_RUNS_SHOWN
                ? `\n(Ce n'è altro più indietro: restringi con \`cerca\` o con meno \`giorni\`.)`
                : ''
            }`,
      summary: messages(STEPS).readJournal
    }
  }
}
