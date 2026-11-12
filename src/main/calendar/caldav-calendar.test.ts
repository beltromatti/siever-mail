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
