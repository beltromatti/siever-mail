import { describe, expect, it } from 'vitest'

import { PLACES } from '../places'
import { COMMAND_GROUP_LABELS, COMMANDS } from '../commands'
import {
  defineMessages,
  emptyMessages,
  formatLocaleFor,
  regionOfTag,
  isLanguage,
  LANGUAGES,
  languageOfTag,
  localized,
  messagesIn
} from '.'

describe('messages', () => {
  const messages = defineMessages({
    inbox: { en: 'Inbox', it: 'Posta in arrivo', de: 'Posteingang' },
    unread: {
      en: (count: number) => (count === 1 ? '1 unread' : `${count} unread`),
      it: (count: number) => (count === 1 ? '1 non letto' : `${count} non letti`),
      de: (count: number) => (count === 1 ? '1 ungelesen' : `${count} ungelesen`)
    }
  })

  it('gives a module its words in a language, the same object each time', () => {
    const italian = messagesIn(messages, 'it')

    expect(italian.inbox).toBe('Posta in arrivo')
    expect(italian.unread(3)).toBe('3 non letti')
    expect(messagesIn(messages, 'de').unread(1)).toBe('1 ungelesen')
    expect(messagesIn(messages, 'it')).toBe(italian)
  })

  it('refuses at compile time a language missing or other arguments than the English', () => {
    const numbered = (n: number): string => `${n}`
    const named = (s: string): string => s

    // @ts-expect-error German missing
    defineMessages({ a: { en: 'a', it: 'a' } })
    // @ts-expect-error other arguments than the English
    defineMessages({ b: { en: numbered, it: named, de: numbered } })
    // @ts-expect-error words where the English takes arguments
    defineMessages({ c: { en: numbered, it: 'c', de: numbered } })
  })

  it('reads words an extension gives: one string, or one per language', () => {
    expect(localized('Archiviato', 'de')).toBe('Archiviato')
    expect(localized({ en: 'Filed', it: 'Archiviato', de: 'Abgelegt' }, 'en')).toBe('Filed')
  })

  it('has every word of the shared lists in every language', () => {
    expect(emptyMessages(PLACES)).toEqual([])
    expect(emptyMessages(COMMAND_GROUP_LABELS)).toEqual([])

    for (const command of COMMANDS) {
      for (const language of LANGUAGES) {
        expect(localized(command.label, language).trim()).not.toBe('')
        expect(localized(command.description, language).trim()).not.toBe('')
      }
    }
  })
})

describe('languages', () => {
  it('knows its languages, from a tag too', () => {
    expect(isLanguage('de')).toBe(true)
    expect(isLanguage('es')).toBe(false)
    expect(languageOfTag('it-IT')).toBe('it')
    expect(languageOfTag('de_CH')).toBe('de')
    expect(languageOfTag('fr-FR')).toBeNull()
  })

  it('writes dates and numbers as the computer’s region does, in the chosen language', () => {
    expect(formatLocaleFor('en', 'IT')).toBe('en-IT')
    expect(formatLocaleFor('de', 'CH')).toBe('de-CH')
    expect(formatLocaleFor('de', 'it')).toBe('de-IT')
    expect(formatLocaleFor('en', null)).toBe('en')

    const date = new Date(Date.UTC(2026, 10, 12, 14, 5))
    const written = new Intl.DateTimeFormat(formatLocaleFor('en', 'IT'), {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC'
    }).format(date)
    expect(written).toBe('12/11/2026, 14:05')
  })

  it('finds the region in every way a system writes it, its override first', () => {
    expect(regionOfTag('it-IT')).toBe('IT')
    expect(regionOfTag('de_CH.UTF-8')).toBe('CH')
    expect(regionOfTag('es-419')).toBe('419')
    expect(regionOfTag('zh-Hant-TW')).toBe('TW')
    expect(regionOfTag('en_US@rg=itzzzz')).toBe('IT')
    expect(regionOfTag('en-US-u-rg-itzzzz')).toBe('IT')
    expect(regionOfTag('en-u-hc-h23')).toBeNull()
    expect(regionOfTag('en')).toBeNull()
    expect(regionOfTag(null)).toBeNull()
  })
})
