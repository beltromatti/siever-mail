import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { calendarKey, type CalendarEvent } from '@shared/calendar'
import type { ConnectionRefusedNotice } from '@shared/models'

import type {
  CalendarProvider,
  EventField,
  ProviderEvent,
  ProviderEventInput
} from './calendar-provider'
import type { SegretarioOwnership } from './ownership'

/** The Google accounts on the fake network, by their address: what a Google connection reaches. */
const google = vi.hoisted(() => ({ accounts: new Map<string, unknown>() }))

vi.mock('./google-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./google-calendar')>()),
  GoogleCalendarProvider: function (_auth: unknown, address: string) {
    return google.accounts.get(address)
  }
}))

vi.mock('electron', () => ({
  // Kept as it is: what is tested is what the service does with it.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (secret: string) => Buffer.from(secret),
    decryptString: (secret: Buffer) => secret.toString()
  },
  net: {},
  shell: {}
}))

const { CalendarService } = await import('./calendar-service')
type CalendarServiceOptions = ConstructorParameters<typeof CalendarService>[0]

type Row = Record<string, unknown>

/** Whether a row is what a `where` asks: each field equal, in a list, past a bound — a compound key spread. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, wanted]) => {
    if (wanted === null || typeof wanted !== 'object') {
      return row[field] === wanted
    }

    const condition = wanted as { in?: unknown[]; lt?: bigint | number; gt?: bigint | number }

    if (condition.in) return condition.in.includes(row[field])
    if (condition.lt !== undefined) return (row[field] as bigint | number) < condition.lt
    if (condition.gt !== undefined) return (row[field] as bigint | number) > condition.gt
    return matches(row, wanted as Row)
  })
}

/** What Prisma writes: a field given as undefined is left as it is. */
function assign(row: Row, data: Row): Row {
  return Object.assign(
    row,
    Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  )
}

/** A table of the store, in memory, answering what the service asks of Prisma. */
function table(defaults: Row = {}): Record<string, (args?: Row) => Promise<unknown>> {
  const rows: Row[] = []
  const found = (args?: Row): Row[] => rows.filter((row) => matches(row, args?.where as Row))

  return {
    findMany: async (args) => found(args).map((row) => ({ ...row })),
    findUnique: async (args) => (found(args)[0] ? { ...found(args)[0] } : null),
    findFirst: async (args) => (found(args).at(-1) ? { ...found(args).at(-1) } : null),
    create: async (args) => {
      rows.push(assign({ ...defaults }, args!.data as Row))
      return { ...rows.at(-1) }
    },
    createMany: async (args) => {
      for (const data of args!.data as Row[]) rows.push(assign({ ...defaults }, data))
      return { count: (args!.data as Row[]).length }
    },
    upsert: async (args) => {
      const row = found(args)[0]
      return row
        ? assign(row, args!.update as Row)
        : rows.push(assign({ ...defaults }, args!.create as Row))
    },
    update: async (args) => {
      const row = found(args)[0]

      if (!row) {
        throw new Error('Record to update not found.')
      }

      return assign(row, args!.data as Row)
    },
    updateMany: async (args) => {
      found(args).forEach((row) => assign(row, args!.data as Row))
      return { count: found(args).length }
    },
    delete: async (args) => rows.splice(rows.indexOf(found(args)[0]), 1),
    deleteMany: async (args) => {
      const gone = found(args)
      gone.forEach((row) => rows.splice(rows.indexOf(row), 1))
      return { count: gone.length }
    }
  }
}

