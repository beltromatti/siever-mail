import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'
import type { ReviewRequest } from '@shared/segretario'

import { messages } from '../../i18n'
import { HandleRegistry, type HandleRecord } from '../agent/handles'
import type { SegretarioMailPort } from '../agent/tool-types'
import { reviewRequest } from '../review'
import { clip, formatAddresses, formatDateTime } from '../tools/format'
import { nowLine } from './context'
import type { StartingData } from './day'

/** The runs' titles, as the user sees them. */
const TITLES = defineMessages({
  review: {
    en: (subject: string | null) => `Review · ${subject ?? 'no subject'}`,
    it: (subject: string | null) => `Revisione · ${subject ?? 'senza oggetto'}`,
    de: (subject: string | null) => `Überprüfung · ${subject ?? 'kein Betreff'}`
  },
  search: {
    en: (question: string) => `Search · ${question}`,
    it: (question: string) => `Ricerca · ${question}`,
    de: (question: string) => `Suche · ${question}`
  }
})

/** The message answered, named for the run to read: who, when, what. */
async function answeredLine(
  mail: SegretarioMailPort,
  ref: MessageRef,
  handles: HandleRegistry,
  added: HandleRecord[]
): Promise<{ handle: string; from: string; date: string; subject: string }> {
  const message = await mail.readMessage(ref)
  return {
    handle: handles.name({ kind: 'message', ref, messageKey: message.messageKey }, added),
    from: formatAddresses(message.from, 2),
    date: formatDateTime(message.date),
    subject: message.subject || '(senza oggetto)'
  }
}

/** What a reread before sending starts from: the message as it will go, and the one it answers, named. */
export async function prepareReview(
  deps: { mail: SegretarioMailPort },
  request: ReviewRequest
): Promise<StartingData> {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const account = (await deps.mail.listAccounts()).find(
    (candidate) => candidate.id === request.accountId
  )
  let answered: Awaited<ReturnType<typeof answeredLine>> | null = null

  if (request.replyTo) {
    try {
      answered = await answeredLine(deps.mail, request.replyTo, handles, added)
    } catch {
      // The message answered left meanwhile: the reread goes on without it.
    }
  }

  return {
    title: messages(TITLES).review(request.subject || null),
    data: reviewRequest({
      now: nowLine(),
      from: account?.email ?? '',
      to: request.to,
      cc: request.cc,
      subject: request.subject,
      attachments: request.attachments,
      writtenText: request.writtenText,
      answered
    }),
    handles: added
  }
}

/** What a search asked in words starts from: the question and the accounts. */
export async function prepareSearch(
  deps: { mail: SegretarioMailPort },
  question: string
): Promise<StartingData> {
  const accounts = await deps.mail.listAccounts()
  return {
    title: messages(TITLES).search(question.trim().slice(0, 60)),
    data: [
      nowLine(),
      `Gli account dell'utente: ${accounts.map((account) => account.email).join(', ')}.`,
      `## La richiesta\n\n${clip(question.trim(), 1000).text}`
    ].join('\n\n'),
    handles: []
  }
}
