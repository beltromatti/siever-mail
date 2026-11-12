import ICAL from 'ical.js'

import { messages } from '@main/i18n'
import { WEEKDAYS, type EventRecurrence, type Weekday } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

/**
 * How an event repeats, as the app writes it (`EventRecurrence`, vision
 * §7.5), and as the calendars do: Google and a CalDAV server an iCalendar
 * RRULE (RFC 5545 §3.3.10), Microsoft a patterned recurrence. A rule the
 * app does not write — several, days added by date, hours in it — reads as
 * `'other'`: a series all the same, changed where it was made.
 */

const MESSAGES = defineMessages({
  interval: {
    en: 'How often it repeats is a whole number, 1 or more.',
    it: 'L’intervallo della ripetizione è un numero intero, da 1 in su.',
    de: 'Das Wiederholungsintervall ist eine ganze Zahl ab 1.'
  },
  count: {
    en: 'The number of times is a whole number, 1 or more.',
    it: 'Le volte in tutto sono un numero intero, da 1 in su.',
    de: 'Die Anzahl der Wiederholungen ist eine ganze Zahl ab 1.'
  },
  untilAndCount: {
    en: 'A repeating event ends on a day or after a number of times, not both.',
    it: 'Un evento che si ripete finisce a un giorno o dopo un numero di volte, non tutte e due.',
    de: 'Ein wiederholter Termin endet an einem Tag oder nach einer Anzahl von Malen, nicht beides.'
  },
  untilBeforeStart: {
    en: 'It can’t stop repeating before its first day.',
    it: 'Non può smettere di ripetersi prima del suo primo giorno.',
    de: 'Die Wiederholung kann nicht vor dem ersten Tag enden.'
  },
  weekdaysWeekly: {
    en: 'Days of the week are for an event that repeats every week.',
    it: 'I giorni della settimana valgono per un evento che si ripete ogni settimana.',
    de: 'Wochentage gelten nur für einen wöchentlich wiederholten Termin.'
  },
  monthlyByMonthly: {
    en: 'Which day of the month is for an event that repeats every month.',
    it: 'Il giorno del mese vale per un evento che si ripete ogni mese.',
    de: 'Der Tag im Monat gilt nur für einen monatlich wiederholten Termin.'
  },
  notLastWeekday: {
    en: 'Its first day isn’t the last of its weekday in the month.',
    it: 'Il suo primo giorno non è l’ultimo di quel giorno della settimana nel mese.',
    de: 'Sein erster Tag ist nicht der letzte dieses Wochentags im Monat.'
  }
})

const DAY_MS = 24 * 60 * 60 * 1000

/* ─────────────────────────── days and zones ─────────────────────────── */

/** The zone the computer keeps: the one the user's hours are in. */
export function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** A zone `Intl` knows, or the computer's: a calendar may name one by a name of its own. */
export function knownZone(zone: string | null | undefined): string {
  if (zone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone })
      return zone
    } catch {
      // A Windows name, a made-up one: the computer's hours stand for it.
    }
  }

  return systemZone()
}

/** A moment as a clock on the wall reads it, in a zone. */
export interface Wall {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const WALL_FORMATS = new Map<string, Intl.DateTimeFormat>()

/** What a clock in `zone` shows at an instant. */
export function wallOf(instant: number, zone: string): Wall {
  let format = WALL_FORMATS.get(zone)

  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    WALL_FORMATS.set(zone, format)
  }

  const parts = new Map(format.formatToParts(instant).map((part) => [part.type, part.value]))
  const number = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type) ?? 0)

  return {
    year: number('year'),
    month: number('month'),
    day: number('day'),
    hour: number('hour') % 24,
    minute: number('minute'),
    second: number('second')
  }
}

const wallMs = (wall: Wall): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)

/**
 * The instant a clock in `zone` shows `wall` at: of an hour the clocks
 * repeat, the first time; of one they skip, the time after the change.
 */
export function instantOfWall(wall: Wall, zone: string): number {
  const asUtc = wallMs(wall)
  const offset = (instant: number): number => wallMs(wallOf(instant, zone)) - instant
  const candidates = [
    ...new Set([asUtc - offset(asUtc - 12 * 3_600_000), asUtc - offset(asUtc + 12 * 3_600_000)])
  ].sort((a, b) => a - b)

  return (
    candidates.find((instant) => wallMs(wallOf(instant, zone)) === asUtc) ??
    asUtc - offset(asUtc - 12 * 3_600_000)
  )
}

