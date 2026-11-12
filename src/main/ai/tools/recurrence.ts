import { WEEKDAYS, type EventRecurrence, type Weekday } from '@shared/calendar'

import { ToolInputError } from '../agent/tool-types'
import { MODEL_DATES } from './format'

/**
 * How an event repeats and when it reminds, as the Segretario writes them
 * in `calendario` — `ripeti`, `promemoria` — and reads them in its lines
 * (vision §7.5): the model's words, in Italian, both ways.
 */

/** Every how often, as the model says it; `mai` stops a series repeating. */
const FREQUENCY: Readonly<Record<string, EventRecurrence['frequency'] | 'mai'>> = {
  giorno: 'daily',
  settimana: 'weekly',
  mese: 'monthly',
  anno: 'yearly',
  mai: 'mai'
}

/** Of a monthly rule, which day: the same date, the weekday's place, the weekday last in the month. */
const MONTHLY_BY: Readonly<Record<string, NonNullable<EventRecurrence['monthlyBy']>>> = {
  data: 'day',
  posto: 'weekday',
  ultimo: 'lastWeekday'
}

/** The weekdays as the model writes them, by their first three letters: lun… dom. */
const DAY_NAMES: ReadonlyArray<string> = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']

/** The weekdays' whole names, from Monday. */
const DAY_WORDS: ReadonlyArray<string> = [
  'lunedì',
  'martedì',
  'mercoledì',
  'giovedì',
  'venerdì',
  'sabato',
  'domenica'
]

const PLACE_WORDS: ReadonlyArray<string> = ['primo', 'secondo', 'terzo', 'quarto', 'quinto']

const KEYS = ['ogni', 'ogni_quanti', 'giorni', 'nel_mese', 'fino_al', 'volte'] as const

/** The shape of `ripeti`, for the tool's parameters. */
export const RIPETI_SCHEMA = {
  type: 'object',
  properties: {
    ogni: { type: 'string', enum: Object.keys(FREQUENCY) },
    ogni_quanti: { type: 'integer' },
    giorni: { type: 'array', items: { type: 'string', enum: DAY_NAMES } },
    nel_mese: { type: 'string', enum: Object.keys(MONTHLY_BY) },
    fino_al: { type: 'string' },
    volte: { type: 'integer' }
  },
  required: ['ogni']
} as const

/** A day written AAAA-MM-GG — one that is in the calendar —, at its local midnight. */
function dayOf(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())

  if (!match) {
    return null
  }

  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return day.getDate() === Number(match[3]) ? day : null
}

/** The day an event starts on, at its local midnight: an all-day one's date, a timed one's local day. */
export function startDay(start: string): Date {
  const at = dayOf(start) ?? new Date(start)
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/** A day's weekday, as iCalendar names it. */
export function weekdayOf(day: Date): Weekday {
  return WEEKDAYS[(day.getDay() + 6) % 7]
}

/** Which of its weekday in the month a day is: the 10th, when the 1st is a Wednesday, is the second Tuesday. */
function placeInMonth(day: Date): number {
  return Math.ceil(day.getDate() / 7)
}

/** Whether a day is its weekday's last in the month. */
function lastInMonth(day: Date): boolean {
  return (
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7).getMonth() !== day.getMonth()
  )
}

/** A weekday as the model may write it — «lun», «lunedì», «MO» — or null. */
function weekdayNamed(written: string): Weekday | null {
  const word = written.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const code = WEEKDAYS.find((weekday) => weekday.toLowerCase() === word)
  const named = word.length >= 3 ? DAY_NAMES.indexOf(word.slice(0, 3)) : -1
  return code ?? (named >= 0 ? WEEKDAYS[named] : null)
}

/** A whole number at least 1, as given — or as text —, or null. */
function countOf(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 ? number : null
}

