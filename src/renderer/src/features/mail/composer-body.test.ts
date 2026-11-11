import { describe, expect, it } from 'vitest'

import {
  buildComposerBody,
  firstWritingLine,
  hasWrittenBounds,
  hasWrittenContent,
  NO_DECORATIONS,
  parseBody,
  passageToComposerHtml,
  plainTextToComposerHtml,
  replaceComposerDecorations,
  replaceWrittenPart,
  writtenText,
  splitSignature,
  type ComposerDecorations
} from './composer-body'

const QUOTE = '<div class="gmail_quote"><blockquote>Messaggio originale</blockquote></div>'
const EMPTY_LINE = '<div><br></div>'

/** A mailbox with a signature only. */
const signed = (signatureHtml: string | null): ComposerDecorations => ({
  headerHtml: null,
  signatureHtml
})

describe('splitSignature', () => {
  it('has nothing to offer for an empty signature', () => {
    expect(splitSignature(null)).toBeNull()
    expect(splitSignature('  ')).toBeNull()
    expect(splitSignature('<div><br></div><p>&nbsp;</p>')).toBeNull()
  })

  it('keeps a signature that is only a picture', () => {
    expect(splitSignature('<div><img src="data:image/png;base64,AA=="></div>')?.core).toContain(
      '<img'
    )
  })

  it('sets the empty lines around the content apart', () => {
    const parts = splitSignature(
      '<div style="color: purple"><br></div><p>Mario Rossi</p><p>&nbsp;</p><p>Tel. 1</p><div><br></div>'
    )

    expect(parts).toEqual({
      leading: '<div style="color: purple"><br></div>',
      core: '<p>Mario Rossi</p><p>&nbsp;</p><p>Tel. 1</p>',
      trailing: '<div><br></div>'
    })
  })

  it('does not count stray whitespace as lines', () => {
    expect(splitSignature('\n  <div>Mario</div>\n')).toEqual({
      leading: '',
      core: '<div>Mario</div>',
      trailing: ''
    })
  })

  it('counts a divider as content', () => {
    expect(splitSignature('<div><hr></div>')?.core).toBe('<div><hr></div>')
  })
})

