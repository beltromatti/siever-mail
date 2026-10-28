import { z } from 'zod'

import { clip } from './tools/format'

/** How many days ahead the calendar given with a message reaches: dates in it are checked against it. */
const CALENDAR_DAYS = 45

/** What the model hands back when it rereads a message before it goes. */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['problemi'],
  properties: { problemi: { type: 'array', items: { type: 'string' } } }
} as const

const reviewAnswer = z.object({ problemi: z.array(z.string().trim()) })

/** The problems found, each a short line; none when it can go as it is. */
export function parseReview(content: string): string[] {
  return reviewAnswer
    .parse(JSON.parse(content))
    .problemi.filter(Boolean)
    .slice(0, 4)
    .map((problem) => clip(problem.replace(/\s+/g, ' '), 240).text)
}

const CALENDAR_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short'
})

/** The days ahead with their weekdays, a week a line: what a "lunedì 4" is checked against. */
function calendar(today: Date): string {
  const days = Array.from({ length: CALENDAR_DAYS }, (_, index) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index)
    return CALENDAR_DAY.format(day)
  })
  const weeks: string[] = []

  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7).join(' · '))
  }

  return weeks.join('\n')
}

/** What the model reads to reread a message: the message as it will go, and the one it answers. */
export function reviewRequest(input: {
  today: Date
  from: string
  to: ReadonlyArray<string>
  cc: ReadonlyArray<string>
  subject: string
  attachments: ReadonlyArray<string>
  writtenText: string
  answered: { from: string; date: string; text: string } | null
}): string {
  return [
    `Oggi è ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(input.today)}.`,
    `## I prossimi giorni\n\n${calendar(input.today)}`,
    [
      '## Il messaggio che sta per partire',
      '',
      `Da: ${input.from}`,
      `A: ${input.to.join(', ') || '(nessuno)'}`,
      input.cc.length > 0 ? `Cc: ${input.cc.join(', ')}` : null,
      `Oggetto: ${input.subject || '(nessuno)'}`,
      `Allegati: ${input.attachments.join(', ') || 'nessuno'}`,
      '',
      clip(input.writtenText.trim() || '(nessun testo)', 8000).text
    ]
      .filter((line) => line !== null)
      .join('\n'),
    input.answered
      ? `## Il messaggio a cui risponde\n\nDa ${input.answered.from}, ${input.answered.date}:\n\n${clip(input.answered.text.trim(), 6000).text}`
      : null
  ]
    .filter(Boolean)
    .join('\n\n')
}
