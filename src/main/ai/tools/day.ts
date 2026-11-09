import { calendarKey, seriesKey } from '@shared/calendar'
import { foldSearchText } from '@shared/search'

import { linksIn } from '../agent/entries'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type TaskKind,
  type ToolContext
} from '../agent/tool-types'
import { eventLine } from './calendar'
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

/** How far ahead a meeting named by its title is looked for. */
const MEETING_AHEAD_DAYS = 14

/**
 * The event a preparation is for: its short name, or its title when one
 * event of the next two weeks is called so. Otherwise the events of those
 * days, named, for the next call to pick.
 */
async function meetingOf(
  context: ToolContext,
  written: string
): Promise<{ eventKey: string; title: string }> {
  const known = context.handles.event(written)

  if (known) {
    return known
  }

  const now = new Date()
  const until = new Date(now.getTime() + MEETING_AHEAD_DAYS * 24 * 60 * 60 * 1000)
  const events = await context.calendar.events(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    until.toISOString()
  )
  const wanted = written.trim().toLowerCase()
  const matching = events.filter(
    (event) =>
      event.title.trim().toLowerCase() === wanted ||
      wanted.includes(event.title.trim().toLowerCase())
  )

  if (matching.length === 1) {
    return { eventKey: matching[0].key, title: matching[0].title }
  }

  const listed = (matching.length > 1 ? matching : events)
    .slice(0, 12)
    .map((event) => eventLine(event, context))
  throw new ToolInputError(
    `«${written}» non è un riferimento di evento (e…)${
      listed.length > 0
        ? `. Gli eventi dei prossimi giorni:\n${listed.join('\n')}`
        : ', e nei prossimi giorni non ci sono eventi.'
    }`
  )
}

/** Who writes the letter: the day's own work, and the user who asks for it. */
const LETTER_WRITERS: ReadonlyArray<TaskKind> = ['giornata', 'richiesta']
/** Who interrupts the user about an event: the look at the calendar's changes, which nobody watches. */
const ALERT_WRITERS: ReadonlyArray<TaskKind> = ['calendario']

/**
 * Says an event — and its series — is the user's, or not, though its
 * calendar does not say so (§7.4): in a calendar shared, the one the
 * office wrote for them. Only there: in a calendar of theirs every event
 * is, in one that is not none is. What the user says in chat is their word.
 */
async function markYours(
  context: ToolContext,
  written: string,
  yours: boolean,
  reason: string | null
): Promise<{ line: string; label: string | null }> {
  const { eventKey, title } = await meetingOf(context, written)
  const [event, calendars] = await Promise.all([
    context.calendar.event(eventKey),
    context.calendar.calendars()
  ])

  if (!event) {
    throw new ToolInputError(`«${title}» non è più nel calendario.`)
  }

  const calendar = calendars.find(
    (candidate) => candidate.key === calendarKey(event.connectionId, event.calendarId)
  )

  if (calendar?.role === 'tutti') {
    return {
      line: `«${event.title}» è nel calendario «${calendar.name}», che è dell'utente: è già suo, come tutti i suoi eventi.`,
      label: null
    }
  }

  if (calendar?.role === 'nessuno') {
    throw new ToolInputError(
      `Nessun evento del calendario «${calendar.name}» è dell'utente. Se questo calendario è suo, o condiviso, dillo per il calendario (\`connessioni\`, \`di_chi\`).`
    )
  }

  const series = event.seriesId
    ? seriesKey(event.connectionId, event.calendarId, event.seriesId)
    : null
  const mark = await context.registry.ownership.markOf(event.key, series)

  // What the calendar says stands: invited, organised or put there by the user, it is theirs.
  if (event.yours && !mark?.yours) {
    return {
      line: yours
        ? `«${event.title}» è già dell'utente: il calendario lo dice (ci è invitato, lo organizza o l'ha creato lui).`
        : `«${event.title}» è dell'utente per il calendario stesso (ci è invitato, lo organizza o l'ha creato lui): non si toglie da qui.`,
      label: null
    }
  }

  const byUser = context.run.task === 'richiesta'
  const change = await context.registry.markEvent(
    { key: event.key, title: event.title, seriesKey: series },
    yours,
    reason,
    byUser ? { ...context.run.actor, by: 'utente' } : context.run.actor
  )

  return {
    line: `«${event.title}»${series ? ', e ogni volta della sua serie,' : ''} ${
      yours
        ? "è dell'utente: gli ricorda, e Oggi lo mostra nella sua giornata"
        : "non è dell'utente"
    }.`,
    label: change.label
  }
}

