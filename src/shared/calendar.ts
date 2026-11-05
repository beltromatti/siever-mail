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
  /** Put there by the Segretario, from a message: it may take it away again, and says where it came from. */
  origin: EventOrigin | null
}

/** Who put an event in the calendar, when it was the Segretario, and from which message. */
export interface EventOrigin {
  by: 'segretario'
  accountId: string | null
  messageKey: string | null
}

/** A calendar of an account, and whether its events are shown. */
export interface CalendarInfo {
  accountId: string
  calendarId: string
  name: string
  primary: boolean
}

/** A calendar as the Calendario app lists it: its key, whose, its colour, whether it is shown and takes events. */
export interface CalendarListEntry {
  /** `calendarKey(accountId, calendarId)`. */
  key: string
  accountId: string
  /** The connection it comes with, by its address. */
  account: string
  name: string
  primary: boolean
  writable: boolean
  /** The colour the provider gives it, `#rrggbb`; null when it gives none. */
  color: string | null
  /** The user hid it in the Calendario app: its events are not shown. */
  hidden: boolean
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

/** The key a calendar goes by, for `NewCalendarEvent.calendarKey`: its account's and its own id. */
export function calendarKey(accountId: string, calendarId: string): string {
  return `${accountId}\u0000${calendarId}`
}

/** A new event: in which calendar (`calendarKey`), when, where, with whom. */
export interface NewCalendarEvent {
  calendarKey: string
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  /** Addresses to invite; they get the provider's invitation. */
  attendees: string[]
  origin?: EventOrigin | null
}

/** Something that changed in a calendar not through this app, as the sync found it. */
export interface CalendarChange {
  id: number
  kind: 'nuovo' | 'cambiato' | 'annullato'
  /** The event as it is now — as it was, for one cancelled. */
  event: CalendarEvent
  /** As it was before, for one changed or cancelled. */
  before: CalendarEvent | null
  at: number
}

/** What changes in an event: only the fields given. */
export interface EventChange {
  title?: string
  start?: string
  end?: string
  allDay?: boolean
  location?: string | null
  description?: string | null
  /** The whole list of addresses invited, in place of the old one. */
  attendees?: string[]
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
  event: 'calendar:event',
  eventByUid: 'calendar:event-by-uid',
  invitation: 'calendar:invitation',
  respond: 'calendar:respond',
  calendars: 'calendar:calendars',
  setCalendarHidden: 'calendar:set-calendar-hidden',
  create: 'calendar:create',
  update: 'calendar:update',
  remove: 'calendar:remove',
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
  /** One event by its key, as the calendar has it now; null once it is gone. */
  event: (eventKey: string) => Promise<CalendarEvent | null>
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
  /** Every connected calendar, the main ones first. */
  calendars: () => Promise<CalendarListEntry[]>
  /** Shows or hides a calendar's events in the Calendario app. */
  setCalendarHidden: (calendarKey: string, hidden: boolean) => Promise<CalendarListEntry[]>
  /** A new event; whoever is invited gets the provider's invitation. */
  create: (event: NewCalendarEvent) => Promise<CalendarEvent>
  /** Changes an event; whoever is invited is told. */
  update: (eventKey: string, change: EventChange) => Promise<CalendarEvent>
  /** Takes an event away; whoever is invited is told. */
  remove: (eventKey: string) => Promise<void>
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
