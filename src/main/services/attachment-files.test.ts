import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, shell: {} }))

import { isExecutableAttachment } from './attachment-files'
import { mergeRecentCandidates } from './recent-files'

describe('isExecutableAttachment', () => {
  it('refuses to launch anything that runs code, whatever the case', () => {
    for (const name of ['setup.EXE', 'fattura.pdf.js', 'script.ps1', 'installer.pkg', 'disk.iso']) {
      expect(isExecutableAttachment(name)).toBe(true)
    }
  })

  it('opens documents and archives', () => {
    for (const name of ['fattura.pdf', 'offerta.docx', 'dati.xlsm', 'foto.JPG', 'pratica.zip']) {
      expect(isExecutableAttachment(name)).toBe(false)
    }
  })

  it('treats a name without an extension as a document', () => {
    expect(isExecutableAttachment('LEGGIMI')).toBe(false)
  })
})

describe('mergeRecentCandidates', () => {
  it('keeps one entry per file, labelled by the app, at the latest time', () => {
    const merged = mergeRecentCandidates(
      [{ path: '/Docs/Offerta.pdf', activity: 'Salvato da un messaggio', usedAt: 100 }],
      [
        { path: '/docs/offerta.pdf', activity: 'Aperto di recente', usedAt: 300 },
        { path: '/docs/altro.pdf', activity: 'Aperto di recente', usedAt: 200 }
      ],
      false
    )

    expect(merged).toEqual([
      { path: '/Docs/Offerta.pdf', activity: 'Salvato da un messaggio', usedAt: 300 },
      { path: '/docs/altro.pdf', activity: 'Aperto di recente', usedAt: 200 }
    ])
  })

  it('tells apart paths that differ only in case where the file system does', () => {
    const merged = mergeRecentCandidates(
      [{ path: '/a/File.txt', activity: 'A', usedAt: 1 }],
      [{ path: '/a/file.txt', activity: 'B', usedAt: 2 }],
      true
    )

    expect(merged).toHaveLength(2)
  })
})
