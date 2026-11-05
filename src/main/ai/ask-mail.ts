/**
 * A period said from today — "questa settimana", "negli ultimi 10 giorni" —
 * kept as said, so a search kept as a folder moves with the days.
 */
export const RELATIVE_PERIODS = [
  'oggi',
  'ieri',
  'questa_settimana',
  'settimana_scorsa',
  'questo_mese',
  'mese_scorso',
  'ultimi_giorni'
] as const

export type RelativePeriod = (typeof RELATIVE_PERIODS)[number]

/** A search asked in words, as the Segretario framed it: what a list shows, and runs again each time. */
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
