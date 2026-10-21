import type { MessageStructureObject } from 'imapflow'
import { describe, expect, it } from 'vitest'

import {
  buildPartSource,
  buildPartialSource,
  decodedPartSize,
  partHeaderKey,
  planPartialBody
} from './message-skeleton'
import { parseMessageSource } from './message-parts'

// An Outlook-shaped message: text and HTML, a logo the HTML draws, a PDF and
// a forwarded message attached.
const TOP_HEADER =
  'From: Anna <anna@example.com>\r\nTo: bob@example.com\r\nSubject: Disegni\r\n' +
  'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="mix"\r\n'

const PARTS: Record<string, { header: string; content: string }> = {
  '1.1.1': {
    header: 'Content-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: 7bit\r\n',
    content: 'Ciao, ecco i disegni.'
  },
  '1.1.2': {
    header: 'Content-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: 7bit\r\n',
    content: '<p>Ciao, ecco i disegni.</p><img src="cid:logo@x">'
  },
  '1.2': {
    header:
      'Content-Type: image/png; name="logo.png"\r\nContent-ID: <logo@x>\r\n' +
      'Content-Disposition: attachment; filename="logo.png"\r\nContent-Transfer-Encoding: base64\r\n',
    content: Buffer.from('PNGDATA').toString('base64')
  },
  '2': {
    header:
      'Content-Type: application/pdf; name="tavola.pdf"\r\n' +
      'Content-Disposition: attachment; filename="tavola.pdf"\r\nContent-Transfer-Encoding: base64\r\n',
    content: Buffer.from('%PDF-1.7 tavola').toString('base64')
  },
  '3': {
    header:
      'Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename="inoltro.eml"\r\n',
    content: 'From: c@example.com\r\nSubject: Vecchio\r\n\r\nTesto vecchio'
  }
}

const CONTAINER_HEADERS: Record<string, string> = {
  '1': 'Content-Type: multipart/related; boundary="rel"\r\n',
  '1.1': 'Content-Type: multipart/alternative; boundary="alt"\r\n'
}

function part(id: string): string {
  return `${PARTS[id].header}\r\n${PARTS[id].content}`
}

const FULL_SOURCE = [
  `${TOP_HEADER}\r\n`,
  `--mix\r\n${CONTAINER_HEADERS['1']}\r\n`,
  `--rel\r\n${CONTAINER_HEADERS['1.1']}\r\n`,
  `--alt\r\n${part('1.1.1')}\r\n`,
  `--alt\r\n${part('1.1.2')}\r\n`,
  '--alt--\r\n\r\n',
  `--rel\r\n${part('1.2')}\r\n`,
  '--rel--\r\n\r\n',
  `--mix\r\n${part('2')}\r\n`,
  `--mix\r\n${part('3')}\r\n`,
  '--mix--\r\n'
].join('')

const STRUCTURE: MessageStructureObject = {
  type: 'multipart/mixed',
  parameters: { boundary: 'mix' },
  childNodes: [
    {
      part: '1',
      type: 'multipart/related',
      parameters: { boundary: 'rel' },
      childNodes: [
        {
          part: '1.1',
          type: 'multipart/alternative',
          parameters: { boundary: 'alt' },
          childNodes: [
            { part: '1.1.1', type: 'text/plain', size: 21 },
            { part: '1.1.2', type: 'text/html', size: 50 }
          ]
        },
        {
          part: '1.2',
          type: 'image/png',
          id: '<logo@x>',
          disposition: 'attachment',
          encoding: 'base64',
          size: 12
        }
      ]
    },
    {
      part: '2',
      type: 'application/pdf',
      disposition: 'attachment',
      encoding: 'base64',
      size: 7800
    },
    { part: '3', type: 'message/rfc822', disposition: 'attachment', size: 60 }
  ]
}

/** What the server answers for the parts a plan asks for. */
function serverParts(ids: ReadonlyArray<string>): Map<string, Buffer> {
  const answers = new Map<string, Buffer>()

  for (const id of ids) {
    if (id.endsWith('.mime')) {
      const partId = id.slice(0, -'.mime'.length)
      answers.set(id, Buffer.from(`${CONTAINER_HEADERS[partId] ?? PARTS[partId].header}\r\n`))
    } else {
      answers.set(id, Buffer.from(PARTS[id].content))
    }
  }

  return answers
}

