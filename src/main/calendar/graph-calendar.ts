import { Marked } from 'marked'
import { NodeHtmlMarkdown } from 'node-html-markdown'

import { messages } from '@main/i18n'
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarResponse,
  EventOrigin
} from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import {
  ALL_FIELDS,
  SyncTokenExpired,
  type CalendarProvider,
  type EventField,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'
import { CalendarRequestError } from './calendar-refusal'
import type { Fetch } from './ics-calendar'
import { canonicalUid, originValue } from './icalendar'
import {
  dayIn,
  graphRecurrenceOf,
  recurrenceOfGraph,
  systemZone,
  wallOf,
  type GraphRecurrence
} from './recurrence'

const GRAPH = 'https://graph.microsoft.com/v1.0'
/** Times in UTC, and ids that do not change when an event moves. */
const PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"'
/** The property our app marks its events with, in Exchange's own namespace for it. */
const ORIGIN_PROPERTY_ID = 'String {6f1d2c8e-3b7a-4e95-8c41-5a0e9d27b3f6} Name SieverOrigin'
const MEETING_LINK =
  /https:\/\/(?:teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|[\w.-]*zoom\.us|[\w.-]*webex\.com)\/[^\s"<>)]+/i
const MAX_RETRY_WAIT_MS = 30_000
/** How many series are asked for their rule at once, as a calendar is read. */
const SERIES_AT_ONCE = 8

const MESSAGES = defineMessages({
  mailboxZoneNotGranted: {
    en: 'To write all-day events, Microsoft must give SIEVER Mail the mailbox’s time zone: reconnect the calendar.',
    it: 'Per scrivere gli eventi di tutto il giorno Microsoft deve dare a SIEVER Mail il fuso orario della casella: ricollega il calendario.',
    de: 'Um ganztägige Termine zu speichern, muss Microsoft SIEVER Mail die Zeitzone des Postfachs mitteilen: Verbinden Sie den Kalender erneut.'
  },
  untitled: { en: '(untitled)', it: '(senza titolo)', de: '(ohne Titel)' },
  noMailboxZone: {
    en: 'Microsoft didn’t say the mailbox’s time zone.',
    it: 'Microsoft non ha detto il fuso orario della casella.',
    de: 'Microsoft hat die Zeitzone des Postfachs nicht mitgeteilt.'
  },
  calendar: { en: 'Calendar', it: 'Calendario', de: 'Kalender' },
  someoneElses: {
    en: 'This is someone else’s calendar: answer the invitation from yours.',
    it: 'Questo è il calendario di un’altra persona: rispondi all’invito dal tuo.',
    de: 'Dies ist der Kalender einer anderen Person: Beantworten Sie die Einladung aus Ihrem eigenen.'
  },
  answered: {
    en: (status: number, code: string | null, message: string | null) =>
      `Microsoft answered ${status}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}`,
    it: (status: number, code: string | null, message: string | null) =>
      `Microsoft ha risposto ${status}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}`,
    de: (status: number, code: string | null, message: string | null) =>
      `Microsoft hat mit ${status}${code ? ` (${code})` : ''} geantwortet${message ? `: ${message}` : ''}`
  },
  accessRefused: {
    en: 'Microsoft no longer accepts the access to this calendar: reconnect it.',
    it: 'Microsoft non accetta più l’accesso a questo calendario: ricollegalo.',
    de: 'Microsoft akzeptiert den Zugriff auf diesen Kalender nicht mehr: Verbinden Sie ihn erneut.'
  },
  fifthWeekday: {
    en: 'Microsoft doesn’t repeat an event on a fifth weekday of the month (the fifth Tuesday, say): choose the last one.',
    it: 'Microsoft non ripete un evento in un quinto giorno della settimana del mese (il quinto martedì, per esempio): scegli l’ultimo.',
    de: 'Microsoft wiederholt keinen Termin an einem fünften Wochentag des Monats (etwa am fünften Dienstag): Wählen Sie den letzten.'
  }
})

/**
 * The zones Graph takes by an IANA name, besides Windows' own names
 * (dateTimeTimeZone, «Additional time zones»): one for each of Windows'
 * zones — Europe/Berlin, not Europe/Rome.
 */
const GRAPH_ZONES = [
  'Etc/GMT+12',
  'Etc/GMT+11',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Santa_Isabel',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Chihuahua',
  'America/Denver',
  'America/Guatemala',
  'America/Chicago',
  'America/Mexico_City',
  'America/Regina',
  'America/Bogota',
  'America/New_York',
  'America/Indiana/Indianapolis',
  'America/Caracas',
  'America/Asuncion',
  'America/Halifax',
  'America/Cuiaba',
  'America/La_Paz',
  'America/Santiago',
  'America/St_Johns',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Cayenne',
  'America/Godthab',
  'America/Montevideo',
  'America/Bahia',
  'Etc/GMT+2',
  'Atlantic/Azores',
  'Atlantic/Cape_Verde',
  'Africa/Casablanca',
  'Etc/GMT',
  'Europe/London',
  'Atlantic/Reykjavik',
  'Europe/Berlin',
  'Europe/Budapest',
  'Europe/Paris',
  'Europe/Warsaw',
  'Africa/Lagos',
  'Africa/Windhoek',
  'Europe/Bucharest',
  'Asia/Beirut',
  'Africa/Cairo',
  'Asia/Damascus',
  'Africa/Johannesburg',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'Asia/Jerusalem',
  'Asia/Amman',
  'Asia/Baghdad',
  'Europe/Kaliningrad',
  'Asia/Riyadh',
  'Africa/Nairobi',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Baku',
  'Europe/Moscow',
  'Indian/Mauritius',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Tashkent',
  'Asia/Kolkata',
  'Asia/Colombo',
  'Asia/Kathmandu',
  'Asia/Almaty',
  'Asia/Dhaka',
  'Asia/Yekaterinburg',
  'Asia/Yangon',
  'Asia/Bangkok',
  'Asia/Novosibirsk',
  'Asia/Shanghai',
  'Asia/Krasnoyarsk',
  'Asia/Singapore',
  'Australia/Perth',
  'Asia/Taipei',
  'Asia/Ulaanbaatar',
  'Asia/Irkutsk',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Adelaide',
  'Australia/Darwin',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Port_Moresby',
  'Australia/Hobart',
  'Asia/Yakutsk',
  'Pacific/Guadalcanal',
  'Asia/Vladivostok',
  'Pacific/Auckland',
  'Etc/GMT-12',
  'Pacific/Fiji',
  'Asia/Magadan',
  'Pacific/Tongatapu',
  'Pacific/Apia',
  'Pacific/Kiritimati'
]

const HOUR_MS = 3_600_000

/** A zone's distance from UTC at an instant, in minutes. */
function offsetAt(zone: string, instant: number): number {
  const wall = wallOf(instant, zone)
  return Math.round(
    (Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
      Math.floor(instant / 1000) * 1000) /
      60_000
  )
}

/**
 * Whether two zones' clocks read the same from `from` on, for the next
 * years: the same distance from UTC, changing at the same quarter hour.
 */
function sameClocks(a: string, b: string, from: number): boolean {
  const step = 6 * HOUR_MS
  let before: string | null = null

  try {
    for (let at = from; at < from + 3 * 366 * 24 * HOUR_MS; at += step) {
      const now = `${offsetAt(a, at)}/${offsetAt(b, at)}`

      if (offsetAt(a, at) !== offsetAt(b, at)) {
        return false
      }

      // The clocks changed in these six hours: they did at the same quarter hour.
      for (
        let quarter = at - step + HOUR_MS / 4;
        before !== null && before !== now && quarter < at;
        quarter += HOUR_MS / 4
      ) {
        if (offsetAt(a, quarter) !== offsetAt(b, quarter)) {
          return false
        }
      }

      before = now
    }
  } catch {
    return false
  }

  return true
}

let seriesZoneFound: { system: string; zone: string | null } | null = null

/**
 * The zone a series is written in on Microsoft, so it keeps its hour
 * across summer time: one Graph takes, whose clocks read as the
 * computer's — the computer's own, or one with the same hours and the same
 * changes of the clocks (Europe/Rome reads as Europe/Berlin). Null when
 * none does: the series is written in UTC.
 */
export function graphSeriesZone(system = systemZone(), now = Date.now()): string | null {
  if (seriesZoneFound?.system !== system) {
    seriesZoneFound = {
      system,
      zone: GRAPH_ZONES.includes(system)
        ? system
        : (GRAPH_ZONES.find((zone) => sameClocks(system, zone, now)) ?? null)
    }
  }

  return seriesZoneFound.zone
}

/** Runs `work` on each of `items`, so many at a time. */
async function eachLimited<T>(
  items: ReadonlyArray<T>,
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      await work(items[next++])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}

/** What the user is told where an all-day event waits for the mailbox's time zone. */
export function mailboxZoneNotGranted(): string {
  return messages(MESSAGES).mailboxZoneNotGranted
}

interface GraphDateTime {
  dateTime: string
  timeZone: string
}

interface GraphAddress {
  emailAddress?: { address?: string | null; name?: string | null } | null
}

/** A guest as Graph keeps one: required, optional, or a room (`resource`). */
interface GraphAttendee extends GraphAddress {
  type?: string | null
  status?: { response?: string } | null
}

/** An event as Graph gives it, the fields read. */
export interface GraphEvent {
  id: string
  '@removed'?: { reason?: string }
  /**
   * Exchange's Global Object ID in hex: the UID an invitation carries,
   * wrapped, and each instance's date in it (see `canonicalUid`).
   */
  iCalUId?: string | null
  /** The series an occurrence or an exception belongs to (its master's id). */
  seriesMasterId?: string | null
  subject?: string | null
  body?: { contentType?: 'text' | 'html'; content?: string | null } | null
  start?: GraphDateTime | null
  end?: GraphDateTime | null
  isAllDay?: boolean
  isCancelled?: boolean
  /** Whether the calendar's owner organises it. */
  isOrganizer?: boolean
  location?: { displayName?: string | null } | null
  attendees?: GraphAttendee[] | null
  organizer?: GraphAddress | null
  /** The calendar owner's answer. */
  responseStatus?: { response?: string } | null
  onlineMeeting?: { joinUrl?: string | null } | null
  onlineMeetingUrl?: string | null
  webLink?: string | null
  /** Whether the event reminds its owner, and how long before it starts. */
  isReminderOn?: boolean
  reminderMinutesBeforeStart?: number
  /** How a series master repeats; null for any other event. */
  recurrence?: GraphRecurrence | null
  /** `singleInstance`, `occurrence`, `exception` or `seriesMaster`. */
  type?: string
}

interface GraphCalendar {
  id: string
  name?: string
  hexColor?: string | null
  canEdit?: boolean
  isDefaultCalendar?: boolean
  owner?: { address?: string | null } | null
}

const RESPONSES: Readonly<Record<string, CalendarResponse>> = {
  accepted: 'accepted',
  tentativelyAccepted: 'tentative',
  declined: 'declined'
}

const ANSWERS: Readonly<Record<Exclude<CalendarResponse, 'needsAction'>, string>> = {
  accepted: 'accept',
  tentative: 'tentativelyAccept',
  declined: 'decline'
}

const addressOf = (party: GraphAddress | null | undefined): string =>
  party?.emailAddress?.address?.trim().toLowerCase() ?? ''

/** A Graph time in UTC — "2026-11-05T08:30:00.0000000" — as an instant. */
function instantOf(time: GraphDateTime): number {
  return Date.parse(`${time.dateTime.slice(0, 23)}Z`)
}

/** An all-day event's day: Graph gives its midnight as it is, in whatever zone it is asked for. */
function dayOf(time: GraphDateTime): string {
  return time.dateTime.slice(0, 10)
}

function localMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).getTime()
}

