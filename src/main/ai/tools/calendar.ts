import {
  CALENDAR_HELD_DAYS,
  calendarKey,
  eventMoveLimit,
  seriesKey,
  WEEKDAYS,
  type CalendarEvent,
  type CalendarProviderKind,
  type CalendarResponse,
  type EventChange,
  type EventMoveLimit,
  type EventRecurrence,
  type NewCalendarEvent
} from '@shared/calendar'

import { unlinked } from '@shared/segretario-links'

import { messages } from '../../i18n'
import { foldTitle } from '../registry/projects'
import type { EventUndo, ProposalRecord, UndoSpec } from '../registry/types'

import { PROMPTS } from '../prompts'
import {
  booleanArg,
  MissingArgument,
  numberArg,
  requireString,
  type RunContext,
  seenKey,
  type SegretarioCalendarPort,
  type SegretarioTool,
  stringArg,
  stringListArg,
  type ToolContext,
  ToolInputError,
  type ToolOutcome,
  UnknownHandle
} from '../agent/tool-types'
import { resolveMessage } from './anchors'
import { MESSAGES, shownRecurrence, shownReminders } from './calendar.messages'
import { countOf, eventWhen } from './format'
import {
  recurrenceArg,
  recurrenceWords,
  remindersArg,
  remindersWords,
  RIPETI_SCHEMA,
  startDay,
  weekdayOf
} from './recurrence'
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

/** Another service keeps the event (vision §7.5): what the model is told of it. */
const MANAGED_WORDS: Readonly<Record<NonNullable<CalendarEvent['managedBy']>, string>> = {
  gmail: 'messo da Gmail da una prenotazione o da un biglietto: se ne cambiano solo i promemoria',
  birthdays: 'un compleanno dei contatti di Google: se ne cambiano solo i promemoria'
}

/** How many reminders an event keeps, by who its calendar is with: Microsoft one, Google five. */
const REMINDERS_KEPT: Readonly<Partial<Record<CalendarProviderKind, number>>> = {
  google: 5,
  microsoft: 1
}

/** The fields a change takes, as the model is told them when it gives none. */
const CHANGE_FIELDS =
  '`titolo`, `inizio` e `fine`, `luogo`, `descrizione`, `invitati`, `calendario` (per spostarlo in un altro), `ripeti`, `promemoria`'

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

/** A calendar, as the Segretario reaches it. */
type CalendarEntry = Awaited<ReturnType<SegretarioCalendarPort['calendars']>>[number]

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

/** A calendar's name as an event or a list of calendars says it; the key when it is not there. */
function calendarName(calendars: ReadonlyArray<CalendarEntry>, key: string): string {
  return calendars.find((calendar) => calendar.key === key)?.name ?? key
}

/** What a change does to an event, line by line, for the model: what it was, what it becomes. */
function changeLines(
  event: CalendarEvent,
  change: EventChange,
  calendars: ReadonlyArray<CalendarEntry>
): string[] {
  const lines: string[] = []

  if (change.calendarKey !== undefined) {
    lines.push(
      `Calendario: «${calendarName(calendars, change.calendarKey)}» (era «${event.calendarName}»)`
    )
  }
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
  if (change.recurrence !== undefined) {
    lines.push(
      change.recurrence
        ? recurrenceWords(change.recurrence, change.start ?? event.start)
        : 'non si ripete più'
    )
  }
  if (change.reminders !== undefined) {
    lines.push(
      `promemoria: ${change.reminders ? remindersWords(change.reminders, change.allDay ?? event.allDay) : 'quelli del calendario'}`
    )
  }

  return lines
}

/**
 * The same, as the user reads it — on the confirmation, under a proposal —
 * in their language. Without the event, for several at once: what each
 * becomes.
 */
