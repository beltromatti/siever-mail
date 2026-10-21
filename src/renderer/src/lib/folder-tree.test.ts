import { describe, expect, it } from 'vitest'

import type { MailFolder } from '@shared/models'

import { buildFolderTree, flattenFolderTree } from './folder-tree'

function folder(path: string, specialUse?: string, delimiter = '/'): MailFolder {
  return {
    id: path,
    accountId: 'a',
    path,
    name: path.slice(path.lastIndexOf(delimiter) + 1),
    delimiter,
    specialUse,
    messageCount: 0,
    unseenCount: 0
  }
}

function outline(folders: MailFolder[]): string[] {
  return flattenFolderTree(buildFolderTree(folders)).map(
    ({ node, depth }) => `${'  '.repeat(depth)}${node.name}${node.folder ? '' : ' (contenitore)'}`
  )
}

describe('buildFolderTree', () => {
  it("puts Gmail's role folders at the top and drops the empty [Gmail] container", () => {
    expect(
      outline([
        folder('INBOX', '\\Inbox'),
        folder('[Gmail]/Posta inviata', '\\Sent'),
        folder('[Gmail]/Cestino', '\\Trash'),
        folder('[Gmail]/Bozze', '\\Drafts'),
        folder('Notes')
      ])
    ).toEqual(['INBOX', 'Posta inviata', 'Bozze', 'Cestino', 'Notes'])
  })

  it('nests user folders under their parent, the way the server keeps them', () => {
    expect(
      outline([
        folder('INBOX', '\\Inbox', '.'),
        folder('INBOX.Archive', '\\Archive', '.'),
        folder('INBOX.Archive.0 AICARR', undefined, '.'),
        folder('INBOX.Sent', '\\Sent', '.'),
        folder('INBOX.bollette', undefined, '.'),
        folder('INBOX.Archive.bollette', undefined, '.'),
        folder('INBOX.Clienti.Rossi', undefined, '.')
      ])
    ).toEqual([
      'INBOX',
      '  bollette',
      '  Clienti (contenitore)',
      '    Rossi',
      'Sent',
      'Archive',
      '  0 AICARR',
      '  bollette'
    ])
  })

  it('builds the same tree whatever order the server lists folders in', () => {
    const folders = [
      folder('INBOX.Archive.0 AICARR', undefined, '.'),
      folder('INBOX.Sent', '\\Sent', '.'),
      folder('INBOX.Archive', '\\Archive', '.'),
      folder('INBOX', '\\Inbox', '.')
    ]

    expect(outline(folders)).toEqual(outline([...folders].reverse()))
    expect(outline(folders)).toEqual(['INBOX', 'Sent', 'Archive', '  0 AICARR'])
  })

  it('keeps a parent reached through its child as a real folder once it is listed', () => {
    expect(outline([folder('Progetti/2026'), folder('Progetti')])).toEqual(['Progetti', '  2026'])
  })
})
