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
  /** For a reminder: what the user waits for, as the notes have it. */
  awaited?: ReadonlyArray<{ text: string; due: string | null }>
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
    .replace(
      '▶ IL MESSAGGIO DA ANNOTARE',
      input.awaited
        ? "▶ L'ULTIMO MESSAGGIO DELL'UTENTE, ANCORA SENZA RISPOSTA"
        : '▶ IL MESSAGGIO A CUI RISPONDERE'
    )
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
    input.awaited
      ? `## Cosa aspetta l'utente, secondo le tue note\n\n${input.awaited
          .map((item) => `- ${item.text}${item.due ? ` (era atteso entro ${item.due})` : ''}`)
          .join('\n')}`
      : `## Cosa chiede, secondo la tua nota\n\n${input.note.summary}${input.note.due ? ` (entro ${input.note.due})` : ''}`,
    `## Come l'utente ha scritto a questa persona\n\n${examples}`
  ].join('\n\n')
}

/** What the model hands back when asked to write while the user writes: the whole text. */
export const WRITING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['testo'],
  properties: { testo: { type: 'string' } }
} as const

const writingAnswer = z.object({ testo: z.string().trim() })

export function parseWriting(content: string): string {
  const text = writingAnswer.parse(JSON.parse(content)).testo

  if (!text) {
    throw new Error('Non ho scritto niente: dimmi in qualche parola cosa vuoi che scriva.')
  }

  return text
}

/**
 * What the model reads when the user asks it to write or rewrite the
 * message in the composer: the conversation answered, if any, the message
 * as it stands, and the request.
 */
export function writingRequest(input: {
  today: Date
  accountEmail: string
  accountName: string
  accountNote: string | null
  people: ReadonlyArray<{ path: string; content: string }>
  subject: string
  to: ReadonlyArray<string>
  thread: ReadonlyArray<TriageMessage> | null
  writtenText: string
  instruction: string
}): string {
  const header = [
    `Oggi è ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(input.today)}.`,
    `L'utente scrive da ${input.accountEmail} (${input.accountName}) a ${input.to.join(', ') || 'nessuno, per ora'}; oggetto: ${input.subject || '(nessuno)'}.`
  ].join('\n')
  const context = input.thread
    ? triageRequest({
        today: input.today,
        accountEmail: input.accountEmail,
        accountName: input.accountName,
        accountNote: input.accountNote,
        fromUser: false,
        people: input.people,
        open: [],
        thread: input.thread
      })
        .replace(/^Oggi è[^\n]*\n\n[^\n]*\n\n/, '')
        .replace('▶ IL MESSAGGIO DA ANNOTARE', '▶ IL MESSAGGIO A CUI SI RISPONDE')
        .replace(/\n*## Cose già aperte in questa conversazione\n\nNessuna\./, '')
    : [
        input.accountNote
          ? `## Cosa sai di questo account\n\n${clip(input.accountNote, 2500).text}`
          : null,
        input.people.length > 0
          ? `## Cosa sai delle persone a cui scrive\n\n${input.people
              .map((note) => `### ${note.path}\n${clip(note.content, 1500).text}`)
              .join('\n\n')}`
          : null
      ]
        .filter(Boolean)
        .join('\n\n')

  return [
    header,
    context,
    `## Il testo scritto finora\n\n${input.writtenText.trim() || '(vuoto)'}`,
    `## La richiesta dell'utente\n\n${input.instruction.trim()}`
  ]
    .filter(Boolean)
    .join('\n\n')
}
