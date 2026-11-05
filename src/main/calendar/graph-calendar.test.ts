import { describe, expect, it } from 'vitest'

import { SyncTokenExpired } from './calendar-provider'
import { GraphCalendarProvider, eventOfGraph, type GraphEvent } from './graph-calendar'

const meeting: GraphEvent = {
  id: 'AAMk-1',
  uid: '040000008200E00074C5B7101A82E008',
  iCalUId: '040000008200E00074C5B7101A82E008-occ',
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
      emailAddress: { address: 'mattia@siever.it', name: 'Mattia' },
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

describe('eventOfGraph', () => {
  it('reads an invitation: UTC times, the user’s answer, the call, the body as text', () => {
    expect(eventOfGraph(meeting, 'cal-1', 'mattia@siever.it')).toMatchObject({
      calendarId: 'cal-1',
      eventId: 'AAMk-1',
      iCalUid: '040000008200E00074C5B7101A82E008',
      start: '2026-11-12T08:30:00.000Z',
      end: '2026-11-12T10:00:00.000Z',
      organizer: 'giorgio.sala@padana.it',
      myResponse: 'tentative',
      meetLink: 'https://teams.microsoft.com/l/meetup-join/abc',
      description: 'Portare il **verbale**.',
      cancelled: false
    })
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
      'mattia@siever.it'
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
  it('follows the delta’s pages, takes what was removed as gone, and keeps the delta link', async () => {
    const asked: string[] = []
    const pages: Record<string, unknown> = {
      first: { value: [meeting], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page' },
      'next-page': {
        value: [{ id: 'AAMk-9', '@removed': { reason: 'deleted' } }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=z'
      }
    }
    const provider = new GraphCalendarProvider(
      async () => 'token',
      'mattia@siever.it',
      async (input, init) => {
        asked.push(input)
        expect((init?.headers as Record<string, string>).Prefer).toContain('outlook.timezone="UTC"')
        const page = input.includes('calendarView/delta') ? pages.first : pages['next-page']
        return new Response(JSON.stringify(page), { status: 200 })
      }
    )

    const { events, syncToken } = await provider.changes('cal 1', {
      fromIso: '2026-11-01T00:00:00.000Z',
      toIso: '2026-12-31T00:00:00.000Z'
    })

    expect(asked[0]).toContain('/me/calendars/cal%201/calendarView/delta?startDateTime=2026-11-01')
    expect(events.map((event) => [event.eventId, event.cancelled])).toEqual([
      ['AAMk-1', false],
      ['AAMk-9', true]
    ])
    expect(syncToken).toBe('https://graph.microsoft.com/v1.0/delta?token=z')
  })

  it('reads again from the start when Graph no longer knows the delta', async () => {
    const provider = new GraphCalendarProvider(
      async () => 'token',
      'mattia@siever.it',
      async () =>
        new Response(JSON.stringify({ error: { code: 'syncStateNotFound', message: 'gone' } }), {
          status: 410
        })
    )

    await expect(
      provider.changes('cal-1', { syncToken: 'https://graph/delta?token=old' })
    ).rejects.toBeInstanceOf(SyncTokenExpired)
  })
})
