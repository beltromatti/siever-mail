import { describe, expect, it } from 'vitest'

import { ToolInputError } from '../agent/tool-types'
import { checkWeekdays, wrongWeekdays } from './weekdays'

// Thursday 5 November 2026, in the afternoon.
const NOW = new Date(2026, 10, 5, 15, 49)

describe('wrongWeekdays', () => {
  it('finds a day given a weekday not its own, and says the right one', () => {
    expect(
      wrongWeekdays(
        'Una cosa non torna: mercoledì 10 il sopralluogo da Energia Verde alle 9:30.',
        NOW
      )
    ).toEqual(['«mercoledì 10»: il 10 novembre 2026 è martedì'])
    expect(wrongWeekdays('Ci vediamo lunedì 4 novembre.', NOW)).toEqual([
      '«lunedì 4 novembre»: il 4 novembre 2026 è mercoledì'
    ])
    expect(wrongWeekdays('consegna mer 10/11/2026', NOW)).toEqual([
      '«mer 10/11/2026»: il 10 novembre 2026 è martedì'
    ])
    expect(wrongWeekdays('lunedì 1° dicembre', NOW)).toEqual([
      '«lunedì 1° dicembre»: il 1 dicembre 2026 è martedì'
    ])
  })

  it('lets a right one be, however it is written', () => {
    for (const text of [
      'Martedì 10 il sopralluogo, mercoledì 11 novembre la gara.',
      'giovedì 10 e venerdì 11 dicembre in cantiere',
      'lunedi 9 alle 10',
      'mar 10/11 alle 9:30',
      'Domenica 8 novembre 2026',
      'sabato 10, a ottobre, era chiuso',
      'venerdì 13/11/26'
    ]) {
      expect(wrongWeekdays(text, NOW), text).toEqual([])
    }
  })

  it('leaves what is not a day: a time, a count, a date that does not exist', () => {
    for (const text of [
      'mercoledì 10:30 in sala',
      'mercoledì 10.30',
      'venerdì 2 riunioni',
      'sabato 3 ore di lavoro',
      'giovedì 31 novembre',
      'mar 10 euro',
      'Mar 10, 2026'
    ]) {
      expect(wrongWeekdays(text, NOW), text).toEqual([])
    }
  })

  it('reads the year of a day with its month as the nearest one', () => {
    // In November, "lunedì 11 gennaio" is January 2027, a Monday.
    expect(wrongWeekdays('lunedì 11 gennaio', NOW)).toEqual([])
    expect(wrongWeekdays('martedì 11 gennaio', NOW)).toEqual([
      '«martedì 11 gennaio»: il 11 gennaio 2027 è lunedì'
    ])
  })
})

describe('checkWeekdays', () => {
  it('refuses a text with a wrong one, and passes one without', () => {
    expect(() => checkWeekdays(undefined, 'Nessuna data qui.', null)).not.toThrow()
    expect(() => checkWeekdays('Il 4 novembre 2026, mercoledì 4 novembre 2026.')).not.toThrow()
    expect(() => checkWeekdays('ok', 'domenica 4 novembre 2026')).toThrow(ToolInputError)
  })
})