function store(): PrismaClient {
  let changeId = 0

  return {
    calendarConnection: table({
      mailAccountId: null,
      username: null,
      lastSyncAt: null,
      problem: null
    }),
    calendarCalendar: table({ hidden: 0, syncToken: null, windowEnd: null }),
    calendarEvent: table(),
    calendarObject: table(),
    calendarChange: table({
      get id() {
        return ++changeId
      },
      inApp: 0
    }),
    $transaction: (writes: Promise<unknown>[]) => Promise.all(writes)
  } as unknown as PrismaClient
}

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Calcetto
BEGIN:VEVENT
UID:partita@fubles
DTSTAMP:20261101T000000Z
DTSTART:${new Date(Date.now() + 86_400_000).toISOString().replace(/[-:]|\.\d{3}/g, '')}
DURATION:PT1H
SUMMARY:Partita
END:VEVENT
END:VCALENDAR`

/** A calendar's link on a fake network, answering as `status` says now; every request counted. */
function link(): {
  fetch: (url: string) => Promise<Response>
  asked: () => number
  answer: (status: number) => void
} {
  let status = 200
  let asked = 0

  return {
    asked: () => asked,
    answer: (next) => {
      status = next
    },
    fetch: async () => {
      asked++
      return status === 200 ? new Response(FEED) : new Response(null, { status })
    }
  }
}

const opened: Array<InstanceType<typeof CalendarService>> = []

/** The calendars open on the store and the network given, the user told of each refusal. */
async function calendars(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  more: Partial<CalendarServiceOptions> = {},
  prisma: PrismaClient = store()
): Promise<{ calendar: InstanceType<typeof CalendarService>; told: ConnectionRefusedNotice[] }> {
  const told: ConnectionRefusedNotice[] = []
  const calendar = new CalendarService({
    database: { storeClient: async () => prisma, getAccounts: async () => [] },
    oauth: {} as never,
    microsoft: {} as never,
    fetch,
    send: () => undefined,
    parentWindow: () => null,
    onRefused: (notice) => told.push(notice),
    ...more
  })

  opened.push(calendar)
  await calendar.open()
  // The first read of every connection, of none yet, done before anything is added.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { calendar, told }
}

afterEach(() => {
  opened.splice(0).forEach((calendar) => calendar.stop())
})

describe('CalendarService, a connection turned down', () => {
  it('stops, tells the user once, refuses writes, and reads again only when tried again', async () => {
    const server = link()
    const { calendar, told } = await calendars(server.fetch)
    const [added] = await calendar.addIcs('https://fubles.example/feed.ics', null)

    expect(added).toMatchObject({ label: 'Calcetto', refused: null, problem: null })
    const read = server.asked()

    server.answer(404)
    await calendar.syncAll()
    await calendar.syncAll()

    expect(server.asked()).toBe(read + 1)
    expect(told).toEqual([
      {
        family: 'calendario',
        id: added.id,
        label: 'Calcetto',
        refusal: 'sparito',
        detail: 'The calendar is no longer at that link. (HTTP 404)',
        signIn: 'none'
      }
    ])
    expect((await calendar.listConnections())[0]).toMatchObject({
      refused: 'sparito',
      problem: 'The calendar is no longer at that link.'
    })
    // What it kept stays.
    expect(
      (
        await calendar.events(
          new Date().toISOString(),
          new Date(Date.now() + 7 * 86_400_000).toISOString()
        )
      ).map((event) => event.title)
    ).toEqual(['Partita'])
    await expect(
      calendar.create({
        calendarKey: `${added.id}\u0000feed`,
        title: 'Allenamento',
        start: '2026-11-20T18:00:00.000Z',
        end: '2026-11-20T19:00:00.000Z',
        allDay: false,
        location: null,
        description: null,
        attendees: []
      })
    ).rejects.toThrow(
      'The calendar Calcetto is stopped: it’s no longer where it was connected. Reconnect it from Settings › Connections.'
    )

    // Back at its link, it waits for the user to try it again.
    server.answer(200)
    await calendar.syncAll()
    expect(server.asked()).toBe(read + 1)

    const [retried] = await calendar.reconnect(added.id)
    expect(server.asked()).toBe(read + 2)
    expect(retried).toMatchObject({ refused: null, problem: null })
    expect(told).toHaveLength(1)

    // Turned down again, the user is told again.
    server.answer(410)
    await calendar.syncAll()
    expect(told.map((notice) => notice.refusal)).toEqual(['sparito', 'sparito'])
  })

  it('tries again by itself what passes, and says so without stopping', async () => {
    const server = link()
    const { calendar, told } = await calendars(server.fetch)
    const [added] = await calendar.addIcs('https://fubles.example/feed.ics', null)

    server.answer(503)
    await calendar.syncAll()
    expect((await calendar.listConnections())[0]).toMatchObject({
      refused: null,
      problem: '“Calcetto” can’t be read: The calendar’s server answered 503.'
    })

    const read = server.asked()
    server.answer(200)
    await calendar.syncAll()
    expect(server.asked()).toBe(read + 1)
    expect((await calendar.listConnections())[0]).toMatchObject({ id: added.id, problem: null })
    expect(told).toEqual([])
  })

  it('does not add a connection whose first read is turned down, and tells who adds it, not the popup', async () => {
    const server = link()
    const { calendar, told } = await calendars(async (url) => {
      // The link answers when it is tried, then is gone by the time it is read.
      const answered = await server.fetch(url)
      server.answer(404)
      return answered
    })

    await expect(calendar.addIcs('https://fubles.example/feed.ics', null)).rejects.toThrow(
      'The calendar is no longer at that link. SIEVER Mail didn’t add it.'
    )
    expect(await calendar.listConnections()).toEqual([])
    expect(told).toEqual([])
  })
})

describe('CalendarService, a CalDAV password the server no longer takes', () => {
  const SERVER = 'https://dav.example.it/'
  const HOME = `${SERVER}mattia/`
  const CALENDAR = `${HOME}lavoro/`
  const multistatus = (body: string): Response =>
    new Response(
      `<?xml version="1.0" encoding="utf-8"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</multistatus>`,
      { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
    )
  const ok = (href: string, props: string): string =>
    `<response><href>${href}</href><propstat><prop>${props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`

  /** A CalDAV server that takes, of the user's passwords, only `password()`. */
  function davServer(password: () => string): {
    fetch: (url: string, init?: RequestInit) => Promise<Response>
    asked: () => number
  } {
    let asked = 0

    return {
      asked: () => asked,
      fetch: async (url, init) => {
        asked++
        const headers = new Headers(init?.headers)

        if (headers.get('authorization') !== `Basic ${btoa(`mattia@studio.it:${password()}`)}`) {
          return new Response(null, { status: 401 })
        }

        const depth = headers.get('depth')

        if (init?.method === 'OPTIONS') {
          return new Response(null, { headers: { DAV: '1, 2, calendar-access' } })
        }

        if (url === SERVER) {
          return multistatus(
            ok('/', '<current-user-principal><href>/mattia/</href></current-user-principal>')
          )
        }

        if (url === HOME && depth === '0') {
          return multistatus(
            ok('/mattia/', '<C:calendar-home-set><href>/mattia/</href></C:calendar-home-set>')
          )
        }

        if (url === HOME && depth === '1') {
          return multistatus(
            ok(
              '/mattia/lavoro/',
              '<displayname>Lavoro</displayname><resourcetype><C:calendar /><collection /></resourcetype><C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>'
            )
          )
        }

        if (url === CALENDAR) {
          return init?.method === 'REPORT'
            ? multistatus('')
            : multistatus(ok('/mattia/lavoro/', '<supported-report-set />'))
        }

        return new Response(null, { status: 404 })
      }
    }
  }

  it('stops, and takes a new password only once the server does', async () => {
    let current = 'vecchia'
    const server = davServer(() => current)
    const { calendar, told } = await calendars(server.fetch)
    const [added] = await calendar.addCalDav({
      serverUrl: SERVER,
      username: 'mattia@studio.it',
      password: 'vecchia',
      label: 'Studio'
    })
    expect(added).toMatchObject({ refused: null, problem: null })

    current = 'nuova'
    await calendar.syncAll()
    expect(told).toMatchObject([
      { id: added.id, label: 'Studio', refusal: 'accesso', signIn: 'password' }
    ])

    const asked = server.asked()
    await calendar.syncAll()
    expect(server.asked()).toBe(asked)

    await expect(calendar.reconnect(added.id, 'sbagliata')).rejects.toThrow(
      'The calendar’s server didn’t accept the username and password.'
    )
    expect((await calendar.listConnections())[0].refused).toBe('accesso')

    // Tried again as it is, the old password is turned down again: said to the user who asked,
    // where they asked — not once more in a window of its own.
    await expect(calendar.reconnect(added.id)).rejects.toThrow(
      'The calendar’s server didn’t accept the username and password.'
    )
    expect((await calendar.listConnections())[0].refused).toBe('accesso')
    expect(told).toHaveLength(1)

    const [reconnected] = await calendar.reconnect(added.id, 'nuova')
    expect(reconnected).toMatchObject({ refused: null, problem: null })
    expect(told).toHaveLength(1)
  })
})

describe('CalendarService, the window sliding with the days', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the year ahead again each day: a series coming in is no change, a new event is', async () => {
    const DAY = 86_400_000
    const stamp = (at: number): string => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, '')
    const start = Date.now()
    const weekly = `BEGIN:VEVENT
UID:riunione@studio
DTSTAMP:20261101T000000Z
DTSTART:${stamp(start + DAY)}
DURATION:PT1H
RRULE:FREQ=WEEKLY
SUMMARY:Riunione ufficio tecnico
END:VEVENT`
    const fair = `BEGIN:VEVENT
UID:fiera@mce
DTSTAMP:20261101T000000Z
DTSTART:${stamp(start + 300 * DAY)}
DURATION:PT8H
SUMMARY:Fiera MCE
END:VEVENT`
    let events = [weekly]
    const feed = (): string =>
      `BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:Lavoro\n${events.join('\n')}\nEND:VCALENDAR`
    const { calendar } = await calendars(async () => new Response(feed()))
    await calendar.addIcs('https://studio.example/lavoro.ics', null)

    // A week and a day on, read whole again: the week coming in brings one more of the series.
    vi.useFakeTimers({ toFake: ['Date'], now: start + 8 * DAY })
    await calendar.syncAll()
    expect(await calendar.changesSince(0, 100)).toEqual([])

    // An event new to the window — however far — is a change.
    events = [weekly, fair]
    vi.setSystemTime(start + 10 * DAY)
    await calendar.syncAll()
    expect(
      (await calendar.changesSince(0, 100)).map((change) => [change.kind, change.event.title])
    ).toEqual([['nuovo', 'Fiera MCE']])
  })
})

describe('CalendarService, an event as it was kept', () => {
  it('is the event while it is there, and as its last change kept it once gone', async () => {
    const stamp = (at: number): string => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, '')
    const visit = `BEGIN:VEVENT
UID:sopralluogo@studio
DTSTAMP:20261101T000000Z
DTSTART:${stamp(Date.now() + 86_400_000)}
DURATION:PT1H
SUMMARY:Sopralluogo in cantiere
END:VEVENT`
    let events = [visit]
    const { calendar } = await calendars(
      async () =>
        new Response(
          `BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:Lavoro\n${events.join('\n')}\nEND:VCALENDAR`
        )
    )
    await calendar.addIcs('https://studio.example/lavoro.ics', null)
    const [kept] = await calendar.events(
      new Date().toISOString(),
      new Date(Date.now() + 7 * 86_400_000).toISOString()
    )

    expect(await calendar.eventAsKept(kept.key)).toMatchObject({
      gone: false,
      event: { title: 'Sopralluogo in cantiere' }
    })

    // Cancelled: what the Segretario tells of it, it tells of the event as it was.
    events = []
    await calendar.syncAll()
    expect(await calendar.eventAsKept(kept.key)).toMatchObject({
      gone: true,
      event: { title: 'Sopralluogo in cantiere', start: kept.start }
    })
    expect(await calendar.eventAsKept('mai-esistito')).toBeNull()
  })
})

describe('CalendarService, whose the events are (§7.4)', () => {
  it('a subscription reminds of nothing and is not the user’s day, until the Segretario or the user says so', async () => {
    const DAY = 86_400_000
    const stamp = (at: number): string => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, '')
    const feed = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Partite
BEGIN:VEVENT
UID:partita@calcio
DTSTAMP:20261101T000000Z
DTSTART:${stamp(Date.now() + DAY)}
DURATION:PT2H
SUMMARY:Partita
END:VEVENT
END:VCALENDAR`
    let found: SegretarioOwnership | null = null
    const { calendar } = await calendars(async () => new Response(feed), {
      ownership: async () => found
    })
    await calendar.addIcs('https://studio.example/partite.ics', null)
    const from = Date.now()
    const to = from + 7 * DAY
    const week = (): Promise<CalendarEvent[]> =>
      calendar.events(new Date(from).toISOString(), new Date(to).toISOString())
    const [entry] = await calendar.calendars()

    expect(entry).toMatchObject({ role: 'propri', roleBy: null })
    expect(await calendar.remindable(from, to)).toEqual([])
    const [match] = await week()
    expect(match.yours).toBe(false)

    // Found the user's by the Segretario: it reminds, at the user's lead — the calendar's are not theirs.
    found = { roles: new Map(), events: new Set([match.key]), series: new Set() }
    expect(
      (await calendar.remindable(from, to)).map((event) => [event.title, event.reminders])
    ).toEqual([['Partita', null]])

    // The Segretario says none is; the user says every one is: their word stands.
    found = {
      roles: new Map([[entry.key, { role: 'nessuno', reason: 'Un abbonamento' }]]),
      events: new Set(),
      series: new Set()
    }
    expect(await calendar.remindable(from, to)).toEqual([])
    expect(await calendar.calendars()).toMatchObject([{ role: 'nessuno', roleBy: 'segretario' }])
    expect(await calendar.setCalendarRole(entry.key, 'tutti')).toMatchObject([
      { role: 'tutti', roleBy: 'utente' }
    ])
    expect((await week())[0].yours).toBe(true)
    expect(await calendar.remindable(from, to)).toHaveLength(1)
  })

  it('says what the calendar says by itself, the Segretario left out: where the user may put it right', async () => {
    const feed = FEED.replace('X-WR-CALNAME:Calcetto', 'X-WR-CALNAME:Studio comune')
    let found: SegretarioOwnership | null = null
    const { calendar } = await calendars(async () => new Response(feed), {
      ownership: async () => found
    })
    await calendar.addIcs('https://studio.example/comune.ics', null)
    const [entry] = await calendar.calendars()
    const [match] = await calendar.events(
      new Date().toISOString(),
      new Date(Date.now() + 7 * 86_400_000).toISOString()
    )

    // Found the user's by the Segretario: theirs, though the calendar does not say so.
    found = { roles: new Map(), events: new Set([match.key]), series: new Set() }
    expect((await calendar.event(match.key))?.yours).toBe(true)
    expect(await calendar.calendarSays(match.key)).toEqual({ role: 'propri', yours: false })

    // A calendar of theirs says it of every event: nothing there to put right.
    await calendar.setCalendarRole(entry.key, 'tutti')
    expect(await calendar.calendarSays(match.key)).toEqual({ role: 'tutti', yours: true })
    expect(await calendar.calendarSays(`${match.key}-gone`)).toBeNull()
  })
})

