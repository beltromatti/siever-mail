import { hourStyle, messagesNow } from '@renderer/lib/i18n'
import type { CalendarEvent } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import { addDays, dateFormat, dayOfKey } from './calendar-dates'

const MESSAGES = defineMessages({
  allDay: {
    en: (day: string) => `${day}, all day`,
    it: (day: string) => `${day}, tutto il giorno`,
    de: (day: string) => `${day}, ganztägig`
  },
  fromTo: {
    en: (from: string, to: string) => `from ${from} to ${to}`,
    it: (from: string, to: string) => `da ${from} a ${to}`,
    de: (from: string, to: string) => `von ${from} bis ${to}`
  }
})

const DAY: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
/** Made when used: the hour is written as the region writes it now. */
const TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

/** When an event is, in words: "Thursday 5 November, 9:00–10:30", or its days for one all day. */
export function whenWords(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): string {
  const m = messagesNow(MESSAGES)
  const day = dateFormat(DAY)

  if (event.allDay) {
    const first = dayOfKey(event.start.slice(0, 10))
    const last = addDays(dayOfKey(event.end.slice(0, 10)), -1)
    return last.getTime() <= first.getTime()
      ? m.allDay(day.format(first))
      : m.fromTo(day.format(first), day.format(last))
  }

  const time = dateFormat(TIME())
  const start = new Date(event.start)
  const end = new Date(event.end)
  return start.toDateString() === end.toDateString()
    ? `${day.format(start)}, ${time.format(start)}–${time.format(end)}`
    : m.fromTo(
        `${day.format(start)} ${time.format(start)}`,
        `${day.format(end)} ${time.format(end)}`
      )
}

/**
 * The addresses to write to about an event: whoever is in it but the user
 * — the organizer of an invitation too, who may not be among its guests.
 */
export function guestAddresses(
  event: Pick<CalendarEvent, 'attendees' | 'organizer' | 'organizedByUser'>
): string[] {
  const own = new Set(
    event.attendees
      .filter((attendee) => attendee.self)
      .map((attendee) => attendee.email.toLowerCase())
  )
  const addresses = [
    ...(event.organizer && event.organizedByUser === false ? [event.organizer] : []),
    ...event.attendees.filter((attendee) => !attendee.self).map((attendee) => attendee.email)
  ]
  const seen = new Set<string>()

  return addresses.filter((address) => {
    const key = address.toLowerCase()

    if (!address.includes('@') || own.has(key) || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
