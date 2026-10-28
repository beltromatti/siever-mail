import { z } from 'zod'

import type { MailAddress } from '@shared/models'
import type { Commitment, CommitmentKind, NotePriority, NoteState } from '@shared/segretario'

import { nameForm, saysAnyName } from './topic-names'
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
    'impegni_chiusi',
    'argomento'
  ],
  properties: {
    sintesi: { type: 'string' },
    argomento: { type: 'string' },
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
  impegni_chiusi: z.array(z.number().int()),
  argomento: z.string().trim()
})

export interface TriageResult {
  summary: string
  state: NoteState
  priority: NotePriority
  reason: string
  due: string | null
  opened: Array<{ kind: CommitmentKind; text: string; due: string | null }>
  closed: number[]
  /** The topic it filed the conversation in: a catalogue key ("T12"), a new one, or none. */
  topic: { key: string } | { create: string } | null
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
      text: clip(withoutKind(item.testo.replace(/\s+/g, ' ')), 240).text,
      due: item.scadenza
    })),
    closed: answer.impegni_chiusi,
    topic: topicAnswer(answer.argomento)
  }
}

/** "Aspetti il riscontro…" under the label "Aspetti": the label says it, the text starts at the thing. */
function withoutKind(text: string): string {
  const rest = text.replace(/^(aspetti|ti chiedono|hai promesso|da fare)\b[\s:,-]*/i, '')
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : text
}

function topicAnswer(value: string): TriageResult['topic'] {
  const created = /^NUOVO\s*:\s*(.+)$/i.exec(value)

  if (created) {
    return { create: clip(created[1].replace(/\s+/g, ' ').trim(), 120).text }
  }

  const key = /^\[?(T\d+)\]?$/i.exec(value)
  return key ? { key: key[1].toUpperCase() } : null
}

interface CatalogEntry {
  title: string
  description: string | null
  current: boolean
  /** In their compared form (see `nameForm`). */
  names: ReadonlyArray<string>
}

function catalogLine(topic: CatalogEntry, index: number): string {
  return `[T${index + 1}] ${topic.title}${topic.description ? ` — ${clip(topic.description.replace(/\s+/g, ' '), 140).text}` : ''}`
}

/**
 * The topics the model files against, as the stable part of its prompt
 * lists them: those in corso. The others keep their key, and are offered
 * with the conversation that names them.
 */
export function topicCatalog(label: string, topics: ReadonlyArray<CatalogEntry>): string {
  const lines = topics.flatMap((topic, index) => (topic.current ? [catalogLine(topic, index)] : []))
  const others = topics.length - lines.length

  return [
    `# ${label} in corso`,
    lines.length > 0 ? lines.join('\n') : '(nessuno, per ora)',
    others > 0
      ? `Ce ne sono altri ${others}, meno recenti, con le loro chiavi: quelli che la conversazione nomina te li indico insieme a lei.`
      : null
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Where in the catalogue are the topics the conversation names — by number, by client, as the extension knows them. */
export function namedTopicIndexes(
  topics: ReadonlyArray<CatalogEntry>,
  thread: ReadonlyArray<{ subject: string; text: string }>
): number[] {
  const text = nameForm(thread.map((message) => `${message.subject}\n${message.text}`).join('\n'))

  return topics.flatMap((topic, index) =>
    topic.names.length > 0 && saysAnyName(text, topic.names) ? [index] : []
  )
}

/** A topic of the catalogue as its line reads, with its key: for those the conversation names. */
export function namedTopicLine(topics: ReadonlyArray<CatalogEntry>, index: number): string {
  return catalogLine(topics[index], index)
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

/** An open thing as the model reads it: its number, its kind as the schema names it, its words. */
function openLine(item: Commitment): string {
  return `- [${item.id}] ${item.kind}: ${item.text}${item.due ? ` (entro ${item.due})` : ''}`
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
  /** The catalogue key of the topic the conversation is already filed in. */
  currentTopic?: { key: string; title: string; byUser: boolean } | null
  /** What is open in the rest of the conversation's topic — a pratica's other conversations. */
  openInTopic?: { title: string; items: ReadonlyArray<Commitment> } | null
  /** Catalogue lines of the topics the conversation names. */
  named?: ReadonlyArray<string>
  topicsLabel?: string
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

  if (input.named && input.named.length > 0) {
    sections.push(
      `## ${input.topicsLabel ?? 'Argomenti'} che la conversazione nomina\n\n${input.named.slice(0, 12).join('\n')}`
    )
  }

  if (input.currentTopic) {
    sections.push(
      input.currentTopic.byUser
        ? `La conversazione è in [${input.currentTopic.key}] ${input.currentTopic.title}, per scelta dell'utente: lasciala lì.`
        : `Finora hai messo la conversazione in [${input.currentTopic.key}] ${input.currentTopic.title}. Se questo messaggio fa capire che è di un altro argomento dell'elenco (nomina la pratica, il cliente, il cantiere), metti quello: la sposto io.`
    )
  }

  sections.push(
    input.open.length > 0
      ? `## Cose già aperte in questa conversazione\n\n${input.open.map(openLine).join('\n')}`
      : '## Cose già aperte in questa conversazione\n\nNessuna.'
  )

  if (input.openInTopic && input.openInTopic.items.length > 0) {
    sections.push(
      `## Cose già aperte in ${input.openInTopic.title}, in altre conversazioni\n\n${input.openInTopic.items.map(openLine).join('\n')}`
    )
  }

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