const DAY = 86_400_000

/**
 * A Google account in memory, as the service reaches it through its
 * provider: its calendars, their events, what changed in each since it
 * was last read, and every write asked of it.
 */
class Account implements CalendarProvider {
  readonly events = new Map<string, ProviderEvent>()
  readonly calls: Array<[string, ...unknown[]]> = []
  /** What each update was given to write. */
  readonly written: ProviderEventInput[] = []
  private readonly changed = new Map<string, ProviderEvent[]>()
  private made = 0

  /**
   * `defaults`: each calendar's own reminders, which an event that keeps the
   * calendar's takes where it moves — as Google does.
   */
  constructor(
    readonly calendarIds: string[],
    private readonly defaults: Readonly<Record<string, number[] | null>> | null = null
  ) {}

  /** An event of a calendar, here or elsewhere: noted as changed for the next read. */
  put(event: ProviderEvent): void {
    this.events.set(`${event.calendarId}\u0000${event.eventId}`, event)
    this.changed.set(event.calendarId, [...(this.changed.get(event.calendarId) ?? []), event])
  }

  /** An event taken away, or an instance of a series. */
  drop(calendarId: string, eventId: string): void {
    for (const event of [...this.events.values()]) {
      if (
        event.calendarId === calendarId &&
        (event.eventId === eventId || event.seriesId === eventId)
      ) {
        this.events.delete(`${calendarId}\u0000${event.eventId}`)
        this.changed.set(calendarId, [
          ...(this.changed.get(calendarId) ?? []),
          { ...event, cancelled: true }
        ])
      }
    }
  }

