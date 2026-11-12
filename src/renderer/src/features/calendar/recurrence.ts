import { firstDayOfWeek, languageNow } from '@renderer/lib/i18n'
import {
  WEEKDAYS,
  type CalendarEvent,
  type EventChange,
  type EventRecurrence,
  type Weekday
} from '@shared/calendar'

import { addDays, dayKey, dayOfKey } from './calendar-dates'

/**
 * How an event repeats, as the Calendario chooses it (vision §7.5): the
 * choices a calendar offers from an event's start — every day, every
 * weekday, every week on its weekday, every month on its day or on its
 * weekday's place in the month, every year — and the custom rule, both
 * turned into the `EventRecurrence` the calendars share.
 */

/** Date's `getDay()` (Sunday first) as iCalendar names the days. */
const BY_GET_DAY: ReadonlyArray<Weekday> = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** The working week, Monday to Friday: "every weekday". */
export const WORKDAYS: ReadonlyArray<Weekday> = ['MO', 'TU', 'WE', 'TH', 'FR']

/** The weekday of a day. */
export function weekdayOf(day: Date): Weekday {
  return BY_GET_DAY[day.getDay()]
}

/** A day that is the given weekday — the week of 1 January 2024, a Monday — to name it. */
export function weekdayDate(weekday: Weekday): Date {
  return new Date(2024, 0, 1 + WEEKDAYS.indexOf(weekday))
}

/** The days of a week in the region's order: from Monday in Italy, from Sunday in the United States. */
export function weekOrder(): Weekday[] {
  const first = (firstDayOfWeek(languageNow().formatLocale) + 6) % 7
  return WEEKDAYS.map((_, index) => WEEKDAYS[(first + index) % 7])
}

/** Which of its weekday in the month a day is: the 10th of a month starting on a Monday is its second Tuesday. */
export function weekdayPlace(day: Date): number {
  return Math.ceil(day.getDate() / 7)
}

/** Whether a day is its weekday's last in the month: no week of the month follows it. */
export function isLastWeekdayOfMonth(day: Date): boolean {
  return addDays(day, 7).getMonth() !== day.getMonth()
}

/** The ready choices of «Ripeti», as calendars offer them. */
export type RepeatPresetId =
  | 'none'
  | 'daily'
  | 'workdays'
  | 'weekly'
  | 'monthlyDay'
  | 'monthlyWeekday'
  | 'monthlyLast'
  | 'yearly'

export interface RepeatPreset {
  id: RepeatPresetId
  recurrence: EventRecurrence | null
}

/**
 * The choices for an event starting on `start`: those that depend on the
 * day only where they fit it — the second Tuesday up to the fourth (a
 * fifth is the last), the last Friday only in the month's last week.
 */
export function repeatPresets(start: Date): RepeatPreset[] {
  return [
    { id: 'none', recurrence: null },
    { id: 'daily', recurrence: { frequency: 'daily', interval: 1 } },
    { id: 'workdays', recurrence: { frequency: 'weekly', interval: 1, weekdays: [...WORKDAYS] } },
    { id: 'weekly', recurrence: { frequency: 'weekly', interval: 1 } },
    { id: 'monthlyDay', recurrence: { frequency: 'monthly', interval: 1, monthlyBy: 'day' } },
    ...(weekdayPlace(start) <= 4
      ? [
          {
            id: 'monthlyWeekday' as const,
            recurrence: {
              frequency: 'monthly' as const,
              interval: 1,
              monthlyBy: 'weekday' as const
            }
          }
        ]
      : []),
    ...(isLastWeekdayOfMonth(start)
      ? [
          {
            id: 'monthlyLast' as const,
            recurrence: {
              frequency: 'monthly' as const,
              interval: 1,
              monthlyBy: 'lastWeekday' as const
            }
          }
        ]
      : []),
    { id: 'yearly', recurrence: { frequency: 'yearly', interval: 1 } }
  ]
}

/** Whether a value is a rule of repeating — as a proposal's payload may carry one. */
export function isRecurrence(value: unknown): value is EventRecurrence {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const rule = value as Partial<EventRecurrence>
  return (
    (rule.frequency === 'daily' ||
      rule.frequency === 'weekly' ||
      rule.frequency === 'monthly' ||
      rule.frequency === 'yearly') &&
    Number.isInteger(rule.interval) &&
    (rule.interval ?? 0) >= 1
  )
}

/** The days a weekly rule falls on, from Monday: the start's own when it names none. */
export function ruleWeekdays(recurrence: EventRecurrence, start: Date): Weekday[] {
  const days = recurrence.weekdays?.length ? recurrence.weekdays : [weekdayOf(start)]
  return WEEKDAYS.filter((weekday) => days.includes(weekday))
}

/**
 * A rule as it says itself: only what applies to its frequency, the
 * start's own weekday or day where it names none — so two rules that repeat
 * alike are written alike.
 */
