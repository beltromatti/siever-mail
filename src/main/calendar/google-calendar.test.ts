import type { calendar_v3 } from 'googleapis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderEventInput } from './calendar-provider'

/** Google Calendar's API, as the provider calls it: each method answering what a test says. */
const api = vi.hoisted(() => ({
  events: {
    list: vi.fn(),
    get: vi.fn(),
    insert: vi.fn(),
    patch: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    move: vi.fn()
  },
  calendarList: { list: vi.fn() }
}))

vi.mock('googleapis', () => ({ google: { calendar: () => api } }))

const { GoogleCalendarProvider } = await import('./google-calendar')

const ME = 'mattia@brenta.it'

/** A lesson on Mondays and Thursdays at nine in Rome, until 22 December 2026. */
const LESSONS: calendar_v3.Schema$Event = {
  id: 'lez',
  iCalUID: 'lez@google.com',
  summary: 'Lezione di analisi',
  start: { dateTime: '2026-11-16T09:00:00+01:00', timeZone: 'Europe/Rome' },
  end: { dateTime: '2026-11-16T11:00:00+01:00', timeZone: 'Europe/Rome' },
  recurrence: [
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261222T225959Z',
    'EXDATE;TZID=Europe/Rome:20261119T090000'
  ],
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }
}

/** An instance of the lessons, as `singleEvents` lists it. */
function lesson(day: string): calendar_v3.Schema$Event {
  return {
    id: `lez_${day.replaceAll('-', '')}T080000Z`,
    iCalUID: 'lez@google.com',
    recurringEventId: 'lez',
    summary: 'Lezione di analisi',
    start: { dateTime: `${day}T09:00:00+01:00`, timeZone: 'Europe/Rome' },
    end: { dateTime: `${day}T11:00:00+01:00`, timeZone: 'Europe/Rome' },
    originalStartTime: { dateTime: `${day}T09:00:00+01:00` }
  }
}

const provider = (): InstanceType<typeof GoogleCalendarProvider> =>
  new GoogleCalendarProvider({} as never, ME)

const visit: ProviderEventInput = {
  title: 'Sopralluogo',
  start: '2026-11-20T08:00:00.000Z',
  end: '2026-11-20T09:00:00.000Z',
  allDay: false,
  location: null,
  description: null,
  attendees: [],
  recurrence: null,
  reminders: null
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GoogleCalendarProvider, reading', () => {
  it('reads each series’ rule once a read, on its recurring event, and what Gmail and the contacts keep', async () => {
    api.events.list.mockResolvedValue({
      data: {
        items: [
          lesson('2026-11-16'),
          lesson('2026-11-23'),
          { ...lesson('2026-11-30'), recurringEventId: 'perso', id: 'perso_1' },
          {
            id: 'volo',
            eventType: 'fromGmail',
            summary: 'Volo per Catania',
            start: { dateTime: '2026-11-21T07:00:00Z' },
            end: { dateTime: '2026-11-21T08:30:00Z' }
          },
          {
            id: 'compleanno',
            eventType: 'birthday',
            summary: 'Compleanno di Bianchi',
            start: { date: '2026-11-22' },
            end: { date: '2026-11-23' }
          }
        ],
        nextSyncToken: 'next'
      }
    })
    api.events.get.mockImplementation(async ({ eventId }: { eventId: string }) => {
      if (eventId === 'lez') {
        return { data: LESSONS }
      }

      throw Object.assign(new Error('Not Found'), { status: 404 })
    })

    const { events } = await provider().changes('primary', {
      fromIso: '2026-11-01T00:00:00.000Z',
      toIso: '2027-11-01T00:00:00.000Z'
    })
    const byId = new Map(events.map((event) => [event.eventId, event]))

    expect(api.events.get.mock.calls.map(([params]) => params.eventId).sort()).toEqual([
      'lez',
      'perso'
    ])
    expect(byId.get('lez_20261116T080000Z')).toMatchObject({
      seriesId: 'lez',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'], until: '2026-12-22' },
      managedBy: null
    })
    expect(byId.get('lez_20261123T080000Z')?.recurrence).toEqual(
      byId.get('lez_20261116T080000Z')?.recurrence
    )
    // A series that could not be read says nothing of its rule: what was known stays.
    expect(byId.get('perso_1')?.recurrence).toBeUndefined()
    expect(byId.get('volo')).toMatchObject({ managedBy: 'gmail', recurrence: null })
    expect(byId.get('compleanno')).toMatchObject({ managedBy: 'birthdays' })
  })

  it('gives a series as its recurring event has it: its first time, its rule, its zone', async () => {
    api.events.get.mockResolvedValue({ data: LESSONS })

    expect(await provider().series('primary', 'lez')).toEqual({
      title: 'Lezione di analisi',
      start: '2026-11-16T08:00:00.000Z',
      end: '2026-11-16T10:00:00.000Z',
      allDay: false,
      location: null,
      description: null,
      attendees: [],
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'], until: '2026-12-22' },
      reminders: [30],
      zone: 'Europe/Rome'
    })
  })
})

