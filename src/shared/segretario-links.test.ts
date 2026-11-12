import { describe, expect, it } from 'vitest'

import { linkedHandles, plainWords, relinked, unlinked } from './segretario-links'

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
        "[L'offerta di Rossi](mail:m4) va confermata, poi [l'IBAN a Chiara](impegno:5) e [Casa al mare](progetto:p1)."
      )
    ).toBe("L'offerta di Rossi va confermata, poi l'IBAN a Chiara (#5) e Casa al mare.")
  })
})

describe('plainWords', () => {
  it('reads words that stay as the user rewrites them: labels, not where they point', () => {
    expect(
      plainWords(
        'Vedi [l’offerta](mail:m4), [l’IBAN](impegno:5) e [il sito](https://brenta.it); ![logo](f1) resta.'
      )
    ).toBe('Vedi l’offerta, l’IBAN e il sito; ![logo](f1) resta.')
  })
})

describe('relinked', () => {
  const before =
    'Oggi conta [il preventivo di Rossi](mail:m4) per [Casa al mare](progetto:p1), poi [l’IBAN](impegno:5).'

  it('keeps each link on the first occurrence of its words, whatever their case', () => {
    expect(
      relinked('Il preventivo di Rossi, poi Casa al mare: e di nuovo Casa al mare.', before)
    ).toBe(
      '[Il preventivo di Rossi](mail:m4), poi [Casa al mare](progetto:p1): e di nuovo Casa al mare.'
    )
  })

  it('lets a link go with its words, and never links inside another word', () => {
    expect(relinked('Solo Casa al marea e l’IBANO.', before)).toBe('Solo Casa al marea e l’IBANO.')
  })

  it('keeps a link on its own words when the same word also stands, unlinked, before it', () => {
    const letter =
      'Oggi era il giorno della consegna al cantiere Rossi. Domani arrivano i filtri (la [consegna](evento:e3)) con [il DDT](impegno:7).'

    expect(
      relinked(
        'La consegna al cantiere Rossi è andata bene. Domani arrivano i filtri (la consegna) con il DDT.',
        letter
      )
    ).toBe(
      'La consegna al cantiere Rossi è andata bene. Domani arrivano i filtri (la [consegna](evento:e3)) con [il DDT](impegno:7).'
    )
  })

  it('finds a rewritten link’s words nearest to where they stood', () => {
    expect(
      relinked(
        'Prima Casa al mare. Oggi conta il preventivo, poi la gita a Casa al mare, poi l’IBAN.',
        before
      )
    ).toBe(
      'Prima Casa al mare. Oggi conta il preventivo, poi la gita a [Casa al mare](progetto:p1), poi [l’IBAN](impegno:5).'
    )
  })

  it('leaves the links the user wrote as they are, and links around them', () => {
    expect(relinked('[Casa al mare](progetto:p1) e Casa al mare.', before)).toBe(
      '[Casa al mare](progetto:p1) e [Casa al mare](progetto:p1).'
    )
  })
})
