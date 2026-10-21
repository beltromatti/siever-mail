import type { FetchMessageObject } from 'imapflow'

/**
 * Every FETCH answer a command collected, merged per message and split into
 * the messages that were asked for and everything else.
 *
 * imapflow hands back each untagged FETCH response that arrives while a
 * command runs, and servers send ones nobody asked for: Gmail tells every
 * session with the mailbox open that another one just marked a message
 * read, and a server may spread one message's data over several responses.
 * Taken as results, a flags-only answer was stored as a message with no
 * sender, no subject and no size, dated the moment it arrived.
 */
export interface CollectedFetchResults {
  /** The asked-for messages, by UID, each answer's items merged in order. */
  requested: Map<number, FetchMessageObject>
  /**
   * Answers about other messages — in practice their flags, changed by
   * another session. Worth applying, never worth storing as a message.
   */
  unsolicited: FetchMessageObject[]
}

export function collectFetchResults(
  answers: Iterable<FetchMessageObject>,
  requestedUids: ReadonlySet<number>
): CollectedFetchResults {
  const requested = new Map<number, FetchMessageObject>()
  const unsolicited: FetchMessageObject[] = []

  for (const answer of answers) {
    if (typeof answer.uid !== 'number' || !requestedUids.has(answer.uid)) {
      unsolicited.push(answer)
      continue
    }

    const earlier = requested.get(answer.uid)
    // Later answers are newer: what they carry replaces what came before,
    // what they leave out is kept.
    requested.set(answer.uid, earlier ? { ...earlier, ...definedItems(answer) } : answer)
  }

  return { requested, unsolicited }
}

function definedItems(answer: FetchMessageObject): Partial<FetchMessageObject> {
  return Object.fromEntries(
    Object.entries(answer).filter(([, value]) => value !== undefined)
  ) as Partial<FetchMessageObject>
}

/** A UID set as IMAP takes it, in ranges: `1:4,7,9:12`. */
export function formatUidSet(uids: Iterable<number>): string {
  const sorted = [...new Set(uids)].filter((uid) => uid > 0).sort((left, right) => left - right)
  const ranges: string[] = []
  let start = sorted[0]
  let previous = start

  for (const uid of sorted.slice(1)) {
    if (uid === previous + 1) {
      previous = uid
      continue
    }

    ranges.push(start === previous ? String(start) : `${start}:${previous}`)
    start = uid
    previous = uid
  }

  if (start !== undefined) {
    ranges.push(start === previous ? String(start) : `${start}:${previous}`)
  }

  return ranges.join(',')
}
