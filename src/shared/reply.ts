import type { MailAddress } from './models'

/** What a reply needs to know about the message it answers. */
export interface RepliedMessage {
  from: ReadonlyArray<MailAddress>
  to: ReadonlyArray<MailAddress>
  cc: ReadonlyArray<MailAddress>
  replyTo: ReadonlyArray<MailAddress>
  messageId?: string
  references: ReadonlyArray<string>
}

export interface ReplyRecipients {
  to: MailAddress[]
  cc: MailAddress[]
}

function addressKey(address: MailAddress): string {
  return address.address.trim().toLowerCase()
}

/** Each address once, in order, leaving out those in `excluded`. */
function uniqueAddresses(
  addresses: ReadonlyArray<MailAddress>,
  excluded: ReadonlySet<string>
): MailAddress[] {
  const seen = new Set(excluded)
  const result: MailAddress[] = []

  for (const address of addresses) {
    const key = addressKey(address)

    if (key && !seen.has(key)) {
      seen.add(key)
      result.push(address)
    }
  }

  return result
}

/**
 * Who a reply goes to, as Outlook, Gmail and Thunderbird decide it.
 *
 *   • A reply goes to the address the sender asked replies to go to
 *     (Reply-To) or, failing that, to the sender.
 *   • A reply to all adds everyone the message went to — To stays To, Cc
 *     stays Cc — except the user, under any of their addresses.
 *   • A reply to a message the user sent themselves goes to the people they
 *     sent it to, not back to themselves; a note to self goes back to self.
 *
 * `ownAddresses` holds every address of every account, lowercased.
 */
export function replyRecipients(
  message: RepliedMessage,
  ownAddresses: ReadonlySet<string>,
  mode: 'sender' | 'all'
): ReplyRecipients {
  const sentByUser = message.from.some((address) => ownAddresses.has(addressKey(address)))

  if (sentByUser) {
    const to = uniqueAddresses(message.to, ownAddresses)
    const cc =
      mode === 'all'
        ? uniqueAddresses(message.cc, new Set([...ownAddresses, ...to.map(addressKey)]))
        : []

    if (to.length > 0) {
      return { to, cc }
    }

    if (cc.length > 0) {
      return { to: cc, cc: [] }
    }

    // A note to self goes back to self.
    return { to: uniqueAddresses(message.from, new Set()), cc: [] }
  }

  const primary = message.replyTo.length > 0 ? message.replyTo : message.from

  if (mode === 'sender') {
    return { to: uniqueAddresses(primary, new Set()), cc: [] }
  }

  const everyone = uniqueAddresses([...primary, ...message.to], ownAddresses)
  const to = everyone.length > 0 ? everyone : uniqueAddresses(primary, new Set())

  return {
    to,
    cc: uniqueAddresses(message.cc, new Set([...ownAddresses, ...to.map(addressKey)]))
  }
}

/**
 * How many earlier messages a reply's References keeps. RFC 5322 asks for
 * the whole chain, but long threads grow headers past what some servers
 * accept; keeping the first message and the latest ones still lets every
 * client place the reply in its thread.
 */
const MAX_REFERENCES = 20

/** The References header of a reply: the thread so far, then the message answered. */
export function replyReferences(message: RepliedMessage): string[] {
  const chain = [...message.references, ...(message.messageId ? [message.messageId] : [])].filter(
    (id, index, all) => id.trim() && all.indexOf(id) === index
  )

  return chain.length > MAX_REFERENCES
    ? [chain[0], ...chain.slice(chain.length - (MAX_REFERENCES - 1))]
    : chain
}
