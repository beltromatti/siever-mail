import { createHash } from 'node:crypto'

import type { MailAddress } from '@shared/models'

/**
 * Who a message is, whichever folder it sits in.
 *
 * A row of the cache is a message in a folder: the same letter filed under
 * three Gmail labels is three rows, moved to an archive it changes UID. What
 * is learnt about a letter — its body, its words in the index, what the
 * Segretario noted — belongs to the letter, so it hangs off this key:
 *   • `e:` the server's own id for the message across its mailboxes —
 *     Gmail's X-GM-MSGID, or OBJECTID's EMAILID where a server has it;
 *   • `m:` the Message-ID header, which a sender writes once per message;
 *   • `h:` for a message with neither, a digest of what tells it apart.
 * Keys are scoped to their account by the tables that hold them.
 */
export interface MessageIdentityInput {
  emailId?: string
  messageId?: string
  from: ReadonlyArray<MailAddress>
  date: string
  subject: string
  size: number
}

/** A Message-ID as one value: no angle brackets, no spaces, case folded. */
export function normalizeMessageId(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/^<|>$/g, '').trim().toLowerCase()
  return trimmed ? trimmed : null
}

export function messageKeyFor(input: MessageIdentityInput): string {
  const emailId = input.emailId?.trim()

  if (emailId) {
    return `e:${emailId}`
  }

  const messageId = normalizeMessageId(input.messageId)

  if (messageId) {
    return `m:${messageId}`
  }

  const digest = createHash('sha256')
    .update(
      [
        input.from.map((address) => address.address.toLowerCase()).join(','),
        input.date,
        input.subject,
        String(input.size)
      ].join('\u0000')
    )
    .digest('hex')
    .slice(0, 24)

  return `h:${digest}`
}

/** Every Message-ID a header names, in order: `<a@x> <b@y>` → `a@x`, `b@y`. */
export function messageIdsIn(header: string | undefined): string[] {
  if (!header) {
    return []
  }

  return [...header.matchAll(/<([^<>\s]+)>/g)]
    .map((match) => normalizeMessageId(match[1]))
    .filter((id): id is string => id !== null)
}

/**
 * The conversation a message belongs to. Gmail says it (X-GM-THRID), as do
 * servers with THREADID; elsewhere a conversation is named after the
 * message that started it — the first the References header lists, or the
 * one replied to, or the message itself when it starts one — which is how
 * JWZ threading roots a thread, and why every reply in it agrees.
 */
export function threadKeyFor(input: {
  serverThreadId?: string
  references: ReadonlyArray<string>
  inReplyTo?: string
  messageId?: string
  messageKey: string
}): string {
  const serverThreadId = input.serverThreadId?.trim()

  if (serverThreadId) {
    return `t:${serverThreadId}`
  }

  const root =
    normalizeMessageId(input.references[0]) ??
    normalizeMessageId(input.inReplyTo) ??
    normalizeMessageId(input.messageId)

  return root ? `r:${root}` : `k:${input.messageKey}`
}

/**
 * The value of one header in a block of raw header lines, unfolded: a
 * header continued on the next line (starting with a space) is one value.
 */
export function headerValue(
  headers: Buffer | string | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined
  }

  const text = typeof headers === 'string' ? headers : headers.toString('utf8')
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ')
  const prefix = `${name.toLowerCase()}:`

  for (const line of unfolded.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(prefix)) {
      return line.slice(prefix.length).trim()
    }
  }

  return undefined
}
