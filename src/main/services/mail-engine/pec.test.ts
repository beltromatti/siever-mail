import { describe, expect, it } from 'vitest'
import type { FetchMessageObject, MessageStructureObject } from 'imapflow'

import { mergeSummaryAndParsedIntoDetail } from './message-mapper'
import { parseMessageSource } from './message-parts'
import {
  decodePart,
  parseCertification,
  pecOfHeaders,
  pecPartsOf,
  pecSender,
  pecSubject,
  readPec
} from './pec'

/** The certification of an envelope, as Aruba writes it (base64 in its messages; plain here). */
const DATICERT = `<?xml version="1.0" encoding="UTF-8"?>
<postacert tipo="posta-certificata" errore="nessuno">
<intestazione>
<mittente>mario.rossi@pec.example.it</mittente>
<destinatari tipo="certificato">ufficio@pec.studio.it</destinatari>
<destinatari tipo="esterno">anna@studio.it</destinatari>
<risposte>mario.rossi@pec.example.it</risposte>
<oggetto>Trasmissione elaborati</oggetto>
</intestazione>
<dati>
<gestore-emittente>ARUBA PEC S.p.A.</gestore-emittente>
<data zona="+0200"><giorno>06/08/2014</giorno><ora>12:01:04</ora></data>
<identificativo>opec275.20140806120104.16138.09.3.17@pec.aruba.it</identificativo>
<msgid>&lt;client-123@pec.example.it&gt;</msgid>
<ricevuta tipo="completa" />
</dati>
</postacert>`

/** The message carried, as `postacert.eml`: the provider's Message-ID, the client's in X-Riferimento. */
const CARRIED = [
  'Date: Wed,  6 Aug 2014 12:00:12 +0200',
  'Subject: Trasmissione elaborati',
  'MIME-Version: 1.0',
  'From: "Mario Rossi" <mario.rossi@pec.example.it>',
  'To: ufficio@pec.studio.it',
  'Message-ID: <opec275.20140806120104.16138.09.3.17@pec.aruba.it>',
  'X-Riferimento-Message-ID: <client-123@pec.example.it>',
  'Content-Type: multipart/mixed; boundary="INNER"',
  '',
  '--INNER',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Buongiorno, in allegato gli elaborati della pratica.',
  '',
  '--INNER',
  'Content-Type: application/pdf; name="elaborati.pdf"',
  'Content-Disposition: attachment; filename="elaborati.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQKJcOkw7zDtsOfCg==',
  '--INNER--',
  ''
].join('\r\n')

const ENVELOPE_HEADERS = [
  'Subject: POSTA CERTIFICATA: Trasmissione elaborati',
  'X-Riferimento-Message-ID: <client-123@pec.example.it>',
  'Message-ID: <opec275.20140806120104.16138.09.3.17@pec.aruba.it>',
  'Reply-To: mario.rossi@pec.example.it',
  'X-Trasporto: posta-certificata',
  'To: ufficio@pec.studio.it',
  'From: "Per conto di: mario.rossi@pec.example.it" <posta-certificata@pec.aruba.it>',
  'X-Tiporicevuta: completa',
  'MIME-Version: 1.0',
  'Content-Type: multipart/signed; protocol="application/x-pkcs7-signature"; micalg=sha1; boundary="SIGNED"'
].join('\r\n')

const ENVELOPE = [
  ENVELOPE_HEADERS,
  '',
  '--SIGNED',
  'Content-Type: multipart/mixed; boundary="MIXED"',
  '',
  '--MIXED',
  'Content-Type: text/plain; charset="iso-8859-1"',
  'Content-Disposition: inline',
  '',
  '--Questo e un Messaggio di Posta Certificata--',
  '',
  '--MIXED',
  'Content-Type: application/xml; name="daticert.xml"',
  'Content-Disposition: inline; filename="daticert.xml"',
  'Content-Transfer-Encoding: 7bit',
  '',
  DATICERT,
  '',
  '--MIXED',
  'Content-Type: message/rfc822; name="postacert.eml"',
  'Content-Disposition: inline; filename="postacert.eml"',
  'Content-Transfer-Encoding: 7bit',
  '',
  CARRIED,
  '--MIXED--',
  '',
  '--SIGNED',
  'Content-Type: application/x-pkcs7-signature; name="smime.p7s"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="smime.p7s"',
  '',
  'MIAGCSqGSIb3DQEHAqCAMIACAQExCzAJBgUrDgMCGgUAMIAGCSqGSIb3DQEHAQAA',
  '--SIGNED--',
  ''
].join('\r\n')

