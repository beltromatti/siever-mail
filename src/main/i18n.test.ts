import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const profile = { path: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => profile.path,
    getSystemLocale: () => 'en-US@rg=itzzzz',
    getLocaleCountryCode: () => '',
    getPreferredSystemLanguages: () => ['fr-FR', 'de-DE'],
    getLocale: () => 'en-US'
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

const {
  currentLanguage,
  languageState,
  profileLanguage,
  setLanguage,
  startLanguage,
  systemLanguage
} = await import('./i18n')

beforeEach(() => {
  profile.path = mkdtempSync(join(tmpdir(), 'siever-language-'))
})

afterEach(() => {
  rmSync(profile.path, { recursive: true, force: true })
})

describe('the interface language', () => {
  it('starts a new profile in English, or in the edition’s language, and keeps it', () => {
    startLanguage({})
    expect(currentLanguage()).toBe('en')
    expect(readFileSync(join(profile.path, 'language'), 'utf8')).toBe('en')

    rmSync(join(profile.path, 'language'))
    startLanguage({ editionDefault: 'it' })
    expect(currentLanguage()).toBe('it')
  })

  it('keeps Italian for a profile of the versions before languages', () => {
    writeFileSync(join(profile.path, 'siever-mail.sqlite'), '')
    startLanguage({ editionDefault: 'de' })
    expect(currentLanguage()).toBe('it')
  })

  it('opens in the language chosen, and remembers a change', () => {
    writeFileSync(join(profile.path, 'language'), 'de')
    startLanguage({})
    expect(currentLanguage()).toBe('de')

    expect(setLanguage('en')).toEqual({ language: 'en', formatLocale: 'en-IT' })
    expect(readFileSync(join(profile.path, 'language'), 'utf8')).toBe('en')
    expect(languageState().formatLocale).toBe('en-IT')
  })

  it('suggests the first of the computer’s languages it speaks', () => {
    expect(systemLanguage()).toBe('de')
  })

  it('reads the language of a profile from its folder, for the process that takes it away', () => {
    expect(profileLanguage(profile.path)).toBe('en')

    writeFileSync(join(profile.path, 'siever-mail.sqlite'), '')
    expect(profileLanguage(profile.path)).toBe('it')

    writeFileSync(join(profile.path, 'language'), 'de')
    expect(profileLanguage(profile.path)).toBe('de')
  })
})