describe('GoogleCalendarProvider, writing', () => {
  it('writes a series in its zone, its rule without DTSTART, its reminders those on the screen', async () => {
    api.events.insert.mockImplementation(async ({ requestBody }) => ({
      data: { ...requestBody, id: 'nuova' }
    }))

    await provider().create(
      'primary',
      {
        ...visit,
        start: '2026-11-16T08:00:00.000Z',
        end: '2026-11-16T10:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          weekdays: ['MO', 'TH'],
          until: '2026-12-22'
        },
        reminders: [10, 1440],
        zone: 'Europe/Rome'
      },
      null
    )

    expect(api.events.insert.mock.calls[0][0]).toMatchObject({
      sendUpdates: 'none',
      requestBody: {
        start: { dateTime: '2026-11-16T08:00:00.000Z', timeZone: 'Europe/Rome' },
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261222T225959Z'],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 10 },
            { method: 'popup', minutes: 1440 }
          ]
        }
      }
    })

    // One event, the calendar's own reminders, no rule at all.
    await provider().create('primary', visit, null)
    expect(api.events.insert.mock.calls[1][0].requestBody).toMatchObject({
      reminders: { useDefault: true, overrides: [] }
    })
    expect(api.events.insert.mock.calls[1][0].requestBody.recurrence).toBeUndefined()

    await expect(
      provider().create('primary', { ...visit, reminders: [1, 2, 3, 4, 5, 6] }, null)
    ).rejects.toThrow('Google keeps at most 5 reminders for an event.')
  })

  it('writes a series’ rule again with its time, the days taken out kept, nobody told without guests', async () => {
    api.events.get.mockResolvedValue({ data: LESSONS })
    api.events.patch.mockImplementation(async ({ requestBody }) => ({
      data: { ...LESSONS, ...requestBody }
    }))

    await provider().update(
      'primary',
      'lez',
      {
        ...visit,
        title: 'Lezione di analisi',
        start: '2026-11-17T09:00:00.000Z',
        end: '2026-11-17T11:00:00.000Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          weekdays: ['TU', 'FR'],
          until: '2026-12-22'
        },
        reminders: null,
        zone: 'Europe/Rome'
      },
      false,
      new Set(['time', 'reminders'])
    )

    expect(api.events.patch.mock.calls[0][0]).toEqual({
      calendarId: 'primary',
      eventId: 'lez',
      sendUpdates: 'none',
      requestBody: {
        start: { dateTime: '2026-11-17T09:00:00.000Z', timeZone: 'Europe/Rome', date: null },
        end: { dateTime: '2026-11-17T11:00:00.000Z', timeZone: 'Europe/Rome', date: null },
        recurrence: [
          'RRULE:FREQ=WEEKLY;BYDAY=TU,FR;UNTIL=20261222T225959Z',
          'EXDATE;TZID=Europe/Rome:20261119T090000'
        ],
        reminders: { useDefault: true, overrides: [] }
      }
    })
  })

  it('makes a series one event again with a whole write without its rule: a PATCH cannot take it away', async () => {
    api.events.get.mockResolvedValue({ data: LESSONS })
    api.events.update.mockImplementation(async ({ requestBody }) => ({ data: requestBody }))

    const single = await provider().update(
      'primary',
      'lez',
      {
        ...visit,
        title: 'Lezione di analisi',
        start: '2026-11-23T08:00:00.000Z',
        end: '2026-11-23T10:00:00.000Z',
        zone: 'Europe/Rome'
      },
      false,
      new Set(['time', 'recurrence'])
    )
    const [{ requestBody }] = api.events.update.mock.calls[0]

    expect(api.events.patch).not.toHaveBeenCalled()
    expect(requestBody.recurrence).toBeUndefined()
    expect(requestBody).toMatchObject({
      summary: 'Lezione di analisi',
      start: { dateTime: '2026-11-23T08:00:00.000Z', timeZone: 'Europe/Rome' }
    })
    expect(single).toMatchObject({ eventId: 'lez', recurrence: null })
  })

  it('moves with Google’s own move, telling nobody, by the id Google gives back', async () => {
    api.events.move.mockResolvedValue({ data: { id: 'lez-altrove' } })

    expect(await provider().move('primary', 'lez', 'vita@group.calendar.google.com')).toEqual({
      eventId: 'lez-altrove',
      how: 'native'
    })
    expect(api.events.move).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'lez',
      destination: 'vita@group.calendar.google.com',
      sendUpdates: 'none'
    })

    // Only the events of every day move: an absence does not, and says so.
    api.events.move.mockRejectedValue(Object.assign(new Error('Bad Request'), { status: 400 }))
    api.events.get.mockResolvedValue({ data: { id: 'ferie', eventType: 'outOfOffice' } })
    await expect(
      provider().move('primary', 'ferie', 'vita@group.calendar.google.com')
    ).rejects.toThrow('Google doesn’t move events of this kind')
  })
})