/** A day AAAA-MM-GG as a number of days, to count between days. */
export function dayNumber(day: string): number {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, date) / DAY_MS)
}

/** The day so many days from 1970-01-01, AAAA-MM-GG. */
function dayOfNumber(number: number): string {
  return new Date(number * DAY_MS).toISOString().slice(0, 10)
}

/** A day AAAA-MM-GG moved by some days. */
export function addDays(day: string, days: number): string {
  return dayOfNumber(dayNumber(day) + days)
}

function wallDay(wall: Pick<Wall, 'year' | 'month' | 'day'>): string {
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
}

/** The weekday a day AAAA-MM-GG falls on. */
export function weekdayOf(day: string): Weekday {
  return WEEKDAYS[(((dayNumber(day) + 3) % 7) + 7) % 7]
}

/** Which of its weekday in the month a day is: the 8th is the second. */
function ordinalOf(day: string): number {
  return Math.ceil(Number(day.slice(8, 10)) / 7)
}

/** Whether a day is the last of its weekday in its month. */
function lastOfWeekday(day: string): boolean {
  return addDays(day, 7).slice(0, 7) !== day.slice(0, 7)
}

/**
 * Where a series begins, as its rule is read from: its first day and
 * hour, in the zone its hours are kept in.
 */
export interface SeriesAnchor {
  /** Its first day, AAAA-MM-GG, in its zone. */
  day: string
  allDay: boolean
  /** The zone its hours are in: what an end given as an instant is read in. */
  zone: string
  /** The seconds into its first day it begins at, in its zone; 0 all day. */
  seconds: number
}

/** The anchor of an event's start — an instant, or an all-day one's day — in a zone. */
export function anchorOf(start: string, allDay: boolean, zone: string): SeriesAnchor {
  if (allDay) {
    return { day: start.slice(0, 10), allDay, zone, seconds: 0 }
  }

  const wall = wallOf(Date.parse(start), zone)
  return {
    day: wallDay(wall),
    allDay,
    zone,
    seconds: wall.hour * 3600 + wall.minute * 60 + wall.second
  }
}

/* ─────────────────────────── the rule itself ─────────────────────────── */

/** A rule the same in whatever form it was written: what two rules are compared by. */
export function normalRecurrence(recurrence: EventRecurrence): EventRecurrence {
  const weekdays =
    recurrence.frequency === 'weekly' && recurrence.weekdays?.length
      ? WEEKDAYS.filter((weekday) => recurrence.weekdays!.includes(weekday))
      : undefined

  return {
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    ...(weekdays ? { weekdays } : {}),
    ...(recurrence.frequency === 'monthly' ? { monthlyBy: recurrence.monthlyBy ?? 'day' } : {}),
    ...(recurrence.until !== undefined ? { until: recurrence.until } : {}),
    ...(recurrence.count !== undefined ? { count: recurrence.count } : {})
  }
}

/** Whether two ways of repeating are the same: none, another's rule, or the same rule. */
export function sameRecurrence(
  a: EventRecurrence | 'other' | null | undefined,
  b: EventRecurrence | 'other' | null | undefined
): boolean {
  if (!a || !b || a === 'other' || b === 'other') {
    return (a ?? null) === (b ?? null)
  }

  return JSON.stringify(normalRecurrence(a)) === JSON.stringify(normalRecurrence(b))
}

/**
 * What is wrong with a rule, in the user's words — or null: from its
 * first day (AAAA-MM-GG), as it would be written.
 */
export function recurrenceProblem(recurrence: EventRecurrence, firstDay: string): string | null {
  const m = messages(MESSAGES)

  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    return m.interval
  }

  if (
    recurrence.count !== undefined &&
    (!Number.isInteger(recurrence.count) || recurrence.count < 1)
  ) {
    return m.count
  }

  if (recurrence.count !== undefined && recurrence.until !== undefined) {
    return m.untilAndCount
  }

  if (recurrence.until !== undefined && recurrence.until.slice(0, 10) < firstDay.slice(0, 10)) {
    return m.untilBeforeStart
  }

  if (recurrence.weekdays?.length && recurrence.frequency !== 'weekly') {
    return m.weekdaysWeekly
  }

  if (recurrence.monthlyBy !== undefined && recurrence.frequency !== 'monthly') {
    return m.monthlyByMonthly
  }

  if (recurrence.monthlyBy === 'lastWeekday' && !lastOfWeekday(firstDay)) {
    return m.notLastWeekday
  }

  return null
}

