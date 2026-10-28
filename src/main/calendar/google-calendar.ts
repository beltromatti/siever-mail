import { google, type calendar_v3 } from 'googleapis'

import type { CalendarResponse, NewCalendarEvent } from '@shared/calendar'

import { SyncTokenExpired, type CalendarProvider, type ProviderEvent } from './calendar-provider'

/** Events read and written, on every calendar the user has. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

const PAGE_SIZE = 250

const RESPONSES = new Set<CalendarResponse>(['accepted', 'tentative', 'declined', 'needsAction'])

function responseOf(value: string | null | undefined): CalendarResponse {
  return value && RESPONSES.has(value as CalendarResponse)
    ? (value as CalendarResponse)
    : 'needsAction'
}

/** A day written AAAA-MM-GG, at the local midnight it starts at. */
function localMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).getTime()
}

function statusCode(error: unknown): number | undefined {
  const value =
    (error as { status?: unknown; code?: unknown } | null)?.status ??
    (error as { code?: unknown } | null)?.code
  return typeof value === 'number'
    ? value
    : Number.isFinite(Number(value))
      ? Number(value)
      : undefined
}

/** Google's errors in the user's words, where they are the user's to act on. */
function readableError(error: unknown): Error {
  const status = statusCode(error)
  const message = error instanceof Error ? error.message : String(error)

  if (status === 401 || /invalid_grant/i.test(message)) {
    return new Error("Google non riconosce più l'accesso al calendario: collegalo di nuovo.")
  }

  if (status === 403 && /insufficient|scope/i.test(message)) {
    return new Error("Google non ha dato l'accesso al calendario: collegalo di nuovo.")
  }

  return error instanceof Error ? error : new Error(message)
}

function eventOf(event: calendar_v3.Schema$Event, selfEmail: string): ProviderEvent | null {
  if (!event.id) {
    return null
  }

  const allDay = Boolean(event.start?.date)
  const start = event.start?.dateTime ?? event.start?.date ?? ''
  const end = event.end?.dateTime ?? event.end?.date ?? start
  const attendees = (event.attendees ?? []).flatMap((attendee) =>
    attendee.email
      ? [
          {
            email: attendee.email,
            name: attendee.displayName ?? null,
            response: responseOf(attendee.responseStatus),
            self: Boolean(attendee.self) || attendee.email.toLowerCase() === selfEmail,
            organizer: Boolean(attendee.organizer)
          }
        ]
      : []
  )
  const self = attendees.find((attendee) => attendee.self)

  return {
    calendarId: '',
    eventId: event.id,
    iCalUid: event.iCalUID ?? null,
    title: event.summary?.trim() || '(senza titolo)',
    start,
    end,
    allDay,
    startsAt: start ? (allDay ? localMidnight(start) : Date.parse(start)) : 0,
    endsAt: end ? (allDay ? localMidnight(end) : Date.parse(end)) : 0,
    location: event.location?.trim() || null,
    description: event.description?.trim() || null,
    attendees,
    organizer: event.organizer?.displayName ?? event.organizer?.email ?? null,
    // Answering is for the invited; one's own event has nothing to answer.
    myResponse: self && !self.organizer ? self.response : null,
    meetLink:
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ??
      null,
    htmlLink: event.htmlLink ?? null,
    cancelled: event.status === 'cancelled'
  }
}

/** Google Calendar, through its API, as the account's owner. */
export class GoogleCalendarProvider implements CalendarProvider {
  private readonly api: calendar_v3.Calendar
  private readonly selfEmail: string

  constructor(auth: calendar_v3.Options['auth'], selfEmail: string) {
    this.api = google.calendar({ version: 'v3', auth })
    this.selfEmail = selfEmail.toLowerCase()
  }

  async listCalendars(): Promise<Array<{ calendarId: string; name: string; primary: boolean }>> {
    const calendars: Array<{ calendarId: string; name: string; primary: boolean }> = []
    let pageToken: string | undefined

    try {
      do {
        const { data } = await this.api.calendarList.list({ pageToken, showHidden: false })

        for (const item of data.items ?? []) {
          // The ones the user has ticked in Google Calendar: those are the ones they look at.
          if (item.id && item.selected !== false) {
            calendars.push({
              calendarId: item.id,
              name: item.summaryOverride ?? item.summary ?? item.id,
              primary: Boolean(item.primary)
            })
          }
        }

        pageToken = data.nextPageToken ?? undefined
      } while (pageToken)
    } catch (error) {
      throw readableError(error)
    }

    return calendars
  }

  async changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{ events: ProviderEvent[]; syncToken: string | null }> {
    const events: ProviderEvent[] = []
    let pageToken: string | undefined
    let syncToken: string | null = null

    try {
      do {
        const { data } = await this.api.events.list({
          calendarId,
          // The same query every time, as a sync token requires: instances, deleted ones too.
          singleEvents: true,
          showDeleted: true,
          maxResults: PAGE_SIZE,
          pageToken,
          ...('syncToken' in since
            ? { syncToken: since.syncToken }
            : { timeMin: since.fromIso, timeMax: since.toIso })
        })

        for (const item of data.items ?? []) {
          const event = eventOf(item, this.selfEmail)

          if (event) {
            events.push({ ...event, calendarId })
          }
        }

        pageToken = data.nextPageToken ?? undefined
        syncToken = data.nextSyncToken ?? syncToken
      } while (pageToken)
    } catch (error) {
      if (statusCode(error) === 410) {
        throw new SyncTokenExpired()
      }

      throw readableError(error)
    }

    return { events, syncToken }
  }

  async create(calendarId: string, event: NewCalendarEvent): Promise<ProviderEvent> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const when = (value: string): calendar_v3.Schema$EventDateTime =>
      event.allDay ? { date: value.slice(0, 10) } : { dateTime: value, timeZone }

    try {
      const { data } = await this.api.events.insert({
        calendarId,
        sendUpdates: event.attendees.length > 0 ? 'all' : 'none',
        requestBody: {
          summary: event.title,
          location: event.location ?? undefined,
          description: event.description ?? undefined,
          start: when(event.start),
          end: when(event.end),
          attendees: event.attendees.map((email) => ({ email }))
        }
      })
      const created = eventOf(data, this.selfEmail)

      if (!created) {
        throw new Error('Google non ha restituito l’evento creato.')
      }

      return { ...created, calendarId }
    } catch (error) {
      throw readableError(error)
    }
  }

  async respond(
    calendarId: string,
    eventId: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<ProviderEvent> {
    try {
      const { data: current } = await this.api.events.get({ calendarId, eventId })
      const attendees = (current.attendees ?? []).map((attendee) =>
        attendee.self || attendee.email?.toLowerCase() === this.selfEmail
          ? { ...attendee, responseStatus: response }
          : attendee
      )
      const { data } = await this.api.events.patch({
        calendarId,
        eventId,
        sendUpdates: 'all',
        requestBody: { attendees }
      })
      const answered = eventOf(data, this.selfEmail)

      if (!answered) {
        throw new Error('Google non ha restituito l’evento.')
      }

      return { ...answered, calendarId }
    } catch (error) {
      throw readableError(error)
    }
  }
}
