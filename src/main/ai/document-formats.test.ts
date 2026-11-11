import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { CFB } from 'xlsx'

import {
  decodeText,
  looksLikeText,
  outlookMessageText,
  rtfText,
  signedEnvelopeContent,
  wordDocumentText
} from './document-formats'
import { extractContent } from './extraction'

// PDF pages are drawn in a window of Electron's; no picture format beyond the model's decodes here.
vi.mock('./pdf-pages', () => ({ renderPdfPages: vi.fn() }))
vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

/** A DER element: definite length, or indefinite (BER) when asked. */
function der(tag: number, content: Buffer | Buffer[], indefinite = false): Buffer {
  const body = Array.isArray(content) ? Buffer.concat(content) : content

  if (indefinite) {
    return Buffer.concat([Buffer.from([tag, 0x80]), body, Buffer.from([0, 0])])
  }

  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : Buffer.from([0x82, body.length >> 8, body.length & 0xff])
  return Buffer.concat([Buffer.from([tag]), length, body])
}

/** A CMS SignedData carrying `content`, as a signing program writes it (without the signer, not read). */
function signedEnvelope(content: Buffer, ber = false): Buffer {
  const oid = (bytes: number[]): Buffer => der(0x06, Buffer.from(bytes))
  const signedDataOid = oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02])
  const dataOid = oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01])
  const eContent = ber
    ? der(0x24, [der(0x04, content.subarray(0, 5)), der(0x04, content.subarray(5))], true)
    : der(0x04, content)

  return der(
    0x30,
    [
      signedDataOid,
      der(
        0xa0,
        der(
          0x30,
          [
            der(0x02, Buffer.from([1])),
            der(0x31, Buffer.alloc(0)),
            der(0x30, [dataOid, der(0xa0, eContent, ber)], ber),
            der(0x31, Buffer.alloc(0))
          ],
          ber
        ),
        ber
      )
    ],
    ber
  )
}

/** An OLE compound file with these streams. */
function compound(streams: Record<string, Buffer>): Buffer {
  const container = CFB.utils.cfb_new()

  for (const [name, content] of Object.entries(streams)) {
    CFB.utils.cfb_add(container, `/${name}`, content)
  }

  return Buffer.from(CFB.write(container, { type: 'buffer' }) as Uint8Array)
}

