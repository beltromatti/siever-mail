import { languageNow, messagesNow } from '@renderer/lib/i18n'
import { hourStyleFor } from '@shared/i18n'
import type { EventRecurrence, Weekday } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import { dateFormat, dayOfKey } from './calendar-dates'
import {
  fitRecurrence,
  ruleWeekdays,
  weekdayDate,
  weekdayOf,
  weekdayPlace,
  weekOrder,
  WORKDAYS
} from './recurrence'

/** English's ordinal of a day of the month: 1st, 2nd, 3rd, 4th. */
const ENGLISH_ORDINAL = new Intl.PluralRules('en', { type: 'ordinal' })
const ENGLISH_SUFFIX: Readonly<Record<string, string>> = { one: 'st', two: 'nd', few: 'rd' }
const englishOrdinal = (day: number): string =>
  `${day}${ENGLISH_SUFFIX[ENGLISH_ORDINAL.select(day)] ?? 'th'}`

/** Italian elides the article before a number said with a vowel: l’1, l’8, l’11. */
const elided = (date: string): boolean => /^(1|8|11)(?!\d)/.test(date)

const PLACES_EN = ['first', 'second', 'third', 'fourth', 'fifth']
const PLACES_IT_M = ['primo', 'secondo', 'terzo', 'quarto', 'quinto']
const PLACES_IT_F = ['prima', 'seconda', 'terza', 'quarta', 'quinta']
const PLACES_DE = ['ersten', 'zweiten', 'dritten', 'vierten', 'fünften']

const MESSAGES = defineMessages({
  other: {
    en: 'Repeats (by a rule made elsewhere)',
    it: 'Si ripete (con una regola fatta altrove)',
    de: 'Wiederholt sich (nach einer anderswo erstellten Regel)'
  },
  daily: {
    en: (every: number) => (every === 1 ? 'Every day' : `Every ${every} days`),
    it: (every: number) => (every === 1 ? 'Ogni giorno' : `Ogni ${every} giorni`),
    de: (every: number) => (every === 1 ? 'Jeden Tag' : `Alle ${every} Tage`)
  },
  workdays: {
    en: (every: number) => (every === 1 ? 'Every weekday' : `Every ${every} weeks on weekdays`),
    it: (every: number) =>
      every === 1 ? 'Ogni giorno feriale' : `Ogni ${every} settimane, nei giorni feriali`,
    de: (every: number) => (every === 1 ? 'Jeden Werktag' : `Alle ${every} Wochen an Werktagen`)
  },
  /** A weekday among the days a week repeats on: «il lunedì», «la domenica». */
  weekdayInList: {
    en: (name: string) => name,
    it: (name: string) => (name === 'domenica' ? `la ${name}` : `il ${name}`),
    de: (name: string) => name
  },
  weekly: {
    en: (every: number, days: string) =>
      every === 1 ? `Every week on ${days}` : `Every ${every} weeks on ${days}`,
    it: (every: number, days: string) =>
      every === 1 ? `Ogni settimana ${days}` : `Ogni ${every} settimane ${days}`,
    de: (every: number, days: string) =>
      every === 1 ? `Jede Woche am ${days}` : `Alle ${every} Wochen am ${days}`
  },
  monthly: {
    en: (every: number, on: string) =>
      `${every === 1 ? 'Every month' : `Every ${every} months`} ${on}`,
    it: (every: number, on: string) => `${every === 1 ? 'Ogni mese' : `Ogni ${every} mesi`} ${on}`,
    de: (every: number, on: string) =>
      `${every === 1 ? 'Jeden Monat' : `Alle ${every} Monate`} ${on}`
  },
  /** The day of the month a rule falls on: "on the 12th", «il giorno 12», "am 12.". */
  onDay: {
    en: (day: number) => `on the ${englishOrdinal(day)}`,
    it: (day: number) => `il giorno ${day}`,
    de: (day: number) => `am ${day}.`
  },
  /** A weekday by its place in the month: "on the second Tuesday", «la seconda domenica». */
  onPlace: {
    en: (place: number, weekday: string) => `on the ${PLACES_EN[place - 1]} ${weekday}`,
    it: (place: number, weekday: string) =>
      weekday === 'domenica'
        ? `la ${PLACES_IT_F[place - 1]} ${weekday}`
        : `il ${PLACES_IT_M[place - 1]} ${weekday}`,
    de: (place: number, weekday: string) => `am ${PLACES_DE[place - 1]} ${weekday}`
  },
  /** A weekday last in the month: "on the last Friday", «l’ultimo venerdì». */
  onLast: {
    en: (weekday: string) => `on the last ${weekday}`,
    it: (weekday: string) =>
      weekday === 'domenica' ? `l’ultima ${weekday}` : `l’ultimo ${weekday}`,
    de: (weekday: string) => `am letzten ${weekday}`
  },
  yearly: {
    en: (every: number, date: string) =>
      `${every === 1 ? 'Every year' : `Every ${every} years`} on ${date}`,
    it: (every: number, date: string) =>
      `${every === 1 ? 'Ogni anno' : `Ogni ${every} anni`} ${elided(date) ? 'l’' : 'il '}${date}`,
    de: (every: number, date: string) =>
      `${every === 1 ? 'Jedes Jahr' : `Alle ${every} Jahre`} am ${date}`
  },
  until: {
    en: (date: string) => `, until ${date}`,
    it: (date: string) => `, fino ${elided(date) ? 'all’' : 'al '}${date}`,
    de: (date: string) => `, bis ${date}`
  },
  count: {
    en: (count: number) => (count === 1 ? ', once' : `, ${count} times`),
    it: (count: number) => (count === 1 ? ', una volta' : `, ${count} volte`),
    de: (count: number) => (count === 1 ? ', einmal' : `, ${count}-mal`)
  }
})

