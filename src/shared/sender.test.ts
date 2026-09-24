import { describe, expect, it } from 'vitest'

import { isMeaningfulDisplayName, senderSortKey } from './sender'

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
