import { describe, expect, it } from 'vitest'

import { ToolInputError } from '../agent/tool-types'
import { recurrenceArg, recurrenceWords, remindersArg, remindersWords } from './recurrence'

/** Monday 16 November 2026, 9:00 local: the first lesson. */
const MONDAY = new Date(2026, 10, 16, 9).toISOString()

describe('ripeti, as the model writes it', () => {
  it('reads every shape a calendar shares into the rule', () => {
    expect(
      recurrenceArg(
        { ripeti: { ogni: 'settimana', giorni: ['lun', 'giovedì'], fino_al: '2026-12-22' } },
        MONDAY
      )
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'], until: '2026-12-22' })
    expect(
      recurrenceArg({ ripeti: { ogni: 'giorno', ogni_quanti: '2', volte: 10 } }, MONDAY)
    ).toEqual({ frequency: 'daily', interval: 2, count: 10 })
    // The 16th is the third Monday of November; the 30th its last.
    expect(recurrenceArg({ ripeti: { ogni: 'mese', nel_mese: 'posto' } }, MONDAY)).toEqual({
      frequency: 'monthly',
      interval: 1,
      monthlyBy: 'weekday'
    })
    expect(recurrenceArg({ ripeti: { ogni: 'mese', nel_mese: 'ultimo' } }, '2026-11-30')).toEqual({
      frequency: 'monthly',
      interval: 1,
      monthlyBy: 'lastWeekday'
    })
    expect(recurrenceArg({ ripeti: { ogni: 'anno' } }, '2026-11-16')).toEqual({
      frequency: 'yearly',
      interval: 1
    })
  })

  it('says nothing when it is not given, and «mai» stops a series', () => {
    expect(recurrenceArg({}, MONDAY)).toBeUndefined()
    expect(recurrenceArg({ ripeti: null }, MONDAY)).toBeUndefined()
    expect(recurrenceArg({ ripeti: { ogni: 'mai' } }, MONDAY)).toBeNull()
  })

  it.each([
    [{ ripeti: 'ogni lunedì' }, '`ripeti` è un oggetto'],
    [{ ripeti: { frequenza: 'settimana' } }, 'non ha `frequenza`'],
    [{ ripeti: { ogni: 'ora' } }, '`ripeti.ogni` è `giorno`'],
    [{ ripeti: { ogni: 'mai', volte: 2 } }, 'sta da solo'],
    [{ ripeti: { ogni: 'settimana', ogni_quanti: 0 } }, 'da 1 in su'],
    [{ ripeti: { ogni: 'giorno', giorni: ['lun'] } }, 'vale con `"ogni": "settimana"`'],
    [{ ripeti: { ogni: 'settimana', giorni: ['lun', 'xyz'] } }, 'giorni della settimana'],
    // The first time is a time it repeats on.
    [{ ripeti: { ogni: 'settimana', giorni: ['mar', 'gio'] } }, 'comincia di lunedì'],
    [{ ripeti: { ogni: 'settimana', nel_mese: 'data' } }, 'vale con `"ogni": "mese"`'],
    [{ ripeti: { ogni: 'mese', nel_mese: 'ultimo' } }, 'non è l’ultimo lunedì'],
    [{ ripeti: { ogni: 'giorno', fino_al: '2026-12-22', volte: 3 } }, 'uno dei due'],
    [{ ripeti: { ogni: 'giorno', fino_al: '22/12/2026' } }, 'AAAA-MM-GG'],
    [{ ripeti: { ogni: 'giorno', fino_al: '2026-11-01' } }, 'viene prima'],
    [{ ripeti: { ogni: 'giorno', volte: 'tante' } }, 'quante volte in tutto']
  ])('refuses %j, saying how it goes', (args, words) => {
    expect(() => recurrenceArg(args, MONDAY)).toThrow(ToolInputError)
    expect(() => recurrenceArg(args, MONDAY)).toThrow(words)
  })

  it('leaves to the calendar what hangs on a series’ first time, when it is not known here', () => {
    expect(
      recurrenceArg({ ripeti: { ogni: 'settimana', giorni: ['mar'], fino_al: '2026-11-01' } }, null)
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: ['TU'], until: '2026-11-01' })
  })

  it('refuses a fifth weekday of the month, which not every month has', () => {
    // 30 November 2026 is the fifth Monday.
    expect(() =>
      recurrenceArg({ ripeti: { ogni: 'mese', nel_mese: 'posto' } }, '2026-11-30')
    ).toThrow('quinto lunedì')
  })
})

describe('how an event repeats and reminds, in the model’s words', () => {
  it('says the rule from the event’s start', () => {
    expect(
      recurrenceWords(
        { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TH'], until: '2026-12-22' },
        MONDAY
      )
    ).toBe('si ripete ogni lunedì e giovedì, fino al 22/12/2026')
    expect(
      recurrenceWords(
        { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] },
        MONDAY
      )
    ).toBe('si ripete ogni giorno feriale')
    expect(recurrenceWords({ frequency: 'weekly', interval: 2 }, MONDAY)).toBe(
      'si ripete ogni 2 settimane, il lunedì'
    )
    expect(
      recurrenceWords({ frequency: 'monthly', interval: 1, monthlyBy: 'weekday' }, MONDAY)
    ).toBe('si ripete ogni mese, il terzo lunedì')
    expect(
      recurrenceWords({ frequency: 'monthly', interval: 1, monthlyBy: 'lastWeekday' }, '2026-11-29')
    ).toBe('si ripete ogni mese, l’ultima domenica')
    expect(recurrenceWords({ frequency: 'yearly', interval: 1, count: 5 }, '2027-01-01')).toBe(
      'si ripete ogni anno, l’1 gennaio, 5 volte in tutto'
    )
    expect(recurrenceWords('other', MONDAY)).toBe('si ripete, con una regola che qui non si cambia')
  })

  it('reads reminders as minutes before, and says them as a calendar does', () => {
    expect(remindersArg({ promemoria: [1440, '10', 10] })).toEqual([10, 1440])
    expect(remindersArg({ promemoria: [] })).toEqual([])
    expect(remindersArg({})).toBeUndefined()
    expect(() => remindersArg({ promemoria: [-5] })).toThrow('da 0 a 40320')
    expect(remindersWords([10, 1440], false)).toBe('10 minuti prima e 1 giorno prima')
    // An all-day event starts at its midnight: 900 minutes before is the day before at 9.
    expect(remindersWords([900], true)).toBe('il giorno prima alle 9:00 (900)')
    expect(remindersWords([], false)).toBe('nessuno')
  })
})