describe('buildComposerBody', () => {
  it('starts a blank message on one line', () => {
    expect(buildComposerBody(NO_DECORATIONS, undefined)).toBe(EMPTY_LINE)
  })

  it('leaves a blank line between the reply and the quote', () => {
    expect(buildComposerBody(NO_DECORATIONS, QUOTE)).toBe(`${EMPTY_LINE}${EMPTY_LINE}${QUOTE}`)
  })

  it('writes above a signature on lines of its own', () => {
    expect(buildComposerBody(signed('<div>Mario</div>'), undefined)).toBe(
      `${EMPTY_LINE}${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>`
    )
  })

  it('uses the lines a signature brings instead', () => {
    expect(
      buildComposerBody(signed('<div style="color: purple"><br></div><div>Mario</div>'), undefined)
    ).toBe(
      '<div style="color: purple"><br></div><div class="gmail_signature"><div>Mario</div></div>'
    )
  })

  it('puts the quote after the signature, apart from it', () => {
    expect(buildComposerBody(signed('<div>Mario</div>'), QUOTE)).toBe(
      `${EMPTY_LINE}${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('sets what is already written above the signature, a line apart', () => {
    expect(buildComposerBody(signed('<div>Mario</div>'), QUOTE, '<div>Ciao Anna,</div>')).toBe(
      `<div>Ciao Anna,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('keeps what is written a line apart from the quote without a signature', () => {
    expect(buildComposerBody(NO_DECORATIONS, QUOTE, '<div>Va bene.</div>')).toBe(
      `<div>Va bene.</div>${EMPTY_LINE}${QUOTE}`
    )
  })
})

describe('plainTextToComposerHtml', () => {
  it('writes a line per block and an empty line per blank one', () => {
    expect(plainTextToComposerHtml('Ciao Anna,\n\nci vediamo lunedì.\r\nGrazie')).toBe(
      `<div>Ciao Anna,</div>${EMPTY_LINE}<div>ci vediamo lunedì.</div><div>Grazie</div>`
    )
  })

  it('makes a list of dashed lines and keeps bold', () => {
    expect(plainTextToComposerHtml('Servono:\n- il **contratto**\n• la fattura\nA presto')).toBe(
      '<div>Servono:</div><ul><li>il <b>contratto</b></li><li>la fattura</li></ul><div>A presto</div>'
    )
  })

  it('escapes what would read as markup', () => {
    expect(plainTextToComposerHtml('<script>a & b</script>')).toBe(
      '<div>&lt;script&gt;a &amp; b&lt;/script&gt;</div>'
    )
  })

  it('drops the blank lines around the text', () => {
    expect(plainTextToComposerHtml('\n\n  Ok  \n\n')).toBe('<div>Ok</div>')
  })
})

describe('replaceComposerDecorations', () => {
  const body = `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`
  const mario = signed('<div>Mario</div>')

  it('swaps the signature and keeps what was written', () => {
    expect(replaceComposerDecorations(body, signed('<div>Luca</div>'))).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('never touches the signature of the quoted message', () => {
    const quotedSignature =
      '<div class="gmail_quote"><blockquote><div class="gmail_signature">Anna</div></blockquote></div>'
    const html = `<div>Ciao</div>${quotedSignature}`

    expect(replaceComposerDecorations(html, signed('<div>Luca</div>'))).toBe(html)
  })

  it('keeps a signature the user wrote in, and swaps one they left alone', () => {
    const edited = body.replace('<div>Mario</div>', '<div>Mario, a presto</div>')

    expect(replaceComposerDecorations(edited, signed('<div>Luca</div>'), mario)).toBe(edited)
    expect(replaceComposerDecorations(body, signed('<div>Luca</div>'), mario)).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('removes the signature when the new mailbox has none', () => {
    expect(replaceComposerDecorations(body, NO_DECORATIONS)).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}${EMPTY_LINE}${QUOTE}`
    )
  })

  it('respects a signature the user deleted', () => {
    const withoutSignature = `<div>Buongiorno,</div>${EMPTY_LINE}${QUOTE}`

    expect(replaceComposerDecorations(withoutSignature, signed('<div>Luca</div>'), mario)).toBe(
      withoutSignature
    )
  })

  it('lays an untouched body out again for the new signature', () => {
    const purpleLines = '<div style="color: purple"><br></div><div style="color: purple"><br></div>'
    const untouched = buildComposerBody(signed(`${purpleLines}<div>Mario</div>`), QUOTE)

    expect(replaceComposerDecorations(untouched, signed('<div>Luca</div>'))).toBe(
      buildComposerBody(signed('<div>Luca</div>'), QUOTE)
    )
    expect(replaceComposerDecorations(untouched, NO_DECORATIONS)).toBe(
      buildComposerBody(NO_DECORATIONS, QUOTE)
    )
  })

  it('adds the signature above the quote when the previous mailbox had none', () => {
    expect(
      replaceComposerDecorations(
        `<div>Buongiorno,</div>${QUOTE}`,
        signed('<div>Luca</div>'),
        NO_DECORATIONS
      )
    ).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('adds it at the end of a message without a quote', () => {
    expect(
      replaceComposerDecorations(
        `<div>Ciao</div>${EMPTY_LINE}`,
        signed('<div>Luca</div>'),
        NO_DECORATIONS
      )
    ).toBe(`<div>Ciao</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>`)
  })

  it('adds nothing to a draft taken up again, where what was there is not known', () => {
    const draft = `<div>Ciao</div>${EMPTY_LINE}`

    expect(replaceComposerDecorations(draft, signed('<div>Luca</div>'))).toBe(draft)
  })
})

describe('the letterhead', () => {
  const studio: ComposerDecorations = {
    headerHtml: '<p>STUDIO BRENTA</p><div><hr></div><div style="color: purple"><br></div>',
    signatureHtml: '<p style="color: purple">&nbsp;</p><p>Cordiali saluti</p><p>Luca</p>'
  }

  it('heads the message, with the lines to write on below it and the signature after', () => {
    expect(buildComposerBody(studio, QUOTE)).toBe(
      '<div class="mail_letterhead"><p>STUDIO BRENTA</p><div><hr></div></div>' +
        '<p style="color: purple">&nbsp;</p>' +
        '<div class="gmail_signature"><p>Cordiali saluti</p><p>Luca</p></div>' +
        `${EMPTY_LINE}${QUOTE}`
    )
  })

  it('brings its own empty lines when the signature brings none', () => {
    expect(buildComposerBody({ ...studio, signatureHtml: '<p>Luca</p>' }, undefined)).toBe(
      '<div class="mail_letterhead"><p>STUDIO BRENTA</p><div><hr></div></div>' +
        '<div style="color: purple"><br></div>' +
        '<div class="gmail_signature"><p>Luca</p></div>'
    )
  })

  it('puts the caret on the first line after it', () => {
    const root = parseBody(buildComposerBody(studio, QUOTE))

    expect(firstWritingLine(root)?.outerHTML).toBe('<p style="color: purple">&nbsp;</p>')
    expect(firstWritingLine(parseBody(`<div>Ciao</div>${QUOTE}`))?.outerHTML).toBe(
      '<div>Ciao</div>'
    )
  })

  it('is not something written', () => {
    const html = buildComposerBody(studio, QUOTE)

    expect(hasWrittenContent(html)).toBe(false)
    expect(writtenText(html)).toBe('')
  })

  it('goes with its mailbox, and stays when the user wrote in it', () => {
    const html = buildComposerBody(studio, QUOTE, '<div>Buongiorno</div>')
    const other: ComposerDecorations = { headerHtml: '<p>CASA</p>', signatureHtml: null }

    expect(replaceComposerDecorations(html, other, studio)).toBe(
      '<div class="mail_letterhead"><p>CASA</p></div>' +
        '<p style="color: purple">Buongiorno</p><p style="color: purple"><br></p>' +
        `${EMPTY_LINE}${QUOTE}`
    )

    const written = html.replace('STUDIO BRENTA', 'STUDIO BRENTA – sede di Padova')

    expect(replaceComposerDecorations(written, other, studio)).toContain(
      'STUDIO BRENTA – sede di Padova'
    )
  })

  it('writes the Segretario’s lines in the style of the line they take the place of', () => {
    const html = buildComposerBody(studio, undefined)

    expect(
      replaceWrittenPart(html, plainTextToComposerHtml('Gentile Anna,\n\nci vediamo.'))
    ).toContain(
      '<p style="color: purple">Gentile Anna,</p><p style="color: purple"><br></p><p style="color: purple">ci vediamo.</p>'
    )
  })

  it('keeps it when the Segretario writes the lines below it', () => {
    const html = buildComposerBody(studio, QUOTE, '<div>Prima</div>')

    expect(replaceWrittenPart(html, '<div>Seconda</div>')).toBe(
      '<div class="mail_letterhead"><p>STUDIO BRENTA</p><div><hr></div></div>' +
        '<p style="color: purple">Seconda</p><p style="color: purple"><br></p>' +
        '<div class="gmail_signature"><p>Cordiali saluti</p><p>Luca</p></div>' +
        `${EMPTY_LINE}${QUOTE}`
    )
  })
})

describe('hasWrittenContent', () => {
  it('sees nothing written in a body the composer laid out', () => {
    expect(hasWrittenContent(buildComposerBody(signed('<div>Mario</div>'), QUOTE))).toBe(false)
    expect(hasWrittenContent(buildComposerBody(NO_DECORATIONS, undefined))).toBe(false)
  })

  it('sees text above the signature and below the quote', () => {
    expect(
      hasWrittenContent(`<div>Ciao</div>${buildComposerBody(signed('<div>Mario</div>'), QUOTE)}`)
    ).toBe(true)
    expect(hasWrittenContent(`${QUOTE}<div>In fondo</div>`)).toBe(true)
  })

  it('counts a pasted picture as written', () => {
    expect(hasWrittenContent('<div><img src="data:image/png;base64,AA=="></div>')).toBe(true)
  })
})

describe('writtenText', () => {
  it('gives the lines written above the signature and the quote', () => {
    const html = buildComposerBody(
      signed('<div>Mario</div>'),
      QUOTE,
      plainTextToComposerHtml('Ciao Anna,\n\nci vediamo:\n- lunedì\n- alle 10\nGrazie')
    )

    expect(writtenText(html)).toBe('Ciao Anna,\n\nci vediamo:\n- lunedì\n- alle 10\nGrazie')
  })

  it('reads what the editor writes: a line per block, breaks, spaces that do not break', () => {
    expect(
      writtenText('<div>Va&nbsp;bene<br>a domani</div><div><br></div><div><b>Mario</b></div>')
    ).toBe('Va bene\na domani\n\nMario')
  })

  it('is empty when only the signature and the quote are there', () => {
    expect(writtenText(buildComposerBody(signed('<div>Mario</div>'), QUOTE))).toBe('')
  })
})

describe('replaceWrittenPart', () => {
  it('writes in place of the lines above the signature, keeping the signature and the quote', () => {
    const html = buildComposerBody(signed('<div>Mario</div>'), QUOTE, '<div>Prima versione</div>')

    expect(replaceWrittenPart(html, '<div>Seconda</div><div>versione</div>')).toBe(
      `<div>Seconda</div><div>versione</div>${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('writes above the quote when there is no signature', () => {
    const html = buildComposerBody(NO_DECORATIONS, QUOTE, '<div>Va bene.</div>')

    expect(replaceWrittenPart(html, '<div>Perfetto.</div>')).toBe(
      `<div>Perfetto.</div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('is the whole body when there is neither', () => {
    expect(replaceWrittenPart('<div>Ciao</div>', '<div>Buongiorno</div>')).toBe(
      '<div>Buongiorno</div>'
    )
  })
})

describe('drafts of other clients', () => {
  it('finds their quoted message wherever they put it, and leaves it', () => {
    const outlook =
      '<div>Va bene.</div><div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>Da:</b> Anna</div><div>Il testo di Anna</div>'
    const apple =
      '<div>Va bene.</div><div><br><div><blockquote type="cite"><div>Il testo di Anna</div></blockquote></div></div>'

    expect(replaceWrittenPart(outlook, '<div>Perfetto.</div>')).toBe(
      `<div>Perfetto.</div>${EMPTY_LINE}<div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>Da:</b> Anna</div><div>Il testo di Anna</div>`
    )
    expect(writtenText(apple)).toBe('Va bene.')
    expect(hasWrittenBounds(parseBody(apple))).toBe(true)
    expect(hasWrittenBounds(parseBody('<div>Solo testo</div>'))).toBe(false)
  })
})

describe('passageToComposerHtml', () => {
  it('keeps a one-line passage inside its line, and makes blocks of several', () => {
    expect(passageToComposerHtml(' più breve <e> **chiaro** ')).toBe(
      'più breve &lt;e&gt; <b>chiaro</b>'
    )
    expect(passageToComposerHtml('prima\nseconda')).toBe(plainTextToComposerHtml('prima\nseconda'))
  })
})
