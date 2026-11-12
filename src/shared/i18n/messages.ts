import { LANGUAGES, type Language } from './languages'

/**
 * What the interface says, in every language at once (vision §13.5).
 *
 * A module's words live with it, each message with its three languages
 * side by side: written once, read together, checked by the compiler — a
 * language missing, or a translation taking other arguments than the
 * English, does not build. A message with arguments is a function in each
 * language, so plurals, articles and word order are each language's own.
 *
 *   const messages = defineMessages({
 *     inbox: { en: 'Inbox', it: 'Posta in arrivo', de: 'Posteingang' },
 *     unread: {
 *       en: (count: number) => (count === 1 ? '1 unread' : `${count} unread`),
 *       it: (count: number) => (count === 1 ? '1 non letto' : `${count} non letti`),
 *       de: (count: number) => (count === 1 ? '1 ungelesen' : `${count} ungelesen`)
 *     }
 *   })
 *
 * The interface reads them with `useMessages(messages)`, the main process
 * with `messagesIn(messages, language)`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any arguments: each message says its own
export type Text = string | ((...args: any[]) => string)

/** One message in every language. */
export type Message<T extends Text = Text> = { readonly [L in Language]: T }

/** A string, or a function taking the same arguments in every language. */
type Same<T> = T extends string ? string : T

type Checked<M extends Record<string, Message>> = {
  readonly [K in keyof M]: { readonly [L in Language]: Same<M[K]['en']> }
}

export function defineMessages<const M extends Record<string, Message>>(
  messages: M & Checked<M>
): M {
  return messages
}

/** A module's messages in one language: what a component shows. */
export type Messages<M extends Record<string, Message>> = {
  readonly [K in keyof M]: Same<M[K]['en']>
}

const resolved = new WeakMap<object, Partial<Record<Language, unknown>>>()

/** The messages in `language`, made once per language and kept. */
export function messagesIn<M extends Record<string, Message>>(
  messages: M,
  language: Language
): Messages<M> {
  const byLanguage = resolved.get(messages) ?? {}
  resolved.set(messages, byLanguage)

  const known = byLanguage[language]

  if (known) {
    return known as Messages<M>
  }

  const made = Object.fromEntries(
    Object.entries(messages).map(([key, message]) => [key, message[language]])
  ) as Messages<M>
  byLanguage[language] = made
  return made
}

/**
 * Words given from outside the app's own messages — an extension's: one
 * string for every language, or one per language.
 */
export type Localized = string | Message<string>

export function localized(value: Localized, language: Language): string {
  return typeof value === 'string' ? value : value[language]
}

/** Whether every language of every message says something: what the tests check. */
export function emptyMessages(messages: Record<string, Message>): string[] {
  return Object.entries(messages).flatMap(([key, message]) =>
    LANGUAGES.flatMap((language) => {
      const value = message[language]
      const text = typeof value === 'string' ? value : null
      return text !== null && text.trim() === '' ? [`${key}.${language}`] : []
    })
  )
}
