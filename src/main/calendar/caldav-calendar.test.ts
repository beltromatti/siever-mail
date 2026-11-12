import { describe, expect, it } from 'vitest'

import { CalDavCalendarProvider, davStatusOf } from './caldav-calendar'
import { refusalOfCalendar } from './calendar-refusal'
import type { Fetch } from './ics-calendar'

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

/**
 * A CalDAV server on a fake network, as tsdav signs in to it and lists its
 * calendars; OPTIONS answered by `options`. With `digest`, it signs in with
 * Digest only, as SabreDAV and Baïkal may. Every OPTIONS asked is kept.
 */
function davServer(
  options: () => Response,
  digest = false
): { provider: CalDavCalendarProvider; asked: Headers[] } {
  const asked: Headers[] = []
  const provider = new CalDavCalendarProvider({
    serverUrl: SERVER,
    username: 'mattia@studio.it',
    password: 'segreta',
    store: {
      list: async () => [],
      get: async () => null,
      put: async () => undefined,
      remove: async () => undefined,
      replace: async () => undefined
    },
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers)

      if (digest && !headers.get('authorization')?.startsWith('Digest ')) {
        return new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Digest realm="dav", nonce="n0", qop="auth"' }
        })
      }

      if (init?.method === 'OPTIONS') {
        asked.push(headers)
        return options()
      }

      const depth = headers.get('depth')

      if (url === `${SERVER}.well-known/caldav`) {
        return new Response(null, { status: 404 })
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
        return multistatus(ok('/mattia/lavoro/', '<supported-report-set />'))
      }

      throw new Error(`Not on the fake network: ${init?.method} ${url}`)
    }
  })

  return { provider, asked }
}

const scheduling = (): Response =>
  new Response(null, {
    headers: { DAV: '1, 2, access-control, calendar-access, calendar-auto-schedule' }
  })

describe('CalDavCalendarProvider.schedules', () => {
  it('asks as every other request does — its language, its sign-in — and reads the DAV header', async () => {
    const { provider, asked } = davServer(scheduling)
    const [calendar] = await provider.listCalendars()

    expect(calendar.calendarId).toBe(CALENDAR)
    expect(await provider.schedules(CALENDAR)).toBe(true)
    expect(asked[0].get('accept-language')).toMatch(/^en-US/)
    expect(asked[0].get('authorization')).toMatch(/^Basic /)
  })

  it('asks a server that signs in with Digest with Digest', async () => {
    const { provider, asked } = davServer(scheduling, true)
    await provider.listCalendars()

    expect(await provider.schedules(CALENDAR)).toBe(true)
    expect(asked.at(-1)?.get('authorization')).toMatch(/^Digest /)
  })

  it('takes a server error for no answer, asked again next time; a server without OPTIONS does not schedule', async () => {
    const answers = [new Response(null, { status: 500 }), scheduling()]
    const { provider } = davServer(() => answers.shift()!)
    await provider.listCalendars()

    await expect(provider.schedules(CALENDAR)).rejects.toThrow(
      'The calendar’s server didn’t say whether it sends invitations: the server answered 500.'
    )
    expect(await provider.schedules(CALENDAR)).toBe(true)

    const { provider: plain } = davServer(() => new Response(null, { status: 405 }))
    await plain.listCalendars()
    expect(await plain.schedules(CALENDAR)).toBe(false)
  })
})

