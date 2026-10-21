import { describe, expect, it } from 'vitest'

import { isOneEditApart, rankContactSuggestions, type ContactCandidate } from './contact-ranking'

const NOW = Date.UTC(2026, 9, 21)
const DAY = 24 * 60 * 60 * 1000

function contact(
  address: string,
  options: Partial<Omit<ContactCandidate, 'key' | 'address'>> = {}
): ContactCandidate {
  return {
    key: address.toLowerCase(),
    address,
    name: null,
    usageCount: 0,
    lastUsedAt: NOW - 400 * DAY,
    lastReceivedAt: null,
    ...options
  }
}

const emails = (suggestions: ReturnType<typeof rankContactSuggestions>): string[] =>
  suggestions.map((suggestion) => suggestion.email)

describe('isOneEditApart', () => {
  it('tells a slip of the keyboard', () => {
    expect(isOneEditApart('siever.it', 'siever.i')).toBe(true)
    expect(isOneEditApart('siever.it', 'sievr.it')).toBe(true)
    expect(isOneEditApart('siever.it', 'seiver.it')).toBe(true)
    expect(isOneEditApart('siever.it', 'siever.lt')).toBe(true)
    expect(isOneEditApart('aa', 'aaa')).toBe(true)
  })

  it('tells apart what differs more, or not at all', () => {
    expect(isOneEditApart('siever.it', 'siever.it')).toBe(false)
    expect(isOneEditApart('siever.it', 'sever.com')).toBe(false)
    expect(isOneEditApart('siever.it', 'evers.it')).toBe(false)
    expect(isOneEditApart('abcd', 'badc')).toBe(false)
  })
})

describe('rankContactSuggestions', () => {
  it('matches the start of the address, the name or any of their words', () => {
    const candidates = [
      contact('f.fuschini@siever.it', { name: 'Franco Fuschini' }),
      contact('mario.rossi@studio.it', { name: 'Mario Rossi' }),
      contact('newsletter@shop.it')
    ]

    expect(emails(rankContactSuggestions('fus', candidates, 10, NOW))).toEqual([
      'f.fuschini@siever.it'
    ])
    expect(emails(rankContactSuggestions('rossi ma', candidates, 10, NOW))).toEqual([
      'mario.rossi@studio.it'
    ])
    expect(emails(rankContactSuggestions('siever', candidates, 10, NOW))).toEqual([
      'f.fuschini@siever.it'
    ])
    // Letters inside a word are not a match.
    expect(emails(rankContactSuggestions('ssi', candidates, 10, NOW))).toEqual([])
  })

  it('folds case and accents', () => {
    const candidates = [contact('n.cosa@x.it', { name: 'Nicolò Cosà' })]

    expect(emails(rankContactSuggestions('NICOLO', candidates, 10, NOW))).toEqual(['n.cosa@x.it'])
    expect(emails(rankContactSuggestions('cosa', candidates, 10, NOW))).toEqual(['n.cosa@x.it'])
  })

  it('puts the people written to before those only heard from', () => {
    const candidates = [
      contact('marketing@mario.it', { lastReceivedAt: NOW - DAY }),
      contact('anna@x.it', { name: 'Anna Mariani', usageCount: 3, lastUsedAt: NOW - 2 * DAY }),
      contact('mario@x.it', { name: 'Mario Verdi', usageCount: 12, lastUsedAt: NOW - 5 * DAY })
    ]

    expect(emails(rankContactSuggestions('mari', candidates, 10, NOW))).toEqual([
      'mario@x.it',
      'anna@x.it',
      'marketing@mario.it'
    ])
  })

  it('leaves out a mistyped copy of an address that writes', () => {
    const candidates = [
      contact('f.fuschini@sievr.it', { name: 'Franco Fuschini', usageCount: 4 }),
      contact('f.fuschini@siever.it', { name: 'Franco Fuschini', lastReceivedAt: NOW - DAY })
    ]

    expect(emails(rankContactSuggestions('franco', candidates, 10, NOW))).toEqual([
      'f.fuschini@siever.it'
    ])
  })

  it('keeps two lookalike addresses when neither has written', () => {
    const candidates = [
      contact('info@abc.it', { usageCount: 2 }),
      contact('info@abd.it', { usageCount: 1 })
    ]

    expect(emails(rankContactSuggestions('info', candidates, 10, NOW))).toEqual([
      'info@abc.it',
      'info@abd.it'
    ])
  })

  it('stops at the limit', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => contact(`a${index}@x.it`))
    expect(rankContactSuggestions('a', candidates, 5, NOW)).toHaveLength(5)
  })
})
