import {
  calendarKey,
  defaultCalendarRole,
  seriesKey,
  type CalendarAttendee,
  type CalendarEvent,
  type CalendarProviderKind,
  type CalendarRole
} from '@shared/calendar'

import { addressOrNull, organizerIsUser } from './event-roles'

/** A calendar as whose its events are is reckoned (§7.4). */
export interface OwnedCalendar {
  role: CalendarRole
  primary: boolean
  writable: boolean
}

/** What the Segretario found of whose things are (§7.4): kept with the AI, read with it on. */
export interface SegretarioOwnership {
  /** The calendars whose role it decided, by `calendarKey`: the role, and why. */
  roles: ReadonlyMap<string, { role: CalendarRole; reason: string | null }>
  /** The events it found the user's though their calendar does not say, by key. */
  events: ReadonlySet<string>
  /** The series it found the user's, by `seriesKey`: every instance is. */
  series: ReadonlySet<string>
}

export interface Ownership {
  /** Every calendar kept, by `calendarKey`. */
  calendars: ReadonlyMap<string, OwnedCalendar>
  /** The user's own addresses: who they are, not the calendars they write in. */
  own: ReadonlySet<string>
  /** Null with the AI off: then nothing of the Segretario's counts. */
  segretario: SegretarioOwnership | null
}

/** What says whose an event is. */
export type Whose = Pick<
  CalendarEvent,
  | 'key'
  | 'connectionId'
  | 'calendarId'
  | 'seriesId'
  | 'iCalUid'
  | 'organizer'
  | 'creator'
  | 'attendees'
  | 'myResponse'
> & { startsAt: number }

/**
 * A calendar's role: the user's choice, else the Segretario's, else the
 * default (`defaultCalendarRole`).
 */
export function roleOf(
  calendar: {
    connectionId: string
    calendarId: string
    primary: boolean
    writable: boolean
    provider: CalendarProviderKind
    role: string | null
  },
  segretario: SegretarioOwnership | null
): { role: CalendarRole; by: 'utente' | 'segretario' | null; reason: string | null } {
  if (isRole(calendar.role)) {
    return { role: calendar.role, by: 'utente', reason: null }
  }

  const decided = segretario?.roles.get(calendarKey(calendar.connectionId, calendar.calendarId))

  return decided
    ? { role: decided.role, by: 'segretario', reason: decided.reason }
    : { role: defaultCalendarRole(calendar), by: null, reason: null }
}

export function isRole(value: unknown): value is CalendarRole {
  return value === 'tutti' || value === 'propri' || value === 'nessuno'
}

/** Whether a guest is the user: as the calendar marks them, or by one of their own addresses. */
function isUser(attendee: CalendarAttendee, own: ReadonlySet<string>): boolean {
  return attendee.self || own.has(attendee.email.trim().toLowerCase())
}

/**
 * The user is among the invited — by the calendar's word, or by an address
 * of theirs among the guests: a server that does not know the mailboxes'.
 */
export function invited(
  event: Pick<CalendarEvent, 'attendees' | 'myResponse'>,
  own: ReadonlySet<string>
): boolean {
  return (
    event.myResponse !== null ||
    event.attendees.some((attendee) => isUser(attendee, own) && !attendee.organizer)
  )
}

/** The user said no to it. */
export function declined(
  event: Pick<CalendarEvent, 'attendees' | 'myResponse'>,
  own: ReadonlySet<string>
): boolean {
  return (
    event.myResponse === 'declined' ||
    (event.myResponse === null &&
      event.attendees.some(
        (attendee) =>
          isUser(attendee, own) && !attendee.organizer && attendee.response === 'declined'
      ))
  )
}

/** Whether the user put it in the calendar, as the calendar says (Google): null where it does not. */
function createdByUser(event: Whose, own: ReadonlySet<string>): boolean | null {
  const creator = addressOrNull(event.creator)
  return creator === null ? null : own.has(creator)
}

/**
 * Whether an event is the user's (§7.4), this copy on its own: every one in
 * a calendar of theirs; in one shared, those the calendar says are theirs —
 * they are invited, organise it or put it there — and those the Segretario
 * found theirs; none in a calendar that is not. Never one they declined.
 */
export function eventIsYours(event: Whose, ownership: Ownership): boolean {
  const calendar = ownership.calendars.get(calendarKey(event.connectionId, event.calendarId))

  if (!calendar || calendar.role === 'nessuno' || declined(event, ownership.own)) {
    return false
  }

  if (calendar.role === 'tutti') {
    return true
  }

  const found = ownership.segretario

  return (
    invited(event, ownership.own) ||
    organizerIsUser(event, ownership.own) ||
    createdByUser(event, ownership.own) === true ||
    (found !== null &&
      (found.events.has(event.key) ||
        (event.seriesId !== null &&
          found.series.has(seriesKey(event.connectionId, event.calendarId, event.seriesId)))))
  )
}

/** Which copy of an event stands for it: the main calendar's, then one of the user's, then one they write in. */
function rank(calendar: OwnedCalendar | undefined): number {
  if (!calendar) {
    return 4
  }

  return calendar.primary ? 0 : calendar.role === 'tutti' ? 1 : calendar.writable ? 2 : 3
}

/** The same event in several calendars — an invitation, and a colleague's calendar shown too — is one. */
function sameEvent(event: Whose): string {
  return event.iCalUid ? `${event.iCalUid}\u0000${event.startsAt}` : `\u0001${event.key}`
}

/**
 * The keys of the events that are the user's, among `events`: each once,
 * its copy in the best calendar standing for the others — those given in
 * `others` too, copies kept elsewhere that `events` did not bring.
 */
export function yoursAmong(
  events: ReadonlyArray<Whose>,
  ownership: Ownership,
  others: ReadonlyArray<Whose> = []
): Set<string> {
  const best = new Map<string, { key: string; rank: number }>()

  for (const event of [...events, ...others]) {
    if (!eventIsYours(event, ownership)) {
      continue
    }

    const same = sameEvent(event)
    const its = rank(ownership.calendars.get(calendarKey(event.connectionId, event.calendarId)))
    const standing = best.get(same)

    if (!standing || its < standing.rank) {
      best.set(same, { key: event.key, rank: its })
    }
  }

  return new Set([...best.values()].map((standing) => standing.key))
}

/**
 * Whether someone other than the user has the event in hand (§13.3):
 * someone else put it in the calendar — the office, for them —, or it
 * invites them. Not one the user made or organises, nor one the calendar
 * does not say who made: a change to it is almost always the user's own,
 * from another device.
 */
export function inOthersHands(event: Whose, own: ReadonlySet<string>): boolean {
  if (createdByUser(event, own) === false) {
    return true
  }

  return !organizerIsUser(event, own) && invited(event, own)
}

/** Who has it in hand, to say so: whoever invites the user, or whoever put it there. */
export function handledBy(event: Whose, own: ReadonlySet<string>): string | null {
  if (!inOthersHands(event, own)) {
    return null
  }

  return invited(event, own) ? event.organizer : (addressOrNull(event.creator) ?? event.organizer)
}
