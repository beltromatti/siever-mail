import { describe, expect, it } from 'vitest'

import { stripSubjectPrefixes, subjectSortKey } from './subject'

describe('stripSubjectPrefixes', () => {
  it('strips stacked reply and forward prefixes in any client language', () => {
    expect(stripSubjectPrefixes('Re: R: I: Fwd: Preventivo')).toBe('Preventivo')
    expect(stripSubjectPrefixes('AW: WG: Angebot')).toBe('Angebot')
    expect(stripSubjectPrefixes('RE[2]: Offerta')).toBe('Offerta')
  })

  it('strips bracketed gateway tags', () => {
    expect(stripSubjectPrefixes('[External] Re: Consegna')).toBe('Consegna')
  })

  it('leaves words that only start like a prefix alone', () => {
    expect(stripSubjectPrefixes('Rendiconto marzo')).toBe('Rendiconto marzo')
    expect(stripSubjectPrefixes('Invito: riunione')).toBe('Invito: riunione')
  })
})

describe('subjectSortKey', () => {
  it('puts a reply beside the message it answers', () => {
    expect(subjectSortKey('Re: Offerta')).toBe(subjectSortKey('offerta'))
  })

  it('folds case and accents', () => {
    expect(subjectSortKey('Città  Estense')).toBe('citta estense')
  })
})