  of(calendarId: string, eventId: string): ProviderEvent[] {
    return [...this.events.values()].filter(
      (event) =>
        event.calendarId === calendarId && (event.eventId === eventId || event.seriesId === eventId)
    )
  }

  async listCalendars(): ReturnType<CalendarProvider['listCalendars']> {
    return this.calendarIds.map((calendarId, index) => ({
      calendarId,
      name: calendarId,
      primary: index === 0,
      writable: true,
      color: null
    }))
  }

  async changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): ReturnType<CalendarProvider['changes']> {
    const found =
      'syncToken' in since
        ? (this.changed.get(calendarId) ?? [])
        : [...this.events.values()].filter((event) => event.calendarId === calendarId)
    this.changed.set(calendarId, [])
    return { events: found, syncToken: 'next' }
  }

  async create(
    calendarId: string,
    input: ProviderEventInput,
    origin: ProviderEvent['origin']
  ): Promise<ProviderEvent> {
    const eventId = `nuovo-${++this.made}`
    this.calls.push(['create', calendarId, input.title, input.recurrence])
    const event = providerEvent(calendarId, eventId, {
      ...input,
      attendees: input.attendees.map((email) => ({
        email,
        name: null,
        response: 'needsAction',
        self: false,
        organizer: false
      })),
      origin,
      recurrence: input.recurrence ?? null
    })

    if (!input.recurrence || input.recurrence === 'other') {
      this.put(event)
      return event
    }

    // A series: two weeks of it.
    for (const week of [0, 1]) {
      this.put({
        ...event,
        eventId: `${eventId}_${week}`,
        seriesId: eventId,
        start: new Date(event.startsAt + week * 7 * DAY).toISOString(),
        end: new Date(event.endsAt + week * 7 * DAY).toISOString(),
        startsAt: event.startsAt + week * 7 * DAY,
        endsAt: event.endsAt + week * 7 * DAY
      })
    }

    return event
  }

  async update(
    calendarId: string,
    eventId: string,
    input: ProviderEventInput,
    _notify: boolean,
    fields: ReadonlySet<EventField>
  ): Promise<ProviderEvent> {
    this.calls.push(['update', calendarId, eventId, [...fields].sort()])
    this.written.push(input)

    for (const event of this.of(calendarId, eventId)) {
      this.put({ ...event, title: input.title, reminders: input.reminders })
    }

    return this.of(calendarId, eventId)[0]
  }

  async remove(calendarId: string, eventId: string): Promise<void> {
    this.calls.push(['remove', calendarId, eventId])
    this.drop(calendarId, eventId)
  }

  async series(calendarId: string, seriesId: string): Promise<ProviderEventInput> {
    const [first] = this.of(calendarId, seriesId).sort((a, b) => a.startsAt - b.startsAt)
    return { ...first, attendees: [], recurrence: first.recurrence ?? null, reminders: null }
  }

  async move(
    calendarId: string,
    eventId: string,
    toCalendarId: string
  ): Promise<{ eventId: string; how: 'native' }> {
    this.calls.push(['move', calendarId, eventId, toCalendarId])
    const moving = this.of(calendarId, eventId)
    this.drop(calendarId, eventId)
    moving.forEach((event) =>
      this.put({
        ...event,
        calendarId: toCalendarId,
        reminders: this.defaults ? (this.defaults[toCalendarId] ?? null) : event.reminders
      })
    )
    return { eventId, how: 'native' }
  }

  async respond(): Promise<ProviderEvent> {
    throw new Error('Not here.')
  }
}