/**
 * How an event repeats, from `ripeti` as the model writes it: the rule;
 * null — `{ "ogni": "mai" }` — for a series that stops repeating;
 * undefined when it says nothing (absent, or null). The rule falls on the
 * event's first time (`start`, AAAA-MM-GG or an instant), and is checked
 * against it so the first time is one it repeats on; null when that is not
 * known here — an instance of a series, whose first time is the series' —
 * and the calendar checks it.
 */
export function recurrenceArg(
  args: Record<string, unknown>,
  start: string | null
): EventRecurrence | null | undefined {
  const written = args.ripeti

  if (written === undefined || written === null || written === false) {
    return undefined
  }

  if (typeof written !== 'object' || Array.isArray(written)) {
    throw new ToolInputError(
      '`ripeti` è un oggetto: per esempio `{"ogni": "settimana", "giorni": ["lun", "gio"], "fino_al": "2026-12-22"}`; `{"ogni": "mai"}` per non ripeterlo più.'
    )
  }

  const rule = written as Record<string, unknown>
  const unknown = Object.keys(rule).filter((key) => !(KEYS as ReadonlyArray<string>).includes(key))

  if (unknown.length > 0) {
    throw new ToolInputError(
      `\`ripeti\` non ha ${unknown.map((key) => `\`${key}\``).join(', ')}: ha ${KEYS.map((key) => `\`${key}\``).join(', ')}.`
    )
  }

  const frequency =
    FREQUENCY[
      String(rule.ogni ?? '')
        .trim()
        .toLowerCase()
    ]

  if (!frequency) {
    throw new ToolInputError(
      '`ripeti.ogni` è `giorno`, `settimana`, `mese` o `anno` — oppure `mai`, per non ripeterlo più.'
    )
  }

  if (frequency === 'mai') {
    if (Object.keys(rule).length > 1) {
      throw new ToolInputError('`{"ogni": "mai"}` sta da solo: l’evento non si ripete più.')
    }

    return null
  }

  const day = start === null ? null : startDay(start)
  const recurrence: EventRecurrence = { frequency, interval: 1 }

  if (rule.ogni_quanti !== undefined) {
    const interval = countOf(rule.ogni_quanti)

    if (interval === null) {
      throw new ToolInputError(
        '`ripeti.ogni_quanti` è un numero intero da 1 in su: 2 con `settimana` è ogni due settimane.'
      )
    }

    recurrence.interval = interval
  }

  if (rule.giorni !== undefined) {
    if (frequency !== 'weekly') {
      throw new ToolInputError('`ripeti.giorni` vale con `"ogni": "settimana"`.')
    }

    const listed = Array.isArray(rule.giorni) ? rule.giorni : [rule.giorni]
    const weekdays = listed.map((name) => weekdayNamed(String(name)))

    if (weekdays.length === 0 || weekdays.some((weekday) => weekday === null)) {
      throw new ToolInputError(
        `\`ripeti.giorni\` sono i giorni della settimana: ${DAY_NAMES.map((name) => `\`${name}\``).join(', ')}.`
      )
    }

    const days = WEEKDAYS.filter((weekday) => weekdays.includes(weekday))

    if (day && !days.includes(weekdayOf(day))) {
      throw new ToolInputError(
        `L’evento comincia di ${DAY_WORDS[WEEKDAYS.indexOf(weekdayOf(day))]}, che non è tra i \`giorni\`: metti \`inizio\` sul primo giorno in cui si ripete.`
      )
    }

    recurrence.weekdays = days
  }

  if (rule.nel_mese !== undefined) {
    const by = MONTHLY_BY[String(rule.nel_mese).trim().toLowerCase()]

    if (frequency !== 'monthly' || !by) {
      throw new ToolInputError(
        '`ripeti.nel_mese` vale con `"ogni": "mese"`: `data` (lo stesso giorno del mese, il 12), `posto` (lo stesso giorno della settimana nello stesso posto, il secondo martedì) o `ultimo` (l’ultimo martedì del mese).'
      )
    }

    const weekday = day ? DAY_WORDS[WEEKDAYS.indexOf(weekdayOf(day))] : ''

    if (day && by === 'weekday' && placeInMonth(day) > 4) {
      throw new ToolInputError(
        `Il ${day.getDate()} è il quinto ${weekday} del mese, che non c’è ogni mese: con \`"nel_mese": "ultimo"\` è l’ultimo ${weekday}.`
      )
    }

    if (day && by === 'lastWeekday' && !lastInMonth(day)) {
      throw new ToolInputError(
        `Il ${day.getDate()} non è l’ultimo ${weekday} del mese: con \`ultimo\`, \`inizio\` va sull’ultimo ${weekday}; altrimenti \`posto\` (il ${PLACE_WORDS[placeInMonth(day) - 1]} ${weekday}).`
      )
    }

    recurrence.monthlyBy = by
  }

  if (rule.fino_al !== undefined && rule.volte !== undefined) {
    throw new ToolInputError(
      '`ripeti` finisce o a una data (`fino_al`) o dopo un numero di volte (`volte`): uno dei due.'
    )
  }

  if (rule.fino_al !== undefined) {
    const until = dayOf(String(rule.fino_al))

    if (!until) {
      throw new ToolInputError('`ripeti.fino_al` è l’ultimo giorno in cui si ripete, AAAA-MM-GG.')
    }

    if (day && until < day) {
      throw new ToolInputError('`ripeti.fino_al` viene prima del giorno in cui l’evento comincia.')
    }

    recurrence.until = String(rule.fino_al).trim()
  }

  if (rule.volte !== undefined) {
    const count = countOf(rule.volte)

    if (count === null) {
      throw new ToolInputError(
        '`ripeti.volte` è quante volte in tutto, la prima compresa: da 1 in su.'
      )
    }

    recurrence.count = count
  }

  return recurrence
}

