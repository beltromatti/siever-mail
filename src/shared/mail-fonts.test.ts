import { describe, expect, it } from 'vitest'

import {
  MAIL_EDITOR_DEFAULT_FONT_FAMILY,
  MAIL_EMOJI_FONT_FAMILY,
  MAIL_WORDMARK_FONT_FAMILY,
  upgradeMailFontStacksInHtml
} from './mail-fonts'

describe('upgradeMailFontStacksInHtml', () => {
  it('gives the house font the chain it was missing', () => {
    const upgraded = upgradeMailFontStacksInHtml(
      `<p style="font-family: 'Century Gothic', sans-serif; line-height: 1.5;">Cordiali saluti</p>`
    )

    expect(upgraded).toBe(
      `<p style="font-family: ${MAIL_EDITOR_DEFAULT_FONT_FAMILY}; line-height: 1.5;">Cordiali saluti</p>`
    )
    // The point of the chain: a machine without Century Gothic lands on a
    // geometric face rather than on Helvetica.
    expect(upgraded).toContain('Futura')
  })

  it('upgrades the wordmark and emoji stacks the signature uses too', () => {
    const upgraded = upgradeMailFontStacksInHtml(
      `<span style="font-family: 'Lucida Sans Unicode', sans-serif;">SIEVER</span>` +
        `<span style="font-family: 'Segoe UI Emoji', sans-serif;">📧</span>`
    )

    expect(upgraded).toContain(MAIL_WORDMARK_FONT_FAMILY)
    expect(upgraded).toContain(MAIL_EMOJI_FONT_FAMILY)
  })

  it('leaves content that is already canonical byte-identical', () => {
    const canonical = `<p style="font-family: ${MAIL_EDITOR_DEFAULT_FONT_FAMILY};">x</p>`

    expect(upgradeMailFontStacksInHtml(canonical)).toBe(canonical)
  })

  it('is safe to run repeatedly', () => {
    const once = upgradeMailFontStacksInHtml(
      `<p style="font-family: 'Century Gothic', Arial, sans-serif;">x</p>`
    )

    expect(upgradeMailFontStacksInHtml(once)).toBe(once)
  })

  it('handles several declarations, spacing and casing', () => {
    const upgraded = upgradeMailFontStacksInHtml(
      `<div style="FONT-FAMILY:'Century Gothic',sans-serif"><b style="font-family:   Calibri, sans-serif  ;">x</b></div>`
    )

    expect(upgraded).toContain(MAIL_EDITOR_DEFAULT_FONT_FAMILY)
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