describe('CalDavCalendarProvider, turned down', () => {
  const signedIn = (fetch: Fetch): CalDavCalendarProvider =>
    new CalDavCalendarProvider({
      serverUrl: SERVER,
      username: 'mattia@studio.it',
      password: 'vecchia',
      store: {
        list: async () => [],
        get: async () => null,
        put: async () => undefined,
        remove: async () => undefined,
        replace: async () => undefined
      },
      fetch
    })

  it('reads the status tsdav reports only in its words', () => {
    expect(
      davStatusOf(new Error('Invalid credentials: PROPFIND https://x/ returned 401 Unauthorized'))
    ).toBe(401)
    expect(davStatusOf(new Error('Calendar discovery failed: 404 Not Found'))).toBe(404)
    expect(davStatusOf(new Error('Collection query failed: 403 Forbidden. '))).toBe(403)
    // A property the server would not give is not the collection's answer.
    expect(
      davStatusOf(new Error('Calendar discovery failed: resourcetype returned 404 Not Found'))
    ).toBeNull()
    expect(davStatusOf(new Error('cannot find homeUrl'))).toBeNull()
  })

  it('takes a password the server refuses for the access refused: the whole connection’s', async () => {
    const refused = await signedIn(async () => new Response(null, { status: 401 }))
      .listCalendars()
      .catch((error: unknown) => error)

    expect(refusalOfCalendar(refused)).toMatchObject({
      refusal: 'accesso',
      problem: 'The calendar’s server didn’t accept the username and password.',
      detail: expect.stringMatching(/^Invalid credentials/)
    })
  })

  it('takes a home of calendars no longer on the server for the calendars gone', async () => {
    const gone = await signedIn(async (url, init) => {
      const depth = new Headers(init?.headers).get('depth')

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

      return new Response(null, { status: 404 })
    })
      .listCalendars()
      .catch((error: unknown) => error)

    expect(refusalOfCalendar(gone)).toMatchObject({
      refusal: 'sparito',
      problem: 'The calendars are no longer at that server address.'
    })
  })

  it('takes a calendar the server will not let be asked for that request alone', async () => {
    const { provider } = davServer(() => new Response(null, { status: 403 }))
    await provider.listCalendars()

    const denied = await provider.schedules(CALENDAR).catch((error: unknown) => error)
    expect(denied).toMatchObject({
      message:
        'The calendar’s server didn’t say whether it sends invitations: the server doesn’t allow it.',
      status: 403,
      refusal: null
    })
    expect(refusalOfCalendar(denied)).toBeNull()
  })
})

