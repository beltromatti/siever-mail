import { describe, expect, it, vi } from 'vitest'

import type { LanguageState } from '@shared/i18n'

import {
  changeScope,
  customOf,
  fitRecurrence,
  isRecurrence,
  presetOf,
  recurrenceOfCustom,
  repeatPresets,
  sameRecurrence,
  weekOrder
} from './recurrence'

const language = vi.hoisted(() => ({
  state: { language: 'en', formatLocale: 'en-IT' } as LanguageState
}))

vi.mock('@renderer/lib/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/lib/i18n')>()),
  languageNow: () => language.state
}))

// Tuesday 10 November 2026: the second Tuesday of its month, not its last.
const TUESDAY = new Date(2026, 10, 10)
// Tuesday 24 November 2026: the fourth Tuesday, and the last.
const LAST_TUESDAY = new Date(2026, 10, 24)
// Tuesday 29 December 2026: the fifth Tuesday — the last.
const FIFTH_TUESDAY = new Date(2026, 11, 29)

describe('the choices of «Ripeti» (vision §7.5)', () => {
  it('offers a month’s weekday by its place up to the fourth, and the last only in the last week', () => {
    expect(repeatPresets(TUESDAY).map((preset) => preset.id)).toEqual([
      'none',
      'daily',
      'workdays',
      'weekly',
      'monthlyDay',
      'monthlyWeekday',
      'yearly'
    ])
    expect(repeatPresets(LAST_TUESDAY).map((preset) => preset.id)).toContain('monthlyLast')
    expect(repeatPresets(LAST_TUESDAY).map((preset) => preset.id)).toContain('monthlyWeekday')
    expect(repeatPresets(FIFTH_TUESDAY).map((preset) => preset.id)).not.toContain('monthlyWeekday')
    expect(repeatPresets(FIFTH_TUESDAY).map((preset) => preset.id)).toContain('monthlyLast')
  })

  it('finds the choice a rule is, whatever it leaves to the start', () => {
    expect(presetOf(null, TUESDAY)).toBe('none')
    expect(presetOf({ frequency: 'weekly', interval: 1 }, TUESDAY)).toBe('weekly')
    // The start's own weekday, written out, is the same week.
    expect(presetOf({ frequency: 'weekly', interval: 1, weekdays: ['TU'] }, TUESDAY)).toBe('weekly')
    expect(
      presetOf(
        { frequency: 'weekly', interval: 1, weekdays: ['FR', 'TH', 'WE', 'TU', 'MO'] },
        TUESDAY
      )
    ).toBe('workdays')
    expect(presetOf({ frequency: 'monthly', interval: 1 }, TUESDAY)).toBe('monthlyDay')
    expect(presetOf({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday' }, TUESDAY)).toBe(
      'monthlyWeekday'
    )
    expect(
      presetOf({ frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' }, LAST_TUESDAY)
    ).toBe('monthlyLast')
    expect(presetOf({ frequency: 'yearly', interval: 1 }, TUESDAY)).toBe('yearly')
  })

  it('leaves to the custom choice what no ready one says', () => {
    expect(presetOf({ frequency: 'weekly', interval: 2 }, TUESDAY)).toBe('custom')
    expect(presetOf({ frequency: 'daily', interval: 1, count: 5 }, TUESDAY)).toBe('custom')
    expect(presetOf({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'] }, TUESDAY)).toBe(
      'custom'
    )
  })

  it('compares rules by how they repeat, not how they are written', () => {
    expect(
      sameRecurrence(
        { frequency: 'monthly', interval: 1 },
        { frequency: 'monthly', interval: 1, monthlyBy: 'day', weekdays: ['MO'] },
        TUESDAY
      )
    ).toBe(true)
    expect(
      sameRecurrence(
        { frequency: 'daily', interval: 1 },
        { frequency: 'daily', interval: 1, until: '2026-12-31' },
        TUESDAY
      )
    ).toBe(false)
    expect(sameRecurrence(null, null, TUESDAY)).toBe(true)
    expect(sameRecurrence(null, { frequency: 'daily', interval: 1 }, TUESDAY)).toBe(false)
  })

  it('keeps a month’s weekday true to a start that moved', () => {
    expect(
      fitRecurrence({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday' }, FIFTH_TUESDAY)
        .monthlyBy
    ).toBe('lastWeekday')
    expect(
      fitRecurrence({ frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' }, TUESDAY)
        .monthlyBy
    ).toBe('weekday')
  })

  it('reads a rule a proposal carries, and only a rule', () => {
    expect(isRecurrence({ frequency: 'weekly', interval: 1, weekdays: ['MO'] })).toBe(true)
    expect(isRecurrence({ frequency: 'hourly', interval: 1 })).toBe(false)
    expect(isRecurrence({ frequency: 'daily', interval: 0 })).toBe(false)
    expect(isRecurrence('weekly')).toBe(false)
    expect(isRecurrence(null)).toBe(false)
  })
})

describe('the custom rule', () => {
  it('opens on every week from the start’s weekday, or on the rule as it is', () => {
    expect(customOf(null, TUESDAY)).toMatchObject({
      frequency: 'weekly',
      interval: '1',
      weekdays: ['TU'],
      ends: 'never'
    })
    expect(
      customOf({ frequency: 'monthly', interval: 2, monthlyBy: 'weekday', count: 6 }, TUESDAY)
    ).toMatchObject({
      frequency: 'monthly',
      interval: '2',
      monthlyBy: 'weekday',
      ends: 'count',
      count: '6'
    })
  })

  it('makes the rule the calendars take: only what its frequency uses', () => {
    const custom = customOf(null, TUESDAY)

    expect(
      recurrenceOfCustom(
        { ...custom, interval: '2', weekdays: ['TH', 'MO'], ends: 'until', until: '2026-12-22' },
        TUESDAY
      )
    ).toEqual({
      recurrence: { frequency: 'weekly', interval: 2, weekdays: ['MO', 'TH'], until: '2026-12-22' }
    })
    expect(
      recurrenceOfCustom(
        { ...custom, frequency: 'monthly', monthlyBy: 'weekday', ends: 'count', count: '10' },
        TUESDAY
      )
    ).toEqual({
      recurrence: { frequency: 'monthly', interval: 1, monthlyBy: 'weekday', count: 10 }
    })
    // A week with no day chosen falls on the start's.
    expect(recurrenceOfCustom({ ...custom, weekdays: [] }, TUESDAY)).toEqual({
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['TU'] }
    })
  })

  it('says what is wrong: how often, how many times, until when', () => {
    const custom = customOf(null, TUESDAY)

    expect(recurrenceOfCustom({ ...custom, interval: '0' }, TUESDAY)).toEqual({
      problem: 'interval'
    })
    expect(recurrenceOfCustom({ ...custom, interval: '1.5' }, TUESDAY)).toEqual({
      problem: 'interval'
    })
    expect(recurrenceOfCustom({ ...custom, ends: 'count', count: '' }, TUESDAY)).toEqual({
      problem: 'count'
    })
    expect(recurrenceOfCustom({ ...custom, ends: 'until', until: '2026-11-09' }, TUESDAY)).toEqual({
      problem: 'until'
    })
    // The start's own day is a day it may end on.
    expect(
      recurrenceOfCustom({ ...custom, ends: 'until', until: '2026-11-10' }, TUESDAY)
    ).toMatchObject({ recurrence: { until: '2026-11-10' } })
  })

  it('lays the weekdays out as the region’s week', () => {
    language.state = { language: 'en', formatLocale: 'en-US' }
    expect(weekOrder()[0]).toBe('SU')
    language.state = { language: 'it', formatLocale: 'it-IT' }
    expect(weekOrder()[0]).toBe('MO')
  })
})

describe('whom a change is for, of an event that may repeat', () => {
  const instance = { seriesId: 'serie-lezioni' }

  it('asks of an instance, says nothing of an event on its own', () => {
    expect(changeScope({ seriesId: null }, { title: 'Lezione' })).toBe('single')
    expect(changeScope(instance, { title: 'Lezione' })).toBe('ask')
    expect(changeScope(instance, { reminders: [10] })).toBe('ask')
  })

  it('gives the series how it repeats, and the calendar it moves to, without asking', () => {
    expect(changeScope(instance, { recurrence: { frequency: 'weekly', interval: 2 } })).toBe(
      'series'
    )
    expect(changeScope(instance, { recurrence: null })).toBe('series')
    expect(changeScope(instance, { calendarKey: 'c1\u0000lavoro', title: 'Lezione' })).toBe(
      'series'
    )
  })
})
