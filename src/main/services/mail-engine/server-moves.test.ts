import { describe, expect, it } from 'vitest'

import { expungeOnly, moveOnServer, type RemovingClient } from './server-moves'

/**
 * A mailbox as a server without MOVE keeps it: messages by UID, each with
 * its \Deleted flag, an EXPUNGE that takes every flagged one — or, with
 * UIDPLUS, only those named.
 */
function mailbox(options: { capabilities: string[]; deleted?: number[]; uids?: number[] }): {
  client: RemovingClient
  messages: Map<number, boolean>
  copies: string[]
  commands: string[]
} {
  const messages = new Map<number, boolean>(
    (options.uids ?? [1, 2, 3, 4]).map((uid) => [uid, options.deleted?.includes(uid) ?? false])
  )
  const copies: string[] = []
  const commands: string[] = []
  const uidsOf = (range: string): number[] =>
    range.split(',').flatMap((part) => {
      const [start, end] = part.split(':').map(Number)
      return Array.from({ length: (end ?? start) - start + 1 }, (_, index) => start + index)
    })
  const capabilities = new Map(options.capabilities.map((name) => [name, true as const]))

  const client = {
    capabilities,
    messageFlagsAdd: async (range: string, flags: string[]) => {
      commands.push(`STORE ${range} +${flags.join(' ')}`)
      uidsOf(range).forEach((uid) => messages.has(uid) && messages.set(uid, true))
      return true
    },
    noop: async () => {
      commands.push('NOOP')
    },
    search: async (query: { deleted?: boolean }) => {
      commands.push('SEARCH DELETED')
      return [...messages].filter(([, deleted]) => deleted === query.deleted).map(([uid]) => uid)
    },
    messageDelete: async (range: string) => {
      const named = uidsOf(range)
      named.forEach((uid) => messages.has(uid) && messages.set(uid, true))

      if (capabilities.has('UIDPLUS')) {
        commands.push(`UID EXPUNGE ${range}`)
        named.forEach((uid) => messages.delete(uid))
      } else {
        commands.push('EXPUNGE')
        ;[...messages].filter(([, deleted]) => deleted).forEach(([uid]) => messages.delete(uid))
      }

      return true
    },
    messageCopy: async (range: string, destination: string) => {
      commands.push(`COPY ${range} ${destination}`)
      copies.push(...uidsOf(range).map((uid) => `${destination}:${uid}`))
      return { path: 'INBOX', destination, uidMap: new Map<number, number>() }
    },
    messageMove: async (range: string, destination: string) => {
      commands.push(`MOVE ${range} ${destination}`)
      uidsOf(range).forEach((uid) => messages.delete(uid))
      return { path: 'INBOX', destination, uidMap: new Map<number, number>() }
    }
  } as unknown as RemovingClient

  return { client, messages, copies, commands }
}

describe('expungeOnly', () => {
  it('names the messages with UIDPLUS, leaving what others marked deleted alone', async () => {
    const box = mailbox({ capabilities: ['UIDPLUS'], deleted: [4] })

    await expect(expungeOnly(box.client, [1, 2])).resolves.toBe(true)
    expect([...box.messages.keys()]).toEqual([3, 4])
    expect(box.commands).toEqual(['UID EXPUNGE 1:2'])
  })

  it('expunges without UIDPLUS when nothing else is marked deleted', async () => {
    const box = mailbox({ capabilities: [] })

    await expect(expungeOnly(box.client, [2])).resolves.toBe(true)
    expect([...box.messages.keys()]).toEqual([1, 3, 4])
  })

  it('takes along what this app deleted there before and left waiting', async () => {
    const box = mailbox({ capabilities: [], deleted: [4] })

    await expect(expungeOnly(box.client, [2], new Set([4]))).resolves.toBe(true)
    expect([...box.messages.keys()]).toEqual([1, 3])
  })

  it('never expunges, without UIDPLUS, a message another program marked deleted', async () => {
    const box = mailbox({ capabilities: [], deleted: [4] })
    const ours = new Set<number>()

    await expect(expungeOnly(box.client, [2], ours)).resolves.toBe(false)
    // Its own message stays, flagged for the next expunge; the other one is untouched.
    expect([...box.messages]).toEqual([
      [1, false],
      [2, true],
      [3, false],
      [4, true]
    ])
    expect(box.commands).not.toContain('EXPUNGE')
    // Left waiting, it is this app's own: deleting another message there is not refused for it.
    expect([...ours]).toEqual([2])

    const again = mailbox({ capabilities: [], deleted: [2] })
    await expect(expungeOnly(again.client, [3], ours)).resolves.toBe(true)
    expect([...again.messages.keys()]).toEqual([1, 4])
  })
})

describe('moveOnServer', () => {
  it('uses MOVE where the server has it', async () => {
    const box = mailbox({ capabilities: ['MOVE'], deleted: [4] })

    await moveOnServer(box.client, [1], 'Archivio')
    expect(box.commands).toEqual(['MOVE 1 Archivio'])
    expect(box.messages.has(4)).toBe(true)
  })

  it('copies, then removes only its own messages, on a server without MOVE', async () => {
    const box = mailbox({ capabilities: [] })

    await moveOnServer(box.client, [1, 2], 'Archivio')
    expect(box.copies).toEqual(['Archivio:1', 'Archivio:2'])
    expect([...box.messages.keys()]).toEqual([3, 4])
  })

  it('does not start a move that would expunge what another program marked deleted', async () => {
    const box = mailbox({ capabilities: [], deleted: [4] })

    await expect(moveOnServer(box.client, [1], 'Archivio')).rejects.toThrow(/: not moved\./)
    expect(box.copies).toEqual([])
    expect(box.messages.get(4)).toBe(true)
    expect(box.commands).toEqual(['NOOP', 'SEARCH DELETED'])
  })

  it('with UIDPLUS but no MOVE, copies and expunges by UID whatever else is marked', async () => {
    const box = mailbox({ capabilities: ['UIDPLUS'], deleted: [4] })

    await moveOnServer(box.client, [1], 'Archivio')
    expect(box.copies).toEqual(['Archivio:1'])
    expect([...box.messages.keys()]).toEqual([2, 3, 4])
  })
})