const WEEKDAY_NAME: Intl.DateTimeFormatOptions = { weekday: 'long' }
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
const SHORT_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
const SHORT_DAY_YEAR: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}

/** A weekday's name, as the language writes it among words: "lunedì", "Monday", "Montag". */
function weekdayName(weekday: Weekday): string {
  return dateFormat(WEEKDAY_NAME).format(weekdayDate(weekday))
}

/** The days a week repeats on, in the region's order, as a list in words. */
function weekdayList(weekdays: ReadonlyArray<Weekday>): string {
  const m = messagesNow(MESSAGES)
  const names = weekOrder()
    .filter((weekday) => weekdays.includes(weekday))
    .map((weekday) => m.weekdayInList(weekdayName(weekday)))

  return new Intl.ListFormat(languageNow().formatLocale, { type: 'conjunction' }).format(names)
}

/** Which day of the month a monthly rule falls on, from its start: "on the second Tuesday". */
function monthlyOn(by: NonNullable<EventRecurrence['monthlyBy']>, start: Date): string {
  const m = messagesNow(MESSAGES)
  const weekday = weekdayName(weekdayOf(start))

  return by === 'weekday'
    ? m.onPlace(weekdayPlace(start), weekday)
    : by === 'lastWeekday'
      ? m.onLast(weekday)
      : m.onDay(start.getDate())
}

/** A month's day as a choice offers it, from the start: «Il giorno 12», "On the last Friday". */
export function monthlyChoiceWords(
  by: NonNullable<EventRecurrence['monthlyBy']>,
  start: Date
): string {
  const words = monthlyOn(by, start)
  return words.charAt(0).toLocaleUpperCase() + words.slice(1)
}

/** A weekday's whole name, as the language writes it: "lunedì", "Monday". */
export function weekdayWords(weekday: Weekday): string {
  return weekdayName(weekday)
}

/** How many times, or until when: nothing for a rule that never ends. */
function endWords(recurrence: EventRecurrence): string {
  const m = messagesNow(MESSAGES)

  if (recurrence.count) {
    return m.count(recurrence.count)
  }

  if (recurrence.until) {
    const until = dayOfKey(recurrence.until)
    const format = until.getFullYear() === new Date().getFullYear() ? SHORT_DAY : SHORT_DAY_YEAR
    return m.until(dateFormat(format).format(until))
  }

  return ''
}

/**
 * How an event repeats, in the user's words, from its start — the day,
 * at its local midnight, its weekday and its day of the month are taken
 * from: «Ogni 2 settimane il lunedì e il giovedì, fino al 22 dic», "Every
 * month on the last Friday, 10 times". One formatter for the editor, the
 * panel and the lines; a rule made elsewhere says only that it repeats.
 */
export function recurrenceWords(recurrence: EventRecurrence | 'other', start: Date): string {
  const m = messagesNow(MESSAGES)

  if (recurrence === 'other') {
    return m.other
  }

  const rule = fitRecurrence(recurrence, start)
  const every = Math.max(1, rule.interval)
  let words: string

  switch (rule.frequency) {
    case 'daily':
      words = m.daily(every)
      break
    case 'weekly': {
      const days = ruleWeekdays(rule, start)
      words =
        days.length === WORKDAYS.length && WORKDAYS.every((day) => days.includes(day))
          ? m.workdays(every)
          : m.weekly(every, weekdayList(days))
      break
    }
    case 'monthly':
      words = m.monthly(every, monthlyOn(rule.monthlyBy ?? 'day', start))
      break
    case 'yearly':
      words = m.yearly(every, dateFormat(DAY_MONTH).format(start))
      break
  }

  return `${words}${endWords(rule)}`
}