/** The envelope's structure, as the server describes it. */
const STRUCTURE = {
  type: 'multipart/signed',
  parameters: { boundary: 'SIGNED' },
  childNodes: [
    {
      part: '1',
      type: 'multipart/mixed',
      parameters: { boundary: 'MIXED' },
      childNodes: [
        { part: '1.1', type: 'text/plain', disposition: 'inline' },
        {
          part: '1.2',
          type: 'application/xml',
          encoding: '7bit',
          parameters: { name: 'daticert.xml' },
          disposition: 'inline',
          dispositionParameters: { filename: 'daticert.xml' }
        },
        {
          part: '1.3',
          type: 'message/rfc822',
          parameters: { name: 'postacert.eml' },
          disposition: 'inline',
          dispositionParameters: { filename: 'postacert.eml' }
        }
      ]
    },
    {
      part: '2',
      type: 'application/x-pkcs7-signature',
      disposition: 'attachment',
      dispositionParameters: { filename: 'smime.p7s' }
    }
  ]
} as unknown as MessageStructureObject

/** A delivery receipt's headers, as Legalmail sends one on a message Aruba carried. */
const DELIVERED = [
  'From: Posta Certificata Legalmail <posta-certificata@legalmail.it>',
  'Subject: CONSEGNA: Invio conferma domanda bando startup',
  'X-Riferimento-Message-ID: <1432134489.5583-openerp-private@roberto-ubuntu12>',
  'X-Ricevuta: avvenuta-consegna',
  'Message-ID: <1221306412.1061659807.1432134501798vliaspec02@legalmail.it>'
].join('\r\n')