/** An event of the user's, without guests, as Google gives it. */
function providerEvent(
  calendarId: string,
  eventId: string,
  fields: Partial<ProviderEvent> = {}
): ProviderEvent {
  const startsAt = fields.start ? Date.parse(fields.start) : Date.now() + DAY
  const endsAt = fields.end ? Date.parse(fields.end) : startsAt + 3_600_000

  return {
    calendarId,
    eventId,
    iCalUid: `${eventId}@google.com`,
    seriesId: null,
    title: 'Riunione',
    start: new Date(startsAt).toISOString(),
    end: new Date(endsAt).toISOString(),
    allDay: false,
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    myResponse: null,
    meetLink: null,
    htmlLink: null,
    origin: null,
    reminders: null,
    recurrence: null,
    managedBy: null,
    cancelled: false,
    ...fields,
    startsAt,
    endsAt
  }
}

/**
 * The calendars open with Google accounts connected — each by its address —,
 * read once; what follows the events moved, kept.
 */
async function withGoogle(accounts: Record<string, Account>): Promise<{
  calendar: InstanceType<typeof CalendarService>
  moved: Array<{ from: string; to: string }>
  notified: Array<{ from: string; to: string }>
  key: (address: string, calendarId: string, eventId: string) => string
}> {
  const prisma = store()
  const moved: Array<{ from: string; to: string }> = []
  const notified: Array<{ from: string; to: string }> = []
  google.accounts.clear()

  for (const [address, account] of Object.entries(accounts)) {
    google.accounts.set(address, account)
    await prisma.calendarConnection.create({
      data: {
        id: address,
        provider: 'google',
        label: address,
        encryptedSecret: Buffer.from('token').toString('base64'),
        connectedAt: 0n
      }
    })
  }

  const { calendar } = await calendars(
    async () => new Response(null, { status: 404 }),
    {
      oauth: { client: () => ({}) } as never,
      onEventsMoved: async (moves) => void moved.push(...moves),
      notificationsMoved: async (moves) => void notified.push(...moves)
    },
    prisma
  )
  await calendar.syncAll()

  return {
    calendar,
    moved,
    notified,
    key: (address, calendarId, eventId) => `${address}\u0000${calendarId}\u0000${eventId}`
  }
}

