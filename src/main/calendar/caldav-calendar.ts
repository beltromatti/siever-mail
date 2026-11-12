import { randomUUID } from 'node:crypto'

import { DAVClient, type DAVCalendar, type DAVObject } from 'tsdav'

import { currentLanguage, messages } from '@main/i18n'
import type { CalendarResponse, EventOrigin } from '@shared/calendar'
import { defineMessages, type Language } from '@shared/i18n'

import type {
  CalendarProvider,
  EventField,
  MoveHow,
  ProviderEvent,
  ProviderEventInput
} from './calendar-provider'
import { CalendarRequestError } from './calendar-refusal'
import {
  changeEventResource,
  newEventResource,
  occurrenceIn,
  holdsSeries,
  occurrencesOf,
  removeOccurrence,
  seriesOf,
  withResponse,
  type Occurrence
} from './icalendar'
import type { Fetch } from './ics-calendar'

/** A calendar object as kept here: where it is on the server, its version, its iCalendar text. */
export interface StoredObject {
  url: string
  etag: string | null
  data: string
}

/** The calendar objects of one connection, kept to sync and to change them. */
export interface CalendarObjectStore {
  list(calendarId: string): Promise<StoredObject[]>
  get(url: string): Promise<StoredObject | null>
  put(calendarId: string, objects: ReadonlyArray<StoredObject>): Promise<void>
  remove(urls: ReadonlyArray<string>): Promise<void>
  /** The objects of a calendar, all of them, as read now. */
  replace(calendarId: string, objects: ReadonlyArray<StoredObject>): Promise<void>
}

/** Where a sync left a calendar: the server's token or ctag, and the window read. */
interface SyncState {
  sync: string | null
  ctag: string | null
  from: number
  to: number
}

const CALENDAR_PROPS = {
  'd:displayname': {},
  'cs:getctag': {},
  'd:sync-token': {},
  'ca:calendar-color': {},
  'ca:calendar-order': {},
  'c:calendar-description': {},
  'c:calendar-timezone': {},
  'd:resourcetype': {},
  'c:supported-calendar-component-set': {},
  'd:current-user-privilege-set': {}
}

/** An event's id here: its object's URL, and the instance for one of a series. */
const eventIdOf = (url: string, recurrenceId: string | null): string =>
  recurrenceId ? `${url}#${recurrenceId}` : url

function splitEventId(eventId: string): { url: string; recurrenceId: string | null } {
  const at = eventId.indexOf('#')
  return at < 0
    ? { url: eventId, recurrenceId: null }
    : { url: eventId.slice(0, at), recurrenceId: eventId.slice(at + 1) }
}

function privileges(calendar: DAVCalendar): string[] {
  const set = calendar.projectedProps?.currentUserPrivilegeSet as
    { privilege?: unknown } | undefined
  const list = Array.isArray(set?.privilege) ? set.privilege : set?.privilege ? [set.privilege] : []
  return list.flatMap((privilege) => Object.keys(privilege as object))
}

function nameOf(calendar: DAVCalendar): string {
  return typeof calendar.displayName === 'string' && calendar.displayName.trim()
    ? calendar.displayName.trim()
    : messages(MESSAGES).calendar
}

/** A server's colour (`#RRGGBB`, often `#RRGGBBAA`) as the app keeps it. */
function colorOf(calendar: DAVCalendar): string | null {
  const color = typeof calendar.calendarColor === 'string' ? calendar.calendarColor.trim() : ''
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color) ? color.slice(0, 7).toLowerCase() : null
}

function orderOf(calendar: DAVCalendar): number {
  const order = Number(calendar.projectedProps?.calendarOrder)
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER
}

/** The features a server says it has, in the DAV header of its answer to OPTIONS (RFC 4918 §12.1). */
export function davFeatures(header: string | null): Set<string> {
  return new Set(
    (header ?? '')
      .split(',')
      .map((feature) => feature.trim().toLowerCase())
      .filter(Boolean)
  )
}

/** The languages a server is asked to answer in: the interface's first, then English. */
const ACCEPT_LANGUAGE: Readonly<Record<Language, string>> = {
  en: 'en-US,en;q=0.9',
  it: 'it-IT,it;q=0.9,en;q=0.8',
  de: 'de-DE,de;q=0.9,en;q=0.8'
}

