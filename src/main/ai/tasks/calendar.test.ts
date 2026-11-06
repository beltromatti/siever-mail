import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@shared/calendar'

import { CALENDAR_LOOK_CHUNK, lookChunk, lookWindow, nextLook } from './calendar'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 6, 17, 30).getTime()

function event(key: string, start: Date): CalendarEvent {
  return {
    key,
    connectionId: 'c',
    calendarId: 'lavoro',
    calendarName: 'Lavoro',
    eventId: key,
    iCalUid: null,
    title: key,
    start: start.toISOString(),
    end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    allDay: false,
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    myResponse: null,
    meetLink: null,
    htmlLink: null,
    origin: null
  }
}

describe('looking at a calendar one event at a time', () => {
  const window = lookWindow(30, NOW)

  it('spans the horizon back — as far as the calendar keeps — and the days ahead, from midnight', () => {
    expect(window.today).toBe(new Date(2026, 10, 6).getTime())
    expect(window.from).toBe(new Date(2026, 9, 7).getTime())
    expect(window.to).toBe(new Date(2027, 0, 6).getTime())
    expect(lookWindow(365, NOW).from).toBe(new Date(2026, 8, 7).getTime())
  })

  it('looks ahead first, then back, then at the days coming into the window', () => {
    const first = nextLook({ lookedFrom: null, lookedUntil: null }, window)
    expect(first).toEqual({ from: window.today, to: window.to, ahead: true })

    const back = nextLook({ lookedFrom: window.today, lookedUntil: window.to }, window)
    expect(back).toEqual({ from: window.from, to: window.today, ahead: false })

    expect(nextLook({ lookedFrom: window.from, lookedUntil: window.to }, window)).toBeNull()

    const tomorrow = lookWindow(30, NOW + DAY_MS)
    expect(nextLook({ lookedFrom: window.from, lookedUntil: window.to }, tomorrow)).toEqual({
      from: window.to,
      to: tomorrow.to,
      ahead: true
    })
  })

  it('takes a chunk in order, never splitting a moment, and grows the span by it', () => {
    const at = (day: number, hour: number): Date => new Date(2026, 10, day, hour)
    const many = Array.from({ length: CALENDAR_LOOK_CHUNK + 5 }, (_, index) =>
      event(`e${index}`, at(7 + Math.floor(index / 4), 9 + (index % 4)))
    )
    // The chunk's last moment, twice: both go in.
    const last = many[CALENDAR_LOOK_CHUNK - 1]
    many.push(event('same', new Date(last.start)))
    const range = { from: window.today, to: window.to, ahead: true }

    const chunk = lookChunk(many, range, { lookedFrom: null, lookedUntil: null }, window.today)

    expect(chunk.events).toHaveLength(CALENDAR_LOOK_CHUNK + 1)
    expect(chunk.events.map((item) => item.key)).toContain('same')
    expect(chunk.span.lookedFrom).toBe(window.today)
    expect(chunk.span.lookedUntil).toBe(Date.parse(many[CALENDAR_LOOK_CHUNK].start))

    const rest = lookChunk(
      many,
      { ...range, from: chunk.span.lookedUntil },
      chunk.span,
      window.today
    )
    expect(rest.events).toHaveLength(5)
    expect(rest.span.lookedUntil).toBe(window.to)
  })

  it('looks back from the latest, and covers the whole range when it ends', () => {
    const past = [
      event('ieri', new Date(2026, 10, 5, 10)),
      event('lunedì', new Date(2026, 10, 2, 9))
    ]
    const range = { from: window.from, to: window.today, ahead: false }

    const chunk = lookChunk(
      past,
      range,
      { lookedFrom: window.today, lookedUntil: window.to },
      window.today
    )

    expect(chunk.events.map((item) => item.key)).toEqual(['ieri', 'lunedì'])
    expect(chunk.span).toEqual({ lookedFrom: window.from, lookedUntil: window.to })
    expect(lookChunk([], range, chunk.span, window.today).span).toEqual(chunk.span)
  })
})
