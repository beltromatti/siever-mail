import type { MessageRef } from '@shared/models'
import type { ReviewRequest, WritingRequest } from '@shared/segretario'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { SegretarioMailPort } from '../agent/tool-types'
import { threadMessages } from '../mail-search'
import { reviewRequest } from '../review'
import { clip, formatAddresses, formatDateTime, withoutQuotedHistory } from '../tools/format'
import { nowLine } from './context'
import type { StartingData } from './day'

/** Messages of the conversation answered shown to a writing, the latest. */
const CONVERSATION_SHOWN = 4

/** The conversation a message belongs to, up to it, as the writing and the review read it. */
async function conversationUpTo(
  mail: SegretarioMailPort,
  ref: MessageRef,
  handles: HandleRegistry,
  added: HandleRecord[]
): Promise<string> {
  const message = await mail.readMessage(ref)
  const refs = await threadMessages(
    await mail.searchClient(),
    ref.accountId,
    message.threadId,
    await mail.listFolders(ref.accountId),
    message.date
  )
  const parts: string[] = []

  for (const [index, threadRef] of refs.slice(-CONVERSATION_SHOWN).entries()) {
    const item = await mail.readMessage(threadRef)
    const handle = handles.name(
      { kind: 'message', ref: threadRef, messageKey: item.messageKey },
      added
    )
    const own =
      index === 0 ? { text: item.textForReading } : withoutQuotedHistory(item.textForReading)
    parts.push(
      `### ${handle} · ${formatDateTime(item.date)} · da ${formatAddresses(item.from, 2)}\nOggetto: ${item.subject}\n\n${clip(own.text.trim() || '(nessun testo)', 5000).text}`
    )
  }

  return parts.join('\n\n')
}

/** What a writing in the editor starts from: the request, the text so far, the message answered. */
export async function prepareWriting(
  deps: { mail: SegretarioMailPort },
  request: WritingRequest
): Promise<StartingData> {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const account = (await deps.mail.listAccounts()).find(
    (candidate) => candidate.id === request.accountId
  )
  const sections = [
    nowLine(),
    `## La richiesta\n\n${request.instruction.trim()}`,
    `Scrive da: ${account?.email ?? 'un suo account'} · A: ${request.to.join(', ') || '(nessuno ancora)'} · Oggetto: ${request.subject || '(nessuno)'}`,
    `## Il testo scritto finora\n\n${request.writtenText.trim() || '(vuoto)'}`
  ]

  if (request.selectedText?.trim()) {
    sections.push(
      `## Il passaggio selezionato (riscrivi solo questo)\n\n${request.selectedText.trim()}`
    )
  }

  if (request.replyTo) {
    try {
      sections.push(
        `## La conversazione a cui risponde, fino al messaggio\n\n${await conversationUpTo(deps.mail, request.replyTo, handles, added)}`
      )
    } catch {
      // The message answered left meanwhile: the writing goes on without it.
    }
  }

  return {
    title: `Scrittura · ${request.instruction.trim().slice(0, 60)}`,
    data: sections.join('\n\n'),
    handles: added,
    seen: new Map()
  }
}

/** What a reread before sending starts from: the message as it will go, the one it answers, the days ahead. */
export async function prepareReview(
  deps: { mail: SegretarioMailPort },
  request: ReviewRequest,
  found: ReadonlyArray<string>
): Promise<StartingData> {
  const account = (await deps.mail.listAccounts()).find(
    (candidate) => candidate.id === request.accountId
  )
  let answered: { from: string; date: string; text: string } | null = null

  if (request.replyTo) {
    try {
      const message = await deps.mail.readMessage(request.replyTo)
      answered = {
        from: formatAddresses(message.from, 2),
        date: formatDateTime(message.date),
        text: withoutQuotedHistory(message.textForReading).text
      }
    } catch {
      answered = null
    }
  }

  return {
    title: `Revisione · ${request.subject || 'senza oggetto'}`,
    data: reviewRequest({
      today: new Date(),
      from: account?.email ?? '',
      to: request.to,
      cc: request.cc,
      subject: request.subject,
      attachments: request.attachments,
      writtenText: request.writtenText,
      answered,
      found
    }),
    handles: [],
    seen: new Map()
  }
}

/** What a search asked in words starts from: the question and the accounts. */
export async function prepareSearch(
  deps: { mail: SegretarioMailPort },
  question: string
): Promise<StartingData> {
  const accounts = await deps.mail.listAccounts()
  return {
    title: `Ricerca · ${question.trim().slice(0, 60)}`,
    data: [
      nowLine(),
      `Gli account dell'utente: ${accounts.map((account) => account.email).join(', ')}.`,
      `## La richiesta\n\n${clip(question.trim(), 1000).text}`
    ].join('\n\n'),
    handles: [],
    seen: new Map()
  }
}