const MESSAGES = defineMessages({
  calendar: { en: 'Calendar', it: 'Calendario', de: 'Kalender' },
  unscheduledGuests: {
    en: 'This calendar server doesn’t send invitations: put an event with invitees in a calendar that sends them (Google, Microsoft, iCloud), or create it without invitees.',
    it: 'Questo server di calendario non manda gli inviti: un evento con invitati mettilo in un calendario che li manda (Google, Microsoft, iCloud), o crealo senza invitati.',
    de: 'Dieser Kalenderserver versendet keine Einladungen: Legen Sie einen Termin mit Eingeladenen in einem Kalender an, der sie versendet (Google, Microsoft, iCloud), oder erstellen Sie ihn ohne Eingeladene.'
  },
  unscheduledChange: {
    en: 'This calendar server doesn’t notify invitees: an event with invitees is changed, or deleted, from the program that notifies them.',
    it: 'Questo server di calendario non avvisa gli invitati: un evento con invitati si cambia, o si elimina, dal programma che li avvisa.',
    de: 'Dieser Kalenderserver benachrichtigt keine Eingeladenen: Ein Termin mit Eingeladenen wird in dem Programm geändert oder gelöscht, das sie benachrichtigt.'
  },
  unscheduledAnswer: {
    en: 'This calendar server doesn’t notify the organizer: answer from the invitation you received by email.',
    it: 'Questo server di calendario non avvisa l’organizzatore: rispondi dall’invito che hai ricevuto per mail.',
    de: 'Dieser Kalenderserver benachrichtigt den Organisator nicht: Antworten Sie über die Einladung, die Sie per E-Mail erhalten haben.'
  },
  accessRefused: {
    en: 'The calendar’s server no longer accepts the sign-in: reconnect the calendar.',
    it: 'Il server del calendario non accetta più l’accesso: ricollega il calendario.',
    de: 'Der Server des Kalenders akzeptiert die Anmeldung nicht mehr: Verbinden Sie den Kalender erneut.'
  },
  notAllowed: {
    en: (what: string) => `${what}: the server doesn’t allow it.`,
    it: (what: string) => `${what}: il server non lo permette.`,
    de: (what: string) => `${what}: Der Server erlaubt es nicht.`
  },
  serverAnswered: {
    en: (what: string, status: number) => `${what}: the server answered ${status}.`,
    it: (what: string, status: number) => `${what}: il server ha risposto ${status}.`,
    de: (what: string, status: number) => `${what}: Der Server hat mit ${status} geantwortet.`
  },
  credentialsRefused: {
    en: 'The calendar’s server didn’t accept the username and password.',
    it: 'Il server del calendario non ha accettato nome utente e password.',
    de: 'Der Server des Kalenders hat Benutzername und Passwort nicht akzeptiert.'
  },
  noLongerAllowed: {
    en: 'The server no longer gives access to these calendars.',
    it: 'Il server non dà più l’accesso a questi calendari.',
    de: 'Der Server gewährt keinen Zugriff mehr auf diese Kalender.'
  },
  calendarsMoved: {
    en: 'The calendars are no longer at that server address.',
    it: 'I calendari non sono più a quell’indirizzo del server.',
    de: 'Die Kalender sind nicht mehr unter dieser Serveradresse.'
  },
  schedulingUnknown: {
    en: 'The calendar’s server didn’t say whether it sends invitations',
    it: 'Il server del calendario non ha detto se manda gli inviti',
    de: 'Der Server des Kalenders hat nicht mitgeteilt, ob er Einladungen versendet'
  },
  calendarGone: {
    en: 'This calendar is no longer on the server.',
    it: 'Questo calendario non è più sul server.',
    de: 'Dieser Kalender ist nicht mehr auf dem Server.'
  },
  eventGone: {
    en: 'The event is no longer on the server.',
    it: 'L’evento non c’è più sul server.',
    de: 'Der Termin ist nicht mehr auf dem Server.'
  },
  eventNotSaved: {
    en: 'The event wasn’t saved',
    it: 'L’evento non è stato salvato',
    de: 'Der Termin wurde nicht gespeichert'
  },
  eventNotCreated: {
    en: 'The event wasn’t created',
    it: 'L’evento non è stato creato',
    de: 'Der Termin wurde nicht erstellt'
  },
  eventNotDeleted: {
    en: 'The event wasn’t deleted',
    it: 'L’evento non è stato eliminato',
    de: 'Der Termin wurde nicht gelöscht'
  },
  eventNotMoved: {
    en: 'The event wasn’t moved',
    it: 'L’evento non è stato spostato',
    de: 'Der Termin wurde nicht verschoben'
  },
  copyWouldCancel: {
    en: 'The server doesn’t move events between its calendars, and a copy would cancel the invitation for the invitees.',
    it: 'Il server non sposta gli eventi tra i suoi calendari, e una copia annullerebbe l’invito per gli invitati.',
    de: 'Der Server verschiebt keine Termine zwischen seinen Kalendern, und eine Kopie würde die Einladung für die Eingeladenen absagen.'
  },
  sameUidRefused: {
    en: 'The server neither moves the event nor takes a copy of it in another of its calendars: move it in the server’s own app.',
    it: 'Il server non sposta l’evento e non ne accetta una copia in un altro suo calendario: spostalo dall’app del server.',
    de: 'Der Server verschiebt den Termin nicht und nimmt auch keine Kopie in einem anderen seiner Kalender an: Verschieben Sie ihn in der App des Servers.'
  }
})