describe('CalendarService, an event in another calendar (§7.5)', () => {
  it('knows an event moved elsewhere between two calendars for the same one: one change, what was kept of it following', async () => {
    const account = new Account(['primary', 'vita'])
    account.put(providerEvent('primary', 'riunione'))
    const { calendar, moved, notified, key } = await withGoogle({ 'mattia@brenta.it': account })

    // Moved in Google Calendar, from the phone.
    await account.move('primary', 'riunione', 'vita')
    await calendar.syncAll()

    const from = key('mattia@brenta.it', 'primary', 'riunione')
    const to = key('mattia@brenta.it', 'vita', 'riunione')
    expect(moved).toEqual([{ from, to }])
    expect(notified).toEqual([{ from, to }])
    expect(
      (await calendar.changesSince(0, 100)).map((change) => [
        change.kind,
        change.inApp,
        change.event.key,
        change.before?.key,
        change.before?.calendarName
      ])
    ).toEqual([['cambiato', false, to, from, 'primary']])
    expect(await calendar.event(from)).toBeNull()
    expect((await calendar.event(to))?.calendarName).toBe('vita')
  })

  it('moves an event with Google’s own move: the user’s one change under its new key, the Segretario’s none', async () => {
    const account = new Account(['primary', 'vita'])
    account.put(providerEvent('primary', 'riunione'))
    const { calendar, moved, key } = await withGoogle({ 'mattia@brenta.it': account })
    const here = key('mattia@brenta.it', 'primary', 'riunione')
    const there = key('mattia@brenta.it', 'vita', 'riunione')

    const result = await calendar.update(
      here,
      { calendarKey: calendarKey('mattia@brenta.it', 'vita'), title: 'Riunione di cantiere' },
      { byUser: true }
    )

    expect(result).toMatchObject({
      key: there,
      calendarName: 'vita',
      title: 'Riunione di cantiere'
    })
    expect(account.calls).toEqual([
      ['move', 'primary', 'riunione', 'vita'],
      ['update', 'vita', 'riunione', ['title']]
    ])
    expect(moved).toEqual([{ from: here, to: there }])
    expect(
      (await calendar.changesSince(0, 100)).map((change) => [
        change.kind,
        change.inApp,
        change.event.key,
        change.before?.calendarName
      ])
    ).toEqual([
      ['cambiato', true, there, 'primary'],
      ['cambiato', true, there, 'vita']
    ])

    // Back by the Segretario: it knows it, nothing is noted.
    const latest = await calendar.latestChangeId()
    await calendar.update(there, { calendarKey: calendarKey('mattia@brenta.it', 'primary') })
    expect(await calendar.changesSince(latest, 100)).toEqual([])
    expect(moved.at(-1)).toEqual({ from: there, to: here })
  })

  it('keeps the reminders an event had where it moves, even to a calendar that would give it its own', async () => {
    const account = new Account(['primary', 'vita'], { primary: [30], vita: null })
    account.put(providerEvent('primary', 'treno', { reminders: [30] }))
    const { calendar, key } = await withGoogle({ 'mattia@brenta.it': account })

    const moved = await calendar.update(key('mattia@brenta.it', 'primary', 'treno'), {
      calendarKey: calendarKey('mattia@brenta.it', 'vita')
    })

    expect(moved).toMatchObject({ calendarName: 'vita', reminders: [30] })
    expect(account.calls).toEqual([
      ['move', 'primary', 'treno', 'vita'],
      ['update', 'vita', 'treno', ['reminders']]
    ])
  })

  it('moves an instance with its whole series, every instance following to its key there', async () => {
    const account = new Account(['primary', 'vita'])
    const start = Date.now() + DAY
    const series = { seriesId: 'lez', recurrence: { frequency: 'weekly', interval: 1 } } as const

    for (const week of [0, 1]) {
      account.put(
        providerEvent('primary', `lez_${week}`, {
          ...series,
          iCalUid: 'lez@google.com',
          start: new Date(start + week * 7 * DAY).toISOString()
        })
      )
    }

    const { calendar, moved, key } = await withGoogle({ 'mattia@brenta.it': account })
    const result = await calendar.update(key('mattia@brenta.it', 'primary', 'lez_1'), {
      calendarKey: calendarKey('mattia@brenta.it', 'vita')
    })

    expect(account.calls).toEqual([['move', 'primary', 'lez', 'vita']])
    expect(result.key).toBe(key('mattia@brenta.it', 'vita', 'lez_1'))
    expect(moved).toEqual([
      {
        from: key('mattia@brenta.it', 'primary', 'lez_0'),
        to: key('mattia@brenta.it', 'vita', 'lez_0')
      },
      {
        from: key('mattia@brenta.it', 'primary', 'lez_1'),
        to: key('mattia@brenta.it', 'vita', 'lez_1')
      }
    ])
  })

  it('copies an event to another account and takes it away here — never one with guests, nor one Gmail keeps', async () => {
    const work = new Account(['primary'])
    const home = new Account(['casa'])
    work.put(providerEvent('primary', 'dentista', { reminders: [30] }))
    work.put(
      providerEvent('primary', 'cena', {
        attendees: [
          {
            email: 'rossi@acme-srl.it',
            name: null,
            response: 'accepted',
            self: false,
            organizer: false
          }
        ]
      })
    )
    work.put(providerEvent('primary', 'volo', { managedBy: 'gmail' }))
    const { calendar, moved, key } = await withGoogle({
      'mattia@brenta.it': work,
      'mattia@casa.it': home
    })
    const toHome = { calendarKey: calendarKey('mattia@casa.it', 'casa') }

    const copied = await calendar.update(key('mattia@brenta.it', 'primary', 'dentista'), toHome, {
      byUser: true
    })

    expect(home.calls).toEqual([['create', 'casa', 'Riunione', null]])
    expect(work.calls).toEqual([['remove', 'primary', 'dentista']])
    expect(copied).toMatchObject({ key: key('mattia@casa.it', 'casa', 'nuovo-1'), reminders: [30] })
    expect(moved).toEqual([
      { from: key('mattia@brenta.it', 'primary', 'dentista'), to: copied.key }
    ])
    await expect(
      calendar.update(key('mattia@brenta.it', 'primary', 'cena'), toHome)
    ).rejects.toThrow(
      'Moving it would cancel the invitation for the invitees and invite them again.'
    )
    await expect(
      calendar.update(key('mattia@brenta.it', 'primary', 'volo'), toHome)
    ).rejects.toThrow('Gmail keeps it: Google doesn’t let it move to another calendar.')
    await expect(
      calendar.update(key('mattia@brenta.it', 'primary', 'volo'), { title: 'Volo' })
    ).rejects.toThrow('Gmail keeps it: only its reminders can change.')
  })
})

