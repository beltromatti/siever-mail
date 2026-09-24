import { describe, expect, it } from 'vitest'

import {
  findHighlightRanges,
  highlightTermsForField,
  parseSearchQuery,
  type SearchTerm
} from './search'

function flatten(query: string): SearchTerm[][] {
  return parseSearchQuery(query).groups.map((group) => group.terms)
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
      { value: 'rossi', scope: 'any' },
      { value: 'rossi', scope: 'from' }
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