function shownChangeLines(
  event: CalendarEvent | null,
  change: EventChange,
  calendars: ReadonlyArray<CalendarEntry>
): string[] {
  const m = messages(MESSAGES)
  const dates = userDates()
  const lines: string[] = []
  const start = change.start ?? event?.start
  const allDay = change.allDay ?? event?.allDay ?? false

  if (change.calendarKey !== undefined) {
    lines.push(
      m.calendarWas(calendarName(calendars, change.calendarKey), event?.calendarName ?? null)
    )
  }
  if (change.title !== undefined) {
    lines.push(event ? m.titleWas(change.title, event.title) : m.titleNow(change.title))
  }
  if (
    event &&
    (change.start !== undefined || change.end !== undefined || change.allDay !== undefined)
  ) {
    lines.push(
      m.whenWas(
        eventWhen(change.start ?? event.start, change.end ?? event.end, allDay, dates),
        eventWhen(event.start, event.end, event.allDay, dates)
      )
    )
  }
  if (change.location !== undefined) lines.push(m.whereNow(change.location ?? null))
  if (change.description !== undefined) lines.push(m.descriptionChanges)
  if (change.attendees !== undefined) {
    lines.push(m.guestsNow(change.attendees.length > 0 ? change.attendees.join(', ') : null))
  }
  if (change.recurrence !== undefined) {
    lines.push(
      change.recurrence && start
        ? m.repeats(shownRecurrence(change.recurrence, start))
        : m.repeatsNoMore
    )
  }
  if (change.reminders !== undefined) {
    lines.push(m.remindersNow(shownReminders(change.reminders, allDay)))
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

/**
 * What an event is besides when, where and with whom, for the model (vision
 * §7.5): how it repeats, another service that keeps it, its own reminders.
 */
export function eventFacts(event: CalendarEvent): string[] {
  const repeats = event.recurrence
    ? recurrenceWords(event.recurrence, event.start)
    : event.seriesId
      ? 'si ripete'
      : null

  return [
    repeats,
    event.managedBy ? MANAGED_WORDS[event.managedBy] : null,
    Array.isArray(event.reminders)
      ? `promemoria: ${remindersWords(event.reminders, event.allDay)}`
      : null
  ].filter((fact): fact is string => fact !== null)
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
    ...eventFacts(event).map((fact) => `   ${fact}`),
    event.description ? `   ${event.description.replace(/\s+/g, ' ').slice(0, 200)}` : null,
    prep
      ? `   preparazione già scritta: ${unlinked(prep).replace(/\s+/g, ' ').slice(0, 160)}`
      : null
  ]
    .filter(Boolean)
    .join('\n')
}

/** An event in one line, as a list of several says each: its name, when, what, where. */
function eventHead(event: CalendarEvent, context: ToolContext): string {
  return eventLine(event, context).split('\n')[0]
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

/** The key of an event the run has a name for. */
function eventKeyOf(context: ToolContext, handle: string): string {
  const event = context.handles.event(handle)

  if (!event) {
    throw new UnknownHandle(
      `Non conosco l'evento «${handle}»: usa un riferimento e… ricevuto da \`calendario\`.`
    )
  }

  return event.eventKey
}

/** The events a call is about: `evento`, one or a list — the same change to each (§4.6). */
function eventsOf(args: Record<string, unknown>): string[] {
  const handles = [...new Set(stringListArg(args, 'evento').map((handle) => handle.trim()))]

  if (handles.length === 0) {
    throw new MissingArgument('Manca il parametro `evento`: un riferimento e…, o una lista.')
  }

  return handles
}

/** A change to the calendar, in the run's diary: what it did, and how to undo it. */
function recordChange(
  context: ToolContext,
  action: string,
  label: string,
  event: CalendarEvent | null,
  id: string,
  undo: UndoSpec | undefined
): void {
  context.run.changes.push({
    object: 'evento',
    action,
    label,
    accountId: event?.origin?.accountId ?? null,
    threadIds: [],
    messageKeys: event?.origin?.messageKey ? [event.origin.messageKey] : [],
    projectIds: [],
    id,
    undo
  })
}

/**
 * The diary's line of the same change to several events, or to one: one
 * line, one undo that puts each back (§4.6).
 */
function recordChanges(
  context: ToolContext,
  action: string,
  label: string,
  done: ReadonlyArray<{ event: CalendarEvent; undo: EventUndo | null }>
): void {
  const undoable = done.flatMap((each) => (each.undo ? [each.undo] : []))

  if (done.length === 1) {
    recordChange(context, action, label, done[0].event, done[0].event.key, undoable[0])
  } else if (done.length > 1) {
    recordChange(
      context,
      action,
      label,
      null,
      done[0].event.key,
      undoable.length > 0 ? { kind: 'eventi', each: undoable } : undefined
    )
  }
}

/**
 * An event this run moved under a new key: its name, what the run has
 * changed of it and what it has seen of it follow — the same event (§7.5).
 */
function followMoved(context: ToolContext, from: string, to: CalendarEvent): void {
  if (from === to.key) {
    return
  }

  context.handles.follow(from, { eventKey: to.key, title: to.title }, context.newHandles)
  followInRun(context.run, from, to.key)
}

function followInRun(run: RunContext, from: string, to: string): void {
  const follow = (undo: UndoSpec): void => {
    if ('eventKey' in undo && undo.eventKey === from) {
      undo.eventKey = to
    }

    if (undo.kind === 'eventi') {
      undo.each.forEach(follow)
    }
  }

  for (const change of run.changes) {
    if (change.object === 'evento' && change.id === from) {
      change.id = to
    }

    if (change.undo) {
      follow(change.undo)
    }
  }

  for (const kind of ['prep', 'mark'] as const) {
    const seen = run.seen.get(seenKey(kind, from))

    if (seen !== undefined) {
      run.seen.set(seenKey(kind, to), seen)
      run.seen.delete(seenKey(kind, from))
    }
  }
}

/** What an event was, in the fields a change touches: to put it back. */
function beforeChange(event: CalendarEvent, change: EventChange): EventChange {
  const before: EventChange = {}

  if (change.calendarKey !== undefined) {
    before.calendarKey = calendarKey(event.connectionId, event.calendarId)
  }
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
  // A rule made elsewhere is never changed here: what is put back is a rule, or none.
  if (change.recurrence !== undefined && event.recurrence !== 'other') {
    before.recurrence = event.recurrence ?? null
  }
  if (change.reminders !== undefined) before.reminders = event.reminders ?? null

  return before
}

/**
 * Who organises an event, as the model can name them: a person by name and
 * address, a calendar of Google's by its name (its address is an id nobody
 * reads, «…@group.calendar.google.com»).
 */
function organizerOf(event: CalendarEvent): string {
  const organizer = event.attendees.find((attendee) => attendee.organizer)
  const address = organizer?.email ?? event.organizer
  const name = organizer?.name?.trim()

  if (!address) {
    return 'un altro'
  }

  if (/@group\.(?:v\.)?calendar\.google\.com$/i.test(address)) {
    return name ? `il calendario «${name}»` : 'un calendario condiviso'
  }

  return name && name !== address ? `${name} <${address}>` : address
}

/** An event someone else organises — an invitation — is answered, not changed or taken away. */
function invitationRefusal(event: CalendarEvent): string | null {
  return event.organizedByUser === false
    ? `«${event.title}» lo organizza ${organizerOf(event)}: all'invito si risponde (\`rispondi\`), non si cambia. Se va spostato, scrivilo a chi lo organizza.`
    : null
}

function refuseInvitation(event: CalendarEvent): void {
  const refusal = invitationRefusal(event)

  if (refusal) {
    throw new ToolInputError(refusal)
  }
}

/** Whether an event brings in other people: changing it tells them. */
function hasGuests(event: Pick<CalendarEvent, 'attendees'>): boolean {
  return event.attendees.some((attendee) => !attendee.self)
}

/**
 * Whether a change reaches other people, so the user decides it (§4.7): an
 * event with guests, one that invites, a meeting the user is in. Its own
 * reminders are the user's alone.
 */
function reachesOthers(event: CalendarEvent, change: EventChange): boolean {
  const personal = Object.keys(change).every((field) => field === 'reminders')
  return (
    !personal &&
    (hasGuests(event) ||
      (change.attendees ?? []).length > 0 ||
      Boolean(event.organizer && event.myResponse !== null))
  )
}

/** Why an event cannot move to a calendar (`eventMoveLimit`), so the model can act on it. */
function moveRefusal(
  limit: EventMoveLimit,
  event: CalendarEvent,
  from: CalendarEntry | undefined,
  to: CalendarEntry
): string {
  switch (limit) {
    case 'same':
      return `«${event.title}» è già in «${to.name}».`
    case 'readonly':
      return to.writable
        ? `«${event.title}» sta in «${event.calendarName}», un calendario in cui non si scrive: resta dov'è.`
        : `In «${to.name}» non si scrive: non prende eventi. Scegli un calendario in cui si scrive.`
    case 'managed':
      return event.managedBy === 'birthdays'
        ? `«${event.title}» è un compleanno dei contatti di Google: Google non lo lascia spostare in un altro calendario. Resta dov'è; se all'utente importa, diglielo.`
        : `«${event.title}» l'ha messo Gmail da una prenotazione o da un biglietto: Google non lo lascia spostare in un altro calendario. Resta dov'è; se all'utente importa, diglielo.`
    case 'invitation':
      return `«${event.title}» è un invito di ${organizerOf(event)}: si risponde, non si sposta.`
    case 'guests':
      return `«${event.title}» ha invitati: spostarlo in «${to.name}» (${from?.connectionId === to.connectionId ? 'su Microsoft si toglie e si rimette' : 'un altro account'}) vorrebbe dire annullarlo per loro e invitarli di nuovo, e qui non si fa. Resta dov'è; se all'utente importa, diglielo.`
  }
}

/**
 * The calendar named — by its key, its name, or a part of its name with
 * its connection — among these; none, or more than one, is refused with
 * those there are.
 */
function calendarNamed(calendars: ReadonlyArray<CalendarEntry>, wanted: string): CalendarEntry {
  const folded = wanted.trim().toLowerCase()
  const exact = calendars.filter(
    (calendar) => calendar.key === wanted || calendar.name.trim().toLowerCase() === folded
  )
  const found =
    exact.length > 0
      ? exact
      : calendars.filter((calendar) =>
          `${calendar.name} ${calendar.connection}`.toLowerCase().includes(folded)
        )
  const named = (list: ReadonlyArray<CalendarEntry>): string =>
    list.map((calendar) => `«${calendar.name}» (${calendar.connection})`).join(', ')

  if (found.length === 1) {
    return found[0]
  }

  throw new ToolInputError(
    found.length === 0
      ? `Nessun calendario «${wanted}». Ci sono: ${named(calendars)}.`
      : `Più calendari rispondono a «${wanted}»: ${named(found)}. Indica quale, con il nome e l'account.`
  )
}

/** The calendar an event goes in: the one named, or the only one. */
async function chooseCalendar(
  context: ToolContext,
  wanted: string | undefined
): Promise<CalendarEntry> {
  const calendars = (await context.calendar.calendars()).filter((calendar) => calendar.writable)

  if (calendars.length === 0) {
    throw new ToolInputError(
      "Nessun calendario collegato in cui scrivere: l'utente lo collega in Impostazioni › Connessioni."
    )
  }

  if (!wanted) {
    if (calendars.length === 1) {
      return calendars[0]
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

  return calendarNamed(calendars, wanted)
}

/** Reminders a calendar keeps: more than it takes are refused, so none is lost unsaid. */
function checkReminders(
  reminders: ReadonlyArray<number> | null | undefined,
  provider?: string
): void {
  const kept = provider ? REMINDERS_KEPT[provider as CalendarProviderKind] : undefined

  if (reminders && kept !== undefined && reminders.length > kept) {
    throw new ToolInputError(
      kept === 1
        ? 'Questo calendario (Microsoft) tiene un promemoria solo: scegline uno.'
        : `Questo calendario tiene al massimo ${kept} promemoria per evento.`
    )
  }
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

/** A moment as an event keeps it: an instant, or a day (all day). */
function momentOf(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00`).getTime()
    : Date.parse(value)
}

/** Whether two rules repeat alike, from an event's start: a week's days as its own when unsaid. */
function sameRule(a: EventRecurrence, b: EventRecurrence, start: string): boolean {
  const days = (rule: EventRecurrence): string =>
    rule.frequency === 'weekly'
      ? WEEKDAYS.filter((day) =>
          (rule.weekdays?.length ? rule.weekdays : [weekdayOf(startDay(start))]).includes(day)
        ).join()
      : ''

  return (
    a.frequency === b.frequency &&
    a.interval === b.interval &&
    days(a) === days(b) &&
    (a.monthlyBy ?? 'day') === (b.monthlyBy ?? 'day') &&
    (a.until ?? null) === (b.until ?? null) &&
    (a.count ?? null) === (b.count ?? null)
  )
}

/**
 * What `modifica` and `proponi` change of an event: the fields given, those
 * that differ from what it is — the calendar, which is found by name, aside.
 * Its times only with `times`: never the same start for several events.
 */
function changeOf(
  args: Record<string, unknown>,
  event: CalendarEvent,
  times: boolean
): EventChange {
  const change: EventChange = {}
  const title = stringArg(args, 'titolo')
  const start = stringArg(args, 'inizio')
  const end = stringArg(args, 'fine')
  const allDay = allDayOf(args, event.allDay)

  if (title && title !== event.title) change.title = title

  if (times) {
    if (start) change.start = instant(start, allDay, 'inizio')
    if (end) change.end = instant(end, allDay, 'fine')
    if (allDay !== event.allDay) {
      if (!start || !end) {
        throw new ToolInputError(
          allDay
            ? 'Per farlo diventare di tutto il giorno indica `inizio` e `fine` come date (AAAA-MM-GG).'
            : 'Per dargli un orario indica `inizio` e `fine` (AAAA-MM-GGTHH:MM).'
        )
      }

      change.allDay = allDay
    }

    // A time given as it is changes nothing.
    if (
      change.allDay === undefined &&
      (change.start === undefined || momentOf(change.start) === momentOf(event.start)) &&
      (change.end === undefined || momentOf(change.end) === momentOf(event.end))
    ) {
      delete change.start
      delete change.end
    }
  }

  if (args.luogo !== undefined) {
    const location = stringArg(args, 'luogo') ?? null
    if (location !== event.location) change.location = location
  }
  if (args.descrizione !== undefined) {
    const description = stringArg(args, 'descrizione') ?? null
    if (description !== event.description) change.description = description
  }
  if (args.invitati !== undefined) {
    const attendees = stringListArg(args, 'invitati')
    const now = event.attendees.filter((attendee) => !attendee.self)
    const folded = (list: ReadonlyArray<string>): string =>
      [...new Set(list.map((address) => address.trim().toLowerCase()))].sort().join()

    if (folded(attendees) !== folded(now.map((attendee) => attendee.email))) {
      change.attendees = attendees
    }
  }

  // An instance's first time is its series': the calendar checks the rule against it.
  const recurrence = recurrenceArg(args, change.start ?? (event.seriesId ? null : event.start))

  if (recurrence !== undefined) {
    if (event.recurrence === 'other') {
      throw new ToolInputError(
        `«${event.title}» si ripete con una regola fatta altrove, che qui non si cambia: se va cambiata, l'utente lo fa nel calendario dove è nata.`
      )
    }

    const repeats = event.recurrence ?? null

    if (
      recurrence === null
        ? repeats !== null || event.seriesId !== null
        : !repeats || !sameRule(recurrence, repeats, event.start)
    ) {
      change.recurrence = recurrence
    }
  }

  const reminders = remindersArg(args)

  if (
    reminders !== undefined &&
    (!Array.isArray(event.reminders) ||
      reminders.join() !== [...event.reminders].sort((a, b) => a - b).join())
  ) {
    change.reminders = reminders
  }

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

/* ───────────────────── the same change to one event or to several ───────────────────── */

/** One of the events a call is about, read: what it is, or why it is left as it is. */
interface Item {
  handle: string
  key: string | null
  event: CalendarEvent | null
  /** Why it is left as it is, for the model. */
  refused?: string
}

/** An item read, and not left as it is: what the call acts on. */
type Ready = Item & { key: string; event: CalendarEvent }

function ready(item: Item): item is Ready {
  return !item.refused && item.key !== null && item.event !== null
}

/**
 * Reads the events a call names. One alone that cannot be read is the
 * call's mistake; of several, each is said on its own (§4.6). Of several
 * instances of one series that the call acts on whole, the first stands for
 * it — the others went with it.
 */
async function readItems(
  context: ToolContext,
  handles: ReadonlyArray<string>,
  wholeSeries: boolean
): Promise<Item[]> {
  const items: Item[] = []
  const series = new Map<string, string>()

  for (const handle of handles) {
    let key: string

    try {
      key = eventKeyOf(context, handle)
    } catch (error) {
      if (handles.length === 1) {
        throw error
      }

      items.push({ handle, key: null, event: null, refused: (error as Error).message })
      continue
    }

    const event = await context.calendar.event(key)

    if (!event) {
      items.push({ handle, key, event: null, refused: "l'evento non c'è più." })
      continue
    }

    const of =
      wholeSeries && event.seriesId
        ? seriesKey(event.connectionId, event.calendarId, event.seriesId)
        : null
    const first = of ? series.get(of) : undefined

    if (first) {
      items.push({
        handle,
        key,
        event,
        refused: `è della stessa serie di ${first}, che vale per tutte: già compreso.`
      })
      continue
    }

    if (of) {
      series.set(of, handle)
    }

    items.push({ handle, key, event })
  }

  return items
}

/** An item left as it is, as the model reads it: «e3 «Titolo»: why». */
function leftLine(item: Item): string {
  return `${item.handle}${item.event ? ` «${item.event.title}»` : ''}: ${item.refused ?? ''}`
}

/** What became of several events: done, then those left as they were and why. */
function itemsContent(
  heading: string,
  done: ReadonlyArray<string>,
  left: ReadonlyArray<Item>
): string {
  return [
    `${heading}${done.length > 0 ? `:\n${done.map((line) => `- ${line}`).join('\n')}` : '.'}`,
    left.length > 0
      ? `Lasciati com'erano:\n${left.map((item) => `- ${leftLine(item)}`).join('\n')}`
      : null
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** A call on one event: its refusal is the call's, said as a mistake the model can act on. */
function refuseAlone(items: ReadonlyArray<Item>): void {
  const [only] = items

  if (items.length === 1 && only.refused) {
    throw new ToolInputError(`${only.refused.charAt(0).toUpperCase()}${only.refused.slice(1)}`)
  }

  if (items.every((item) => item.refused)) {
    throw new ToolInputError(
      `Nessuno di questi eventi è cambiato:\n${items.map((item) => `- ${leftLine(item)}`).join('\n')}`
    )
  }
}

/** The events one confirmation is about, as the user reads them. */
function shownItems(items: ReadonlyArray<Item>): string[] {
  const m = messages(MESSAGES)
  return items.flatMap((item) =>
    item.event
      ? [
          m.eventItem(
            item.event.title,
            eventWhen(item.event.start, item.event.end, item.event.allDay, userDates())
          )
        ]
      : []
  )
}

/** A change planned for one event: what changes, whether the user decides it. */
interface Planned {
  item: Ready
  change: EventChange
  asks: boolean
}

/**
 * `modifica`: the same change to one event or to several — moved to another
 * calendar, repeated, reminded, retitled. What reaches other people waits
 * for the user (§4.7); each event is checked on its own; one line in the
 * diary, with one undo.
 */
/** The arguments of `modifica` that say what changes. */
const CHANGE_ARGS = [
  'titolo',
  'inizio',
  'fine',
  'tutto_il_giorno',
  'luogo',
  'descrizione',
  'invitati',
  'calendario',
  'ripeti',
  'promemoria'
] as const

async function changeEvents(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const handles = eventsOf(args)
  const many = handles.length > 1
  const series = booleanArg(args, 'serie')

  if (
    many &&
    (args.inizio !== undefined || args.fine !== undefined || args.tutto_il_giorno !== undefined)
  ) {
    throw new ToolInputError(
      'Lo stesso orario per più eventi non si dà: cambia l’orario di ciascuno con una chiamata sua.'
    )
  }

  const said = CHANGE_ARGS.some((field) => args[field] !== undefined && args[field] !== null)

  if (!said) {
    throw new ToolInputError(`Indica cosa cambia: ${CHANGE_FIELDS}.`)
  }

  const calendars = await context.calendar.calendars()
  const wanted = stringArg(args, 'calendario')
  const target = wanted ? calendarNamed(calendars, wanted) : null
  // A move, a rule and a change asked of the series act on the whole series.
  const items = await readItems(
    context,
    handles,
    target !== null || series || args.ripeti !== undefined
  )
  const planned: Planned[] = []

  for (const item of items.filter(ready)) {
    const { event } = item
    const refused = (reason: string): void => {
      item.refused = reason
    }

    try {
      const invitation = invitationRefusal(event)

      if (invitation) {
        refused(invitation)
        continue
      }

      const change = changeOf(args, event, !many)
      const from = calendars.find(
        (calendar) => calendar.key === calendarKey(event.connectionId, event.calendarId)
      )

      if (target) {
        const limit = eventMoveLimit(event, from ?? { writable: true, provider: target.provider }, {
          connectionId: target.connectionId,
          calendarId: target.key.slice(target.connectionId.length + 1),
          writable: target.writable
        })

        if (limit && limit !== 'same') {
          refused(moveRefusal(limit, event, from, target))
          continue
        }

        if (!limit) {
          change.calendarKey = target.key
        }
      }

      if (event.managedBy && Object.keys(change).some((field) => field !== 'reminders')) {
        refused(
          `«${event.title}» ${MANAGED_WORDS[event.managedBy]}: il resto lo tiene quel servizio.`
        )
        continue
      }

      if (Object.keys(change).length === 0) {
        refused(
          target && !change.calendarKey
            ? moveRefusal('same', event, from, target)
            : `è già così: ${eventHead(event, context)}.`
        )
        continue
      }

      checkReminders(change.reminders, (target ?? from)?.provider)

      const asks = reachesOthers(event, change)

      if (asks && context.run.background) {
        refused(
          'coinvolge altre persone, o le invita: cambiarlo le avvisa. Da solo non puoi: proponilo con `proponi` e spiegane il motivo.'
        )
        continue
      }

      // On its own, the Segretario changes the user's events, or those it put there (§4.7).
      if (context.run.background && event.yours === false && event.origin?.by !== 'segretario') {
        refused(
          "non è dell'utente: da solo non lo cambi. Se serve, proponilo con `proponi` e spiegane il motivo."
        )
        continue
      }

      planned.push({ item, change, asks })
    } catch (error) {
      if (!(error instanceof ToolInputError) || !many) {
        throw error
      }

      refused(error.message)
    }
  }

  refuseAlone(items)

  const m = messages(MESSAGES)
  const asking = planned.filter((plan) => plan.asks)
  const moved = target !== null && planned.some((plan) => plan.change.calendarKey)
  let declined = false

  if (asking.length > 0) {
    const [first] = asking
    const moveOnly = asking.every(
      (plan) => Object.keys(plan.change).length === 1 && plan.change.calendarKey !== undefined
    )
    const { approved } = await context.requestApproval({
      kind: 'action',
      title: asking.length === 1 ? m.change(first.item.event.title) : m.changeMany(asking.length),
      details: [
        ...(asking.length === 1 ? [] : shownItems(asking.map((plan) => plan.item))),
        ...shownChangeLines(asking.length === 1 ? first.item.event : null, first.change, calendars),
        ...(series && asking.some((plan) => plan.item.event.seriesId) ? [m.wholeSeries] : []),
        moveOnly
          ? m.guestsNotTold
          : asking.some((plan) => (plan.change.attendees ?? []).length > 0)
            ? m.guestsInvitedOrUpdated
            : m.guestsUpdated
      ],
      confirmLabel: moveOnly ? m.moveLabel : m.changeLabel
    })

    if (!approved) {
      if (!many) {
        return { content: "L'utente non l'ha confermato.", summary: m.notChanged }
      }

      declined = true

      for (const plan of asking) {
        plan.item.refused = "l'utente non l'ha confermato."
      }
    }
  }

  const done: Array<{ event: CalendarEvent; undo: EventUndo | null; line: string }> = []

  for (const { item, change } of planned) {
    if (item.refused) {
      continue
    }

    const whole = Boolean(item.event.seriesId) && series

    try {
      const updated = await context.calendar.update(item.key, change, { series: whole })
      followMoved(context, item.key, updated)
      const notes = [
        change.calendarKey && item.event.seriesId
          ? 'con tutta la serie: un evento che si ripete si sposta intero'
          : null,
        whole ? 'tutta la serie' : null,
        change.recurrence !== undefined && item.event.seriesId && !whole
          ? 'come si ripete è della serie: vale per tutta'
          : null
      ].filter(Boolean)
      done.push({
        event: updated,
        undo: {
          kind: 'evento-modificato',
          eventKey: updated.key,
          before: beforeChange(item.event, change),
          series: whole
        },
        line: `${change.calendarKey ? `spostato in «${target?.name}»` : 'aggiornato'}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}: ${many ? eventHead(updated, context) : eventLine(updated, context)}`
      })
    } catch (error) {
      if (!many) {
        throw error
      }

      item.refused = `non riuscito: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const left = items.filter((item) => item.refused)
  // What changed, said for what it is where it is one thing: how it repeats, its reminders.
  const given = CHANGE_ARGS.filter((name) => args[name] !== undefined && args[name] !== null)
  const named =
    given.length === 1 && given[0] === 'ripeti'
      ? typeof args.ripeti === 'object' &&
        String((args.ripeti as Record<string, unknown>).ogni)
          .trim()
          .toLowerCase() === 'mai'
        ? m.repeatsNoLonger
        : m.repeatsFrom
      : given.length === 1 && given[0] === 'promemoria'
        ? m.remindersChanged
        : null
  const label =
    done.length === 1
      ? moved
        ? m.movedTo(target!.name, done[0].event.title)
        : (named ?? m.correctedInCalendar)(done[0].event.title)
      : moved
        ? m.movedMany(done.length, target!.name)
        : m.correctedMany(done.length)

  recordChanges(context, 'modificato', label, done)

  if (!many) {
    const [only] = done
    return {
      content: `${only.line.charAt(0).toUpperCase()}${only.line.slice(1)}`,
      summary: moved
        ? m.movedTo(target!.name, only.event.title)
        : (named ?? m.corrected)(only.event.title)
    }
  }

  return {
    content: itemsContent(
      `${done.length} di ${items.length} ${moved ? `spostati in «${target?.name}»` : 'aggiornati'}`,
      done.map((each) => each.line),
      left
    ),
    summary: `${done.length === 0 ? m.notChanged : label}${left.length > 0 && done.length > 0 ? m.leftAsTheyWere(left.length) : ''}`,
    failed: done.length === 0 && !declined
  }
}

/**
 * A series as it is put back when taken away whole: from its first
 * instance the calendar still keeps, with its rule and its reminders.
 */
async function seriesAsNew(
  context: ToolContext,
  event: CalendarEvent,
  recurrence: EventRecurrence
): Promise<NewCalendarEvent> {
  const held = heldPeriod()
  const first =
    (await context.calendar.events(held.from.toISOString(), held.to.toISOString()))
      .filter(
        (each) =>
          each.seriesId === event.seriesId &&
          each.connectionId === event.connectionId &&
          each.calendarId === event.calendarId
      )
      .sort((a, b) => momentOf(a.start) - momentOf(b.start))[0] ?? event

  return { ...asNew(first), recurrence }
}

/** An event as it would be made again: to put back one taken away. */
function asNew(event: CalendarEvent): NewCalendarEvent {
  return {
    calendarKey: calendarKey(event.connectionId, event.calendarId),
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
    description: event.description,
    attendees: event.attendees
      .filter((attendee) => !attendee.self)
      .map((attendee) => attendee.email),
    origin: event.origin,
    reminders: event.reminders ?? null
  }
}

/**
 * `elimina`: one event or several — of an instance, the whole series with
 * `serie`. In the chat the user confirms once; on its own the Segretario
 * takes away only what it put there, without guests (§4.7).
 */
async function removeEvents(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const handles = eventsOf(args)
  const many = handles.length > 1
  const series = booleanArg(args, 'serie')
  const items = await readItems(context, handles, series)
  const m = messages(MESSAGES)

  // One already gone is what was asked.
  if (!many && items[0].event === null) {
    return { content: "L'evento non c'era più.", summary: m.alreadyGone }
  }

  for (const item of items.filter(ready)) {
    item.refused =
      invitationRefusal(item.event) ??
      (context.run.background && (hasGuests(item.event) || item.event.origin?.by !== 'segretario')
        ? 'da solo puoi togliere solo un evento che hai messo tu e che non ha invitati: per questo, proponilo all’utente.'
        : undefined)
  }

  refuseAlone(items)

  const planned = items.filter(ready)

  if (!context.run.background) {
    const { approved } = await context.requestApproval({
      kind: 'action',
      title: planned.length === 1 ? m.delete(planned[0].event.title) : m.deleteMany(planned.length),
      details: [
        ...(planned.length === 1 ? [] : shownItems(planned)),
        ...(series && planned.some((item) => item.event.seriesId) ? [m.wholeSeries] : []),
        ...(planned.some((item) => hasGuests(item.event)) ? [m.guestsCancelled] : [])
      ],
      confirmLabel: m.deleteLabel
    })

    if (!approved) {
      return { content: "L'utente non l'ha confermato.", summary: m.notRemoved }
    }
  }

  const done: Array<{ event: CalendarEvent; undo: EventUndo | null; line: string }> = []

  for (const item of planned) {
    const { event } = item
    const whole = Boolean(event.seriesId) && series

    try {
      // What puts it back, read before it goes: a series with its rule, from its first instance kept.
      const again =
        whole && event.recurrence && event.recurrence !== 'other'
          ? await seriesAsNew(context, event, event.recurrence)
          : whole
            ? null
            : asNew(event)
      await context.calendar.remove(item.key, { series: whole })
      done.push({
        event,
        undo: again ? { kind: 'evento-eliminato', event: again } : null,
        line: `tolto «${event.title}»${whole ? ', con tutta la serie' : ''}`
      })
    } catch (error) {
      if (!many) {
        throw error
      }

      item.refused = `non riuscito: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const left = items.filter((item) => item.refused)
  const label = done.length === 1 ? m.removed(done[0].event.title) : m.removedMany(done.length)
  recordChanges(context, 'eliminato', label, done)

  if (!many) {
    return {
      content: `${done[0].line.charAt(0).toUpperCase()}${done[0].line.slice(1)}.`,
      summary: label
    }
  }

  return {
    content: itemsContent(
      `${done.length} di ${items.length} tolti`,
      done.map((each) => each.line),
      left
    ),
    summary: `${done.length === 0 ? m.notRemoved : label}${left.length > 0 && done.length > 0 ? m.leftAsTheyWere(left.length) : ''}`,
    failed: done.length === 0
  }
}

/**
 * `rispondi`: the answer to one invitation or to several — of an instance,
 * the whole series with `serie` —, confirmed once by the user; the
 * organisers are told.
 */
async function answerEvents(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const handles = eventsOf(args)
  const response = responseOf(args)

  if (context.run.background) {
    throw new ToolInputError(
      'Rispondere a un invito lo decide l’utente: se serve, scrivilo nella nota o proponilo.'
    )
  }

  const many = handles.length > 1
  const series = booleanArg(args, 'serie')
  const items = await readItems(context, handles, series)
  const m = messages(MESSAGES)

  for (const item of items.filter(ready)) {
    if (item.event.myResponse === null) {
      item.refused = `«${item.event.title}» non è un invito: non c'è niente a cui rispondere.`
    }
  }

  refuseAlone(items)

  const planned = items.filter(ready)
  const { approved } = await context.requestApproval({
    kind: 'action',
    title:
      planned.length === 1
        ? m.respond(response, planned[0].event.title)
        : m.respondMany(response, planned.length),
    details: [
      ...(planned.length === 1 ? [] : shownItems(planned)),
      ...(series && planned.some((item) => item.event.seriesId) ? [m.wholeSeries] : []),
      m.answer(response),
      m.organizerTold
    ],
    confirmLabel: m.replyLabel
  })

  if (!approved) {
    return { content: "L'utente non l'ha confermato.", summary: m.notAnswered }
  }

  const done: string[] = []

  for (const item of planned) {
    const whole = Boolean(item.event.seriesId) && series

    try {
      const answered = await context.calendar.respond(item.key, response, { series: whole })
      done.push(
        `${many ? eventHead(answered, context) : eventLine(answered, context)}${whole ? ' (tutta la serie)' : ''}`
      )
    } catch (error) {
      if (!many) {
        throw error
      }

      item.refused = `non riuscito: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const left = items.filter((item) => item.refused)

  if (!many) {
    return {
      content: `Risposto: ${done[0]}`,
      summary: m.answered(planned[0].event.title)
    }
  }

  return {
    content: itemsContent(`${done.length} di ${items.length} risposti`, done, left),
    summary: `${done.length === 0 ? m.notAnswered : m.answeredMany(done.length)}${left.length > 0 && done.length > 0 ? m.leftAsTheyWere(left.length) : ''}`,
    failed: done.length === 0
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
      evento: { type: ['string', 'array'], items: { type: 'string' } },
      calendario: { type: 'string' },
      titolo: { type: 'string' },
      inizio: { type: 'string' },
      fine: { type: 'string' },
      tutto_il_giorno: { type: 'boolean' },
      luogo: { type: 'string' },
      descrizione: { type: 'string' },
      invitati: { type: 'array', items: { type: 'string' } },
      ripeti: RIPETI_SCHEMA,
      promemoria: { type: 'array', items: { type: 'integer' } },
      serie: { type: 'boolean' },
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
    const many = stringListArg(args, 'evento').length > 1

    return (
      {
        cerca: words ? m.searchingFor(words) : m.searching,
        crea: m.creating,
        modifica: stringArg(args, 'calendario')
          ? m.moving(many ? 2 : 1)
          : many
            ? m.editingMany
            : m.editing,
        elimina: many ? m.removingMany : m.removing,
        rispondi: many ? m.answeringMany : m.answering,
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

        const calendar = await chooseCalendar(context, stringArg(args, 'calendario'))
        const source = stringArg(args, 'messaggio')
          ? await resolveMessage(context, stringArg(args, 'messaggio')!)
          : null
        const start = instant(stringArg(args, 'inizio'), allDay, 'inizio')
        const recurrence = recurrenceArg(args, start)
        const reminders = remindersArg(args)
        checkReminders(reminders, calendar.provider)
        const event: NewCalendarEvent = {
          calendarKey: calendar.key,
          title: requireString(args, 'titolo'),
          start,
          end: instant(stringArg(args, 'fine'), allDay, 'fine'),
          allDay,
          location: stringArg(args, 'luogo') ?? null,
          description: stringArg(args, 'descrizione') ?? null,
          attendees,
          origin: {
            by: 'segretario' as const,
            messageKey: source?.messageKey ?? null,
            accountId: source?.accountId ?? null
          },
          recurrence: recurrence ?? null,
          ...(reminders !== undefined ? { reminders } : {})
        }

        if (attendees.length > 0) {
          const m = messages(MESSAGES)
          const { approved } = await context.requestApproval({
            kind: 'action',
            title: m.newEvent(event.title),
            details: [
              m.when(eventWhen(event.start, event.end, allDay, userDates())),
              ...(event.location ? [m.where(event.location)] : []),
              m.calendarWas(calendar.name, null),
              ...(recurrence ? [m.repeats(shownRecurrence(recurrence, start))] : []),
              ...(reminders !== undefined
                ? [m.remindersNow(shownReminders(reminders, allDay))]
                : []),
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
              content: `C'è già, in «${there.calendarName}»: ${eventLine(there, context)} — stesso orario, titolo simile. Se è un altro evento, dagli un titolo che lo distingua; se va in un altro calendario, spostalo (\`modifica\` con \`calendario\`) invece di rifarlo.`,
              summary: messages(MESSAGES).alreadyThere(there.title)
            }
          }

          const created = await context.calendar.create(event)
          recordChange(
            context,
            'creato',
            messages(MESSAGES).created(created.title),
            created,
            created.key,
            { kind: 'evento-creato', eventKey: created.key, series: Boolean(recurrence) }
          )
          return {
            content: `Creato: ${eventLine(created, context)}`,
            summary: messages(MESSAGES).created(created.title)
          }
        })
      }
      case 'modifica':
        return changeEvents(context, args)
      case 'elimina':
        return removeEvents(context, args)
      case 'rispondi':
        return answerEvents(context, args)
      case 'proponi': {
        const source = stringArg(args, 'messaggio')
          ? await resolveMessage(context, stringArg(args, 'messaggio')!)
          : null
        const from = {
          accountId: source?.accountId ?? null,
          messageKey: source?.messageKey ?? null,
          threadId: source?.threadId ?? null
        }

        const about = stringListArg(args, 'evento')

        if (about.length > 1) {
          throw new ToolInputError(
            'Si propone per un evento alla volta: una proposta è una decisione dell’utente su una cosa.'
          )
        }

        if (about.length === 1) {
          // About an event already there: an answer to its invitation, or a change to it. Each
          // proposal holds only what it changes, and takes the place of one waiting on that event.
          const eventKey = eventKeyOf(context, about[0])
          const current = await context.calendar.event(eventKey)

          if (!current) {
            throw new ToolInputError("L'evento non c'è più.")
          }

          const waiting = (await context.registry.proposals.open({ kind: 'evento' })).find(
            (proposal) => proposal.payload.eventKey === eventKey
          )
          const series = booleanArg(args, 'serie') && current.seriesId !== null
          const shown = {
            title: current.title,
            start: current.start,
            end: current.end,
            allDay: current.allDay,
            location: current.location,
            eventKey,
            series
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
              content: `Proposta all'utente: ${proposal.title}${series ? ' (tutta la serie)' : ''}. La vede in Oggi e nel calendario e risponde con un clic.`,
              summary: messages(MESSAGES).proposedAnswer(current.title)
            }
          }

          // Someone else's event: what can be proposed is the answer to its invitation.
          refuseInvitation(current)
          const change = changeOf(args, current, true)
          const calendars = await context.calendar.calendars()
          const wanted = stringArg(args, 'calendario')
          const origin = calendars.find(
            (calendar) => calendar.key === calendarKey(current.connectionId, current.calendarId)
          )

          if (wanted) {
            const target = calendarNamed(calendars, wanted)
            const limit = eventMoveLimit(
              current,
              origin ?? { writable: true, provider: target.provider },
              {
                connectionId: target.connectionId,
                calendarId: target.key.slice(target.connectionId.length + 1),
                writable: target.writable
              }
            )

            if (limit && limit !== 'same') {
              throw new ToolInputError(moveRefusal(limit, current, origin, target))
            }

            if (!limit) {
              change.calendarKey = target.key
            }
          }

          checkReminders(
            change.reminders,
            calendars.find((calendar) => calendar.key === change.calendarKey)?.provider ??
              origin?.provider
          )

          if (current.managedBy && Object.keys(change).some((field) => field !== 'reminders')) {
            throw new ToolInputError(
              `«${current.title}» ${MANAGED_WORDS[current.managedBy]}: il resto lo tiene quel servizio.`
            )
          }

          if (Object.keys(change).length === 0) {
            throw new ToolInputError(
              `Indica cosa cambia (${CHANGE_FIELDS}), oppure \`risposta\` per rispondere al suo invito.`
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
                changes: [
                  ...shownChangeLines(current, change, calendars),
                  ...(series ? [messages(MESSAGES).wholeSeries] : [])
                ]
              },
              ...from,
              replaces: waiting?.id ?? null,
              perMessage: false
            },
            context.run.actor
          )
          return {
            content: `Proposta all'utente: ${proposal.title} (${changeLines(current, change, calendars).join('; ')}${series ? '; tutta la serie' : ''}). La vede in Oggi e nel calendario e la applica con un clic.`,
            summary: messages(MESSAGES).proposedChange(current.title)
          }
        }

        const allDay = allDayOf(args, false)
        const title = requireString(args, 'titolo')
        const start = instant(stringArg(args, 'inizio'), allDay, 'inizio')
        const end = instant(stringArg(args, 'fine'), allDay, 'fine')
        const recurrence = recurrenceArg(args, start)
        const reminders = remindersArg(args)
        const named = stringArg(args, 'calendario')
        const calendar = named
          ? calendarNamed(
              (await context.calendar.calendars()).filter((each) => each.writable),
              named
            )
          : null
        checkReminders(reminders, calendar?.provider)

        return oneAtATime(async () => {
          // A new event already there, or already proposed, is not proposed twice.
          const there = await eventAlreadyThere(context, { title, start, end })

          if (there) {
            return {
              content: `È già in calendario, in «${there.calendarName}»: ${eventLine(there, context)} — non serve proporlo.`,
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
                calendar: calendar?.name ?? null,
                calendarKey: calendar?.key ?? null,
                recurrence: recurrence ?? null,
                reminders: reminders ?? null,
                eventKey: null
              },
              ...from,
              perMessage: false
            },
            context.run.actor
          )
          return {
            content: `Proposta all'utente: ${proposal.title}${recurrence ? ` (${recurrenceWords(recurrence, start)})` : ''}. La vede in Oggi e nel calendario e la crea con un clic.`,
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
