import { describe, expect, it } from 'vitest'

import { comparableText } from './format'

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