/**
 * An event as the app keeps it, from Graph's. `ownCalendar` says whether
 * the calendar is the user's: in one someone shares, its owner's answer is
 * not the user's, and the user has none to give there.
 */
export function eventOfGraph(
  item: GraphEvent,
  calendarId: string,
  self: string,
  ownCalendar: boolean,
  series?: ReadonlyMap<string, CalendarEvent['recurrence']>
): ProviderEvent {
  const own = self.trim().toLowerCase()
  const organizer = addressOf(item.organizer) || null
  const allDay = item.isAllDay === true
  const start = item.start ?? { dateTime: '1970-01-01T00:00:00', timeZone: 'UTC' }
  const end = item.end ?? start
  const startsAt = allDay ? localMidnight(dayOf(start)) : instantOf(start)
  const endsAt = allDay ? localMidnight(dayOf(end)) : instantOf(end)
  const attendees: CalendarAttendee[] = (item.attendees ?? [])
    .map((attendee) => {
      const email = addressOf(attendee)
      return {
        email,
        name: attendee.emailAddress?.name?.trim() || null,
        response: RESPONSES[attendee.status?.response ?? ''] ?? 'needsAction',
        self: email === own,
        organizer: email === organizer
      }
    })
    .filter((attendee) => attendee.email)
  const body = item.body?.content ?? ''
  const description =
    item.body?.contentType === 'html' ? NodeHtmlMarkdown.translate(body).trim() : body.trim()

  return {
    calendarId,
    eventId: item.id,
    iCalUid: item.iCalUId ? canonicalUid(item.iCalUId) : null,
    seriesId: item.seriesMasterId ?? null,
    title: item.subject?.trim() || messages(MESSAGES).untitled,
    start: allDay ? dayOf(start) : new Date(startsAt).toISOString(),
    end: allDay ? dayOf(end) : new Date(Math.max(endsAt, startsAt)).toISOString(),
    allDay,
    startsAt,
    endsAt: Math.max(endsAt, startsAt),
    location: item.location?.displayName?.trim() || null,
    description: description || null,
    attendees,
    organizer,
    // The user's answer when invited; none for their own event, nor in someone else's calendar.
    myResponse:
      !ownCalendar || item.isOrganizer || attendees.length === 0
        ? null
        : (RESPONSES[item.responseStatus?.response ?? ''] ?? 'needsAction'),
    meetLink:
      item.onlineMeeting?.joinUrl ??
      item.onlineMeetingUrl ??
      MEETING_LINK.exec(item.location?.displayName ?? '')?.[0] ??
      MEETING_LINK.exec(body)?.[0] ??
      null,
    htmlLink: item.webLink ?? null,
    origin: null,
    // Its reminder, as Outlook keeps it: off, or one, so long before (§13.3).
    reminders:
      item.isReminderOn === false
        ? []
        : item.isReminderOn === true && typeof item.reminderMinutesBeforeStart === 'number'
          ? [item.reminderMinutesBeforeStart]
          : undefined,
    // An instance's rule is its series master's, read apart (`seriesRules`); a master carries its own.
    recurrence: item.seriesMasterId
      ? series?.get(item.seriesMasterId)
      : item.recurrence
        ? recurrenceOfGraph(item.recurrence)
        : null,
    managedBy: null,
    cancelled: item.isCancelled === true
  }
}

