import { describe, expect, it } from 'vitest'

import { EMPTY_SUBJECT_LABEL, stripSubjectPrefixes, subjectSortKey } from './subject'

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

  it('sorts by the first letter or digit, past quotes, brackets and symbols', () => {
    expect(subjectSortKey('"Best drum kit" (50% OFF)')).toBe('best drum kit" (50% off)')
    expect(subjectSortKey('(CHECK THIS OUT!) Vol. 3')).toBe('check this out!) vol. 3')
    expect(subjectSortKey('$5 Kit')).toBe('5 kit')
    expect(subjectSortKey('!!!')).toBe('!!!')
  })

  it('files every message without a subject together, first', () => {
    expect(subjectSortKey(EMPTY_SUBJECT_LABEL)).toBe('')
    expect(subjectSortKey('Re:')).toBe('')
    expect(subjectSortKey(`Re: ${EMPTY_SUBJECT_LABEL}`)).toBe('')
  })
})
