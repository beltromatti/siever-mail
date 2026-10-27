import { describe, expect, it } from 'vitest'

import {
  buildComposerBody,
  hasWrittenContent,
  plainTextToComposerHtml,
  replaceComposerSignature,
  writtenText,
  splitSignature
} from './composer-body'

const QUOTE = '<div class="gmail_quote"><blockquote>Messaggio originale</blockquote></div>'
const EMPTY_LINE = '<div><br></div>'

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
    expect(buildComposerBody(null, undefined)).toBe(EMPTY_LINE)
  })

  it('leaves a blank line between the reply and the quote', () => {
    expect(buildComposerBody(null, QUOTE)).toBe(`${EMPTY_LINE}${EMPTY_LINE}${QUOTE}`)
  })

  it('writes above a signature on lines of its own', () => {
    expect(buildComposerBody('<div>Mario</div>', undefined)).toBe(
      `${EMPTY_LINE}${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>`
    )
  })

  it('uses the lines a signature brings instead', () => {
    expect(
      buildComposerBody('<div style="color: purple"><br></div><div>Mario</div>', undefined)
    ).toBe(
      '<div style="color: purple"><br></div><div class="gmail_signature"><div>Mario</div></div>'
    )
  })

  it('puts the quote after the signature, apart from it', () => {
    expect(buildComposerBody('<div>Mario</div>', QUOTE)).toBe(
      `${EMPTY_LINE}${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('sets what is already written above the signature, a line apart', () => {
    expect(buildComposerBody('<div>Mario</div>', QUOTE, '<div>Ciao Anna,</div>')).toBe(
      `<div>Ciao Anna,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('keeps what is written a line apart from the quote without a signature', () => {
    expect(buildComposerBody(null, QUOTE, '<div>Va bene.</div>')).toBe(
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

describe('replaceComposerSignature', () => {
  const body = `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Mario</div></div>${EMPTY_LINE}${QUOTE}`

  it('swaps the signature and keeps what was written', () => {
    expect(replaceComposerSignature(body, '<div>Luca</div>', false)).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('never touches the signature of the quoted message', () => {
    const quotedSignature =
      '<div class="gmail_quote"><blockquote><div class="gmail_signature">Anna</div></blockquote></div>'
    const html = `<div>Ciao</div>${quotedSignature}`

    expect(replaceComposerSignature(html, '<div>Luca</div>', false)).toBe(html)
  })

  it('keeps a signature the user wrote in, and swaps one they left alone', () => {
    const edited = body.replace('<div>Mario</div>', '<div>Mario, a presto</div>')

    expect(replaceComposerSignature(edited, '<div>Luca</div>', false, '<div>Mario</div>')).toBe(
      edited
    )
    expect(replaceComposerSignature(body, '<div>Luca</div>', false, '<div>Mario</div>')).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('removes the signature when the new account has none', () => {
    expect(replaceComposerSignature(body, null, false)).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}${EMPTY_LINE}${QUOTE}`
    )
  })

  it('respects a signature the user deleted', () => {
    const withoutSignature = `<div>Buongiorno,</div>${EMPTY_LINE}${QUOTE}`

    expect(replaceComposerSignature(withoutSignature, '<div>Luca</div>', false)).toBe(
      withoutSignature
    )
  })

  it('lays an untouched body out again for the new signature', () => {
    const purpleLines = '<div style="color: purple"><br></div><div style="color: purple"><br></div>'
    const untouched = buildComposerBody(`${purpleLines}<div>Mario</div>`, QUOTE)

    expect(replaceComposerSignature(untouched, '<div>Luca</div>', false)).toBe(
      buildComposerBody('<div>Luca</div>', QUOTE)
    )
    expect(replaceComposerSignature(untouched, null, false)).toBe(buildComposerBody(null, QUOTE))
  })

  it('gives an untouched body a signature when there was none', () => {
    expect(replaceComposerSignature(buildComposerBody(null, QUOTE), '<div>Luca</div>', true)).toBe(
      buildComposerBody('<div>Luca</div>', QUOTE)
    )
  })

  it('adds the signature above the quote when there was none', () => {
    expect(
      replaceComposerSignature(`<div>Buongiorno,</div>${QUOTE}`, '<div>Luca</div>', true)
    ).toBe(
      `<div>Buongiorno,</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>${EMPTY_LINE}${QUOTE}`
    )
  })

  it('adds it at the end of a message without a quote', () => {
    expect(replaceComposerSignature(`<div>Ciao</div>${EMPTY_LINE}`, '<div>Luca</div>', true)).toBe(
      `<div>Ciao</div>${EMPTY_LINE}<div class="gmail_signature"><div>Luca</div></div>`
    )
  })
})

describe('hasWrittenContent', () => {
  it('sees nothing written in a body the composer laid out', () => {
    expect(hasWrittenContent(buildComposerBody('<div>Mario</div>', QUOTE))).toBe(false)
    expect(hasWrittenContent(buildComposerBody(null, undefined))).toBe(false)
  })

  it('sees text above the signature and below the quote', () => {
    expect(
      hasWrittenContent(`<div>Ciao</div>${buildComposerBody('<div>Mario</div>', QUOTE)}`)
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
      '<div>Mario</div>',
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
    expect(writtenText(buildComposerBody('<div>Mario</div>', QUOTE))).toBe('')
  })
})
