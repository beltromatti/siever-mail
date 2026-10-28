import type { CalendarEvent, CalendarResponse, NewCalendarEvent } from '@shared/calendar'

/** An event as a provider gives it: what the app keeps, and whether it was cancelled. */
export type ProviderEvent = Omit<CalendarEvent, 'key' | 'accountId' | 'calendarName'> & {
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
export interface CalendarProvider {
  /** The calendars the user shows in the provider's own calendar. */
  listCalendars(): Promise<Array<{ calendarId: string; name: string; primary: boolean }>>
  /**
   * The events of a calendar: every one between two instants, or — with
   * the token a previous read left — what changed since, cancelled ones
   * included. Resolves with the token for the next read.
   */
  changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{ events: ProviderEvent[]; syncToken: string | null }>
  create(calendarId: string, event: NewCalendarEvent): Promise<ProviderEvent>
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
