/**
 * The rule that separates "the sender attached this file" from "the body
 * draws this image". Getting it wrong is what made SIEVER's archive folders
 * fill up with image005…image009 next to the one document that mattered.
 */
import MailComposer from 'nodemailer/lib/mail-composer'
import { describe, expect, it } from 'vitest'

import {
  collectReferencedContentIds,
  parseMessageSource,
  partitionMessageAttachments
} from './message-parts'

interface TestAttachment {
  filename: string
  content: Buffer | string
  contentType?: string
  cid?: string
  contentDisposition?: 'attachment' | 'inline'
}

function buildMessage(options: {
  html?: string
  text?: string
  attachments: TestAttachment[]
}): Promise<Buffer> {
  const composer = new MailComposer({
    from: 'a.beltrami@siever.it',
    to: 'cliente@example.it',
    subject: '805 IKEA VILLESSE RIQ ENE [ incontro ]',
    html: options.html,
    text: options.text,
    attachments: options.attachments
  })

  return new Promise((resolvePromise, rejectPromise) => {
    composer.compile().build((error, raw) => {
      if (error) {
        rejectPromise(error)
        return
      }
      resolvePromise(Buffer.from(raw))
    })
  })
}

async function partitionOf(options: {
  html?: string
  text?: string
  attachments: TestAttachment[]
}): Promise<{ official: string[]; embedded: string[] }> {
  const parsed = await parseMessageSource(await buildMessage(options))
  const { official, embedded } = partitionMessageAttachments(parsed)

  return {
    official: official.map((item) => item.attachment.filename ?? ''),
    embedded: embedded.map((item) => item.attachment.filename ?? '')
  }
}

describe('collectReferencedContentIds', () => {
  it('finds cid references in attributes and in inline CSS', () => {
    const ids = collectReferencedContentIds(
      `<img src="cid:logo@siever"><td background=cid:BANNER@x>` +
        `<div style="background:url('cid:quote@y')"></div>`
    )
    expect([...ids].sort()).toEqual(['banner@x', 'logo@siever', 'quote@y'])
  })

  it('normalises angle brackets and percent-encoding', () => {
    expect([...collectReferencedContentIds('<img src="cid:image%20005@01D">')]).toEqual([
      'image 005@01d'
    ])
  })

  it('returns nothing without an HTML body', () => {
    expect(collectReferencedContentIds(undefined).size).toBe(0)
    expect(collectReferencedContentIds(false).size).toBe(0)
  })
})

describe('partitionMessageAttachments', () => {
  it('separates signature and quoted-chain images from the real document', async () => {
    const result = await partitionOf({
      html:
        '<p>Buongiorno,</p><img src="cid:image005@01D">' +
        '<p>Cordiali saluti</p><img src="cid:image006@01D">' +
        '<div>--- replica in calce ---<img src="cid:image007@01D"></div>',
      attachments: [
        { filename: 'image005.png', content: 'a', contentType: 'image/png', cid: 'image005@01D' },
        { filename: 'image006.png', content: 'b', contentType: 'image/png', cid: 'image006@01D' },
        { filename: 'image007.png', content: 'c', contentType: 'image/png', cid: 'image007@01D' },
        { filename: 'Verbale riunione.pdf', content: '%PDF', contentType: 'application/pdf' }
      ]
    })

    expect(result.official).toEqual(['Verbale riunione.pdf'])
    expect(result.embedded).toEqual(['image005.png', 'image006.png', 'image007.png'])
  })

  it('keeps an orphaned related image as body content rather than a file', async () => {
    // Outlook keeps emitting the part after the quoted chain that referenced
    // it was trimmed. It is still body imagery, not something the sender
    // meant to send as a file.
    const result = await partitionOf({
      html: '<p>Testo</p><img src="cid:used@x">',
      attachments: [
        { filename: 'used.png', content: 'a', contentType: 'image/png', cid: 'used@x' },
        { filename: 'orphan.png', content: 'b', contentType: 'image/png', cid: 'orphan@x' }
      ]
    })

    expect(result.official).toEqual([])
    expect(result.embedded.sort()).toEqual(['orphan.png', 'used.png'])
  })

  it('trusts the cid reference over a misleading disposition', async () => {
    // Outlook labels signature logos `attachment` while still drawing them
    // through cid:, so disposition alone would misclassify them.
    const result = await partitionOf({
      html: '<p>x</p><img src="cid:logo@siever">',
      attachments: [
        {
          filename: 'logo.png',
          content: 'a',
          contentType: 'image/png',
          cid: 'logo@siever',
          contentDisposition: 'attachment'
        },
        { filename: 'offerta.pdf', content: '%PDF', contentType: 'application/pdf' }
      ]
    })

    expect(result.official).toEqual(['offerta.pdf'])
    expect(result.embedded).toEqual(['logo.png'])
  })

  it('treats everything as an attachment when there is no HTML body', async () => {
    const result = await partitionOf({
      text: 'Messaggio in solo testo',
      attachments: [
        {
          filename: 'scansione.png',
          content: 'a',
          contentType: 'image/png',
          contentDisposition: 'inline'
        },
        { filename: 'documento.pdf', content: '%PDF', contentType: 'application/pdf' }
      ]
    })

    expect(result.official.sort()).toEqual(['documento.pdf', 'scansione.png'])
    expect(result.embedded).toEqual([])
  })

  it('preserves the original index so download ids keep pointing at the right file', async () => {
    // Attachment downloads re-parse the message and index straight into
    // `parsed.attachments`, so every classified entry has to keep the
    // position it holds there — filtering must never renumber.
    const parsed = await parseMessageSource(
      await buildMessage({
        html: '<img src="cid:a@x"><img src="cid:b@x">',
        attachments: [
          { filename: 'a.png', content: '1', contentType: 'image/png', cid: 'a@x' },
          { filename: 'contratto.pdf', content: '%PDF', contentType: 'application/pdf' },
          { filename: 'b.png', content: '2', contentType: 'image/png', cid: 'b@x' }
        ]
      })
    )
    const { official, embedded } = partitionMessageAttachments(parsed)

    expect(official.map((item) => item.attachment.filename)).toEqual(['contratto.pdf'])
    expect(embedded.map((item) => item.attachment.filename).sort()).toEqual(['a.png', 'b.png'])

    for (const item of [...official, ...embedded]) {
      expect(parsed.attachments[item.index]).toBe(item.attachment)
    }
  })

  it('leaves the cid references in the HTML alone', async () => {
    const parsed = await parseMessageSource(
      await buildMessage({
        html: '<img src="cid:logo@siever">',
        attachments: [
          { filename: 'logo.png', content: 'a', contentType: 'image/png', cid: 'logo@siever' }
        ]
      })
    )

    // Parsed with mailparser's defaults this would already be a data: URI,
    // which is lossy for anything rebuilding the message.
    expect(parsed.html).toContain('cid:logo@siever')
    expect(parsed.html).not.toContain('data:image')
  })
})
