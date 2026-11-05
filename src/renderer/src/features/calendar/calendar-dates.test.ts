import { describe, expect, it } from 'vitest'

import { inTopBand, layoutDay, shiftSpan, startOfWeek, viewDays, viewTitle } from './calendar-dates'

describe('calendar dates', () => {
  it('starts weeks on Monday and gives a month six weeks', () => {
    // Thursday 5 November 2026.
    const anchor = new Date(2026, 10, 5, 10)

    expect(startOfWeek(anchor)).toEqual(new Date(2026, 10, 2))
    expect(viewDays('mese', anchor)[0]).toEqual(new Date(2026, 9, 26))
    expect(viewDays('mese', anchor)).toHaveLength(42)
    expect(viewTitle('settimana', anchor)).toBe('2 – 8 novembre 2026')
  })

  it('puts overlapping events side by side, the others full width', () => {
    const hour = 60 * 60 * 1000
    const laid = layoutDay([
      { id: 'a', start: 9 * hour, end: 10 * hour },
      { id: 'b', start: 9.5 * hour, end: 11 * hour },
      { id: 'c', start: 12 * hour, end: 13 * hour }
    ])
    const of = (id: string): { column: number; columns: number } => {
      const entry = laid.find((candidate) => candidate.item.id === id)!
      return { column: entry.column, columns: entry.columns }
    }

    expect(of('a')).toEqual({ column: 0, columns: 2 })
    expect(of('b')).toEqual({ column: 1, columns: 2 })
    expect(of('c')).toEqual({ column: 0, columns: 1 })
  })

  it('takes all-day events and those across midnight to the top band', () => {
    expect(inTopBand({ start: '2026-11-05', end: '2026-11-06', allDay: true })).toBe(true)
    expect(
      inTopBand({
        start: new Date(2026, 10, 5, 22).toISOString(),
        end: new Date(2026, 10, 6, 2).toISOString(),
        allDay: false
      })
    ).toBe(true)
    expect(
      inTopBand({
        start: new Date(2026, 10, 5, 9).toISOString(),
        end: new Date(2026, 10, 5, 10).toISOString(),
        allDay: false
      })
    ).toBe(false)
  })

  it('moves a span by the clock on the wall, across the change of hour', () => {
    // Saturday 24 October 2026, 10:00–11:30 in Italy; summer time ends on the 25th.
    const start = new Date(2026, 9, 24, 10, 0).getTime()
    const moved = shiftSpan({ start, end: start + 90 * 60_000 }, 2, 30)

    expect(new Date(moved.start).getDate()).toBe(26)
    expect(new Date(moved.start).getHours()).toBe(10)
    expect(new Date(moved.start).getMinutes()).toBe(30)
    expect(moved.end - moved.start).toBe(90 * 60_000)
  })
})
