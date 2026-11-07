import { Marked } from 'marked'
import { NodeHtmlMarkdown } from 'node-html-markdown'

import type { CalendarAttendee, CalendarResponse, EventOrigin } from '@shared/calendar'

import {
  SyncTokenExpired,
  type CalendarProvider,
  type EventField,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'
import { CalendarRequestError } from './calendar-refusal'
import type { Fetch } from './ics-calendar'
import { canonicalUid, originValue } from './icalendar'

const GRAPH = 'https://graph.microsoft.com/v1.0'
/** Times in UTC, and ids that do not change when an event moves. */
const PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"'
/** The property our app marks its events with, in Exchange's own namespace for it. */
const ORIGIN_PROPERTY_ID = 'String {6f1d2c8e-3b7a-4e95-8c41-5a0e9d27b3f6} Name SieverOrigin'
const MEETING_LINK =
  /https:\/\/(?:teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|[\w.-]*zoom\.us|[\w.-]*webex\.com)\/[^\s"<>)]+/i
const MAX_RETRY_WAIT_MS = 30_000

/** What the user is told where an all-day event waits for the mailbox's time zone. */
export const MAILBOX_ZONE_NOT_GRANTED =
  'Per scrivere gli eventi di tutto il giorno Microsoft deve dare a SIEVER Mail il fuso orario della casella: ricollega il calendario.'

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
  ownCalendar: boolean
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
    title: item.subject?.trim() || '(senza titolo)',
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
  return allDay
    ? { dateTime: `${value.slice(0, 10)}T00:00:00`, timeZone: zone }
    : { dateTime: new Date(value).toISOString().slice(0, 23), timeZone: 'UTC' }
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
      throw new Error(MAILBOX_ZONE_NOT_GRANTED)
    }

    const { value } = await this.json<{ value?: string | null }>('/me/mailboxSettings/timeZone', {
      token: async () => token
    })

    if (!value) {
      throw new Error('Microsoft non ha detto il fuso orario della casella.')
    }

    return value
  }

  /**
   * The fields of an event as Graph takes them: only `fields`, the guests
   * kept as they are in the event at `current` — none for a new one.
   */
  private async fieldsOf(
    event: ProviderEventInput,
    fields: ReadonlySet<EventField>,
    current: string | null
  ): Promise<Record<string, unknown>> {
    const zone = fields.has('time') && event.allDay ? await this.mailboxZone() : 'UTC'

    return {
      ...(fields.has('title') ? { subject: event.title } : {}),
      ...(fields.has('time')
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
      name: calendar.name?.trim() || 'Calendario',
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
    const events: ProviderEvent[] = []

    for (const item of items) {
      events.push(
        item['@removed']
          ? await this.removed(calendarId, item.id, own)
          : eventOfGraph(item, calendarId, this.self, own)
      )
    }

    return { events, syncToken: deltaLink }
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

    return eventOfGraph((await response.json()) as GraphEvent, calendarId, this.self, own)
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
          ...(await this.fieldsOf(
            event,
            new Set<EventField>(['title', 'time', 'location', 'description', 'attendees']),
            null
          )),
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
      throw new Error('Questo è il calendario di un’altra persona: rispondi all’invito dal tuo.')
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
  const said = `Microsoft ha risposto ${response.status}${body?.error?.code ? ` (${body.error.code})` : ''}${
    body?.error?.message ? `: ${body.error.message}` : ''
  }`

  return response.status === 401
    ? new CalendarRequestError(
        'Microsoft non accetta più l’accesso a questo calendario: ricollegalo.',
        { status: 401, refusal: 'autorizzazione', cause: new Error(said) }
      )
    : new CalendarRequestError(said, { status: response.status })
}
