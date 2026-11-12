import { describe, expect, it } from 'vitest'

import type { EventRecurrence } from '@shared/calendar'

import {
  anchorOf,
  graphRecurrenceOf,
  instantOfWall,
  recurrenceOfGraph,
  recurrenceOfLines,
  recurrenceProblem,
  ruleOf,
  shiftedRecurrence,
  shiftedSeries,
  wallOf,
  type SeriesAnchor
} from './recurrence'

/** A lesson on Mondays at nine, in Rome, from 16 November 2026 — winter time. */
const MONDAY_NINE: SeriesAnchor = anchorOf('2026-11-16T08:00:00.000Z', false, 'Europe/Rome')
/** An all-day series from Tuesday 10 November 2026. */
const ALL_DAY: SeriesAnchor = anchorOf('2026-11-10', true, 'Europe/Rome')

describe('wall clocks', () => {
  it('read and write an hour on a zone’s clock, a skipped one as the hour after', () => {
    expect(MONDAY_NINE).toEqual({
      day: '2026-11-16',
      allDay: false,
      zone: 'Europe/Rome',
      seconds: 9 * 3600
    })
    expect(
      new Date(
        instantOfWall(
          { year: 2027, month: 7, day: 5, hour: 9, minute: 0, second: 0 },
          'Europe/Rome'
        )
      ).toISOString()
    ).toBe('2027-07-05T07:00:00.000Z')
    // 28 March 2027, 02:30 never shows in Rome: the clocks go from two to three.
    const skipped = instantOfWall(
      { year: 2027, month: 3, day: 28, hour: 2, minute: 30, second: 0 },
      'Europe/Rome'
    )
    expect(wallOf(skipped, 'Europe/Rome')).toMatchObject({ hour: 3, minute: 30 })
  })
})

describe('an RRULE read', () => {
  it('reads the days of a week, and an end in UTC as the last day it may fall on', () => {
    expect(
      recurrenceOfLines(
        ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261222T225959Z', 'EXDATE:20261123T080000Z'],
        MONDAY_NINE
      )
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'], until: '2026-12-22' })
    // An end at the hour of its last time is that day; one before the series' hour, the day before.
    expect(
      recurrenceOfLines(['RRULE:FREQ=WEEKLY;UNTIL=20261221T080000Z'], MONDAY_NINE)
    ).toMatchObject({ until: '2026-12-21' })
    expect(
      recurrenceOfLines(['RRULE:FREQ=WEEKLY;UNTIL=20261221T000000Z'], MONDAY_NINE)
    ).toMatchObject({ until: '2026-12-20' })
    expect(recurrenceOfLines(['RRULE:FREQ=DAILY;UNTIL=20261130'], ALL_DAY)).toEqual({
      frequency: 'daily',
      interval: 1,
      until: '2026-11-30'
    })
    expect(recurrenceOfLines(['RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=10'], MONDAY_NINE)).toEqual({
      frequency: 'weekly',
      interval: 2,
      count: 10
    })
  })

  it('reads a month by its day, by the place of its weekday, by the last one, and every working day as weeks', () => {
    // 10 November 2026 is the second Tuesday; 27 November the last Friday.
    expect(recurrenceOfLines(['RRULE:FREQ=MONTHLY'], ALL_DAY)).toEqual({
      frequency: 'monthly',
      interval: 1,
      monthlyBy: 'day'
    })
    expect(recurrenceOfLines(['RRULE:FREQ=MONTHLY;BYMONTHDAY=10'], ALL_DAY)).toMatchObject({
      monthlyBy: 'day'
    })
    expect(recurrenceOfLines(['RRULE:FREQ=MONTHLY;BYDAY=2TU'], ALL_DAY)).toMatchObject({
      monthlyBy: 'weekday'
    })
    expect(recurrenceOfLines(['RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2'], ALL_DAY)).toMatchObject({
      monthlyBy: 'weekday'
    })
    const lastFriday = anchorOf('2026-11-27', true, 'Europe/Rome')
    expect(recurrenceOfLines(['RRULE:FREQ=MONTHLY;BYDAY=-1FR'], lastFriday)).toMatchObject({
      monthlyBy: 'lastWeekday'
    })
    expect(recurrenceOfLines(['RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=10'], ALL_DAY)).toEqual({
      frequency: 'yearly',
      interval: 1
    })
    expect(recurrenceOfLines(['RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'], MONDAY_NINE)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: ['MO', 'TU', 'WE', 'TH', 'FR']
    })
  })

  it('takes for another’s rule what the app does not write; none for an event on its own', () => {
    const other = (lines: string[], anchor = MONDAY_NINE): unknown =>
      recurrenceOfLines(lines, anchor)

    expect(recurrenceOfLines([], MONDAY_NINE)).toBeNull()
    expect(other(['RRULE:FREQ=WEEKLY', 'RDATE:20261125T080000Z'])).toBe('other')
    expect(other(['RRULE:FREQ=WEEKLY', 'EXRULE:FREQ=MONTHLY'])).toBe('other')
    expect(other(['RRULE:FREQ=WEEKLY', 'RRULE:FREQ=MONTHLY'])).toBe('other')
    expect(other(['RRULE:FREQ=HOURLY'])).toBe('other')
    expect(other(['RRULE:FREQ=DAILY;BYHOUR=9,15'])).toBe('other')
    expect(other(['RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'])).toBe('other')
    expect(other(['RRULE:FREQ=MONTHLY;BYDAY=3MO'])).toMatchObject({ monthlyBy: 'weekday' })
    expect(other(['RRULE:FREQ=MONTHLY;BYDAY=2MO'])).toBe('other')
    expect(other(['RRULE:FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1'])).toBe('other')
    expect(other(['RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH'])).toBe('other')
    expect(other(['RRULE:FREQ=WEEKLY;COUNT=3;UNTIL=20261222T000000Z'])).toBe('other')
    expect(other(['RRULE:FREQ=SOMETIMES'])).toBe('other')
    // Every other week from Sunday: the same weeks from Monday only when its days sit on one side.
    expect(other(['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=MO,TH'])).toEqual({
      frequency: 'weekly',
      interval: 2,
      weekdays: ['MO', 'TH']
    })
    expect(other(['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,MO'])).toBe('other')
  })
})

