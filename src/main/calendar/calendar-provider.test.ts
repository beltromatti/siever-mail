import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@shared/calendar'

import { changedEvent, differingFields, eventInput } from './calendar-provider'

describe('differingFields', () => {
  const current = {
    title: 'Sopralluogo',
    start: '2026-11-10T08:00:00.000Z',
    end: '2026-11-10T09:00:00.000Z',
    allDay: false,
    location: 'Cantiere',
    description: 'Portare il **verbale**.',
    attendees: ['luca@brenta.it', 'rossi@cliente.it']
  }

  it('keeps of the fields given only those that really change', () => {
    expect([
      ...differingFields(
        current,
        {
          ...current,
          title: 'Sopralluogo al cantiere',
          start: '2026-11-10T09:00:00+01:00',
          end: '2026-11-10T10:00:00+01:00',
          attendees: ['Rossi@Cliente.it', 'luca@brenta.it']
        },
        new Set(['title', 'time', 'location', 'description', 'attendees'])
      )
    ]).toEqual(['title'])
    expect([
      ...differingFields(current, { ...current, location: null }, new Set(['location']))
    ]).toEqual(['location'])
  })
})

describe('changedEvent', () => {
  /** Nine in the morning of 10 November, here. */
  const nine = new Date(2026, 10, 10, 9)
  /** A reminder kept as a moment — a CalDAV event with DTSTART alone, its end its start. */
  const moment: CalendarEvent & { startsAt: number; endsAt: number } = {
    key: 'k',
    connectionId: 'c',
    calendarId: 'cal',
    calendarName: 'Lavoro',
    eventId: 'e',
    iCalUid: null,
    seriesId: null,
    title: 'Chiamare Rossi',
    start: nine.toISOString(),
    end: nine.toISOString(),
    allDay: false,
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    myResponse: null,
    meetLink: null,
    htmlLink: null,
    origin: null,
    startsAt: nine.getTime(),
    endsAt: nine.getTime()
  }

  it('changes an event with no length as it is: only an end the change gives is checked', () => {
    expect(changedEvent(moment, { title: 'Richiamare Rossi' })).toEqual({
      ...eventInput(moment),
      title: 'Richiamare Rossi'
    })
    expect(changedEvent(moment, { start: '2026-11-11T09:00:00.000Z' })).toMatchObject({
      start: '2026-11-11T09:00:00.000Z',
      end: '2026-11-11T09:00:00.000Z'
    })
    expect([
      ...differingFields(
        eventInput(moment),
        changedEvent(moment, { title: 'Richiamare Rossi' }),
        new Set(['title'])
      )
    ]).toEqual(['title'])
    expect(() =>
      changedEvent(moment, { start: '2026-11-11T09:00:00.000Z', end: '2026-11-11T09:00:00.000Z' })
    ).toThrow('The event’s end must come after its start.')
  })

  it('keeps the days of an event made all-day, from wherever it now starts', () => {
    // From the evening into the night after: two days.
    const evening = new Date(2026, 10, 10, 22)
    const night = new Date(2026, 10, 11, 3)
    const late = {
      ...moment,
      start: evening.toISOString(),
      end: night.toISOString(),
      startsAt: evening.getTime(),
      endsAt: night.getTime()
    }

    expect(changedEvent(late, { allDay: true })).toMatchObject({
      allDay: true,
      start: '2026-11-10',
      end: '2026-11-12'
    })
    expect(changedEvent(late, { allDay: true, start: '2026-11-20' })).toMatchObject({
      start: '2026-11-20',
      end: '2026-11-22'
    })
    expect(changedEvent(moment, { allDay: true })).toMatchObject({ end: '2026-11-11' })
    expect(() => changedEvent({ ...late, allDay: true }, { allDay: false })).toThrow(
      'it needs a start and an end'
    )
  })
})