/**
 * A rule moved with its series by some days: the weekdays it names move
 * with it — Monday and Thursday a day later are Tuesday and Friday —, what
 * it says of the start's day follows the start by itself.
 */
export function shiftedRecurrence(recurrence: EventRecurrence, days: number): EventRecurrence {
  const by = ((days % 7) + 7) % 7

  if (by === 0 || !recurrence.weekdays?.length) {
    return recurrence
  }

  return {
    ...recurrence,
    weekdays: recurrence.weekdays.map((weekday) => WEEKDAYS[(WEEKDAYS.indexOf(weekday) + by) % 7])
  }
}

/**
 * Whether a weekly rule that skips weeks reads the same with its weeks
 * beginning on another day: it does unless its days — the start's among
 * them — sit on both sides of where that week would begin.
 */
function sameWeeks(days: ReadonlyArray<Weekday>, weekStart: Weekday): boolean {
  const boundary = WEEKDAYS.indexOf(weekStart)
  const sides = new Set(days.map((day) => WEEKDAYS.indexOf(day) >= boundary))
  return boundary === 0 || sides.size <= 1
}

/* ─────────────────────────── iCalendar ─────────────────────────── */

const ICAL_WEEKDAYS: ReadonlyArray<Weekday> = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * The last day a rule may fall on, from its UNTIL: a day as it is; an
 * instant — in UTC, or the series' own hours — on its day in the series'
 * zone, the day before when it comes before the series' hour that day.
 */
function untilDay(until: ICAL.Time, anchor: SeriesAnchor): string {
  if (until.isDate) {
    return wallDay(until)
  }

  const wall =
    until.zone === ICAL.Timezone.utcTimezone
      ? wallOf(until.toJSDate().getTime(), anchor.zone)
      : {
          year: until.year,
          month: until.month,
          day: until.day,
          hour: until.hour,
          minute: until.minute,
          second: until.second
        }
  const day = wallDay(wall)
  const seconds = wall.hour * 3600 + wall.minute * 60 + wall.second
  return seconds < anchor.seconds ? addDays(day, -1) : day
}

/**
 * How a series repeats, from the lines its recurrence is written in —
 * RRULE, EXDATE, RDATE, EXRULE, as Google gives them and a VEVENT holds
 * them — and where it begins. One RRULE the app writes is its rule; days
 * taken out (EXDATE) leave it as it is; anything more is `'other'`.
 */
export function recurrenceOfLines(
  lines: ReadonlyArray<string>,
  anchor: SeriesAnchor
): EventRecurrence | 'other' | null {
  const named = lines.map((line) => ({
    name: line
      .slice(0, line.search(/[:;]|$/))
      .trim()
      .toUpperCase(),
    value: line.slice(line.indexOf(':') + 1).trim()
  }))
  const rules = named.filter((line) => line.name === 'RRULE')

  if (rules.length === 0 && !named.some((line) => line.name === 'RDATE')) {
    return null
  }

  if (rules.length !== 1 || named.some((line) => line.name === 'RDATE' || line.name === 'EXRULE')) {
    return 'other'
  }

  try {
    return recurrenceOfRecur(ICAL.Recur.fromString(rules[0].value), anchor)
  } catch {
    return 'other'
  }
}

/** The parts of a rule the app reads; any other makes it `'other'`. */
const READ_PARTS = new Set(['BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS'])