/** The letter at the top of Oggi, and what to know before a meeting. */
export const todayTool: SegretarioTool = {
  name: 'oggi',
  description: PROMPTS.tools.oggi,
  parameters: {
    type: 'object',
    properties: {
      lettera: { type: 'string' },
      evento: { type: 'string' },
      preparazione: { type: 'string' },
      avviso: { type: 'string' },
      tuo: { type: 'boolean' },
      motivo: { type: 'string' }
    }
  },
  running: (args) =>
    stringArg(args, 'avviso')
      ? 'Avviso l’utente…'
      : args.tuo !== undefined && args.tuo !== null
        ? 'Guardo di chi è l’evento…'
        : stringArg(args, 'evento')
          ? 'Preparo la riunione…'
          : 'Scrivo la giornata…',
  async execute(args, context) {
    const letter = stringArg(args, 'lettera')
    const meeting = stringArg(args, 'evento')
    const lines: string[] = []

    if (!letter && !meeting) {
      throw new ToolInputError(
        'Indica `lettera`, oppure `evento` con `preparazione`, `avviso` o `tuo`.'
      )
    }

    if (letter) {
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
      lines.push('La lettera di oggi è in cima a Oggi.')
    }

    const alert = stringArg(args, 'avviso')?.replace(/\s+/g, ' ').trim()

    if (alert) {
      if (!ALERT_WRITERS.includes(context.run.task)) {
        throw new ToolInputError(
          'Avvisare l’utente con una notifica si fa qui solo guardando i cambiamenti del calendario: di un messaggio lo dice la sua nota (`avvisa`); con l’utente davanti, diglielo e basta.'
        )
      }

      if (!meeting) {
        throw new ToolInputError('Indica l’`evento` (e…) di cui avvisare.')
      }

      const event = await meetingOf(context, meeting)
      const told = await context.calendar.alert(event.eventKey, alert)

      if (told === 'unknown') {
        throw new ToolInputError(
          `«${event.title}» non è più nel calendario e non ne resta traccia: non posso avvisarne.`
        )
      }

      lines.push(
        told === 'told'
          ? `Avvisato l'utente di «${event.title}».`
          : `L'utente ha spento le notifiche del calendario: «${event.title}» lo vedrà da sé.`
      )
    }

    const asked = args.tuo === undefined || args.tuo === null ? null : booleanArg(args, 'tuo')
    const marked =
      meeting && asked !== null
        ? await markYours(context, meeting, asked, stringArg(args, 'motivo')?.trim() || null)
        : null

    if (marked) {
      lines.push(marked.line)
    }

    if (meeting && ((!alert && !marked) || stringArg(args, 'preparazione'))) {
      const event = await meetingOf(context, meeting)

      const preparation = requireString(args, 'preparazione')
      await context.registry.savePrep(
        event.eventKey,
        event.title,
        preparation,
        linksIn(preparation, context.handles),
        context.run.actor
      )
      lines.push(`Preparazione di «${event.title}» salvata: la trova sotto l'evento.`)
    }

    const prepared = Boolean(meeting && stringArg(args, 'preparazione'))

    return {
      content: lines.join(' '),
      summary: [
        letter ? 'Scritta la giornata' : null,
        prepared ? 'Preparata una riunione' : null,
        alert ? 'Avvisato l’utente' : null,
        marked?.label ?? null
      ]
        .filter(Boolean)
        .join(' · ')
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
