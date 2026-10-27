import { describe, expect, it } from 'vitest'

import {
  headerValue,
  messageIdsIn,
  messageKeyFor,
  normalizeMessageId,
  threadKeyFor
} from './message-identity'

const base = {
  from: [{ name: 'Luca Rossi', address: 'L.Rossi@idrotecnica.it' }],
  date: '2026-10-26T09:15:00.000Z',
  subject: 'Offerta pompe',
  size: 4200
}

describe('messageKeyFor', () => {
  it('prefers the server id, then the Message-ID, then a digest', () => {
    expect(messageKeyFor({ ...base, emailId: '1781234567890', messageId: '<a@x>' })).toBe(
      'e:1781234567890'
    )
    expect(messageKeyFor({ ...base, messageId: ' <ABC@Mail.Example> ' })).toBe('m:abc@mail.example')
    expect(messageKeyFor(base)).toMatch(/^h:[0-9a-f]{24}$/)
  })

  it('gives the same digest to the same message, another to a different one', () => {
    expect(messageKeyFor(base)).toBe(messageKeyFor({ ...base }))
    expect(messageKeyFor(base)).not.toBe(messageKeyFor({ ...base, size: 4201 }))
  })
})

describe('threadKeyFor', () => {
  it('uses the server thread when there is one', () => {
    expect(threadKeyFor({ serverThreadId: '99', references: ['x@y'], messageKey: 'm:a' })).toBe(
      't:99'
    )
  })

  it('roots a reply at the first message the thread references', () => {
    expect(
      threadKeyFor({
        references: ['root@x', 'second@x'],
        inReplyTo: '<second@x>',
        messageId: '<third@x>',
        messageKey: 'm:third@x'
      })
    ).toBe('r:root@x')
  })

  it('falls to the message replied to, then to the message itself', () => {
    expect(threadKeyFor({ references: [], inReplyTo: '<p@x>', messageKey: 'm:c@x' })).toBe('r:p@x')
    expect(threadKeyFor({ references: [], messageId: '<Start@X>', messageKey: 'm:start@x' })).toBe(
      'r:start@x'
    )
    expect(threadKeyFor({ references: [], messageKey: 'h:abc' })).toBe('k:h:abc')
  })
})

describe('header helpers', () => {
  it('reads every id a header names, normalised', () => {
    expect(messageIdsIn('<A@x>\r\n <b@y> junk <c@z>')).toEqual(['a@x', 'b@y', 'c@z'])
    expect(normalizeMessageId('  ')).toBeNull()
  })

  it('unfolds a header continued on the next lines', () => {
    const headers = Buffer.from('References: <a@x>\r\n <b@y>\r\nIn-Reply-To: <b@y>\r\n\r\n')
    expect(headerValue(headers, 'references')).toBe('<a@x> <b@y>')
    expect(headerValue(headers, 'In-Reply-To')).toBe('<b@y>')
    expect(headerValue(headers, 'subject')).toBeUndefined()
  })
})
