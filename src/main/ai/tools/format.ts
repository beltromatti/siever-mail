import type { MailAddress } from '@shared/models'

const DATE_TIME = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

/** A date as the Segretario reads it: "lun 26/10/2026, 10:42", in the user's time. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.valueOf()) ? iso : DATE_TIME.format(date)
}

export function formatAddress(address: MailAddress): string {
  const name = address.name?.trim()
  return name && name !== address.address ? `${name} <${address.address}>` : address.address
}

export function formatAddresses(addresses: ReadonlyArray<MailAddress>, max = 6): string {
  const shown = addresses.slice(0, max).map(formatAddress).join(', ')
  return addresses.length > max ? `${shown} e altri ${addresses.length - max}` : shown || '—'
}

/** `text` cut to `max` characters, with a note of what was left out. */
export function clip(text: string, max: number): { text: string; clipped: boolean } {
  return text.length > max
    ? { text: `${text.slice(0, max)}…`, clipped: true }
    : { text, clipped: false }
}

/**
 * Lines that introduce a quoted earlier message, in the clients the
 * Segretario's users write from: Outlook, Gmail, Apple Mail, Thunderbird,
 * in Italian and English.
 */
const QUOTE_INTRODUCTIONS = [
  /^-{2,}\s*(messaggio originale|original message|messaggio inoltrato|forwarded message)\s*-{2,}/i,
  /^il giorno .{4,160} ha scritto:?$/i,
  /^on .{4,160} wrote:?$/i,
  /^(da|from):\s.+$/i
]

/**
 * A reply's own words, without the earlier messages it quotes: reading a
 * conversation, each message is already there in full. Cut at the first
 * line that introduces a quote, and lines quoted with ">".
 */
export function withoutQuotedHistory(text: string): { text: string; cut: boolean } {
  const lines = text.split('\n')
  const kept: string[] = []

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()

    // "Da: …" opens Outlook's quote only when "Inviato:"/"Sent:" follows.
    if (/^(da|from):\s/i.test(trimmed)) {
      const next = lines.slice(index + 1, index + 4).join(' ')

      if (!/(inviato|sent|data|date):/i.test(next)) {
        kept.push(line)
        continue
      }
    }

    if (QUOTE_INTRODUCTIONS.some((pattern) => pattern.test(trimmed))) {
      return { text: kept.join('\n').trimEnd(), cut: true }
    }

    if (!trimmed.startsWith('>')) {
      kept.push(line)
    }
  }

  const result = kept.join('\n').trimEnd()
  return { text: result, cut: result.length < text.trimEnd().length }
}

/** "1 messaggio", "3 messaggi". */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

const SHORT_DATE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })

/** A calendar day written AAAA-MM-GG, as a line says it: "13 ott". */
export function shortDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return SHORT_DATE.format(new Date(year, month - 1, date))
}
