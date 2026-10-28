import type { CalendarEvent } from '@shared/calendar'

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** A day written AAAA-MM-GG, at its local midnight. */
function localMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).getTime()
}

/** Whether an event is on a day: a meeting on one, a three-day fair on three. */
export function isOn(event: CalendarEvent, day: Date): boolean {
  const start = event.allDay ? localMidnight(event.start) : Date.parse(event.start)
  // An event of no length is still on the day it is at.
  const end = event.allDay ? localMidnight(event.end) : Math.max(Date.parse(event.end), start + 1)
  const from = day.getTime()
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()

  return start < to && end > from
}