describe('an RRULE written', () => {
  it('leaves the start’s day to the start, ends a timed series at the end of its day in UTC, an all-day one on its day', () => {
    expect(
      ruleOf(
        { frequency: 'weekly', interval: 1, weekdays: ['TH', 'MO'], until: '2026-12-22' },
        MONDAY_NINE
      )
    ).toBe('FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261222T225959Z')
    expect(ruleOf({ frequency: 'daily', interval: 3, until: '2026-11-30' }, ALL_DAY)).toBe(
      'FREQ=DAILY;INTERVAL=3;UNTIL=20261130'
    )
    expect(
      ruleOf({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday', count: 6 }, ALL_DAY)
    ).toBe('FREQ=MONTHLY;BYDAY=2TU;COUNT=6')
    expect(
      ruleOf(
        { frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' },
        anchorOf('2026-11-27', true, 'Europe/Rome')
      )
    ).toBe('FREQ=MONTHLY;BYDAY=-1FR')
    expect(ruleOf({ frequency: 'yearly', interval: 1 }, ALL_DAY)).toBe('FREQ=YEARLY')
  })

  it('reads back as written', () => {
    const rules: EventRecurrence[] = [
      { frequency: 'weekly', interval: 2, weekdays: ['MO', 'TH'], until: '2027-01-31' },
      { frequency: 'monthly', interval: 1, monthlyBy: 'weekday', count: 12 },
      { frequency: 'monthly', interval: 3, monthlyBy: 'day' },
      { frequency: 'daily', interval: 1 },
      { frequency: 'yearly', interval: 1, until: '2030-11-16' }
    ]

    for (const rule of rules) {
      expect(recurrenceOfLines([`RRULE:${ruleOf(rule, MONDAY_NINE)}`], MONDAY_NINE)).toEqual(rule)
    }
  })
})

describe('a patterned recurrence of Microsoft', () => {
  it('reads Exchange’s patterns from the day its range begins', () => {
    expect(
      recurrenceOfGraph({
        pattern: {
          type: 'weekly',
          interval: 1,
          daysOfWeek: ['thursday', 'monday'],
          firstDayOfWeek: 'sunday'
        },
        range: { type: 'endDate', startDate: '2026-11-16', endDate: '2026-12-22' }
      })
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'], until: '2026-12-22' })
    expect(
      recurrenceOfGraph({
        pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'second' },
        range: { type: 'numbered', startDate: '2026-11-10', numberOfOccurrences: 5 }
      })
    ).toEqual({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday', count: 5 })
    expect(
      recurrenceOfGraph({
        pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' },
        range: { type: 'noEnd', startDate: '2026-11-27' }
      })
    ).toEqual({ frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' })
    expect(
      recurrenceOfGraph({
        pattern: { type: 'absoluteYearly', interval: 1, month: 11, dayOfMonth: 10 },
        range: { type: 'noEnd', startDate: '2026-11-10' }
      })
    ).toEqual({ frequency: 'yearly', interval: 1 })
    expect(
      recurrenceOfGraph({
        pattern: {
          type: 'relativeYearly',
          interval: 1,
          month: 11,
          daysOfWeek: ['thursday'],
          index: 'fourth'
        },
        range: { type: 'noEnd', startDate: '2026-11-26' }
      })
    ).toBe('other')
    expect(
      recurrenceOfGraph({
        pattern: {
          type: 'weekly',
          interval: 2,
          daysOfWeek: ['sunday', 'monday'],
          firstDayOfWeek: 'sunday'
        },
        range: { type: 'noEnd', startDate: '2026-11-15' }
      })
    ).toBe('other')
  })

  it('writes only what each pattern has, its range from the series’ first day', () => {
    expect(
      graphRecurrenceOf(
        { frequency: 'weekly', interval: 2, until: '2026-12-22' },
        '2026-11-16',
        'Europe/Berlin'
      )
    ).toEqual({
      pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'], firstDayOfWeek: 'monday' },
      range: {
        type: 'endDate',
        startDate: '2026-11-16',
        endDate: '2026-12-22',
        recurrenceTimeZone: 'Europe/Berlin'
      }
    })
    expect(
      graphRecurrenceOf(
        { frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday', count: 3 },
        '2026-11-27',
        'UTC'
      )
    ).toEqual({
      pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' },
      range: {
        type: 'numbered',
        startDate: '2026-11-27',
        numberOfOccurrences: 3,
        recurrenceTimeZone: 'UTC'
      }
    })
    expect(
      graphRecurrenceOf({ frequency: 'yearly', interval: 1 }, '2026-11-10', 'UTC')?.pattern
    ).toEqual({ type: 'absoluteYearly', interval: 1, dayOfMonth: 10, month: 11 })
    // The fifth Tuesday of a month Exchange cannot say.
    expect(
      graphRecurrenceOf(
        { frequency: 'monthly', interval: 1, monthlyBy: 'weekday' },
        '2026-12-29',
        'UTC'
      )
    ).toBeNull()
  })
})

describe('recurrenceProblem', () => {
  it('says in the user’s words what does not hold together', () => {
    const problem = (recurrence: Parameters<typeof recurrenceProblem>[0]): string | null =>
      recurrenceProblem(recurrence, '2026-11-16')

    expect(
      problem({ frequency: 'weekly', interval: 1, weekdays: ['MO'], until: '2026-12-22' })
    ).toBeNull()
    expect(problem({ frequency: 'daily', interval: 0 })).toMatch(/whole number, 1 or more/)
    expect(problem({ frequency: 'daily', interval: 1.5 })).toMatch(/whole number, 1 or more/)
    expect(problem({ frequency: 'daily', interval: 1, count: 0 })).toMatch(/number of times/)
    expect(problem({ frequency: 'daily', interval: 1, count: 3, until: '2026-12-01' })).toMatch(
      /not both/
    )
    expect(problem({ frequency: 'daily', interval: 1, until: '2026-11-15' })).toMatch(
      /before its first day/
    )
    expect(problem({ frequency: 'daily', interval: 1, weekdays: ['MO'] })).toMatch(/every week/)
    expect(problem({ frequency: 'weekly', interval: 1, monthlyBy: 'day' })).toMatch(/every month/)
    expect(problem({ frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' })).toMatch(
      /isn’t the last/
    )
  })
})

describe('a series moved by what one of its times moved', () => {
  it('moves its first time by the same days, at the instance’s new hour on the series’ clock', () => {
    // The series began in winter; its instance in summer goes from Monday at nine to Tuesday at ten.
    const moved = shiftedSeries(
      { start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T09:00:00.000Z', allDay: false },
      { start: '2027-07-05T07:00:00.000Z', end: '2027-07-05T08:00:00.000Z', allDay: false },
      { start: '2027-07-06T08:00:00.000Z', end: '2027-07-06T09:30:00.000Z', allDay: false },
      'Europe/Rome'
    )

    expect(moved).toEqual({
      start: '2026-11-17T09:00:00.000Z',
      end: '2026-11-17T10:30:00.000Z',
      allDay: false,
      days: 1
    })
    expect(
      shiftedSeries(
        { start: '2026-11-10', end: '2026-11-11', allDay: true },
        { start: '2026-12-01', end: '2026-12-02', allDay: true },
        { start: '2026-12-03', end: '2026-12-05', allDay: true },
        'Europe/Rome'
      )
    ).toEqual({ start: '2026-11-12', end: '2026-11-14', allDay: true, days: 2 })
  })

  it('moves the weekdays it names with it', () => {
    expect(
      shiftedRecurrence({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH', 'SU'] }, 1)
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: ['TU', 'FR', 'MO'] })
    expect(shiftedRecurrence({ frequency: 'weekly', interval: 1, weekdays: ['MO'] }, 7)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: ['MO']
    })
  })
})
