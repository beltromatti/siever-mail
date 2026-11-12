import {
  CALENDAR_HELD_DAYS,
  calendarKey,
  type CalendarEvent,
  type CalendarResponse,
  type EventChange
} from '@shared/calendar'

import { unlinked } from '@shared/segretario-links'

import { messages } from '../../i18n'
import { foldTitle } from '../registry/projects'
import type { ProposalRecord, UndoSpec } from '../registry/types'

import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  type ToolOutcome,
  UnknownHandle
} from '../agent/tool-types'
import { resolveMessage } from './anchors'
import { MESSAGES } from './calendar.messages'
import { countOf, eventWhen } from './format'
import { userDates } from './user-dates'

/** Without dates, the agenda listed: today and the week after. */
const DEFAULT_DAYS = 8
/** Events a list shows at most: past it, it says how many more and asks for a shorter period. */
const LISTED_MAX = 150
/** Free slots offered at most. */
const FREE_SLOTS_SHOWN = 12
/** Events a search gives without `limite`, and at most. */
const DEFAULT_SEARCH_LIMIT = 20

const DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

const RESPONSE_WORDS: Readonly<Record<CalendarResponse, string>> = {
  accepted: 'partecipa',
  tentative: 'forse',
  declined: 'non partecipa',
  needsAction: 'non ha ancora risposto'
}

const ACTIONS = [
  'elenco',
  'cerca',
  'liberi',
  'crea',
  'modifica',
  'elimina',
  'rispondi',
  'proponi',
  'ritira'
] as const

/** An answer to an invitation, in the words a model may write it. */
const RESPONSE_OF: Readonly<Record<string, Exclude<CalendarResponse, 'needsAction'>>> = {
  accepted: 'accepted',
  accetto: 'accepted',
  accetta: 'accepted',
  partecipo: 'accepted',
  partecipa: 'accepted',
  si: 'accepted',
  sì: 'accepted',
  tentative: 'tentative',
  forse: 'tentative',
  declined: 'declined',
  rifiuto: 'declined',
  rifiuta: 'declined',
  no: 'declined',
  'non partecipo': 'declined',
  'non partecipa': 'declined'
}

function responseOf(args: Record<string, unknown>): Exclude<CalendarResponse, 'needsAction'> {
  const written = requireString(args, 'risposta')
  const response = RESPONSE_OF[written.trim().toLowerCase()]

  if (!response) {
    throw new ToolInputError(
      `\`risposta\` è \`accepted\` (partecipa), \`tentative\` (forse) o \`declined\` (non partecipa), non «${written}».`
    )
  }

  return response
}

/** What a change does to an event, line by line, for the user to confirm: what it was, what it becomes. */
function changeLines(event: CalendarEvent, change: EventChange): string[] {
  const lines: string[] = []

  if (change.title !== undefined) lines.push(`Titolo: «${change.title}» (era «${event.title}»)`)
  if (change.start !== undefined || change.end !== undefined || change.allDay !== undefined) {
    lines.push(
      `Quando: ${eventWhen(change.start ?? event.start, change.end ?? event.end, change.allDay ?? event.allDay)} (era ${eventWhen(event.start, event.end, event.allDay)})`
    )
  }
  if (change.location !== undefined) lines.push(`Dove: ${change.location ?? '(nessun luogo)'}`)
  if (change.description !== undefined) lines.push('Cambia la descrizione.')
  if (change.attendees !== undefined) {
    lines.push(`Invitati: ${change.attendees.length > 0 ? change.attendees.join(', ') : 'nessuno'}`)
  }

  return lines
}

/** The same, as the user reads it — on the confirmation, under a proposal — in their language. */
function shownChangeLines(event: CalendarEvent, change: EventChange): string[] {
  const m = messages(MESSAGES)
  const dates = userDates()
  const lines: string[] = []

  if (change.title !== undefined) lines.push(m.titleWas(change.title, event.title))
  if (change.start !== undefined || change.end !== undefined || change.allDay !== undefined) {
    lines.push(
      m.whenWas(
        eventWhen(
          change.start ?? event.start,
          change.end ?? event.end,
          change.allDay ?? event.allDay,
          dates
        ),
        eventWhen(event.start, event.end, event.allDay, dates)
      )
    )
  }
  if (change.location !== undefined) lines.push(m.whereNow(change.location ?? null))
  if (change.description !== undefined) lines.push(m.descriptionChanges)
  if (change.attendees !== undefined) {
    lines.push(m.guestsNow(change.attendees.length > 0 ? change.attendees.join(', ') : null))
  }

  return lines
}

/** A moment's local day, AAAA-MM-GG. */
function localDayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A day written AAAA-MM-GG, at its local midnight. */
function localDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

