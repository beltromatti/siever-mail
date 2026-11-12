import { afterEach, describe, expect, it, vi } from 'vitest'

import { messagesIn, type LanguageState } from '@shared/i18n'

import { recurrenceWords, reminderWords, remindersWords } from './recurrence-words'

const language = vi.hoisted(() => ({
  state: { language: 'en', formatLocale: 'en-IT' } as LanguageState
}))

vi.mock('@renderer/lib/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/lib/i18n')>()),
  languageNow: () => language.state,
  messagesNow: (messages: Parameters<typeof messagesIn>[0]) =>
    messagesIn(messages, language.state.language)
}))

const speak = (state: LanguageState): void => {
  language.state = state
}

// Thursday 12 November 2026: the second Thursday of its month.
const THURSDAY = new Date(2026, 10, 12)
// Friday 27 November 2026: the last Friday of its month, its fourth.
const LAST_FRIDAY = new Date(2026, 10, 27)
// Sunday 8 November 2026: the second Sunday.
const SUNDAY = new Date(2026, 10, 8)
const THIS_YEAR = new Date().getFullYear()

describe('how an event repeats, in words (vision §7.5)', () => {
  afterEach(() => speak({ language: 'en', formatLocale: 'en-IT' }))

  it('says it in English', () => {
    speak({ language: 'en', formatLocale: 'en-IT' })

    expect(recurrenceWords({ frequency: 'daily', interval: 1 }, THURSDAY)).toBe('Every day')
    expect(recurrenceWords({ frequency: 'daily', interval: 3 }, THURSDAY)).toBe('Every 3 days')
    expect(
      recurrenceWords(
        { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] },
        THURSDAY
      )
    ).toBe('Every weekday')
    expect(recurrenceWords({ frequency: 'weekly', interval: 1 }, THURSDAY)).toBe(
      'Every week on Thursday'
    )
    expect(
      recurrenceWords(
        { frequency: 'weekly', interval: 2, weekdays: ['TH', 'MO'], count: 10 },
        THURSDAY
      )
    ).toBe('Every 2 weeks on Monday and Thursday, 10 times')
    expect(recurrenceWords({ frequency: 'monthly', interval: 1 }, THURSDAY)).toBe(
      'Every month on the 12th'
    )
    expect(
      recurrenceWords({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday' }, THURSDAY)
    ).toBe('Every month on the second Thursday')
    expect(
      recurrenceWords(
        { frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday', count: 10 },
        LAST_FRIDAY
      )
    ).toBe('Every month on the last Friday, 10 times')
    expect(recurrenceWords({ frequency: 'yearly', interval: 1 }, THURSDAY)).toBe(
      'Every year on 12 November'
    )
    expect(
      recurrenceWords({ frequency: 'daily', interval: 1, until: `${THIS_YEAR}-12-22` }, THURSDAY)
    ).toBe('Every day, until 22 Dec')
    expect(recurrenceWords({ frequency: 'daily', interval: 1, count: 1 }, THURSDAY)).toBe(
      'Every day, once'
    )
    expect(recurrenceWords('other', THURSDAY)).toBe('Repeats (by a rule made elsewhere)')
  })

  it('says it in Italian, with the articles the days take', () => {
    speak({ language: 'it', formatLocale: 'it-IT' })

    expect(
      recurrenceWords(
        { frequency: 'weekly', interval: 2, weekdays: ['MO', 'TH'], until: `${THIS_YEAR}-12-22` },
        THURSDAY
      )
    ).toBe('Ogni 2 settimane il lunedì e il giovedì, fino al 22 dic')
    expect(recurrenceWords({ frequency: 'weekly', interval: 1, weekdays: ['SU'] }, SUNDAY)).toBe(
      'Ogni settimana la domenica'
    )
    expect(
      recurrenceWords({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday' }, SUNDAY)
    ).toBe('Ogni mese la seconda domenica')
    expect(
      recurrenceWords({ frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' }, LAST_FRIDAY)
    ).toBe('Ogni mese l’ultimo venerdì')
    expect(recurrenceWords({ frequency: 'monthly', interval: 3 }, THURSDAY)).toBe(
      'Ogni 3 mesi il giorno 12'
    )
    expect(recurrenceWords({ frequency: 'yearly', interval: 1 }, new Date(2026, 10, 8))).toBe(
      'Ogni anno l’8 novembre'
    )
    expect(
      recurrenceWords({ frequency: 'daily', interval: 1, until: `${THIS_YEAR}-12-11` }, THURSDAY)
    ).toBe('Ogni giorno, fino all’11 dic')
    expect(
      recurrenceWords(
        { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] },
        THURSDAY
      )
    ).toBe('Ogni giorno feriale')
    expect(recurrenceWords('other', THURSDAY)).toBe('Si ripete (con una regola fatta altrove)')
  })

  it('says it in German', () => {
    speak({ language: 'de', formatLocale: 'de-DE' })

    expect(
      recurrenceWords({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'] }, THURSDAY)
    ).toBe('Jede Woche am Montag und Donnerstag')
    expect(
      recurrenceWords(
        { frequency: 'monthly', interval: 2, monthlyBy: 'weekday', count: 5 },
        THURSDAY
      )
    ).toBe('Alle 2 Monate am zweiten Donnerstag, 5-mal')
    expect(recurrenceWords({ frequency: 'monthly', interval: 1 }, THURSDAY)).toBe(
      'Jeden Monat am 12.'
    )
    expect(recurrenceWords({ frequency: 'yearly', interval: 1 }, THURSDAY)).toBe(
      'Jedes Jahr am 12. November'
    )
  })

  it('lists the weekdays in the region’s week order', () => {
    // In the United States weeks start on Sunday.
    speak({ language: 'en', formatLocale: 'en-US' })

    expect(
      recurrenceWords({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'SU'] }, THURSDAY)
    ).toBe('Every week on Sunday and Monday')
  })

  it('keeps a month’s weekday true to a start in the fifth week: it is the last', () => {
    speak({ language: 'en', formatLocale: 'en-IT' })

    // Monday 30 November 2026, the fifth Monday.
    expect(
      recurrenceWords(
        { frequency: 'monthly', interval: 1, monthlyBy: 'weekday' },
        new Date(2026, 10, 30)
      )
    ).toBe('Every month on the last Monday')
  })
})

describe('reminders, in words', () => {
  afterEach(() => speak({ language: 'en', formatLocale: 'en-IT' }))

  it('says when each rings, before an event with a time or on the days before one all day', () => {
    speak({ language: 'en', formatLocale: 'en-IT' })

    expect(reminderWords(0, false)).toBe('At the start')
    expect(reminderWords(10, false)).toBe('10 minutes before')
    expect(reminderWords(60, false)).toBe('1 hour before')
    expect(reminderWords(90, false)).toBe('1 hour and 30 minutes before')
    expect(reminderWords(2880, false)).toBe('2 days before')
    expect(reminderWords(10080, false)).toBe('1 week before')
    expect(reminderWords(900, true)).toBe('The day before at 09:00')
    expect(reminderWords(9540, true)).toBe('A week before at 09:00')
    expect(reminderWords(2340, true)).toBe('2 days before at 09:00')
    expect(remindersWords(null, false)).toBe('The calendar’s defaults')
    expect(remindersWords([], false)).toBe('None')
    expect(remindersWords([1440, 10], false)).toBe('10 minutes before, 1 day before')
  })

  it('says them in Italian and German', () => {
    speak({ language: 'it', formatLocale: 'it-IT' })
    expect(reminderWords(900, true)).toBe('Il giorno prima alle 09:00')
    expect(remindersWords([30, 0], false)).toBe('All’inizio, 30 minuti prima')

    speak({ language: 'de', formatLocale: 'de-DE' })
    expect(reminderWords(120, false)).toBe('2 Stunden vorher')
    expect(reminderWords(900, true)).toBe('Am Vortag um 09:00')
  })
})
