import type { SearchObject } from 'imapflow'

import type { ParsedSearchQuery, SearchTerm } from '@shared/search'

/**
 * The most matches a server search hands back for one folder — the newest:
 * a word as common as "the" can match a whole mailbox, and the list shows
 * the newest first anyway.
 */
export const SERVER_SEARCH_MATCH_LIMIT = 5_000

/** One term as IMAP criteria, on the term as typed: the server folds text its own way. */
function termCriteria(term: SearchTerm): SearchObject {
  switch (term.scope) {
    case 'from':
      return { from: term.text }
    case 'to':
      return { or: [{ to: term.text }, { cc: term.text }] }
    case 'subject':
      return { subject: term.text }
    case 'any':
    default:
      // Headers and body: what the cache cannot search is the body of a
      // message that was never downloaded.
      return { text: term.text }
  }
}

/**
 * A search as IMAP SEARCH criteria, one set per AND-group of the query,
 * its terms OR'd: an object can hold a single OR, so the groups are asked
 * one by one and their results intersected (see `intersectUids`).
 */
export function imapSearchGroups(parsed: ParsedSearchQuery): SearchObject[] {
  return parsed.groups.map((group) =>
    group.terms.length === 1
      ? termCriteria(group.terms[0])
      : { or: group.terms.map((term) => termCriteria(term)) }
  )
}

/** The UIDs every list holds. */
export function intersectUids(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number[] {
  const kept = new Set(right)
  return left.filter((uid) => kept.has(uid))
}
