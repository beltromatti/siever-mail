import { calendarKey, seriesKey } from '@shared/calendar'

import { linksIn } from '../agent/entries'
import { PROMPTS } from '../prompts'
import { RegistryRefusal, RevisionConflict } from '../registry/types'
import type { NoteNature, NotePriority } from '../registry/types'
import {
  booleanArg,
  requireString,
  seenKey,
  stringArg,
  ToolConflict,
  ToolInputError,
  type SegretarioTool,
  type TaskKind,
  type ToolContext,
  type ToolOutcome
} from '../agent/tool-types'
import { resolveSentOrReceived } from './anchors'
import { eventLine } from './calendar'
import { dayArg } from './commitments'

const NATURES: ReadonlyArray<NoteNature> = [
  'da_rispondere',
  'da_fare',
  'in_attesa',
  'informativo',
  'rumore'
]
const PRIORITIES: ReadonlyArray<NotePriority> = ['alta', 'media', 'bassa']

/** What only a message's note says, and what only an event's does. */
const MESSAGE_FIELDS = ['sintesi', 'natura', 'importanza', 'scadenza'] as const
const EVENT_FIELDS = ['preparazione', 'tuo'] as const

/** Who interrupts the user about an event: the look at the calendar's changes, which nobody watches. */
const ALERT_WRITERS: ReadonlyArray<TaskKind> = ['calendario']
/** How far ahead an event named by its title is looked for. */
const EVENT_AHEAD_DAYS = 14

function given(args: Record<string, unknown>, name: string): boolean {
  return args[name] !== undefined && args[name] !== null && args[name] !== ''
}

/**
 * What to tell the user now (`avvisa`): the line written — or, for a
 * message, `true`, its note's summary. Null when nothing is to be told.
 */
function alertArg(args: Record<string, unknown>): string | true | null {
  const value = args.avvisa

  if (value === true || value === 'true') {
    return true
  }

  if (typeof value !== 'string') {
    return null
  }

  const line = value.replace(/\s+/g, ' ').trim()
  return line && line !== 'false' ? line : null
}

/**
 * The event a note is for: its short name, or its title when one event of
 * the next two weeks is called so. Otherwise the events of those days,
 * named, for the next call to pick.
 */
async function eventNamed(
  context: ToolContext,
  written: string
): Promise<{ eventKey: string; title: string }> {
  const known = context.handles.event(written)

  if (known) {
    return known
  }

  const now = new Date()
  const until = new Date(now.getTime() + EVENT_AHEAD_DAYS * 24 * 60 * 60 * 1000)
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

/**
 * A message's note: what it asked of the user when it came — history, not
 * rewritten as the matter goes on —, and whether to tell them now, with
 * the line that says why.
 */
async function noteOfMessage(
  args: Record<string, unknown>,
  context: ToolContext,
  handle: string
): Promise<ToolOutcome> {
  const misplaced = EVENT_FIELDS.filter((name) => given(args, name))

  if (misplaced.length > 0) {
    throw new ToolInputError(
      `La nota di un messaggio non ha ${misplaced.map((name) => `\`${name}\``).join(' né ')}: è \`sintesi\`, \`natura\`, \`importanza\`, \`motivo\`, \`scadenza\` e, se va detto adesso, \`avvisa\`.`
    )
  }

  const message = await resolveSentOrReceived(context, handle)
  const summary = requireString(args, 'sintesi')
  const nature = requireString(args, 'natura') as NoteNature
  const priority = requireString(args, 'importanza') as NotePriority
  const alert = alertArg(args)
  const seen = seenKey('note', message.accountId, message.messageKey)

  try {
    const { record, change } = await context.registry.writeNote(
      { ...message, messageDate: message.dateIso },
      {
        summary,
        nature,
        priority,
        reason: stringArg(args, 'motivo') ?? '',
        due: dayArg(args, 'scadenza'),
        // Only a message that came: what the user sent is told to no one.
        notify: message.direction === 'in' && alert !== null,
        alert: alert === true ? null : alert
      },
      context.run.actor,
      { seenRevision: context.run.seen.get(seen) }
    )
    context.run.seen.set(seen, record.revision)
    const corrected = change.action !== 'scritta'

    return {
      content: `Nota di ${handle} ${corrected ? 'corretta' : 'scritta'}.${
        // Told or not as it came: a correction does not tell it again, nor take it back.
        corrected && alert !== null
          ? ' L’avviso di un messaggio si decide quando arriva: resta com’era.'
          : ''
      }`,
      summary: change.label,
      messages: [message.ref]
    }
  } catch (error) {
    if (error instanceof RevisionConflict) {
      context.run.seen.set(seen, error.current.revision)
      throw new ToolConflict(error.message)
    }

    if (error instanceof RegistryRefusal) {
      throw new ToolInputError(error.message)
    }

    throw error
  }
}

/**
 * Says an event — and its series — is the user's, or not, though its
 * calendar does not say so (§7.4): in a calendar shared, the one the
 * office wrote for them. Only there: in a calendar of theirs every event
 * is, in one that is not none is. What the user says in chat is their word.
 */
