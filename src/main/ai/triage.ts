import { z } from 'zod'

import type { MailAddress } from '@shared/models'
import type { Commitment, CommitmentKind, NotePriority, NoteState } from '@shared/segretario'

import { clip, formatAddresses, formatDateTime } from './tools/format'

/** How far back triage reads: what arrived in the last two weeks, a holiday included. */
export const TRIAGE_WINDOW_DAYS = 14

const NOTE_STATES = ['da_rispondere', 'da_fare', 'in_attesa', 'informativo', 'rumore'] as const
const PRIORITIES = ['alta', 'media', 'bassa'] as const
const COMMITMENT_KINDS = ['ti_chiedono', 'hai_promesso', 'aspetti', 'da_fare'] as const

/** What the model hands back for one message, as a JSON schema it is held to. */
export const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sintesi',
    'stato',
    'priorita',
    'motivo',
    'scadenza',
    'impegni_nuovi',
    'impegni_chiusi'
  ],
  properties: {
    sintesi: { type: 'string' },
    stato: { type: 'string', enum: NOTE_STATES },
    priorita: { type: 'string', enum: PRIORITIES },
    motivo: { type: 'string' },
    scadenza: { type: ['string', 'null'] },
    impegni_nuovi: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'testo', 'scadenza'],
        properties: {
          tipo: { type: 'string', enum: COMMITMENT_KINDS },
          testo: { type: 'string' },
          scadenza: { type: ['string', 'null'] }
        }
      }
    },
    impegni_chiusi: { type: 'array', items: { type: 'integer' } }
  }
} as const

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date only when it is one: the model's "venerdì" or "" says nothing a view can sort by. */
const dueDay = z
  .string()
  .nullable()
  .transform((value) => (value && ISO_DAY.test(value.trim()) ? value.trim() : null))

const triageAnswer = z.object({
  sintesi: z.string().trim().min(1),
  stato: z.enum(NOTE_STATES),
  priorita: z.enum(PRIORITIES),
  motivo: z.string().trim(),
  scadenza: dueDay,
  impegni_nuovi: z.array(
    z.object({ tipo: z.enum(COMMITMENT_KINDS), testo: z.string().trim().min(1), scadenza: dueDay })
  ),
  impegni_chiusi: z.array(z.number().int())
})

export interface TriageResult {
  summary: string
  state: NoteState
  priority: NotePriority
  reason: string
  due: string | null
  opened: Array<{ kind: CommitmentKind; text: string; due: string | null }>
  closed: number[]
}

/** The model's answer, checked: what the views will show must be what they expect. */
export function parseTriage(content: string): TriageResult {
  const answer = triageAnswer.parse(JSON.parse(content))

  return {
    summary: clip(answer.sintesi.replace(/\s+/g, ' '), 240).text,
    state: answer.stato,
    priority: answer.priorita,
    reason: clip(answer.motivo.replace(/\s+/g, ' '), 300).text,
    due: answer.scadenza,
    opened: answer.impegni_nuovi.map((item) => ({
      kind: item.tipo,
      text: clip(item.testo.replace(/\s+/g, ' '), 240).text,
      due: item.scadenza
    })),
    closed: answer.impegni_chiusi
  }
}

export interface TriageMessage {
  date: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  /** Its own words, without the quoted history. */
  text: string
  /** The message the note is for: the last of those given. */
  target: boolean
}

const KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  ti_chiedono: 'gli chiedono',
  hai_promesso: 'ha promesso',
  aspetti: 'aspetta',
  da_fare: 'da fare'
}

/**
 * What the model reads for one message: the day, the account and what is
 * known of it and of the people involved, what is already open in the
 * conversation, and the conversation up to the message.
 */
export function triageRequest(input: {
  today: Date
  accountEmail: string
  accountName: string
  accountNote: string | null
  fromUser: boolean
  people: ReadonlyArray<{ path: string; content: string }>
  open: ReadonlyArray<Commitment>
  thread: ReadonlyArray<TriageMessage>
}): string {
  const today = new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(input.today)
  const sections = [
    `Oggi è ${today}.`,
    `Account: ${input.accountEmail} (${input.accountName}). Il messaggio da annotare è ${
      input.fromUser ? "stato mandato dall'utente" : "arrivato all'utente"
    }.`
  ]

  if (input.accountNote) {
    sections.push(`## Cosa sai di questo account\n\n${clip(input.accountNote, 2500).text}`)
  }

  if (input.people.length > 0) {
    sections.push(
      `## Cosa sai delle persone coinvolte\n\n${input.people
        .map((note) => `### ${note.path}\n${clip(note.content, 1500).text}`)
        .join('\n\n')}`
    )
  }

  sections.push(
    input.open.length > 0
      ? `## Cose già aperte in questa conversazione\n\n${input.open
          .map(
            (item) =>
              `- [${item.id}] l'utente ${KIND_LABELS[item.kind]}: ${item.text}${item.due ? ` (entro ${item.due})` : ''}`
          )
          .join('\n')}`
      : '## Cose già aperte in questa conversazione\n\nNessuna.'
  )

  sections.push(
    `## La conversazione, dal più vecchio\n\n${input.thread
      .map((message) =>
        [
          `### ${message.target ? '▶ IL MESSAGGIO DA ANNOTARE · ' : ''}${formatDateTime(message.date)} · da ${formatAddresses(message.from, 2)} · a ${formatAddresses([...message.to, ...message.cc], 4)}`,
          `Oggetto: ${message.subject || '(senza oggetto)'}`,
          '',
          clip(message.text.trim() || '(nessun testo)', message.target ? 8000 : 3000).text
        ].join('\n')
      )
      .join('\n\n')}`
  )

  return sections.join('\n\n')
}