export function eventLine(
  event: CalendarEvent,
  context: Pick<ToolContext, 'handles' | 'newHandles'>,
  prep?: string
): string {
  const handle = context.handles.name(
    { kind: 'event', eventKey: event.key, title: event.title },
    context.newHandles
  )
  const when = eventWhen(event.start, event.end, event.allDay)
  const others = event.attendees.filter((attendee) => !attendee.self)

  return [
    // Whose it is (§7.4): one of someone else's is not prepared, nor is it a conflict of the user's.
    `${handle} · ${when} · ${event.title} · ${event.calendarName}${event.yours === false ? " · non è dell'utente" : ''}`,
    event.location ? `   luogo: ${event.location}` : null,
    others.length > 0
      ? `   con: ${others
          .slice(0, 8)
          .map(
            (attendee) =>
              `${attendee.name ?? attendee.email} (${RESPONSE_WORDS[attendee.response]})`
          )
          .join(', ')}${others.length > 8 ? ` e altri ${others.length - 8}` : ''}`
      : null,
    event.myResponse && event.myResponse !== 'accepted'
      ? `   l'utente: ${RESPONSE_WORDS[event.myResponse]}`
      : null,
    event.description ? `   ${event.description.replace(/\s+/g, ' ').slice(0, 200)}` : null,
    prep
      ? `   preparazione già scritta: ${unlinked(prep).replace(/\s+/g, ' ').slice(0, 160)}`
      : null
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * "AAAA-MM-GGTHH:MM" (local) or, all day, "AAAA-MM-GG": as the provider takes
 * it. An all-day `fine` is written as the last day, as one says it ("dal 10
 * al 12"); the provider wants the day after.
 */
function instant(value: string | undefined, allDay: boolean, name: string): string {
  const text = value?.trim() ?? ''

  if (allDay) {
    const day = localDay(text)

    if (!day) {
      throw new ToolInputError(`\`${name}\` è una data AAAA-MM-GG.`)
    }

    return name === 'fine'
      ? localDayOf(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))
      : text
  }

  const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? new Date(text) : null

  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new ToolInputError(`\`${name}\` è una data e un'ora AAAA-MM-GGTHH:MM.`)
  }

  return parsed.toISOString()
}

/**
 * Whether an event is all day: as said, or else as its times are written —
 * a day alone, or a day with its hour. Without either, as it was.
 */
function allDayOf(args: Record<string, unknown>, otherwise: boolean): boolean {
  if (args.tutto_il_giorno !== undefined) {
    return booleanArg(args, 'tutto_il_giorno')
  }

  const written = [stringArg(args, 'inizio'), stringArg(args, 'fine')].filter(
    (value): value is string => Boolean(value?.trim())
  )
  return written.length === 0
    ? otherwise
    : written.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))
}

/** The days the calendar keeps, around today: what any period can see of it. */
function heldPeriod(): { from: Date; to: Date } {
  const today = new Date(new Date().setHours(0, 0, 0, 0))
  const at = (offset: number): Date =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
  return { from: at(-CALENDAR_HELD_DAYS.back), to: at(CALENDAR_HELD_DAYS.ahead + 1) }
}

/** What the calendar keeps, in words, for when a period goes past it. */
function heldWords(): string {
  const held = heldPeriod()
  return `Il calendario qui tiene gli eventi dal ${DAY.format(held.from)} al ${DAY.format(new Date(held.to.getTime() - 1))}`
}

/**
 * The period asked — from `da` to `a`, both in; without them today and the
 * week after — kept to what the calendar holds: `narrowed` when it went
 * past it.
 */
function range(
  args: Record<string, unknown>,
  otherwise?: { from: Date; to: Date }
): { from: Date; to: Date; narrowed: boolean } {
  const asked = localDay(stringArg(args, 'da') ?? '') ?? otherwise?.from
  const from = asked ?? new Date(new Date().setHours(0, 0, 0, 0))
  const lastDay = localDay(stringArg(args, 'a') ?? '')
  const to = lastDay
    ? new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
    : (otherwise?.to ??
      new Date(from.getFullYear(), from.getMonth(), from.getDate() + DEFAULT_DAYS))

  if (to <= from) {
    throw new ToolInputError('Un periodo va da `da` ad `a`, con `a` uguale o dopo `da`.')
  }

  const held = heldPeriod()
  const kept = {
    from: from < held.from ? held.from : from,
    to: to > held.to ? held.to : to
  }

  if (kept.to <= kept.from) {
    throw new ToolInputError(
      `${heldWords()}: quel periodo ne è fuori. Di un appuntamento più vecchio può dire la posta (\`cerca_posta\`).`
    )
  }

  return { ...kept, narrowed: kept.from > from || kept.to < to }
}

