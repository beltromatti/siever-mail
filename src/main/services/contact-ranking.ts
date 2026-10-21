import type { MailContactSuggestion } from '@shared/models'
import { foldSearchText } from '@shared/search'

/** A stored contact, as the suggestions weigh it. */
export interface ContactCandidate {
  /** The address lowercased: the contact's identity. */
  key: string
  address: string
  name: string | null
  /** Messages the user wrote to it. */
  usageCount: number
  /** When the user last wrote to it, or when it was learned. */
  lastUsedAt: number
  /** The newest message it sent the user, or null when it never did. */
  lastReceivedAt: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Where in a name or an address its words start: "f.fuschini@siever.it" has five. */
const ADDRESS_WORD_BOUNDARY = /[.@_+-]+/
const NAME_WORD_BOUNDARY = /[\s'’.,()"-]+/

function words(value: string, boundary: RegExp): string[] {
  return value.split(boundary).filter(Boolean)
}

/**
 * How well `candidate` answers the query, as Outlook's and Gmail's
 * suggestions match: 2 when its address or its whole name starts with what
 * was typed, 1 when every typed word starts one of its words — "rossi" and
 * "rossi ma" find "Mario Rossi", "fuschini" and "siever" find
 * f.fuschini@siever.it — and 0 when it does not match. Letters inside a
 * word are not a match: they found everyone.
 */
function matchTier(query: string, queryWords: string[], candidate: ContactCandidate): number {
  const name = candidate.name ? foldSearchText(candidate.name) : ''

  if (candidate.key.startsWith(query) || (name && name.startsWith(query))) {
    return 2
  }

  const addressWords = words(candidate.key, ADDRESS_WORD_BOUNDARY)
  const nameWords = words(name, NAME_WORD_BOUNDARY)
  const startsAWord = (queryWord: string, of: string[]): boolean =>
    of.some((word) => word.startsWith(queryWord))

  return queryWords.every((queryWord) => startsAWord(queryWord, nameWords)) ||
    queryWords.every((queryWord) => startsAWord(queryWord, addressWords))
    ? 1
    : 0
}

/**
 * The people written to come first, the most and latest written to before
 * the rest; then the people only heard from, the latest first. A good match
 * outweighs a little use, not a lot of it.
 */
function score(tier: number, candidate: ContactCandidate, now: number): number {
  const written = candidate.usageCount > 0
  const lastActivity = written ? candidate.lastUsedAt : (candidate.lastReceivedAt ?? 0)
  const age = now - lastActivity
  const recency = age < 30 * DAY_MS ? 8 : age < 365 * DAY_MS ? 4 : 0

  return tier * 30 + (written ? 45 + Math.min(candidate.usageCount, 25) : 0) + recency
}

/** Whether `a` and `b` differ by one letter added, dropped, changed or two swapped. */
export function isOneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) {
    return false
  }

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1
  }

  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  const restA = a.slice(start, endA)
  const restB = b.slice(start, endB)

  return (
    restA.length + restB.length === 1 ||
    (restA.length === 1 && restB.length === 1) ||
    (restA.length === 2 && restB.length === 2 && restA[0] === restB[1] && restA[1] === restB[0])
  )
}

function splitAddress(key: string): [string, string] {
  const at = key.lastIndexOf('@')
  return [key.slice(0, at), key.slice(at + 1)]
}

/**
 * Whether `candidate` reads as a slip of the keyboard for `other`: the same
 * mailbox at a domain one letter off — "f.fuschini@sievr.it" against
 * "f.fuschini@siever.it" — where `other` has written to the user and
 * `candidate` never has. Two real mailboxes a letter apart both write, and
 * both stay.
 */
export function isMistypedAddressOf(candidate: ContactCandidate, other: ContactCandidate): boolean {
  if (candidate.lastReceivedAt !== null || other.lastReceivedAt === null) {
    return false
  }

  const [localPart, domain] = splitAddress(candidate.key)
  const [otherLocalPart, otherDomain] = splitAddress(other.key)

  return localPart === otherLocalPart && isOneEditApart(domain, otherDomain)
}

/**
 * The contacts to suggest for `query`, best first: those that match it,
 * without the mistyped copies of a real address (`isMistypedAddressOf`).
 */
export function rankContactSuggestions(
  query: string,
  candidates: ReadonlyArray<ContactCandidate>,
  limit: number,
  now = Date.now()
): MailContactSuggestion[] {
  const folded = foldSearchText(query.trim())
  const queryWords = words(folded, /\s+/)

  if (queryWords.length === 0) {
    return []
  }

  const matching = candidates.flatMap((candidate) => {
    const tier = matchTier(folded, queryWords, candidate)
    return tier > 0 ? [{ candidate, score: score(tier, candidate, now) }] : []
  })

  return matching
    .filter(
      ({ candidate }) => !matching.some((entry) => isMistypedAddressOf(candidate, entry.candidate))
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        Math.max(right.candidate.lastUsedAt, right.candidate.lastReceivedAt ?? 0) -
          Math.max(left.candidate.lastUsedAt, left.candidate.lastReceivedAt ?? 0) ||
        left.candidate.key.localeCompare(right.candidate.key)
    )
    .slice(0, limit)
    .map(({ candidate }) =>
      candidate.name
        ? { name: candidate.name, email: candidate.address }
        : { email: candidate.address }
    )
}
