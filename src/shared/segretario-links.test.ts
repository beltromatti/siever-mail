import { describe, expect, it } from 'vitest'

import { linkedHandles, unlinked } from './segretario-links'

describe('linkedHandles', () => {
  it('finds each short name a text links to, once, whatever the scheme', () => {
    expect(
      linkedHandles(
        "Vedi [l'offerta](mail:m4), [il PDF](file:f2), [di nuovo](m4), [la risposta](risposta:m9) e [l'IBAN](impegno:12)."
      )
    ).toEqual(['m4', 'f2', 'm9'])
  })
})

describe('unlinked', () => {
  it('reads words that stay without the links of the run that wrote them', () => {
    expect(
      unlinked(
        "[L'offerta di Rossi](mail:m4) va confermata, poi [l'IBAN a Chiara](impegno:5) e [Prat2451](progetto:p1)."
      )
    ).toBe("L'offerta di Rossi va confermata, poi l'IBAN a Chiara (#5) e Prat2451.")
  })
})
