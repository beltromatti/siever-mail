import { foldSearchText } from '@shared/search'

import { linksIn } from '../agent/entries'
import { PROMPTS } from '../prompts'
import {
  numberArg,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type TaskKind
} from '../agent/tool-types'
import { countOf, formatDateTime } from './format'

/** The user's day, AAAA-MM-GG, as their clock has it. */
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const TASK_WORDS: Record<string, string> = {
  richiesta: 'richiesta dell’utente',
  lettura: 'lettura della posta',
  giornata: 'giornata',
  punto: 'il punto di un progetto',
  calendario: 'calendario',
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
 * The desk's own text (vision §13.1): the letter at the top of Oggi. What
 * the Segretario writes of an event — how to prepare it, whose it is — is
 * that event's note (`nota`); what the user is to know now, `avvisa`.
 */
export const todayTool: SegretarioTool = {
  name: 'oggi',
  description: PROMPTS.tools.oggi,
  parameters: {
    type: 'object',
    properties: {
      lettera: { type: 'string' }
    },
    required: ['lettera']
  },
  running: () => 'Scrivo la giornata…',
  async execute(args, context) {
    const letter = stringArg(args, 'lettera')

    if (!letter) {
      throw new ToolInputError(
        "Indica la `lettera`. Ciò che scrivi di un evento — la preparazione, l'avviso, di chi è — va nella sua nota (`nota`, con `evento`)."
      )
    }

    // The letter is the whole day seen at once: one conversation's reading would write it
    // from a corner. What matters today goes in the open things, and the day is written again.
    if (!LETTER_WRITERS.includes(context.run.task)) {
      throw new ToolInputError(
        'La lettera di Oggi la scrive il lavoro della giornata, guardando tutto, e la riscrive quando le cose cambiano: quello che conta per oggi mettilo nelle cose aperte con `impegni`, con la sua scadenza, e la giornata ne terrà conto.'
      )
    }

    await context.registry.saveLetter(
      localDay(),
      letter,
      linksIn(letter, context.handles),
      context.run.actor
    )

    return { content: 'La lettera di oggi è in cima a Oggi.', summary: 'Scritta la giornata' }
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
  running: () => 'Rileggo…',
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
        warnings.length === 0
          ? 'Riletto: tutto a posto'
          : `Riletto: ${countOf(warnings.length, 'avviso', 'avvisi')}`
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
  running: () => 'Rileggo cosa ho fatto…',
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
      summary: 'Riletto il diario'
    }
  }
}
