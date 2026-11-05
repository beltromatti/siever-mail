import { google, type calendar_v3 } from 'googleapis'

import type { CalendarResponse, EventOrigin } from '@shared/calendar'

import {
  SyncTokenExpired,
  type CalendarProvider,
  type EventField,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'

/** Events read and written, on every calendar the user has. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

const PAGE_SIZE = 250

/** Where an event put there by the Segretario says so, in the private properties only this user's copy carries. */
const ORIGIN_BY = 'sieverBy'
const ORIGIN_ACCOUNT = 'sieverAccount'
const ORIGIN_MESSAGE = 'sieverMessage'

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
    origin: originOf(event),
    cancelled: event.status === 'cancelled'
  }
}

function originOf(event: calendar_v3.Schema$Event): EventOrigin | null {
  const properties = event.extendedProperties?.private

  return properties?.[ORIGIN_BY] === 'segretario'
    ? {
        by: 'segretario',
        accountId: properties[ORIGIN_ACCOUNT] || null,
        messageKey: properties[ORIGIN_MESSAGE] || null
      }
    : null
}

/** An event's fields as Google takes them, times in the user's time zone. */
function bodyOf(event: ProviderEventInput): calendar_v3.Schema$Event {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const when = (value: string): calendar_v3.Schema$EventDateTime =>
    event.allDay
      ? { date: value.slice(0, 10), dateTime: null }
      : { dateTime: value, timeZone, date: null }

  return {
    summary: event.title,
    location: event.location,
    description: event.description,
    start: when(event.start),
    end: when(event.end)
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

  async listCalendars(): Promise<
    Array<{
      calendarId: string
      name: string
      primary: boolean
      writable: boolean
      color: string | null
    }>
  > {
    const calendars: Array<{
      calendarId: string
      name: string
      primary: boolean
      writable: boolean
      color: string | null
    }> = []
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
              primary: Boolean(item.primary),
              writable: item.accessRole === 'owner' || item.accessRole === 'writer',
              color: /^#[0-9a-f]{6}$/i.test(item.backgroundColor ?? '')
                ? item.backgroundColor!
                : null
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

  async create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent> {
    try {
      const { data } = await this.api.events.insert({
        calendarId,
        sendUpdates: event.attendees.length > 0 ? 'all' : 'none',
        requestBody: {
          ...bodyOf(event),
          attendees: event.attendees.map((email) => ({ email })),
          extendedProperties: origin
            ? {
                private: {
                  [ORIGIN_BY]: origin.by,
                  ...(origin.accountId ? { [ORIGIN_ACCOUNT]: origin.accountId } : {}),
                  ...(origin.messageKey ? { [ORIGIN_MESSAGE]: origin.messageKey } : {})
                }
              }
            : undefined
        }
      })
      return this.provided(calendarId, data, 'Google non ha restituito l’evento creato.')
    } catch (error) {
      throw readableError(error)
    }
  }

  async update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput,
    notify: boolean,
    fields: ReadonlySet<EventField>
  ): Promise<ProviderEvent> {
    try {
      const { data: current } = await this.api.events.get({ calendarId, eventId })
      const body = bodyOf(event)
      const wanted = new Set(event.attendees.map((email) => email.toLowerCase()))
      const kept = (current.attendees ?? []).filter(
        (attendee) =>
          attendee.self ||
          attendee.email?.toLowerCase() === this.selfEmail ||
          wanted.has(attendee.email?.toLowerCase() ?? '')
      )
      const known = new Set(kept.map((attendee) => attendee.email?.toLowerCase()))
      const { data } = await this.api.events.patch({
        calendarId,
        eventId,
        sendUpdates: notify ? 'all' : 'none',
        // Only what changed: a PATCH leaves the rest as Google has it now.
        requestBody: {
          ...(fields.has('title') ? { summary: body.summary } : {}),
          ...(fields.has('time') ? { start: body.start, end: body.end } : {}),
          ...(fields.has('location') ? { location: body.location } : {}),
          ...(fields.has('description') ? { description: body.description } : {}),
          // Those still invited keep their answers; the user's own entry stays.
          ...(fields.has('attendees')
            ? {
                attendees: [
                  ...kept,
                  ...event.attendees
                    .filter((email) => !known.has(email.toLowerCase()))
                    .map((email) => ({ email }))
                ]
              }
            : {})
        }
      })
      return this.provided(calendarId, data, 'Google non ha restituito l’evento.')
    } catch (error) {
      throw readableError(error)
    }
  }

  async remove(calendarId: string, eventId: string, notify: boolean): Promise<void> {
    try {
      await this.api.events.delete({ calendarId, eventId, sendUpdates: notify ? 'all' : 'none' })
    } catch (error) {
      const status = statusCode(error)

      if (status !== 404 && status !== 410) {
        throw readableError(error)
      }
    }
  }

  private provided(
    calendarId: string,
    data: calendar_v3.Schema$Event,
    missing: string
  ): ProviderEvent {
    const event = eventOf(data, this.selfEmail)

    if (!event) {
      throw new Error(missing)
    }

    return { ...event, calendarId }
  }

  async respond(
    calendarId: string,
    instanceId: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    series: boolean
  ): Promise<ProviderEvent> {
    try {
      let eventId = instanceId
      let { data: current } = await this.api.events.get({ calendarId, eventId })

      // The whole series answered: the instance stands for it.
      if (series && current.recurringEventId) {
        eventId = current.recurringEventId
        current = (await this.api.events.get({ calendarId, eventId })).data
      }

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
      return this.provided(calendarId, data, 'Google non ha restituito l’evento.')
    } catch (error) {
      throw readableError(error)
    }
  }
}
