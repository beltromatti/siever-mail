import type { CalendarEvent } from '@shared/calendar'

/** How the Calendario app shows time. */
export type CalendarView = 'giorno' | 'settimana' | 'mese' | 'agenda'

export const CALENDAR_VIEWS: ReadonlyArray<{ value: CalendarView; label: string }> = [
  { value: 'giorno', label: 'Giorno' },
  { value: 'settimana', label: 'Settimana' },
  { value: 'mese', label: 'Mese' },
  { value: 'agenda', label: 'Agenda' }
]

/** Days the agenda lists from the day it starts on. */
export const AGENDA_DAYS = 14
const MINUTE_MS = 60_000

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** The Monday a day's week starts on. */
export function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -((date.getDay() + 6) % 7))
}

/** A day as the calendar and the commitments write it: AAAA-MM-GG, local. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A day AAAA-MM-GG at its local midnight. */
export function dayOfKey(key: string): Date {
  const [year, month, date] = key.split('-').map(Number)
  return new Date(year, month - 1, date)
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** The days a view shows around a day: one, a week from Monday, the weeks of a month, the agenda's. */
export function viewDays(view: CalendarView, anchor: Date): Date[] {
  switch (view) {
    case 'giorno':
      return [startOfDay(anchor)]
    case 'settimana':
      return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index))
    case 'mese': {
      const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
      return Array.from({ length: 42 }, (_, index) => addDays(first, index))
    }
    case 'agenda':
      return Array.from({ length: AGENDA_DAYS }, (_, index) => addDays(startOfDay(anchor), index))
  }
}

/** The next or previous page of a view. */
export function stepAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  switch (view) {
    case 'giorno':
      return addDays(anchor, direction)
    case 'settimana':
      return addDays(anchor, 7 * direction)
    case 'mese':
      return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
    case 'agenda':
      return addDays(anchor, AGENDA_DAYS * direction)
  }
}

const MONTH_YEAR = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
const FULL_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})
const DAY_MONTH = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' })

/** What the header says a view shows: "novembre 2026", "2 – 8 novembre 2026", "giovedì 5 novembre 2026". */
export function viewTitle(view: CalendarView, anchor: Date): string {
  if (view === 'giorno') {
    return FULL_DAY.format(anchor)
  }

  if (view === 'mese') {
    return MONTH_YEAR.format(anchor)
  }

  const days = viewDays(view, anchor)
  const first = days[0]
  const last = days[days.length - 1]

  return first.getMonth() === last.getMonth()
    ? `${first.getDate()} – ${DAY_MONTH.format(last)} ${last.getFullYear()}`
    : `${DAY_MONTH.format(first)} – ${DAY_MONTH.format(last)} ${last.getFullYear()}`
}

/** An event's start and end as instants — an all-day one's by local midnight, its end exclusive. */
export function eventSpan(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): {
  start: number
  end: number
} {
  if (event.allDay) {
    return {
      start: dayOfKey(event.start.slice(0, 10)).getTime(),
      end: dayOfKey(event.end.slice(0, 10)).getTime()
    }
  }

  const start = Date.parse(event.start)
  return { start, end: Math.max(Date.parse(event.end), start + MINUTE_MS) }
}

/** Whether an event is on a day: a meeting on one, a three-day fair on three. */
export function isOnDay(
  event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  day: Date
): boolean {
  const { start, end } = eventSpan(event)
  return start < addDays(day, 1).getTime() && end > day.getTime()
}

/** Whether an event goes in a day's top band: all day, or across midnight. */
export function inTopBand(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): boolean {
  if (event.allDay) {
    return true
  }

  const { start, end } = eventSpan(event)
  return !sameDay(new Date(start), new Date(end - 1))
}

/**
 * A span moved by whole days and minutes, by the clock on the wall: a
 * meeting at 10 moved a day on is at 10 the next day, summer time or not.
 */
export function shiftSpan(
  span: { start: number; end: number },
  days: number,
  minutes: number
): { start: number; end: number } {
  const start = new Date(span.start)
  start.setDate(start.getDate() + days)
  start.setMinutes(start.getMinutes() + minutes)

  return { start: start.getTime(), end: start.getTime() + (span.end - span.start) }
}

/** The minutes from a day's midnight an instant is at, within the day. */
export function minutesInto(day: Date, instant: number): number {
  return Math.min(24 * 60, Math.max(0, (instant - day.getTime()) / MINUTE_MS))
}

/**
 * Events of a day side by side where they overlap: each gets its column
 * among those of its cluster of overlapping ones, as calendars draw them.
 */
export function layoutDay<T extends { start: number; end: number }>(
  items: ReadonlyArray<T>
): Array<{ item: T; column: number; columns: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const placed: Array<{ item: T; column: number; columns: number }> = []
  let cluster: Array<{ item: T; column: number; columns: number }> = []
  let clusterEnd = -Infinity

  const close = (): void => {
    const columns = Math.max(1, ...cluster.map((entry) => entry.column + 1))

    for (const entry of cluster) {
      entry.columns = columns
    }

    placed.push(...cluster)
    cluster = []
  }

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length > 0) {
      close()
      clusterEnd = -Infinity
    }

    const taken = new Set(
      cluster.filter((entry) => entry.item.end > item.start).map((entry) => entry.column)
    )
    let column = 0

    while (taken.has(column)) {
      column += 1
    }

    cluster.push({ item, column, columns: 1 })
    clusterEnd = Math.max(clusterEnd, item.end)
  }

  close()
  return placed
}

/** "AAAA-MM-GGTHH:MM" of an instant, local: what a date and time field holds. */
export function localDateTime(instant: number): { date: string; time: string } {
  const date = new Date(instant)
  return {
    date: dayKey(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
}
