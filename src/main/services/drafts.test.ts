import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { draftFromParsedMail, DRAFT_ID_HEADER } = await import('./drafts')
const { buildRawOutgoingMessage } = await import('./mail-engine/mail-transport')
const { parseMessageSource } = await import('./mail-engine/message-parts')

const DRAFT_ID = '5b0f5c1e-2f1d-4b7a-9a3e-6c2d1f0e9a11'
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('draftFromParsedMail', () => {
  it('reads back a draft as it was filed: recipients with Bcc, thread, files, inline pictures', async () => {
    const raw = await buildRawOutgoingMessage({
      from: { name: 'Anna', address: 'anna@siever.it' },
      to: [{ name: 'Mario Rossi', address: 'mario@cliente.it' }],
      cc: [{ address: 'ufficio@siever.it' }],
      bcc: [{ address: 'archivio@siever.it' }],
      subject: 'Re: Offerta 619',
      html: '<p>Buongiorno,</p><img src="cid:logo@siever">',
      text: 'Buongiorno,',
      inReplyTo: '<originale@cliente.it>',
      references: ['<primo@cliente.it>', '<originale@cliente.it>'],
      attachments: [
        {
          filename: 'Offerta.pdf',
          content: Buffer.from('%PDF-1.4'),
          contentType: 'application/pdf'
        },
        {
          filename: 'logo.png',
          content: PIXEL,
          cid: 'logo@siever',
          contentType: 'image/png',
          contentDisposition: 'inline'
        }
      ],
      messageId: `<draft.${DRAFT_ID}.3@siever.it>`,
      headers: { [DRAFT_ID_HEADER]: DRAFT_ID },
      keepBcc: true
    })

    const { content, files } = draftFromParsedMail(await parseMessageSource(raw), 'account-1')

    expect(content).toMatchObject({
      id: DRAFT_ID,
      kind: 'reply',
      accountId: 'account-1',
      to: [{ name: 'Mario Rossi', address: 'mario@cliente.it' }],
      cc: [{ address: 'ufficio@siever.it' }],
      bcc: [{ address: 'archivio@siever.it' }],
      subject: 'Re: Offerta 619',
      inReplyTo: '<originale@cliente.it>',
      references: ['<primo@cliente.it>', '<originale@cliente.it>']
    })
    expect(content.html).toContain(`src="data:image/png;base64,${PIXEL.toString('base64')}"`)
    expect(content.html).not.toContain('cid:')
    expect(files).toEqual([{ name: 'Offerta.pdf', content: Buffer.from('%PDF-1.4') }])
  })

  it('takes a draft another client wrote as a new one, its text as the body', async () => {
    const raw = await buildRawOutgoingMessage({
      from: { address: 'anna@siever.it' },
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      html: '',
      text: 'Riga uno\nRiga <due>',
      attachments: []
    })

    const { content } = draftFromParsedMail(await parseMessageSource(raw), 'account-1')

    expect(content.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(content.kind).toBe('new')
    expect(content.html).toContain('Riga uno<br>Riga &lt;due&gt;')
  })
})