/** Reminders at most, in minutes before: four weeks. */
const REMINDER_MAX = 4 * 7 * 24 * 60

/**
 * The reminders `promemoria` asks, in minutes before the start — `[]` none
 * —, in order; undefined when it says nothing.
 */
export function remindersArg(args: Record<string, unknown>): number[] | undefined {
  const written = args.promemoria

  if (written === undefined || written === null) {
    return undefined
  }

  const listed = Array.isArray(written) ? written : [written]
  const minutes = listed.map((value) =>
    typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  )

  if (
    minutes.some(
      (value) =>
        typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > REMINDER_MAX
    )
  ) {
    throw new ToolInputError(
      '`promemoria` è una lista di minuti prima dell’inizio, da 0 a 40320 (quattro settimane): `[10]`, `[60, 1440]`; `[]` nessuno.'
    )
  }

  return [...new Set(minutes as number[])].sort((a, b) => a - b)
}

/* ─────────────────────────── the model's words ─────────────────────────── */

const DAY_MONTH = new Intl.DateTimeFormat(MODEL_DATES.locale, { day: 'numeric', month: 'long' })
const DATE = new Intl.DateTimeFormat(MODEL_DATES.locale, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
})

/** «il lunedì», «la domenica»: a weekday among others. */
function withArticle(weekday: Weekday): string {
  return weekday === 'SU' ? 'la domenica' : `il ${DAY_WORDS[WEEKDAYS.indexOf(weekday)]}`
}

