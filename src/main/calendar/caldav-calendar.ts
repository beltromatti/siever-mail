import { randomUUID } from 'node:crypto'

import { DAVClient, type DAVCalendar, type DAVObject } from 'tsdav'

import type { CalendarResponse, EventOrigin } from '@shared/calendar'

import type { CalendarProvider, ProviderEvent, ProviderEventInput } from './calendar-provider'
import {
  changeEventResource,
  newEventResource,
  occurrenceIn,
  occurrencesOf,
  removeOccurrence,
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
    : 'Calendario'
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

async function davError(response: Response, what: string): Promise<Error> {
  return new Error(
    response.status === 401 || response.status === 403
      ? 'Il server del calendario non accetta più l’accesso: ricollega il calendario.'
      : `${what}: il server ha risposto ${response.status}.`
  )
}

/**
 * A calendar on a CalDAV server — iCloud, Fastmail, Nextcloud, a company's
 * own — signed in with a user name and a (app) password. Its objects are
 * kept here as they are on the server: synced with the server's token
 * (sync-collection) or, where there is none, its ctag; expanded into the
 * window as events; changed in place — an instance of a series as its
 * exception — with the version they were read at. A server that schedules
 * (iCloud, Fastmail) sends the invitations and the answers itself.
 */
export class CalDavCalendarProvider implements CalendarProvider {
  private client: DAVClient | null = null
  private calendars: DAVCalendar[] | null = null
  private addresses: string[] | null = null

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
          // A concrete language: iCloud answers 500 to the "*" Node sends; and no answer from the browser's cache.
          fetchOptions: {
            headers: { 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8' },
            cache: 'no-store'
          }
        })
        await client.login()
        this.client = client
      } catch (error) {
        throw /401|Invalid credentials/i.test(error instanceof Error ? error.message : '')
          ? new Error('Il server del calendario non ha accettato nome utente e password.')
          : error
      }
    }

    return this.client
  }

  /** The user's own addresses on the server, to read and give their answers. */
  private async self(): Promise<string[]> {
    if (!this.addresses) {
      const client = await this.dav()
      const listed = client.account
        ? await client.fetchCalendarUserAddresses({ account: client.account }).catch(() => [])
        : []
      this.addresses = [
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

    return this.addresses
  }

  private async calendar(calendarId: string): Promise<DAVCalendar> {
    const calendar =
      this.calendars?.find((candidate) => candidate.url === calendarId) ??
      (await this.fetchCalendars()).find((candidate) => candidate.url === calendarId)

    if (!calendar) {
      throw new Error('Questo calendario non è più sul server.')
    }

    return calendar
  }

  private async fetchCalendars(): Promise<DAVCalendar[]> {
    const client = await this.dav()
    this.calendars = (
      await client.fetchCalendars({
        props: CALENDAR_PROPS,
        projectedProps: { currentUserPrivilegeSet: true, calendarOrder: true }
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
    return occurrencesOf(object.data, range, await this.self()).map((occurrence) =>
      this.eventOf(calendarId, object.url, occurrence)
    )
  }

  private eventOf(calendarId: string, url: string, occurrence: Occurrence): ProviderEvent {
    const { recurrenceId, ...event } = occurrence
    return { ...event, calendarId, eventId: eventIdOf(url, recurrenceId) }
  }

  async changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{ events: ProviderEvent[]; syncToken: string | null }> {
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

      await store.replace(
        calendarId,
        objects.map((object) => ({ url: object.url, etag: object.etag ?? null, data: object.data }))
      )
      const events = (
        await Promise.all(objects.map((object) => this.eventsOf(calendarId, object, range)))
      ).flat()
      const state: SyncState = {
        sync: calendar.syncToken ?? null,
        ctag: calendar.ctag ?? null,
        ...range
      }
      return { events, syncToken: JSON.stringify(state) }
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

    // Changed or new: its events now, and those it had that are no longer.
    for (const object of [...result.objects.created, ...result.objects.updated]) {
      if (typeof object.data !== 'string') {
        continue
      }

      const now = await this.eventsOf(calendarId, { url: object.url, data: object.data }, range)
      const before = stored.get(object.url)
      const kept = new Set(now.map((event) => event.eventId))

      if (before) {
        for (const event of await this.eventsOf(calendarId, before, range)) {
          if (!kept.has(event.eventId)) {
            events.push({ ...event, cancelled: true })
          }
        }
      }

      events.push(...now)
      await store.put(calendarId, [
        { url: object.url, etag: object.etag ?? null, data: object.data }
      ])
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

    await store.remove(result.objects.deleted.map((object) => object.url))
    const next: SyncState = {
      sync: result.syncToken ?? state.sync,
      ctag: result.ctag ?? state.ctag,
      ...range
    }
    return { events, syncToken: JSON.stringify(next) }
  }

  /** An object as the server has it now, kept. */
  private async fetchObject(calendarId: string, url: string): Promise<StoredObject> {
    const client = await this.dav()
    const [object] = await client.fetchCalendarObjects({
      calendar: await this.calendar(calendarId),
      objectUrls: [url]
    })

    if (!object || typeof object.data !== 'string') {
      throw new Error('L’evento non c’è più sul server.')
    }

    const stored = { url: object.url, etag: object.etag ?? null, data: object.data }
    await this.options.store.put(calendarId, [stored])
    return stored
  }

  /** The object written, kept as the server now has it: its new version, or read again when it gave none. */
  private async written(
    calendarId: string,
    url: string,
    response: Response,
    data: string
  ): Promise<StoredObject> {
    const etag = response.headers.get('etag')

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
        throw await davError(response, 'L’evento non è stato salvato')
      }

      return this.written(calendarId, url, response, data)
    }
  }

  private async occurrence(
    calendarId: string,
    object: StoredObject,
    recurrenceId: string | null
  ): Promise<ProviderEvent> {
    const occurrence = occurrenceIn(object.data, recurrenceId, await this.self())

    if (!occurrence) {
      throw new Error('L’evento non c’è più sul server.')
    }

    return this.eventOf(calendarId, object.url, occurrence)
  }

  /** The organizer of an event with guests: the user, by their address on the server. */
  private async organizer(event: ProviderEventInput): Promise<string | null> {
    return event.attendees.length > 0 ? ((await this.self())[0] ?? null) : null
  }

  async create(
    calendarId: string,
    event: ProviderEventInput,
    origin: EventOrigin | null
  ): Promise<ProviderEvent> {
    const client = await this.dav()
    const uid = randomUUID()
    const data = newEventResource(uid, event, await this.organizer(event), origin)
    const response = await client.createCalendarObject({
      calendar: await this.calendar(calendarId),
      filename: `${uid}.ics`,
      iCalString: data
    })

    if (!response.ok) {
      throw await davError(response, 'L’evento non è stato creato')
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
    event: ProviderEventInput
  ): Promise<ProviderEvent> {
    const { url, recurrenceId } = splitEventId(eventId)
    const organizer = await this.organizer(event)
    const object = await this.rewrite(calendarId, url, (data) =>
      changeEventResource(data, recurrenceId, event, organizer)
    )
    return this.occurrence(calendarId, object, recurrenceId)
  }

  async remove(calendarId: string, eventId: string): Promise<void> {
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
        throw await davError(response, 'L’evento non è stato eliminato')
      }

      await this.options.store.remove([url])
      return
    }
  }

  async respond(
    calendarId: string,
    eventId: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<ProviderEvent> {
    const { url, recurrenceId } = splitEventId(eventId)
    const self = await this.self()
    const object = await this.rewrite(calendarId, url, (data) =>
      withResponse(data, recurrenceId, self, response)
    )
    return this.occurrence(calendarId, object, recurrenceId)
  }
}