/** An event Graph says is gone: only its id is known. */
function removedEvent(id: string, calendarId: string): ProviderEvent {
  return {
    calendarId,
    eventId: id,
    iCalUid: null,
    seriesId: null,
    title: '',
    start: '',
    end: '',
    allDay: false,
    startsAt: 0,
    endsAt: 0,
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    myResponse: null,
    meetLink: null,
    htmlLink: null,
    origin: null,
    cancelled: true
  }
}

/**
 * A time as Graph takes it: an instant, in UTC; an all-day event's day as
 * its midnight in `zone` — the mailbox's own, the one Outlook shows the day
 * in: at UTC's midnight it would cross into the next day east of it.
 */
function graphTime(value: string, allDay: boolean, zone: string): GraphDateTime {
  if (allDay) {
    return { dateTime: `${value.slice(0, 10)}T00:00:00`, timeZone: zone }
  }

  if (zone === 'UTC') {
    return { dateTime: new Date(value).toISOString().slice(0, 23), timeZone: 'UTC' }
  }

  // A series' time on its zone's clock: the hour it keeps across summer time.
  const wall = wallOf(Date.parse(value), zone)
  const two = (value: number): string => String(value).padStart(2, '0')

  return {
    dateTime: `${wall.year}-${two(wall.month)}-${two(wall.day)}T${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}`,
    timeZone: zone
  }
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Markdown as HTML, and only the HTML Markdown says: markup written among
 * the text is shown as written. A description may come from someone's mail
 * (the Segretario writes from it), and the body goes to every guest.
 */
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: { html: ({ text }) => escapeHtml(text) }
})

