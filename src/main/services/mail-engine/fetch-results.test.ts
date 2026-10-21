import type { FetchMessageObject } from 'imapflow'
import { describe, expect, it } from 'vitest'

import { collectFetchResults, formatUidSet } from './fetch-results'

function answer(fields: Partial<FetchMessageObject> & { uid: number }): FetchMessageObject {
  return { seq: fields.uid, ...fields }
}

describe('collectFetchResults', () => {
  it('keeps a flags-only answer about another message out of the results', () => {
    // Gmail, while this session fetched envelopes, saw another session mark
    // message 17492 read and said so on this one too.
    const { requested, unsolicited } = collectFetchResults(
      [
        answer({ uid: 17501, envelope: { subject: 'ciao' }, size: 14800 }),
        answer({ uid: 17492, flags: new Set(['\\Seen']) }),
        answer({ uid: 17502, envelope: { subject: 'ciao 2' }, size: 14803 })
      ],
      new Set([17501, 17502])
    )

    expect([...requested.keys()]).toEqual([17501, 17502])
    expect(unsolicited.map((entry) => entry.uid)).toEqual([17492])
  })

  it('merges one message spread over several answers, the later winning', () => {
    const { requested } = collectFetchResults(
      [
        answer({ uid: 7, flags: new Set<string>() }),
        answer({ uid: 7, envelope: { subject: 'Offerta' }, size: 2048, flags: undefined }),
        answer({ uid: 7, flags: new Set(['\\Seen']) })
      ],
      new Set([7])
    )

    const merged = requested.get(7)
    expect(merged?.envelope?.subject).toBe('Offerta')
    expect(merged?.size).toBe(2048)
    expect([...(merged?.flags ?? [])]).toEqual(['\\Seen'])
  })

  it('leaves a requested message that came back without its envelope incomplete', () => {
    // Only flags arrived for a message that was asked for: the caller sees
    // there is no envelope and does not store it.
    const { requested } = collectFetchResults(
      [answer({ uid: 3, flags: new Set(['\\Seen']) })],
      new Set([3])
    )

    expect(requested.get(3)?.envelope).toBeUndefined()
  })

  it('treats an answer without a UID as unsolicited', () => {
    const { requested, unsolicited } = collectFetchResults(
      [{ seq: 12, flags: new Set(['\\Seen']) } as unknown as FetchMessageObject],
      new Set([12])
    )

    expect(requested.size).toBe(0)
    expect(unsolicited).toHaveLength(1)
  })
})

describe('formatUidSet', () => {
  it('writes consecutive UIDs as ranges, in order, once each', () => {
    expect(formatUidSet([12, 9, 10, 11, 1, 3, 3, 4, 20])).toBe('1,3:4,9:12,20')
  })

  it('writes a single UID as itself and nothing for none', () => {
    expect(formatUidSet([42])).toBe('42')
    expect(formatUidSet([])).toBe('')
  })
})
