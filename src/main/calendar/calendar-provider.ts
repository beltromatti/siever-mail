import type { CalendarEvent, CalendarResponse, EventOrigin } from '@shared/calendar'

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
  ): Promise<{ events: ProviderEvent[]; syncToken: string | null }>
  /** Adds an event; whoever is invited gets the provider's invitation. */
  create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent>
  /** Rewrites an event as given; `notify` tells the guests. */
  update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput,
    notify: boolean
  ): Promise<ProviderEvent>
  /** Takes an event away; `notify` tells the guests. An event already gone is no error. */
  remove(calendarId: string, eventId: string, notify: boolean): Promise<void>
  /** Answers an invitation as the user; the organizer is told. */
  respond(
    calendarId: string,
    eventId: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<ProviderEvent>
}

/** The token a sync left is too old: the calendar is read again from the start. */
export class SyncTokenExpired extends Error {
  constructor() {
    super('The calendar sync token expired.')
    this.name = 'SyncTokenExpired'
  }
}
