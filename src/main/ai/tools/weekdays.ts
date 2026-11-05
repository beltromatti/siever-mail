import { ToolInputError } from '../agent/tool-types'

/**
 * A day named with its weekday — "mercoledì 10", "martedì 10 novembre",
 * "mar 10/11" — checked against the calendar. The model reckons weekdays
 * itself and now and then wrongly, even with the right one in front of it;
 * what it writes reaches the user, or someone else, as fact.
 */

const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre'
]
const SHORT_WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']

const NAMED = `(${WEEKDAYS.flatMap((day) => (day.endsWith('ì') ? [day, day.slice(0, -1) + 'i'] : [day])).join('|')})`
// Abbreviated only before a day/month, where "mar" can be nothing but Tuesday.
const SHORT = `(${SHORT_WEEKDAYS.join('|')})\\.?(?=\\s+\\d{1,2}\\/\\d)`
const PATTERN = new RegExp(
  `(?<!\\p{L})(?:${NAMED}|${SHORT})\\s+(\\d{1,2})°?` +
    `(?:\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?|\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?)?` +
    // Not a time ("mercoledì 10:30") nor part of a longer number.
    '(?![:.,]?\\d)',
  'giu'
)
// "venerdì 2 riunioni": a count, not a day.
const COUNTED =
  /^\s+(volte|persone|ospiti|riunioni|incontri|appuntamenti|chiamate|messaggi|mail|email|cose|punti|pagine|documenti|giorni|settimane|mesi|anni|minuti|ore(?!\s*\d)|euro|€|%)/i

function weekdayOf(word: string): number {
  const bare = word.toLowerCase().replace(/\.$/, '')
  const short = SHORT_WEEKDAYS.indexOf(bare)
  return short >= 0 ? short : WEEKDAYS.findIndex((day) => day.startsWith(bare.replace(/i$/, '')))
}

/** The date, if it exists: no 31 November. */
function dateOf(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day)
  return date.getMonth() === ((month % 12) + 12) % 12 && date.getDate() === day ? date : null
}

function nearest(dates: Date[], now: Date): Date {
  return dates.reduce((best, date) =>
    Math.abs(date.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())
      ? date
      : best
  )
}

function said(date: Date): string {
  return `il ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} è ${WEEKDAYS[date.getDay()]}`
}

/**
 * The days `text` names with a weekday not their own, each said right.
 * A day with its month is the nearest such day, a year back or ahead; a
 * day alone may be in the last month or the next two — wrong only when
 * none of them falls on that weekday.
 */
export function wrongWeekdays(text: string, now = new Date()): string[] {
  const wrong: string[] = []

  for (const match of text.matchAll(PATTERN)) {
    const [whole, named, short, dayText, slashMonth, slashYear, monthName, namedYear] = match
    const weekday = weekdayOf(named ?? short)
    const day = Number(dayText)
    const month = slashMonth
      ? Number(slashMonth) - 1
      : monthName
        ? MONTHS.indexOf(monthName.toLowerCase())
        : null
    const yearText = slashYear ?? namedYear
    const year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : null

    if (day < 1 || day > 31 || (month !== null && (month < 0 || month > 11))) {
      continue
    }

    if (month === null && COUNTED.test(text.slice((match.index ?? 0) + whole.length))) {
      continue
    }

    const candidates = (
      month === null
        ? [-1, 0, 1, 2].map((offset) => dateOf(now.getFullYear(), now.getMonth() + offset, day))
        : year !== null
          ? [dateOf(year, month, day)]
          : [-1, 0, 1].map((offset) => dateOf(now.getFullYear() + offset, month, day))
    ).filter((date): date is Date => date !== null)

    if (candidates.length === 0) {
      continue
    }

    const meant = month === null ? candidates : [nearest(candidates, now)]

    if (!meant.some((date) => date.getDay() === weekday)) {
      // A day alone is most likely the next one of that number.
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const told =
        month === null
          ? (candidates.find((date) => date >= startOfToday) ?? nearest(candidates, now))
          : meant[0]
      wrong.push(`«${whole.trim()}»: ${said(told)}`)
    }
  }

  return wrong
}

/**
 * Refuses written text that gives a day a weekday not its own, saying the
 * right one: the model corrects it before it is shown, or sent.
 */
export function checkWeekdays(...texts: ReadonlyArray<string | null | undefined>): void {
  const wrong = texts.flatMap((text) => (text ? wrongWeekdays(text) : []))

  if (wrong.length > 0) {
    throw new ToolInputError(
      `Giorno della settimana sbagliato — ${wrong.join('; ')}. Correggi il giorno o la data e riscrivi. Se è chi ti scrive a sbagliarlo, riportalo senza accostare quel giorno alla data («il 10, che chiama mercoledì»).`
    )
  }
}
