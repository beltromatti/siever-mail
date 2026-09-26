import { describe, expect, it } from 'vitest'

import { isMeaningfulDisplayName, isSameSenderName, senderSortKey } from './sender'

describe('isMeaningfulDisplayName', () => {
  it('rejects an empty name or one that only repeats the address', () => {
    expect(isMeaningfulDisplayName(undefined, 'a@example.com')).toBe(false)
    expect(isMeaningfulDisplayName('   ', 'a@example.com')).toBe(false)
    expect(isMeaningfulDisplayName('A@Example.com ', 'a@example.com')).toBe(false)
  })

  it('accepts a real name', () => {
    expect(isMeaningfulDisplayName('Anna Verdi', 'a@example.com')).toBe(true)
  })
})

describe('senderSortKey', () => {
  it('folds case and accents so names sort the way people read them', () => {
    const labels = ['Zeta', 'élite', 'Alfa', 'bravo']
    const sorted = [...labels].sort((left, right) =>
      senderSortKey(left) < senderSortKey(right) ? -1 : 1
    )

    expect(sorted).toEqual(['Alfa', 'bravo', 'élite', 'Zeta'])
  })

  it('drops the quotes and punctuation some clients wrap names in', () => {
    expect(senderSortKey('"Mario Rossi"')).toBe('mario rossi')
    expect(senderSortKey("'Anna   Verdi'")).toBe('anna verdi')
  })
})

describe('senderSortKey — spellings of one name', () => {
  it('ignores punctuation and spacing', () => {
    expect(senderSortKey('A. Beltrami - SIEVER')).toBe(senderSortKey('A.beltrami-SIEVER'))
  })

  it('reads "Surname, Name" the way it is said', () => {
    expect(senderSortKey('Lucci, Vincenzo')).toBe('vincenzo lucci')
    expect(senderSortKey('Rossi, Bianchi & Partners')).toBe('rossi bianchi partners')
    expect(senderSortKey('Mario Rossi, PhD')).toBe('mario rossi phd')
    expect(senderSortKey('Mario Rossi, Ing.')).toBe('mario rossi ing')
  })

  it('leaves out a qualifier in brackets', () => {
    expect(senderSortKey('Cristian Sangiorgi (ART-ER)')).toBe('cristian sangiorgi')
    expect(senderSortKey('[SIEVER] Ufficio tecnico')).toBe('ufficio tecnico')
    expect(senderSortKey('(Nessun nome)')).toBe('nessun nome')
  })

  it('keeps an address readable when it is all there is', () => {
    expect(senderSortKey('cristian.sangiorgi@art-er.it')).toBe('cristian sangiorgi art er it')
  })
})

describe('isSameSenderName', () => {
  it('matches the same words in any order or dress', () => {
    expect(isSameSenderName('Cristian Sangiorgi', 'Sangiorgi Cristian')).toBe(true)
    expect(isSameSenderName('A. Beltrami - SIEVER', 'A.beltrami-SIEVER')).toBe(true)
    expect(isSameSenderName('Lucci, Vincenzo', 'Vincenzo Lucci')).toBe(true)
  })

  it('matches a title, a company or a department added to the name', () => {
    expect(isSameSenderName('Ing. Cristian Sangiorgi', 'Cristian Sangiorgi')).toBe(true)
    expect(isSameSenderName('Cristian Sangiorgi ART-ER', 'Cristian Sangiorgi')).toBe(true)
  })

  it('matches an initial', () => {
    expect(isSameSenderName('M. Rossi', 'Mario Rossi')).toBe(true)
    expect(isSameSenderName('A. Beltrami', 'Alessandro Beltrami')).toBe(true)
  })

  it('keeps different people apart', () => {
    expect(isSameSenderName('Celeste Moro', 'Saba Asim')).toBe(false)
    expect(isSameSenderName('Mattia Beltrami', 'Alessandro Beltrami')).toBe(false)
    expect(isSameSenderName('M. Rossi', 'Marco Bianchi')).toBe(false)
    expect(isSameSenderName('M. R.', 'Mario Rossi')).toBe(false)
  })

  it('does not stretch a single word to a full name', () => {
    expect(isSameSenderName('Mario', 'Mario Rossi')).toBe(false)
    expect(isSameSenderName('SIEVER', 'Mario Rossi - SIEVER')).toBe(false)
    expect(isSameSenderName('Amazon', 'AMAZON')).toBe(true)
  })

  it('matches a company however it names the desk writing', () => {
    expect(isSameSenderName('HYPE', 'Team HYPE')).toBe(true)
    expect(isSameSenderName('Steam Support', 'Steam Team')).toBe(true)
    expect(isSameSenderName('Steam', 'Assistenza di Steam')).toBe(true)
    expect(isSameSenderName('Calendly', 'The Calendly Team')).toBe(true)
    expect(isSameSenderName('Amazon.it', 'Amazon')).toBe(true)
    expect(isSameSenderName('Marie di Babbel', 'Marie from Babbel')).toBe(true)
  })

  it('files a bare desk under the company that names it', () => {
    expect(isSameSenderName('Amministrazione', 'Amministrazione In-Domus')).toBe(true)
    expect(isSameSenderName('Servizio Clienti', 'Servizio Clienti Enel')).toBe(true)
    expect(isSameSenderName('Info', 'In Domus')).toBe(false)
    expect(isSameSenderName('Ufficio Tecnico', 'Ufficio Acquisti')).toBe(false)
  })

  it('matches a name written run together', () => {
    expect(isSameSenderName('internationalweek', 'International Week')).toBe(true)
    expect(isSameSenderName('DRYMILANO', 'Dry Milano')).toBe(true)
    expect(isSameSenderName('DRYMILANO', 'Dry Milano Solferino')).toBe(false)
  })

  it('tells unrelated names apart', () => {
    expect(isSameSenderName('Twitter', 'X')).toBe(false)
    expect(isSameSenderName('ChatGPT', 'OpenAI')).toBe(false)
    expect(isSameSenderName('Flix', 'FlixBus')).toBe(false)
    expect(isSameSenderName('Celeste Moro via LinkedIn', 'Saba Asim via LinkedIn')).toBe(false)
  })
})
