import { z } from 'zod'

import { clip } from './tools/format'

/** What the model hands back for a search asked in words: the search tool's own parameters. */
export const ASK_MAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['testo', 'cartella', 'account', 'dal', 'al', 'non_lette', 'con_allegati', 'in_breve'],
  properties: {
    testo: { type: 'string' },
    cartella: { type: ['string', 'null'] },
    account: { type: ['string', 'null'] },
    dal: { type: ['string', 'null'] },
    al: { type: ['string', 'null'] },
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
