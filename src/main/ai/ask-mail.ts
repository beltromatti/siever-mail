import { z } from 'zod'

import { clip } from './tools/format'

/**
 * A period said from today — "questa settimana", "negli ultimi 10 giorni" —
 * kept as said, so a search kept as a folder moves with the days; `nessuno`
 * when the period, if any, is a fixed one (`dal`, `al`).
 */
const RELATIVE_PERIODS = [
  'nessuno',
  'oggi',
  'ieri',
  'questa_settimana',
  'settimana_scorsa',
  'questo_mese',
  'mese_scorso',
  'ultimi_giorni'
] as const

export type RelativePeriod = Exclude<(typeof RELATIVE_PERIODS)[number], 'nessuno'>

/** What the model hands back for a search asked in words: the search tool's own parameters. */
export const ASK_MAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'testo',
    'cartella',
    'account',
    'dal',
    'al',
    'periodo',
    'giorni',
    'non_lette',
    'con_allegati',
    'in_breve'
  ],
  properties: {
    testo: { type: 'string' },
    cartella: { type: ['string', 'null'] },
    account: { type: ['string', 'null'] },
    dal: { type: ['string', 'null'] },
    al: { type: ['string', 'null'] },
    periodo: { type: 'string', enum: RELATIVE_PERIODS },
    giorni: { type: ['integer', 'null'] },
    non_lette: { type: 'boolean' },
    con_allegati: { type: 'boolean' },
    in_breve: { type: 'string' }
  }
} as const

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = z
  .string()
  .nullable()
  .transform((value) => (value && ISO_DAY.test(value.trim()) ? value.trim() : null))
const blank = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null)

const askAnswer = z.object({
  testo: z.string().trim(),
  cartella: blank,
  account: blank,
  dal: day,
  al: day,
  periodo: z.enum(RELATIVE_PERIODS),
  giorni: z.number().int().nullable(),
  non_lette: z.boolean(),
  con_allegati: z.boolean(),
  in_breve: z.string().trim()
})

export interface AskedSearch {
  text: string
  folder: string | null
  account: string | null
  from: string | null
  to: string | null
  /** A period from today, which wins over `from` and `to`; absent in searches kept before there was one. */
  period?: { kind: RelativePeriod; days: number | null } | null
  unreadOnly: boolean
  withAttachments: boolean
  /** What is looked for, in a few words: the list's title. */
  summary: string
}

export function parseAskedSearch(content: string): AskedSearch {
  const answer = askAnswer.parse(JSON.parse(content))

  return {
    text: answer.testo,
    folder: answer.cartella,
    account: answer.account,
    from: answer.dal,
    to: answer.al,
    period:
      answer.periodo === 'nessuno' ||
      (answer.periodo === 'ultimi_giorni' && !(answer.giorni && answer.giorni > 0))
        ? null
        : {
            kind: answer.periodo,
            days: answer.periodo === 'ultimi_giorni' ? answer.giorni : null
          },
    unreadOnly: answer.non_lette,
    withAttachments: answer.con_allegati,
    summary: clip(answer.in_breve.replace(/\s+/g, ' '), 80).text
  }
}

/** What the model reads: the day, the user's accounts, and the request as typed. */
export function askMailRequest(input: {
  today: Date
  accounts: ReadonlyArray<string>
  question: string
}): string {
  return [
    `Oggi è ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(input.today)} (${input.today.toISOString().slice(0, 10)}).`,
    `Gli account dell'utente: ${input.accounts.join(', ')}.`,
    `La richiesta: ${clip(input.question.trim(), 1000).text}`
  ].join('\n')
}

/** A day as the search takes it: AAAA-MM-GG, local. */
function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The days a search covers on `today`: its period from today if it has one, else its fixed dates. */
export function searchPeriod(
  search: Pick<AskedSearch, 'from' | 'to' | 'period'>,
  today: Date
): { from: string | null; to: string | null } {
  const period = search.period

  if (!period) {
    return { from: search.from, to: search.to }
  }

  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  // The week begins on Monday.
  const monday = d - ((today.getDay() + 6) % 7)

  switch (period.kind) {
    case 'oggi':
      return { from: localDay(today), to: localDay(today) }
    case 'ieri':
      return { from: localDay(new Date(y, m, d - 1)), to: localDay(new Date(y, m, d - 1)) }
    case 'questa_settimana':
      return { from: localDay(new Date(y, m, monday)), to: localDay(today) }
    case 'settimana_scorsa':
      return {
        from: localDay(new Date(y, m, monday - 7)),
        to: localDay(new Date(y, m, monday - 1))
      }
    case 'questo_mese':
      return { from: localDay(new Date(y, m, 1)), to: localDay(today) }
    case 'mese_scorso':
      return { from: localDay(new Date(y, m - 1, 1)), to: localDay(new Date(y, m, 0)) }
    case 'ultimi_giorni':
      return { from: localDay(new Date(y, m, d - (period.days ?? 1) + 1)), to: localDay(today) }
  }
}

/** A period from today in words, for the line that says how a list searches. */
export function periodWords(period: NonNullable<AskedSearch['period']>): string {
  switch (period.kind) {
    case 'oggi':
      return 'oggi'
    case 'ieri':
      return 'ieri'
    case 'questa_settimana':
      return 'questa settimana'
    case 'settimana_scorsa':
      return 'la settimana scorsa'
    case 'questo_mese':
      return 'questo mese'
    case 'mese_scorso':
      return 'il mese scorso'
    case 'ultimi_giorni':
      return period.days === 1 ? "nell'ultimo giorno" : `negli ultimi ${period.days} giorni`
  }
}
