import type { CalendarEvent as CalendarEventRow, Prisma, PrismaClient } from '@prisma/client'
import type { BrowserWindow } from 'electron'

import type { GoogleOAuthService } from '@main/services/google-oauth'
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
import { GOOGLE_CALENDAR_SCOPE, GoogleCalendarProvider } from './google-calendar'

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
  /** Sends an event to the window. */
  send(channel: string, payload: unknown): void
  parentWindow(): BrowserWindow | null
}

function eventKey(accountId: string, calendarId: string, eventId: string): string {
  return `${accountId}\u0000${calendarId}\u0000${eventId}`
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
    htmlLink: row.htmlLink,
    origin: row.originJson ? (JSON.parse(row.originJson) as EventOrigin) : null
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
      prisma.calendarChange.deleteMany({ where: { accountId } }),
      prisma.calendarEvent.deleteMany({ where: { accountId } }),
      prisma.calendarCalendar.deleteMany({ where: { accountId } }),
      prisma.calendarAccount.deleteMany({ where: { accountId } })
    ])
  }

  /** "Elimina tutti i dati": the events go, the connections stay and read them anew. */
  async clearData(): Promise<void> {
    const prisma = this.requirePrisma()

    await prisma.$transaction([
      prisma.calendarChange.deleteMany(),
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
    await this.prisma.calendarChange.deleteMany({
      where: { at: { lt: BigInt(Date.now() - CHANGES_KEPT_MS) } }
    })
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
        // What changed since the last read was done elsewhere — or here, and then it is no change.
        await this.applyChanges(accountId, events, { logChanges: true })
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

  /**
   * Keeps events as the provider gives them. With `logChanges`, what is
   * new, different or cancelled compared with what was kept is noted in
   * `calendar_changes`, for the Segretario: the app's own writes were kept
   * already, so they show no difference.
   */
  private async applyChanges(
    accountId: string,
    events: ReadonlyArray<ProviderEvent>,
    options: { logChanges?: boolean } = {}
  ): Promise<void> {
    const prisma = this.requirePrisma()
    const keyOf = (event: ProviderEvent): string =>
      eventKey(accountId, event.calendarId, event.eventId)
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
          (await prisma.calendarCalendar.findMany({ where: { accountId } })).map((calendar) => [
            calendar.calendarId,
            calendar.name
          ])
        )
      : new Map<string, string>()
    const snapshot = (event: ProviderEvent): string =>
      JSON.stringify({
        ...event,
        key: keyOf(event),
        accountId,
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
                accountId,
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
        htmlLink: event.htmlLink,
        originJson: event.origin ? JSON.stringify(event.origin) : null
      }

      writes.push(
        prisma.calendarEvent.upsert({ where: { key }, create: { key, ...data }, update: data })
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

  /** Every connected calendar, the main ones first: for the Calendario app and the Segretario. */
  async calendars(): Promise<CalendarListEntry[]> {
    const [rows, accounts] = await Promise.all([
      this.requirePrisma().calendarCalendar.findMany({
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }]
      }),
      this.options.database.getAccounts()
    ])
    const emails = new Map(accounts.map((account) => [account.id, account.email]))

    return rows.map((row) => ({
      key: calendarKey(row.accountId, row.calendarId),
      accountId: row.accountId,
      account: emails.get(row.accountId) ?? '',
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
      (candidate) => calendarKey(candidate.accountId, candidate.calendarId) === key
    )

    if (!calendar) {
      throw new Error('Questo calendario non è più collegato.')
    }

    await prisma.calendarCalendar.update({
      where: {
        accountId_calendarId: { accountId: calendar.accountId, calendarId: calendar.calendarId }
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
      (candidate) => calendarKey(candidate.accountId, candidate.calendarId) === event.calendarKey
    )
    const provider = calendar ? await this.providerFor(calendar.accountId) : null

    if (!provider || !calendar) {
      throw new Error('Questo calendario non è più collegato.')
    }

    if (calendar.writable !== 1) {
      throw new Error(`Nel calendario «${calendar.name}» non si possono aggiungere eventi.`)
    }

    const created = await provider.create(calendar.calendarId, event, event.origin ?? null)
    await this.applyChanges(calendar.accountId, [created])
    this.options.send(CALENDAR_IPC.changed, null)
    return this.eventOrThrow(eventKey(calendar.accountId, calendar.calendarId, created.eventId))
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

    await this.applyChanges(row.accountId, [updated])
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
    const provider = row ? await this.providerFor(row.accountId) : null

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
      where: { accountId_calendarId: { accountId: row.accountId, calendarId: row.calendarId } }
    })
    return eventOfRow(row, calendar?.name ?? '')
  }
}
