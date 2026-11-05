import type { CalendarEvent, CalendarResponse, EventChange, EventOrigin } from '@shared/calendar'

/** An event as a provider gives it: what the app keeps, and whether it was cancelled. */
export type ProviderEvent = Omit<CalendarEvent, 'key' | 'connectionId' | 'calendarName'> & {
  /** Its start and end as instants — an all-day event's by local midnight — for ranges. */
  startsAt: number
  endsAt: number
  /** Gone: deleted, or an instance of a recurring event taken out. */
  cancelled: boolean
}

/** An event as it is written to the provider: every field, as it should be after the write. */
export interface ProviderEventInput {
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  /** The addresses invited, the user's own excluded. */
  attendees: string[]
}

/**
 * A calendar service as the app speaks to it — Google Calendar, Microsoft
 * Graph, a CalDAV server, a calendar's link — each in the same shape.
 */
export interface CalendarProvider {
  /** The calendars the user shows in the provider's own calendar, whether events can be written in each, their colour. */
  listCalendars(): Promise<
    Array<{
      calendarId: string
      name: string
      primary: boolean
      writable: boolean
      color: string | null
    }>
  >
  /**
   * The events of a calendar: every one between two instants, or — with
   * the token a previous read left — what changed since, cancelled ones
   * included. Resolves with the token for the next read.
   */
  changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{
    events: ProviderEvent[]
    syncToken: string | null
    /**
     * What the provider keeps of the calendar itself (CalDAV's objects and their
     * versions), kept only once the events are: a read that fails after it would
     * otherwise leave the versions newer than the events, and the change unseen.
     */
    commit?: () => Promise<void>
  }>
  /**
   * Adds an event; whoever is invited gets the provider's invitation. A
   * provider that would not send it refuses an event with guests: nobody
   * is invited without being told.
   */
  create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent>
  /**
   * Changes an event: only `fields`, as `event` has them — the rest stays as
   * the provider has it now, so what someone changed meanwhile elsewhere is
   * not written over. `notify` tells the guests; a provider that cannot
   * refuses rather than change what they would not hear of.
   */
  update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput,
    notify: boolean,
    fields: ReadonlySet<EventField>
  ): Promise<ProviderEvent>
  /**
   * Takes an event away; `notify` tells the guests — refused where they
   * would not be told. An event already gone is no error.
   */
  remove(calendarId: string, eventId: string, notify: boolean): Promise<void>
  /**
   * Answers an invitation as the user; the organizer is told — refused
   * where they would not be, or where the calendar is someone else's. With
   * `series`, an instance's whole series is answered, every instance at once.
   */
  respond(
    calendarId: string,
    eventId: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    series: boolean
  ): Promise<ProviderEvent>
}

/** A part of an event a change can touch: the time is its start, end and whether all day. */
export type EventField = 'title' | 'time' | 'location' | 'description' | 'attendees'

/** The parts of an event a change touches. */
export function changedFields(change: EventChange): ReadonlySet<EventField> {
  const fields = new Set<EventField>()

  if (change.title !== undefined) fields.add('title')
  if (change.start !== undefined || change.end !== undefined || change.allDay !== undefined) {
    fields.add('time')
  }
  if (change.location !== undefined) fields.add('location')
  if (change.description !== undefined) fields.add('description')
  if (change.attendees !== undefined) fields.add('attendees')

  return fields
}

/**
 * Of the parts a change touches, those it really changes: what is written
 * as it already is would only be written over — a time given again in
 * another form, the guests in another order, a body rewritten as it was.
 */
export function differingFields(
  current: ProviderEventInput,
  next: ProviderEventInput,
  fields: ReadonlySet<EventField>
): ReadonlySet<EventField> {
  const sameTime = (a: string, b: string): boolean =>
    next.allDay ? a.slice(0, 10) === b.slice(0, 10) : Date.parse(a) === Date.parse(b)
  const addresses = (list: ReadonlyArray<string>): string =>
    [...new Set(list.map((address) => address.trim().toLowerCase()))].sort().join('\n')
  const same: Readonly<Record<EventField, boolean>> = {
    title: current.title === next.title,
    time:
      current.allDay === next.allDay &&
      sameTime(current.start, next.start) &&
      sameTime(current.end, next.end),
    location: (current.location ?? null) === (next.location ?? null),
    description: (current.description ?? null) === (next.description ?? null),
    attendees: addresses(current.attendees) === addresses(next.attendees)
  }

  return new Set([...fields].filter((field) => !same[field]))
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The local day an instant falls on, AAAA-MM-GG. */
function localDayOf(instant: number): string {
  const date = new Date(instant)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A day AAAA-MM-GG moved by some days. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return localDayOf(new Date(year, month - 1, date + days).getTime())
}

/** An event as it is, as it would be written: nothing in it is checked, it is what the provider has. */
export function eventInput(current: CalendarEvent): ProviderEventInput {
  return {
    title: current.title,
    start: current.start,
    end: current.end,
    allDay: current.allDay,
    location: current.location,
    description: current.description,
    attendees: current.attendees
      .filter((attendee) => !attendee.self)
      .map((attendee) => attendee.email)
  }
}

/** The local days an event is on: an all-day one's, a timed one's from its start's to its end's. */
function daysOf(current: { allDay: boolean; startsAt: number; endsAt: number }): number {
  if (current.allDay) {
    return Math.max(1, Math.round((current.endsAt - current.startsAt) / DAY_MS))
  }

  const midnight = (instant: number): number => {
    const date = new Date(instant)
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  }

  return (
    Math.round(
      (midnight(Math.max(current.startsAt, current.endsAt - 1)) - midnight(current.startsAt)) /
        DAY_MS
    ) + 1
  )
}

/**
 * An event with a change applied, every field as it should be after it.
 * Moving only the start keeps the length; turning a timed event into an
 * all-day one keeps its days; the other way round needs the times. Only an
 * end the change gives is checked: the event as it is — a moment with no
 * length, as a calendar may have it — is not the change's to refuse.
 */
export function changedEvent(
  current: CalendarEvent & { startsAt: number; endsAt: number },
  change: EventChange
): ProviderEventInput {
  const allDay = change.allDay ?? current.allDay
  const event = { ...eventInput(current), allDay }

  if (change.start !== undefined || change.end !== undefined || allDay !== current.allDay) {
    if (!allDay && current.allDay && !(change.start && change.end)) {
      throw new Error('Per dare un orario a un evento di tutto il giorno servono inizio e fine.')
    }

    event.start =
      change.start ?? (allDay === current.allDay ? current.start : localDayOf(current.startsAt))
    event.end =
      change.end ??
      (allDay
        ? shiftDay(event.start.slice(0, 10), daysOf(current))
        : new Date(
            Date.parse(event.start) + Math.max(0, current.endsAt - current.startsAt)
          ).toISOString())

    if (
      change.end !== undefined &&
      (allDay
        ? event.end.slice(0, 10) <= event.start.slice(0, 10)
        : Date.parse(event.end) <= Date.parse(event.start))
    ) {
      throw new Error('La fine dell’evento deve venire dopo l’inizio.')
    }
  }

  return {
    ...event,
    title: change.title ?? event.title,
    location: change.location !== undefined ? change.location : event.location,
    description: change.description !== undefined ? change.description : event.description,
    attendees: change.attendees ?? event.attendees
  }
}

/** The token a sync left is too old: the calendar is read again from the start. */
export class SyncTokenExpired extends Error {
  constructor() {
    super('The calendar sync token expired.')
    this.name = 'SyncTokenExpired'
  }
}
