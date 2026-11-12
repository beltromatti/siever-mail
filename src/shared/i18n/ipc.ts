import type { Language, LanguageState } from './languages'

export const LANGUAGE_IPC = {
  /** Synchronous, for the page's first paint: the interface opens in its language. */
  initial: 'language:initial',
  set: 'language:set',
  changed: 'language:changed',
  system: 'language:system'
} as const

export interface LanguageApi {
  /** The language the page opened in. */
  readonly initial: LanguageState
  /** Makes `language` the interface's, everywhere: every window, the menus, what the app says. */
  set: (language: Language) => Promise<LanguageState>
  onChanged: (listener: (state: LanguageState) => void) => () => void
  /** The computer's own language, when SIEVER Mail speaks it: what a first start suggests. */
  systemLanguage: () => Promise<Language | null>
}
