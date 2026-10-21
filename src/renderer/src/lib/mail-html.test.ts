import { describe, expect, it } from 'vitest'

import { buildMessageFrameDocument, MAIL_APP_STYLE_ATTRIBUTE } from './mail-html'

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('buildMessageFrameDocument', () => {
  const OUTLOOK_MESSAGE = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style><!--
p.MsoNormal, li.MsoNormal, div.MsoNormal {margin:0cm; font-size:12.0pt;}
--></style></head><body lang="IT" link="#0563C1"><div class="WordSection1"><p class="MsoNormal">Buongiorno</p><p class="MsoNormal">riga due</p></div></body></html>`

  it("keeps the message's own style sheets, comment markers and all", () => {
    const document = parse(buildMessageFrameDocument(OUTLOOK_MESSAGE))
    const authorSheets = [...document.querySelectorAll(`style:not([${MAIL_APP_STYLE_ATTRIBUTE}])`)]

    expect(authorSheets).toHaveLength(1)
    expect(authorSheets[0].textContent).toContain('p.MsoNormal')
  })

  it('puts the app canvas and defaults ahead of the author rules', () => {
    const document = parse(buildMessageFrameDocument(OUTLOOK_MESSAGE))
    const styles = [...document.head.querySelectorAll('style')]

    expect(styles[0].hasAttribute(MAIL_APP_STYLE_ATTRIBUTE)).toBe(true)
    expect(styles[0].textContent).toContain(':where(body)')
  })

  it('keeps the body and its attributes as written', () => {
    const document = parse(buildMessageFrameDocument(OUTLOOK_MESSAGE))

    expect(document.body.getAttribute('link')).toBe('#0563C1')
    expect(document.querySelectorAll('p.MsoNormal')).toHaveLength(2)
  })

  it('takes out what could not run or would navigate the frame', () => {
    const document = parse(
      buildMessageFrameDocument(
        '<html><head><meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com/"><title>x</title></head><body><script>alert(1)</script><iframe src="https://example.com"></iframe><object data="x"></object><p>Testo</p></body></html>'
      )
    )

    expect(document.querySelector('script, iframe, object, base, title')).toBeNull()
    expect(document.querySelector('meta[http-equiv]')).toBeNull()
    expect(document.body.textContent).toBe('Testo')
  })

  it('wraps a bare fragment in a full document', () => {
    const html = buildMessageFrameDocument('<div>Solo un frammento</div>')

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(parse(html).body.textContent).toBe('Solo un frammento')
  })
})