const REMINDER_MESSAGES = defineMessages({
  calendars: {
    en: 'The calendar’s defaults',
    it: 'Quelli del calendario',
    de: 'Standard des Kalenders'
  },
  none: { en: 'None', it: 'Nessuno', de: 'Keine' },
  atStart: { en: 'At the start', it: 'All’inizio', de: 'Zu Beginn' },
  dayStarts: {
    en: 'When the day starts',
    it: 'All’inizio del giorno',
    de: 'Zu Beginn des Tages'
  },
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
  days: {
    en: (count: number) => (count === 1 ? '1 day' : `${count} days`),
    it: (count: number) => (count === 1 ? '1 giorno' : `${count} giorni`),
    de: (count: number) => (count === 1 ? '1 Tag' : `${count} Tage`)
  },
  weeks: {
    en: (count: number) => (count === 1 ? '1 week' : `${count} weeks`),
    it: (count: number) => (count === 1 ? '1 settimana' : `${count} settimane`),
    de: (count: number) => (count === 1 ? '1 Woche' : `${count} Wochen`)
  },
  and: {
    en: (first: string, second: string) => `${first} and ${second}`,
    it: (first: string, second: string) => `${first} e ${second}`,
    de: (first: string, second: string) => `${first} und ${second}`
  },
  before: {
    en: (time: string) => `${time} before`,
    it: (time: string) => `${time} prima`,
    de: (time: string) => `${time} vorher`
  },
  dayBefore: {
    en: (time: string) => `The day before at ${time}`,
    it: (time: string) => `Il giorno prima alle ${time}`,
    de: (time: string) => `Am Vortag um ${time}`
  },
  weekBefore: {
    en: (time: string) => `A week before at ${time}`,
    it: (time: string) => `Una settimana prima alle ${time}`,
    de: (time: string) => `Eine Woche vorher um ${time}`
  },
  daysBefore: {
    en: (days: number, time: string) => `${days} days before at ${time}`,
    it: (days: number, time: string) => `${days} giorni prima alle ${time}`,
    de: (days: number, time: string) => `${days} Tage vorher um ${time}`
  }
})

const MINUTES_A_DAY = 24 * 60
const MINUTES_A_WEEK = 7 * MINUTES_A_DAY

/** A length of time in its largest whole unit, or hours and minutes: "1 week", "1 hour and 30 minutes". */
function spanWords(minutes: number): string {
  const m = messagesNow(REMINDER_MESSAGES)

  if (minutes % MINUTES_A_WEEK === 0) {
    return m.weeks(minutes / MINUTES_A_WEEK)
  }

  if (minutes % MINUTES_A_DAY === 0) {
    return m.days(minutes / MINUTES_A_DAY)
  }

  if (minutes % 60 === 0) {
    return m.hours(minutes / 60)
  }

  return minutes > 60
    ? m.and(m.hours(Math.floor(minutes / 60)), m.minutes(minutes % 60))
    : m.minutes(minutes)
}

/**
 * A reminder in words, by the minutes before the event it rings: "10
 * minutes before", "1 day before" — and, for an all-day event, which
 * starts at its midnight, the day and the hour it rings: «Il giorno prima
 * alle 9:00».
 */
export function reminderWords(minutes: number, allDay: boolean): string {
  const m = messagesNow(REMINDER_MESSAGES)

  if (minutes <= 0) {
    return allDay ? m.dayStarts : m.atStart
  }

  if (!allDay) {
    return m.before(spanWords(minutes))
  }

  const days = Math.ceil(minutes / MINUTES_A_DAY)
  const minuteOfDay = days * MINUTES_A_DAY - minutes
  const time = new Intl.DateTimeFormat(languageNow().formatLocale, {
    hour: hourStyleFor(languageNow().formatLocale),
    minute: '2-digit'
  }).format(new Date(2000, 0, 1, Math.floor(minuteOfDay / 60), minuteOfDay % 60))

  return days === 1 ? m.dayBefore(time) : days === 7 ? m.weekBefore(time) : m.daysBefore(days, time)
}

/** An event's reminders in words, nearest the event first; the calendar's own, or none. */
export function remindersWords(reminders: ReadonlyArray<number> | null, allDay: boolean): string {
  const m = messagesNow(REMINDER_MESSAGES)

  if (reminders === null) {
    return m.calendars
  }

  if (reminders.length === 0) {
    return m.none
  }

  return [...reminders]
    .sort((a, b) => a - b)
    .map((minutes, index) => {
      const words = reminderWords(minutes, allDay)
      // After the first, a reminder is a word in a list: "10 minutes before, 1 day before".
      return index === 0 ? words : words.charAt(0).toLocaleLowerCase() + words.slice(1)
    })
    .join(', ')
}

/** «Quelli del calendario» and «Nessuno», as a choice of reminders says them. */
export const REMINDER_MODES = defineMessages({
  calendars: REMINDER_MESSAGES.calendars,
  none: REMINDER_MESSAGES.none
})