/** The period a search keeps to, when `da` or `a` say one: from the first day to the last, both in. */
function searchPeriod(args: Record<string, unknown>): { from?: Date; to?: Date } {
  const day = (name: 'da' | 'a'): Date | undefined => {
    const written = stringArg(args, name)

    if (!written) {
      return undefined
    }

    const parsed = localDay(written)

    if (!parsed) {
      throw new ToolInputError(`\`${name}\` è una data AAAA-MM-GG.`)
    }

    return parsed
  }
  const from = day('da')
  const lastDay = day('a')
  const to = lastDay
    ? new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
    : undefined

  if (from && to && to <= from) {
    throw new ToolInputError('`da` è il primo giorno del periodo e `a` l’ultimo: `da` viene prima.')
  }

  return { from, to }
}

/** A search's period in words: " dal ven 6 nov al gio 12 nov", " dal …", " fino al …", or nothing. */
function periodWords(from: Date | undefined, to: Date | undefined): string {
  const last = to ? DAY.format(new Date(to.getTime() - 1)) : null
  return from && last
    ? ` dal ${DAY.format(from)} al ${last}`
    : from
      ? ` dal ${DAY.format(from)}`
      : last
        ? ` fino al ${last}`
        : ''
}

function eventOf(context: ToolContext, args: Record<string, unknown>): string {
  const handle = requireString(args, 'evento')
  const event = context.handles.event(handle)

  if (!event) {
    throw new UnknownHandle(
      `Non conosco l'evento «${handle}»: usa un riferimento e… ricevuto da \`calendario\`.`
    )
  }

  return event.eventKey
}

/** A change to the calendar, in the run's diary: what it did, and how to undo it. */
function recordChange(
  context: ToolContext,
  action: string,
  label: string,
  event: CalendarEvent,
  undo: UndoSpec
): void {
  context.run.changes.push({
    object: 'evento',
    action,
    label,
    accountId: event.origin?.accountId ?? null,
    threadIds: [],
    messageKeys: event.origin?.messageKey ? [event.origin.messageKey] : [],
    projectIds: [],
    id: event.key,
    undo
  })
}

/** What an event was, in the fields a change touches: to put it back. */
function beforeChange(event: CalendarEvent, change: EventChange): EventChange {
  const before: EventChange = {}

  if (change.title !== undefined) before.title = event.title
  if (change.start !== undefined || change.end !== undefined || change.allDay !== undefined) {
    before.start = event.start
    before.end = event.end
    before.allDay = event.allDay
  }
  if (change.location !== undefined) before.location = event.location
  if (change.description !== undefined) before.description = event.description
  if (change.attendees !== undefined) {
    before.attendees = event.attendees
      .filter((attendee) => !attendee.self)
      .map((attendee) => attendee.email)
  }

  return before
}

/** An event someone else organises — an invitation — is answered, not changed or taken away. */
function refuseInvitation(event: CalendarEvent): void {
  if (event.organizedByUser === false) {
    throw new ToolInputError(
      `«${event.title}» lo organizza ${event.organizer ?? 'un altro'}: all'invito si risponde (\`rispondi\`), non si cambia. Se va spostato, scrivilo a chi lo organizza.`
    )
  }
}

/** Whether an event brings in other people: changing it tells them. */
function hasGuests(event: Pick<CalendarEvent, 'attendees'>): boolean {
  return event.attendees.some((attendee) => !attendee.self)
}

/** The calendar an event goes in: the one named, or the only one; its key. */
async function chooseCalendar(context: ToolContext, wanted: string | undefined): Promise<string> {
  const calendars = (await context.calendar.calendars()).filter((calendar) => calendar.writable)

  if (calendars.length === 0) {
    throw new ToolInputError(
      "Nessun calendario collegato in cui scrivere: l'utente lo collega in Impostazioni › Connessioni."
    )
  }

  if (!wanted) {
    if (calendars.length === 1) {
      return calendars[0].key
    }

    throw new ToolInputError(
      `Indica \`calendario\`: ${calendars
        .map(
          (calendar) =>
            `«${calendar.name}» (${calendar.connection}${calendar.primary ? ', principale' : ''})`
        )
        .join(
          ', '
        )}. Scegli quello giusto per chi è l'evento: la tua memoria dice quale calendario è di cosa.`
    )
  }

  const folded = wanted.toLowerCase()
  const match =
    calendars.find((calendar) => calendar.key === wanted) ??
    calendars.find((calendar) =>
      `${calendar.name} ${calendar.connection}`.toLowerCase().includes(folded)
    ) ??
    calendars.find((calendar) => calendar.name.toLowerCase() === folded)

  if (!match) {
    throw new ToolInputError(
      `Nessun calendario «${wanted}». Ci sono: ${calendars.map((calendar) => `«${calendar.name}» (${calendar.connection})`).join(', ')}.`
    )
  }

  return match.key
}

