import { describe, expect, it } from 'vitest'

import { formatAppVersion } from './utils'

describe('formatAppVersion', () => {
  it('keeps a three-part version visible in the UI', () => {
    expect(formatAppVersion('0.0.0')).toBe('0.0.0')
    expect(formatAppVersion('1.7.1')).toBe('1.7.1')
    expect(formatAppVersion('v1.7.1')).toBe('1.7.1')
    expect(formatAppVersion('1.7')).toBe('1.7.0')
  })
})
