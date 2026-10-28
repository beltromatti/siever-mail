import type { MessageRef } from './models'

/**
 * The calendars of the user's accounts, kept in step with their provider —
 * Google Calendar for a Google account — and read by the day's page, the
 * reader's invitations and the Segretario.
 */

export type CalendarResponse = 'accepted' | 'tentative' | 'declined' | 'needsAction'

export interface CalendarAttendee {
  email: string
  name: string | null
  response: CalendarResponse
  /** The user, under the account's address. */
  self: boolean
  organizer: boolean
}

export interface CalendarEvent {
  /** Unique across accounts and calendars: what the app names the event by. */
  key: string
  accountId: string
  calendarId: string
  calendarName: string
  /** The provider's id, an instance's own for a recurring event. */
  eventId: string
  /** The id an invitation in mail carries (iCalendar UID). */
  iCalUid: string | null
  title: string
  /** An ISO date-time — or, for an all-day event, AAAA-MM-GG. */
  start: string
  /** Exclusive: for an all-day event, the day after its last. */
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  attendees: CalendarAttendee[]
  organizer: string | null
  /** The user's answer, when invited; null for an event of their own without guests. */
  myResponse: CalendarResponse | null
  /** A video call's address, when it has one. */
  meetLink: string | null
  /** The event in the provider's calendar, to open it there. */
  htmlLink: string | null
}

/** A calendar of an account, and whether its events are shown. */
export interface CalendarInfo {
  accountId: string
  calendarId: string
  name: string
  primary: boolean
}

/** An account's calendar, as Settings shows it. */
export interface CalendarConnection {
  accountId: string
  email: string
  /** `available`: it could be connected (a Google account) and is not. */
  state: 'available' | 'connected'
  lastSyncAt: number | null
  /** What went wrong at the last sync, in the user's words; null when it went. */
  problem: string | null
  calendars: CalendarInfo[]
}

/** A new event, as the Segretario proposes it and the user confirms it. */
export interface NewCalendarEvent {
  accountId: string
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  /** Addresses to invite; they get Google's invitation. */
  attendees: string[]
}

/** The invitation a message carries, as the reader shows it. */
export interface MessageInvitation {
  method: string
  summary: string | null
  /** Its event in the account's connected calendar; null until it is there, or with none connected. */
  event: CalendarEvent | null
  /** Whether the account's calendar is connected: answering is done there. */
  calendarConnected: boolean
}

export const CALENDAR_IPC = {
  listConnections: 'calendar:list-connections',
  connect: 'calendar:connect',
  disconnect: 'calendar:disconnect',
  events: 'calendar:events',
  eventByUid: 'calendar:event-by-uid',
  invitation: 'calendar:invitation',
  respond: 'calendar:respond',
  syncNow: 'calendar:sync-now',
  changed: 'calendar:changed'
} as const

export interface CalendarApi {
  listConnections: () => Promise<CalendarConnection[]>
  /** Asks Google for the calendar of an account, in its own window; resolves once its events are in. */
  connect: (accountId: string) => Promise<CalendarConnection[]>
  disconnect: (accountId: string) => Promise<CalendarConnection[]>
  /** The events between two instants, every connected calendar's, in order. */
  events: (fromIso: string, toIso: string) => Promise<CalendarEvent[]>
  /** The event an invitation in mail is for, when it is in a connected calendar. */
  eventByUid: (accountId: string, iCalUid: string) => Promise<CalendarEvent | null>
  /**
   * The invitation a message carries, if it carries one: what it asks
   * (REQUEST, CANCEL…), its title, and its event in a connected calendar.
   */
  invitation: (ref: MessageRef) => Promise<MessageInvitation | null>
  /** Answers an invitation; the organizer is told. */
  respond: (
    eventKey: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ) => Promise<CalendarEvent>
  syncNow: () => Promise<void>
  /** The events changed: what shows them reads them again. */
  onChanged: (listener: () => void) => () => void
}

/** Whether an attachment is an iCalendar file: an invitation's. */
export function isIcsAttachment(attachment: { fileName: string; contentType: string }): boolean {
  return (
    /^(text\/calendar|application\/ics)$/i.test(attachment.contentType.split(';')[0].trim()) ||
    /\.ics$/i.test(attachment.fileName)
  )
}
