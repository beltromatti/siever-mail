import type { MessageRef } from './models'
import { foldSearchText } from './search'

/**
 * The user's calendar connections — a Google or Microsoft account, a
 * CalDAV server such as iCloud, a calendar's link — each on its own, apart
 * from the mail: their calendars kept in step with the provider and read by
 * the Calendario, Oggi, the reader's invitations and the Segretario.
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
  /** Unique across connections and calendars: what the app names the event by. */
  key: string
  /** The calendar connection it comes from. */
  connectionId: string
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
  /**
   * The user organises it — they, or a calendar they write in — or it has
   * no guests: they may change it or take it away, and whoever is invited
   * is told. False for an invitation, which is answered, not changed. Set
   * on the events the calendars give; absent from what was kept before.
   */
  organizedByUser?: boolean
}

/** Who put an event in the calendar, when it was the Segretario, and from which message. */
export interface EventOrigin {
  by: 'segretario'
  accountId: string | null
  messageKey: string | null
}

/** A calendar of a connection. */
export interface CalendarInfo {
  connectionId: string
  calendarId: string
  name: string
  primary: boolean
}

/** A calendar as the Calendario app lists it: its key, whose, its colour, whether it is shown and takes events. */
export interface CalendarListEntry {
  /** `calendarKey(connectionId, calendarId)`. */
  key: string
  connectionId: string
  /** The connection it comes from, by its address or its name. */
  connection: string
  name: string
  primary: boolean
  writable: boolean
  /** The colour the provider gives it, `#rrggbb`; null when it gives none. */
  color: string | null
  /** The user hid it in the Calendario app: its events are not shown. */
  hidden: boolean
}

/** Who a calendar connection is with: Google, Microsoft, a CalDAV server (iCloud too), a link. */
export type CalendarProviderKind = 'google' | 'microsoft' | 'caldav' | 'ics'

/** A calendar connection, as Settings shows it. */
export interface CalendarConnection {
  id: string
  provider: CalendarProviderKind
  /** The account it reads — an address — or, for a link, the name it was given. */
  label: string
  /** The mail connection that came with the same access, when there is one. */
  mailAccountId: string | null
  /** The CalDAV server or the link, for those. */
  serverUrl: string | null
  lastSyncAt: number | null
  /** What went wrong at the last sync, in the user's words; null when it went. */
  problem: string | null
  calendars: CalendarInfo[]
}

/** The key a calendar goes by, for `NewCalendarEvent.calendarKey`: its connection's and its own id. */
export function calendarKey(connectionId: string, calendarId: string): string {
  return `${connectionId}\u0000${calendarId}`
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

/**
 * A search of the events kept, past and future: words, each of which must
 * be in the event — its title, place, description, people or calendar's
 * name — and, if given, a period and the calendars to look in.
 */
export interface CalendarSearchQuery {
  text: string
  /** Only events that touch the period from here (an ISO instant)… */
  fromIso?: string
  /** …to here (exclusive). */
  toIso?: string
  /** Only in these calendars (`calendarKey`): the Calendario looks in those it shows. */
  calendarKeys?: string[]
  /** How many at most; 50 when not said. */
  limit?: number
}

/** The events a search found, nearest to now first on either side. */
export interface CalendarSearchResult {
  /** Not over yet — the one under way first — then the soonest. */
  upcoming: CalendarEvent[]
  /** Over, the latest first. */
  past: CalendarEvent[]
  /** How many more were found beyond the limit: those farthest from now. */
  more: number
}

/**
 * The words a search of the events looks for, folded as the text they are
 * looked for in (`foldSearchText`): each must be found. Quotes only group
 * words as typed; they do not make a phrase.
 */
export function calendarSearchWords(text: string): string[] {
  return [...new Set(foldSearchText(text).replaceAll('"', ' ').split(/\s+/).filter(Boolean))]
}

/** The invitation a message carries, as the reader shows it. */
export interface MessageInvitation {
  method: string
  summary: string | null
  /** Its event in the account's connected calendar; null until it is there, or with none connected. */
  event: CalendarEvent | null
  /** Whether any calendar is connected: answering is done there when the event is in one. */
  calendarConnected: boolean
  /** Who invites, by address. */
  organizer: string | null
  /** When and where, as the invitation says it: for one in no calendar reached here. */
  when: Pick<CalendarEvent, 'start' | 'end' | 'allDay' | 'location'> | null
  /** The event is in no calendar reached here: the answer goes to the organizer by mail (iMIP). */
  answerByMail: boolean
  /** For a whole series: the answer goes to the series, not to the instance shown. */
  series: boolean
}

export const CALENDAR_IPC = {
  listConnections: 'calendar:list-connections',
  connectGoogle: 'calendar:connect-google',
  connectMicrosoft: 'calendar:connect-microsoft',
  addIcs: 'calendar:add-ics',
  addCalDav: 'calendar:add-caldav',
  disconnect: 'calendar:disconnect',
  events: 'calendar:events',
  search: 'calendar:search',
  event: 'calendar:event',
  eventByUid: 'calendar:event-by-uid',
  invitation: 'calendar:invitation',
  respond: 'calendar:respond',
  respondByMail: 'calendar:respond-by-mail',
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
  /**
   * Asks Google for a calendar, in its own window: the calendar of a Google
   * mail connection (`mailAccountId`), or of any Google account — the
   * calendar alone. Resolves once its events are in.
   */
  connectGoogle: (mailAccountId: string | null) => Promise<CalendarConnection[]>
  /** Asks Microsoft for a calendar, in the browser: of a Microsoft mail connection, or alone. */
  connectMicrosoft: (mailAccountId: string | null) => Promise<CalendarConnection[]>
  /**
   * Subscribes to a calendar published at a link (`https://` or `webcal://`),
   * read only; named as the user says, or as the calendar calls itself.
   */
  addIcs: (link: string, name: string | null) => Promise<CalendarConnection[]>
  /** A calendar on a CalDAV server (iCloud, Fastmail, Nextcloud), with a user name and an (app) password. */
  addCalDav: (input: {
    serverUrl: string
    username: string
    password: string
    label: string
  }) => Promise<CalendarConnection[]>
  /** Forgets a calendar connection here; the provider keeps the calendar as it is. */
  disconnect: (connectionId: string) => Promise<CalendarConnection[]>
  /** The events between two instants, every connected calendar's, in order. */
  events: (fromIso: string, toIso: string) => Promise<CalendarEvent[]>
  /** The events kept, past and future, that have every word searched for. */
  search: (query: CalendarSearchQuery) => Promise<CalendarSearchResult>
  /** One event by its key, as the calendar has it now; null once it is gone. */
  event: (eventKey: string) => Promise<CalendarEvent | null>
  /**
   * The event an invitation in mail is for, in any calendar connected —
   * the one that came with the mail's own account first.
   */
  eventByUid: (iCalUid: string, mailAccountId: string | null) => Promise<CalendarEvent | null>
  /**
   * The invitation a message carries, if it carries one: what it asks
   * (REQUEST, CANCEL…), its title, and its event in a connected calendar.
   */
  invitation: (ref: MessageRef) => Promise<MessageInvitation | null>
  /** Answers an invitation — for the whole series with `series` — and the organizer is told. */
  respond: (
    eventKey: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    options?: { series?: boolean }
  ) => Promise<CalendarEvent>
  /** Answers an invitation in no connected calendar: by mail to its organizer, from the account it came to. */
  respondByMail: (
    ref: MessageRef,
    response: Exclude<CalendarResponse, 'needsAction'>
  ) => Promise<void>
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
