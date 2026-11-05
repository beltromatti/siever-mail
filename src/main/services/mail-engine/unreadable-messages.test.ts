import { describe, expect, it } from 'vitest'

import {
  failedAgain,
  fetchSettingApart,
  isGivenUp,
  REFUSED_FETCH_LIMIT,
  UNREADABLE_ATTEMPTS,
  UNREADABLE_RETRY_MS
} from './unreadable-messages'

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)

/**
 * A folder as a server serves it: a FETCH naming any of `broken` is
 * refused whole, as Microsoft 365 and Dovecot refuse one; `down`, it
 * refuses every command; `bare` messages come without their envelope.
 */
function folder(options: { broken?: number[]; down?: boolean; bare?: number[] } = {}): {
  fetches: number[][]
  probes: () => number
  options: Parameters<typeof fetchSettingApart<number>>[1]
} {
  const broken = new Set(options.broken)
  const bare = new Set(options.bare)
  const fetches: number[][] = []
  let probes = 0
  const refusal = Object.assign(new Error('Command failed'), {
    responseStatus: 'BAD',
    responseText: 'Command Argument Error. 11'
  })

  return {
    fetches,
    probes: () => probes,
    options: {
      suspects: new Set<number>(),
      fetch: async (uids: number[]) => {
        fetches.push(uids)

        if (options.down || uids.some((uid) => broken.has(uid))) {
          throw refusal
        }

        return {
          items: uids.filter((uid) => !bare.has(uid)),
          unread: uids.filter((uid) => bare.has(uid))
        }
      },
      refused: (error: unknown) => (error as { responseStatus?: string }).responseStatus === 'BAD',
      serving: async () => {
        probes += 1
        return !options.down
      }
    }
  }
}

describe('fetchSettingApart', () => {
  it('fetches a batch the server gives in one command', async () => {
    const box = folder({ bare: [7] })
    const result = await fetchSettingApart(range(1, 250), box.options)

    expect(result.items).toHaveLength(249)
    expect(result.unread).toEqual([7])
    expect(result.unresolved).toEqual([])
    expect(box.fetches).toHaveLength(1)
    expect(box.probes()).toBe(0)
  })

  it('sets apart the message the server refuses, the others coming meanwhile', async () => {
    const box = folder({ broken: [613] })
    const result = await fetchSettingApart(range(1, 1000), box.options)

    expect(result.items).toHaveLength(999)
    expect(result.unread).toEqual([613])
    expect(result.unresolved).toEqual([])
    expect(box.fetches.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(1000)) + 1)
    expect(box.probes()).toBe(1)
  })

  it('fails a batch the server refuses whole in two commands, taking nothing for unreadable', async () => {
    const box = folder({ down: true })

    await expect(fetchSettingApart(range(1, 1000), box.options)).rejects.toThrow('Command failed')
    expect(box.fetches).toHaveLength(1)
    expect(box.probes()).toBe(1)
  })

  it('stops within its limit, leaving what it did not reach unresolved', async () => {
    const broken = range(1, 1000).filter((uid) => uid % 37 === 0)
    const box = folder({ broken })
    const result = await fetchSettingApart(range(1, 1000), box.options)

    expect(box.fetches).toHaveLength(REFUSED_FETCH_LIMIT)
    expect(result.unresolved.length).toBeGreaterThan(0)
    expect(result.unread.every((uid) => broken.includes(uid))).toBe(true)
    expect(new Set([...result.items, ...result.unread, ...result.unresolved]).size).toBe(1000)
  })

  it('asks for messages that failed before apart, and finds one now readable among them', async () => {
    const box = folder({ broken: [40] })
    const result = await fetchSettingApart(range(1, 100), {
      ...box.options,
      suspects: new Set([40, 41])
    })

    expect(box.fetches[0]).toEqual(range(1, 100).filter((uid) => uid !== 40 && uid !== 41))
    expect(box.fetches[1]).toEqual([40, 41])
    expect(result.items).toContain(41)
    expect(result.unread).toEqual([40])
    // The others came: the server serves the folder, nothing to probe.
    expect(box.probes()).toBe(0)
  })

  it('lets a link that broke fail the batch as it is', async () => {
    const box = folder()
    const lost = new Error('Connection not available')

    await expect(
      fetchSettingApart(range(1, 10), {
        ...box.options,
        fetch: async () => {
          throw lost
        }
      })
    ).rejects.toBe(lost)
  })
})

describe('failedAgain', () => {
  it('gives a message up at the last attempt, to be asked for again later', () => {
    const now = 1_000_000
    let records = failedAgain([], [5, 5, 9], now)

    expect(records).toEqual([
      { uid: 5, failures: 1, retryAt: null },
      { uid: 9, failures: 1, retryAt: null }
    ])

    for (let attempt = 2; attempt <= UNREADABLE_ATTEMPTS; attempt += 1) {
      records = failedAgain(records, [5], now)
    }

    expect(records).toEqual([
      { uid: 5, failures: UNREADABLE_ATTEMPTS, retryAt: now + UNREADABLE_RETRY_MS }
    ])
    expect(isGivenUp(records[0], now)).toBe(true)
    expect(isGivenUp(records[0], now + UNREADABLE_RETRY_MS)).toBe(false)
    expect(isGivenUp({ uid: 9, failures: 1, retryAt: null }, now)).toBe(false)
  })
})
