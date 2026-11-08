import { describe, expect, it } from 'vitest'

import { upgradeLegacySignatureHtml } from './signature-html'

describe('upgradeLegacySignatureHtml', () => {
  it('writes the old paragraph reset and line height onto the signature', () => {
    expect(upgradeLegacySignatureHtml('<p class="MsoNormal" style="color: red;">Saluti</p>')).toBe(
      '<p class="MsoNormal" style="margin: 0; color: red; line-height: 1.5">Saluti</p>'
    )
  })

  it('keeps a margin side the author set ahead of the reset', () => {
    expect(upgradeLegacySignatureHtml('<p style="margin-bottom: 10px">A</p>')).toBe(
      '<p style="margin: 0; margin-bottom: 10px; line-height: 1.5">A</p>'
    )
  })

  it('leaves what a block already declares alone', () => {
    const html =
      '<p style="margin: 4px 0; line-height: 1.2">A</p><div style="line-height: 2">B</div>'
    expect(upgradeLegacySignatureHtml(html)).toBe(html)
  })

  it('gives divs the old line height but never a margin, and adds a style when missing', () => {
    expect(upgradeLegacySignatureHtml('<div><br></div><div dir="ltr">x</div>')).toBe(
      '<div style="line-height: 1.5"><br></div><div dir="ltr" style="line-height: 1.5">x</div>'
    )
  })

  it('ignores tags that only start with p or div', () => {
    const html = '<pre>code</pre><param name="x"><picture></picture>'
    expect(upgradeLegacySignatureHtml(html)).toBe(html)
  })
})