/**
 * A description as an event's body. The app shows an HTML body — Outlook's
 * usual, a Teams call's block among it — as Markdown: written back as the
 * HTML that Markdown says, its links, lists and emphasis stay what they
 * were, where plain text would show their marks.
 */
function bodyOf(description: string | null): { contentType: 'html'; content: string } {
  return {
    contentType: 'html',
    content: description ? markdown.parse(description, { async: false }) : ''
  }
}

/**
 * A Microsoft 365 or Outlook.com calendar, through Microsoft Graph: each
 * calendar read with its own delta — the window fixed by the first read,
 * what changed after — ids that stay as an event moves, times in UTC.
 * Graph tells the guests itself when an event with guests is written.
 */
export class GraphCalendarProvider implements CalendarProvider {
  /** Whether each calendar is the user's, not shared by someone else: as listed, or asked once. */
  private readonly owned = new Map<string, boolean>()

  constructor(
    private readonly access: {
      /** A token for the calendars. */
      calendar: () => Promise<string>
      /** A token to read the mailbox's settings; null where the account never consented to it. */
      mailboxSettings: () => Promise<string | null>
    },
    private readonly self: string,
    private readonly fetch: Fetch
  ) {}

  private async request(
    url: string,
    init: { method?: string; body?: unknown; prefer?: string; token?: () => Promise<string> } = {}
  ): Promise<Response> {
    const token = init.token ?? this.access.calendar

    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url.startsWith('https://') ? url : `${GRAPH}${url}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${await token()}`,
          Prefer: init.prefer ? `${PREFER}, ${init.prefer}` : PREFER,
          ...(init.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: init.body ? JSON.stringify(init.body) : undefined
      })

