import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import {
  DEFAULT_LANGUAGE,
  hourStyleFor,
  messagesIn,
  type Language,
  type LanguageState,
  type Message,
  type Messages
} from '@shared/i18n'

/**
 * The interface's language in the page (vision §13.5). It is known before
 * the first paint (the bridge asks for it synchronously) and changes live:
 * the root redraws when it changes, and everything under it redraws with it
 * — components read their words with `useMessages`, and the formatting
 * helpers read the language of the moment (`languageNow`).
 */

const FALLBACK: LanguageState = { language: DEFAULT_LANGUAGE, formatLocale: DEFAULT_LANGUAGE }

let current: LanguageState =
  typeof window !== 'undefined' && window.languageApi ? window.languageApi.initial : FALLBACK

const LanguageContext = createContext<LanguageState>(current)

function apply(state: LanguageState): void {
  current = state
  document.documentElement.lang = state.language
}

export function LanguageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState(current)

  useEffect(() => {
    apply(current)
    return window.languageApi?.onChanged((next) => {
      // Before the redraw: the helpers called while drawing say the new language.
      apply(next)
      setState(next)
    })
  }, [])

  return <LanguageContext.Provider value={state}>{children}</LanguageContext.Provider>
}

/** The interface's language and how it writes dates; redraws the caller when it changes. */
export function useLanguage(): LanguageState {
  return useContext(LanguageContext)
}

/** A module's messages in the interface's language. */
export function useMessages<M extends Record<string, Message>>(messages: M): Messages<M> {
  return messagesIn(messages, useLanguage().language)
}

/** The language of this moment, for what is said outside drawing: a toast, a title. */
export function languageNow(): LanguageState {
  return current
}

/** What `Intl.Locale` says of weeks: `getWeekInfo()` now, the `weekInfo` getter in older engines. */
type WeekLocale = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number }
  weekInfo?: { firstDay: number }
}

const firstDays = new Map<string, number>()

/**
 * The day weeks start on where the user is, 1 Monday … 7 Sunday: Monday
 * in Italy, Sunday in the United States — the region's, not the language's.
 * Monday when the platform does not say. The calendar and the mail's «this
 * week» count weeks with it.
 */
export function firstDayOfWeek(locale: string = current.formatLocale): number {
  let firstDay = firstDays.get(locale)

  if (firstDay === undefined) {
    try {
      const week = new Intl.Locale(locale) as WeekLocale
      const said = (week.getWeekInfo?.() ?? week.weekInfo)?.firstDay
      firstDay = said !== undefined && said >= 1 && said <= 7 ? said : 1
    } catch {
      firstDay = 1
    }

    firstDays.set(locale, firstDay)
  }

  return firstDay
}

/** How the hour of a time is written here now: "07:30" on a 24-hour clock, "7:30 AM" on a 12-hour one. */
export function hourStyle(): '2-digit' | 'numeric' {
  return hourStyleFor(current.formatLocale)
}

/** A module's messages in the language of this moment, outside drawing. */
export function messagesNow<M extends Record<string, Message>>(messages: M): Messages<M> {
  return messagesIn(messages, current.language)
}

/** Makes `language` the interface's: every window and the main process follow. */
export async function chooseLanguage(language: Language): Promise<void> {
  if (window.languageApi) {
    apply(await window.languageApi.set(language))
  }
}
