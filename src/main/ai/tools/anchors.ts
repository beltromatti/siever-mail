import type { MessageRef } from '@shared/models'

import type { Evidence, MessageAnchor } from '../registry/types'
import { ToolInputError, type ToolContext } from '../agent/tool-types'

export interface ResolvedMessage extends MessageAnchor {
  ref: MessageRef
  dateIso: string
  subject: string
  /** Written by the user, from any of their accounts. */
  direction: 'in' | 'out'
  /** Only in the Trash or Spam. */
  setAside: boolean
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
    throw new ToolInputError(
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
    setAside: location.setAside
  }
}

/** A message given as proof of a change: newer than the decision it overturns, or no proof. */
export async function evidenceOf(
  context: ToolContext,
  handle: string | undefined
): Promise<Evidence | undefined> {
  if (!handle) {
    return undefined
  }

  const message = await resolveMessage(context, handle)
  return { messageKey: message.messageKey, dateIso: message.dateIso }
}
