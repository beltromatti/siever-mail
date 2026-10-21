import { describe, expect, it } from 'vitest'

import {
  findHighlightRanges,
  foldSearchText,
  highlightTermsForField,
  parseSearchQuery,
  type SearchTerm
} from './search'

/** The terms by what they match: what they were typed as is checked on its own. */
function flatten(query: string): Array<Array<Omit<SearchTerm, 'text'>>> {
  return parseSearchQuery(query).groups.map((group) =>
    group.terms.map(({ value, scope }) => ({ value, scope }))
  )
}

describe('parseSearchQuery', () => {
  it('returns nothing for an empty query', () => {
    expect(parseSearchQuery('   ')).toEqual({ groups: [], terms: [], hasScopedTerms: false })
  })

  it('ANDs whitespace-separated terms', () => {
    expect(flatten('verdi milano')).toEqual([
      [{ value: 'verdi', scope: 'any' }],
      [{ value: 'milano', scope: 'any' }]
    ])
  })

  it('ORs around the OR keyword and keeps the rest ANDed', () => {
    expect(flatten('verdi OR milano fattura')).toEqual([
      [
        { value: 'verdi', scope: 'any' },
        { value: 'milano', scope: 'any' }
      ],
      [{ value: 'fattura', scope: 'any' }]
    ])
  })

  it('treats a quoted run as one literal term', () => {
    expect(flatten('"posta certificata" fattura')).toEqual([
      [{ value: 'posta certificata', scope: 'any' }],
      [{ value: 'fattura', scope: 'any' }]
    ])
  })

  it('scopes a term to the sender with da: / from: / mittente:', () => {
    for (const prefix of ['da', 'from', 'mittente']) {
      expect(flatten(`${prefix}:rossi`)).toEqual([[{ value: 'rossi', scope: 'from' }]])
    }
  })

  it('scopes recipients and subject', () => {
    expect(flatten('a:bianchi')).toEqual([[{ value: 'bianchi', scope: 'to' }]])
    expect(flatten('oggetto:sopralluogo')).toEqual([[{ value: 'sopralluogo', scope: 'subject' }]])
  })

  it('accepts a quoted phrase after a field prefix', () => {
    expect(flatten('da:"mario rossi"')).toEqual([[{ value: 'mario rossi', scope: 'from' }]])
  })

  it('combines a scoped term with free terms', () => {
    expect(flatten('da:rossi fattura')).toEqual([
      [{ value: 'rossi', scope: 'from' }],
      [{ value: 'fattura', scope: 'any' }]
    ])
    expect(parseSearchQuery('da:rossi fattura').hasScopedTerms).toBe(true)
  })

  it('leaves an unknown prefix as a literal so colons stay searchable', () => {
    expect(flatten('jpec1329:20260827')).toEqual([[{ value: 'jpec1329:20260827', scope: 'any' }]])
  })

  it('drops a prefix with nothing after it instead of matching everything', () => {
    expect(parseSearchQuery('da:').groups).toEqual([])
  })

  it('keeps a dangling OR as a literal term', () => {
    expect(flatten('OR')).toEqual([[{ value: 'or', scope: 'any' }]])
  })

  it('de-duplicates terms while keeping distinct scopes apart', () => {
    const parsed = parseSearchQuery('rossi rossi da:rossi')
    expect(parsed.terms).toEqual([
      { value: 'rossi', text: 'rossi', scope: 'any' },
      { value: 'rossi', text: 'rossi', scope: 'from' }
    ])
  })
})

describe('highlightTermsForField', () => {
  it('paints unscoped terms everywhere', () => {
    const parsed = parseSearchQuery('fattura')
    expect(highlightTermsForField(parsed, 'sender')).toEqual(['fattura'])
    expect(highlightTermsForField(parsed, 'subject')).toEqual(['fattura'])
    expect(highlightTermsForField(parsed, 'body')).toEqual(['fattura'])
  })

  it('confines a scoped term to its own field', () => {
    const parsed = parseSearchQuery('da:rossi')
    expect(highlightTermsForField(parsed, 'sender')).toEqual(['rossi'])
    expect(highlightTermsForField(parsed, 'subject')).toEqual([])
    expect(highlightTermsForField(parsed, 'body')).toEqual([])
  })
})

describe('findHighlightRanges', () => {
  it('merges overlapping matches into a single range', () => {
    expect(findHighlightRanges('abcabc', ['abca', 'cabc'])).toEqual([{ start: 0, end: 6 }])
  })

  it('is case-insensitive and finds every occurrence', () => {
    expect(findHighlightRanges('ROSSI rossi', ['rossi'])).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 }
    ])
  })

  it('returns nothing without terms or matches', () => {
    expect(findHighlightRanges('ciao', [])).toEqual([])
    expect(findHighlightRanges('ciao', ['zzz'])).toEqual([])
  })
})

describe('accent- and case-insensitive search', () => {
  it('folds the terms as the stored text is folded', () => {
    expect(foldSearchText('Città È Perché')).toBe('citta e perche')
    expect(parseSearchQuery('Città da:Nicolò').terms).toEqual([
      { value: 'citta', text: 'Città', scope: 'any' },
      { value: 'nicolo', text: 'Nicolò', scope: 'from' }
    ])
  })

  it('highlights the characters as written for a term typed without accents', () => {
    const text = 'Riunione in città, è confermata'

    expect(findHighlightRanges(text, ['citta', 'e conf'])).toEqual([
      { start: 12, end: 17 },
      { start: 19, end: 25 }
    ])
    expect(text.slice(12, 17)).toBe('città')
  })

  it('maps a match back across characters that fold to more than one', () => {
    const text = 'ﬁle oﬃce'

    expect(findHighlightRanges(text, ['office'])).toEqual([{ start: 4, end: 8 }])
  })
})
