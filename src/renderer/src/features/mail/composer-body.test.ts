import { describe, expect, it } from 'vitest'

import {
  buildComposerBody,
  hasWrittenContent,
  replaceComposerSignature,
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
