import type { CalendarEvent as CalendarEventRow, PrismaClient } from '@prisma/client'
import type { BrowserWindow } from 'electron'

import type { GoogleOAuthService } from '@main/services/google-oauth'
import { decryptSecret, encryptSecret } from '@main/services/secure-storage'
import { logMainError } from '@main/utils/error-utils'
import {
  CALENDAR_IPC,
  type CalendarAttendee,
  type CalendarConnection,
  type CalendarEvent,
  type CalendarResponse,
  type NewCalendarEvent
} from '@shared/calendar'
import type { MailAccount } from '@shared/models'

import { SyncTokenExpired, type CalendarProvider, type ProviderEvent } from './calendar-provider'
import { GOOGLE_CALENDAR_SCOPE, GoogleCalendarProvider } from './google-calendar'

/** How often the calendars are read again for what changed. */
const SYNC_EVERY_MS = 5 * 60 * 1000
/** How far back the events are kept: last weeks' meetings still matter to the mail about them. */
const WINDOW_BACK_MS = 60 * 24 * 60 * 60 * 1000
/** How far ahead they are read. */
const WINDOW_AHEAD_MS = 365 * 24 * 60 * 60 * 1000
/** Less than this ahead, the window is read again from today, so the months coming are in it. */
const WINDOW_MIN_AHEAD_MS = 180 * 24 * 60 * 60 * 1000

export interface CalendarServiceOptions {
  database: {
    storeClient(): Promise<PrismaClient>
    getAccounts(): Promise<MailAccount[]>
  }
  oauth: GoogleOAuthService
  /** Sends an event to the window. */
  send(channel: string, payload: unknown): void
  parentWindow(): BrowserWindow | null
}

function eventKey(accountId: string, calendarId: string, eventId: string): string {
  return `${accountId}\u0000${calendarId}\u0000${eventId}`
}

function eventOfRow(row: CalendarEventRow, calendarName: string): CalendarEvent {
  return {
    key: row.key,
    accountId: row.accountId,
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
    htmlLink: row.htmlLink
  }
}