describe('certified mail (PEC)', () => {
  it('tells the provider’s messages by their headers, and the message each is about', () => {
    expect(pecOfHeaders(ENVELOPE_HEADERS)).toEqual({
      kind: 'busta',
      ref: 'client-123@pec.example.it'
    })
    expect(pecOfHeaders('X-Trasporto: errore\r\nSubject: x')).toEqual({
      kind: 'anomalia',
      ref: null
    })
    expect(pecOfHeaders(DELIVERED)).toEqual({
      kind: 'avvenuta-consegna',
      ref: '1432134489.5583-openerp-private@roberto-ubuntu12'
    })
    expect(pecOfHeaders('X-Ricevuta: errore-consegna')?.kind).toBe('errore-consegna')
    expect(pecOfHeaders('Subject: Ricevuta di accettazione\r\nFrom: a@b.it')).toBeNull()
    expect(pecOfHeaders('X-Ricevuta: mancata-consegna')).toBeNull()
  })

  it('reads the subject and the sender the people wrote, not the provider’s', () => {
    expect(pecSubject('POSTA CERTIFICATA: R: POSTA CERTIFICATA: Offerta')).toBe(
      'R: POSTA CERTIFICATA: Offerta'
    )
    expect(pecSubject('AVVISO DI MANCATA CONSEGNA PER SUP. TEMPO MASSIMO: Pratica 12')).toBe(
      'Pratica 12'
    )
    expect(pecSubject('Consegna materiali')).toBe('Consegna materiali')
    expect(
      pecSender(
        [
          {
            name: 'Per conto di: Mario.Rossi@pec.example.it',
            address: 'posta-certificata@pec.aruba.it'
          }
        ],
        []
      )
    ).toEqual([{ address: 'mario.rossi@pec.example.it' }])
    expect(
      pecSender(
        [{ name: 'Posta certificata', address: 'posta-certificata@pec.aruba.it' }],
        [{ address: 'mario.rossi@pec.example.it' }]
      )
    ).toEqual([{ address: 'mario.rossi@pec.example.it' }])
  })

  it('reads what the provider certifies, entities and zone and all', () => {
    const certification = parseCertification(Buffer.from(DATICERT))

    expect(certification).toEqual({
      kind: 'posta-certificata',
      error: null,
      sender: 'mario.rossi@pec.example.it',
      recipients: [
        { address: 'ufficio@pec.studio.it', certified: true },
        { address: 'anna@studio.it', certified: false }
      ],
      subject: 'Trasmissione elaborati',
      provider: 'ARUBA PEC S.p.A.',
      at: '2014-08-06T10:01:04.000Z',
      id: 'opec275.20140806120104.16138.09.3.17@pec.aruba.it',
      delivery: null,
      errorDetail: null
    })
  })

  it('reads a failed delivery, and a certification written in UTF-16', () => {
    const failed = `<?xml version="1.0" encoding="UTF-16"?>
<postacert tipo="errore-consegna" errore="no-dest">
<intestazione><mittente>sender@fakepec.it</mittente><destinatari tipo="certificato">rec@fakepec.it</destinatari><risposte>sender@fakepec.it</risposte><oggetto>Test</oggetto></intestazione>
<dati><gestore-emittente>FAKE Pec S.p.A.</gestore-emittente><data zona="+0100"><giorno>05/02/2024</giorno><ora>09:30:00</ora></data><identificativo>opec210312.2024@fakepec.it</identificativo><consegna>rec@fakepec.it</consegna><errore-esteso>5.1.1 - FAKE Pec S.p.A. - indirizzo non valido</errore-esteso></dati>
</postacert>`
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(failed, 'utf16le')])

    expect(parseCertification(utf16)).toMatchObject({
      kind: 'errore-consegna',
      error: 'no-dest',
      delivery: 'rec@fakepec.it',
      errorDetail: '5.1.1 - FAKE Pec S.p.A. - indirizzo non valido',
      at: '2024-02-05T08:30:00.000Z'
    })
    expect(parseCertification(Buffer.from('<html>no</html>'))).toBeNull()
  })

  it('finds the message carried and the certification in the envelope’s structure', () => {
    expect(pecPartsOf(STRUCTURE)).toEqual({
      message: '1.3',
      certification: { part: '1.2', encoding: '7bit' }
    })
    expect(
      decodePart(Buffer.from(Buffer.from('<x/>').toString('base64')), 'base64').toString()
    ).toBe('<x/>')
  })

  it('shows an envelope as the message it carries, with what was certified and its own files only', async () => {
    const fetched = {
      uid: 41,
      headers: Buffer.from(ENVELOPE_HEADERS),
      bodyStructure: STRUCTURE,
      envelope: {
        subject: 'POSTA CERTIFICATA: Trasmissione elaborati',
        messageId: '<opec275.20140806120104.16138.09.3.17@pec.aruba.it>',
        from: [
          {
            name: 'Per conto di: mario.rossi@pec.example.it',
            address: 'posta-certificata@pec.aruba.it'
          }
        ],
        replyTo: [{ address: 'mario.rossi@pec.example.it' }],
        to: [{ address: 'ufficio@pec.studio.it' }]
      },
      internalDate: new Date('2014-08-06T10:01:04Z'),
      size: ENVELOPE.length
    } as unknown as FetchMessageObject
    const parts = new Map([
      ['1.2', Buffer.from(DATICERT)],
      ['1.3', Buffer.from(CARRIED)]
    ])
    const pec = await readPec(pecOfHeaders(ENVELOPE_HEADERS)!, STRUCTURE, async (wanted) => {
      expect(wanted.sort()).toEqual(['1.2', '1.3'])
      return parts
    })

    const detail = mergeSummaryAndParsedIntoDetail(
      'acc',
      'INBOX',
      fetched,
      await parseMessageSource(ENVELOPE),
      pec
    )

    expect(detail.subject).toBe('Trasmissione elaborati')
    expect(detail.from).toEqual([{ name: 'Mario Rossi', address: 'mario.rossi@pec.example.it' }])
    expect(detail.text?.trim()).toBe('Buongiorno, in allegato gli elaborati della pratica.')
    expect(detail.attachments.map((attachment) => attachment.fileName)).toEqual(['elaborati.pdf'])
    expect(detail.pec).toEqual({ kind: 'busta', ref: 'client-123@pec.example.it' })
    expect(detail.pecDetail?.certification?.provider).toBe('ARUBA PEC S.p.A.')
    expect(detail.pecDetail?.envelopeText).toContain('Messaggio di Posta Certificata')
  })
})
