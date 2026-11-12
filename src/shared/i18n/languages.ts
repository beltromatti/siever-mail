/**
 * The languages SIEVER Mail speaks (vision §13.5). The interface's language
 * is the user's choice; how dates and numbers are written follows the
 * computer's region, in that language: English on an Italian computer
 * writes 12/11/2026, 14:05 and 1.234,5 (`formatLocaleFor`).
 *
 * A language more is one entry here, and its words in every message: the
 * compiler lists each one still missing.
 */
export const LANGUAGES = ['en', 'it', 'de'] as const

export type Language = (typeof LANGUAGES)[number]

/** The language of a first start, before the user chooses (the guided setup asks first). */
export const DEFAULT_LANGUAGE: Language = 'en'

/** Each language by its own name, as a list of languages shows them. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: 'English',
  it: 'Italiano',
  de: 'Deutsch'
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** The language of a BCP 47 tag ("it-IT" → "it"), if SIEVER Mail speaks it. */
export function languageOfTag(tag: string): Language | null {
  const base = tag.toLowerCase().split(/[-_]/)[0]
  return isLanguage(base) ? base : null
}

/**
 * The region a locale tag names, if it names one: "it-IT" → "IT", "de_CH.UTF-8"
 * → "CH", "es-419" → "419". A region override wins over the tag's own: macOS
 * writes English with Italy's formats as "en_US@rg=itzzzz", BCP 47 as
 * "en-US-u-rg-itzzzz".
 */
export function regionOfTag(tag: string | null): string | null {
  if (!tag) {
    return null
  }

  const override = /(?:^|[@;-])rg[=-]([a-z]{2}|\d{3})z{4}(?:$|[;-])/i.exec(tag)

  if (override) {
    return override[1].toUpperCase()
  }

  for (const part of tag.split(/[@.]/)[0].split(/[-_]/).slice(1)) {
    // An extension ("-u-…", "-x-…") follows the region, never precedes it.
    if (part.length === 1) {
      break
    }

    if (/^(?:[a-z]{2}|\d{3})$/i.test(part)) {
      return part.toUpperCase()
    }
  }

  return null
}

/**
 * How dates and numbers are written: the language, in the computer's
 * region when there is one ("en" in "IT" → "en-IT"); the language alone,
 * as its own speakers write it, when the region is unknown.
 */
export function formatLocaleFor(language: Language, region: string | null): string {
  const candidate = region ? `${language}-${region.toUpperCase()}` : null

  try {
    if (candidate && Intl.DateTimeFormat.supportedLocalesOf([candidate]).length > 0) {
      return candidate
    }
  } catch {
    // A region the platform does not take: the language alone.
  }

  return language
}

const hourStyles = new Map<string, '2-digit' | 'numeric'>()

/**
 * How a time's hour is written where the user is: two digits on a 24-hour
 * clock ("07:30"), as is where they write it so; plain on a 12-hour one
 * ("7:30 AM"), where "07:30 AM" would look wrong.
 */
export function hourStyleFor(locale: string): '2-digit' | 'numeric' {
  let style = hourStyles.get(locale)

  if (!style) {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
    style = cycle === 'h11' || cycle === 'h12' ? 'numeric' : '2-digit'
    hourStyles.set(locale, style)
  }

  return style
}

/** The state of the interface's language: the user's choice and the way it writes dates. */
export interface LanguageState {
  language: Language
  formatLocale: string
}
