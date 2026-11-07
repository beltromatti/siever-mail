import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionRefusedNotice } from '@shared/models'

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
  fetch: (url: string, init?: RequestInit) => Promise<Response>
): Promise<{ calendar: InstanceType<typeof CalendarService>; told: ConnectionRefusedNotice[] }> {
  const told: ConnectionRefusedNotice[] = []
  const prisma = store()
  const calendar = new CalendarService({
    database: { storeClient: async () => prisma, getAccounts: async () => [] },
    oauth: {} as never,
    microsoft: {} as never,
    fetch,
    send: () => undefined,
    parentWindow: () => null,
    onRefused: (notice) => told.push(notice)
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
        detail: 'Il calendario non è più a quel link. (HTTP 404)',
        signIn: 'none'
      }
    ])
    expect((await calendar.listConnections())[0]).toMatchObject({
      refused: 'sparito',
      problem: 'Il calendario non è più a quel link.'
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
      'Il calendario Calcetto è fermo: non si trova più dove era collegato. Ricollegalo da Impostazioni › Connessioni.'
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
      problem: '«Calcetto» non si legge: Il server del calendario ha risposto 503.'
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
      'Il calendario non è più a quel link. SIEVER Mail non l’ha aggiunto.'
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
      'Il server del calendario non ha accettato nome utente e password.'
    )
    expect((await calendar.listConnections())[0].refused).toBe('accesso')

    // Tried again as it is, the old password is turned down again: said to the user who asked,
    // where they asked — not once more in a window of its own.
    await expect(calendar.reconnect(added.id)).rejects.toThrow(
      'Il server del calendario non ha accettato nome utente e password.'
    )
    expect((await calendar.listConnections())[0].refused).toBe('accesso')
    expect(told).toHaveLength(1)

    const [reconnected] = await calendar.reconnect(added.id, 'nuova')
    expect(reconnected).toMatchObject({ refused: null, problem: null })
    expect(told).toHaveLength(1)
  })
})