/**
 * The calendars of the user's accounts, kept here in step with their
 * provider: connected one account at a time — the user grants it in
 * Google's own window — read again every few minutes for what changed,
 * and read by the day's page, the reader and the Segretario from here.
 * A calendar has its own token: the account's mail never depends on it.
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

  /** Every account whose calendar can be connected, and how each stands. */
  async listConnections(): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const [accounts, connected, calendars] = await Promise.all([
      this.options.database.getAccounts(),
      prisma.calendarAccount.findMany(),
      prisma.calendarCalendar.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] })
    ])

    return accounts
      .filter((account) => account.type === 'gmail')
      .map((account) => {
        const row = connected.find((candidate) => candidate.accountId === account.id)
        return {
          accountId: account.id,
          email: account.email,
          state: row ? 'connected' : 'available',
          lastSyncAt: row?.lastSyncAt ? Number(row.lastSyncAt) : null,
          problem: row?.problem ?? null,
          calendars: calendars
            .filter((calendar) => calendar.accountId === account.id)
            .map((calendar) => ({
              accountId: account.id,
              calendarId: calendar.calendarId,
              name: calendar.name,
              primary: calendar.isPrimary === 1
            }))
        }
      })
  }

  /**
   * Asks Google for the account's calendar, in Google's window, the account
   * already chosen; resolves once its events are in.
   */
  async connect(accountId: string): Promise<CalendarConnection[]> {
    const account = (await this.options.database.getAccounts()).find(
      (candidate) => candidate.id === accountId
    )

    if (!account || account.type !== 'gmail') {
      throw new Error('Il calendario si collega per un account Google.')
    }

    const granted = await this.options.oauth.authorize(this.options.parentWindow() ?? undefined, {
      scopes: [GOOGLE_CALENDAR_SCOPE],
      loginHint: account.email,
      title: `Collega il calendario di ${account.email}`
    })

    if (granted.email.toLowerCase() !== account.email.toLowerCase()) {
      throw new Error(
        `Hai scelto ${granted.email} in Google: per questo calendario serve ${account.email}.`
      )
    }

    if (!granted.scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
      throw new Error(
        "Google non ha dato l'accesso al calendario: rifallo lasciando selezionata la casella del calendario."
      )
    }

    const now = BigInt(Date.now())
    const encryptedToken = encryptSecret(granted.refreshToken)

    await this.requirePrisma().calendarAccount.upsert({
      where: { accountId },
      create: { accountId, encryptedToken, connectedAt: now },
      update: { encryptedToken, connectedAt: now, problem: null }
    })
    await this.sync(accountId)
    return this.listConnections()
  }

  /** Forgets an account's calendar here; Google keeps it as it is. */
  async disconnect(accountId: string): Promise<CalendarConnection[]> {
    await this.forgetAccount(accountId)
    this.options.send(CALENDAR_IPC.changed, null)
    return this.listConnections()
  }

  /** An account removed, or its calendar disconnected: what was kept of it goes. */
  async forgetAccount(accountId: string): Promise<void> {
    const prisma = this.requirePrisma()

    await prisma.$transaction([
      prisma.calendarEvent.deleteMany({ where: { accountId } }),
      prisma.calendarCalendar.deleteMany({ where: { accountId } }),
      prisma.calendarAccount.deleteMany({ where: { accountId } })
    ])
  }

  /** "Elimina tutti i dati": the events go, the connections stay and read them anew. */
  async clearData(): Promise<void> {
    const prisma = this.requirePrisma()

    await prisma.$transaction([
      prisma.calendarEvent.deleteMany(),
      prisma.calendarCalendar.deleteMany()
    ])
    void this.syncAll()
  }

  async syncAll(): Promise<void> {
    if (!this.prisma) {
      return
    }

    const connected = await this.prisma.calendarAccount.findMany({ select: { accountId: true } })
    await Promise.all(connected.map((row) => this.sync(row.accountId)))
  }

  /** Reads an account's calendars for what changed — one sync at a time for each account. */
  sync(accountId: string): Promise<void> {
    const running = this.syncing.get(accountId)

    if (running) {
      return running
    }

    const sync = this.syncAccount(accountId).finally(() => this.syncing.delete(accountId))
    this.syncing.set(accountId, sync)
    return sync
  }

  private async syncAccount(accountId: string): Promise<void> {
    const prisma = this.requirePrisma()
    const provider = await this.providerFor(accountId)

    if (!provider) {
      return
    }

    try {
      const calendars = await provider.listCalendars()
      const listed = new Set(calendars.map((calendar) => calendar.calendarId))
      const known = await prisma.calendarCalendar.findMany({ where: { accountId } })

      // A calendar the user no longer shows takes its events with it.
      for (const gone of known.filter((calendar) => !listed.has(calendar.calendarId))) {
        await prisma.$transaction([
          prisma.calendarEvent.deleteMany({ where: { accountId, calendarId: gone.calendarId } }),
          prisma.calendarCalendar.delete({
            where: { accountId_calendarId: { accountId, calendarId: gone.calendarId } }
          })
        ])
      }

      for (const calendar of calendars) {
        const stored = known.find((candidate) => candidate.calendarId === calendar.calendarId)
        await prisma.calendarCalendar.upsert({
          where: { accountId_calendarId: { accountId, calendarId: calendar.calendarId } },
          create: {
            accountId,
            calendarId: calendar.calendarId,
            name: calendar.name,
            isPrimary: calendar.primary ? 1 : 0
          },
          update: { name: calendar.name, isPrimary: calendar.primary ? 1 : 0 }
        })
        await this.syncCalendar(provider, accountId, calendar.calendarId, stored ?? null)
      }

      await prisma.calendarAccount.update({
        where: { accountId },
        data: { lastSyncAt: BigInt(Date.now()), problem: null }
      })
    } catch (error) {
      logMainError('Calendar sync failed', error, { accountId })
      await prisma.calendarAccount.updateMany({
        where: { accountId },
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
    accountId: string,
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
        await this.applyChanges(accountId, events)
        await prisma.calendarCalendar.update({
          where: { accountId_calendarId: { accountId, calendarId } },
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

    await prisma.calendarEvent.deleteMany({ where: { accountId, calendarId } })
    await this.applyChanges(accountId, events)
    await prisma.calendarCalendar.update({
      where: { accountId_calendarId: { accountId, calendarId } },
      data: { syncToken, windowEnd: BigInt(windowEnd) }
    })
  }

  private async applyChanges(
    accountId: string,
    events: ReadonlyArray<ProviderEvent>
  ): Promise<void> {
    const prisma = this.requirePrisma()

    await prisma.$transaction(
      events.map((event) => {
        const key = eventKey(accountId, event.calendarId, event.eventId)

        if (event.cancelled) {
          return prisma.calendarEvent.deleteMany({ where: { key } })
        }

        const data = {
          accountId,
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
          htmlLink: event.htmlLink
        }

        return prisma.calendarEvent.upsert({
          where: { key },
          create: { key, ...data },
          update: data
        })
      })
    )
  }

  private async providerFor(accountId: string): Promise<CalendarProvider | null> {
    const [row, account] = await Promise.all([
      this.requirePrisma().calendarAccount.findUnique({ where: { accountId } }),
      this.options.database
        .getAccounts()
        .then((accounts) => accounts.find((candidate) => candidate.id === accountId))
    ])

    return row && account
      ? new GoogleCalendarProvider(
          this.options.oauth.client(decryptSecret(row.encryptedToken)),
          account.email
        )
      : null
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
        `${calendar.accountId}\u0000${calendar.calendarId}`,
        calendar.name
      ])
    )

    return rows.map((row) =>
      eventOfRow(row, names.get(`${row.accountId}\u0000${row.calendarId}`) ?? '')
    )
  }

  /** The event an invitation is for, in the account's calendars; the earliest instance of a series. */
  async eventByUid(accountId: string, iCalUid: string): Promise<CalendarEvent | null> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findFirst({
      where: { accountId, iCalUid, endsAt: { gt: BigInt(Date.now()) } },
      orderBy: { startsAt: 'asc' }
    })

    if (!row) {
      return null
    }

    const calendar = await prisma.calendarCalendar.findUnique({
      where: { accountId_calendarId: { accountId, calendarId: row.calendarId } }
    })
    return eventOfRow(row, calendar?.name ?? '')
  }

  async respond(
    key: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findUnique({ where: { key } })
    const provider = row ? await this.providerFor(row.accountId) : null

    if (!row || !provider) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    const answered = await provider.respond(row.calendarId, row.eventId, response)
    await this.applyChanges(row.accountId, [answered])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.eventOrThrow(eventKey(row.accountId, row.calendarId, answered.eventId))
  }

  /** Adds an event to the account's main calendar; whoever is invited gets Google's invitation. */
  async create(event: NewCalendarEvent): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const provider = await this.providerFor(event.accountId)
    const primary = await prisma.calendarCalendar.findFirst({
      where: { accountId: event.accountId, isPrimary: 1 }
    })

    if (!provider || !primary) {
      throw new Error('Il calendario di questo account non è collegato.')
    }

    const created = await provider.create(primary.calendarId, event)
    await this.applyChanges(event.accountId, [created])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.eventOrThrow(eventKey(event.accountId, primary.calendarId, created.eventId))
  }

  private async eventOrThrow(key: string): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findUnique({ where: { key } })

    if (!row) {
      throw new Error('L’evento non c’è più nel calendario.')
    }

    const calendar = await prisma.calendarCalendar.findUnique({
      where: { accountId_calendarId: { accountId: row.accountId, calendarId: row.calendarId } }
    })
    return eventOfRow(row, calendar?.name ?? '')
  }
}
