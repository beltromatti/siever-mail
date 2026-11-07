import { describe, expect, it } from 'vitest'

import type { CalendarChange, CalendarEvent } from '@shared/calendar'

import {
  CALENDAR_LOOK_CHUNK,
  changeHeld,
  firstLookDone,
  heldWindow,
  lookBlocks,
  lookItems,
  prepareCalendarLook,
  unlooked
} from './calendar'

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
    seriesId: null,
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

describe('looking at a calendar the first time', () => {
  const window = heldWindow(NOW)
  const at = (day: number, hour: number): Date => new Date(2026, 10, day, hour)

  it('holds from two months back to a year ahead, from midnight, sliding with the days', () => {
    expect(window.today).toBe(new Date(2026, 10, 6).getTime())
    expect(window.from).toBe(new Date(2026, 8, 7).getTime())
    expect(window.to).toBe(new Date(2027, 10, 7).getTime())
    expect(heldWindow(NOW + DAY_MS).to).toBe(new Date(2027, 10, 8).getTime())
  })

  it('takes a series as one thing, at its next instance — or its last, all past', () => {
    const weekly = [2, 9, 16, 23].map((day) => ({
      ...event(`lun${day}`, at(day, 9)),
      seriesId: 'riunione'
    }))
    const gone = [3, 10].map((day) => ({
      ...event(`old${day}`, new Date(2026, 9, day, 9)),
      seriesId: 'finita'
    }))
    const items = lookItems([...weekly, ...gone, event('dentista', at(12, 15))], window.today)

    expect(items.map((item) => [item.event.key, item.instances.length])).toEqual([
      ['old10', 2],
      ['lun9', 4],
      ['dentista', 1]
    ])
    expect(prepareCalendarLook(items, 'Lavoro', true).data).toContain(
      'si ripete 4 volte nel calendario, dal 2 nov al 23 nov, ogni lunedì alle 09:00'
    )

    // A series across the new year says the years.
    const yearly = [0, 1].map((year) => ({
      ...event(`cena${year}`, new Date(2026 + year, 11, 20, 20)),
      seriesId: 'cena'
    }))
    expect(prepareCalendarLook(lookItems(yearly, window.today), 'Lavoro', true).data).toContain(
      'dal 20 dic 2026 al 20 dic 2027'
    )
  })

  it('splits the window into blocks of a chunk — the past apart, a moment never split — that cover it all', () => {
    const many = Array.from({ length: CALENDAR_LOOK_CHUNK + 5 }, (_, index) =>
      event(`e${index}`, at(7 + Math.floor(index / 4), 9 + (index % 4)))
    )
    // The chunk's last moment, twice: both go in the same block.
    many.push(event('same', new Date(many[CALENDAR_LOOK_CHUNK - 1].start)))
    const items = lookItems([event('ieri', at(5, 10)), ...many], window.today)
    const blocks = lookBlocks(items, window, window.today)

    expect(blocks).toEqual([
      { from: window.from, to: window.today, ahead: false },
      { from: window.today, to: Date.parse(many[CALENDAR_LOOK_CHUNK].start), ahead: true },
      { from: Date.parse(many[CALENDAR_LOOK_CHUNK].start), to: window.to, ahead: true }
    ])
    const inBlock = (block: (typeof blocks)[number]): number =>
      items.filter((item) => item.at >= block.from && item.at < block.to).length
    expect(blocks.map(inBlock)).toEqual([1, CALENDAR_LOOK_CHUNK + 1, 5])
    expect(lookBlocks([], window, window.today)).toEqual([])
  })

  it('is done once a whole window is looked at; a nearer look before leaves the rest to see', () => {
    expect(firstLookDone({ lookedFrom: window.from, lookedUntil: window.to })).toBe(true)
    expect(firstLookDone({ lookedFrom: null, lookedUntil: null })).toBe(false)

    const earlier = {
      lookedFrom: window.from - 30 * DAY_MS,
      lookedUntil: window.today + 61 * DAY_MS
    }
    expect(firstLookDone(earlier)).toBe(false)
    expect(unlooked(earlier, window)).toEqual([{ from: earlier.lookedUntil, to: window.to }])
    expect(unlooked(undefined, window)).toEqual([{ from: window.from, to: window.to }])
  })

  it('hands over a change anywhere the calendar holds, and not beyond', () => {
    const change = (start: Date): CalendarChange => ({
      id: 1,
      kind: 'nuovo',
      inApp: false,
      event: event('x', start),
      before: null,
      at: NOW
    })

    expect(changeHeld(change(new Date(2027, 2, 16, 9)), NOW)).toBe(true)
    expect(changeHeld(change(new Date(2026, 9, 1, 9)), NOW)).toBe(true)
    expect(changeHeld(change(new Date(2028, 0, 10, 9)), NOW)).toBe(false)
  })
})
