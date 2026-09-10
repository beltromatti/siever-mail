import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
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

  if (sameDay) {
    return new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  }).format(date)
}

/**
 * Full date for the dense table view, matching the "venerdì 05/06/2026
 * 19:38" shape the SIEVER team reads in Outlook. The weekday earns its
 * place there: at 15+ rows on screen it is the fastest way to locate the
 * day a message arrived without counting back from today.
 */
export function formatDateTimeLabel(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
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
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
}
