import { describe, expect, it } from 'vitest'

import { localDayStart } from './mail-search'

describe('localDayStart', () => {
  it('is the local midnight of a day, as the stored dates are written', () => {
    expect(localDayStart('2026-10-28')).toBe(new Date(2026, 9, 28).toISOString())
    expect(localDayStart('2026-10-31', 1)).toBe(new Date(2026, 10, 1).toISOString())
    expect(localDayStart('2026-12-31', 1)).toBe(new Date(2027, 0, 1).toISOString())
  })
})