describe('CalDavCalendarProvider.move', () => {
  const VITA = `${HOME}vita/`
  const OBJECT = `${CALENDAR}visita.ics`
  const visit = (attendee = ''): string =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:visita@studio',
      'DTSTAMP:20261101T000000Z',
      'DTSTART:20261120T090000Z',
      'DTEND:20261120T100000Z',
      'SUMMARY:Visita',
      ...(attendee ? [`ATTENDEE:mailto:${attendee}`] : []),
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

  /**
   * A server with two calendars, the event in the first: MOVE answered by
   * `move`, a PUT by `put`; every request kept.
   */
  function server(
    move: () => Response,
    put: () => Response = () => new Response(null, { status: 201, headers: { ETag: '"c1"' } })
  ): {
    provider: CalDavCalendarProvider
    asked: Array<{ method: string; url: string; headers: Headers; body: string }>
    kept: Map<string, string>
  } {
    const asked: Array<{ method: string; url: string; headers: Headers; body: string }> = []
    const kept = new Map([[OBJECT, visit()]])
    const provider = new CalDavCalendarProvider({
      serverUrl: SERVER,
      username: 'mattia@studio.it',
      password: 'segreta',
      store: {
        list: async () => [],
        get: async (url) => (kept.has(url) ? { url, etag: '"1"', data: kept.get(url)! } : null),
        put: async (_calendarId, objects) =>
          objects.forEach((object) => kept.set(object.url, object.data)),
        remove: async (urls) => urls.forEach((url) => kept.delete(url)),
        replace: async () => undefined
      },
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers)
        const method = init?.method ?? 'GET'
        asked.push({ method, url, headers, body: typeof init?.body === 'string' ? init.body : '' })
        const depth = headers.get('depth')

        if (method === 'MOVE') {
          return move()
        }

        if (method === 'PUT') {
          return put()
        }

        if (method === 'DELETE') {
          return new Response(null, { status: 204 })
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
          const calendar = (href: string, name: string): string =>
            ok(
              href,
              `<displayname>${name}</displayname><resourcetype><C:calendar /><collection /></resourcetype><C:supported-calendar-component-set><C:comp name="VEVENT" /></C:supported-calendar-component-set>`
            )
          return multistatus(
            calendar('/mattia/lavoro/', 'Lavoro') + calendar('/mattia/vita/', 'Vita')
          )
        }

        if (method === 'REPORT' && url === VITA) {
          return multistatus(
            ok(
              '/mattia/vita/visita.ics',
              `<getetag>"2"</getetag><C:calendar-data>${visit()}</C:calendar-data>`
            )
          )
        }

        return multistatus(ok(new URL(url).pathname, '<supported-report-set />'))
      }
    })

    return { provider, asked, kept }
  }

  it('moves the object with WebDAV’s MOVE, never over another, and leaves it to the read that follows', async () => {
    const { provider, asked, kept } = server(() => new Response(null, { status: 201 }))
    await provider.listCalendars()

    expect(await provider.move(CALENDAR, OBJECT, VITA, { guests: true })).toEqual({
      eventId: `${VITA}visita.ics`,
      how: 'native'
    })

    const moved = asked.find((request) => request.method === 'MOVE')!
    expect(moved.url).toBe(OBJECT)
    expect(moved.headers.get('destination')).toBe(`${VITA}visita.ics`)
    expect(moved.headers.get('overwrite')).toBe('F')
    // Kept where it went, the read the service makes next would find it unchanged, and none of it.
    expect([...kept.keys()]).toEqual([])
  })

  it('where the server will not move it, copies the same object there and takes the old away — only without guests', async () => {
    const { provider, asked, kept } = server(() => new Response(null, { status: 405 }))
    await provider.listCalendars()

    expect(await provider.move(CALENDAR, OBJECT, VITA, { guests: false })).toEqual({
      eventId: `${VITA}visita.ics`,
      how: 'copy'
    })

    const copied = asked.find((request) => request.method === 'PUT')!
    expect(copied.url).toBe(`${VITA}visita.ics`)
    expect(copied.headers.get('if-none-match')).toBe('*')
    expect(copied.body).toContain('UID:visita@studio')
    expect(asked.find((request) => request.method === 'DELETE')?.url).toBe(OBJECT)
    expect([...kept.keys()]).toEqual([])

    const invited = server(() => new Response(null, { status: 405 }))
    await invited.provider.listCalendars()
    await expect(invited.provider.move(CALENDAR, OBJECT, VITA, { guests: true })).rejects.toThrow(
      'a copy would cancel the invitation for the invitees'
    )
    expect(invited.asked.some((request) => request.method === 'PUT')).toBe(false)
  })

  it('says so where the server will have the same event in one calendar only, and leaves it where it is', async () => {
    const { provider, asked, kept } = server(
      () => new Response(null, { status: 501 }),
      () =>
        new Response(
          '<?xml version="1.0"?><error xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><C:no-uid-conflict><href>/mattia/lavoro/visita.ics</href></C:no-uid-conflict></error>',
          { status: 403 }
        )
    )
    await provider.listCalendars()

    await expect(provider.move(CALENDAR, OBJECT, VITA, { guests: false })).rejects.toThrow(
      'The server neither moves the event nor takes a copy of it'
    )
    expect(asked.some((request) => request.method === 'DELETE')).toBe(false)
    expect([...kept.keys()]).toEqual([OBJECT])
  })

  it('keeps an event it writes, but leaves a series to the read that follows: kept at the server’s version, that read would make none of its occurrences', async () => {
    const { provider, kept } = server(() => new Response(null, { status: 201 }))
    await provider.listCalendars()
    const event = {
      title: 'Corso',
      start: '2026-11-16T17:00:00.000Z',
      end: '2026-11-16T18:00:00.000Z',
      allDay: false,
      location: null,
      description: null,
      attendees: [],
      recurrence: null,
      reminders: null
    }

    const single = await provider.create(VITA, event, null)
    const series = await provider.create(
      VITA,
      { ...event, recurrence: { frequency: 'weekly', interval: 1, count: 3 } },
      null
    )

    expect(kept.has(single.eventId)).toBe(true)
    expect(series.seriesId).not.toBeNull()
    expect([...kept.keys()].some((url) => series.eventId.startsWith(url))).toBe(false)
  })
})
