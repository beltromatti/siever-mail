import { google, type calendar_v3 } from 'googleapis'

import { messages } from '@main/i18n'
import { refusalOf } from '@main/services/connection-refusal'
import type { CalendarEvent, CalendarResponse, EventOrigin } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import {
  SyncTokenExpired,
  type CalendarProvider,
  type EventField,
  type MoveHow,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'
import { CalendarRequestError } from './calendar-refusal'
import { anchorOf, knownZone, recurrenceOfLines, ruleOf } from './recurrence'

/** Events read and written, on every calendar the user has. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

const PAGE_SIZE = 250
/** How many series are asked for their rule at once, as a calendar is read. */
const SERIES_AT_ONCE = 8
/** Google keeps at most this many reminders of an event's own. */
export const GOOGLE_MAX_REMINDERS = 5

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

const MESSAGES = defineMessages({
  accessNotRecognized: {
    en: 'Google no longer recognizes the access to the calendar: connect it again.',
    it: "Google non riconosce più l'accesso al calendario: collegalo di nuovo.",
    de: 'Google erkennt den Zugriff auf den Kalender nicht mehr an: Verbinden Sie ihn erneut.'
  },
  accessNotGiven: {
    en: 'Google didn’t give access to the calendar: connect it again.',
    it: "Google non ha dato l'accesso al calendario: collegalo di nuovo.",
    de: 'Google hat keinen Zugriff auf den Kalender gewährt: Verbinden Sie ihn erneut.'
  },
  untitled: { en: '(untitled)', it: '(senza titolo)', de: '(ohne Titel)' },
  createdNotReturned: {
    en: 'Google didn’t return the event it created.',
    it: 'Google non ha restituito l’evento creato.',
    de: 'Google hat den erstellten Termin nicht zurückgegeben.'
  },
  notReturned: {
    en: 'Google didn’t return the event.',
    it: 'Google non ha restituito l’evento.',
    de: 'Google hat den Termin nicht zurückgegeben.'
  },
  someoneElses: {
    en: 'This is someone else’s calendar: answer the invitation from yours.',
    it: 'Questo è il calendario di un’altra persona: rispondi all’invito dal tuo.',
    de: 'Dies ist der Kalender einer anderen Person: Beantworten Sie die Einladung aus Ihrem eigenen.'
  },
  notInvited: {
    en: 'You’re not among the invitees of this event.',
    it: 'In questo evento non sei tra gli invitati.',
    de: 'Sie gehören nicht zu den Eingeladenen dieses Termins.'
  },
  seriesGone: {
    en: 'The repeating event is no longer in the calendar.',
    it: 'L’evento ripetuto non c’è più nel calendario.',
    de: 'Der Serientermin ist nicht mehr im Kalender.'
  },
  notMovable: {
    en: 'Google doesn’t move events of this kind (out of office, focus time, working location) to another calendar.',
    it: 'Google non sposta in un altro calendario gli eventi di questo tipo (fuori sede, concentrazione, luogo di lavoro).',
    de: 'Google verschiebt Termine dieser Art (Abwesenheit, Fokuszeit, Arbeitsort) nicht in einen anderen Kalender.'
  },
  tooManyReminders: {
    en: 'Google keeps at most 5 reminders for an event.',
    it: 'Google tiene al massimo 5 promemoria per evento.',
    de: 'Google speichert höchstens 5 Erinnerungen pro Termin.'
  }
})

/** The events another service keeps (vision §7.5), by Google's `eventType`: only their reminders change. */
const MANAGED: Readonly<Record<string, NonNullable<CalendarEvent['managedBy']>>> = {
  fromGmail: 'gmail',
  birthday: 'birthdays'
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

/**
 * Where a recurring event begins, as Google gives it: its day, or its
 * hour on the clock of the zone it is kept in.
 */
function anchorOfGoogle(event: calendar_v3.Schema$Event): ReturnType<typeof anchorOf> | null {
  const zone = knownZone(event.start?.timeZone)

  if (event.start?.date) {
    return anchorOf(event.start.date, true, zone)
  }

  return event.start?.dateTime ? anchorOf(event.start.dateTime, false, zone) : null
}

/** How a recurring event repeats, from its own lines and start; null for one that does not. */
function recurrenceOfGoogle(event: calendar_v3.Schema$Event): CalendarEvent['recurrence'] {
  const anchor = anchorOfGoogle(event)
  return event.recurrence?.length && anchor ? recurrenceOfLines(event.recurrence, anchor) : null
}

/**
 * Google's errors in the user's words, where they are the user's to act
 * on: the token refused, or without the calendar in what it allows, is the
 * account's authorization withdrawn whatever was asked — only consenting
 * again restores it.
 */
export function readableError(error: unknown): Error {
  const status = statusCode(error) ?? null
  const message = error instanceof Error ? error.message : String(error)

  if (status === 401 || refusalOf(error) === 'autorizzazione') {
    return new CalendarRequestError(messages(MESSAGES).accessNotRecognized, {
      status,
      refusal: 'autorizzazione',
      cause: error
    })
  }

  if (status === 403 && /insufficient|scope/i.test(message)) {
    return new CalendarRequestError(messages(MESSAGES).accessNotGiven, {
      status,
      refusal: 'autorizzazione',
      cause: error
    })
  }

  return error instanceof Error ? error : new Error(message)
}

/**
 * Whether Google's `self` — "this entry is the calendar this copy is in" —
 * says the user: in the user's own calendar, or in one of theirs that is no
 * person's (a secondary calendar). In someone else's calendar it is that
 * person: the user is themselves only by their address there.
 */
function selfIsUser(calendarId: string, selfEmail: string): boolean {
  const id = calendarId.toLowerCase()
  return id === 'primary' || id === selfEmail || id.endsWith('@group.calendar.google.com')
}

/** The minutes of the reminders shown on the screen — Google's `popup` — out of a list of them. */
function popupMinutes(
  reminders: ReadonlyArray<calendar_v3.Schema$EventReminder> | null | undefined
): number[] {
  return (reminders ?? []).flatMap((reminder) =>
    reminder.method === 'popup' && typeof reminder.minutes === 'number' ? [reminder.minutes] : []
  )
}

/**
 * An event's own reminders (vision §13.3): those it sets, or its calendar's
 * when it keeps the calendar's — undefined when those are not known here,
 * null for an all-day one that keeps them.
 * The ones Google sends by email are its own, not the desktop's.
 */
export function googleRemindersOf(
  event: calendar_v3.Schema$Event,
  calendarDefaults: ReadonlyArray<number> | undefined
): number[] | null | undefined {
  if (event.reminders?.useDefault === false) {
    return popupMinutes(event.reminders.overrides)
  }

  // A calendar's defaults are for the events with an hour: those of an all-day one Google keeps
  // apart, and does not tell — it says nothing of them.
  if (event.start?.date) {
    return null
  }

  return calendarDefaults ? [...calendarDefaults] : undefined
}

/**
 * An event as the app keeps it, from Google's. `series`: the rules of the
 * series read with it, by id — an instance carries its series'; one whose
 * series could not be read says nothing of it (undefined), and keeps what
 * was known.
 */
function eventOf(
  event: calendar_v3.Schema$Event,
  calendarId: string,
  selfEmail: string,
  calendarDefaults?: ReadonlyArray<number>,
  series?: ReadonlyMap<string, CalendarEvent['recurrence']>
): ProviderEvent | null {
  if (!event.id) {
    return null
  }

  const trustSelf = selfIsUser(calendarId, selfEmail)
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
            self:
              (trustSelf && Boolean(attendee.self)) || attendee.email.toLowerCase() === selfEmail,
            organizer: Boolean(attendee.organizer)
          }
        ]
      : []
  )
  const self = attendees.find((attendee) => attendee.self)

  return {
    calendarId,
    eventId: event.id,
    iCalUid: event.iCalUID ?? null,
    // An instance of a recurring event carries its series' id.
    seriesId: event.recurringEventId ?? null,
    title: event.summary?.trim() || messages(MESSAGES).untitled,
    start,
    end,
    allDay,
    startsAt: start ? (allDay ? localMidnight(start) : Date.parse(start)) : 0,
    endsAt: end ? (allDay ? localMidnight(end) : Date.parse(end)) : 0,
    location: event.location?.trim() || null,
    description: event.description?.trim() || null,
    attendees,
    organizer: event.organizer?.email?.toLowerCase() ?? null,
    // In a calendar shared the organizer is the calendar: who put the event there is the creator.
    creator: event.creator?.email?.toLowerCase() ?? null,
    // Answering is for the invited, in a calendar of theirs: one's own event has nothing to
    // answer, nor has the copy in a colleague's calendar.
    myResponse: trustSelf && self && !self.organizer ? self.response : null,
    meetLink:
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ??
      null,
    htmlLink: event.htmlLink ?? null,
    origin: originOf(event),
    reminders: googleRemindersOf(event, calendarDefaults),
    recurrence: event.recurringEventId
      ? series?.get(event.recurringEventId)
      : recurrenceOfGoogle(event),
    managedBy: MANAGED[event.eventType ?? ''] ?? null,
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

/**
 * An event's fields as Google takes them: times in the zone it is kept in
 * — the user's, for one written new —, which a series needs to keep its
 * hour; its rule from its start, with the days taken out it had (`kept`);
 * its own reminders, shown on the screen, or the calendar's.
 */
function bodyOf(
  event: ProviderEventInput,
  kept: ReadonlyArray<string> = []
): calendar_v3.Schema$Event {
  const timeZone = knownZone(event.zone)
  const when = (value: string): calendar_v3.Schema$EventDateTime =>
    event.allDay
      ? { date: value.slice(0, 10), dateTime: null }
      : { dateTime: value, timeZone, date: null }
  const rule = event.recurrence && event.recurrence !== 'other' ? event.recurrence : null

  return {
    summary: event.title,
    location: event.location,
    description: event.description,
    start: when(event.start),
    end: when(event.end),
    recurrence: rule
      ? [
          `RRULE:${ruleOf(rule, anchorOf(event.start, event.allDay, timeZone))}`,
          ...kept.filter((line) => /^EXDATE[:;]/i.test(line))
        ]
      : undefined,
    reminders:
      event.reminders === null
        ? { useDefault: true, overrides: [] }
        : {
            useDefault: false,
            overrides: event.reminders.map((minutes) => ({ method: 'popup', minutes }))
          }
  }
}

/** A list of reminders Google keeps, or why not. */
function checkReminders(reminders: ReadonlyArray<number> | null): void {
  if (reminders && new Set(reminders).size > GOOGLE_MAX_REMINDERS) {
    throw new Error(messages(MESSAGES).tooManyReminders)
  }
}

/** Google Calendar, through its API, as the account's owner. */
export class GoogleCalendarProvider implements CalendarProvider {
  private readonly api: calendar_v3.Calendar
  private readonly selfEmail: string
  /** The reminders each calendar gives the events that keep its own, as its list says them. */
  private readonly defaultReminders = new Map<string, number[]>()

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
            this.defaultReminders.set(item.id, popupMinutes(item.defaultReminders))
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
    const items: calendar_v3.Schema$Event[] = []
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

        items.push(...(data.items ?? []))
        pageToken = data.nextPageToken ?? undefined
        syncToken = data.nextSyncToken ?? syncToken
      } while (pageToken)
    } catch (error) {
      if (statusCode(error) === 410) {
        throw new SyncTokenExpired()
      }

      throw readableError(error)
    }

    const series = await this.seriesRules(calendarId, items)
    const events = items.flatMap((item) => {
      const event = eventOf(
        item,
        calendarId,
        this.selfEmail,
        this.defaultReminders.get(calendarId),
        series
      )
      return event ? [event] : []
    })

    return { events, syncToken }
  }

  /**
   * How the series of the instances read repeat: each series' recurring
   * event asked for once — its rule is on it, not on its instances —, a
   * few at a time. One that cannot be read is left out: its instances say
   * nothing of it, and keep what was known.
   */
  private async seriesRules(
    calendarId: string,
    items: ReadonlyArray<calendar_v3.Schema$Event>
  ): Promise<Map<string, CalendarEvent['recurrence']>> {
    const ids = [
      ...new Set(
        items.flatMap((item) =>
          item.recurringEventId && item.status !== 'cancelled' ? [item.recurringEventId] : []
        )
      )
    ]
    const rules = new Map<string, CalendarEvent['recurrence']>()

    await eachLimited(ids, SERIES_AT_ONCE, async (eventId) => {
      try {
        const { data } = await this.api.events.get({ calendarId, eventId })
        rules.set(eventId, recurrenceOfGoogle(data))
      } catch (error) {
        if (readableError(error) instanceof CalendarRequestError) {
          throw readableError(error)
        }
      }
    })

    return rules
  }

  async create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent> {
    checkReminders(event.reminders)

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
      return this.provided(calendarId, data, messages(MESSAGES).createdNotReturned)
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
    if (fields.has('reminders')) {
      checkReminders(event.reminders)
    }

    try {
      const { data: current } = await this.api.events.get({ calendarId, eventId })
      const body = bodyOf(event, current.recurrence ?? [])
      const wanted = new Set(event.attendees.map((email) => email.toLowerCase()))
      const kept = (current.attendees ?? []).filter(
        (attendee) =>
          attendee.self ||
          attendee.email?.toLowerCase() === this.selfEmail ||
          wanted.has(attendee.email?.toLowerCase() ?? '')
      )
      const known = new Set(kept.map((attendee) => attendee.email?.toLowerCase()))
      // A series' rule goes with its time, which it is read from (`EventField`); one made
      // elsewhere is never written again.
      const rule =
        fields.has('recurrence') ||
        (fields.has('time') && event.recurrence !== null && event.recurrence !== 'other')
      const change: calendar_v3.Schema$Event = {
        ...(fields.has('title') ? { summary: body.summary } : {}),
        // A rule needs its start's zone: the times go with it.
        ...(fields.has('time') || rule ? { start: body.start, end: body.end } : {}),
        ...(fields.has('location') ? { location: body.location } : {}),
        ...(fields.has('description') ? { description: body.description } : {}),
        ...(rule && body.recurrence ? { recurrence: body.recurrence } : {}),
        ...(fields.has('reminders') ? { reminders: body.reminders } : {}),
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
      const sendUpdates = notify ? 'all' : 'none'

      // One event again: a PATCH cannot take a rule away, a whole write without it does.
      if (fields.has('recurrence') && !body.recurrence && current.recurrence?.length) {
        const { data } = await this.api.events.update({
          calendarId,
          eventId,
          sendUpdates,
          requestBody: { ...current, ...change, recurrence: undefined }
        })
        return this.provided(calendarId, data, messages(MESSAGES).notReturned)
      }

      // Only what changed: a PATCH leaves the rest as Google has it now.
      const { data } = await this.api.events.patch({
        calendarId,
        eventId,
        sendUpdates,
        requestBody: change
      })
      return this.provided(calendarId, data, messages(MESSAGES).notReturned)
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

  async series(calendarId: string, seriesId: string): Promise<ProviderEventInput> {
    let master: calendar_v3.Schema$Event

    try {
      master = (await this.api.events.get({ calendarId, eventId: seriesId })).data
    } catch (error) {
      const status = statusCode(error)
      throw status === 404 || status === 410
        ? new Error(messages(MESSAGES).seriesGone)
        : readableError(error)
    }

    const event = this.provided(calendarId, master, messages(MESSAGES).seriesGone)

    return {
      title: event.title,
      start: event.allDay ? event.start : new Date(event.startsAt).toISOString(),
      end: event.allDay ? event.end : new Date(event.endsAt).toISOString(),
      allDay: event.allDay,
      location: event.location,
      description: event.description,
      attendees: event.attendees
        .filter((attendee) => !attendee.self)
        .map((attendee) => attendee.email),
      recurrence: event.recurrence ?? null,
      reminders: event.reminders ?? null,
      zone: master.start?.timeZone ?? undefined
    }
  }

  /**
   * Google's own move (`events.move`): the same event in the other
   * calendar, nobody told — a series whole, as Google moves no instance on
   * its own. Its id there is the one Google gives back.
   */
  async move(
    calendarId: string,
    eventId: string,
    toCalendarId: string
  ): Promise<{ eventId: string; how: MoveHow }> {
    try {
      const { data } = await this.api.events.move({
        calendarId,
        eventId,
        destination: toCalendarId,
        sendUpdates: 'none'
      })

      if (!data.id) {
        throw new Error(messages(MESSAGES).notReturned)
      }

      return { eventId: data.id, how: 'native' }
    } catch (error) {
      // Only the events of every day move: an absence, a focus time, a place of work do not.
      if (statusCode(error) === 400) {
        const { data } = await this.api.events
          .get({ calendarId, eventId })
          .catch(() => ({ data: null }))

        if (data?.eventType && data.eventType !== 'default') {
          throw new Error(messages(MESSAGES).notMovable)
        }
      }

      throw readableError(error)
    }
  }

  private provided(
    calendarId: string,
    data: calendar_v3.Schema$Event,
    missing: string
  ): ProviderEvent {
    const event = eventOf(data, calendarId, this.selfEmail, this.defaultReminders.get(calendarId))

    if (!event) {
      throw new Error(missing)
    }

    return event
  }

  async respond(
    calendarId: string,
    instanceId: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    series: boolean
  ): Promise<ProviderEvent> {
    // In a calendar someone shares, "self" is its owner: answering there would answer for them.
    if (!selfIsUser(calendarId, this.selfEmail)) {
      throw new Error(messages(MESSAGES).someoneElses)
    }

    try {
      let eventId = instanceId
      let { data: current } = await this.api.events.get({ calendarId, eventId })

      // The whole series answered: the instance stands for it.
      if (series && current.recurringEventId) {
        eventId = current.recurringEventId
        current = (await this.api.events.get({ calendarId, eventId })).data
      }

      const isUser = (attendee: calendar_v3.Schema$EventAttendee): boolean =>
        Boolean(attendee.self) || attendee.email?.toLowerCase() === this.selfEmail

      if (!current.attendees?.some(isUser)) {
        throw new Error(messages(MESSAGES).notInvited)
      }

      const attendees = current.attendees.map((attendee) =>
        isUser(attendee) ? { ...attendee, responseStatus: response } : attendee
      )
      const { data } = await this.api.events.patch({
        calendarId,
        eventId,
        sendUpdates: 'all',
        requestBody: { attendees }
      })
      return this.provided(calendarId, data, messages(MESSAGES).notReturned)
    } catch (error) {
      throw readableError(error)
    }
  }
}