/** The answers of a server that will not do a MOVE between its calendars: it may take a copy. */
const MOVE_REFUSED = new Set([400, 403, 405, 501, 502])

/**
 * Why a server turned down a copy of an object, when it says the UID is
 * taken (RFC 4791 §5.3.2.1 `no-uid-conflict`, RFC 6638 §3.2.4.1
 * `unique-scheduling-object-resource`): the same event cannot be in two
 * of its calendars.
 */
const UID_TAKEN = /no-uid-conflict|unique-scheduling-object-resource/i

/** The last part of an object's address: its name in a calendar. */
function nameOfObject(url: string): string {
  const path = new URL(url).pathname
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * A request about one calendar or one event that the server answered with
 * an error: it fails that request alone. Refused there, the access may be
 * the reason — a 401 says so — or that calendar, or that event, may not be
 * the user's to touch (403).
 */
async function davError(
  response: Pick<Response, 'status'>,
  what: string
): Promise<CalendarRequestError> {
  const m = messages(MESSAGES)
  return new CalendarRequestError(
    response.status === 401
      ? m.accessRefused
      : response.status === 403
        ? m.notAllowed(what)
        : m.serverAnswered(what, response.status),
    { status: response.status }
  )
}

/**
 * The status of the answer an error of tsdav's reports, which gives none
 * apart: "Invalid credentials: PROPFIND … returned 401", "Calendar
 * discovery failed: 404 Not Found". Null for any other error.
 */
export function davStatusOf(error: unknown): number | null {
  const message = error instanceof Error ? error.message : ''

  if (message.startsWith('Invalid credentials')) {
    return 401
  }

  const status = /^[A-Z][\w -]* failed: ([1-5]\d\d)\b/.exec(message)?.[1]
  return status ? Number(status) : null
}

/**
 * An error of the requests that reach the account itself — its sign-in,
 * the calendars in its home: the access refused (401, 403) or the home no
 * longer there (404, 410) turn the whole connection down. Anything else
 * stays as it came.
 */
function accountError(error: unknown): unknown {
  const status = davStatusOf(error)

  switch (status) {
    case 401:
      return new CalendarRequestError(messages(MESSAGES).credentialsRefused, {
        status,
        refusal: 'accesso',
        cause: error
      })
    case 403:
      return new CalendarRequestError(messages(MESSAGES).noLongerAllowed, {
        status,
        refusal: 'accesso',
        cause: error
      })
    case 404:
    case 410:
      return new CalendarRequestError(messages(MESSAGES).calendarsMoved, {
        status,
        refusal: 'sparito',
        cause: error
      })
    default:
      return error
  }
}

/**
 * A calendar on a CalDAV server — iCloud, Fastmail, Nextcloud, a company's
 * own — signed in with a user name and a (app) password. Its objects are
 * kept here as they are on the server: synced with the server's token
 * (sync-collection) or, where there is none, its ctag; expanded into the
 * window as events; changed in place — an instance of a series as its
 * exception — with the version they were read at. A server that schedules
 * (RFC 6638 — iCloud, Fastmail, Nextcloud) sends the invitations and the
 * answers itself; on one that does not, nobody would be told, so nothing
 * that would have to tell someone is written there.
 */
export class CalDavCalendarProvider implements CalendarProvider {
  private client: DAVClient | null = null
  private calendars: DAVCalendar[] | null = null
  private ownAddresses: string[] | null = null
  /** Whether each calendar's server schedules, asked once. */
  private readonly scheduling = new Map<string, Promise<boolean>>()

  constructor(
    private readonly options: {
      serverUrl: string
      username: string
      password: string
      fetch: Fetch
      store: CalendarObjectStore
    }
  ) {}

  private async dav(): Promise<DAVClient> {
    if (!this.client) {
      try {
        const client = new DAVClient({
          serverUrl: this.options.serverUrl,
          credentials: { username: this.options.username, password: this.options.password },
          authMethod: 'Basic',
          defaultAccountType: 'caldav',
          fetch: this.options.fetch as typeof globalThis.fetch,
          // A concrete language — the interface's —: iCloud answers 500 to the "*" Node sends; and no
          // answer from the browser's cache.
          fetchOptions: {
            headers: { 'Accept-Language': ACCEPT_LANGUAGE[currentLanguage()] },
            cache: 'no-store'
          }
        })
        await client.login()
        this.client = client
      } catch (error) {
        throw accountError(error)
      }
    }

    return this.client
  }

  /** The user's own addresses on the server (calendar-user-address-set), to read and give their answers. */
  async addresses(): Promise<string[]> {
    if (!this.ownAddresses) {
      const client = await this.dav()
      const listed = client.account
        ? await client.fetchCalendarUserAddresses({ account: client.account }).catch(() => [])
        : []
      this.ownAddresses = [
        ...new Set(
          [...listed, this.options.username]
            .map((address) =>
              address
                .replace(/^mailto:/i, '')
                .trim()
                .toLowerCase()
            )
            .filter((address) => address.includes('@'))
        )
      ]
    }

    return this.ownAddresses
  }

  /**
   * Whether the server sends, itself, the invitations of the events written
   * in a calendar, their changes, and the user's answers: it says so with
   * "calendar-auto-schedule" in its DAV header (RFC 6638 §2).
   */
  schedules(calendarId: string): Promise<boolean> {
    let asked = this.scheduling.get(calendarId)

    if (!asked) {
      asked = this.askScheduling(calendarId)
      this.scheduling.set(calendarId, asked)
      // Asked again next time when the question did not get through.
      asked.catch(() => this.scheduling.delete(calendarId))
    }

    return asked
  }

  private async askScheduling(calendarId: string): Promise<boolean> {
    const client = await this.dav()
    let features: string | null = null
    // Asked through the client, as every other request — its headers, its sign-in, Basic or
    // Digest — keeping the answer's DAV header, which tsdav does not hand back.
    const [answer] = await client.davRequest({
      url: calendarId,
      init: { method: 'OPTIONS', body: undefined },
      convertIncoming: false,
      parseOutgoing: false,
      headersToExclude: ['Content-Type'],
      fetch: (async (input: string, init?: RequestInit) => {
        const response = await this.options.fetch(input, init)
        features = response.headers.get('dav')
        return response
      }) as typeof globalThis.fetch
    })

    // Refused, or not answered for now: asked again later, not taken for a server that does not.
    if (
      [401, 403, 429].includes(answer.status) ||
      (answer.status >= 500 && answer.status !== 501)
    ) {
      throw await davError(answer, messages(MESSAGES).schedulingUnknown)
    }

    // A server that does not answer OPTIONS does not say it schedules.
    return answer.ok && davFeatures(features).has('calendar-auto-schedule')
  }

  private async calendar(calendarId: string): Promise<DAVCalendar> {
    const calendar =
      this.calendars?.find((candidate) => candidate.url === calendarId) ??
      (await this.fetchCalendars()).find((candidate) => candidate.url === calendarId)

    if (!calendar) {
      throw new Error(messages(MESSAGES).calendarGone)
    }

    return calendar
  }

  private async fetchCalendars(): Promise<DAVCalendar[]> {
    const client = await this.dav()
    this.calendars = (
      await client
        .fetchCalendars({
          props: CALENDAR_PROPS,
          projectedProps: { currentUserPrivilegeSet: true, calendarOrder: true }
        })
        .catch((error: unknown) => {
          throw accountError(error)
        })
    )
      // Calendars of events only: a list of tasks is not one.
      .filter((calendar) => !calendar.components?.length || calendar.components.includes('VEVENT'))
      .sort((a, b) => orderOf(a) - orderOf(b))
    return this.calendars
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
    const calendars = await this.fetchCalendars()
    const writable = (calendar: DAVCalendar): boolean => {
      const granted = privileges(calendar)
      // A server that does not say lets the user write: the write itself will tell.
      return (
        granted.length === 0 ||
        granted.some((name) => ['all', 'write', 'writeContent'].includes(name))
      )
    }
    const primary = calendars.find(writable)

    return calendars.map((calendar) => ({
      calendarId: calendar.url,
      name: nameOf(calendar),
      primary: calendar === primary,
      writable: writable(calendar),
      color: colorOf(calendar)
    }))
  }

  private async eventsOf(
    calendarId: string,
    object: { url: string; data: string },
    range: { from: number; to: number }
  ): Promise<ProviderEvent[]> {
    return occurrencesOf(object.data, range, await this.addresses()).map((occurrence) =>
      this.eventOf(calendarId, object.url, occurrence)
    )
  }

  private eventOf(calendarId: string, url: string, occurrence: Occurrence): ProviderEvent {
    const { recurrenceId, ...event } = occurrence
    // A series is one object on the server: its instances share its address.
    return {
      ...event,
      calendarId,
      eventId: eventIdOf(url, recurrenceId),
      seriesId: recurrenceId ? url : null
    }
  }

  async changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{
    events: ProviderEvent[]
    syncToken: string | null
    commit: () => Promise<void>
  }> {
    const client = await this.dav()
    const calendar = await this.calendar(calendarId)
    const { store } = this.options

    if ('fromIso' in since) {
      const range = { from: Date.parse(since.fromIso), to: Date.parse(since.toIso) }
      const objects = (
        await client.fetchCalendarObjects({
          calendar,
          timeRange: { start: since.fromIso, end: since.toIso }
        })
      ).filter((object): object is DAVObject & { data: string } => typeof object.data === 'string')

      const events = (
        await Promise.all(objects.map((object) => this.eventsOf(calendarId, object, range)))
      ).flat()
      const state: SyncState = {
        sync: calendar.syncToken ?? null,
        ctag: calendar.ctag ?? null,
        ...range
      }
      return {
        events,
        syncToken: JSON.stringify(state),
        commit: () =>
          store.replace(
            calendarId,
            objects.map((object) => ({
              url: object.url,
              etag: object.etag ?? null,
              data: object.data
            }))
          )
      }
    }

    const state = JSON.parse(since.syncToken) as SyncState
    const range = { from: state.from, to: state.to }
    const stored = new Map((await store.list(calendarId)).map((object) => [object.url, object]))
    const result = await client.smartCollectionSyncDetailed({
      collection: {
        ...calendar,
        syncToken: state.sync ?? undefined,
        ctag: state.ctag ?? undefined,
        objects: [...stored.values()].map((object) => ({
          url: object.url,
          etag: object.etag ?? undefined
        })),
        objectMultiGet: client.calendarMultiGet,
        fetchObjects: (params?: { collection: DAVCalendar }) =>
          params
            ? client.fetchCalendarObjects({ calendar: params.collection })
            : Promise.resolve([])
      }
    })
    const events: ProviderEvent[] = []
    const kept: StoredObject[] = []

    // Changed or new: its events now, and those it had that are no longer.
    for (const object of [...result.objects.created, ...result.objects.updated]) {
      if (typeof object.data !== 'string') {
        continue
      }

      const now = await this.eventsOf(calendarId, { url: object.url, data: object.data }, range)
      const before = stored.get(object.url)
      const still = new Set(now.map((event) => event.eventId))

      if (before) {
        for (const event of await this.eventsOf(calendarId, before, range)) {
          if (!still.has(event.eventId)) {
            events.push({ ...event, cancelled: true })
          }
        }
      }

      events.push(...now)
      kept.push({ url: object.url, etag: object.etag ?? null, data: object.data })
    }

    // Gone from the server: its events go.
    for (const object of result.objects.deleted) {
      const before = stored.get(object.url)

      if (before) {
        for (const event of await this.eventsOf(calendarId, before, range)) {
          events.push({ ...event, cancelled: true })
        }
      }
    }

    const next: SyncState = {
      sync: result.syncToken ?? state.sync,
      ctag: result.ctag ?? state.ctag,
      ...range
    }
    return {
      events,
      syncToken: JSON.stringify(next),
      commit: async () => {
        await store.put(calendarId, kept)
        await store.remove(result.objects.deleted.map((object) => object.url))
      }
    }
  }

  /** An object as the server has it now, kept. */
  private async fetchObject(calendarId: string, url: string): Promise<StoredObject> {
    const client = await this.dav()
    const [object] = await client.fetchCalendarObjects({
      calendar: await this.calendar(calendarId),
      objectUrls: [url]
    })

    if (!object || typeof object.data !== 'string') {
      throw new Error(messages(MESSAGES).eventGone)
    }

    const stored = { url: object.url, etag: object.etag ?? null, data: object.data }
    await this.options.store.put(calendarId, [stored])
    return stored
  }

  /**
   * The object written, kept as the server now has it: its new version, or
   * read again when it gave none. A series is not kept: the service reads
   * its occurrences in right after writing it (`CalendarService`), and a read
   * that found it here at the server's version would find nothing new and
   * make none. Left out, the read finds it new, makes every occurrence and
   * keeps it, with its version; a change before then reads it from the server.
   */
  private async written(
    calendarId: string,
    url: string,
    response: Response,
    data: string
  ): Promise<StoredObject> {
    const etag = response.headers.get('etag')

    if (holdsSeries(data)) {
      await this.options.store.remove([url])
      return { url, etag, data }
    }

    if (!etag) {
      return this.fetchObject(calendarId, url)
    }

    const stored = { url, etag, data }
    await this.options.store.put(calendarId, [stored])
    return stored
  }

  /** An object changed and written back with the version it was read at: changed again from the server's, once, if someone else wrote it. */
  private async rewrite(
    calendarId: string,
    url: string,
    change: (data: string) => string
  ): Promise<StoredObject> {
    const client = await this.dav()
    let object = (await this.options.store.get(url)) ?? (await this.fetchObject(calendarId, url))

    for (let attempt = 0; ; attempt++) {
      const data = change(object.data)
      const response = await client.updateCalendarObject({
        calendarObject: { url, etag: object.etag ?? undefined, data }
      })

      if (response.status === 412 && attempt === 0) {
        object = await this.fetchObject(calendarId, url)
        continue
      }

      if (!response.ok) {
        throw await davError(response, messages(MESSAGES).eventNotSaved)
      }

      return this.written(calendarId, url, response, data)
    }
  }

  private async occurrence(
    calendarId: string,
    object: StoredObject,
    recurrenceId: string | null
  ): Promise<ProviderEvent> {
    const occurrence = occurrenceIn(object.data, recurrenceId, await this.addresses())

    if (!occurrence) {
      throw new Error(messages(MESSAGES).eventGone)
    }

    return this.eventOf(calendarId, object.url, occurrence)
  }

  /** The organizer of an event with guests: the user, by their address on the server. */
  private async organizer(event: ProviderEventInput): Promise<string | null> {
    return event.attendees.length > 0 ? ((await this.addresses())[0] ?? null) : null
  }

  async create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent> {
    if (event.attendees.length > 0 && !(await this.schedules(calendarId))) {
      throw new Error(messages(MESSAGES).unscheduledGuests)
    }

    const client = await this.dav()
    const uid = randomUUID()
    const data = newEventResource(uid, event, await this.organizer(event), origin)
    const response = await client.createCalendarObject({
      calendar: await this.calendar(calendarId),
      filename: `${uid}.ics`,
      iCalString: data
    })

    if (!response.ok) {
      throw await davError(response, messages(MESSAGES).eventNotCreated)
    }

    const url = new URL(
      `${uid}.ics`,
      calendarId.endsWith('/') ? calendarId : `${calendarId}/`
    ).toString()
    return this.occurrence(calendarId, await this.written(calendarId, url, response, data), null)
  }

  async update(
    calendarId: string,
    eventId: string,
    event: ProviderEventInput,
    notify: boolean,
    fields: ReadonlySet<EventField>
  ): Promise<ProviderEvent> {
    if (notify && !(await this.schedules(calendarId))) {
      throw new Error(messages(MESSAGES).unscheduledChange)
    }

    const { url, recurrenceId } = splitEventId(eventId)
    const organizer = await this.organizer(event)
    // Applied to the object as the server has it — again after a 412 — only what changed.
    const object = await this.rewrite(calendarId, url, (data) =>
      changeEventResource(data, recurrenceId, event, organizer, fields)
    )
    return this.occurrence(calendarId, object, recurrenceId)
  }

  async remove(calendarId: string, eventId: string, notify: boolean): Promise<void> {
    if (notify && !(await this.schedules(calendarId))) {
      throw new Error(messages(MESSAGES).unscheduledChange)
    }

    const { url, recurrenceId } = splitEventId(eventId)

    // One instance of a series: the series says it is not there any more.
    if (recurrenceId) {
      await this.rewrite(calendarId, url, (data) => removeOccurrence(data, recurrenceId))
      return
    }

    const client = await this.dav()
    let object = await this.options.store.get(url)

    for (let attempt = 0; ; attempt++) {
      const response = await client.deleteCalendarObject({
        calendarObject: { url, etag: object?.etag ?? undefined }
      })

      if (response.status === 412 && attempt === 0) {
        object = await this.fetchObject(calendarId, url)
        continue
      }

      if (!response.ok && response.status !== 404) {
        throw await davError(response, messages(MESSAGES).eventNotDeleted)
      }

      await this.options.store.remove([url])
      return
    }
  }

  async series(calendarId: string, seriesId: string): Promise<ProviderEventInput> {
    const { url } = splitEventId(seriesId)
    const object = (await this.options.store.get(url)) ?? (await this.fetchObject(calendarId, url))
    const series = seriesOf(object.data, await this.addresses())

    if (!series) {
      throw new Error(messages(MESSAGES).eventGone)
    }

    return series
  }

  /**
   * WebDAV's own move (RFC 4918 §9.9) of the event's object to the other
   * calendar, never over another (`Overwrite: F`): a move between
   * calendars sends no invitation and no cancellation (RFC 6638 §3.2.3.4).
   * A server that will not move it takes, where nobody is invited, a copy
   * — the same object, its UID — then loses the old one; one that will
   * not have the same event twice, even for a moment, refuses both. Where
   * it went is not kept here: the service reads the calendar right after
   * (`CalendarService`), and that read finds it new — every occurrence of
   * it, its version — where one that found it kept would find nothing.
   */
  async move(
    calendarId: string,
    eventId: string,
    toCalendarId: string,
    { guests }: { guests: boolean }
  ): Promise<{ eventId: string; how: MoveHow }> {
    const { url } = splitEventId(eventId)
    const client = await this.dav()
    const target = await this.calendar(toCalendarId)
    const object = (await this.options.store.get(url)) ?? (await this.fetchObject(calendarId, url))
    const name = nameOfObject(url)
    const destination = new URL(
      name,
      toCalendarId.endsWith('/') ? toCalendarId : `${toCalendarId}/`
    ).toString()
    const [answer] = await client.davRequest({
      url,
      init: {
        method: 'MOVE',
        headers: { Destination: destination, Overwrite: 'F' },
        body: undefined
      },
      convertIncoming: false,
      parseOutgoing: false,
      headersToExclude: ['Content-Type']
    })

    if (answer.ok) {
      await this.options.store.remove([url, destination])
      return { eventId: destination, how: 'native' }
    }

    if (!MOVE_REFUSED.has(answer.status)) {
      throw await davError(answer, messages(MESSAGES).eventNotMoved)
    }

    if (guests) {
      throw new Error(messages(MESSAGES).copyWouldCancel)
    }

    const copied = await client.createCalendarObject({
      calendar: target,
      filename: name,
      iCalString: object.data
    })

    if (!copied.ok) {
      const said = await copied.text().catch(() => '')
      throw UID_TAKEN.test(said) || copied.status === 409
        ? new CalendarRequestError(messages(MESSAGES).sameUidRefused, { status: copied.status })
        : await davError(copied, messages(MESSAGES).eventNotMoved)
    }

    await this.options.store.remove([destination])

    try {
      await this.remove(calendarId, url, false)
    } catch (error) {
      // The old one stays: the copy goes, so the event is not there twice.
      await this.remove(toCalendarId, destination, false).catch(() => undefined)
      throw error
    }

    return { eventId: destination, how: 'copy' }
  }

  async respond(
    calendarId: string,
    eventId: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    series: boolean
  ): Promise<ProviderEvent> {
    if (!(await this.schedules(calendarId))) {
      throw new Error(messages(MESSAGES).unscheduledAnswer)
    }

    const { url, recurrenceId } = splitEventId(eventId)
    // The whole series answered: on the series itself, not on the instance shown.
    const answered = series ? null : recurrenceId
    const self = await this.addresses()
    const object = await this.rewrite(calendarId, url, (data) =>
      withResponse(data, answered, self, response)
    )
    return this.occurrence(calendarId, object, recurrenceId)
  }
}