function recurrenceOfRecur(recur: ICAL.Recur, anchor: SeriesAnchor): EventRecurrence | 'other' {
  const parts = recur.parts as Record<string, Array<string | number> | undefined>
  const list = (name: string): Array<string | number> => parts[name] ?? []

  if (
    Object.entries(parts).some(([name, values]) => !READ_PARTS.has(name) && values?.length) ||
    (recur.count && recur.until)
  ) {
    return 'other'
  }

  const interval = recur.interval || 1
  const byDay = list('BYDAY').map(String)
  const byMonthDay = list('BYMONTHDAY').map(Number)
  const byMonth = list('BYMONTH').map(Number)
  const bySetPos = list('BYSETPOS').map(Number)
  const plain = byDay.every((day) => (ICAL_WEEKDAYS as string[]).includes(day))
  const weekday = weekdayOf(anchor.day)
  const [, month, date] = anchor.day.split('-').map(Number)
  let rule: EventRecurrence

  switch (recur.freq) {
    case 'DAILY':
      if (byMonthDay.length || byMonth.length || bySetPos.length || !plain) {
        return 'other'
      }

      if (byDay.length === 0) {
        rule = { frequency: 'daily', interval }
      } else if (interval === 1) {
        // Every day of those: the same as every week on them.
        rule = { frequency: 'weekly', interval, weekdays: byDay as Weekday[] }
      } else {
        return 'other'
      }
      break
    case 'WEEKLY': {
      if (byMonthDay.length || byMonth.length || bySetPos.length || !plain) {
        return 'other'
      }

      const weekStart = ICAL_WEEKDAYS[(recur.wkst ?? 2) - 1] ?? 'MO'

      if (interval > 1 && !sameWeeks([...(byDay as Weekday[]), weekday], weekStart)) {
        return 'other'
      }

      rule = {
        frequency: 'weekly',
        interval,
        ...(byDay.length ? { weekdays: byDay as Weekday[] } : {})
      }
      break
    }
    case 'MONTHLY': {
      if (byMonth.length) {
        return 'other'
      }

      if (byDay.length === 0 && bySetPos.length === 0) {
        if (byMonthDay.length > 1 || (byMonthDay.length === 1 && byMonthDay[0] !== date)) {
          return 'other'
        }

        rule = { frequency: 'monthly', interval, monthlyBy: 'day' }
        break
      }

      const [, ordinal, day] = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(byDay[0] ?? '') ?? []
      const place = ordinal
        ? bySetPos.length
          ? Number.NaN
          : Number(ordinal)
        : bySetPos.length === 1
          ? bySetPos[0]
          : Number.NaN

      if (byDay.length !== 1 || byMonthDay.length || day !== weekday) {
        return 'other'
      }

      if (place === -1 && lastOfWeekday(anchor.day)) {
        rule = { frequency: 'monthly', interval, monthlyBy: 'lastWeekday' }
      } else if (place === ordinalOf(anchor.day)) {
        rule = { frequency: 'monthly', interval, monthlyBy: 'weekday' }
      } else {
        return 'other'
      }
      break
    }
    case 'YEARLY':
      if (
        byDay.length ||
        bySetPos.length ||
        byMonth.some((value) => value !== month) ||
        byMonthDay.some((value) => value !== date) ||
        byMonth.length > 1 ||
        byMonthDay.length > 1
      ) {
        return 'other'
      }

      rule = { frequency: 'yearly', interval }
      break
    default:
      return 'other'
  }

  return {
    ...rule,
    ...(recur.until ? { until: untilDay(recur.until, anchor) } : {}),
    ...(recur.count ? { count: recur.count } : {})
  }
}

/** An instant as iCalendar writes one in UTC: 20261222T225959Z. */
function utcStamp(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g, '')
}

/**
 * A rule as an RRULE's value, from where its series begins: what it says
 * of the start's day left to the start (DTSTART); its end a day — of a
 * timed series the end of that day in its zone, in UTC, as RFC 5545 asks
 * of a start with a zone —; never a count and an end together.
 */
export function ruleOf(recurrence: EventRecurrence, anchor: SeriesAnchor): string {
  const parts = [`FREQ=${recurrence.frequency.toUpperCase()}`]

  if (recurrence.interval > 1) {
    parts.push(`INTERVAL=${recurrence.interval}`)
  }

  if (recurrence.frequency === 'weekly' && recurrence.weekdays?.length) {
    parts.push(`BYDAY=${WEEKDAYS.filter((day) => recurrence.weekdays!.includes(day)).join(',')}`)
  }

  if (recurrence.frequency === 'monthly' && recurrence.monthlyBy === 'weekday') {
    parts.push(`BYDAY=${ordinalOf(anchor.day)}${weekdayOf(anchor.day)}`)
  }

  if (recurrence.frequency === 'monthly' && recurrence.monthlyBy === 'lastWeekday') {
    parts.push(`BYDAY=-1${weekdayOf(anchor.day)}`)
  }

  if (recurrence.count !== undefined) {
    parts.push(`COUNT=${recurrence.count}`)
  } else if (recurrence.until !== undefined) {
    const until = recurrence.until.slice(0, 10)
    const [year, month, day] = until.split('-').map(Number)

    parts.push(
      `UNTIL=${
        anchor.allDay
          ? until.replaceAll('-', '')
          : utcStamp(
              instantOfWall({ year, month, day, hour: 23, minute: 59, second: 59 }, anchor.zone)
            )
      }`
    )
  }

  return parts.join(';')
}