describe('planPartialBody', () => {
  it('downloads the text and the pictures the HTML draws, and leaves the files', () => {
    const plan = planPartialBody(STRUCTURE)

    expect(plan?.headerParts).toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.2', '2', '3'])
    expect(plan?.contentParts).toEqual(['1.1.1', '1.1.2', '1.2'])
    expect([...(plan?.omittedParts.keys() ?? [])]).toEqual(['2', '3'])
  })

  it('reads an embedded message not marked as an attachment, which may be body', () => {
    const plan = planPartialBody({
      type: 'multipart/mixed',
      parameters: { boundary: 'b' },
      childNodes: [
        { part: '1', type: 'text/plain' },
        { part: '2', type: 'message/rfc822', disposition: 'inline' }
      ]
    })

    expect(plan?.contentParts).toEqual(['1', '2'])
  })

  it('leaves a text file attached as a file', () => {
    const plan = planPartialBody({
      type: 'multipart/mixed',
      parameters: { boundary: 'b' },
      childNodes: [
        { part: '1', type: 'text/plain' },
        { part: '2', type: 'text/plain', disposition: 'attachment' }
      ]
    })

    expect(plan?.contentParts).toEqual(['1'])
  })

  it('has no plan for a message of a single part, or a container without a boundary', () => {
    expect(planPartialBody({ type: 'application/pdf', part: '1' })).toBeNull()
    expect(
      planPartialBody({
        type: 'multipart/mixed',
        parameters: {},
        childNodes: [{ part: '1', type: 'text/plain' }]
      })
    ).toBeNull()
  })
})

describe('buildPartialSource', () => {
  it('reads as the whole message, with the files in the same places and empty', async () => {
    const plan = planPartialBody(STRUCTURE)!
    const partial = buildPartialSource(
      Buffer.from(TOP_HEADER),
      STRUCTURE,
      serverParts([...plan.headerParts.map(partHeaderKey), ...plan.contentParts])
    )

    const [whole, rebuilt] = await Promise.all([
      parseMessageSource(FULL_SOURCE),
      parseMessageSource(partial)
    ])

    expect(rebuilt.subject).toBe(whole.subject)
    expect(rebuilt.html).toBe(whole.html)
    expect(rebuilt.text).toBe(whole.text)
    expect(rebuilt.attachments.map((file) => [file.filename, file.partId, file.cid])).toEqual(
      whole.attachments.map((file) => [file.filename, file.partId, file.cid])
    )
    expect(rebuilt.attachments.map((file) => file.partId)).toEqual(['1.2', '2', '3'])
    expect(rebuilt.attachments[0].content.toString()).toBe('PNGDATA')
    expect(rebuilt.attachments[1].size).toBe(0)
  })
})

describe('buildPartSource', () => {
  it('yields one attachment exactly as the whole message holds it', async () => {
    const [whole, alone] = await Promise.all([
      parseMessageSource(FULL_SOURCE),
      parseMessageSource(
        buildPartSource(Buffer.from(`${PARTS['2'].header}\r\n`), Buffer.from(PARTS['2'].content))
      )
    ])

    expect(alone.attachments).toHaveLength(1)
    expect(alone.attachments[0].filename).toBe('tavola.pdf')
    expect(alone.attachments[0].content.equals(whole.attachments[1].content)).toBe(true)
  })

  it('keeps an attached message as the file it is', async () => {
    const alone = await parseMessageSource(
      buildPartSource(Buffer.from(PARTS['3'].header), Buffer.from(PARTS['3'].content))
    )

    expect(alone.attachments).toHaveLength(1)
    expect(alone.attachments[0].contentType).toBe('message/rfc822')
    expect(alone.attachments[0].content.toString()).toBe(PARTS['3'].content)
  })
})

describe('decodedPartSize', () => {
  it('turns base64 lines back into bytes', () => {
    expect(decodedPartSize({ type: 'application/pdf', encoding: 'base64', size: 7800 })).toBe(5700)
    expect(decodedPartSize({ type: 'text/plain', encoding: '7bit', size: 120 })).toBe(120)
  })
})
