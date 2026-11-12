import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

import { diagnostics } from '@main/diagnostics/log'
import {
  DEFAULT_LANGUAGE,
  formatLocaleFor,
  isLanguage,
  LANGUAGE_IPC,
  languageOfTag,
  messagesIn,
  regionOfTag,
  type Language,
  type LanguageState,
  type Message,
  type Messages
} from '@shared/i18n'

const log = diagnostics('app')

/**
 * The interface's language in the main process (vision §13.5): what the
 * menus, the notifications, the dialogs and every word the app sends the
 * page say. One file of the profile keeps it — read before anything opens,
 * so the window, the menus and the first paint are in it from the start.
 */
const LANGUAGE_FILE_NAME = 'language'
/** The database of a profile: there before languages were, a profile that spoke Italian. */
const PROFILE_DATABASE = 'siever-mail.sqlite'

let language: Language = DEFAULT_LANGUAGE
const listeners = new Set<(state: LanguageState) => void>()

function languageFilePath(): string {
  return join(app.getPath('userData'), LANGUAGE_FILE_NAME)
}

/** The language a profile's folder keeps, if one was chosen there. */
function storedLanguage(profile: string): Language | null {
  try {
    const stored = readFileSync(join(profile, LANGUAGE_FILE_NAME), 'utf8').trim()
    return isLanguage(stored) ? stored : null
  } catch {
    // Never chosen.
    return null
  }
}

/** Whether a profile was used by a version before languages: it spoke Italian. */
function usedBeforeLanguages(profile: string): boolean {
  return existsSync(join(profile, PROFILE_DATABASE))
}

/**
 * The language a profile speaks, read from its folder: what a process that
 * is not the app — the one taking SIEVER Mail away (§13.2), which runs with
 * a profile of its own — says its words in. Read before the folder is cleared.
 */
export function profileLanguage(profile: string): Language {
  return storedLanguage(profile) ?? (usedBeforeLanguages(profile) ? 'it' : DEFAULT_LANGUAGE)
}

/**
 * The language this start opens in: the one chosen; else, for a profile of
 * the versions before languages — which spoke Italian —, Italian, so an
 * update changes nothing for who was using it; else the edition's own
 * (an extension's, for its organisation) or English. The first start asks
 * in its guided setup (§12.2).
 */
export function startLanguage(options: { editionDefault?: Language | null }): void {
  const profile = app.getPath('userData')
  const stored = storedLanguage(profile)

  if (stored) {
    language = stored
    return
  }

  language = usedBeforeLanguages(profile) ? 'it' : (options.editionDefault ?? DEFAULT_LANGUAGE)
  remember(language)
}

function remember(value: Language): void {
  try {
    writeFileSync(languageFilePath(), value)
  } catch (error) {
    log.warn('language.not-remembered', { err: error })
  }
}

export function currentLanguage(): Language {
  return language
}

/**
 * The language with the computer's region, for dates and numbers. The region
 * is the one the system formats with — the user's override included, which
 * the locale's own tag may not say (`en-US@rg=itzzzz` on a Mac in English
 * with Italy's formats) —, from the tag when the system does not say it.
 */
export function languageState(): LanguageState {
  const region = app.getLocaleCountryCode() || regionOfTag(app.getSystemLocale())
  return { language, formatLocale: formatLocaleFor(language, region) }
}

/** The computer's own language, when SIEVER Mail speaks it. */
export function systemLanguage(): Language | null {
  for (const tag of app.getPreferredSystemLanguages()) {
    const found = languageOfTag(tag)

    if (found) {
      return found
    }
  }

  return languageOfTag(app.getLocale())
}

export function setLanguage(next: Language): LanguageState {
  if (next !== language) {
    log.info('language.change', { from: language, to: next, by: 'user' })
    language = next
    remember(next)
    const state = languageState()

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(LANGUAGE_IPC.changed, state)
      }
    }

    for (const listener of listeners) {
      listener(state)
    }
  }

  return languageState()
}

/** Called when the language changes: what the main process drew in words draws itself again. */
export function onLanguageChange(listener: (state: LanguageState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A module's messages in the interface's language now: read where they are said, not kept. */
export function messages<M extends Record<string, Message>>(definitions: M): Messages<M> {
  return messagesIn(definitions, language)
}

export function registerLanguageIpc(): void {
  ipcMain.on(LANGUAGE_IPC.initial, (event) => {
    event.returnValue = languageState()
  })
  ipcMain.handle(LANGUAGE_IPC.set, (_event, value: unknown) => {
    if (!isLanguage(value)) {
      throw new Error(`Unknown language: ${String(value)}`)
    }

    return setLanguage(value)
  })
  ipcMain.handle(LANGUAGE_IPC.system, () => systemLanguage())
}
