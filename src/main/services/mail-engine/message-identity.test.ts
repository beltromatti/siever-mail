import { describe, expect, it } from 'vitest'

import {
  contentDigest,
  distinctMessageKey,
  headerValue,
  identityLookups,
  messageIdsIn,
  messageKeyFor,
  normalizeMessageId,
  settleIdentity,
  settleNewcomers,
  threadKeyFor,
  type IdentityClaim,
  type StoredIdentity
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

describe('contentDigest', () => {
  const ticket = {
    sentAt: '2026-11-03T09:59:58.000Z',
    from: [{ address: 'Helpdesk@Helpdesk.example' }],
    subject: '[Ticket #123] Stampante'
  }

  it('is what every copy of a message says alike', () => {
    expect(contentDigest(ticket)).toMatch(/^[0-9a-f]{16}$/)
    expect(
      contentDigest({
        ...ticket,
        from: [{ name: 'Helpdesk', address: 'helpdesk@helpdesk.example' }],
        subject: '[Ticket #123]  Stampante '
      })
    ).toBe(contentDigest(ticket))
  })

  it('differs for a message written at another time, by another sender, about another thing', () => {
    expect(contentDigest({ ...ticket, sentAt: '2026-11-04T15:29:57.000Z' })).not.toBe(
      contentDigest(ticket)
    )
    expect(contentDigest({ ...ticket, from: [{ address: 'other@x' }] })).not.toBe(
      contentDigest(ticket)
    )
    expect(contentDigest({ ...ticket, subject: '[Ticket #124] Stampante' })).not.toBe(
      contentDigest(ticket)
    )
  })
})

describe('settleIdentity', () => {
  const written = {
    sentAt: '2026-11-03T09:59:58.000Z',
    from: [{ address: 'helpdesk@helpdesk.example' }],
    subject: '[Ticket #123] Stampante'
  }
  const claim = (overrides: Partial<IdentityClaim> = {}): IdentityClaim => ({
    uid: 40,
    messageKey: 'm:ticket-123@helpdesk.example',
    threadId: 'r:ticket-123@helpdesk.example',
    date: '2026-11-03T10:00:00.000Z',
    digest: contentDigest(written),
    ...overrides
  })
  const cache =
    (rows: StoredIdentity[]) =>
    (messageKey: string): StoredIdentity[] =>
      rows.filter((row) => row.messageKey === messageKey)
  const holder: StoredIdentity = {
    messageKey: 'm:ticket-123@helpdesk.example',
    threadId: 'r:root@helpdesk.example',
    digest: contentDigest(written)
  }

  it('keeps the Message-ID key for a message the account does not know', () => {
    expect(settleIdentity(claim(), cache([]))).toEqual({
      messageKey: 'm:ticket-123@helpdesk.example',
      threadId: 'r:ticket-123@helpdesk.example'
    })
  })

  it('files a copy or a move of a stored message under its key and conversation', () => {
    expect(settleIdentity(claim(), cache([holder]))).toEqual({
      messageKey: 'm:ticket-123@helpdesk.example',
      threadId: 'r:root@helpdesk.example'
    })
  })

  it('gives the copy in Sent and the copy received the same key, whatever their size and arrival', () => {
    // The sender's copy in Sent, appended when it was sent; the copy that came
    // back to the inbox in Cc a minute later, with the headers its trip added.
    const sent = claim({ uid: 7, date: '2026-11-03T10:00:00.000Z' })
    const received = claim({ uid: 812, date: '2026-11-03T10:01:12.000Z' })
    const settled = settleNewcomers([received, sent], [])

    expect(settled.get(7)?.messageKey).toBe('m:ticket-123@helpdesk.example')
    expect(settled.get(812)?.messageKey).toBe('m:ticket-123@helpdesk.example')
    // Stored one after the other, in either order.
    expect(settleIdentity(received, cache([{ ...holder, digest: sent.digest }])).messageKey).toBe(
      'm:ticket-123@helpdesk.example'
    )
  })

  it('tells apart a different message reusing a Message-ID, the same way every time', () => {
    const update = claim({
      date: '2026-11-04T15:30:00.000Z',
      digest: contentDigest({ ...written, sentAt: '2026-11-04T15:29:57.000Z' })
    })
    const settled = settleIdentity(update, cache([holder]))

    expect(settled.messageKey).toBe(distinctMessageKey(update))
    expect(settled.messageKey).toMatch(/^m:ticket-123@helpdesk\.example#[0-9a-f]{16}$/)
    expect(settled.threadId).toBe('r:ticket-123@helpdesk.example')

    // Its copy in another folder joins it.
    const copy = { ...update, uid: 9, date: '2026-11-05T08:00:00.000Z' }
    expect(
      settleIdentity(
        copy,
        cache([holder, { ...holder, messageKey: settled.messageKey, digest: update.digest }])
      ).messageKey
    ).toBe(settled.messageKey)
  })

  it('never gives a key told apart to what has no Message-ID', () => {
    expect(distinctMessageKey(claim({ messageKey: 'e:1781' }))).toBeNull()
    expect(
      settleIdentity(
        claim({ messageKey: 'h:abc', threadId: 'k:h:abc' }),
        cache([{ messageKey: 'h:abc', threadId: 'k:h:abc' }])
      ).messageKey
    ).toBe('h:abc')
  })

  it('puts a reply without References in the conversation of the message it answers', () => {
    const reply = claim({
      messageKey: 'm:reply@x',
      threadId: 'r:parent@x',
      parentMessageId: 'parent@x'
    })

    expect(
      settleIdentity(
        reply,
        cache([{ messageKey: 'm:parent@x', threadId: 'r:root@x', digest: 'd' }])
      ).threadId
    ).toBe('r:root@x')
    // The parent unknown: the conversation is named after it, as before.
    expect(settleIdentity(reply, cache([])).threadId).toBe('r:parent@x')
  })
})

describe('settleNewcomers', () => {
  const arrival = (uid: number, overrides: Partial<IdentityClaim>): IdentityClaim => ({
    uid,
    messageKey: `m:${uid}@x`,
    threadId: `r:${uid}@x`,
    date: `2026-11-0${uid}T10:00:00.000Z`,
    digest: contentDigest({
      sentAt: `2026-11-0${uid}T09:00:00.000Z`,
      from: [{ address: 'rossi@x' }],
      subject: 'Offerta'
    }),
    ...overrides
  })

  it('finds a parent that arrives in the same batch, whatever the order fetched', () => {
    const reply = arrival(3, { threadId: 'r:2@x', parentMessageId: '2@x' })
    const parent = arrival(2, { threadId: 'r:1@x' })
    const settled = settleNewcomers([reply, parent], [])

    expect(settled.get(3)?.threadId).toBe('r:1@x')
    expect(identityLookups([reply])).toEqual(['m:3@x', distinctMessageKey(reply), 'm:2@x'])
  })

  it('tells apart two messages of one batch sharing a Message-ID, and joins true copies', () => {
    const first = arrival(1, { messageKey: 'm:same@x' })
    const other = arrival(2, { messageKey: 'm:same@x' })
    const copy = { ...first, uid: 3, date: '2026-11-03T10:00:00.000Z' }
    const settled = settleNewcomers([copy, other, first], [])

    expect(settled.get(1)?.messageKey).toBe('m:same@x')
    expect(settled.get(2)?.messageKey).toBe(distinctMessageKey(other))
    expect(settled.get(3)?.messageKey).toBe('m:same@x')
  })

  it('gives two messages sharing a Message-ID their own keys back when both are stored anew', () => {
    // A holds the Message-ID; B, written before A was received, was told apart.
    // Both moved by another program: their rows are gone, the account
    // remembers who held each key and in which conversation.
    const a = arrival(5, { messageKey: 'm:scan@printer', threadId: 'r:scan@printer' })
    const b = arrival(2, { messageKey: 'm:scan@printer', threadId: 'r:scan@printer' })
    const remembered: StoredIdentity[] = [
      { messageKey: 'm:scan@printer', threadId: 'r:a-thread', digest: a.digest },
      { messageKey: distinctMessageKey(b)!, threadId: 'r:b-thread', digest: b.digest }
    ]

    for (const order of [
      [a, b],
      [b, a]
    ]) {
      const settled = settleNewcomers(
        order.map((claim, index) => ({ ...claim, uid: 100 + index })),
        remembered
      )
      const keyOf = (claim: IdentityClaim): string | undefined =>
        settled.get(100 + order.indexOf(claim))?.messageKey

      expect(keyOf(a)).toBe('m:scan@printer')
      expect(keyOf(b)).toBe(distinctMessageKey(b))
      expect(settled.get(100 + order.indexOf(a))?.threadId).toBe('r:a-thread')
      expect(settled.get(100 + order.indexOf(b))?.threadId).toBe('r:b-thread')
    }

    // B stored anew alone, A not yet back: B does not take A's key.
    expect(settleNewcomers([b], remembered.slice(0, 1)).get(2)?.messageKey).toBe(
      distinctMessageKey(b)
    )
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
