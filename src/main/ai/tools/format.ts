import { hourStyleFor } from '@shared/i18n'
import type { MailAddress } from '@shared/models'

/**
 * How the tools write dates: in Italian for the model, which reads them —
 * the default —, or in the interface's language for the lines the user
 * sees (`userDates` in `./user-dates`).
 */
export interface DateWords {
  locale: string
  /** An event of all day: "tutto il giorno". */
  allDay: string
}

export const MODEL_DATES: DateWords = { locale: 'it-IT', allDay: 'tutto il giorno' }

const formats = new Map<string, Intl.DateTimeFormat>()

/** A date format, made once for each locale and kept. */
function dateFormat(locale: string, wanted: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  // The hour as the region writes it: "07:30" on a 24-hour clock, "7:30 AM" on a 12-hour one.
  const options = wanted.hour === '2-digit' ? { ...wanted, hour: hourStyleFor(locale) } : wanted
  const key = `${locale}\u0000${JSON.stringify(options)}`
  let format = formats.get(key)

  if (!format) {
    format = new Intl.DateTimeFormat(locale, options)
    formats.set(key, format)
  }

  return format
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
}
const EVENT_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
const EVENT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

/**
 * When an event is, in the user's words and time — "ven 6 nov 15:00–16:00",
 * "gio 12 nov – ven 13 nov, tutto il giorno" —, its last day said when it
 * is not its first. An event of all day ends at the midnight after it.
 */
export function eventWhen(
  start: string,
  end: string,
  allDay: boolean,
  words: DateWords = MODEL_DATES
): string {
  const day = dateFormat(words.locale, EVENT_DAY)
  const time = dateFormat(words.locale, EVENT_TIME)
  const from = allDay ? new Date(`${start.slice(0, 10)}T00:00`) : new Date(start)
  const to = allDay ? new Date(new Date(`${end.slice(0, 10)}T00:00`).getTime() - 1) : new Date(end)

  // What is no date stays as it was written.
  if (Number.isNaN(from.getTime())) {
    return allDay ? `${start}, ${words.allDay}` : start
  }

  if (allDay) {
    return Number.isNaN(to.getTime()) || from.toDateString() === to.toDateString() || to < from
      ? `${day.format(from)}, ${words.allDay}`
      : `${day.format(from)} – ${day.format(to)}, ${words.allDay}`
  }

  if (Number.isNaN(to.getTime()) || to < from) {
    return `${day.format(from)} ${time.format(from)}`
  }

  return from.toDateString() === to.toDateString()
    ? `${day.format(from)} ${time.format(from)}–${time.format(to)}`
    : `${day.format(from)} ${time.format(from)} – ${day.format(to)} ${time.format(to)}`
}

/** A date as the Segretario reads it: "lun 26/10/2026, 10:42", in the user's time. */
export function formatDateTime(iso: string, locale = MODEL_DATES.locale): string {
  const date = new Date(iso)
  return Number.isNaN(date.valueOf()) ? iso : dateFormat(locale, DATE_TIME).format(date)
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

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
const DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
})

/** A day — AAAA-MM-GG, or an instant on its local day — as a short date; what is no date stays as it is. */
export function shortDate(value: string, locale = MODEL_DATES.locale): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat(locale, SHORT_DATE).format(date)
}

/**
 * A day kept as AAAA-MM-GG, written as every date the tools give is:
 * "mar 10/11/2026", its weekday beside it.
 */
export function dayWithWeekday(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  return day ? DAY.format(new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : value
}

/**
 * A text as written words, its formatting aside — bold, bullets, spacing,
 * the escapes Markdown puts back when a draft's HTML is read again — so
 * what the Segretario wrote can be told apart from what the user changed.
 */
export function comparableText(text: string): string {
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-•*]\s+/gm, '- ')
    .replace(/\s+/g, ' ')
    .trim()
}
