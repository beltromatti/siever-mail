import type { MessageRef } from '@shared/models'

import type { Evidence, MessageAnchor } from '../registry/types'
import { ToolInputError, type ToolContext, UnknownHandle } from '../agent/tool-types'

export interface ResolvedMessage extends MessageAnchor {
  ref: MessageRef
  dateIso: string
  subject: string
  /** Written by the user, from any of their accounts. */
  direction: 'in' | 'out'
  /** Only in the Trash or Spam. */
  setAside: boolean
  /** A draft of the user's, not sent. */
  draft: boolean
}

/**
 * The message a short name stands for, with what the registry hangs off
 * it: its key, its conversation, its date, and whether the user wrote it.
 */
export async function resolveMessage(
  context: ToolContext,
  handle: string
): Promise<ResolvedMessage> {
  const message = context.handles.message(handle)

  if (!message) {
    throw new UnknownHandle(
      `Non conosco il messaggio «${handle}»: usa un riferimento (m…) ricevuto da cerca_posta, leggi o dal lavoro che stai facendo.`
    )
  }

  const location = (await context.mail.locate(message.ref.accountId, [message.messageKey])).get(
    message.messageKey
  )

  if (!location) {
    throw new ToolInputError(`Il messaggio «${handle}» non è più nella posta: è stato eliminato.`)
  }

  const own = new Set(
    (await context.mail.listAccounts()).map((account) => account.email.toLowerCase())
  )

  return {
    accountId: message.ref.accountId,
    messageKey: message.messageKey,
    threadId: location.threadId,
    ref: location.ref,
    dateIso: location.dateIso,
    subject: location.subject,
    direction: location.from.some((address) => own.has(address.address.toLowerCase()))
      ? 'out'
      : 'in',
    setAside: location.setAside,
    draft: location.draft
  }
}

/**
 * A message that has come or gone — what a note, a commitment or a reply
 * hangs off — or the refusal, for a draft the user has not sent.
 */
export async function resolveSentOrReceived(
  context: ToolContext,
  handle: string
): Promise<ResolvedMessage> {
  const message = await resolveMessage(context, handle)

  if (message.draft) {
    throw new ToolInputError(
      `«${handle}» è una bozza dell'utente, non ancora mandata: note, cose aperte e risposte sono dei messaggi arrivati o mandati. Se la bozza conta, diglielo, o tienine conto nella cosa aperta del messaggio a cui risponde.`
    )
  }

  return message
}

/** The event a short name stands for, as `calendario` or `leggi` gave it. */
export function resolveEvent(
  context: ToolContext,
  handle: string
): { eventKey: string; title: string } {
  const event = context.handles.event(handle)

  if (!event) {
    throw new UnknownHandle(
      `Non conosco l'evento «${handle}»: usa un riferimento (e…) ricevuto da \`calendario\` o da \`leggi\`.`
    )
  }

  return event
}

/** A message given as proof of a change: newer than the decision it overturns, or no proof. */
export async function evidenceOf(
  context: ToolContext,
  handle: string | undefined
): Promise<Evidence | undefined> {
  if (!handle) {
    return undefined
  }

  // What the user decided changes only with a message that came after: an event proves nothing.
  if (context.handles.event(handle)) {
    throw new ToolInputError(
      `La prova è un messaggio (m…) che mostra il fatto; «${handle}» è un evento. Per aprire una cosa da un evento basta \`evento\`.`
    )
  }

  // A draft proves nothing yet: it has not gone.
  const message = await resolveSentOrReceived(context, handle)
  return { messageKey: message.messageKey, dateIso: message.dateIso }
}
