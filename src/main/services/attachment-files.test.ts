import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, shell: {} }))

import { isExecutableAttachment } from './attachment-files'
import { isUserFile, mergeRecentCandidates } from './recent-files'

describe('isExecutableAttachment', () => {
  it('refuses to launch anything that runs code, whatever the case', () => {
    for (const name of ['setup.EXE', 'fattura.pdf.js', 'script.ps1', 'installer.pkg', 'disk.iso']) {
      expect(isExecutableAttachment(name)).toBe(true)
    }
  })

  it('opens documents and archives', () => {
    for (const name of ['fattura.pdf', 'offerta.docx', 'dati.xlsm', 'foto.JPG', 'archivio.zip']) {
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
        { path: '/docs/offerta.pdf', activity: 'Usato di recente', usedAt: 300 },
        { path: '/docs/altro.pdf', activity: 'Usato di recente', usedAt: 200 }
      ],
      false
    )

    expect(merged).toEqual([
      { path: '/Docs/Offerta.pdf', activity: 'Salvato da un messaggio', usedAt: 300 },
      { path: '/docs/altro.pdf', activity: 'Usato di recente', usedAt: 200 }
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

describe('isUserFile', () => {
  const folders = {
    roots: ['/Users/anna/Library', '/Users/anna/Library/Application Support/SIEVER Mail', '/tmp'],
    exceptions: ['/Users/anna/Library/Mobile Documents', '/Users/anna/Library/CloudStorage']
  }

  it('offers the documents people work on, in the cloud folders too', () => {
    for (const path of [
      '/Users/anna/Documents/Offerta 619.pdf',
      '/Volumes/Pratiche/619 IKEA/Verbale.docx',
      '/Users/anna/Library/Mobile Documents/com~apple~CloudDocs/Preventivo.xlsx',
      '/Users/anna/Library/CloudStorage/OneDrive-SIEVER/Tavola.dwg'
    ]) {
      expect(isUserFile(path, folders, true), path).toBe(true)
    }
  })

  it('leaves out copies programs keep, hidden folders and what runs', () => {
    for (const path of [
      '/Users/anna/Library/Application Support/SIEVER Mail/attachments/a/b/Fattura.pdf',
      '/Users/anna/Library/Caches/com.microsoft.Outlook/Fattura.pdf',
      '/tmp/upload.pdf',
      '/Users/anna/.cache/thumb.png',
      '/Users/anna/Downloads/setup.exe'
    ]) {
      expect(isUserFile(path, folders, true), path).toBe(false)
    }
  })

  it('compares Windows paths without case', () => {
    const windows = { roots: ['C:\\Users\\Anna\\AppData'], exceptions: [] }

    expect(isUserFile('c:\\users\\anna\\appdata\\local\\Temp\\Fattura.pdf', windows, false)).toBe(
      false
    )
    expect(isUserFile('C:\\Users\\Anna\\AppDataBackup\\Fattura.pdf', windows, false)).toBe(true)
    expect(isUserFile('\\\\server\\pratiche\\619\\Verbale.pdf', windows, false)).toBe(true)
  })
})
