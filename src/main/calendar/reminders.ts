/**
 * When an event is to be reminded of (vision §13.3): at the times it sets
 * itself, as its calendar keeps them; one that says nothing of them, at the
 * lead the user chose — not an all-day one, a birthday or a holiday, which
 * has no hour to be on time for. One the user declined, none.
 */

import { defineMessages, hourStyleFor } from '@shared/i18n'

import { languageState, messages } from '../i18n'

/** An event's start and end as instants: an all-day one's by local midnight. */
export function instantsOf(event: { start: string; end: string; allDay: boolean }): {
  startsAt: number
  endsAt: number
} {
  const instant = (value: string): number => {
    if (!event.allDay) {
      return Date.parse(value)
    }

    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day).getTime()
  }

  return { startsAt: instant(event.start), endsAt: instant(event.end) }
}

/** An event as its reminders are reckoned. */
export interface RemindedEvent {
  key: string
  title: string
  calendarName: string
  allDay: boolean
  startsAt: number
  endsAt: number
  location: string | null
  meetLink: string | null
  /** Its own, in minutes before it starts; none when it has them off; null when it says nothing. */
  reminders: number[] | null
}

export interface Reminder {
  event: RemindedEvent
  /** When it is due. */
  at: number
  minutes: number
  /**
   * Given once: the same reminder of the same occurrence is not given again.
   * Kept on disk, so plain text — an event's key holds characters a stored
   * text would cut at.
   */
  key: string
}

/** A reminder's key (`Reminder.key`): its event's, its start's, its lead's. */
function reminderKey(eventKey: string, startsAt: number, lead: number): string {
  return JSON.stringify([eventKey, startsAt, lead])
}

/**
 * How the keys of an event's reminders begin, whatever its start and
 * lead: an event moved to another calendar takes those given with it
 * (vision §7.5).
 */
export function reminderKeysOf(eventKey: string): string {
  return reminderKey(eventKey, 0, 0).replace(/0,0\]$/, '')
}

/** Every reminder of these events, the earliest first. */
export function remindersOf(
  events: ReadonlyArray<RemindedEvent>,
  defaultLead: number | null
): Reminder[] {
  return events
    .flatMap((event) => {
      const minutes =
        event.reminders && event.reminders.length > 0
          ? event.reminders
          : event.reminders === null && !event.allDay && defaultLead !== null
            ? [defaultLead]
            : []

      return [...new Set(minutes)].map((lead) => ({
        event,
        at: event.startsAt - lead * 60_000,
        minutes: lead,
        key: reminderKey(event.key, event.startsAt, lead)
      }))
    })
    .sort((a, b) => a.at - b.at)
}

/** The words of a reminder's time, in the interface's language. */
const MESSAGES = defineMessages({
  today: { en: 'today', it: 'oggi', de: 'heute' },
  tomorrow: { en: 'tomorrow', it: 'domani', de: 'morgen' },
  yesterday: { en: 'yesterday', it: 'ieri', de: 'gestern' },
  minutes: {
    en: (count: number) => (count === 1 ? '1 minute' : `${count} minutes`),
    it: (count: number) => (count === 1 ? '1 minuto' : `${count} minuti`),
    de: (count: number) => (count === 1 ? '1 Minute' : `${count} Minuten`)
  },
  hours: {
    en: (count: number) => (count === 1 ? '1 hour' : `${count} hours`),
    it: (count: number) => (count === 1 ? '1 ora' : `${count} ore`),
    de: (count: number) => (count === 1 ? '1 Stunde' : `${count} Stunden`)
  },
  hoursAndMinutes: {
    en: (hours: string, minutes: string) => `${hours} and ${minutes}`,
    it: (hours: string, minutes: string) => `${hours} e ${minutes}`,
    de: (hours: string, minutes: string) => `${hours} und ${minutes}`
  },
  allDay: {
    en: (day: string) => `${day}, all day`,
    it: (day: string) => `${day}, tutto il giorno`,
    de: (day: string) => `${day}, ganztägig`
  },
  now: {
    en: (time: string) => `Now · ${time}`,
    it: (time: string) => `Adesso · ${time}`,
    de: (time: string) => `Jetzt · ${time}`
  },
  inDuration: {
    en: (duration: string, time: string) => `In ${duration} · ${time}`,
    it: (duration: string, time: string) => `Fra ${duration} · ${time}`,
    de: (duration: string, time: string) => `In ${duration} · ${time}`
  },
  dayAt: {
    en: (day: string, time: string) => `${day} at ${time}`,
    it: (day: string, time: string) => `${day} alle ${time}`,
    de: (day: string, time: string) => `${day} um ${time}`
  }
})

/** The formats of the interface's language now, made once per locale. */
const FORMATS = new Map<string, { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat }>()

function formats(): { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat } {
  const locale = languageState().formatLocale
  let made = FORMATS.get(locale)

  if (!made) {
    made = {
      time: new Intl.DateTimeFormat(locale, { hour: hourStyleFor(locale), minute: '2-digit' }),
      day: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    }
    FORMATS.set(locale, made)
  }

  return made
}

function startOfDay(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** «today», «tomorrow», or the day in words: «Thursday, 14 November». */
export function dayWords(at: number, now: number): string {
  const m = messages(MESSAGES)
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)
  return days === 0
    ? m.today
    : days === 1
      ? m.tomorrow
      : days === -1
        ? m.yesterday
        : formats().day.format(at)
}

/** «1 hour and 30 minutes», «10 minutes», «1 minute». */
function durationWords(ms: number): string {
  const m = messages(MESSAGES)
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (hours === 0) {
    return m.minutes(minutes)
  }

  return rest === 0 ? m.hours(hours) : m.hoursAndMinutes(m.hours(hours), m.minutes(rest))
}

/**
 * When an event starts, as a reminder says it: «In 10 minutes · 15:00»,
 * «Now · 15:00», «Tomorrow at 09:00» — for an all-day one, its day.
 */
export function startWords(event: Pick<RemindedEvent, 'allDay' | 'startsAt'>, now: number): string {
  const m = messages(MESSAGES)
  const day = capitalized(dayWords(event.startsAt, now))

  if (event.allDay) {
    return m.allDay(day)
  }

  const time = formats().time.format(event.startsAt)
  const ahead = event.startsAt - now

  if (ahead < 60_000) {
    return m.now(time)
  }

  if (ahead <= 12 * 3_600_000) {
    return m.inDuration(durationWords(ahead), time)
  }

  return m.dayAt(day, time)
}

/** When an event is, in a line: «Thursday, 14 November, 10:00–11:00», «today, all day». */
export function whenWords(
  event: Pick<RemindedEvent, 'allDay' | 'startsAt' | 'endsAt'>,
  now: number
): string {
  const day = dayWords(event.startsAt, now)
  const { time } = formats()

  return event.allDay
    ? messages(MESSAGES).allDay(day)
    : `${day}, ${time.format(event.startsAt)}–${time.format(event.endsAt)}`
}
