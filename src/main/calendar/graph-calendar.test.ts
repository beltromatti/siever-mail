import { describe, expect, it } from 'vitest'

import { SyncTokenExpired } from './calendar-provider'
import { refusalOfCalendar } from './calendar-refusal'
import {
  GraphCalendarProvider,
  MAILBOX_ZONE_NOT_GRANTED,
  eventOfGraph,
  type GraphEvent
} from './graph-calendar'

/**
 * Graph's iCalUId is Exchange's Global Object ID in hex. A meeting
 * organised in Google, as an Exchange mailbox keeps it: its UID wrapped as
 * "vCal-Uid" — the series, and one instance of it, 16 November 2026.
 */
const FROM_GOOGLE =
  '040000008200E00074C5B7101A82E0080000000000000000000000000000000000000000310000007643616C2D5569640100000036636136376536622D666162342D346262622D623262352D36666238346466643261623700'
const FROM_GOOGLE_16_NOV =
  '040000008200E00074C5B7101A82E00807EA0B1000000000000000000000000000000000310000007643616C2D5569640100000036636136376536622D666162342D346262622D623262352D36666238346466643261623700'
/** A meeting organised in Exchange: an instance of it (23 November 2026), and the UID its invitations carry. */
const EXCHANGE_23_NOV =
  '040000008200E00074C5B7101A82E00807EA0B175025D461E473C801000000000000000010000000C8D3A9E2D1A84B4DB0C2F7A6F2D4C1B3'
const EXCHANGE_UID =
  '040000008200E00074C5B7101A82E008000000005025D461E473C801000000000000000010000000C8D3A9E2D1A84B4DB0C2F7A6F2D4C1B3'

const meeting: GraphEvent = {
  id: 'AAMk-1',
  iCalUId: FROM_GOOGLE,
  subject: 'Collaudo sprinkler',
  body: { contentType: 'html', content: '<p>Portare il <b>verbale</b>.</p>' },
  start: { dateTime: '2026-11-12T08:30:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-11-12T10:00:00.0000000', timeZone: 'UTC' },
  isAllDay: false,
  isOrganizer: false,
  location: { displayName: 'Magazzino Logistica Padana' },
  organizer: { emailAddress: { address: 'Giorgio.Sala@Padana.it', name: 'Giorgio Sala' } },
  attendees: [
    {
      emailAddress: { address: 'mattia@brenta.it', name: 'Mattia' },
      status: { response: 'tentativelyAccepted' }
    },
    {
      emailAddress: { address: 'giorgio.sala@padana.it', name: 'Giorgio Sala' },
      status: { response: 'organizer' }
    }
  ],
  responseStatus: { response: 'tentativelyAccepted' },
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
  webLink: 'https://outlook.office365.com/owa/?itemid=AAMk-1'
}

interface Asked {
  method: string
  url: string
  body: unknown
  /** The token it went with. */
  token: string
}

/**
 * Graph on a fake network: each request answered by the first route its
 * method and path match. The account consented to the mailbox's settings
 * unless `mailboxSettings` is false.
 */
function graph(
  routes: Array<[method: string, path: RegExp, answer: (asked: Asked) => Response | unknown]>,
  consent: { mailboxSettings: boolean } = { mailboxSettings: true }
): { provider: GraphCalendarProvider; asked: Asked[] } {
  const asked: Asked[] = []
  const provider = new GraphCalendarProvider(
    {
      calendar: async () => 'calendars',
      mailboxSettings: async () => (consent.mailboxSettings ? 'mailbox-settings' : null)
    },
    'mattia@brenta.it',
    async (input, init) => {
      const headers = init?.headers as Record<string, string>
      const request = {
        method: init?.method ?? 'GET',
        url: input,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        token: headers.Authorization.replace(/^Bearer /, '')
      }
      asked.push(request)
      expect(headers.Prefer).toContain('outlook.timezone="UTC"')
      const route = routes.find(
        ([method, path]) => method === request.method && path.test(decodeURIComponent(input))
      )

      if (!route) {
        throw new Error(`Not on the fake network: ${request.method} ${input}`)
      }

      const answer = route[2](request)
      return answer instanceof Response ? answer : new Response(JSON.stringify(answer))
    }
  )

  return { provider, asked }
}

