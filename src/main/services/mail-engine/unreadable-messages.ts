/**
 * A message of a folder the server would not give: it refused to FETCH it
 * — a corrupt item on Microsoft 365 ("BAD Command Argument Error. 11"), a
 * broken file on Dovecot ("NO [SERVERBUG]") — or answered without its
 * envelope, or not at all. It is asked for again at each sync of its
 * folder until it has failed `UNREADABLE_ATTEMPTS` syncs in a row; then it
 * is given up — left out of the cache, the folder synced without it — and
 * asked for again every `UNREADABLE_RETRY_MS`.
 */
export interface UnreadableMessage {
  uid: number
  /** The syncs of its folder it failed in, in a row. */
  failures: number
  /** When a message given up is asked for again; null while it is asked at every sync. */
  retryAt: number | null
}

export const UNREADABLE_ATTEMPTS = 3
export const UNREADABLE_RETRY_MS = 24 * 60 * 60_000

/** Whether a message the server would not give is left out of its folder for now. */
export function isGivenUp(record: UnreadableMessage, now: number): boolean {
  return record.retryAt !== null && record.retryAt > now
}

/** The records of `unread` — messages a sync asked for and did not get — failed once more. */
export function failedAgain(
  records: ReadonlyArray<UnreadableMessage>,
  unread: ReadonlyArray<number>,
  now: number
): UnreadableMessage[] {
  const known = new Map(records.map((record) => [record.uid, record]))

  return [...new Set(unread)].map((uid) => {
    const failures = (known.get(uid)?.failures ?? 0) + 1
    return {
      uid,
      failures,
      retryAt: failures >= UNREADABLE_ATTEMPTS ? now + UNREADABLE_RETRY_MS : null
    }
  })
}

/** What one fetch of a group of messages came to. */
export interface FetchedGroup<T> {
  items: T[]
  /** UIDs asked for that did not come as messages: without their envelope, or not at all. */
  unread: number[]
}

export interface SetApartFetch<T> extends FetchedGroup<T> {
  /** UIDs of the batch not reached within `REFUSED_FETCH_LIMIT` commands: neither stored nor known unreadable. */
  unresolved: number[]
}

/**
 * The FETCH commands one batch may spend setting apart what the server
 * refuses of it: a message refused among a thousand takes about twenty.
 */
export const REFUSED_FETCH_LIMIT = 64

/**
 * Fetches a batch of a folder's messages, setting apart those the server
 * will not give. One message it cannot read makes it refuse the whole
 * FETCH, so a group it refuses is asked for again in halves, down to the
 * messages refused, the others coming meanwhile. `suspects` — messages
 * that failed before — are asked for apart from the others, together, so
 * they do not drag the others down again; those of them the commands do
 * not reach fail once more.
 *
 * A refusal is taken for the messages' only once the server is seen
 * serving the folder: a part of the batch came, or `serving` — asked at
 * the first refusal — says so. A server refusing every command (down for a
 * moment, overloaded) would otherwise cost a command per message and have
 * all of them taken for unreadable: the batch fails instead, with its
 * refusal. `refused` tells a refusal (NO, BAD) from a link that broke,
 * which fails the batch as it is.
 */
export async function fetchSettingApart<T>(
  uids: ReadonlyArray<number>,
  options: {
    suspects: ReadonlySet<number>
    fetch: (uids: number[]) => Promise<FetchedGroup<T>>
    refused: (error: unknown) => boolean
    serving: (refusedUids: number[]) => Promise<boolean>
  }
): Promise<SetApartFetch<T>> {
  const result: SetApartFetch<T> = { items: [], unread: [], unresolved: [] }
  let commands = 0
  let servingSeen = false

  const setApart = async (start: number[], unreached: number[]): Promise<void> => {
    let level = start.length > 0 ? [start] : []

    while (level.length > 0) {
      const next: number[][] = []

      for (const group of level) {
        if (commands >= REFUSED_FETCH_LIMIT) {
          unreached.push(...group)
          continue
        }

        commands += 1

        try {
          const fetched = await options.fetch(group)
          result.items.push(...fetched.items)
          result.unread.push(...fetched.unread)
          servingSeen = true
        } catch (error) {
          if (!options.refused(error)) {
            throw error
          }

          if (!servingSeen) {
            if (!(await options.serving(group))) {
              throw error
            }

            servingSeen = true
          }

          if (group.length === 1) {
            result.unread.push(group[0])
          } else {
            const middle = Math.ceil(group.length / 2)
            next.push(group.slice(0, middle), group.slice(middle))
          }
        }
      }

      level = next
    }
  }

  await setApart(
    uids.filter((uid) => !options.suspects.has(uid)),
    result.unresolved
  )
  await setApart(
    uids.filter((uid) => options.suspects.has(uid)),
    result.unread
  )

  return result
}