/** The free stretches of the working days in a period, long enough for a meeting. */
function freeSlots(
  events: ReadonlyArray<CalendarEvent>,
  from: Date,
  to: Date,
  minutes: number,
  hours: { start: number; end: number }
): Array<{ start: Date; end: Date }> {
  const busy = events
    .filter((event) => !event.allDay && event.myResponse !== 'declined')
    .map((event) => ({
      start: new Date(event.start).getTime(),
      end: new Date(event.end).getTime()
    }))
    .sort((a, b) => a.start - b.start)
  const slots: Array<{ start: Date; end: Date }> = []
  const now = Date.now()

  for (
    let day = new Date(from);
    day < to && slots.length < FREE_SLOTS_SHOWN;
    day.setDate(day.getDate() + 1)
  ) {
    const weekday = day.getDay()

    if (weekday === 0 || weekday === 6) {
      continue
    }

    let cursor = Math.max(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours.start).getTime(),
      now
    )
    const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours.end).getTime()

    for (const block of busy) {
      if (block.end <= cursor || block.start >= close) {
        continue
      }

      if (block.start - cursor >= minutes * 60_000) {
        slots.push({ start: new Date(cursor), end: new Date(block.start) })
      }

      cursor = Math.max(cursor, block.end)
    }

    if (close - cursor >= minutes * 60_000) {
      slots.push({ start: new Date(cursor), end: new Date(close) })
    }
  }

  return slots.slice(0, FREE_SLOTS_SHOWN)
}

function changeOf(args: Record<string, unknown>, allDay: boolean, wasAllDay: boolean): EventChange {
  const change: EventChange = {}
  const title = stringArg(args, 'titolo')
  const start = stringArg(args, 'inizio')
  const end = stringArg(args, 'fine')

  if (title) change.title = title
  if (start) change.start = instant(start, allDay, 'inizio')
  if (end) change.end = instant(end, allDay, 'fine')
  if (allDay !== wasAllDay) {
    if (!start || !end) {
      throw new ToolInputError(
        allDay
          ? 'Per farlo diventare di tutto il giorno indica `inizio` e `fine` come date (AAAA-MM-GG).'
          : 'Per dargli un orario indica `inizio` e `fine` (AAAA-MM-GGTHH:MM).'
      )
    }

    change.allDay = allDay
  }
  if (args.luogo !== undefined) change.location = stringArg(args, 'luogo') ?? null
  if (args.descrizione !== undefined) change.description = stringArg(args, 'descrizione') ?? null
  if (args.invitati !== undefined) change.attendees = stringListArg(args, 'invitati')

  return change
}

/**
 * Events and proposals are made one at a time: two readings of one booking,
 * running together, each look before making — and see each other's.
 */
let eventsMade: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(make: () => Promise<T>): Promise<T> {
  const made = eventsMade.then(make, make)
  eventsMade = made.catch(() => undefined)
  return made
}

/** Whether two titles name one thing: most words of the shorter in the longer, case and accents aside. */
function sameTitle(a: string, b: string): boolean {
  const words = (title: string): Set<string> =>
    new Set(
      foldTitle(title)
        .split(' ')
        .filter((word) => word.length >= 3)
    )
  const [fewer, more] = [words(a), words(b)].sort((x, y) => x.size - y.size)

  if (fewer.size === 0) {
    return foldTitle(a) === foldTitle(b)
  }

  return [...fewer].filter((word) => more.has(word)).length / fewer.size >= 0.6
}

