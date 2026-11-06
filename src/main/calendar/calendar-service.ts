import type { CalendarEvent as CalendarEventRow, Prisma, PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import type { BrowserWindow } from 'electron'

import type { GoogleOAuthService } from '@main/services/google-oauth'
import {
  MICROSOFT_CALENDAR_SCOPES,
  MICROSOFT_MAILBOX_SETTINGS_SCOPES,
  MicrosoftSignInNeeded,
  type MicrosoftOAuthService
} from '@main/services/microsoft-oauth'
import { decryptSecret, encryptSecret } from '@main/services/secure-storage'
import { logMainError } from '@main/utils/error-utils'
import {
  CALENDAR_IPC,
  calendarKey,
  calendarSearchWords,
  type CalendarAttendee,
  type CalendarChange,
  type CalendarConnection,
  type CalendarListEntry,
  type CalendarEvent,
  type CalendarProviderKind,
  type CalendarResponse,
  type CalendarSearchQuery,
  type CalendarSearchResult,
  type EventChange,
  type EventOrigin,
  type NewCalendarEvent
} from '@shared/calendar'
import type { MailAccount } from '@shared/models'

import {
  changedEvent,
  changedFields,
  differingFields,
  eventInput,
  SyncTokenExpired,
  type CalendarProvider,
  type ProviderEvent
} from './calendar-provider'
import {
  CalDavCalendarProvider,
  type CalendarObjectStore,
  type StoredObject
} from './caldav-calendar'
import {
  DEFAULT_SEARCH_LIMIT,
  eventSearchText,
  findEvents,
  type IndexedEvent
} from './event-search'
import {
  addressOrNull,
  invitationEvent,
  invitedAddresses,
  organizedByUser,
  ownAddresses
} from './event-roles'
import { GOOGLE_CALENDAR_SCOPE, GoogleCalendarProvider } from './google-calendar'
import { GraphCalendarProvider, MAILBOX_ZONE_NOT_GRANTED } from './graph-calendar'
import { calendarNameOf, canonicalUid, type InvitationInstance } from './icalendar'
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
  /** A connection was taken away, with its calendars' names: what was kept about it goes too. */
  onDisconnected?(connectionId: string, calendarNames: string[]): void
}

/** Whether two addresses are the same mailbox: the case of an address does not matter. */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function eventKey(connectionId: string, calendarId: string, eventId: string): string {
  return `${connectionId}\u0000${calendarId}\u0000${eventId}`
}

