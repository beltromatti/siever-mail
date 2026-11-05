import { NodeHtmlMarkdown } from 'node-html-markdown'

import type { CalendarAttendee, CalendarResponse, EventOrigin } from '@shared/calendar'

import {
  SyncTokenExpired,
  type CalendarProvider,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'
import type { Fetch } from './ics-calendar'
import { originValue } from './icalendar'

const GRAPH = 'https://graph.microsoft.com/v1.0'
/** Times in UTC, and ids that do not change when an event moves. */
const PREFER = 'outlook.timezone="UTC", IdType="ImmutableId"'
/** The property our app marks its events with, in Exchange's own namespace for it. */
const ORIGIN_PROPERTY_ID = 'String {6f1d2c8e-3b7a-4e95-8c41-5a0e9d27b3f6} Name SieverOrigin'
const MEETING_LINK =
  /https:\/\/(?:teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|[\w.-]*zoom\.us|[\w.-]*webex\.com)\/[^\s"<>)]+/i
const MAX_RETRY_WAIT_MS = 30_000

interface GraphDateTime {
  dateTime: string
  timeZone: string
}

interface GraphAddress {
  emailAddress?: { address?: string | null; name?: string | null } | null
}

/** An event as Graph gives it, the fields read. */
export interface GraphEvent {
  id: string
  '@removed'?: { reason?: string }
  iCalUId?: string | null
  uid?: string | null
  subject?: string | null
  body?: { contentType?: 'text' | 'html'; content?: string | null } | null
  start?: GraphDateTime | null
  end?: GraphDateTime | null
  isAllDay?: boolean
  isCancelled?: boolean
  isOrganizer?: boolean
  location?: { displayName?: string | null } | null
  attendees?: Array<GraphAddress & { status?: { response?: string } | null }> | null
  organizer?: GraphAddress | null
  responseStatus?: { response?: string } | null
  onlineMeeting?: { joinUrl?: string | null } | null
  onlineMeetingUrl?: string | null
  webLink?: string | null
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

/** An all-day event's day, from the date its time carries. */
function dayOf(time: GraphDateTime): string {
  return time.dateTime.slice(0, 10)
}

function localMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).getTime()
}

/** An event as the app keeps it, from Graph's. */
export function eventOfGraph(item: GraphEvent, calendarId: string, self: string): ProviderEvent {
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
    iCalUid: item.uid ?? item.iCalUId ?? null,
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
    // The user's answer when invited; none for their own event.
    myResponse:
      item.isOrganizer || attendees.length === 0
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

/** A time as Graph takes it: the instant in UTC, or an all-day event's midnight. */
function graphTime(value: string, allDay: boolean): GraphDateTime {
  return {
    dateTime: allDay
      ? `${value.slice(0, 10)}T00:00:00`
      : new Date(value).toISOString().slice(0, 23),
    timeZone: 'UTC'
  }
}

function graphBody(event: ProviderEventInput): Record<string, unknown> {
  return {
    subject: event.title,
    body: { contentType: 'text', content: event.description ?? '' },
    start: graphTime(event.start, event.allDay),
    end: graphTime(event.end, event.allDay),
    isAllDay: event.allDay,
    location: { displayName: event.location ?? '' },
    attendees: event.attendees.map((address) => ({
      emailAddress: { address },
      type: 'required'
    }))
  }
}

/**
 * A Microsoft 365 or Outlook.com calendar, through Microsoft Graph: each
 * calendar read with its own delta — the window fixed by the first read,
 * what changed after — ids that stay as an event moves, times in UTC.
 * Graph tells the guests itself when an event with guests is written.
 */
export class GraphCalendarProvider implements CalendarProvider {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly self: string,
    private readonly fetch: Fetch
  ) {}

  private async request(
    url: string,
    init: { method?: string; body?: unknown; prefer?: string } = {}
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url.startsWith('https://') ? url : `${GRAPH}${url}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${await this.token()}`,
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

  private async json<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await this.request(url, init)

    if (!response.ok) {
      throw await graphError(response)
    }

    return (await response.json()) as T
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
    const { value } = await this.json<{
      value: Array<{
        id: string
        name?: string
        hexColor?: string | null
        canEdit?: boolean
        isDefaultCalendar?: boolean
      }>
    }>('/me/calendars?$select=id,name,hexColor,canEdit,isDefaultCalendar&$top=100')

    return value.map((calendar) => ({
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
    const events: ProviderEvent[] = []
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

      for (const item of page.value) {
        events.push(
          item['@removed']
            ? removedEvent(item.id, calendarId)
            : eventOfGraph(item, calendarId, this.self)
        )
      }

      url = page['@odata.nextLink'] ?? null
      deltaLink = page['@odata.deltaLink'] ?? deltaLink
    }

    return { events, syncToken: deltaLink }
  }

  async create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent> {
    const created = await this.json<GraphEvent>(
      `/me/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        body: {
          ...graphBody(event),
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

    return { ...eventOfGraph(created, calendarId, this.self), origin }
  }

  async update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput
  ): Promise<ProviderEvent> {
    const updated = await this.json<GraphEvent>(`/me/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: graphBody(event)
    })

    return eventOfGraph(updated, calendarId, this.self)
  }

  async remove(_calendarId: string, eventId: string): Promise<void> {
    const response = await this.request(`/me/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE'
    })

    if (!response.ok && response.status !== 404) {
      throw await graphError(response)
    }
  }

  async respond(
    calendarId: string,
    eventId: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<ProviderEvent> {
    const answered = await this.request(
      `/me/events/${encodeURIComponent(eventId)}/${ANSWERS[response]}`,
      {
        method: 'POST',
        body: { sendResponse: true }
      }
    )

    if (!answered.ok) {
      throw await graphError(answered)
    }

    return eventOfGraph(
      await this.json<GraphEvent>(`/me/events/${encodeURIComponent(eventId)}`),
      calendarId,
      this.self
    )
  }
}

/** Graph's error, said as Graph says it. */
async function graphError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string }
  } | null

  return new Error(
    response.status === 401
      ? 'Microsoft non accetta più l’accesso a questo calendario: ricollegalo.'
      : `Microsoft ha risposto ${response.status}${body?.error?.code ? ` (${body.error.code})` : ''}${
          body?.error?.message ? `: ${body.error.message}` : ''
        }`
  )
}