      // Too many requests: wait as Graph says, once.
      if (response.status === 429 && attempt === 0) {
        const wait = Math.min(
          Number(response.headers.get('retry-after') ?? 5) * 1000,
          MAX_RETRY_WAIT_MS
        )
        await new Promise((resolve) => setTimeout(resolve, wait))
        continue
      }

      return response
    }
  }

  private async json<T>(
    url: string,
    init?: { method?: string; body?: unknown; token?: () => Promise<string> }
  ): Promise<T> {
    const response = await this.request(url, init)

    if (!response.ok) {
      throw await graphError(response)
    }

    return (await response.json()) as T
  }

  /** An event, by the calendar it is in: the user's, or one shared with them, alike. */
  private eventPath(calendarId: string, eventId: string): string {
    return `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  }

  /** Whether a calendar is the user's: their main one, or one whose owner they are. */
  private isOwn(calendar: GraphCalendar): boolean {
    const owner = calendar.owner?.address?.trim().toLowerCase()
    return calendar.isDefaultCalendar === true || !owner || owner === this.self.trim().toLowerCase()
  }

  private async ownCalendar(calendarId: string): Promise<boolean> {
    let own = this.owned.get(calendarId)

    if (own === undefined) {
      own = this.isOwn(
        await this.json<GraphCalendar>(
          `/me/calendars/${encodeURIComponent(calendarId)}?$select=id,owner,isDefaultCalendar`
        )
      )
      this.owned.set(calendarId, own)
    }

    return own
  }

  /**
   * Whether the account lets the mailbox's time zone be read: one whose
   * calendar was connected before it was asked for does not, until it is
   * connected again.
   */
  async mailboxZoneGranted(): Promise<boolean> {
    return (await this.access.mailboxSettings()) !== null
  }

  /** The time zone of the mailbox: the one Outlook shows its days in. */
  private async mailboxZone(): Promise<string> {
    const token = await this.access.mailboxSettings()

    // Without it an all-day event would be written on the wrong days east or west of UTC.
    if (!token) {
      throw new Error(mailboxZoneNotGranted())
    }

    const { value } = await this.json<{ value?: string | null }>('/me/mailboxSettings/timeZone', {
      token: async () => token
    })

    if (!value) {
      throw new Error(messages(MESSAGES).noMailboxZone)
    }

    return value
  }

  /**
   * The fields of an event as Graph takes them: only `fields`, the guests
   * kept as they are in the event at `current` — none for a new one. A
   * series' rule goes with its time, its range beginning on its start's
   * day as Graph asks, and its times on the clock of a zone, which it keeps
   * its hour in; one event again, its rule null. One reminder: the earliest.
   */
  private async fieldsOf(
    event: ProviderEventInput,
    fields: ReadonlySet<EventField>,
    current: string | null
  ): Promise<Record<string, unknown>> {
    const rule = event.recurrence && event.recurrence !== 'other' ? event.recurrence : null
    const writesRule = fields.has('recurrence') || (fields.has('time') && rule !== null)
    const writesTime = fields.has('time') || writesRule
    // A series — its rule the app's or another's — keeps its hour on a zone's clock.
    const zone = !writesTime
      ? 'UTC'
      : event.allDay
        ? await this.mailboxZone()
        : event.recurrence !== null
          ? (graphSeriesZone() ?? 'UTC')
          : 'UTC'
    const recurrence = rule
      ? graphRecurrenceOf(rule, dayIn(event.start, event.allDay, zone), zone)
      : null

    if (writesRule && rule && !recurrence) {
      throw new Error(messages(MESSAGES).fifthWeekday)
    }

    return {
      ...(fields.has('title') ? { subject: event.title } : {}),
      ...(writesTime
        ? {
            start: graphTime(event.start, event.allDay, zone),
            end: graphTime(event.end, event.allDay, zone),
            isAllDay: event.allDay
          }
        : {}),
      ...(fields.has('location') ? { location: { displayName: event.location ?? '' } } : {}),
      ...(fields.has('description') ? { body: bodyOf(event.description) } : {}),
      ...(fields.has('attendees')
        ? { attendees: await this.attendeesOf(event.attendees, current) }
        : {}),
      ...(writesRule && (recurrence || (current && event.recurrence === null))
        ? { recurrence }
        : {}),
      // None given — the calendar's own — leaves Outlook's as it is.
      ...(fields.has('reminders') && event.reminders !== null
        ? event.reminders.length > 0
          ? { isReminderOn: true, reminderMinutesBeforeStart: Math.max(...event.reminders) }
          : { isReminderOn: false }
        : {})
    }
  }

  /**
   * The guests to write: those already there as they are — required,
   * optional, a room, their names — the new ones required. Graph takes the
   * whole list; the user's own entry, when there is one, stays.
   */
  private async attendeesOf(
    wanted: ReadonlyArray<string>,
    current: string | null
  ): Promise<GraphAttendee[]> {
    const kept = current
      ? ((await this.json<{ attendees?: GraphAttendee[] | null }>(`${current}?$select=attendees`))
          .attendees ?? [])
      : []
    const byAddress = new Map(kept.map((attendee) => [addressOf(attendee), attendee]))
    const own = this.self.trim().toLowerCase()
    const addresses = [
      ...new Set([
        ...(byAddress.has(own) ? [own] : []),
        ...wanted.map((address) => address.trim().toLowerCase())
      ])
    ]

    return addresses.map((address) => {
      const known = byAddress.get(address)
      return known
        ? { emailAddress: known.emailAddress, type: known.type ?? 'required' }
        : { emailAddress: { address }, type: 'required' }
    })
  }

  async listCalendars(): Promise<
    Array<{
      calendarId: string
      name: string
      primary: boolean
      writable: boolean
      color: string | null
    }>
  > {
    const calendars: GraphCalendar[] = []
    let url: string | null =
      '/me/calendars?$select=id,name,hexColor,canEdit,isDefaultCalendar,owner&$top=100'

    while (url) {
      const page: { value: GraphCalendar[]; '@odata.nextLink'?: string } = await this.json(url)
      calendars.push(...page.value)
      url = page['@odata.nextLink'] ?? null
    }

    for (const calendar of calendars) {
      this.owned.set(calendar.id, this.isOwn(calendar))
    }

    return calendars.map((calendar) => ({
      calendarId: calendar.id,
      name: calendar.name?.trim() || messages(MESSAGES).calendar,
      primary: calendar.isDefaultCalendar === true,
      writable: calendar.canEdit !== false,
      color: /^#[0-9a-f]{6}$/i.test(calendar.hexColor ?? '')
        ? calendar.hexColor!.toLowerCase()
        : null
    }))
  }

  async changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{ events: ProviderEvent[]; syncToken: string | null }> {
    let url: string | null =
      'syncToken' in since
        ? since.syncToken
        : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?startDateTime=${encodeURIComponent(since.fromIso)}&endDateTime=${encodeURIComponent(since.toIso)}`
    const items: GraphEvent[] = []
    let deltaLink: string | null = null

    while (url) {
      const response = await this.request(url, { prefer: 'odata.maxpagesize=200' })

      if (!response.ok) {
        const error = await graphError(response)

        if (
          'syncToken' in since &&
          (response.status === 410 || /syncState|resync/i.test(error.message))
        ) {
          throw new SyncTokenExpired()
        }

        throw error
      }

      const page = (await response.json()) as {
        value: GraphEvent[]
        '@odata.nextLink'?: string
        '@odata.deltaLink'?: string
      }

      items.push(...page.value)
      url = page['@odata.nextLink'] ?? null
      deltaLink = page['@odata.deltaLink'] ?? deltaLink
    }

    const own = await this.ownCalendar(calendarId)
    const series = await this.seriesRules(calendarId, items)
    const events: ProviderEvent[] = []

    for (const item of items) {
      events.push(
        item['@removed']
          ? await this.removed(calendarId, item.id, own)
          : eventOfGraph(item, calendarId, this.self, own, series)
      )
    }

    return { events, syncToken: deltaLink }
  }

  /**
   * How the series of the occurrences read repeat: each series master
   * asked for its rule once, a few at a time. One that cannot be read is
   * left out: its occurrences say nothing of it, and keep what was known.
   */
  private async seriesRules(
    calendarId: string,
    items: ReadonlyArray<GraphEvent>
  ): Promise<Map<string, CalendarEvent['recurrence']>> {
    const ids = [
      ...new Set(
        items.flatMap((item) =>
          item.seriesMasterId && !item['@removed'] && !item.isCancelled ? [item.seriesMasterId] : []
        )
      )
    ]
    const rules = new Map<string, CalendarEvent['recurrence']>()

    await eachLimited(ids, SERIES_AT_ONCE, async (masterId) => {
      const response = await this.request(
        `${this.eventPath(calendarId, masterId)}?$select=recurrence`
      )

      if (response.status === 401) {
        throw await graphError(response)
      }

      if (response.ok) {
        const { recurrence } = (await response.json()) as Pick<GraphEvent, 'recurrence'>
        rules.set(masterId, recurrence ? recurrenceOfGraph(recurrence) : null)
      }
    })

    return rules
  }

  /**
   * An event the delta took out. Graph says "removed" both of one deleted
   * and of one that changed outside the window — moved out of it, or made
   * there — so it is asked for: gone, or as it is now, wherever it is. One
   * the user may no longer see — made private in a calendar shared with
   * them, the sharing taken back — is gone for them too. Anything else is
   * asked again with the whole delta, at the next sync.
   */
  private async removed(calendarId: string, eventId: string, own: boolean): Promise<ProviderEvent> {
    const response = await this.request(this.eventPath(calendarId, eventId))

    if (response.status === 403 || response.status === 404 || response.status === 410) {
      return removedEvent(eventId, calendarId)
    }

    if (!response.ok) {
      throw await graphError(response)
    }

    const event = (await response.json()) as GraphEvent

    // One event made to repeat is its series master now, which no view holds: its occurrences
    // come by themselves.
    return event.type === 'seriesMaster'
      ? removedEvent(eventId, calendarId)
      : eventOfGraph(event, calendarId, this.self, own)
  }

  async create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent> {
    const own = await this.ownCalendar(calendarId)
    const created = await this.json<GraphEvent>(
      `/me/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        body: {
          ...(await this.fieldsOf(event, ALL_FIELDS, null)),
          ...(origin
            ? {
                singleValueExtendedProperties: [
                  { id: ORIGIN_PROPERTY_ID, value: originValue(origin) }
                ]
              }
            : {})
        }
      }
    )

    return { ...eventOfGraph(created, calendarId, this.self, own), origin }
  }

  async update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput,
    _notify: boolean,
    fields: ReadonlySet<EventField>
  ): Promise<ProviderEvent> {
    const own = await this.ownCalendar(calendarId)
    const path = this.eventPath(calendarId, eventId)
    // Only what changed: a PATCH leaves the rest as Graph has it now.
    const updated = await this.json<GraphEvent>(path, {
      method: 'PATCH',
      body: await this.fieldsOf(event, fields, path)
    })

    return eventOfGraph(updated, calendarId, this.self, own)
  }

  async series(calendarId: string, seriesId: string): Promise<ProviderEventInput> {
    const own = await this.ownCalendar(calendarId)
    const master = eventOfGraph(
      await this.json<GraphEvent>(this.eventPath(calendarId, seriesId)),
      calendarId,
      this.self,
      own
    )

    return {
      title: master.title,
      start: master.start,
      end: master.end,
      allDay: master.allDay,
      location: master.location,
      description: master.description,
      attendees: master.attendees
        .filter((attendee) => !attendee.self)
        .map((attendee) => attendee.email),
      recurrence: master.recurrence ?? null,
      reminders: master.reminders ?? null,
      // Exchange names its zones its own way: the series is reckoned on the computer's clock.
      zone: systemZone()
    }
  }

  async remove(calendarId: string, eventId: string): Promise<void> {
    const response = await this.request(this.eventPath(calendarId, eventId), {
      method: 'DELETE'
    })

    if (!response.ok && response.status !== 404) {
      throw await graphError(response)
    }
  }

  async respond(
    calendarId: string,
    instanceId: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    series: boolean
  ): Promise<ProviderEvent> {
    const own = await this.ownCalendar(calendarId)

    // In a calendar someone shares, the answer would be its owner's.
    if (!own) {
      throw new Error(messages(MESSAGES).someoneElses)
    }

    // The whole series answered: the instance stands for it.
    const eventId = series
      ? ((
          await this.json<{ seriesMasterId?: string | null }>(
            `${this.eventPath(calendarId, instanceId)}?$select=seriesMasterId`
          )
        ).seriesMasterId ?? instanceId)
      : instanceId
    const path = this.eventPath(calendarId, eventId)
    const answered = await this.request(`${path}/${ANSWERS[response]}`, {
      method: 'POST',
      body: { sendResponse: true }
    })

    if (!answered.ok) {
      throw await graphError(answered)
    }

    return eventOfGraph(await this.json<GraphEvent>(path), calendarId, this.self, true)
  }
}

/**
 * Graph's error, said as Graph says it. A token Graph no longer takes is
 * the account's authorization withdrawn, whatever was asked: only signing
 * in again restores it.
 */
async function graphError(response: Response): Promise<CalendarRequestError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null
  const said = messages(MESSAGES).answered(
    response.status,
    body?.error?.code || null,
    body?.error?.message || null
  )

  return response.status === 401
    ? new CalendarRequestError(messages(MESSAGES).accessRefused, {
        status: 401,
        refusal: 'autorizzazione',
        cause: new Error(said)
      })
    : new CalendarRequestError(said, { status: response.status })
}