/** The connection an event's key, or a calendar's (`calendarKey`), begins with. */
function connectionOfKey(key: string): string {
  const end = key.indexOf('\u0000')
  return end < 0 ? key : key.slice(0, end)
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
 * An event as kept. With the user's addresses, it says too whether the
 * user organises it; what is kept of an event as it was, for the
 * Segretario, does not.
 */
function eventOfRow(
  row: CalendarEventRow,
  calendarName: string,
  addresses?: ReadonlySet<string>
): CalendarEvent {
  const event: CalendarEvent = {
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

  return addresses ? { ...event, organizedByUser: organizedByUser(event, addresses) } : event
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
  /** The sync of each connection asked for, under way or waiting its turn: one each. */
  private readonly syncing = new Map<string, Promise<void>>()
  /** What each connection is doing, last in line: syncs and writes take their turn. */
  private readonly turns = new Map<string, Promise<unknown>>()
  /** Connections being taken away: their sync stops, and none starts. */
  private readonly leaving = new Set<string>()
  /**
   * Whether each CalDAV connection's server schedules — sends invitations
   * and answers itself — as its last sync found: a calendar there takes an
   * answer only when it does.
   */
  private readonly scheduling = new Map<string, boolean>()
  /** The user's addresses on each CalDAV server, as its last sync found them. */
  private readonly davAddresses = new Map<string, ReadonlyArray<string>>()
  /**
   * Every event kept, as searches read it: made at the first search after
   * the events change, and dropped as soon as they do (`eventsChanged`).
   */
  private searchIndex: Promise<IndexedEvent[]> | null = null

  constructor(private readonly options: CalendarServiceOptions) {}

  private readonly opened = (() => {
    const opened = Promise.withResolvers<void>()
    // Rejected when the app could not start: whoever waits is told, nobody else must listen.
    opened.promise.catch(() => undefined)
    return opened
  })()

  async open(): Promise<void> {
    try {
      this.prisma = await this.options.database.storeClient()
    } catch (error) {
      this.abandon(error)
      throw error
    }

    this.timer = setInterval(() => void this.syncAll(), SYNC_EVERY_MS)
    this.opened.resolve()
    void this.syncAll()
  }

  /** The app could not start: what waits for the calendar is told so, rather than left waiting. */
  abandon(error: unknown): void {
    this.opened.reject(error instanceof Error ? error : new Error(String(error)))
  }

  /** Resolves once the calendars are open: what asks for them waits until then. */
  whenOpen(): Promise<void> {
    return this.opened.promise
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Runs `work` on a connection when what it is doing is done — a sync, a
   * write — and holds the next until it is: a sync never reads an event
   * while it is written, nor a write lands after the connection is gone.
   */
  private inTurn<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.turns.get(connectionId) ?? Promise.resolve()).then(work)
    const done = run.then(
      () => undefined,
      () => undefined
    )

    this.turns.set(connectionId, done)
    void done.then(() => {
      if (this.turns.get(connectionId) === done) {
        this.turns.delete(connectionId)
      }
    })
    return run
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
    const granted = await this.options.microsoft.authorize(account?.email, {
      mail: false,
      calendar: true
    })

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
    const names = (
      await prisma.calendarCalendar.findMany({ where: { connectionId }, select: { name: true } })
    ).map((calendar) => calendar.name)
    // A sync under way stops at its next calendar; it, and a write under way, end before
    // anything is forgotten, and what waits after finds the connection gone.
    this.leaving.add(connectionId)

    try {
      await this.inTurn(connectionId, () =>
        prisma.$transaction([
          prisma.calendarChange.deleteMany({ where: { connectionId } }),
          prisma.calendarEvent.deleteMany({ where: { connectionId } }),
          prisma.calendarObject.deleteMany({ where: { connectionId } }),
          prisma.calendarCalendar.deleteMany({ where: { connectionId } }),
          prisma.calendarConnection.deleteMany({ where: { id: connectionId } })
        ])
      )
      this.eventsChanged()
    } finally {
      this.leaving.delete(connectionId)
      this.scheduling.delete(connectionId)
      this.davAddresses.delete(connectionId)
    }

    this.options.send(CALENDAR_IPC.changed, null)
    this.options.onDisconnected?.(connectionId, names)
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
    this.eventsChanged()
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

  /**
   * Reads a connection's calendars for what changed, in its turn: one sync
   * asked for at a time, which those asking meanwhile wait for.
   */
  sync(connectionId: string): Promise<void> {
    const asked = this.syncing.get(connectionId)

    if (asked) {
      return asked
    }

    if (this.leaving.has(connectionId)) {
      return Promise.resolve()
    }

    const sync = this.inTurn(connectionId, () => this.syncConnection(connectionId)).finally(() =>
      this.syncing.delete(connectionId)
    )
    this.syncing.set(connectionId, sync)
    return sync
  }

  /**
   * A sync: only in the connection's turn. However it ends, the connection
   * says so — read now, or why not — so nothing waits on it unanswered.
   */
  private async syncConnection(connectionId: string): Promise<void> {
    const prisma = this.requirePrisma()

    try {
      const provider = await this.providerFor(connectionId)

      if (!provider) {
        throw new Error('Manca l’accesso a questo calendario: scollegalo e collegalo di nuovo.')
      }

      const calendars = await provider.listCalendars()
      const listed = new Set(calendars.map((calendar) => calendar.calendarId))
      const known = await prisma.calendarCalendar.findMany({ where: { connectionId } })

      // A calendar the user no longer shows takes its events with it, and what was kept to sync it.
      for (const gone of known.filter((calendar) => !listed.has(calendar.calendarId))) {
        await prisma.$transaction([
          prisma.calendarEvent.deleteMany({ where: { connectionId, calendarId: gone.calendarId } }),
          prisma.calendarObject.deleteMany({
            where: { connectionId, calendarId: gone.calendarId }
          }),
          prisma.calendarCalendar.delete({
            where: { connectionId_calendarId: { connectionId, calendarId: gone.calendarId } }
          })
        ])
        this.eventsChanged()
      }

      // What the connection says is wrong, while it syncs all it can: a calendar that cannot be
      // read says so, and the others are read all the same.
      const problems: string[] = []

      // What the server is, for answering there and for knowing the user among the guests. A
      // server that could not say whether it schedules is asked again at the next sync; until
      // then it stands as it last said.
      if (provider instanceof CalDavCalendarProvider && calendars[0]) {
        this.davAddresses.set(connectionId, await provider.addresses())

        try {
          this.scheduling.set(connectionId, await provider.schedules(calendars[0].calendarId))
        } catch (error) {
          logMainError('A CalDAV server did not say whether it schedules', error, { connectionId })
          problems.push(error instanceof Error ? error.message : String(error))
        }
      }

      // Connected before the mailbox's time zone was asked for: it syncs, and asks to be
      // connected again before its all-day events can be written.
      if (provider instanceof GraphCalendarProvider && !(await provider.mailboxZoneGranted())) {
        problems.push(MAILBOX_ZONE_NOT_GRANTED)
      }

      for (const calendar of calendars) {
        if (this.leaving.has(connectionId)) {
          return
        }

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
        try {
          await this.syncCalendar(provider, connectionId, calendar.calendarId, stored ?? null)
        } catch (error) {
          logMainError('A calendar could not be read', error, {
            connectionId,
            calendarId: calendar.calendarId
          })
          problems.push(
            `«${calendar.name}» non si legge: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: BigInt(Date.now()),
          problem: problems.length > 0 ? problems.join(' ') : null
        }
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
        const { events, syncToken, commit } = await provider.changes(calendarId, {
          syncToken: stored.syncToken
        })
        // What changed since the last read was done elsewhere — or here, and then it is no change.
        await this.applyChanges(connectionId, events, { logChanges: true })
        await commit?.()
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
    const { events, syncToken, commit } = await provider.changes(calendarId, {
      fromIso: new Date(now - WINDOW_BACK_MS).toISOString(),
      toIso: new Date(windowEnd).toISOString()
    })

    // Kept as read, then what is no longer there goes: an event the Segretario put
    // there keeps saying so, where the provider does not give it back. A calendar read
    // before is compared with what it was — a link is read whole each time it changes, an
    // expired token starts over — so what changed elsewhere is noted all the same; the
    // first read of a calendar is no change.
    const readBefore = stored !== null && stored.windowEnd !== null
    await this.applyChanges(connectionId, events, { logChanges: readBefore })
    const read = new Set(
      events
        .filter((event) => !event.cancelled)
        .map((event) => eventKey(connectionId, event.calendarId, event.eventId))
    )
    const windowStart = now - WINDOW_BACK_MS
    const gone = (
      await prisma.calendarEvent.findMany({ where: { connectionId, calendarId } })
    ).filter((row) => !read.has(row.key))

    if (readBefore) {
      const name =
        (
          await prisma.calendarCalendar.findUnique({
            where: { connectionId_calendarId: { connectionId, calendarId } },
            select: { name: true }
          })
        )?.name ?? ''
      // Only an event that should still be read is gone: one that ended before the window
      // merely left it, and one beyond it — moved there, or changed there, and so kept —
      // was not read.
      const cancelled = gone.filter(
        (row) => Number(row.endsAt) > windowStart && Number(row.startsAt) < windowEnd
      )

      for (let at = 0; at < cancelled.length; at += 500) {
        await prisma.calendarChange.createMany({
          data: cancelled.slice(at, at + 500).map((row) => ({
            connectionId,
            eventKey: row.key,
            kind: 'annullato',
            beforeJson: JSON.stringify(eventOfRow(row, name)),
            afterJson: null,
            at: BigInt(Date.now())
          }))
        })
      }
    }

    const goneKeys = gone.map((row) => row.key)

    for (let at = 0; at < goneKeys.length; at += 500) {
      await prisma.calendarEvent.deleteMany({
        where: { key: { in: goneKeys.slice(at, at + 500) } }
      })
    }

    if (goneKeys.length > 0) {
      this.eventsChanged()
    }

    await commit?.()

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
        iCalUid: event.iCalUid ? canonicalUid(event.iCalUid) : null,
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

    if (events.length > 0) {
      this.eventsChanged()
    }
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

        if (!secret) {
          return null
        }

        const token = (scopes: ReadonlyArray<string>): Promise<string> =>
          this.options.microsoft.accessToken(decryptSecret(secret), scopes, async (renewed) => {
            await this.requirePrisma().calendarConnection.updateMany({
              where: { id: connectionId },
              data: { encryptedSecret: encryptSecret(renewed) }
            })
          })

        return new GraphCalendarProvider(
          {
            calendar: () => token(MICROSOFT_CALENDAR_SCOPES),
            // A calendar connected before the time zone was asked for has no consent to it.
            mailboxSettings: () =>
              token(MICROSOFT_MAILBOX_SETTINGS_SCOPES).catch((error: unknown) => {
                if (error instanceof MicrosoftSignInNeeded) {
                  return null
                }

                throw error
              })
          },
          connection.label,
          this.options.fetch
        )
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

  /**
   * The user's addresses (`ownAddresses`); and with them the calendars they
   * write in that go by an address — a colleague's shared with them, a
   * Google secondary calendar — whose events they may change as the
   * calendar (`writing`).
   */
  private async userAddresses(): Promise<{ own: Set<string>; writing: Set<string> }> {
    const prisma = this.requirePrisma()
    const [accounts, connections, writable] = await Promise.all([
      this.options.database.getAccounts(),
      prisma.calendarConnection.findMany({
        select: { provider: true, label: true, username: true }
      }),
      prisma.calendarCalendar.findMany({ where: { writable: 1 }, select: { calendarId: true } })
    ])
    const own = ownAddresses(
      accounts.map((account) => account.email),
      connections,
      [...this.davAddresses.values()]
    )

    return {
      own,
      writing: new Set([
        ...own,
        ...writable.flatMap((calendar) => addressOrNull(calendar.calendarId) ?? [])
      ])
    }
  }

  /**
   * Whether a connection's calendars tell the organizer of an answer, and
   * the guests of a change: Google and Microsoft do; a CalDAV server when
   * it says it schedules; a link is only read.
   */
  private schedules(provider: string, connectionId: string): boolean {
    switch (provider as CalendarProviderKind) {
      case 'google':
      case 'microsoft':
        return true
      case 'caldav':
        return this.scheduling.get(connectionId) === true
      default:
        return false
    }
  }

  /** The events between two instants, every connected calendar's, in order. */
  async events(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
    const prisma = this.requirePrisma()
    const [rows, calendars, addresses] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          startsAt: { lt: BigInt(Date.parse(toIso)) },
          endsAt: { gt: BigInt(Date.parse(fromIso)) }
        },
        orderBy: [{ startsAt: 'asc' }, { title: 'asc' }]
      }),
      prisma.calendarCalendar.findMany(),
      this.userAddresses()
    ])
    const names = new Map(
      calendars.map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar.name
      ])
    )

    return rows.map((row) =>
      eventOfRow(
        row,
        names.get(calendarKey(row.connectionId, row.calendarId)) ?? '',
        addresses.writing
      )
    )
  }

  /**
   * The events kept — the past the calendars still hold and the year ahead
   * — that have every word searched for, case and accents aside: the ones
   * to come first, the soonest first, then the past, the latest first
   * (`findEvents`). For the Calendario's search and the Segretario's.
   */
  async search(query: CalendarSearchQuery): Promise<CalendarSearchResult> {
    const prisma = this.requirePrisma()
    const words = calendarSearchWords(query.text)

    if (words.length === 0) {
      return { upcoming: [], past: [], more: 0 }
    }

    const [index, calendars] = await Promise.all([
      this.indexed(),
      prisma.calendarCalendar.findMany()
    ])
    const names = new Map(
      calendars.map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar.name
      ])
    )
    const found = findEvents(
      index,
      names,
      {
        words,
        from: query.fromIso === undefined ? undefined : Date.parse(query.fromIso),
        to: query.toIso === undefined ? undefined : Date.parse(query.toIso),
        calendarKeys: query.calendarKeys ? new Set(query.calendarKeys) : undefined,
        limit: query.limit ?? DEFAULT_SEARCH_LIMIT
      },
      Date.now()
    )
    const [rows, addresses] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { key: { in: [...found.upcoming, ...found.past].map((event) => event.key) } }
      }),
      this.userAddresses()
    ])
    const rowsByKey = new Map(rows.map((row) => [row.key, row]))
    // Read as they are now: one taken away since the index was made is left out.
    const kept = (events: ReadonlyArray<IndexedEvent>): CalendarEvent[] =>
      events.flatMap((event) => {
        const row = rowsByKey.get(event.key)
        return row ? [eventOfRow(row, names.get(event.calendarKey) ?? '', addresses.writing)] : []
      })

    return { upcoming: kept(found.upcoming), past: kept(found.past), more: found.more }
  }

  /** Every event kept, as searches read it: made once, until the events change. */
  private indexed(): Promise<IndexedEvent[]> {
    if (this.searchIndex) {
      return this.searchIndex
    }

    const made = this.requirePrisma()
      .calendarEvent.findMany({
        select: {
          key: true,
          connectionId: true,
          calendarId: true,
          startsAt: true,
          endsAt: true,
          title: true,
          location: true,
          description: true,
          attendeesJson: true,
          organizer: true
        }
      })
      .then((rows) =>
        rows.map((row) => ({
          key: row.key,
          calendarKey: calendarKey(row.connectionId, row.calendarId),
          startsAt: Number(row.startsAt),
          endsAt: Number(row.endsAt),
          title: row.title,
          text: eventSearchText({
            ...row,
            attendees: JSON.parse(row.attendeesJson) as CalendarAttendee[]
          })
        }))
      )

    this.searchIndex = made
    // A read that failed is not kept: the next search reads again.
    made.catch(() => {
      if (this.searchIndex === made) {
        this.searchIndex = null
      }
    })
    return made
  }

  /**
   * The events kept changed: what searches read of them is made again at
   * the next one. A read under way when they change is not kept either.
   */
  private eventsChanged(): void {
    this.searchIndex = null
  }

  /**
   * The event an invitation that came to a mail account is for, in any
   * calendar connected — of a whole series its next instance, of one
   * instance (`instance`) that one — where the user answers it as the one
   * it was sent to: a calendar of theirs they write in, which tells the
   * organizer; the one that came with the mail's account first, its main
   * calendar first. Else the user's own copy of an event they organise.
   * Else none: the answer goes to the organizer by mail.
   */
  async eventByUid(
    iCalUid: string,
    mailAccountId: string | null,
    instance: InvitationInstance | null = null
  ): Promise<CalendarEvent | null> {
    const prisma = this.requirePrisma()
    const [rows, connections, calendars, addresses, accounts] = await Promise.all([
      prisma.calendarEvent.findMany({ where: { iCalUid: canonicalUid(iCalUid) } }),
      prisma.calendarConnection.findMany({
        select: { id: true, provider: true, mailAccountId: true }
      }),
      prisma.calendarCalendar.findMany(),
      this.userAddresses(),
      this.options.database.getAccounts()
    ])
    const invited = invitedAddresses(
      accounts.find((account) => account.id === mailAccountId)?.email ?? null,
      [...this.davAddresses.values()]
    )
    const connectionsById = new Map(connections.map((connection) => [connection.id, connection]))
    const calendarsByKey = new Map(
      calendars.map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar
      ])
    )
    const chosen = invitationEvent(
      rows.flatMap((row) => {
        const connection = connectionsById.get(row.connectionId)
        const calendar = calendarsByKey.get(calendarKey(row.connectionId, row.calendarId))
        const event = calendar ? eventOfRow(row, calendar.name, addresses.writing) : null

        return connection && calendar && event
          ? [
              {
                found: event,
                event: { ...event, startsAt: Number(row.startsAt), endsAt: Number(row.endsAt) },
                answerable:
                  calendar.writable === 1 && this.schedules(connection.provider, connection.id),
                primary: calendar.isPrimary === 1,
                sameAccount: mailAccountId !== null && connection.mailAccountId === mailAccountId
              }
            ]
          : []
      }),
      instance,
      { own: addresses.own, invited },
      Date.now()
    )

    return chosen?.found ?? null
  }

  async respond(
    key: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    options: { series?: boolean } = {}
  ): Promise<CalendarEvent> {
    return this.inTurn(connectionOfKey(key), async () => {
      const row = await this.requirePrisma().calendarEvent.findUnique({ where: { key } })
      const provider = row ? await this.providerFor(row.connectionId) : null

      if (!row || !provider) {
        throw new Error('L’evento non c’è più nel calendario.')
      }

      const series = options.series === true
      const answered = await provider.respond(row.calendarId, row.eventId, response, series)

      if (series) {
        // The series answered: its instances, kept one by one, are read again as they are
        // now — by a read that begins after the answer, not by one that began before it.
        await this.syncConnection(row.connectionId)
        return this.eventOrThrow(key)
      }

      await this.applyChanges(row.connectionId, [answered])
      this.options.send(CALENDAR_IPC.changed, null)
      return this.eventOrThrow(eventKey(row.connectionId, row.calendarId, answered.eventId))
    })
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
    return this.inTurn(connectionOfKey(event.calendarKey), async () => {
      const prisma = this.requirePrisma()
      const calendar = (await prisma.calendarCalendar.findMany()).find(
        (candidate) =>
          calendarKey(candidate.connectionId, candidate.calendarId) === event.calendarKey
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
      return this.eventOrThrow(
        eventKey(calendar.connectionId, calendar.calendarId, created.eventId)
      )
    })
  }

  /**
   * Changes an event as given — only what really changes, the rest left as
   * the provider has it — and whoever is invited, before or now, is told.
   */
  async update(key: string, change: EventChange): Promise<CalendarEvent> {
    return this.inTurn(connectionOfKey(key), async () => {
      const { row, provider } = await this.changeable(key)
      const current = {
        ...(await this.eventOrThrow(key)),
        startsAt: Number(row.startsAt),
        endsAt: Number(row.endsAt)
      }
      const next = changedEvent(current, change)
      const fields = differingFields(eventInput(current), next, changedFields(change))

      if (fields.size === 0) {
        return this.eventOrThrow(key)
      }

      const notify =
        next.attendees.length > 0 || current.attendees.some((attendee) => !attendee.self)
      const updated = await provider.update(row.calendarId, row.eventId, next, notify, fields)

      await this.applyChanges(row.connectionId, [updated])
      this.options.send(CALENDAR_IPC.changed, null)
      return this.eventOrThrow(key)
    })
  }

  /** Takes an event away; whoever is invited is told. */
  async remove(key: string): Promise<void> {
    return this.inTurn(connectionOfKey(key), async () => {
      const { row, provider } = await this.changeable(key)
      const attendees = JSON.parse(row.attendeesJson) as CalendarAttendee[]

      await provider.remove(
        row.calendarId,
        row.eventId,
        attendees.some((attendee) => !attendee.self)
      )
      await this.requirePrisma().calendarEvent.deleteMany({ where: { key } })
      this.eventsChanged()
      this.options.send(CALENDAR_IPC.changed, null)
    })
  }

  /**
   * An event the user may change, with the provider to write it through:
   * one they are invited to is answered, not changed — changed, it would be
   * their copy alone, and the organizer would never know.
   */
  private async changeable(
    key: string
  ): Promise<{ row: CalendarEventRow; provider: CalendarProvider }> {
    const row = await this.requirePrisma().calendarEvent.findUnique({ where: { key } })
    const provider = row ? await this.providerFor(row.connectionId) : null

    if (!row || !provider) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    const event = eventOfRow(row, '')

    if (!organizedByUser(event, (await this.userAddresses()).writing)) {
      throw new Error(
        `«${row.title}» lo organizza ${event.organizer ?? 'un’altra persona'}: all’invito si risponde, non si cambia.`
      )
    }

    return { row, provider }
  }

  private async eventOrThrow(key: string): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findUnique({ where: { key } })

    if (!row) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    const [calendar, addresses] = await Promise.all([
      prisma.calendarCalendar.findUnique({
        where: {
          connectionId_calendarId: { connectionId: row.connectionId, calendarId: row.calendarId }
        }
      }),
      this.userAddresses()
    ])
    return eventOfRow(row, calendar?.name ?? '', addresses.writing)
  }
}
