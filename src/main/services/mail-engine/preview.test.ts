import { describe, expect, it } from 'vitest'
import type { ParsedMail } from 'mailparser'

import { extractPreview, PREVIEW_MAX_LENGTH } from './preview'

function makeParsed(partial: Partial<ParsedMail>): ParsedMail {
  return partial as ParsedMail
}

describe('extractPreview', () => {
  it('keeps plain-text human emails as-is after whitespace normalization', () => {
    const parsed = makeParsed({
      text: 'Ciao Mattia,\n\ngrazie per la disponibilità. Ci sentiamo domani mattina.'
    })

    expect(extractPreview(parsed, 'Aggiornamento progetto')).toBe(
      'Ciao Mattia, grazie per la disponibilità. Ci sentiamo domani mattina.'
    )
  })

  it('strips raw HTML when the email has no text/plain part', () => {
    const parsed = makeParsed({
      html: `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><meta charset="utf-8"><style>body{background:#fff}</style></head>
<body><p>Transazione registrata correttamente sul conto principale.</p></body></html>`
    })

    const preview = extractPreview(parsed, 'Breasy Transaction Accounted')
    expect(preview).toContain('Transazione registrata correttamente sul conto principale')
    expect(preview).not.toContain('DOCTYPE')
    expect(preview).not.toContain('<')
  })

  it('falls back to the HTML body when the text part is just a tracking URL', () => {
    const parsed = makeParsed({
      text: 'https://n.xceed.me/z/v22zu54c01m204?uid=abc&txnid=def',
      html: '<p>Milano is cooking: Seth Troxler, Marco Carola, Roger Sanchez &amp; more for Design Week.</p>'
    })

    const preview = extractPreview(parsed, '🔥 Milano is cooking')
    expect(preview).toContain('Seth Troxler')
    expect(preview).not.toContain('xceed.me')
    expect(preview).not.toContain('http')
  })

  it('scrubs markdown-ish link syntax, empty anchors and decorative runs', () => {
    const parsed = makeParsed({
      text: '[Bolt](#) ****************** Get up to 40% off burgers ****************** Whether you’re a classic cheeseburger fan or looking for something new, find your favourite for less.'
    })

    const preview = extractPreview(parsed, 'Your favourite burger, for less')
    expect(preview).toContain('Get up to 40% off burgers')
    expect(preview).toContain('Whether')
    expect(preview).not.toContain('*')
    expect(preview).not.toContain('(#)')
    expect(preview).not.toContain('[Bolt]')
  })

  it('collapses runs of dots used as template separators', () => {
    const parsed = makeParsed({
      text: 'You have 6 new messages ............................ Lucas Hg (GenAI Engineer | Software Architect) (https://ca.linkedin.com/in/lucas-hg) View messages: https://www.linkedin.com/comm/messagin'
    })

    const preview = extractPreview(parsed, 'Lucas just messaged you')
    expect(preview).toContain('You have 6 new messages')
    expect(preview).toContain('Lucas Hg')
    expect(preview).not.toContain('..')
    expect(preview).not.toContain('http')
    expect(preview).not.toContain('linkedin.com')
  })

  it('drops reply-quoted blocks so the latest reply wins', () => {
    const parsed = makeParsed({
      text: [
        'Perfetto, ci vediamo martedì.',
        '',
        'On Wed, 23 Apr 2026 at 10:15, Mario Rossi wrote:',
        '> Possiamo vederci martedì?',
        '> Grazie,',
        '> Mario'
      ].join('\n')
    })

    const preview = extractPreview(parsed, 'Re: appuntamento')
    expect(preview).toBe('Perfetto, ci vediamo martedì.')
  })

  it('falls back to the subject when there is no usable content at all', () => {
    const parsed = makeParsed({ text: '', html: '' })

    expect(extractPreview(parsed, 'Notifica di sistema')).toBe('Notifica di sistema')
  })

  it('removes a leading subject echo so the preview adds information', () => {
    const parsed = makeParsed({
      text: 'Weekly digest — qui trovi gli aggiornamenti della tua squadra.'
    })

    const preview = extractPreview(parsed, 'Weekly digest')
    expect(preview).toBe('qui trovi gli aggiornamenti della tua squadra.')
  })

  it('enforces the maximum preview length', () => {
    const padded = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20)
    const parsed = makeParsed({ text: padded })

    const preview = extractPreview(parsed, 'Long email')
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH)
  })

  it('drops bracketed labels that are themselves image / asset URLs', () => {
    const parsed = makeParsed({
      text: '[https://assets.fubles.com/images/emails/fubles_logo.png?v24] [https://assets.fubles.com/images/emails/top_border.png] Match confirmed: Sunday 19:00 at Stadio Olimpico.'
    })

    const preview = extractPreview(parsed, 'Match Confirmed. Get ready to play!')
    expect(preview).toContain('Match confirmed')
    expect(preview).not.toContain('http')
    expect(preview).not.toContain('.png')
    expect(preview).not.toContain('[')
  })

  it('recovers gracefully from preview truncated mid-URL / mid-bracket', () => {
    const parsed = makeParsed({
      text: 'Bolt * Get 40% off burgers this week * Order now before the deal ends [http'
    })

    const preview = extractPreview(parsed, 'Weekly Bolt deal')
    expect(preview).toContain('Get 40% off burgers')
    expect(preview).not.toContain('[http')
    expect(preview).not.toContain('[')
    expect(preview.trim().endsWith(']')).toBe(false)
  })

  it('strips the invisible pre-header characters marketing emails hide', () => {
    const parsed = makeParsed({
      text: '͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏ ͏',
      html: '<p>Review the changes to our Terms of Service before February 1.</p>'
    })

    const preview = extractPreview(parsed, 'Updates to Notion Terms')
    expect(preview).toContain('Review the changes')
    expect(preview).not.toContain('͏')
  })

  it('drops a raw DOCTYPE + unclosed <head> even when truncated', () => {
    const parsed = makeParsed({
      html: '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Preheader</title><meta http-equiv="Content-Type"'
    })

    const preview = extractPreview(parsed, 'Invoice for your trip')
    expect(preview).toBe('Invoice for your trip')
  })

  it('handles repeated ( # ) empty anchors interleaved with asterisk separators', () => {
    const parsed = makeParsed({
      text: 'Bolt ( # ) ******* Treat Yourself Week ( # ) ******* Up to 40% off all week long — order now.'
    })

    const preview = extractPreview(parsed, 'Treat Yourself Week deals are here')
    expect(preview).toContain('Treat Yourself Week')
    expect(preview).toContain('40% off')
    expect(preview).not.toContain('#')
    expect(preview).not.toContain('*')
  })

  it('falls back to subject when URL- and delimiter-only preview has no prose', () => {
    const parsed = makeParsed({
      text: '[ ] [ ] https://ultra-long-tracking-url.example/foo [https://img.example/logo.png]'
    })

    const preview = extractPreview(parsed, 'Pausa in vista? Rendila speciale')
    expect(preview).toBe('Pausa in vista? Rendila speciale')
  })

  it('keeps a meaningful one-word reply as-is', () => {
    const parsed = makeParsed({ text: 'Grazie!' })

    expect(extractPreview(parsed, 'Re: documenti')).toBe('Grazie!')
  })

  it('prefers the HTML body when the text alternative is a boilerplate fallback', () => {
    const parsed = makeParsed({
      text: 'It looks like your email client might not support HTML formatted email. Try opening this email in another email client.',
      html: '<p>Novità: un’eleganza leggera. Scopri gli ultimi look della stagione primaverile.</p>'
    })

    const preview = extractPreview(parsed, 'Novità: un’eleganza leggera')
    expect(preview).toContain('Scopri gli ultimi look')
    expect(preview).not.toContain('email client')
  })

  it('falls back to the subject when the text is boilerplate and HTML has no prose', () => {
    const parsed = makeParsed({
      text: 'Email not displaying correctly? View it online.',
      html: '<img src="cid:logo">'
    })

    expect(extractPreview(parsed, 'New product launch')).toBe('New product launch')
  })

  it('decodes common named entities including zero-width joiners', () => {
    const parsed = makeParsed({
      html: '<p>Sconto del 40&#37; sulla tua prossima spesa — usa il codice SPESA10 &#174;</p>'
    })

    const preview = extractPreview(parsed, 'Offerta speciale')
    expect(preview).toContain('Sconto del 40%')
    expect(preview).toContain('®')
  })

  it('strips CSS rules that leaked into the plain-text alternative', () => {
    const parsed = makeParsed({
      text: '96    body, table, td, div { font-family: Arial !important; }\ntable { border-collapse: collapse !important; }\n\nNearby cities to help you reset and recharge this weekend.'
    })

    const preview = extractPreview(parsed, 'Weekend trip inspiration')
    expect(preview).toContain('Nearby cities to help you reset')
    expect(preview).not.toContain('{')
    expect(preview).not.toContain('font-family')
    expect(preview).not.toContain('!important')
  })

  it('strips `<mailto:…>` and `<tel:…>` pseudo-tags left by html-to-text conversions', () => {
    const parsed = makeParsed({
      text: 'Per qualsiasi richiesta scrivici a <mailto:info@example.com> info@example.com oppure chiama <tel:+39011234567> +39 011 234 567.'
    })

    const preview = extractPreview(parsed, 'Contatti aggiornati')
    expect(preview).toContain('info@example.com')
    expect(preview).not.toContain('<mailto:')
    expect(preview).not.toContain('<tel:')
  })

  it('drops newsletter-style leading markers like `96*` or `#42 -`', () => {
    expect(
      extractPreview(
        makeParsed({ text: '96*\n\n**********\nEnjoy delicious meals at home.' }),
        'Dinner plans sorted'
      )
    ).toBe('Enjoy delicious meals at home.')

    // After the `#42 - ` marker is stripped we are left with the subject echo,
    // which `removeLeadingSubject` drops in turn — the final preview is the
    // part that actually adds information.
    expect(
      extractPreview(
        makeParsed({ text: '#42 - Weekly digest: this is what happened this week.' }),
        'Weekly digest'
      )
    ).toBe('this is what happened this week.')
  })

  it('leaves legitimate leading digits intact', () => {
    const preview = extractPreview(
      makeParsed({ text: '42 hours from now you will receive the confirmation email.' }),
      'Conferma in arrivo'
    )
    expect(preview).toBe('42 hours from now you will receive the confirmation email.')
  })

  it('drops a truncated <style> block that never closes within the byte cap', () => {
    const parsed = makeParsed({
      html: [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<style type="text/css">',
        '@media only screen and (max-width:480px) { body { margin:0 } table { width:100% } }',
        '@media only screen and (max-width:675px) { body { margin:0 } table { width:100% } }',
        '@media only screen and (max-width:675px) { body { margin:0 } table { width:100%'
      ].join('\n')
    })

    const preview = extractPreview(parsed, 'Contatto per il check-in')
    expect(preview).toBe('Contatto per il check-in')
  })

  it('drops a truncated <head> that never closes within the byte cap', () => {
    const parsed = makeParsed({
      html:
        '<!doctype html><html><head><meta charset="utf-8"><style>' +
        '@media only screen and (max-device-width:600px) { body { font-family: Arial !important; } } ' +
        '@media only screen and (max-width:600px) { form texta'
    })

    const preview = extractPreview(parsed, 'Breasy Transaction Accounted')
    expect(preview).toBe('Breasy Transaction Accounted')
  })

  it('scrubs a lone @media prelude that leaked into a plain-text alternative', () => {
    const parsed = makeParsed({
      text: '@media only screen and (max-width:480px) @media only screen and (max-width:675px) Benvenuto a bordo! Il tuo check-in apre 48 ore prima del volo.'
    })

    const preview = extractPreview(parsed, 'Contatto per il check-in')
    expect(preview).toContain('Benvenuto a bordo')
    expect(preview).not.toContain('@media')
    expect(preview).not.toContain('max-width')
  })

  it('recovers gracefully from a truncated HTML entity tail', () => {
    const parsed = makeParsed({
      text: 'Just Eat Voucher Reminder Script 3 &zwnj; &zwnj; &zwnj; &zwnj; &zwnj; &zwn'
    })

    const preview = extractPreview(parsed, 'Il tuo sconto sta per scadere')
    expect(preview).toContain('Just Eat Voucher Reminder Script 3')
    expect(preview).not.toContain('&zwn')
    expect(preview).not.toContain('&zwnj')
  })
})