function canonical(recurrence: EventRecurrence, start: Date): EventRecurrence {
  return {
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    ...(recurrence.frequency === 'weekly' ? { weekdays: ruleWeekdays(recurrence, start) } : {}),
    ...(recurrence.frequency === 'monthly' ? { monthlyBy: recurrence.monthlyBy ?? 'day' } : {}),
    ...(recurrence.until ? { until: recurrence.until } : {}),
    ...(recurrence.count ? { count: recurrence.count } : {})
  }
}

/** Whether two ways of repeating, from the same start, repeat alike. */
export function sameRecurrence(
  a: EventRecurrence | null,
  b: EventRecurrence | null,
  start: Date
): boolean {
  if (!a || !b) {
    return a === b
  }

  return JSON.stringify(canonical(a, start)) === JSON.stringify(canonical(b, start))
}

/** The ready choice a rule is, from its start; `custom` for one none of them says. */
export function presetOf(
  recurrence: EventRecurrence | null,
  start: Date
): RepeatPresetId | 'custom' {
  return (
    repeatPresets(start).find((preset) => sameRecurrence(preset.recurrence, recurrence, start))
      ?.id ?? 'custom'
  )
}

/**
 * A rule kept true to a start that moved: a month's weekday by its place
 * becomes its last from the fifth week on, and the last stops being one
 * where the day is no longer in the month's last week.
 */
export function fitRecurrence(recurrence: EventRecurrence, start: Date): EventRecurrence {
  if (recurrence.frequency !== 'monthly') {
    return recurrence
  }

  if (recurrence.monthlyBy === 'weekday' && weekdayPlace(start) > 4) {
    return { ...recurrence, monthlyBy: 'lastWeekday' }
  }

  if (recurrence.monthlyBy === 'lastWeekday' && !isLastWeekdayOfMonth(start)) {
    return { ...recurrence, monthlyBy: 'weekday' }
  }

  return recurrence
}

/** A rule as the custom choice edits it: every field there, whatever the frequency. */
export interface CustomRepeat {
  frequency: EventRecurrence['frequency']
  /** As typed: checked when the rule is made. */
  interval: string
  weekdays: Weekday[]
  monthlyBy: NonNullable<EventRecurrence['monthlyBy']>
  ends: 'never' | 'until' | 'count'
  /** AAAA-MM-GG. */
  until: string
  count: string
}

/** The custom choice opened on a rule — or, with none, on every week from the start's weekday. */
export function customOf(recurrence: EventRecurrence | null, start: Date): CustomRepeat {
  const rule = recurrence ? fitRecurrence(recurrence, start) : null

  return {
    frequency: rule?.frequency ?? 'weekly',
    interval: String(rule?.interval ?? 1),
    weekdays: rule?.frequency === 'weekly' ? ruleWeekdays(rule, start) : [weekdayOf(start)],
    monthlyBy: rule?.monthlyBy ?? 'day',
    ends: rule?.until ? 'until' : rule?.count ? 'count' : 'never',
    until:
      rule?.until ?? dayKey(new Date(start.getFullYear(), start.getMonth() + 3, start.getDate())),
    count: String(rule?.count ?? 10)
  }
}

/** What is wrong with a custom rule: how often, how many times, until when. */
export type CustomRepeatProblem = 'interval' | 'count' | 'until'

/** A whole number from 1, as typed; null when it is not one. */
function counting(text: string): number | null {
  const value = Number(text.trim())
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null
}

/** The custom choice as the rule the calendars take, or what is wrong with it. */
export function recurrenceOfCustom(
  custom: CustomRepeat,
  start: Date
): { recurrence: EventRecurrence } | { problem: CustomRepeatProblem } {
  const interval = counting(custom.interval)

  if (interval === null) {
    return { problem: 'interval' }
  }

  const count = custom.ends === 'count' ? counting(custom.count) : null

  if (custom.ends === 'count' && count === null) {
    return { problem: 'count' }
  }

  if (
    custom.ends === 'until' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(custom.until) ||
      dayOfKey(custom.until).getTime() < new Date(start).setHours(0, 0, 0, 0))
  ) {
    return { problem: 'until' }
  }

  const weekdays = WEEKDAYS.filter((weekday) => custom.weekdays.includes(weekday))

  return {
    recurrence: fitRecurrence(
      {
        frequency: custom.frequency,
        interval,
        ...(custom.frequency === 'weekly'
          ? { weekdays: weekdays.length > 0 ? weekdays : [weekdayOf(start)] }
          : {}),
        ...(custom.frequency === 'monthly' ? { monthlyBy: custom.monthlyBy } : {}),
        ...(custom.ends === 'until' ? { until: custom.until } : {}),
        ...(count !== null ? { count } : {})
      },
      start
    )
  }
}

/**
 * Whom a change is for, of an event that may be an instance of a series
 * (vision §7.5): an event on its own has no choice; how it repeats is
 * always the series', and an instance moves to another calendar with its
 * series — that change goes to the series, said, not asked; anything else
 * is this event or the whole series, as the user answers.
 */
export function changeScope(
  event: Pick<CalendarEvent, 'seriesId'>,
  change: EventChange
): 'single' | 'series' | 'ask' {
  if (event.seriesId === null) {
    return 'single'
  }

  return change.recurrence !== undefined || change.calendarKey !== undefined ? 'series' : 'ask'
}
