import { describe, expect, it } from 'vitest'

import {
  MAIL_EMOJI_FONT_FAMILY,
  MAIL_FONT_OPTIONS,
  upgradeMailFontStacksInHtml
} from './mail-fonts'

const stackOf = (label: string): string =>
  MAIL_FONT_OPTIONS.find((option) => option.label === label)?.value ?? ''

describe('upgradeMailFontStacksInHtml', () => {
  it('gives a face the chain it was missing', () => {
    const upgraded = upgradeMailFontStacksInHtml(
      `<p style="font-family: Calibri, sans-serif; line-height: 1.5;">Saluti</p>`
    )

    expect(upgraded).toBe(
      `<p style="font-family: ${stackOf('Calibri')}; line-height: 1.5;">Saluti</p>`
    )
    // The point of the chain: a machine without Calibri lands on its
    // metric-compatible clone rather than on whatever sans comes first.
    expect(upgraded).toContain('Carlito')
  })

  it('upgrades the emoji stack too', () => {
    const upgraded = upgradeMailFontStacksInHtml(
      `<span style="font-family: 'Segoe UI Emoji', sans-serif;">📧</span>`
    )

    expect(upgraded).toContain(MAIL_EMOJI_FONT_FAMILY)
  })

  it('leaves content that is already canonical byte-identical', () => {
    const canonical = `<p style="font-family: ${stackOf('Georgia')};">x</p>`

    expect(upgradeMailFontStacksInHtml(canonical)).toBe(canonical)
  })

  it('is safe to run repeatedly', () => {
    const once = upgradeMailFontStacksInHtml(
      `<p style="font-family: 'Lucida Sans Unicode', Arial, sans-serif;">x</p>`
    )

    expect(upgradeMailFontStacksInHtml(once)).toBe(once)
  })

  it('handles several declarations, spacing and casing', () => {
    const upgraded = upgradeMailFontStacksInHtml(
      `<div style="FONT-FAMILY:'Segoe UI',sans-serif"><b style="font-family:   Calibri, sans-serif  ;">x</b></div>`
    )

    expect(upgraded).toContain(stackOf('Segoe UI'))
    expect(upgraded).toContain('Carlito')
    expect(upgraded).toContain('  ;')
  })

  it('does not touch a family it does not author', () => {
    const foreign = `<p style="font-family: 'Brush Script MT', cursive;">x</p>`

    expect(upgradeMailFontStacksInHtml(foreign)).toBe(foreign)
  })

  it('leaves empty input alone', () => {
    expect(upgradeMailFontStacksInHtml('')).toBe('')
  })
})
