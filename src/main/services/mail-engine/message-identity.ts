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
 *   • `m:` the Message-ID header, which a sender writes once per message —
 *     and `m:…#…` for a different message carrying one the account already
 *     knows, as some programs write (see `settleIdentity`);
 *   • `h:` for a message with neither, a digest of what tells it apart.
 * Keys are scoped to their account by the tables that hold them. A message
 * keeps the key it was first stored under, wherever it goes and however
 * often its rows are stored anew.
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

/** Whether a key is made of a Message-ID — the only kind another message can claim too. */
export function isMessageIdKey(messageKey: string): boolean {
  return messageKey.startsWith('m:')
}

/**
 * What tells a message from a different one carrying the same Message-ID,
 * from what every copy of it says alike — the copy the sender's program
 * filed in Sent, the one delivered back to the sender in copy, the one a
 * server saved besides: its Date header, sender and subject. Copies differ
 * in size and in when the server took them in (INTERNALDATE), so neither
 * can tell them apart.
 */
export function contentDigest(input: {
  /** The Date header, as `fetchedIdentityClaim` reads it. */
  sentAt?: string
  from: ReadonlyArray<MailAddress>
  subject: string
}): string {
  return createHash('sha256')
    .update(
      [
        input.sentAt ?? '',
        input.from.map((address) => address.address.toLowerCase()).join(','),
        // Servers fold a long subject in different places.
        input.subject.replace(/\s+/g, ' ').trim()
      ].join('\u0000')
    )
    .digest('hex')
    .slice(0, 16)
}

/**
 * Who a message fetched for the list says it is, from itself alone, with
 * what tells it from another message: the account settles the rest (see
 * `settleIdentity`).
 */
export interface IdentityClaim {
  uid: number
  /** As `messageKeyFor` makes it. */
  messageKey: string
  /** As `threadKeyFor` makes it. */
  threadId: string
  /**
   * The message it replies to, normalised, when it names no References
   * and the server no thread: the conversation is that message's.
   */
  parentMessageId?: string
  /** When the server took it in (INTERNALDATE), as the cache stores it. */
  date: string
  /** As `contentDigest` makes it. */
  digest: string
}

/** A message the account knows under a key: its conversation, and what tells it from another. */
export interface StoredIdentity {
  messageKey: string
  threadId: string
  /**
   * As `contentDigest` makes it: known for every key made of a Message-ID
   * (see `isMessageIdKey`), the one kind another message can claim.
   */
  digest?: string
}

/**
 * The key of a message whose Message-ID a different message already
 * holds — a ticketing system writing one per ticket, a scanner one for
 * every scan: the Message-ID's key, told apart by its `contentDigest`.
 * Null for a key that is not a Message-ID's.
 */
export function distinctMessageKey(
  claim: Pick<IdentityClaim, 'messageKey' | 'digest'>
): string | null {
  return isMessageIdKey(claim.messageKey) ? `${claim.messageKey}#${claim.digest}` : null
}

/**
 * The key and conversation a message is stored under when a folder of its
 * account brings it in. `stored` gives what the account knows under a key:
 * the rows the cache holds of it — or, for a key made of a Message-ID,
 * the message holding it, which is remembered while no folder holds it
 * too (see `message-id-keys.ts`), so a message stored anew — moved by
 * another program, its folder read again — is who it was.
 *   • A Message-ID held by a message with another `contentDigest` makes
 *     this one distinct (`distinctMessageKey`); one with the same digest
 *     is the same email — a copy, a move, its copy in Sent — and shares
 *     its key. A message known under the distinct key already is that one.
 *   • A message the account knows already, under the key settled, is in
 *     the conversation it was filed in.
 *   • A reply that names no References — some clients write only
 *     In-Reply-To — is in the conversation of the message it replies to,
 *     when the account knows it: named after that message, it would start
 *     one of its own.
 */
export function settleIdentity(
  claim: IdentityClaim,
  stored: (messageKey: string) => ReadonlyArray<StoredIdentity>
): { messageKey: string; threadId: string } {
  const distinct = distinctMessageKey(claim)
  const holder = stored(claim.messageKey)[0]
  const messageKey =
    distinct &&
    (stored(distinct).length > 0 || (holder !== undefined && holder.digest !== claim.digest))
      ? distinct
      : claim.messageKey
  const known = stored(messageKey)[0]

  if (known) {
    return { messageKey, threadId: known.threadId }
  }

  const parent = claim.parentMessageId ? stored(`m:${claim.parentMessageId}`)[0] : undefined
  return { messageKey, threadId: parent?.threadId ?? claim.threadId }
}

/** The keys whose stored identities settle `claims` (see `settleIdentity`). */
export function identityLookups(claims: ReadonlyArray<IdentityClaim>): string[] {
  const keys = new Set<string>()

  for (const claim of claims) {
    keys.add(claim.messageKey)
    const distinct = distinctMessageKey(claim)

    if (distinct) {
      keys.add(distinct)
    }

    if (claim.parentMessageId) {
      keys.add(`m:${claim.parentMessageId}`)
    }
  }

  return [...keys]
}

/**
 * Settles messages arriving together, none stored yet, against `stored` —
 * what the account knows under their `identityLookups` — the oldest first
 * (by INTERNALDATE), each settled one counting for those after it: a reply
 * finds its parent in the same batch, and two messages sharing a
 * Message-ID are told apart there as they would be stored one by one. A
 * Message-ID the account knows goes to the message with its digest
 * whatever the order; only one it has never seen goes to the oldest.
 */
export function settleNewcomers(
  claims: ReadonlyArray<IdentityClaim>,
  stored: ReadonlyArray<StoredIdentity>
): Map<number, { messageKey: string; threadId: string }> {
  const known = new Map<string, StoredIdentity[]>()
  const remember = (identity: StoredIdentity): void => {
    const keyed = known.get(identity.messageKey) ?? []
    keyed.push(identity)
    known.set(identity.messageKey, keyed)
  }
  const settled = new Map<number, { messageKey: string; threadId: string }>()

  stored.forEach(remember)

  for (const claim of [...claims].sort((left, right) => left.date.localeCompare(right.date))) {
    const identity = settleIdentity(claim, (messageKey) => known.get(messageKey) ?? [])
    settled.set(claim.uid, identity)
    remember({ ...identity, digest: claim.digest })
  }

  return settled
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
