import { describe, expect, it } from 'vitest'

import {
  folderDisplayName,
  folderForRole,
  folderRole,
  unifiedFolderPath,
  unifiedFolderRole
} from './folders'
import type { MailFolder } from './models'

function folder(path: string, specialUse?: string, name = path): MailFolder {
  return {
    id: `a:${path}`,
    accountId: 'a',
    path,
    name,
    specialUse,
    messageCount: 0,
    unseenCount: 0
  }
}

describe('folderRole', () => {
  it('reads INBOX in any case, and the special use in any case', () => {
    expect(folderRole(folder('INBOX'))).toBe('\\Inbox')
    expect(folderRole(folder('Inbox'))).toBe('\\Inbox')
    expect(folderRole(folder('INBOX.Sent', '\\sent'))).toBe('\\Sent')
    expect(folderRole(folder('[Gmail]/Tutti i messaggi', '\\All'))).toBeNull()
    expect(folderRole(folder('Fatture'))).toBeNull()
  })
})

describe('folderDisplayName', () => {
  it('names a folder by its role in Italian, and any other by its own name', () => {
    expect(folderDisplayName(folder('INBOX'))).toBe('Posta in arrivo')
    expect(folderDisplayName(folder('Sent Items', '\\Sent', 'Sent Items'))).toBe('Posta inviata')
    expect(folderDisplayName(folder('INBOX.Fatture', undefined, 'Fatture'))).toBe('Fatture')
  })
})

describe('folderForRole', () => {
  const gmail = [
    folder('INBOX'),
    folder('[Gmail]/Posta inviata', '\\Sent'),
    folder('[Gmail]/Tutti i messaggi', '\\All')
  ]

  it('finds the folder flagged for a role', () => {
    expect(folderForRole(gmail, '\\Sent')?.path).toBe('[Gmail]/Posta inviata')
    expect(folderForRole(gmail, '\\Trash')).toBeNull()
  })

  it("takes Gmail's Tutti i messaggi as its archive, and nothing else's", () => {
    expect(folderForRole(gmail, '\\Archive')?.path).toBe('[Gmail]/Tutti i messaggi')
    expect(folderForRole([folder('INBOX'), folder('All', '\\All')], '\\Archive')).toBeNull()
    expect(folderForRole([folder('Archivio', '\\Archive'), ...gmail], '\\Archive')?.path).toBe(
      'Archivio'
    )
  })
})

describe('unified folder paths', () => {
  it('round-trips a role and refuses anything else', () => {
    expect(unifiedFolderRole(unifiedFolderPath('\\Junk'))).toBe('\\Junk')
    expect(unifiedFolderRole('INBOX')).toBeNull()
    expect(unifiedFolderRole('__all__:\\All')).toBeNull()
    expect(unifiedFolderRole(null)).toBeNull()
  })
})
