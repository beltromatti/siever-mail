import { describe, expect, it } from 'vitest'

import type { MailFolder, MessageRef } from '@shared/models'

import { keptRefs, planArchive, type ArchiveRow } from './archive-plan'

function folder(path: string, specialUse?: string, delimiter = '/'): MailFolder {
  return {
    id: `a:${path}`,
    accountId: 'a',
    path,
    name: path.split(delimiter).pop() ?? path,
    delimiter,
    specialUse,
    messageCount: 0,
    unseenCount: 0
  }
}

const ref = (folderPath: string, uid: number): MessageRef => ({ accountId: 'a', folderPath, uid })

const GMAIL = [
  folder('INBOX'),
  folder('[Gmail]/Tutti i messaggi', '\\All'),
  folder('[Gmail]/Cestino', '\\Trash'),
  folder('[Gmail]/Spam', '\\Junk'),
  folder('[Gmail]/Posta inviata', '\\Sent'),
  folder('Lavoro')
]

/** A Gmail message: the same key in every folder it shows in. */
function gmail(key: string, rows: Array<[string, number]>): ArchiveRow[] {
  return rows.map(([folderPath, uid]) => ({ folderPath, uid, messageKey: key }))
}

describe('planArchive on Gmail', () => {
  const rows = [
    ...gmail('e:1', [
      ['INBOX', 10],
      ['[Gmail]/Tutti i messaggi', 110],
      ['Lavoro', 5]
    ]),
    ...gmail('e:2', [
      ['[Gmail]/Tutti i messaggi', 120],
      ['Lavoro', 6]
    ]),
    ...gmail('e:3', [['[Gmail]/Cestino', 7]]),
    ...gmail('e:4', [['[Gmail]/Spam', 8]])
  ]
  const identities = [
    { ref: ref('Lavoro', 5), messageKey: 'e:1' },
    { ref: ref('[Gmail]/Tutti i messaggi', 110), messageKey: 'e:1' },
    { ref: ref('Lavoro', 6), messageKey: 'e:2' },
    { ref: ref('[Gmail]/Cestino', 7), messageKey: 'e:3' },
    { ref: ref('[Gmail]/Spam', 8), messageKey: 'e:4' }
  ]

  it('archives a message picked from a label by its inbox row, its label kept', () => {
    const plan = planArchive({ folders: GMAIL, refs: [ref('Lavoro', 5)], identities, rows })

    expect([...plan.moves]).toEqual([['INBOX', [10]]])
    expect(plan.pending).toEqual([{ ref: ref('Lavoro', 5), folders: ['INBOX'] }])
  })

  it('keeps where they are the rows archived by another of their rows, unless refused', () => {
    const plan = planArchive({
      folders: GMAIL,
      refs: [ref('Lavoro', 5), ref('INBOX', 10), ref('Lavoro', 6)],
      identities,
      rows
    })

    expect(keptRefs(plan, [])).toEqual([ref('Lavoro', 6), ref('Lavoro', 5)])
    expect(keptRefs(plan, [ref('Lavoro', 5)])).toEqual([ref('Lavoro', 6)])
  })

  it('moves the inbox row once when the message is picked twice', () => {
    const plan = planArchive({
      folders: GMAIL,
      refs: [ref('Lavoro', 5), ref('[Gmail]/Tutti i messaggi', 110)],
      identities,
      rows
    })

    expect([...plan.moves]).toEqual([['INBOX', [10]]])
    expect(plan.pending).toHaveLength(2)
  })

  it('leaves a message out of the inbox where it is: archived already, no failure', () => {
    const plan = planArchive({ folders: GMAIL, refs: [ref('Lavoro', 6)], identities, rows })

    expect(plan.moves.size).toBe(0)
    expect(plan.restores.size).toBe(0)
    expect(plan.stayed).toEqual([ref('Lavoro', 6)])
  })

  it('brings a message out of the Trash or Spam, by way of the inbox', () => {
    const plan = planArchive({
      folders: GMAIL,
      refs: [ref('[Gmail]/Cestino', 7), ref('[Gmail]/Spam', 8)],
      identities,
      rows
    })

    expect(plan.moves.size).toBe(0)
    expect([...plan.restores]).toEqual([
      ['[Gmail]/Cestino', [7]],
      ['[Gmail]/Spam', [8]]
    ])
  })

  it('reports a message the cache no longer holds', () => {
    const plan = planArchive({ folders: GMAIL, refs: [ref('INBOX', 99)], identities, rows })

    expect(plan.unknown).toEqual([ref('INBOX', 99)])
    expect(plan.moves.size).toBe(0)
  })
})

describe('planArchive on another server', () => {
  const folders = [
    folder('INBOX', undefined, '.'),
    folder('Archivio', '\\Archive', '.'),
    folder('Archivio.2025', undefined, '.'),
    folder('Trash', '\\Trash', '.'),
    folder('Clienti', undefined, '.')
  ]
  const refs = [
    ref('INBOX', 1),
    ref('Clienti', 2),
    ref('Trash', 3),
    ref('Archivio', 4),
    ref('Archivio.2025', 5)
  ]
  const identities = refs.map((given, index) => ({ ref: given, messageKey: `m:${index}@x` }))

  it('moves the row picked to the archive, from any folder but the archive and inside it', () => {
    const plan = planArchive({ folders, refs, identities, rows: [] })

    expect([...plan.moves]).toEqual([
      ['INBOX', [1]],
      ['Clienti', [2]],
      ['Trash', [3]]
    ])
    expect(plan.stayed).toEqual([ref('Archivio', 4), ref('Archivio.2025', 5)])
    expect(plan.restores.size).toBe(0)
  })

  it('moves everything where the account has no archive folder yet', () => {
    const plan = planArchive({
      folders: folders.filter((candidate) => !candidate.path.startsWith('Archivio')),
      refs: refs.slice(0, 3),
      identities,
      rows: []
    })

    expect(plan.pending.map((entry) => entry.ref)).toEqual(refs.slice(0, 3))
    expect(plan.stayed).toEqual([])
  })
})