/** A moment as an event keeps it: an instant, or a day (all day). */
function momentOf(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00`).getTime()
    : Date.parse(value)
}

/**
 * The event already in the calendar for this one — the same times, a title
 * like it — or null: making it again gives the one there is.
 */
async function eventAlreadyThere(
  context: ToolContext,
  wanted: { title: string; start: string; end: string }
): Promise<CalendarEvent | null> {
  const start = momentOf(wanted.start)
  const end = momentOf(wanted.end)
  const around = await context.calendar.events(
    new Date(start - 60_000).toISOString(),
    new Date(end + 60_000).toISOString()
  )
  return (
    around.find(
      (event) =>
        Math.abs(momentOf(event.start) - start) < 60_000 &&
        Math.abs(momentOf(event.end) - end) < 60_000 &&
        sameTitle(event.title, wanted.title)
    ) ?? null
  )
}

/** When an event proposed would be, from what `proponi` kept. */
function proposedTimes(
  payload: Record<string, unknown>
): { start: Date; end: Date; allDay: boolean } | null {
  const allDay = payload.allDay === true
  const at = (value: unknown): Date | null => {
    if (typeof value !== 'string') {
      return null
    }

    const date = new Date(allDay && !value.includes('T') ? `${value}T00:00` : value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const start = at(payload.start)
  const end = at(payload.end)
  return start && end ? { start, end, allDay } : null
}

/** An event proposed, as the calendar lists it: what, when, with whom. */
function proposalLine(proposal: ProposalRecord): string {
  const times = proposedTimes(proposal.payload)
  const attendees = Array.isArray(proposal.payload.attendees)
    ? proposal.payload.attendees.filter((value): value is string => typeof value === 'string')
    : []
  // Kept as an event's are — an all-day one ending the day after its last —: said as one.
  const when = times
    ? ` · ${eventWhen(String(proposal.payload.start), String(proposal.payload.end), times.allDay)}`
    : ''

  return `- «${String(proposal.payload.title ?? proposal.title)}»${when}${
    attendees.length > 0 ? ` · con ${attendees.join(', ')}` : ''
  }`
}

/** The events of a period, with their preparations, and the events proposed in it. */
async function listEvents(
  context: ToolContext,
  { from, to, narrowed }: { from: Date; to: Date; narrowed: boolean }
): Promise<ToolOutcome> {
  const events = await context.calendar.events(from.toISOString(), to.toISOString())
  const shown = events.slice(0, LISTED_MAX)
  const preps = await context.registry.day.preps(shown.map((event) => event.key))
  const lastDay = new Date(to.getTime() - 1)
  const proposed = (await context.registry.proposals.open({ kind: 'evento' })).filter(
    (proposal) => {
      const start = proposedTimes(proposal.payload)?.start
      return start !== undefined && start >= from && start < to
    }
  )
  const period = `dal ${DAY.format(from)} al ${DAY.format(lastDay)}${narrowed ? ` (${heldWords().replace('Il calendario qui', 'il calendario')}: il periodo è quello)` : ''}`
  const lines = [
    events.length === 0
      ? `Nessun evento ${period}.`
      : `${countOf(events.length, 'evento', 'eventi')} ${period}${
          events.length > shown.length
            ? `; ecco i primi ${shown.length}, gli altri chiedili con un periodo più breve`
            : ''
        }:\n${shown.map((event) => eventLine(event, context, preps.get(event.key)?.text)).join('\n')}`
  ]

  if (proposed.length > 0) {
    lines.push(
      `Proposti da te, in attesa che l'utente li accetti:\n${proposed.map(proposalLine).join('\n')}`
    )
  }

  return {
    content: lines.join('\n\n'),
    summary: messages(MESSAGES).looked(events.length)
  }
}