const notFound = (): Response =>
  new Response(JSON.stringify({ error: { code: 'ErrorItemNotFound' } }), { status: 404 })

describe('eventOfGraph', () => {
  it('reads an invitation: UTC times, the user’s answer, the call, the body as text, the UID it was sent with', () => {
    expect(eventOfGraph(meeting, 'cal-1', 'mattia@brenta.it', true)).toMatchObject({
      calendarId: 'cal-1',
      eventId: 'AAMk-1',
      iCalUid: '6ca67e6b-fab4-4bbb-b2b5-6fb84dfd2ab7',
      start: '2026-11-12T08:30:00.000Z',
      end: '2026-11-12T10:00:00.000Z',
      organizer: 'giorgio.sala@padana.it',
      myResponse: 'tentative',
      meetLink: 'https://teams.microsoft.com/l/meetup-join/abc',
      description: 'Portare il **verbale**.',
      cancelled: false
    })
  })

  it('gives an instance the UID its invitations carry: the wrapped one, or Exchange’s without the date', () => {
    expect(
      eventOfGraph({ ...meeting, iCalUId: FROM_GOOGLE_16_NOV }, 'cal-1', 'mattia@brenta.it', true)
        .iCalUid
    ).toBe('6ca67e6b-fab4-4bbb-b2b5-6fb84dfd2ab7')
    expect(
      eventOfGraph({ ...meeting, iCalUId: EXCHANGE_23_NOV }, 'cal-1', 'mattia@brenta.it', true)
        .iCalUid
    ).toBe(EXCHANGE_UID)
  })

  it('has no answer of the user’s in a calendar someone shares: its owner’s is not theirs', () => {
    expect(eventOfGraph(meeting, 'cal-shared', 'mattia@brenta.it', false).myResponse).toBeNull()
  })

  it('reads an all-day event by its days, and the user’s own event without an answer', () => {
    const day = eventOfGraph(
      {
        id: 'AAMk-2',
        subject: 'Ferie',
        isAllDay: true,
        isOrganizer: true,
        start: { dateTime: '2026-12-24T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-12-27T00:00:00.0000000', timeZone: 'UTC' }
      },
      'cal-1',
      'mattia@brenta.it',
      true
    )

    expect([day.start, day.end, day.allDay, day.myResponse]).toEqual([
      '2026-12-24',
      '2026-12-27',
      true,
      null
    ])
  })
})