/** Words in a list: «a, b e c». */
function listed(words: ReadonlyArray<string>): string {
  return words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} e ${words[words.length - 1]}`
}

/** Italian elides the article before a number said with a vowel: l’1, l’8, l’11. */
function article(date: string, the: 'il' | 'al'): string {
  return /^(1|8|11)(?!\d)/.test(date) ? `${the === 'il' ? 'l’' : 'all’'}${date}` : `${the} ${date}`
}

/**
 * How an event repeats, for the model, from its start: «ogni lunedì e
 * giovedì, fino al 22/12/2026», «ogni mese, l’ultimo venerdì, 10 volte
 * in tutto»; a rule made elsewhere, that it repeats and is changed there.
 */
export function recurrenceWords(recurrence: EventRecurrence | 'other', start: string): string {
  if (recurrence === 'other') {
    return 'si ripete, con una regola che qui non si cambia'
  }

  const day = startDay(start)
  const every = Math.max(1, recurrence.interval)
  const weekday = weekdayOf(day)
  let words: string

  switch (recurrence.frequency) {
    case 'daily':
      words = every === 1 ? 'ogni giorno' : `ogni ${every} giorni`
      break
    case 'weekly': {
      const days = recurrence.weekdays?.length ? recurrence.weekdays : [weekday]
      words =
        every === 1
          ? days.length === 5 && !days.includes('SA') && !days.includes('SU')
            ? 'ogni giorno feriale'
            : `ogni ${listed(days.map((each) => DAY_WORDS[WEEKDAYS.indexOf(each)]))}`
          : `ogni ${every} settimane, ${listed(days.map(withArticle))}`
      break
    }
    case 'monthly': {
      const name = DAY_WORDS[WEEKDAYS.indexOf(weekday)]
      // Sunday is feminine: «la seconda domenica», «l’ultima domenica».
      const female = weekday === 'SU'
      const place = PLACE_WORDS[placeInMonth(day) - 1]
      const on =
        recurrence.monthlyBy === 'weekday'
          ? female
            ? `la ${place.slice(0, -1)}a ${name}`
            : `il ${place} ${name}`
          : recurrence.monthlyBy === 'lastWeekday'
            ? `${female ? 'l’ultima' : 'l’ultimo'} ${name}`
            : `il giorno ${day.getDate()}`
      words = `${every === 1 ? 'ogni mese' : `ogni ${every} mesi`}, ${on}`
      break
    }
    case 'yearly':
      words = `${every === 1 ? 'ogni anno' : `ogni ${every} anni`}, ${article(DAY_MONTH.format(day), 'il')}`
      break
  }

  const until = recurrence.until ? dayOf(recurrence.until) : null
  const end = recurrence.count
    ? `, ${recurrence.count === 1 ? 'una volta' : `${recurrence.count} volte`} in tutto`
    : until
      ? `, fino ${article(DATE.format(until), 'al')}`
      : ''

  return `si ripete ${words}${end}`
}

/** A span of minutes in its largest whole unit: «10 minuti», «2 ore», «1 giorno», «1 settimana». */
function spanWords(minutes: number): string {
  const unit = (count: number, one: string, many: string): string =>
    `${count} ${count === 1 ? one : many}`

  return minutes % 10080 === 0
    ? unit(minutes / 10080, 'settimana', 'settimane')
    : minutes % 1440 === 0
      ? unit(minutes / 1440, 'giorno', 'giorni')
      : minutes % 60 === 0
        ? unit(minutes / 60, 'ora', 'ore')
        : unit(minutes, 'minuto', 'minuti')
}

/**
 * An event's own reminders, for the model: «10 minuti prima e 1 giorno
 * prima», «all’inizio»; of an all-day one — which starts at its midnight —
 * the day and hour they ring, with the minutes they are written as.
 */
export function remindersWords(reminders: ReadonlyArray<number>, allDay: boolean): string {
  if (reminders.length === 0) {
    return 'nessuno'
  }

  const each = [...reminders]
    .sort((a, b) => a - b)
    .map((minutes) => {
      if (minutes === 0) {
        return allDay ? 'a mezzanotte, quando comincia' : 'all’inizio'
      }

      if (!allDay) {
        return `${spanWords(minutes)} prima`
      }

      const days = Math.ceil(minutes / 1440)
      const at = days * 1440 - minutes
      const hour = `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`
      return `${days === 1 ? 'il giorno prima' : `${days} giorni prima`} alle ${hour} (${minutes})`
    })

  return listed(each)
}