/* ─────────────────────────── Microsoft Graph ─────────────────────────── */

/** How Graph writes a recurrence (patternedRecurrence): what repeats, and for how long. */
export interface GraphRecurrence {
  pattern: {
    type: string
    interval?: number
    month?: number
    dayOfMonth?: number
    daysOfWeek?: string[]
    firstDayOfWeek?: string
    index?: string
  }
  range: {
    type: string
    startDate?: string
    endDate?: string | null
    numberOfOccurrences?: number
    recurrenceTimeZone?: string | null
  }
}

const GRAPH_DAYS: Readonly<Record<Weekday, string>> = {
  MO: 'monday',
  TU: 'tuesday',
  WE: 'wednesday',
  TH: 'thursday',
  FR: 'friday',
  SA: 'saturday',
  SU: 'sunday'
}

const GRAPH_INDEX = ['first', 'second', 'third', 'fourth'] as const

const weekdayOfGraph = (day: string): Weekday | undefined =>
  WEEKDAYS.find((weekday) => GRAPH_DAYS[weekday] === day.toLowerCase())

/** The day an Exchange series begins on, as its range says it. */
export function graphStartDay(recurrence: GraphRecurrence): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(recurrence.range.startDate ?? '')
    ? recurrence.range.startDate!.slice(0, 10)
    : null
}

/**
 * How a series repeats, from Graph's patterned recurrence: read from the
 * day its range begins — Exchange's own day, in its zone. A pattern the app
 * does not write (a weekday's place in a year, a day other than the start's)
 * is `'other'`.
 */
export function recurrenceOfGraph(recurrence: GraphRecurrence): EventRecurrence | 'other' {
  const start = graphStartDay(recurrence)

  if (!start) {
    return 'other'
  }

  const { pattern, range } = recurrence
  const interval = pattern.interval && pattern.interval > 0 ? pattern.interval : 1
  const days = (pattern.daysOfWeek ?? []).map(weekdayOfGraph)
  const weekday = weekdayOf(start)
  const [, month, date] = start.split('-').map(Number)
  let rule: EventRecurrence

  if (days.some((day) => day === undefined)) {
    return 'other'
  }

  switch (pattern.type) {
    case 'daily':
      rule = { frequency: 'daily', interval }
      break
    case 'weekly': {
      const weekStart = weekdayOfGraph(pattern.firstDayOfWeek ?? 'sunday') ?? 'SU'

      if (interval > 1 && !sameWeeks([...(days as Weekday[]), weekday], weekStart)) {
        return 'other'
      }

      rule = {
        frequency: 'weekly',
        interval,
        ...(days.length ? { weekdays: WEEKDAYS.filter((day) => days.includes(day)) } : {})
      }
      break
    }
    case 'absoluteMonthly':
      if (pattern.dayOfMonth !== date) {
        return 'other'
      }

      rule = { frequency: 'monthly', interval, monthlyBy: 'day' }
      break
    case 'relativeMonthly': {
      if (days.length !== 1 || days[0] !== weekday) {
        return 'other'
      }

      const index = pattern.index ?? 'first'

      if (index === 'last' && lastOfWeekday(start)) {
        rule = { frequency: 'monthly', interval, monthlyBy: 'lastWeekday' }
      } else if (GRAPH_INDEX[ordinalOf(start) - 1] === index) {
        rule = { frequency: 'monthly', interval, monthlyBy: 'weekday' }
      } else {
        return 'other'
      }
      break
    }
    case 'absoluteYearly':
      if (pattern.month !== month || pattern.dayOfMonth !== date) {
        return 'other'
      }

      rule = { frequency: 'yearly', interval }
      break
    default:
      return 'other'
  }

  return {
    ...rule,
    ...(range.type === 'endDate' && range.endDate ? { until: range.endDate.slice(0, 10) } : {}),
    ...(range.type === 'numbered' && range.numberOfOccurrences
      ? { count: range.numberOfOccurrences }
      : {})
  }
}

