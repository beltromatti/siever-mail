import type { CalendarEvent as CalendarEventRow, Prisma, PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import type { BrowserWindow } from 'electron'

import type { GoogleOAuthService } from '@main/services/google-oauth'
import { MICROSOFT_GRAPH_SCOPES, type MicrosoftOAuthService } from '@main/services/microsoft-oauth'
import { decryptSecret, encryptSecret } from '@main/services/secure-storage'
import { logMainError } from '@main/utils/error-utils'
import {
  CALENDAR_IPC,
  calendarKey,
  type CalendarAttendee,
  type CalendarChange,
  type CalendarConnection,
  type CalendarListEntry,
  type CalendarEvent,
  type CalendarProviderKind,
  type CalendarResponse,
  type EventChange,
  type EventOrigin,
  type NewCalendarEvent
} from '@shared/calendar'
import type { MailAccount } from '@shared/models'

import {
  SyncTokenExpired,
  type CalendarProvider,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'
import {
  CalDavCalendarProvider,
  type CalendarObjectStore,
  type StoredObject
} from './caldav-calendar'
import { GOOGLE_CALENDAR_SCOPE, GoogleCalendarProvider } from './google-calendar'
import { GraphCalendarProvider } from './graph-calendar'
import { calendarNameOf } from './icalendar'
import { calendarText, feedUrl, IcsCalendarProvider, type Fetch } from './ics-calendar'

/** How often the calendars are read again for what changed. */
const SYNC_EVERY_MS = 5 * 60 * 1000
/** How far back the events are kept: last weeks' meetings still matter to the mail about them. */
const WINDOW_BACK_MS = 60 * 24 * 60 * 60 * 1000
/** How far ahead they are read. */
const WINDOW_AHEAD_MS = 365 * 24 * 60 * 60 * 1000
/** Less than this ahead, the window is read again from today, so the months coming are in it. */
const WINDOW_MIN_AHEAD_MS = 180 * 24 * 60 * 60 * 1000
/** How long what changed in the calendars is kept for the Segretario to look at. */
const CHANGES_KEPT_MS = 30 * 24 * 60 * 60 * 1000

export interface CalendarServiceOptions {
  database: {
    storeClient(): Promise<PrismaClient>
    getAccounts(): Promise<MailAccount[]>
  }
  oauth: GoogleOAuthService
  microsoft: MicrosoftOAuthService
  /** The network, as the app reaches it (its proxy, its certificates). */
  fetch: Fetch
  /** Sends an event to the window. */
  send(channel: string, payload: unknown): void
  parentWindow(): BrowserWindow | null
}

/** Whether two addresses are the same mailbox: the case of an address does not matter. */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function eventKey(connectionId: string, calendarId: string, eventId: string): string {
  return `${connectionId}\u0000${calendarId}\u0000${eventId}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The local day an instant falls on, AAAA-MM-GG. */
function localDayOf(instant: number): string {
  const date = new Date(instant)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A day AAAA-MM-GG moved by some days. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return localDayOf(new Date(year, month - 1, date + days).getTime())
}

/** Whether what the user sees of an event is different: its time, words, place, people and answers. */
function differs(row: CalendarEventRow, event: ProviderEvent): boolean {
  return (
    row.title !== event.title ||
    row.start !== event.start ||
    row.end !== event.end ||
    (row.allDay === 1) !== event.allDay ||
    row.location !== event.location ||
    row.description !== event.description ||
    row.attendeesJson !== JSON.stringify(event.attendees) ||
    row.myResponse !== event.myResponse
  )
}

/**
 * An event with a change applied, every field as it should be after it.
 * Moving only the start keeps the length; turning a timed event into an
 * all-day one keeps its days; the other way round needs the times.
 */
function changedEvent(
  current: CalendarEvent & { startsAt: number; endsAt: number },
  change: EventChange
): ProviderEventInput {
  const allDay = change.allDay ?? current.allDay
  let start = change.start ?? null
  let end = change.end ?? null

  if (allDay !== current.allDay && !(start && end)) {
    if (!allDay) {
      throw new Error('Per dare un orario a un evento di tutto il giorno servono inizio e fine.')
    }

    start ??= localDayOf(current.startsAt)
    end ??= shiftDay(localDayOf(current.endsAt - 1), 1)
  }

  if (start && !end) {
    end = allDay
      ? shiftDay(start, Math.max(1, Math.round((current.endsAt - current.startsAt) / DAY_MS)))
      : new Date(Date.parse(start) + (current.endsAt - current.startsAt)).toISOString()
  }

  start ??= current.start
  end ??= current.end

  if (allDay ? end <= start : Date.parse(end) <= Date.parse(start)) {
    throw new Error('La fine dell’evento deve venire dopo l’inizio.')
  }

  return {
    title: change.title ?? current.title,
    start,
    end,
    allDay,
    location: change.location !== undefined ? change.location : current.location,
    description: change.description !== undefined ? change.description : current.description,
    attendees:
      change.attendees ??
      current.attendees.filter((attendee) => !attendee.self).map((attendee) => attendee.email)
  }
}

function eventOfRow(row: CalendarEventRow, calendarName: string): CalendarEvent {
  return {
    key: row.key,
    connectionId: row.connectionId,
    calendarId: row.calendarId,
    calendarName,
    eventId: row.eventId,
    iCalUid: row.iCalUid,
    title: row.title,
    start: row.start,
    end: row.end,
    allDay: row.allDay === 1,
    location: row.location,
    description: row.description,
    attendees: JSON.parse(row.attendeesJson) as CalendarAttendee[],
    organizer: row.organizer,
    myResponse: (row.myResponse as CalendarResponse | null) ?? null,
    meetLink: row.meetLink,
    htmlLink: row.htmlLink,
    origin: row.originJson ? (JSON.parse(row.originJson) as EventOrigin) : null
  }
}

/**
 * The calendar connections, each on its own — a Google account, and the
 * providers to come — their calendars kept here in step with the provider:
 * read again every few minutes for what changed, and read by the
 * Calendario, Oggi, the reader and the Segretario from here. A connection
 * has its own access: the mail never depends on it, nor it on the mail.
 */
export class CalendarService {
  private prisma: PrismaClient | null = null
  private timer: NodeJS.Timeout | null = null
  /** The sync of each account under way: one at a time each. */
  private readonly syncing = new Map<string, Promise<void>>()

  constructor(private readonly options: CalendarServiceOptions) {}

  async open(): Promise<void> {
    this.prisma = await this.options.database.storeClient()
    this.timer = setInterval(() => void this.syncAll(), SYNC_EVERY_MS)
    void this.syncAll()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private requirePrisma(): PrismaClient {
    if (!this.prisma) {
      throw new Error('The calendars are not open yet.')
    }

    return this.prisma
  }

  /** The calendar connections, and how each stands. */
  async listConnections(): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const [connections, calendars] = await Promise.all([
      prisma.calendarConnection.findMany({ orderBy: { connectedAt: 'asc' } }),
      prisma.calendarCalendar.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] })
    ])

    return connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider as CalendarProviderKind,
      label: connection.label,
      mailAccountId: connection.mailAccountId,
      serverUrl: connection.serverUrl,
      lastSyncAt: connection.lastSyncAt ? Number(connection.lastSyncAt) : null,
      problem: connection.problem,
      calendars: calendars
        .filter((calendar) => calendar.connectionId === connection.id)
        .map((calendar) => ({
          connectionId: connection.id,
          calendarId: calendar.calendarId,
          name: calendar.name,
          primary: calendar.isPrimary === 1
        }))
    }))
  }

  /**
   * Asks Google for a calendar, in Google's window: the calendar of a
   * Google mail connection — that account already chosen — or, with none,
   * of the account the user picks, the calendar alone. Resolves once its
   * events are in.
   */
  async connectGoogle(mailAccountId: string | null): Promise<CalendarConnection[]> {
    const account = mailAccountId
      ? (await this.options.database.getAccounts()).find(
          (candidate) => candidate.id === mailAccountId
        )
      : undefined

    if (mailAccountId && account?.type !== 'gmail') {
      throw new Error('Il calendario di Google si collega per un account Google.')
    }

    const granted = await this.options.oauth.authorize(this.options.parentWindow() ?? undefined, {
      scopes: [GOOGLE_CALENDAR_SCOPE],
      loginHint: account?.email,
      title: account ? `Collega il calendario di ${account.email}` : 'Collega un calendario Google'
    })

    if (account && granted.email.toLowerCase() !== account.email.toLowerCase()) {
      throw new Error(
        `Hai scelto ${granted.email} in Google: per questo calendario serve ${account.email}.`
      )
    }

    await this.addGoogle(granted.email, granted.refreshToken, granted.scopes)
    return this.listConnections()
  }

  /**
   * Keeps the calendar of a Google account the user granted — on its own,
   * or with the account's mail in one consent — and reads its events in.
   * The account's mail connection, when there is one, goes with it.
   */
  async addGoogle(
    email: string,
    refreshToken: string,
    scopes: ReadonlyArray<string>
  ): Promise<void> {
    if (!scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
      throw new Error(
        "Google non ha dato l'accesso al calendario: rifallo lasciando selezionata la casella del calendario."
      )
    }

    const prisma = this.requirePrisma()
    const mail = (await this.options.database.getAccounts()).find(
      (candidate) => candidate.type === 'gmail' && sameAddress(candidate.email, email)
    )
    const existing = (
      await prisma.calendarConnection.findMany({ where: { provider: 'google' } })
    ).find((connection) => sameAddress(connection.label, email))
    // A calendar connected before keeps its id, and so its events their keys.
    const id = existing?.id ?? mail?.id ?? randomUUID()
    const now = BigInt(Date.now())
    const fields = {
      label: email,
      mailAccountId: mail?.id ?? null,
      encryptedSecret: encryptSecret(refreshToken),
      connectedAt: now,
      problem: null
    }

    await prisma.calendarConnection.upsert({
      where: { id },
      create: { id, provider: 'google', ...fields },
      update: fields
    })
    await this.sync(id)
  }

  /**
   * Asks Microsoft for a calendar, in the browser: of a mail connection
   * signed in with Microsoft — that account suggested — or of any Microsoft
   * account, the calendar alone. Resolves once its events are in.
   */
  async connectMicrosoft(mailAccountId: string | null): Promise<CalendarConnection[]> {
    const account = mailAccountId
      ? (await this.options.database.getAccounts()).find(
          (candidate) => candidate.id === mailAccountId
        )
      : undefined
    const granted = await this.options.microsoft.authorize(account?.email)

    if (account && !sameAddress(granted.email, account.email)) {
      throw new Error(
        `Hai scelto ${granted.email} in Microsoft: per questo calendario serve ${account.email}.`
      )
    }

    await this.addMicrosoft(granted.email, granted.secret)
    return this.listConnections()
  }

  /**
   * Keeps the calendar of a Microsoft account the user granted — alone, or
   * with its mail in the same consent — and reads its events in.
   */
  async addMicrosoft(email: string, secret: string): Promise<void> {
    const prisma = this.requirePrisma()
    const mail = (await this.options.database.getAccounts()).find(
      (candidate) =>
        candidate.type === 'imap' &&
        candidate.authType === 'oauth' &&
        sameAddress(candidate.email, email)
    )
    const existing = (
      await prisma.calendarConnection.findMany({ where: { provider: 'microsoft' } })
    ).find((connection) => sameAddress(connection.label, email))
    const id = existing?.id ?? randomUUID()
    const fields = {
      label: email,
      mailAccountId: mail?.id ?? null,
      encryptedSecret: encryptSecret(secret),
      connectedAt: BigInt(Date.now()),
      problem: null
    }

    await prisma.calendarConnection.upsert({
      where: { id },
      create: { id, provider: 'microsoft', ...fields },
      update: fields
    })
    await this.sync(id)
  }

  /**
   * A calendar on a CalDAV server — iCloud, Fastmail, Nextcloud — signed in
   * with a user name and an (app) password, once the server took them and
   * showed its calendars. Resolves once its events are in.
   */
  async addCalDav(input: {
    serverUrl: string
    username: string
    password: string
    label: string
  }): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const url = new URL(input.serverUrl.trim())
    const serverUrl = url.toString()

    // The password goes in every request: in the clear only to a server on this computer.
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new Error('L’indirizzo del server comincia con https://.')
    }

    const known = (
      await prisma.calendarConnection.findMany({ where: { provider: 'caldav' } })
    ).find(
      (connection) =>
        connection.serverUrl === serverUrl && sameAddress(connection.username ?? '', input.username)
    )
    const id = known?.id ?? randomUUID()
    const probe = new CalDavCalendarProvider({
      serverUrl,
      username: input.username.trim(),
      password: input.password,
      fetch: this.options.fetch,
      store: this.objectStore(id)
    })

    if ((await probe.listCalendars()).length === 0) {
      throw new Error('Su questo server non ci sono calendari di eventi.')
    }

    const fields = {
      label: input.label.trim() || input.username.trim(),
      mailAccountId: null,
      serverUrl,
      username: input.username.trim(),
      encryptedSecret: encryptSecret(input.password),
      connectedAt: BigInt(Date.now()),
      problem: null
    }

    await prisma.calendarConnection.upsert({
      where: { id },
      create: { id, provider: 'caldav', ...fields },
      update: fields
    })
    await this.sync(id)
    return this.listConnections()
  }

  /** A connection's CalDAV objects, kept in `calendar_objects`. */
  private objectStore(connectionId: string): CalendarObjectStore {
    const prisma = this.requirePrisma()
    const rowOf = (object: { url: string; etag: string | null; data: string }): StoredObject => ({
      url: object.url,
      etag: object.etag,
      data: object.data
    })

    return {
      list: async (calendarId) =>
        (await prisma.calendarObject.findMany({ where: { connectionId, calendarId } })).map(rowOf),
      get: async (url) => {
        const row = await prisma.calendarObject.findUnique({
          where: { connectionId_url: { connectionId, url } }
        })
        return row ? rowOf(row) : null
      },
      put: async (calendarId, objects) => {
        await prisma.$transaction(
          objects.map((object) =>
            prisma.calendarObject.upsert({
              where: { connectionId_url: { connectionId, url: object.url } },
              create: { connectionId, calendarId, ...object },
              update: { calendarId, etag: object.etag, data: object.data }
            })
          )
        )
      },
      remove: async (urls) => {
        for (let at = 0; at < urls.length; at += 500) {
          await prisma.calendarObject.deleteMany({
            where: { connectionId, url: { in: urls.slice(at, at + 500) } }
          })
        }
      },
      replace: async (calendarId, objects) => {
        await prisma.$transaction([
          prisma.calendarObject.deleteMany({ where: { connectionId, calendarId } }),
          ...objects.map((object) =>
            prisma.calendarObject.create({ data: { connectionId, calendarId, ...object } })
          )
        ])
      }
    }
  }

  /**
   * Subscribes to a calendar published at a link — read only — once the
   * link proved to be a calendar. The link often carries a secret: it is
   * kept encrypted, and shown by its server only.
   */
  async addIcs(link: string, name: string | null): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const url = feedUrl(link)
    const subscribed = await prisma.calendarConnection.findMany({ where: { provider: 'ics' } })

    if (
      subscribed.some(
        (connection) =>
          connection.encryptedSecret && decryptSecret(connection.encryptedSecret) === url
      )
    ) {
      throw new Error('Questo calendario è già collegato.')
    }

    const response = await this.options.fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000)
    })

    if (!response.ok) {
      throw new Error(`Il link del calendario non risponde (${response.status}).`)
    }

    const text = await calendarText(response)

    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('A quel link non c’è un calendario (.ics).')
    }

    const id = randomUUID()
    await prisma.calendarConnection.create({
      data: {
        id,
        provider: 'ics',
        label: name?.trim() || calendarNameOf(text) || new URL(url).hostname,
        serverUrl: new URL(url).origin,
        encryptedSecret: encryptSecret(url),
        connectedAt: BigInt(Date.now())
      }
    })
    await this.sync(id)
    return this.listConnections()
  }

  /** Forgets a calendar connection here — its calendars and events; the provider keeps them. */
  async disconnect(connectionId: string): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()

    await prisma.$transaction([
      prisma.calendarChange.deleteMany({ where: { connectionId } }),
      prisma.calendarEvent.deleteMany({ where: { connectionId } }),
      prisma.calendarObject.deleteMany({ where: { connectionId } }),
      prisma.calendarCalendar.deleteMany({ where: { connectionId } }),
      prisma.calendarConnection.deleteMany({ where: { id: connectionId } })
    ])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.listConnections()
  }

  /**
   * A mail connection removed: a calendar that came with it stays — it has
   * its own access — and stands alone from now on.
   */
  async mailAccountRemoved(accountId: string): Promise<void> {
    await this.requirePrisma().calendarConnection.updateMany({
      where: { mailAccountId: accountId },
      data: { mailAccountId: null }
    })
  }

  /** "Elimina tutti i dati": the events go, the connections stay and read them anew. */
  async clearData(): Promise<void> {
    const prisma = this.requirePrisma()

    await prisma.$transaction([
      prisma.calendarChange.deleteMany(),
      prisma.calendarEvent.deleteMany(),
      prisma.calendarObject.deleteMany(),
      prisma.calendarCalendar.deleteMany()
    ])
    void this.syncAll()
  }

  async syncAll(): Promise<void> {
    if (!this.prisma) {
      return
    }

    const connected = await this.prisma.calendarConnection.findMany({ select: { id: true } })
    await this.prisma.calendarChange.deleteMany({
      where: { at: { lt: BigInt(Date.now() - CHANGES_KEPT_MS) } }
    })
    await Promise.all(connected.map((row) => this.sync(row.id)))
  }

  /** Reads a connection's calendars for what changed — one sync at a time for each. */
  sync(connectionId: string): Promise<void> {
    const running = this.syncing.get(connectionId)

    if (running) {
      return running
    }

    const sync = this.syncConnection(connectionId).finally(() => this.syncing.delete(connectionId))
    this.syncing.set(connectionId, sync)
    return sync
  }

  private async syncConnection(connectionId: string): Promise<void> {
    const prisma = this.requirePrisma()
    const provider = await this.providerFor(connectionId)

    if (!provider) {
      return
    }

    try {
      const calendars = await provider.listCalendars()
      const listed = new Set(calendars.map((calendar) => calendar.calendarId))
      const known = await prisma.calendarCalendar.findMany({ where: { connectionId } })

      // A calendar the user no longer shows takes its events with it.
      for (const gone of known.filter((calendar) => !listed.has(calendar.calendarId))) {
        await prisma.$transaction([
          prisma.calendarEvent.deleteMany({ where: { connectionId, calendarId: gone.calendarId } }),
          prisma.calendarCalendar.delete({
            where: { connectionId_calendarId: { connectionId, calendarId: gone.calendarId } }
          })
        ])
      }

      for (const calendar of calendars) {
        const stored = known.find((candidate) => candidate.calendarId === calendar.calendarId)
        await prisma.calendarCalendar.upsert({
          where: { connectionId_calendarId: { connectionId, calendarId: calendar.calendarId } },
          create: {
            connectionId,
            calendarId: calendar.calendarId,
            name: calendar.name,
            isPrimary: calendar.primary ? 1 : 0,
            writable: calendar.writable ? 1 : 0,
            color: calendar.color
          },
          update: {
            name: calendar.name,
            isPrimary: calendar.primary ? 1 : 0,
            writable: calendar.writable ? 1 : 0,
            color: calendar.color
          }
        })
        await this.syncCalendar(provider, connectionId, calendar.calendarId, stored ?? null)
      }

      await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: { lastSyncAt: BigInt(Date.now()), problem: null }
      })
    } catch (error) {
      logMainError('Calendar sync failed', error, { connectionId })
      await prisma.calendarConnection.updateMany({
        where: { id: connectionId },
        data: { problem: error instanceof Error ? error.message : String(error) }
      })
    }

    this.options.send(CALENDAR_IPC.changed, null)
  }

  /**
   * A calendar's events: what changed since the last read, or — the first
   * time, when the token expired, or as the window's end comes near —
   * every one from two months back to a year ahead.
   */
  private async syncCalendar(
    provider: CalendarProvider,
    connectionId: string,
    calendarId: string,
    stored: { syncToken: string | null; windowEnd: bigint | null } | null
  ): Promise<void> {
    const prisma = this.requirePrisma()
    const now = Date.now()
    const fresh =
      stored?.syncToken &&
      stored.windowEnd !== null &&
      Number(stored.windowEnd) - now > WINDOW_MIN_AHEAD_MS

    if (fresh && stored.syncToken) {
      try {
        const { events, syncToken } = await provider.changes(calendarId, {
          syncToken: stored.syncToken
        })
        // What changed since the last read was done elsewhere — or here, and then it is no change.
        await this.applyChanges(connectionId, events, { logChanges: true })
        await prisma.calendarCalendar.update({
          where: { connectionId_calendarId: { connectionId, calendarId } },
          data: { syncToken }
        })
        return
      } catch (error) {
        if (!(error instanceof SyncTokenExpired)) {
          throw error
        }
      }
    }

    const windowEnd = now + WINDOW_AHEAD_MS
    const { events, syncToken } = await provider.changes(calendarId, {
      fromIso: new Date(now - WINDOW_BACK_MS).toISOString(),
      toIso: new Date(windowEnd).toISOString()
    })

    // Kept as read, then what is no longer there goes: an event the Segretario put
    // there keeps saying so, where the provider does not give it back.
    await this.applyChanges(connectionId, events)
    const read = new Set(
      events
        .filter((event) => !event.cancelled)
        .map((event) => eventKey(connectionId, event.calendarId, event.eventId))
    )
    const gone = (
      await prisma.calendarEvent.findMany({
        where: { connectionId, calendarId },
        select: { key: true }
      })
    )
      .map((row) => row.key)
      .filter((key) => !read.has(key))

    for (let at = 0; at < gone.length; at += 500) {
      await prisma.calendarEvent.deleteMany({ where: { key: { in: gone.slice(at, at + 500) } } })
    }

    await prisma.calendarCalendar.update({
      where: { connectionId_calendarId: { connectionId, calendarId } },
      data: { syncToken, windowEnd: BigInt(windowEnd) }
    })
  }

  /**
   * Keeps events as the provider gives them. With `logChanges`, what is
   * new, different or cancelled compared with what was kept is noted in
   * `calendar_changes`, for the Segretario: the app's own writes were kept
   * already, so they show no difference.
   */
  private async applyChanges(
    connectionId: string,
    events: ReadonlyArray<ProviderEvent>,
    options: { logChanges?: boolean } = {}
  ): Promise<void> {
    const prisma = this.requirePrisma()
    const keyOf = (event: ProviderEvent): string =>
      eventKey(connectionId, event.calendarId, event.eventId)
    const kept = options.logChanges
      ? new Map(
          (
            await prisma.calendarEvent.findMany({
              where: { key: { in: events.map(keyOf) } }
            })
          ).map((row) => [row.key, row])
        )
      : new Map<string, CalendarEventRow>()
    const names = options.logChanges
      ? new Map(
          (await prisma.calendarCalendar.findMany({ where: { connectionId } })).map((calendar) => [
            calendar.calendarId,
            calendar.name
          ])
        )
      : new Map<string, string>()
    const snapshot = (event: ProviderEvent): string =>
      JSON.stringify({
        ...event,
        key: keyOf(event),
        connectionId,
        calendarName: names.get(event.calendarId) ?? '',
        startsAt: undefined,
        endsAt: undefined,
        cancelled: undefined
      })
    const now = BigInt(Date.now())
    const writes: Prisma.PrismaPromise<unknown>[] = []

    for (const event of events) {
      const key = keyOf(event)
      const before = kept.get(key)

      if (options.logChanges) {
        const kind = event.cancelled
          ? before
            ? 'annullato'
            : null
          : !before
            ? 'nuovo'
            : differs(before, event)
              ? 'cambiato'
              : null

        if (kind) {
          writes.push(
            prisma.calendarChange.create({
              data: {
                connectionId,
                eventKey: key,
                kind,
                beforeJson: before
                  ? JSON.stringify(eventOfRow(before, names.get(before.calendarId) ?? ''))
                  : null,
                afterJson: event.cancelled ? null : snapshot(event),
                at: now
              }
            })
          )
        }
      }

      if (event.cancelled) {
        writes.push(prisma.calendarEvent.deleteMany({ where: { key } }))
        continue
      }

      const data = {
        connectionId,
        calendarId: event.calendarId,
        eventId: event.eventId,
        iCalUid: event.iCalUid,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay ? 1 : 0,
        startsAt: BigInt(event.startsAt),
        endsAt: BigInt(event.endsAt),
        location: event.location,
        description: event.description,
        attendeesJson: JSON.stringify(event.attendees),
        organizer: event.organizer,
        myResponse: event.myResponse,
        meetLink: event.meetLink,
        htmlLink: event.htmlLink,
        originJson: event.origin ? JSON.stringify(event.origin) : null
      }

      writes.push(
        prisma.calendarEvent.upsert({
          where: { key },
          create: { key, ...data },
          // A provider that does not give the origin back (Graph, as it syncs) leaves it as kept.
          update: { ...data, originJson: data.originJson ?? undefined }
        })
      )
    }

    await prisma.$transaction(writes)
  }

  /** What changed in the calendars elsewhere after a point, the oldest first. */
  async changesSince(afterId: number, limit: number): Promise<CalendarChange[]> {
    const rows = await this.requirePrisma().calendarChange.findMany({
      where: { id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: limit
    })

    return rows.flatMap((row) => {
      const before = row.beforeJson ? (JSON.parse(row.beforeJson) as CalendarEvent) : null
      const after = row.afterJson ? (JSON.parse(row.afterJson) as CalendarEvent) : null
      const event = after ?? before
      return event
        ? [
            {
              id: row.id,
              kind: row.kind as CalendarChange['kind'],
              event,
              before,
              at: Number(row.at)
            }
          ]
        : []
    })
  }

  /** The point the changes noted so far reach. */
  async latestChangeId(): Promise<number> {
    const row = await this.requirePrisma().calendarChange.findFirst({ orderBy: { id: 'desc' } })
    return row?.id ?? 0
  }

  /** The provider a connection speaks through, with its access; null when it is gone. */
  private async providerFor(connectionId: string): Promise<CalendarProvider | null> {
    const connection = await this.requirePrisma().calendarConnection.findUnique({
      where: { id: connectionId }
    })

    if (!connection) {
      return null
    }

    switch (connection.provider as CalendarProviderKind) {
      case 'google':
        return connection.encryptedSecret
          ? new GoogleCalendarProvider(
              this.options.oauth.client(decryptSecret(connection.encryptedSecret)),
              connection.label
            )
          : null
      case 'microsoft': {
        const secret = connection.encryptedSecret

        return secret
          ? new GraphCalendarProvider(
              () =>
                this.options.microsoft.accessToken(
                  decryptSecret(secret),
                  MICROSOFT_GRAPH_SCOPES,
                  async (renewed) => {
                    await this.requirePrisma().calendarConnection.updateMany({
                      where: { id: connectionId },
                      data: { encryptedSecret: encryptSecret(renewed) }
                    })
                  }
                ),
              connection.label,
              this.options.fetch
            )
          : null
      }
      case 'caldav':
        return connection.encryptedSecret && connection.serverUrl && connection.username
          ? new CalDavCalendarProvider({
              serverUrl: connection.serverUrl,
              username: connection.username,
              password: decryptSecret(connection.encryptedSecret),
              fetch: this.options.fetch,
              store: this.objectStore(connectionId)
            })
          : null
      case 'ics':
        return connection.encryptedSecret
          ? new IcsCalendarProvider(
              decryptSecret(connection.encryptedSecret),
              connection.label,
              this.options.fetch
            )
          : null
      default:
        return null
    }
  }

  /** The events between two instants, every connected calendar's, in order. */
  async events(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
    const prisma = this.requirePrisma()
    const [rows, calendars] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          startsAt: { lt: BigInt(Date.parse(toIso)) },
          endsAt: { gt: BigInt(Date.parse(fromIso)) }
        },
        orderBy: [{ startsAt: 'asc' }, { title: 'asc' }]
      }),
      prisma.calendarCalendar.findMany()
    ])
    const names = new Map(
      calendars.map((calendar) => [
        `${calendar.connectionId}\u0000${calendar.calendarId}`,
        calendar.name
      ])
    )

    return rows.map((row) =>
      eventOfRow(row, names.get(`${row.connectionId}\u0000${row.calendarId}`) ?? '')
    )
  }

  /**
   * The event an invitation is for, in any calendar connected — the one
   * that came with the mail's account first — the earliest instance of a
   * series still to come.
   */
  async eventByUid(iCalUid: string, mailAccountId: string | null): Promise<CalendarEvent | null> {
    const prisma = this.requirePrisma()
    const [rows, own] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { iCalUid, endsAt: { gt: BigInt(Date.now()) } },
        orderBy: { startsAt: 'asc' }
      }),
      mailAccountId
        ? prisma.calendarConnection.findMany({ where: { mailAccountId }, select: { id: true } })
        : Promise.resolve([])
    ])
    const ownIds = new Set(own.map((connection) => connection.id))
    const row = rows.find((candidate) => ownIds.has(candidate.connectionId)) ?? rows[0]

    if (!row) {
      return null
    }

    const calendar = await prisma.calendarCalendar.findUnique({
      where: {
        connectionId_calendarId: { connectionId: row.connectionId, calendarId: row.calendarId }
      }
    })
    return eventOfRow(row, calendar?.name ?? '')
  }

  async respond(
    key: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findUnique({ where: { key } })
    const provider = row ? await this.providerFor(row.connectionId) : null

    if (!row || !provider) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    const answered = await provider.respond(row.calendarId, row.eventId, response)
    await this.applyChanges(row.connectionId, [answered])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.eventOrThrow(eventKey(row.connectionId, row.calendarId, answered.eventId))
  }

  /** Every connected calendar, the main ones first: for the Calendario app and the Segretario. */
  async calendars(): Promise<CalendarListEntry[]> {
    const prisma = this.requirePrisma()
    const [rows, connections] = await Promise.all([
      prisma.calendarCalendar.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] }),
      prisma.calendarConnection.findMany({ select: { id: true, label: true } })
    ])
    const labels = new Map(connections.map((connection) => [connection.id, connection.label]))

    return rows.map((row) => ({
      key: calendarKey(row.connectionId, row.calendarId),
      connectionId: row.connectionId,
      connection: labels.get(row.connectionId) ?? '',
      name: row.name,
      primary: row.isPrimary === 1,
      writable: row.writable === 1,
      color: row.color,
      hidden: row.hidden === 1
    }))
  }

  /** Shows or hides a calendar's events in the Calendario app: a choice of this computer's. */
  async setCalendarHidden(key: string, hidden: boolean): Promise<CalendarListEntry[]> {
    const prisma = this.requirePrisma()
    const calendar = (await prisma.calendarCalendar.findMany()).find(
      (candidate) => calendarKey(candidate.connectionId, candidate.calendarId) === key
    )

    if (!calendar) {
      throw new Error('Questo calendario non è più collegato.')
    }

    await prisma.calendarCalendar.update({
      where: {
        connectionId_calendarId: {
          connectionId: calendar.connectionId,
          calendarId: calendar.calendarId
        }
      },
      data: { hidden: hidden ? 1 : 0 }
    })
    this.options.send(CALENDAR_IPC.changed, null)
    return this.calendars()
  }

  /** An event by its key, as it is now; null when it is no longer in the calendar. */
  async event(key: string): Promise<CalendarEvent | null> {
    return this.eventOrThrow(key).catch(() => null)
  }

  /** Adds an event to a calendar; whoever is invited gets the provider's invitation. */
  async create(event: NewCalendarEvent): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const calendar = (await prisma.calendarCalendar.findMany()).find(
      (candidate) => calendarKey(candidate.connectionId, candidate.calendarId) === event.calendarKey
    )
    const provider = calendar ? await this.providerFor(calendar.connectionId) : null

    if (!provider || !calendar) {
      throw new Error('Questo calendario non è più collegato.')
    }

    if (calendar.writable !== 1) {
      throw new Error(`Nel calendario «${calendar.name}» non si possono aggiungere eventi.`)
    }

    const created = await provider.create(calendar.calendarId, event, event.origin ?? null)
    await this.applyChanges(calendar.connectionId, [created])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.eventOrThrow(eventKey(calendar.connectionId, calendar.calendarId, created.eventId))
  }

  /** Changes an event as given; whoever is invited, before or now, is told. */
  async update(key: string, change: EventChange): Promise<CalendarEvent> {
    const { row, provider } = await this.writable(key)
    const current = {
      ...(await this.eventOrThrow(key)),
      startsAt: Number(row.startsAt),
      endsAt: Number(row.endsAt)
    }
    const next = changedEvent(current, change)
    const notify = next.attendees.length > 0 || current.attendees.some((attendee) => !attendee.self)
    const updated = await provider.update(row.calendarId, row.eventId, next, notify)

    await this.applyChanges(row.connectionId, [updated])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.eventOrThrow(key)
  }

  /** Takes an event away; whoever is invited is told. */
  async remove(key: string): Promise<void> {
    const { row, provider } = await this.writable(key)
    const attendees = JSON.parse(row.attendeesJson) as CalendarAttendee[]

    await provider.remove(
      row.calendarId,
      row.eventId,
      attendees.some((attendee) => !attendee.self)
    )
    await this.requirePrisma().calendarEvent.deleteMany({ where: { key } })
    this.options.send(CALENDAR_IPC.changed, null)
  }

  /** An event, with the provider to write it through. */
  private async writable(
    key: string
  ): Promise<{ row: CalendarEventRow; provider: CalendarProvider }> {
    const row = await this.requirePrisma().calendarEvent.findUnique({ where: { key } })
    const provider = row ? await this.providerFor(row.connectionId) : null

    if (!row || !provider) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    return { row, provider }
  }

  private async eventOrThrow(key: string): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findUnique({ where: { key } })

    if (!row) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    const calendar = await prisma.calendarCalendar.findUnique({
      where: {
        connectionId_calendarId: { connectionId: row.connectionId, calendarId: row.calendarId }
      }
    })
    return eventOfRow(row, calendar?.name ?? '')
  }
}
