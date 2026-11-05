import { describe, expect, it } from 'vitest'

import { comparableText, shortDate } from './format'

describe('comparableText', () => {
  it('reads what was written, however the draft formats it again', () => {
    const written =
      'Gentile Arch. Bianchi,\n\nle confermo:\n1. martedì 3/11 alle 10:00\n* la **nota** del Comando'
    const draft =
      'Gentile Arch\\. Bianchi,\n\nle confermo:\n\n1\\. martedì 3/11 alle 10:00\n- la nota del Comando\n\n--\nMattia Beltrami\n\n> Il giorno 27/10 ha scritto:'

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