/**
 * A rule as Graph takes it, from the series' first day in `zone`: only
 * the fields its pattern and range have — Graph checks those that do not
 * belong. Null for a weekday's fifth time in the month, which Exchange
 * cannot say.
 */
export function graphRecurrenceOf(
  recurrence: EventRecurrence,
  startDay: string,
  zone: string
): GraphRecurrence | null {
  const interval = recurrence.interval
  const weekday = weekdayOf(startDay)
  const [, month, date] = startDay.split('-').map(Number)
  let pattern: GraphRecurrence['pattern']

  switch (recurrence.frequency) {
    case 'daily':
      pattern = { type: 'daily', interval }
      break
    case 'weekly':
      pattern = {
        type: 'weekly',
        interval,
        daysOfWeek: (recurrence.weekdays?.length
          ? WEEKDAYS.filter((day) => recurrence.weekdays!.includes(day))
          : [weekday]
        ).map((day) => GRAPH_DAYS[day]),
        firstDayOfWeek: 'monday'
      }
      break
    case 'monthly':
      if (recurrence.monthlyBy === 'weekday') {
        const index = GRAPH_INDEX[ordinalOf(startDay) - 1]

        if (!index) {
          return null
        }

        pattern = { type: 'relativeMonthly', interval, daysOfWeek: [GRAPH_DAYS[weekday]], index }
      } else if (recurrence.monthlyBy === 'lastWeekday') {
        pattern = {
          type: 'relativeMonthly',
          interval,
          daysOfWeek: [GRAPH_DAYS[weekday]],
          index: 'last'
        }
      } else {
        pattern = { type: 'absoluteMonthly', interval, dayOfMonth: date }
      }
      break
    case 'yearly':
      pattern = { type: 'absoluteYearly', interval, dayOfMonth: date, month }
      break
  }

  const range: GraphRecurrence['range'] =
    recurrence.count !== undefined
      ? { type: 'numbered', startDate: startDay, numberOfOccurrences: recurrence.count }
      : recurrence.until !== undefined
        ? { type: 'endDate', startDate: startDay, endDate: recurrence.until.slice(0, 10) }
        : { type: 'noEnd', startDate: startDay }

  return { pattern, range: { ...range, recurrenceTimeZone: zone } }
}

/* ─────────────────────────── a series moved ─────────────────────────── */

/** An event's times as a write gives them: instants, or an all-day one's days. */
export interface EventTimes {
  start: string
  end: string
  allDay: boolean
}

/** The day a time falls on in a zone: an all-day one's own. */
export function dayIn(time: string, allDay: boolean, zone: string): string {
  return allDay ? time.slice(0, 10) : wallDay(wallOf(Date.parse(time), zone))
}

/**
 * A series moved by what one of its times moved — `from`, as it was, to
 * `to`, as it is to be —: its first time moved by the same days, at the
 * hour that time now has, lasting as it now does (vision §7.5). Counted on
 * the clock of the series' zone, so a series that crosses a change of the
 * clocks keeps its hour. `days`: how many days it moved by.
 */
export function shiftedSeries(
  first: EventTimes,
  from: EventTimes,
  to: EventTimes,
  zone: string
): EventTimes & { days: number } {
  const days =
    dayNumber(dayIn(to.start, to.allDay, zone)) - dayNumber(dayIn(from.start, from.allDay, zone))
  const day = addDays(dayIn(first.start, first.allDay, zone), days)

  if (to.allDay) {
    const length = Math.max(1, dayNumber(to.end) - dayNumber(to.start))
    return { start: day, end: addDays(day, length), allDay: true, days }
  }

  const [year, month, date] = day.split('-').map(Number)
  const hour = wallOf(Date.parse(to.start), zone)
  const start = instantOfWall({ ...hour, year, month, day: date }, zone)

  return {
    start: new Date(start).toISOString(),
    end: new Date(start + Math.max(0, Date.parse(to.end) - Date.parse(to.start))).toISOString(),
    allDay: false,
    days
  }
}