describe('GraphCalendarProvider', () => {
  const calendars = {
    value: [
      { id: 'cal 1', name: 'Calendario', isDefaultCalendar: true, canEdit: true },
      {
        id: 'cal-luca',
        name: 'Luca',
        canEdit: true,
        owner: { address: 'luca@brenta.it' }
      }
    ],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=2'
  }

  it('lists every page of calendars, and knows the ones others share', async () => {
    const { provider } = graph([
      [
        'GET',
        /\/me\/calendars\?\$skiptoken=2$/,
        () => ({ value: [{ id: 'cal-3', name: 'Cantieri', canEdit: false }] })
      ],
      ['GET', /\/me\/calendars\?\$select=/, () => calendars],
      [
        'GET',
        /calendarView\/delta/,
        () => ({ value: [meeting], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/d' })
      ]
    ])

    expect((await provider.listCalendars()).map((calendar) => calendar.calendarId)).toEqual([
      'cal 1',
      'cal-luca',
      'cal-3'
    ])
    const window = { fromIso: '2026-11-01T00:00:00.000Z', toIso: '2026-12-31T00:00:00.000Z' }
    expect((await provider.changes('cal 1', window)).events[0].myResponse).toBe('tentative')
    expect((await provider.changes('cal-luca', window)).events[0].myResponse).toBeNull()
  })

  it('follows the delta’s pages; of what it says removed, takes as gone what is, and keeps what moved out of the window', async () => {
    const moved: GraphEvent = {
      ...meeting,
      id: 'AAMk-moved',
      start: { dateTime: '2028-03-01T08:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2028-03-01T09:00:00.0000000', timeZone: 'UTC' }
    }
    const { provider, asked } = graph([
      [
        'GET',
        /\/me\/calendars\/cal 1\?\$select=/,
        () => ({ id: 'cal 1', isDefaultCalendar: true })
      ],
      [
        'GET',
        /calendarView\/delta/,
        () => ({
          value: [meeting],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page'
        })
      ],
      [
        'GET',
        /next-page$/,
        () => ({
          value: [
            { id: 'AAMk-9', '@removed': { reason: 'deleted' } },
            { id: 'AAMk-private', '@removed': { reason: 'deleted' } },
            { id: 'AAMk-moved', '@removed': { reason: 'deleted' } }
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=z'
        })
      ],
      ['GET', /\/events\/AAMk-9$/, notFound],
      [
        'GET',
        /\/events\/AAMk-private$/,
        () =>
          new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 })
      ],
      ['GET', /\/events\/AAMk-moved$/, () => moved]
    ])

    const { events, syncToken } = await provider.changes('cal 1', {
      fromIso: '2026-11-01T00:00:00.000Z',
      toIso: '2026-12-31T00:00:00.000Z'
    })

    expect(asked[0].url).toContain(
      '/me/calendars/cal%201/calendarView/delta?startDateTime=2026-11-01'
    )
    // Made private in a calendar shared with the user, or no longer shared: gone for them.
    expect(events.map((event) => [event.eventId, event.cancelled, event.start])).toEqual([
      ['AAMk-1', false, '2026-11-12T08:30:00.000Z'],
      ['AAMk-9', true, ''],
      ['AAMk-private', true, ''],
      ['AAMk-moved', false, '2028-03-01T08:00:00.000Z']
    ])
    expect(syncToken).toBe('https://graph.microsoft.com/v1.0/delta?token=z')
  })

  it('reads the whole delta again at the next sync when an event it took out cannot be asked for now', async () => {
    const { provider } = graph([
      [
        'GET',
        /\/me\/calendars\/cal-1\?\$select=/,
        () => ({ id: 'cal-1', isDefaultCalendar: true })
      ],
      [
        'GET',
        /token=old/,
        () => ({
          value: [{ id: 'AAMk-9', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=new'
        })
      ],
      [
        'GET',
        /\/events\/AAMk-9$/,
        () =>
          new Response(JSON.stringify({ error: { code: 'ServiceUnavailable' } }), { status: 503 })
      ]
    ])

    await expect(
      provider.changes('cal-1', { syncToken: 'https://graph.microsoft.com/v1.0/delta?token=old' })
    ).rejects.toThrow('Microsoft ha risposto 503 (ServiceUnavailable)')
  })

  it('gives each instance of a series the series’ UID, the one an invitation names, from its own', async () => {
    const occurrence = (id: string, day: string, iCalUId: string): GraphEvent => ({
      ...meeting,
      id,
      iCalUId,
      start: { dateTime: `2026-11-${day}T08:30:00.0000000`, timeZone: 'UTC' },
      end: { dateTime: `2026-11-${day}T09:30:00.0000000`, timeZone: 'UTC' }
    })
    const { provider, asked } = graph([
      [
        'GET',
        /\/me\/calendars\/cal-1\?\$select=/,
        () => ({ id: 'cal-1', isDefaultCalendar: true })
      ],
      [
        'GET',
        /calendarView\/delta/,
        () => ({
          value: [
            occurrence('AAMk-a', '16', FROM_GOOGLE_16_NOV),
            occurrence('AAMk-b', '23', EXCHANGE_23_NOV)
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=y'
        })
      ]
    ])

    const { events } = await provider.changes('cal-1', {
      fromIso: '2026-11-01T00:00:00.000Z',
      toIso: '2026-12-31T00:00:00.000Z'
    })

    expect(events.map((event) => event.iCalUid)).toEqual([
      '6ca67e6b-fab4-4bbb-b2b5-6fb84dfd2ab7',
      EXCHANGE_UID
    ])
    // Read from the instances alone: no request for their series.
    expect(asked.map((request) => request.url).filter((url) => url.includes('/events/'))).toEqual(
      []
    )
  })

  it('takes a token Graph refuses for the authorization withdrawn — the whole connection’s — and a calendar refused for that calendar’s', async () => {
    const { provider } = graph([
      [
        'GET',
        /\/me\/calendars\?\$select=/,
        () =>
          new Response(
            JSON.stringify({
              error: { code: 'InvalidAuthenticationToken', message: 'Lifetime validation failed' }
            }),
            { status: 401 }
          )
      ],
      [
        'GET',
        /calendarView\/delta/,
        () =>
          new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 })
      ]
    ])

    const withdrawn = await provider.listCalendars().catch((error: unknown) => error)
    expect(withdrawn).toMatchObject({ status: 401, refusal: 'autorizzazione' })
    expect(refusalOfCalendar(withdrawn)).toEqual({
      refusal: 'autorizzazione',
      problem: 'Microsoft non accetta più l’accesso a questo calendario: ricollegalo.',
      detail: 'Microsoft ha risposto 401 (InvalidAuthenticationToken): Lifetime validation failed'
    })

    const window = { fromIso: '2026-11-01T00:00:00.000Z', toIso: '2026-12-31T00:00:00.000Z' }
    const denied = await provider.changes('cal-luca', window).catch((error: unknown) => error)
    expect(denied).toMatchObject({ status: 403, refusal: null })
    expect(refusalOfCalendar(denied)).toBeNull()
  })

  it('reads again from the start when Graph no longer knows the delta', async () => {
    const { provider } = graph([
      [
        'GET',
        /token=old/,
        () =>
          new Response(JSON.stringify({ error: { code: 'syncStateNotFound', message: 'gone' } }), {
            status: 410
          })
      ]
    ])

    await expect(
      provider.changes('cal-1', { syncToken: 'https://graph/delta?token=old' })
    ).rejects.toBeInstanceOf(SyncTokenExpired)
  })

  it('writes only what changed: the guests as they were — optional, a room, their names — the body as HTML', async () => {
    const { provider, asked } = graph([
      [
        'GET',
        /\/me\/calendars\/cal-1\?\$select=/,
        () => ({ id: 'cal-1', isDefaultCalendar: true })
      ],
      [
        'GET',
        /\/events\/AAMk-1\?\$select=attendees$/,
        () => ({
          attendees: [
            {
              emailAddress: { address: 'Luca@Brenta.it', name: 'Luca Bianchi' },
              type: 'optional',
              status: { response: 'accepted' }
            },
            {
              emailAddress: { address: 'sala-riunioni@brenta.it', name: 'Sala riunioni' },
              type: 'resource'
            },
            { emailAddress: { address: 'tolto@brenta.it' }, type: 'required' }
          ]
        })
      ],
      [
        'PATCH',
        /\/me\/calendars\/cal-1\/events\/AAMk-1$/,
        () => ({ ...meeting, isOrganizer: true })
      ]
    ])

    await provider.update(
      'cal-1',
      'AAMk-1',
      {
        title: 'ignorato',
        start: '2026-11-12T08:30:00.000Z',
        end: '2026-11-12T10:00:00.000Z',
        allDay: false,
        location: null,
        description:
          'Portare il **verbale**.\n[Partecipa](https://teams.microsoft.com/l/meetup-join/abc)\n\n<div style="display:none"><img src="https://x.example/p.png" onerror="alert(1)"></div>',
        attendees: ['luca@brenta.it', 'sala-riunioni@brenta.it', 'nuovo@brenta.it']
      },
      true,
      new Set(['description', 'attendees'])
    )

    const patch = asked.find((request) => request.method === 'PATCH')!.body as {
      body: { contentType: string; content: string }
      attendees: unknown
    }
    expect(Object.keys(patch).sort()).toEqual(['attendees', 'body'])
    expect(patch.body.contentType).toBe('html')
    expect(patch.body.content).toContain('<strong>verbale</strong>')
    expect(patch.body.content).toContain('<a href="https://teams.microsoft.com/l/meetup-join/abc">')
    // Markup written in the text — from someone's mail, perhaps — goes to the guests as text.
    expect(patch.body.content).toContain(
      '&lt;div style=&quot;display:none&quot;&gt;&lt;img src=&quot;https://x.example/p.png&quot; onerror=&quot;alert(1)&quot;&gt;&lt;/div&gt;'
    )
    expect(patch.body.content).not.toMatch(/<(div|img)\b/)
    expect(patch.attendees).toEqual([
      { emailAddress: { address: 'Luca@Brenta.it', name: 'Luca Bianchi' }, type: 'optional' },
      {
        emailAddress: { address: 'sala-riunioni@brenta.it', name: 'Sala riunioni' },
        type: 'resource'
      },
      { emailAddress: { address: 'nuovo@brenta.it' }, type: 'required' }
    ])
  })

  it('writes an all-day event as its days’ midnights in the mailbox’s time zone', async () => {
    const { provider, asked } = graph([
      [
        'GET',
        /\/me\/calendars\/cal-1\?\$select=/,
        () => ({ id: 'cal-1', isDefaultCalendar: true })
      ],
      ['GET', /\/me\/mailboxSettings\/timeZone$/, () => ({ value: 'W. Europe Standard Time' })],
      [
        'POST',
        /\/me\/calendars\/cal-1\/events$/,
        () => ({
          id: 'AAMk-3',
          subject: 'Ferie',
          isAllDay: true,
          isOrganizer: true,
          start: { dateTime: '2026-12-24T00:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-12-27T00:00:00.0000000', timeZone: 'UTC' }
        })
      ]
    ])

    const created = await provider.create(
      'cal-1',
      {
        title: 'Ferie',
        start: '2026-12-24',
        end: '2026-12-27',
        allDay: true,
        location: null,
        description: null,
        attendees: []
      },
      null
    )

    // The time zone with its own token; the calendar with the calendar's.
    expect(asked.map((request) => [request.method, request.token])).toEqual([
      ['GET', 'calendars'],
      ['GET', 'mailbox-settings'],
      ['POST', 'calendars']
    ])
    expect(asked.find((request) => request.method === 'POST')!.body).toMatchObject({
      isAllDay: true,
      start: { dateTime: '2026-12-24T00:00:00', timeZone: 'W. Europe Standard Time' },
      end: { dateTime: '2026-12-27T00:00:00', timeZone: 'W. Europe Standard Time' }
    })
    expect([created.start, created.end]).toEqual(['2026-12-24', '2026-12-27'])
  })

  it('without the consent to the mailbox’s settings, syncs and writes timed events, and refuses an all-day one rather than put it on the wrong days', async () => {
    const created = {
      id: 'AAMk-4',
      subject: 'Sopralluogo',
      isOrganizer: true,
      start: { dateTime: '2026-11-20T09:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-20T10:00:00.0000000', timeZone: 'UTC' }
    }
    const { provider, asked } = graph(
      [
        [
          'GET',
          /\/me\/calendars\/cal-1\?\$select=/,
          () => ({ id: 'cal-1', isDefaultCalendar: true })
        ],
        ['POST', /\/me\/calendars\/cal-1\/events$/, () => created]
      ],
      { mailboxSettings: false }
    )
    const visit = {
      title: 'Sopralluogo',
      start: '2026-11-20T09:00:00.000Z',
      end: '2026-11-20T10:00:00.000Z',
      allDay: false,
      location: null,
      description: null,
      attendees: []
    }

    expect(await provider.mailboxZoneGranted()).toBe(false)
    await expect(
      provider.create(
        'cal-1',
        { ...visit, start: '2026-11-20', end: '2026-11-21', allDay: true },
        null
      )
    ).rejects.toThrow(MAILBOX_ZONE_NOT_GRANTED)
    expect(asked.some((request) => request.method === 'POST')).toBe(false)

    expect((await provider.create('cal-1', visit, null)).eventId).toBe('AAMk-4')
    expect(asked.find((request) => request.method === 'POST')!.body).toMatchObject({
      start: { dateTime: '2026-11-20T09:00:00.000', timeZone: 'UTC' }
    })
  })
})