async function markYours(
  context: ToolContext,
  named: { eventKey: string; title: string },
  yours: boolean,
  reason: string | null
): Promise<{ line: string; label: string | null }> {
  const [event, calendars] = await Promise.all([
    context.calendar.event(named.eventKey),
    context.calendar.calendars()
  ])

  if (!event) {
    throw new ToolInputError(`«${named.title}» non è più nel calendario.`)
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

  if (!change) {
    return {
      line: `«${event.title}» ${yours ? 'è' : 'non è'} dell'utente: l'ha detto lui.`,
      label: null
    }
  }

  return {
    line: `«${event.title}»${series ? ', e ogni volta della sua serie,' : ''} ${
      yours
        ? "è dell'utente: gli ricorda, e Oggi lo mostra nella sua giornata"
        : "non è dell'utente"
    }.`,
    label: change.label
  }
}

/**
 * An event's note — only when it deserves one: the title says what it is
 * (§7.2). How to prepare it, alive until it comes; what of it the user is
 * to know now; whether it is theirs where its calendar does not say (§7.4).
 */
async function noteOfEvent(
  args: Record<string, unknown>,
  context: ToolContext,
  written: string
): Promise<ToolOutcome> {
  const misplaced = MESSAGE_FIELDS.filter((name) => given(args, name))

  if (misplaced.length > 0) {
    throw new ToolInputError(
      `Un evento non ha una nota come un messaggio — il titolo dice già cos'è —: niente ${misplaced.map((name) => `\`${name}\``).join(', ')}. Della nota di un evento, ciò che serve: \`preparazione\`, \`avvisa\`, \`tuo\` (con \`motivo\`).`
    )
  }

  const alert = alertArg(args)
  const preparation = stringArg(args, 'preparazione')?.trim() || null
  const yours = given(args, 'tuo') ? booleanArg(args, 'tuo') : null

  if (alert === null && preparation === null && yours === null) {
    throw new ToolInputError(
      'Della nota di un evento indica ciò che serve: `preparazione`, `avvisa` (la riga da dire adesso) o `tuo`.'
    )
  }

  if (alert === true) {
    throw new ToolInputError(
      "Per un evento, in `avvisa` scrivi la riga che l'utente riceve: un evento non ha una sintesi da mostrare."
    )
  }

  if (alert !== null && !ALERT_WRITERS.includes(context.run.task)) {
    throw new ToolInputError(
      'Avvisare l’utente di un evento con una notifica si fa guardando i cambiamenti del calendario; con l’utente davanti, diglielo e basta.'
    )
  }

  const event = await eventNamed(context, written)
  const lines: string[] = []
  const labels: string[] = []

  if (alert !== null) {
    const told = await context.calendar.alert(event.eventKey, alert)

    if (told === 'unknown') {
      throw new ToolInputError(
        `«${event.title}» non è più nel calendario e non ne resta traccia: non posso avvisarne.`
      )
    }

    // It stays with the event, one for each change: found again when the event is read.
    await context.registry.day.recordAlert(event.eventKey, alert, context.run.actor.runId ?? null)

    lines.push(
      told === 'told'
        ? `Avvisato l'utente di «${event.title}».`
        : `L'utente ha spento le notifiche del calendario: «${event.title}» lo vedrà da sé.`
    )
    labels.push('Avvisato l’utente')
  }

  if (yours !== null) {
    const marked = await markYours(context, event, yours, stringArg(args, 'motivo')?.trim() || null)
    lines.push(marked.line)

    if (marked.label) {
      labels.push(marked.label)
    }
  }

  if (preparation !== null) {
    await context.registry.savePrep(
      event.eventKey,
      event.title,
      preparation,
      linksIn(preparation, context.handles),
      context.run.actor
    )
    lines.push(`Preparazione di «${event.title}» salvata: la trova sotto l'evento.`)
    labels.push('Preparata una riunione')
  }

  return { content: lines.join(' '), summary: labels.join(' · ') }
}

/**
 * What the Segretario writes beside a thing of a source (vision §5): one
 * tool for every source, its shape as the thing is. A message has its note
 * always, and it is history: what the message asked when it came. An event
 * has one only when it deserves it, alive until the event. A file has none:
 * it is read when the work leads to it (§4.2).
 */
export const noteTool: SegretarioTool = {
  name: 'nota',
  description: PROMPTS.tools.nota,
  parameters: {
    type: 'object',
    properties: {
      messaggio: { type: 'string' },
      sintesi: { type: 'string' },
      natura: { type: 'string', enum: [...NATURES] },
      importanza: { type: 'string', enum: [...PRIORITIES] },
      motivo: { type: 'string' },
      scadenza: { type: ['string', 'null'] },
      evento: { type: 'string' },
      preparazione: { type: 'string' },
      tuo: { type: 'boolean' },
      avvisa: { type: 'string' }
    }
  },
  running: (args) => {
    if (!stringArg(args, 'evento')) {
      return 'Annoto…'
    }

    if (alertArg(args) !== null) {
      return 'Avviso l’utente…'
    }

    return given(args, 'tuo') ? 'Guardo di chi è l’evento…' : 'Preparo la riunione…'
  },
  async execute(args, context) {
    const message = stringArg(args, 'messaggio')
    const event = stringArg(args, 'evento')

    if (message && event) {
      throw new ToolInputError(
        'Una nota è di una cosa sola: `messaggio` oppure `evento`. Per tutte e due, due note.'
      )
    }

    if (message) {
      return noteOfMessage(args, context, message)
    }

    if (event) {
      return noteOfEvent(args, context, event)
    }

    throw new ToolInputError(
      'Indica di che cosa è la nota: un `messaggio` (m…) oppure un `evento` (e…).'
    )
  }
}
