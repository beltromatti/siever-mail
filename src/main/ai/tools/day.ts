import { PROMPTS } from '../prompts'
import {
  numberArg,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool
} from '../agent/tool-types'
import { clip, countOf, formatDateTime } from './format'

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

/** The letter at the top of Oggi, and what to know before a meeting. */
export const todayTool: SegretarioTool = {
  name: 'oggi',
  description: PROMPTS.tools.oggi,
  parameters: {
    type: 'object',
    properties: {
      lettera: { type: 'string' },
      riunione: { type: 'string' },
      preparazione: { type: 'string' }
    }
  },
  running: (args) => (stringArg(args, 'riunione') ? 'Preparo la riunione…' : 'Scrivo la giornata…'),
  async execute(args, context) {
    const letter = stringArg(args, 'lettera')
    const meeting = stringArg(args, 'riunione')
    const lines: string[] = []

    if (!letter && !meeting) {
      throw new ToolInputError('Indica `lettera`, oppure `riunione` con `preparazione`.')
    }

    if (letter) {
      await context.registry.saveLetter(localDay(), letter, context.run.actor)
      lines.push('La lettera di oggi è in cima a Oggi.')
    }

    if (meeting) {
      const event = context.handles.event(meeting)

      if (!event) {
        throw new ToolInputError(
          `Non conosco l'evento «${meeting}»: usa un riferimento e… ricevuto da \`calendario\`.`
        )
      }

      await context.registry.savePrep(
        event.eventKey,
        event.title,
        requireString(args, 'preparazione'),
        context.run.actor
      )
      lines.push(`Preparazione di «${event.title}» salvata: la trova sotto l'evento.`)
    }

    return {
      content: lines.join(' '),
      summary:
        letter && meeting
          ? 'Scritta la giornata e preparata una riunione'
          : letter
            ? 'Scritta la giornata'
            : 'Preparata una riunione'
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
  running: () => 'Rileggo…',
  async execute(args, context) {
    if (context.run.task !== 'revisione') {
      throw new ToolInputError(
        '`revisione` serve solo quando rileggi un messaggio che l’utente sta per inviare.'
      )
    }

    const warnings = stringListArg(args, 'avvisi')
      .map((warning) => clip(warning.replace(/\s+/g, ' ').trim(), 240).text)
      .filter(Boolean)
      .slice(0, 4)
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
  async execute(args, context) {
    const days = Math.min(30, Math.max(1, numberArg(args, 'giorni') ?? 3))
    const words = (stringArg(args, 'cerca') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const work = (
      await context.store.recentWork(Date.now() - days * 24 * 60 * 60 * 1000, 200)
    ).filter((entry) => entry.activityId !== context.run.activityId)
    const lines = work
      .map((entry) => {
        const changes = entry.changes.map((change) => change.label)
        const text = `${formatDateTime(new Date(entry.createdAt).toISOString())} · ${TASK_WORDS[entry.task] ?? entry.task} · «${entry.title}»${
          entry.status === 'failed' ? ' · non riuscito' : ''
        }${changes.length > 0 ? `\n   ${changes.slice(0, 12).join('\n   ')}${changes.length > 12 ? `\n   …e altre ${changes.length - 12}` : ''}` : ''}`
        return text
      })
      .filter((text) => words.every((word) => text.toLowerCase().includes(word)))

    return {
      content:
        lines.length === 0
          ? `Nessun lavoro negli ultimi ${countOf(days, 'giorno', 'giorni')}${words.length > 0 ? ' con queste parole' : ''}.`
          : `Il tuo lavoro degli ultimi ${countOf(days, 'giorno', 'giorni')}, dal più recente:\n${lines.join('\n')}`,
      summary: 'Riletto il diario'
    }
  }
}
