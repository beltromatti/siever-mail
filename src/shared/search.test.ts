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
    expect(flatten('cappellaro padova')).toEqual([
      [{ value: 'cappellaro', scope: 'any' }],
      [{ value: 'padova', scope: 'any' }]
    ])
  })

  it('ORs around the OR keyword and keeps the rest ANDed', () => {
    expect(flatten('cappellaro OR padova ikea')).toEqual([
      [
        { value: 'cappellaro', scope: 'any' },
        { value: 'padova', scope: 'any' }
      ],
      [{ value: 'ikea', scope: 'any' }]
    ])
  })

  it('treats a quoted run as one literal term', () => {
    expect(flatten('"posta certificata" ikea')).toEqual([
      [{ value: 'posta certificata', scope: 'any' }],
      [{ value: 'ikea', scope: 'any' }]
    ])
  })

  it('scopes a term to the sender with da: / from: / mittente:', () => {
    for (const prefix of ['da', 'from', 'mittente']) {
      expect(flatten(`${prefix}:marconi`)).toEqual([[{ value: 'marconi', scope: 'from' }]])
    }
  })

  it('scopes recipients and subject', () => {
    expect(flatten('a:beltrami')).toEqual([[{ value: 'beltrami', scope: 'to' }]])
    expect(flatten('oggetto:sopralluogo')).toEqual([[{ value: 'sopralluogo', scope: 'subject' }]])
  })

  it('accepts a quoted phrase after a field prefix', () => {
    expect(flatten('da:"alessandro marconi"')).toEqual([
      [{ value: 'alessandro marconi', scope: 'from' }]
    ])
  })

  it('combines a scoped term with free terms', () => {
    expect(flatten('da:marconi ikea')).toEqual([
      [{ value: 'marconi', scope: 'from' }],
      [{ value: 'ikea', scope: 'any' }]
    ])
    expect(parseSearchQuery('da:marconi ikea').hasScopedTerms).toBe(true)
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
    const parsed = parseSearchQuery('marconi marconi da:marconi')
    expect(parsed.terms).toEqual([
      { value: 'marconi', scope: 'any' },
      { value: 'marconi', scope: 'from' }
    ])
  })
})

describe('highlightTermsForField', () => {
  it('paints unscoped terms everywhere', () => {
    const parsed = parseSearchQuery('ikea')
    expect(highlightTermsForField(parsed, 'sender')).toEqual(['ikea'])
    expect(highlightTermsForField(parsed, 'subject')).toEqual(['ikea'])
    expect(highlightTermsForField(parsed, 'body')).toEqual(['ikea'])
  })

  it('confines a scoped term to its own field', () => {
    const parsed = parseSearchQuery('da:marconi')
    expect(highlightTermsForField(parsed, 'sender')).toEqual(['marconi'])
    expect(highlightTermsForField(parsed, 'subject')).toEqual([])
    expect(highlightTermsForField(parsed, 'body')).toEqual([])
  })
})

describe('findHighlightRanges', () => {
  it('merges overlapping matches into a single range', () => {
    expect(findHighlightRanges('abcabc', ['abca', 'cabc'])).toEqual([{ start: 0, end: 6 }])
  })

  it('is case-insensitive and finds every occurrence', () => {
    expect(findHighlightRanges('IKEA ikea', ['ikea'])).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 }
    ])
  })

  it('returns nothing without terms or matches', () => {
    expect(findHighlightRanges('ciao', [])).toEqual([])
    expect(findHighlightRanges('ciao', ['zzz'])).toEqual([])
  })
})
