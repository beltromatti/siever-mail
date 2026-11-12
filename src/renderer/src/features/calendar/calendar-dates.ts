import { firstDayOfWeek, languageNow } from '@renderer/lib/i18n'
import type { CalendarEvent } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

/** How the Calendario app shows time. */
export type CalendarView = 'giorno' | 'settimana' | 'mese' | 'agenda'

/** Each view's name, as the switch says it. */
export const CALENDAR_VIEW_NAMES = defineMessages({
  agenda: { en: 'Agenda', it: 'Agenda', de: 'Agenda' },
  day: { en: 'Day', it: 'Giorno', de: 'Tag' },
  week: { en: 'Week', it: 'Settimana', de: 'Woche' },
  month: { en: 'Month', it: 'Mese', de: 'Monat' }
})

/** The views, in the switch's order: the agenda first, the one the calendar opens on. */
export const CALENDAR_VIEWS: ReadonlyArray<{
  value: CalendarView
  name: keyof typeof CALENDAR_VIEW_NAMES
}> = [
  { value: 'agenda', name: 'agenda' },
  { value: 'giorno', name: 'day' },
  { value: 'settimana', name: 'week' },
  { value: 'mese', name: 'month' }
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

const formats = new Map<string, Intl.DateTimeFormat>()

/**
 * A way of writing dates in the interface's language, as the computer's
 * region writes them (§13.5) — "giovedì 5 novembre", "Thursday 5 November",
 * 14:05 or 2:05 PM —, made once for each locale and kept: the grids write
 * hundreds of times at each drawing.
 */
export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = languageNow().formatLocale
  const key = `${locale} ${JSON.stringify(options)}`
  let format = formats.get(key)

  if (!format) {
    format = new Intl.DateTimeFormat(locale, options)
    formats.set(key, format)
  }

  return format
}

/** The day a day's week starts on, as the region counts weeks. */
export function startOfWeek(date: Date): Date {
  return addDays(
    startOfDay(date),
    -((date.getDay() - (firstDayOfWeek(languageNow().formatLocale) % 7) + 7) % 7)
  )
}

/** The seven days of a week in the region's order, by name: "lun", "Mon"; "L", "M" narrow. */
export function weekdayNames(weekday: 'narrow' | 'short'): string[] {
  const first = startOfWeek(new Date())
  const format = dateFormat({ weekday })
  return Array.from({ length: 7 }, (_, index) => format.format(addDays(first, index)))
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

/** The days a view shows around a day: one, a week from its first day, the weeks of a month, the agenda's. */
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

const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }
const FULL_DAY: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
}
const DAYS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }

/**
 * What the header says a view shows, as the region writes it: "novembre
 * 2026", "2–8 novembre 2026", "November 2 – 8, 2026", "giovedì 5 novembre 2026".
 */
export function viewTitle(view: CalendarView, anchor: Date): string {
  if (view === 'giorno') {
    return dateFormat(FULL_DAY).format(anchor)
  }

  if (view === 'mese') {
    return dateFormat(MONTH_YEAR).format(anchor)
  }

  const days = viewDays(view, anchor)

  // Italian writes a range's days padded ("02–08"), which a numeric day does not ask for.
  return dateFormat(DAYS)
    .formatRangeToParts(days[0], days[days.length - 1])
    .map((part) => (part.type === 'day' ? part.value.replace(/^0(?=\d)/, '') : part.value))
    .join('')
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

/** The day an event starts on, at its local midnight: where the calendar goes to show it. */
export function eventStartDay(event: Pick<CalendarEvent, 'start' | 'allDay'>): Date {
  return event.allDay ? dayOfKey(event.start.slice(0, 10)) : startOfDay(new Date(event.start))
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
