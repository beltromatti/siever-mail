import { z } from 'zod'

import { clip } from './tools/format'
import { triageRequest, type TriageMessage } from './triage'

/** What the model hands back for a reply prepared ahead. */
export const READY_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['testo', 'dubbi'],
  properties: {
    testo: { type: 'string' },
    dubbi: { type: 'string' }
  }
} as const

const readyDraftAnswer = z.object({
  testo: z.string().trim().min(1),
  dubbi: z.string().trim()
})

export function parseReadyDraft(content: string): { text: string; doubts: string } {
  const answer = readyDraftAnswer.parse(JSON.parse(content))
  return { text: answer.testo, doubts: clip(answer.dubbi.replace(/\s+/g, ' '), 400).text }
}

/**
 * What the model reads to prepare a reply: what triage reads of the
 * conversation, what the note made of the message, and some of the user's
 * own replies to the same person — how they write to them.
 */
export function readyDraftRequest(input: {
  today: Date
  accountEmail: string
  accountName: string
  accountNote: string | null
  people: ReadonlyArray<{ path: string; content: string }>
  note: { summary: string; due: string | null }
  thread: ReadonlyArray<TriageMessage>
  examples: ReadonlyArray<{ date: string; subject: string; text: string }>
}): string {
  const context = triageRequest({
    today: input.today,
    accountEmail: input.accountEmail,
    accountName: input.accountName,
    accountNote: input.accountNote,
    fromUser: false,
    people: input.people,
    open: [],
    thread: input.thread
  })
    .replace('▶ IL MESSAGGIO DA ANNOTARE', '▶ IL MESSAGGIO A CUI RISPONDERE')
    .replace(/\n\n## Cose già aperte in questa conversazione\n\nNessuna\./, '')

  const examples =
    input.examples.length > 0
      ? input.examples
          .map(
            (example) =>
              `### ${example.date} · Oggetto: ${example.subject || '(senza oggetto)'}\n${clip(example.text.trim(), 1500).text}`
          )
          .join('\n\n')
      : 'Nessuna: a questa persona non ha ancora scritto da questo account.'

  return [
    context,
    `## Cosa chiede, secondo la tua nota\n\n${input.note.summary}${input.note.due ? ` (entro ${input.note.due})` : ''}`,
    `## Come l'utente ha scritto a questa persona\n\n${examples}`
  ].join('\n\n')
}