describe('document formats', () => {
  it('decodes text as it was written: UTF-8, UTF-16 with its mark, Windows-1252', () => {
    expect(decodeText(Buffer.from('Città: 12.500 €', 'utf8'))).toBe('Città: 12.500 €')
    expect(decodeText(Buffer.from([0xff, 0xfe, ...Buffer.from('perché', 'utf16le')]))).toBe(
      'perché'
    )
    expect(decodeText(Buffer.from([0x43, 0x69, 0x74, 0x74, 0xe0, 0x3b, 0x80]))).toBe('Città;€')
  })

  it('tells text from a binary file by its first bytes', () => {
    expect(looksLikeText(Buffer.from('0\nSECTION\n2\nENTITIES\n0\nTEXT\n1\nQuota 12.50 m\n'))).toBe(
      true
    )
    expect(looksLikeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))).toBe(false)
  })

  it('reads RTF as a word processor shows it', () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}{\\*\\generator Prova;}\\f0 Preventivo per la cucina\\par Importo: 12.500 \\'80, perch\\'e9 \\u8211\\'3f subito\\\nFine}"
    expect(rtfText(rtf)).toBe('Preventivo per la cucina\nImporto: 12.500 €, perché – subito\nFine')
  })

  it('opens a signed envelope, DER or BER, to the document it carries', () => {
    const invoice = Buffer.from('<FatturaElettronica><Numero>7</Numero></FatturaElettronica>')

    expect(signedEnvelopeContent(signedEnvelope(invoice))?.toString()).toBe(invoice.toString())
    expect(signedEnvelopeContent(signedEnvelope(invoice, true))?.toString()).toBe(
      invoice.toString()
    )
    expect(
      signedEnvelopeContent(Buffer.from(signedEnvelope(invoice).toString('base64')))?.toString()
    ).toBe(invoice.toString())
    expect(signedEnvelopeContent(Buffer.from('not an envelope'))).toBeNull()
  })

  it('reads a Word 97–2003 document from its piece table, fields by their result', async () => {
    const text = 'Verbale\r\u0013 PAGE \u00141\u0015 riunione\u0007'
    const word = Buffer.alloc(0x400)
    word.writeUInt16LE(0xa5ec, 0)
    word.write(text, 0x200, 'latin1')
    // One piece, compressed (8-bit), at 0x200 in the stream: fc is twice the offset, bit 30 set.
    const pcdt = Buffer.alloc(1 + 4 + 8 + 8)
    pcdt.writeUInt8(0x02, 0)
    pcdt.writeUInt32LE(4 + 4 + 8, 1)
    pcdt.writeUInt32LE(0, 5)
    pcdt.writeUInt32LE(text.length, 9)
    pcdt.writeUInt32LE((0x200 * 2) | 0x40000000, 15)
    word.writeUInt32LE(0, 0x1a2)
    word.writeUInt32LE(pcdt.length, 0x1a6)

    expect(await wordDocumentText(compound({ WordDocument: word, '0Table': pcdt }))).toBe(
      'Verbale\n1 riunione'
    )
  })

  it('reads a message saved from Outlook, with its attachments named', async () => {
    const unicode = (text: string): Buffer => Buffer.from(text, 'utf16le')
    const message = compound({
      '__substg1.0_0037001F': unicode('Offerta cucina'),
      '__substg1.0_0C1A001F': unicode('Anna Brenta'),
      '__substg1.0_5D01001F': unicode('anna@brenta.it'),
      '__substg1.0_0E04001F': unicode('Mario Rossi'),
      '__substg1.0_1000001F': unicode('Ecco l’offerta aggiornata.'),
      '__attach_version1.0_#00000000/__substg1.0_3707001F': unicode('offerta-rev2.pdf')
    })

    const text = await outlookMessageText(message, (html) => html)

    expect(text).toContain('Da: Anna Brenta anna@brenta.it')
    expect(text).toContain('Oggetto: Offerta cucina')
    expect(text).toContain('Ecco l’offerta aggiornata.')
    expect(text).toContain('Allegati: offerta-rev2.pdf')
  })
})

describe('extractContent, for every kind of file', () => {
  it('reads the document inside a .p7m as what it is', async () => {
    const read = await extractContent(
      'fattura.xml.p7m',
      undefined,
      signedEnvelope(Buffer.from('<Numero>7</Numero>'))
    )
    expect(read).toMatchObject({ kind: 'text', text: '<Numero>7</Numero>' })
  })

  it('lists an archive without unpacking it', async () => {
    const zip = Buffer.from(
      zipSync({ 'offerta.pdf': new Uint8Array(2048), 'note.txt': new Uint8Array(10) })
    )
    const read = await extractContent('pratica.zip', 'application/zip', zip)
    expect(read).toMatchObject({ kind: 'text' })
    expect(read.kind === 'text' && read.text).toContain('offerta.pdf · 2 KB')
  })

  it('reads any file that is text inside, whatever its name, and says what is not', async () => {
    expect(
      await extractContent('pianta.dxf', undefined, Buffer.from('0\nTEXT\n1\nQuota\n'))
    ).toMatchObject({
      kind: 'text',
      text: '0\nTEXT\n1\nQuota\n'
    })
    expect(
      await extractContent('modello.dwg', undefined, Buffer.from([0x41, 0x43, 0, 1, 2]))
    ).toMatchObject({
      kind: 'unreadable'
    })
  })

  it('never hands the model a picture in a format it does not take', async () => {
    const read = await extractContent(
      'scansione.tif',
      'image/tiff',
      Buffer.from([0x49, 0x49, 0x2a, 0])
    )
    expect(read.kind).toBe('unreadable')
    expect(
      await extractContent('foto.jpg', undefined, Buffer.from([0xff, 0xd8, 0xff]))
    ).toMatchObject({
      kind: 'image',
      mimeType: 'image/jpeg'
    })
  })
})
