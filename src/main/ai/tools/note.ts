import { calendarKey, seriesKey } from '@shared/calendar'

import { linksIn } from '../agent/entries'
import { PROMPTS } from '../prompts'
import { RegistryRefusal, RevisionConflict } from '../registry/types'
import type { NoteNature, NotePriority } from '../registry/types'
import {
  booleanArg,
  markSeenKey,
  requireString,
  seenKey,
  seenOf,
  stringArg,
  ToolConflict,
  ToolInputError,
  type SegretarioTool,
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

/** How far ahead an event named by its title is looked for. */
const EVENT_AHEAD_DAYS = 14

function given(args: Record<string, unknown>, name: string): boolean {
  return args[name] !== undefined && args[name] !== null && args[name] !== ''
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
 * rewritten as the matter goes on. Over the note the run saw (§4.6).
 */
async function noteOfMessage(
  args: Record<string, unknown>,
  context: ToolContext,
  handle: string
): Promise<ToolOutcome> {
  const misplaced = EVENT_FIELDS.filter((name) => given(args, name))

  if (misplaced.length > 0) {
    throw new ToolInputError(
      `La nota di un messaggio non ha ${misplaced.map((name) => `\`${name}\``).join(' né ')}: è \`sintesi\`, \`natura\`, \`importanza\`, \`motivo\` e \`scadenza\`.`
    )
  }

  const message = await resolveSentOrReceived(context, handle)
  const summary = requireString(args, 'sintesi')
  const nature = requireString(args, 'natura') as NoteNature
  const priority = requireString(args, 'importanza') as NotePriority
  const seen = seenKey('note', message.accountId, message.messageKey)

  try {
    const { record, change } = await context.registry.writeNote(
      { ...message, messageDate: message.dateIso },
      {
        summary,
        nature,
        priority,
        reason: stringArg(args, 'motivo') ?? '',
        due: dayArg(args, 'scadenza')
      },
      context.run.actor,
      { seenRevision: seenOf(context.run, seen) }
    )
    context.run.seen.set(seen, record.revision)

    return {
      content: `Nota di ${handle} ${change.action === 'scritta' ? 'scritta' : 'corretta'}.`,
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
 * A write over what the run saw of a thing (§4.6): refused, it shows the
 * thing as it is now — and the run has seen it, so rewriting it knowingly goes.
 */
async function overSeen<T>(
  context: ToolContext,
  seen: string,
  write: (seenAt: number) => Promise<T>
): Promise<T> {
  try {
    return await write(seenOf(context.run, seen))
  } catch (error) {
    if (error instanceof RevisionConflict) {
      context.run.seen.set(seen, error.current.revision)
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
  const seen = markSeenKey({ eventKey: event.key, seriesKey: series })
  const change = await overSeen(context, seen, (seenAt) =>
    context.registry.markEvent(
      { key: event.key, title: event.title, seriesKey: series },
      yours,
      reason,
      byUser ? { ...context.run.actor, by: 'utente' } : context.run.actor,
      seenAt
    )
  )
  context.run.seen.set(
    seen,
    (await context.registry.ownership.markOf(event.key, series))?.setAt ?? 0
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
 * (§7.2). How to prepare it, alive until it comes; whether it is the user's
 * where its calendar does not say (§7.4). Over what the run saw (§4.6).
 */
async function noteOfEvent(
  args: Record<string, unknown>,
  context: ToolContext,
  written: string
): Promise<ToolOutcome> {
  const misplaced = MESSAGE_FIELDS.filter((name) => given(args, name))

  if (misplaced.length > 0) {
    throw new ToolInputError(
      `Un evento non ha una nota come un messaggio — il titolo dice già cos'è —: niente ${misplaced.map((name) => `\`${name}\``).join(', ')}. Della nota di un evento, ciò che serve: \`preparazione\`, \`tuo\` (con \`motivo\`).`
    )
  }

  const preparation = stringArg(args, 'preparazione')?.trim() || null
  const yours = given(args, 'tuo') ? booleanArg(args, 'tuo') : null

  if (preparation === null && yours === null) {
    throw new ToolInputError(
      'Della nota di un evento indica ciò che serve: `preparazione`, o `tuo` con `motivo`.'
    )
  }

  const event = await eventNamed(context, written)
  const lines: string[] = []
  const labels: string[] = []

  // A write over what changed since the run looked, or that it never looked at, is shown first.
  const checked = async (write: () => Promise<void>): Promise<void> => {
    try {
      await write()
    } catch (error) {
      if (error instanceof RevisionConflict) {
        throw new ToolConflict([...lines, error.message].join(' '))
      }

      if (error instanceof RegistryRefusal) {
        throw new ToolInputError([...lines, error.message].join(' '))
      }

      throw error
    }
  }

  if (yours !== null) {
    await checked(async () => {
      const marked = await markYours(
        context,
        event,
        yours,
        stringArg(args, 'motivo')?.trim() || null
      )
      lines.push(marked.line)

      if (marked.label) {
        labels.push(marked.label)
      }
    })
  }

  if (preparation !== null) {
    await checked(async () => {
      const seen = seenKey('prep', event.eventKey)
      const prep = await overSeen(context, seen, (seenAt) =>
        context.registry.savePrep(
          event.eventKey,
          event.title,
          preparation,
          linksIn(preparation, context.handles),
          context.run.actor,
          seenAt
        )
      )
      context.run.seen.set(seen, prep.writtenAt)
      lines.push(`Preparazione di «${event.title}» salvata: la trova sotto l'evento.`)
      labels.push('Preparata una riunione')
    })
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
      tuo: { type: 'boolean' }
    }
  },
  running: (args) => {
    if (!stringArg(args, 'evento')) {
      return 'Annoto…'
    }

    return given(args, 'tuo') ? 'Guardo di chi è l’evento…' : 'Preparo la riunione…'
  },
  async execute(args, context) {
    const message = stringArg(args, 'messaggio')
    const event = stringArg(args, 'evento')

    // Telling the user is an action of its own, not a note's (§13.3).
    if (given(args, 'avvisa')) {
      throw new ToolInputError(
        'Una nota non avvisa: per dire all’utente adesso ciò che non può aspettare, c’è `avvisa`. Scrivi la nota senza.'
      )
    }

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
