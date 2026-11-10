import { describe, expect, it } from 'vitest'

import { comparableText, dayWithWeekday, eventWhen, shortDate } from './format'

describe('comparableText', () => {
  it('reads what was written, however the draft formats it again', () => {
    const written =
      'Gentile Arch. Bianchi,\n\nle confermo:\n1. martedì 3/11 alle 10:00\n* la **nota** del Comando'
    const draft =
      'Gentile Arch\\. Bianchi,\n\nle confermo:\n\n1\\. martedì 3/11 alle 10:00\n- la nota del Comando\n\n--\nMattia Galli\n\n> Il giorno 27/10 ha scritto:'

    expect(comparableText(draft)).toContain(comparableText(written))
    expect(comparableText(draft.replace('10:00', '11:00'))).not.toContain(comparableText(written))
  })
})

describe('shortDate', () => {
  it('reads a day, and an instant on its local day, and leaves what is no date', () => {
    expect(shortDate('2026-10-28')).toBe(shortDate(new Date(2026, 9, 28, 12).toISOString()))
    expect(shortDate('settembre')).toBe('settembre')
  })
})

describe('dayWithWeekday', () => {
  it('gives a day its weekday, and leaves what is no day', () => {
    expect(dayWithWeekday('2026-11-10')).toBe('mar 10/11/2026')
    expect(dayWithWeekday('domani')).toBe('domani')
  })
})

describe('eventWhen', () => {
  it('says the last day of an event of more days, not only its first', () => {
    expect(eventWhen('2026-11-12', '2026-11-13', true)).toBe('gio 12 nov, tutto il giorno')
    expect(eventWhen('2026-11-12', '2026-11-14', true)).toBe(
      'gio 12 nov – ven 13 nov, tutto il giorno'
    )
    expect(eventWhen('2026-11-10T08:00:00', '2026-11-10T09:30:00', false)).toBe(
      'mar 10 nov 08:00–09:30'
    )
    expect(eventWhen('2026-03-09T09:00:00', '2026-03-11T18:00:00', false)).toBe(
      'lun 9 mar 09:00 – mer 11 mar 18:00'
    )
  })
})
