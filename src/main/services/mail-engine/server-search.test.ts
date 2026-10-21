import { describe, expect, it } from 'vitest'

import { parseSearchQuery } from '@shared/search'

import { imapSearchGroups, intersectUids } from './server-search'

describe('imapSearchGroups', () => {
  it('asks one SEARCH per AND-group, with the terms as typed', () => {
    expect(imapSearchGroups(parseSearchQuery('Città fattura'))).toEqual([
      { text: 'Città' },
      { text: 'fattura' }
    ])
  })

  it('ORs the terms of a group and scopes them to their fields', () => {
    expect(
      imapSearchGroups(parseSearchQuery('da:Rossi OR a:Bianchi oggetto:"verbale cantiere"'))
    ).toEqual([
      { or: [{ from: 'Rossi' }, { or: [{ to: 'Bianchi' }, { cc: 'Bianchi' }] }] },
      { subject: 'verbale cantiere' }
    ])
  })

  it('asks nothing for an empty search', () => {
    expect(imapSearchGroups(parseSearchQuery('   '))).toEqual([])
  })
})

describe('intersectUids', () => {
  it('keeps the UIDs both groups matched, in the first order', () => {
    expect(intersectUids([9, 7, 5, 3], [3, 4, 9])).toEqual([9, 3])
  })
})
