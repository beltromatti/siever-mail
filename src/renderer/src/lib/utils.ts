import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { defineMessages } from '@shared/i18n'

import { hourStyle, languageNow, messagesNow } from './i18n'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

const REVEAL = defineMessages({
  mac: { en: 'Show in Finder', it: 'Mostra nel Finder', de: 'Im Finder zeigen' },
  windows: {
    en: 'Show in File Explorer',
    it: 'Mostra in Esplora file',
    de: 'Im Explorer anzeigen'
  },
  other: { en: 'Show in folder', it: 'Mostra nella cartella', de: 'Im Ordner zeigen' }
})

/** What the system calls showing a file in its folder: "Show in Finder" on a Mac. */
export function revealInFolderLabel(platform = navigator.platform): string {
  const m = messagesNow(REVEAL)

  if (/mac/i.test(platform)) {
    return m.mac
  }

  return /win/i.test(platform) ? m.windows : m.other
}

/**
 * "1 message", "9,795 messages": a count, written as the region writes
 * numbers, with its noun in the right number for the interface's language.
 */
export function formatCount(count: number, singular: string, plural: string): string {
  const { language, formatLocale } = languageNow()
  const one = new Intl.PluralRules(language).select(count) === 'one'
  return `${count.toLocaleString(formatLocale)} ${one ? singular : plural}`
}

export function formatAppVersion(rawVersion: string): string {
  const normalizedVersion = rawVersion.trim().replace(/^v/i, '')
  const [major = '0', minor = '0', patch = '0'] = normalizedVersion.split('.')

  return `${major || '0'}.${minor || '0'}.${patch || '0'}`
}

export function formatAddress(address: { name?: string; address: string }): string {
  if (address.name) {
    return `${address.name} <${address.address}>`
  }

  return address.address
}

export function formatDateLabel(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.valueOf())) {
    return value
  }

  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  const { formatLocale } = languageNow()

  if (sameDay) {
    return new Intl.DateTimeFormat(formatLocale, {
      hour: hourStyle(),
      minute: '2-digit'
    }).format(date)
  }

  return new Intl.DateTimeFormat(formatLocale, {
    day: '2-digit',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  }).format(date)
}

/**
 * Full date for the dense table view, in the "Friday 05/06/2026 19:38"
 * shape Outlook uses, as the region writes it. The weekday earns its
 * place there: at 15+ rows on screen it is the fastest way to locate the
 * day a message arrived without counting back from today.
 */
export function formatDateTimeLabel(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat(languageNow().formatLocale, {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: hourStyle(),
    minute: '2-digit'
  })
    .format(date)
    .replace(',', '')
}

/**
 * Message size for the table's "Dimensione" column. Whole KB below a
 * megabyte (nobody cares about 86.4 KB), one decimal above it.
 */
export function formatByteSize(sizeBytes: number): string {
  const safeSize = Math.max(0, sizeBytes)

  if (safeSize < 1024) {
    return `${safeSize} B`
  }

  const kilobytes = safeSize / 1024

  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`
  }

  const megabytes = kilobytes / 1024
  const digits = megabytes < 10 ? 1 : 0
  return `${megabytes.toLocaleString(languageNow().formatLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })} MB`
}
