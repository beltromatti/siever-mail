import { describe, expect, it } from 'vitest'

import {
  CalDavCalendarProvider,
  davFeatures,
  type CalendarObjectStore,
  type StoredObject
} from './caldav-calendar'

/**
 * Against a real CalDAV server: run with CALDAV_TEST_URL (a server with an
 * empty calendar named "Lavoro"), CALDAV_TEST_USER and CALDAV_TEST_PASSWORD.
 * Radicale does: `python -m radicale --auth-type htpasswd …`, then MKCALENDAR.
 */
const server = process.env.CALDAV_TEST_URL
const username = process.env.CALDAV_TEST_USER ?? ''
const password = process.env.CALDAV_TEST_PASSWORD ?? ''

function memoryStore(): CalendarObjectStore {
  const objects = new Map<string, StoredObject & { calendarId: string }>()

  return {
    list: async (calendarId) =>
      [...objects.values()].filter((object) => object.calendarId === calendarId),
    get: async (url) => objects.get(url) ?? null,
    put: async (calendarId, list) =>
      list.forEach((object) => objects.set(object.url, { ...object, calendarId })),
    remove: async (urls) => urls.forEach((url) => objects.delete(url)),
    replace: async (calendarId, list) => {
      for (const [url, object] of objects) {
        if (object.calendarId === calendarId) {
          objects.delete(url)
        }
      }

      list.forEach((object) => objects.set(object.url, { ...object, calendarId }))
    }
  }
}

/** Another client writing on the same server. */
const elsewhere = (url: string, init: RequestInit): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'Content-Type': 'text/calendar; charset=utf-8',
      ...(init.headers as Record<string, string> | undefined)
    }
  })

const window = { fromIso: '2026-11-01T00:00:00.000Z', toIso: '2026-12-31T00:00:00.000Z' }

describe.skipIf(!server)('CalDavCalendarProvider (a real server)', () => {
  it('asks whether the server schedules as it asks everything else, and reads its answer', async () => {
    const asked: Headers[] = []
    const provider = new CalDavCalendarProvider({
      serverUrl: server!,
      username,
      password,
      store: memoryStore(),
      fetch: async (url, init) => {
        if (init?.method === 'OPTIONS') {
          asked.push(new Headers(init.headers))
        }

        return fetch(url, init)
      }
    })
    const calendar = (await provider.listCalendars()).find(
      (candidate) => candidate.name === 'Lavoro'
    )!
    const said = (await elsewhere(calendar.calendarId, { method: 'OPTIONS' })).headers.get('dav')

    expect(await provider.schedules(calendar.calendarId)).toBe(
      davFeatures(said).has('calendar-auto-schedule')
    )
    expect(asked[0].get('authorization')).toBeTruthy()
    expect(asked[0].get('accept-language')).toMatch(/^it-IT/)
  })

  it('lists, creates, syncs what others change, moves an instance, answers an invitation', async () => {
    const store = memoryStore()
    const provider = (): CalDavCalendarProvider =>
      new CalDavCalendarProvider({ serverUrl: server!, username, password, fetch, store })
    const first = provider()
    const calendar = (await first.listCalendars()).find((candidate) => candidate.name === 'Lavoro')!

    expect(calendar).toMatchObject({ writable: true, color: '#3b82f6', primary: true })

    const read = await first.changes(calendar.calendarId, window)
    expect(read.events).toEqual([])

    // Guests only where the server tells them (RFC 6638): Radicale does not.
    const schedules = await first.schedules(calendar.calendarId)
    const visit = {
      title: 'Sopralluogo',
      start: '2026-11-20T09:00:00.000Z',
      end: '2026-11-20T10:00:00.000Z',
      allDay: false,
      location: 'Cantiere',
      description: null,
      attendees: ['davide@studio.it']
    }
    const origin = { by: 'segretario', accountId: 'a', messageKey: 'k' } as const

    if (!schedules) {
      await expect(first.create(calendar.calendarId, visit, origin)).rejects.toThrow(
        /doesn’t send invitations/
      )
    }

    const created = await first.create(
      calendar.calendarId,
      schedules ? visit : { ...visit, attendees: [] },
      origin
    )
    expect(created).toMatchObject({ title: 'Sopralluogo', origin: { by: 'segretario' } })

    // Nothing new for a sync after our own write.
    let state = await provider().changes(calendar.calendarId, { syncToken: read.syncToken! })
    expect(state.events).toEqual([])

    // A weekly series put there by another client.
    const seriesUrl = new URL('settimanale.ics', calendar.calendarId).toString()
    await elsewhere(seriesUrl, {
      method: 'PUT',
      body: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//altro//IT',
        'BEGIN:VEVENT',
        'UID:settimanale@altro',
        'DTSTAMP:20261101T000000Z',
        'DTSTART:20261102T080000Z',
        'DTEND:20261102T083000Z',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'SUMMARY:Riunione',
        'ORGANIZER:mailto:capo@studio.it',
        `ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${username}`,
        'END:VEVENT',
        'END:VCALENDAR',
        ''
      ].join('\r\n')
    })
    state = await provider().changes(calendar.calendarId, { syncToken: state.syncToken! })
    const series = state.events.filter((event) => event.title === 'Riunione')
    expect(series.map((event) => event.start)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-09T08:00:00.000Z',
      '2026-11-16T08:00:00.000Z',
      '2026-11-23T08:00:00.000Z'
    ])

    // One instance moved, another taken out: the series keeps the rest.
    const moved = await first.update(
      calendar.calendarId,
      series[1].eventId,
      {
        title: 'Riunione spostata',
        start: '2026-11-10T14:00:00.000Z',
        end: '2026-11-10T14:30:00.000Z',
        allDay: false,
        location: null,
        description: null,
        attendees: []
      },
      false,
      new Set(['title', 'time'])
    )
    expect(moved).toMatchObject({ eventId: series[1].eventId, start: '2026-11-10T14:00:00.000Z' })
    await first.remove(calendar.calendarId, series[2].eventId, false)

    const again = await provider().changes(calendar.calendarId, window)
    expect(
      again.events
        .filter((event) => event.iCalUid === 'settimanale@altro')
        .map((event) => [event.title, event.start])
    ).toEqual([
      ['Riunione', '2026-11-02T08:00:00.000Z'],
      ['Riunione spostata', '2026-11-10T14:00:00.000Z'],
      ['Riunione', '2026-11-23T08:00:00.000Z']
    ])

    // The user answers the invitation of the series: their own PARTSTAT on the server, which
    // tells the organizer — or, on a server that would not, the answer goes by mail instead.
    if (schedules) {
      const answered = await first.respond(calendar.calendarId, series[0].eventId, 'accepted', true)
      expect(answered.myResponse).toBe('accepted')
      const onServer = await (await elsewhere(seriesUrl, { method: 'GET' })).text()
      expect(onServer).toMatch(/PARTSTAT=ACCEPTED/)
    } else {
      await expect(
        first.respond(calendar.calendarId, series[0].eventId, 'accepted', true)
      ).rejects.toThrow(/doesn’t notify the organizer/)
    }

    // Deleted by another client: its events go at the next sync.
    await elsewhere(seriesUrl, { method: 'DELETE' })
    const afterDelete = await provider().changes(calendar.calendarId, {
      syncToken: again.syncToken!
    })
    expect(afterDelete.events.filter((event) => event.cancelled).length).toBeGreaterThan(0)

    await first.remove(calendar.calendarId, created.eventId, schedules)
  })
})
