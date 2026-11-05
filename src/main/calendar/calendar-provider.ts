import type { CalendarEvent, CalendarResponse, EventChange, EventOrigin } from '@shared/calendar'

/** An event as a provider gives it: what the app keeps, and whether it was cancelled. */
export type ProviderEvent = Omit<CalendarEvent, 'key' | 'connectionId' | 'calendarName'> & {
  /** Its start and end as instants — an all-day event's by local midnight — for ranges. */
  startsAt: number
  endsAt: number
  /** Gone: deleted, or an instance of a recurring event taken out. */
  cancelled: boolean
}

/**
 * A calendar service as the app speaks to it: Google Calendar today; the
 * Microsoft 365 calendar (Graph) takes the same shape once Microsoft
 * accounts sign in with OAuth.
 */
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
  /** Adds an event; whoever is invited gets the provider's invitation. */
  create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent>
  /**
   * Changes an event: only `fields`, as `event` has them — the rest stays as
   * the provider has it now, so what someone changed meanwhile elsewhere is
   * not written over. `notify` tells the guests.
   */
  update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput,
    notify: boolean,
    fields: ReadonlySet<EventField>
  ): Promise<ProviderEvent>
  /** Takes an event away; `notify` tells the guests. An event already gone is no error. */
  remove(calendarId: string, eventId: string, notify: boolean): Promise<void>
  /**
   * Answers an invitation as the user; the organizer is told. With `series`,
   * an instance's whole series is answered, every instance at once.
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

/** The token a sync left is too old: the calendar is read again from the start. */
export class SyncTokenExpired extends Error {
  constructor() {
    super('The calendar sync token expired.')
    this.name = 'SyncTokenExpired'
  }
}
