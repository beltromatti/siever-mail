import { describe, expect, it } from 'vitest'

import { steppedReaderZoom, wheelReaderZoom } from './reader-zoom'

describe('reader zoom', () => {
  it('steps through the browser presets and stops at the ends', () => {
    expect(steppedReaderZoom(100, 1)).toBe(110)
    expect(steppedReaderZoom(100, -1)).toBe(90)
    expect(steppedReaderZoom(113, 1)).toBe(125)
    expect(steppedReaderZoom(113, -1)).toBe(110)
    expect(steppedReaderZoom(200, 1)).toBe(200)
    expect(steppedReaderZoom(50, -1)).toBe(50)
  })

  it('treats a mouse notch as a step and a pinch as a smooth scale', () => {
    expect(wheelReaderZoom(100, -100)).toBe(110)
    expect(wheelReaderZoom(100, 100)).toBe(90)
    expect(wheelReaderZoom(100, -10)).toBe(111)
    expect(wheelReaderZoom(100, 4)).toBe(96)
  })

  it('never leaves the allowed range', () => {
    expect(wheelReaderZoom(199, -40)).toBe(200)
    expect(wheelReaderZoom(51, 40)).toBe(50)
  })
})