export const calendarTool: SegretarioTool = {
  name: 'calendario',
  description: PROMPTS.tools.calendario,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: [...ACTIONS] },
      parole: { type: 'string' },
      da: { type: 'string' },
      a: { type: 'string' },
      durata: { type: 'integer' },
      dalle: { type: 'integer' },
      alle: { type: 'integer' },
      evento: { type: 'string' },
      calendario: { type: 'string' },
      titolo: { type: 'string' },
      inizio: { type: 'string' },
      fine: { type: 'string' },
      tutto_il_giorno: { type: 'boolean' },
      luogo: { type: 'string' },
      descrizione: { type: 'string' },
      invitati: { type: 'array', items: { type: 'string' } },
      messaggio: { type: 'string' },
      risposta: { type: 'string', enum: ['accepted', 'tentative', 'declined'] },
      motivo: { type: 'string' },
      limite: { type: 'integer' }
    },
    required: ['azione']
  },
  running: (args) => {
    const m = messages(MESSAGES)
    const words = stringArg(args, 'parole')

    return (
      {
        cerca: words ? m.searchingFor(words) : m.searching,
        crea: m.creating,
        modifica: m.editing,
        elimina: m.removing,
        rispondi: m.answering,
        ritira: m.withdrawing,
        proponi: m.proposing,
        liberi: m.freeSlots
      }[String(args.azione)] ?? m.looking
    )
  },
  readsOnly: (args) => ['elenco', 'cerca', 'liberi'].includes(String(args.azione)),
  async execute(args, context): Promise<ToolOutcome> {
    const action = requireString(args, 'azione') as (typeof ACTIONS)[number]

    switch (action) {
      case 'elenco':
        return listEvents(context, range(args))
      case 'cerca': {
        const words = stringArg(args, 'parole')?.trim()

        // Nothing to look for: what there is, in the period asked or all the calendar keeps.
        if (!words) {
          return listEvents(context, range(args, heldPeriod()))
        }

        const { from, to } = searchPeriod(args)
        const limit = Math.max(1, numberArg(args, 'limite') ?? DEFAULT_SEARCH_LIMIT)
        const found = await context.calendar.search({
          text: words,
          fromIso: from?.toISOString(),
          toIso: to?.toISOString(),
          limit
        })
        const events = [...found.upcoming, ...found.past]
        const period = periodWords(from, to)

        if (events.length === 0) {
          return {
            content: `Nessun evento con «${words}»${period}. Ogni parola si cerca nel titolo, nel luogo, nella descrizione, tra gli invitati (nomi e indirizzi) e nel nome del calendario, e devono esserci tutte: prova con meno parole o con altre — il cognome, la località, una parola del titolo${period ? ', o senza `da` e `a`' : ''}. ${heldWords()}: di un appuntamento più vecchio può dire la posta (\`cerca_posta\`).`,
            summary: messages(MESSAGES).searched(words, 0)
          }
        }

        const preps = await context.registry.day.preps(events.map((event) => event.key))
        const section = (title: string, listed: ReadonlyArray<CalendarEvent>): string | null =>
          listed.length === 0
            ? null
            : `${title}:\n${listed
                .map((event) => eventLine(event, context, preps.get(event.key)?.text))
                .join('\n')}`

        return {
          content: [
            `${countOf(events.length, 'evento', 'eventi')} con «${words}»${period}${
              found.more > 0
                ? `, i più vicini a oggi: ce ne sono altri ${found.more}, più lontani (restringi con altre parole o con \`da\` e \`a\`, o alza \`limite\`)`
                : ''
            }.`,
            section('In arrivo, dal più vicino', found.upcoming),
            section('Passati, dal più recente', found.past)
          ]
            .filter(Boolean)
            .join('\n\n'),
          summary: messages(MESSAGES).searched(words, events.length)
        }
      }
      case 'liberi': {
        const { from, to } = range(args)
        const minutes = Math.min(8 * 60, Math.max(15, numberArg(args, 'durata') ?? 60))
        const hours = { start: numberArg(args, 'dalle') ?? 9, end: numberArg(args, 'alle') ?? 18 }
        const slots = freeSlots(
          await context.calendar.events(from.toISOString(), to.toISOString()),
          from,
          to,
          minutes,
          hours
        )

        return {
          content:
            slots.length === 0
              ? 'Nessun orario libero abbastanza lungo in quel periodo, nei giorni feriali.'
              : `Liberi (giorni feriali, ${hours.start}–${hours.end}, almeno ${minutes} minuti):\n${slots
                  .map(
                    (slot) =>
                      `- ${DAY.format(slot.start)} ${TIME.format(slot.start)}–${TIME.format(slot.end)}`
                  )
                  .join('\n')}`,
          summary: messages(MESSAGES).foundFree(slots.length)
        }
      }
      case 'crea': {
        const allDay = allDayOf(args, false)
        const attendees = stringListArg(args, 'invitati')

        if (attendees.length > 0 && context.run.background) {
          throw new ToolInputError(
            'Un evento con invitati manda loro un invito: da solo non puoi. Usa `proponi`, e l’utente lo crea con un clic.'
          )
        }

        const key = await chooseCalendar(context, stringArg(args, 'calendario'))
        const source = stringArg(args, 'messaggio')
          ? await resolveMessage(context, stringArg(args, 'messaggio')!)
          : null
        const event = {
          calendarKey: key,
          title: requireString(args, 'titolo'),
          start: instant(stringArg(args, 'inizio'), allDay, 'inizio'),
          end: instant(stringArg(args, 'fine'), allDay, 'fine'),
          allDay,
          location: stringArg(args, 'luogo') ?? null,
          description: stringArg(args, 'descrizione') ?? null,
          attendees,
          origin: {
            by: 'segretario' as const,
            messageKey: source?.messageKey ?? null,
            accountId: source?.accountId ?? null
          }
        }

        if (attendees.length > 0) {
          const m = messages(MESSAGES)
          const { approved } = await context.requestApproval({
            kind: 'action',
            title: m.newEvent(event.title),
            details: [
              m.when(eventWhen(event.start, event.end, allDay, userDates())),
              ...(event.location ? [m.where(event.location)] : []),
              m.invited(attendees.join(', '))
            ],
            confirmLabel: m.createAndInvite
          })

          if (!approved) {
            return {
              content: "L'utente non l'ha confermato: niente evento.",
              summary: messages(MESSAGES).notCreated
            }
          }
        }

        return oneAtATime(async () => {
          const there = await eventAlreadyThere(context, event)

          if (there) {
            return {
              content: `C'è già: ${eventLine(there, context)} — stesso orario, titolo simile. Se è un altro evento, dagli un titolo che lo distingua.`,
              summary: messages(MESSAGES).alreadyThere(there.title)
            }
          }

          const created = await context.calendar.create(event)
          recordChange(context, 'creato', messages(MESSAGES).created(created.title), created, {
            kind: 'evento-creato',
            eventKey: created.key
          })
          return {
            content: `Creato: ${eventLine(created, context)}`,
            summary: messages(MESSAGES).created(created.title)
          }
        })
      }
      case 'modifica': {
        const key = eventOf(context, args)
        const current = await context.calendar.event(key)

        if (!current) {
          throw new ToolInputError("L'evento non c'è più.")
        }

        refuseInvitation(current)
        const change = changeOf(args, allDayOf(args, current.allDay), current.allDay)
        // People are told of a change to an event they are in — and invited by one that adds them.
        const invited = change.attendees ?? []

        if (
          hasGuests(current) ||
          invited.length > 0 ||
          (current.organizer && current.myResponse !== null)
        ) {
          if (context.run.background) {
            throw new ToolInputError(
              'L’evento coinvolge altre persone, o le invita: correggerlo le avvisa. Da solo non puoi: proponilo con `proponi` e spiegane il motivo.'
            )
          }

          const m = messages(MESSAGES)
          const { approved } = await context.requestApproval({
            kind: 'action',
            title: m.change(current.title),
            details: [
              ...shownChangeLines(current, change),
              invited.length > 0 ? m.guestsInvitedOrUpdated : m.guestsUpdated
            ],
            confirmLabel: m.changeLabel
          })

          if (!approved) {
            return {
              content: "L'utente non l'ha confermato.",
              summary: messages(MESSAGES).notChanged
            }
          }
        }

        const updated = await context.calendar.update(key, change)
        recordChange(
          context,
          'modificato',
          messages(MESSAGES).correctedInCalendar(updated.title),
          updated,
          {
            kind: 'evento-modificato',
            eventKey: key,
            before: beforeChange(current, change)
          }
        )
        return {
          content: `Aggiornato: ${eventLine(updated, context)}`,
          summary: messages(MESSAGES).corrected(updated.title)
        }
      }
      case 'elimina': {
        const key = eventOf(context, args)
        const current = await context.calendar.event(key)

        if (!current) {
          return { content: "L'evento non c'era più.", summary: messages(MESSAGES).alreadyGone }
        }

        refuseInvitation(current)

        if (context.run.background && (hasGuests(current) || current.origin?.by !== 'segretario')) {
          throw new ToolInputError(
            'Da solo puoi togliere solo un evento che hai messo tu e che non ha invitati: per questo, proponilo all’utente.'
          )
        }

        if (!context.run.background) {
          const m = messages(MESSAGES)
          const { approved } = await context.requestApproval({
            kind: 'action',
            title: m.delete(current.title),
            details: hasGuests(current) ? [m.guestsCancelled] : [],
            confirmLabel: m.deleteLabel
          })

          if (!approved) {
            return {
              content: "L'utente non l'ha confermato.",
              summary: messages(MESSAGES).notRemoved
            }
          }
        }

        await context.calendar.remove(key)
        recordChange(context, 'eliminato', messages(MESSAGES).removed(current.title), current, {
          kind: 'evento-eliminato',
          event: {
            calendarKey: calendarKey(current.connectionId, current.calendarId),
            title: current.title,
            start: current.start,
            end: current.end,
            allDay: current.allDay,
            location: current.location,
            description: current.description,
            attendees: current.attendees
              .filter((attendee) => !attendee.self)
              .map((attendee) => attendee.email),
            origin: current.origin
          }
        })
        return {
          content: `Tolto «${current.title}».`,
          summary: messages(MESSAGES).removed(current.title)
        }
      }
      case 'rispondi': {
        const key = eventOf(context, args)
        const response = responseOf(args)

        if (context.run.background) {
          throw new ToolInputError(
            'Rispondere a un invito lo decide l’utente: se serve, scrivilo nella nota o proponilo.'
          )
        }

        const current = await context.calendar.event(key)
        const m = messages(MESSAGES)
        const { approved } = await context.requestApproval({
          kind: 'action',
          title: m.respond(response, current?.title ?? null),
          details: [m.answer(response), m.organizerTold],
          confirmLabel: m.replyLabel
        })

        if (!approved) {
          return {
            content: "L'utente non l'ha confermato.",
            summary: messages(MESSAGES).notAnswered
          }
        }

        const answered = await context.calendar.respond(key, response)
        return {
          content: `Risposto: ${eventLine(answered, context)}`,
          summary: messages(MESSAGES).answered(answered.title)
        }
      }
      case 'proponi': {
        const source = stringArg(args, 'messaggio')
          ? await resolveMessage(context, stringArg(args, 'messaggio')!)
          : null
        const from = {
          accountId: source?.accountId ?? null,
          messageKey: source?.messageKey ?? null,
          threadId: source?.threadId ?? null
        }

        if (stringArg(args, 'evento')) {
          // About an event already there: an answer to its invitation, or a change to it. Each
          // proposal holds only what it changes, and takes the place of one waiting on that event.
          const eventKey = eventOf(context, args)
          const current = await context.calendar.event(eventKey)

          if (!current) {
            throw new ToolInputError("L'evento non c'è più.")
          }

          const waiting = (await context.registry.proposals.open({ kind: 'evento' })).find(
            (proposal) => proposal.payload.eventKey === eventKey
          )
          const shown = {
            title: current.title,
            start: current.start,
            end: current.end,
            allDay: current.allDay,
            location: current.location,
            eventKey
          }

          if (stringArg(args, 'risposta')) {
            const response = responseOf(args)
            const proposal = await context.registry.propose(
              {
                kind: 'evento',
                title: messages(MESSAGES).proposeAnswer(response, current.title),
                payload: { ...shown, response },
                ...from,
                replaces: waiting?.id ?? null,
                perMessage: false
              },
              context.run.actor
            )
            return {
              content: `Proposta all'utente: ${proposal.title}. La vede in Oggi e nel calendario e risponde con un clic.`,
              summary: messages(MESSAGES).proposedAnswer(current.title)
            }
          }

          // Someone else's event: what can be proposed is the answer to its invitation.
          refuseInvitation(current)
          const change = changeOf(args, allDayOf(args, current.allDay), current.allDay)

          if (Object.keys(change).length === 0) {
            throw new ToolInputError(
              'Indica cosa cambia (`inizio` e `fine`, `titolo`, `luogo`, `descrizione`, `invitati`), oppure `risposta` per rispondere al suo invito.'
            )
          }

          const proposal = await context.registry.propose(
            {
              kind: 'evento',
              title: messages(MESSAGES).change(current.title),
              payload: {
                ...shown,
                title: change.title ?? current.title,
                start: change.start ?? current.start,
                end: change.end ?? current.end,
                allDay: change.allDay ?? current.allDay,
                location: change.location !== undefined ? change.location : current.location,
                change,
                changes: shownChangeLines(current, change)
              },
              ...from,
              replaces: waiting?.id ?? null,
              perMessage: false
            },
            context.run.actor
          )
          return {
            content: `Proposta all'utente: ${proposal.title} (${changeLines(current, change).join('; ')}). La vede in Oggi e nel calendario e la applica con un clic.`,
            summary: messages(MESSAGES).proposedChange(current.title)
          }
        }

        const allDay = allDayOf(args, false)
        const title = requireString(args, 'titolo')
        const start = instant(stringArg(args, 'inizio'), allDay, 'inizio')
        const end = instant(stringArg(args, 'fine'), allDay, 'fine')

        return oneAtATime(async () => {
          // A new event already there, or already proposed, is not proposed twice.
          const there = await eventAlreadyThere(context, { title, start, end })

          if (there) {
            return {
              content: `È già in calendario: ${eventLine(there, context)} — non serve proporlo.`,
              summary: messages(MESSAGES).alreadyThere(there.title)
            }
          }

          const waiting = (await context.registry.proposals.open({ kind: 'evento' })).find(
            (proposal) => {
              const times = proposedTimes(proposal.payload)
              return (
                !proposal.payload.eventKey &&
                times !== null &&
                Math.abs(times.start.getTime() - momentOf(start)) < 60_000 &&
                Math.abs(times.end.getTime() - momentOf(end)) < 60_000 &&
                sameTitle(String(proposal.payload.title ?? proposal.title), title)
              )
            }
          )

          if (waiting) {
            return {
              content: `La proposta c'è già e aspetta l'utente: ${proposalLine(waiting).slice(2)}.`,
              summary: messages(MESSAGES).alreadyProposed(title)
            }
          }

          const proposal = await context.registry.propose(
            {
              kind: 'evento',
              title: messages(MESSAGES).proposeEvent(title),
              payload: {
                title,
                start,
                end,
                allDay,
                location: stringArg(args, 'luogo') ?? null,
                description: stringArg(args, 'descrizione') ?? null,
                attendees: stringListArg(args, 'invitati'),
                calendar: stringArg(args, 'calendario') ?? null,
                eventKey: null
              },
              ...from,
              perMessage: false
            },
            context.run.actor
          )
          return {
            content: `Proposta all'utente: ${proposal.title}. La vede in Oggi e nel calendario e la crea con un clic.`,
            summary: messages(MESSAGES).proposed(title)
          }
        })
      }
      case 'ritira': {
        // A proposal of an event that no longer holds — the meeting cancelled, agreed otherwise.
        const title = requireString(args, 'titolo')
        const reason = requireString(args, 'motivo')
        const at = stringArg(args, 'inizio')
        const matching = (await context.registry.proposals.open({ kind: 'evento' })).filter(
          (proposal) => {
            const times = proposedTimes(proposal.payload)
            return (
              sameTitle(String(proposal.payload.title ?? proposal.title), title) &&
              (!at || (times !== null && localDayOf(times.start) === at.slice(0, 10)))
            )
          }
        )

        if (matching.length !== 1) {
          throw new ToolInputError(
            matching.length === 0
              ? `Nessuna proposta in attesa si chiama così. Quelle in attesa le vedi con \`elenco\`.`
              : `Più proposte in attesa si chiamano così:\n${matching.map(proposalLine).join('\n')}\nIndica in \`inizio\` il giorno (AAAA-MM-GG) di quella da ritirare.`
          )
        }

        const withdrawn = await context.registry.withdrawProposal(
          matching[0].id,
          reason,
          context.run.actor
        )
        return {
          content: `Ritirata: ${proposalLine(withdrawn).slice(2)}.`,
          summary: messages(MESSAGES).withdrew(String(withdrawn.payload.title ?? withdrawn.title))
        }
      }
      default:
        throw new ToolInputError(`\`azione\` è una di: ${ACTIONS.join(', ')}.`)
    }
  }
}