describe('CalendarService, a series (§7.5)', () => {
  async function lessons(): Promise<{
    account: Account
    calendar: InstanceType<typeof CalendarService>
    key: (eventId: string) => string
  }> {
    const account = new Account(['primary'])
    const start = Date.now() + DAY

    for (const week of [0, 1]) {
      account.put(
        providerEvent('primary', `lez_${week}`, {
          seriesId: 'lez',
          iCalUid: 'lez@google.com',
          title: 'Lezione',
          recurrence: { frequency: 'weekly', interval: 1 },
          start: new Date(start + week * 7 * DAY).toISOString()
        })
      )
    }

    const { calendar, key } = await withGoogle({ 'mattia@brenta.it': account })
    return { account, calendar, key: (eventId) => key('mattia@brenta.it', 'primary', eventId) }
  }

  it('changes an instance alone, or its whole series, by the series’ id', async () => {
    const { account, calendar, key } = await lessons()

    const second = await calendar.event(key('lez_1'))
    await calendar.update(key('lez_1'), {
      title: 'Lezione spostata',
      start: new Date(Date.parse(second!.start) + 3_600_000).toISOString()
    })
    await calendar.update(
      key('lez_0'),
      { title: 'Lezione di analisi' },
      { series: true, byUser: true }
    )

    expect(account.calls).toEqual([
      ['update', 'primary', 'lez_1', ['time', 'title']],
      ['update', 'primary', 'lez', ['title']]
    ])
    // The instance alone: its series' rule is not written with it.
    expect(account.written[0].recurrence).toBeNull()
    expect(account.written[1].recurrence).toEqual({ frequency: 'weekly', interval: 1 })
    expect((await calendar.event(key('lez_1')))?.title).toBe('Lezione di analisi')
    expect(
      (await calendar.changesSince(0, 100)).map((change) => [change.kind, change.inApp])
    ).toEqual([
      ['cambiato', true],
      ['cambiato', true]
    ])
  })

  it('takes away an instance alone, or its whole series, noted instance by instance for the Segretario', async () => {
    const { account, calendar, key } = await lessons()

    await calendar.remove(key('lez_1'), { series: true, byUser: true })

    expect(account.calls).toEqual([['remove', 'primary', 'lez']])
    expect(await calendar.event(key('lez_0'))).toBeNull()
    expect(
      (await calendar.changesSince(0, 100)).map((change) => [change.kind, change.event.key])
    ).toEqual([
      ['annullato', key('lez_0')],
      ['annullato', key('lez_1')]
    ])
  })

  it('writes a new series, resolving with its first time; a rule that does not hold, never', async () => {
    const { account, calendar } = await lessons()
    const start = new Date(Date.now() + 2 * DAY).toISOString()
    const event = {
      calendarKey: calendarKey('mattia@brenta.it', 'primary'),
      title: 'Corso',
      start,
      end: new Date(Date.parse(start) + 3_600_000).toISOString(),
      allDay: false,
      location: null,
      description: null,
      attendees: []
    }

    const first = await calendar.create(
      { ...event, recurrence: { frequency: 'weekly', interval: 1 } },
      { byUser: true }
    )

    expect(first).toMatchObject({
      eventId: 'nuovo-1_0',
      seriesId: 'nuovo-1',
      recurrence: { frequency: 'weekly', interval: 1 }
    })
    expect(
      (await calendar.changesSince(0, 100)).map((change) => [change.kind, change.inApp])
    ).toEqual([
      ['nuovo', true],
      ['nuovo', true]
    ])
    await expect(
      calendar.create({ ...event, recurrence: { frequency: 'weekly', interval: 0 } })
    ).rejects.toThrow('How often it repeats is a whole number, 1 or more.')
    expect(account.calls).toHaveLength(1)
  })
})
