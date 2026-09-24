/**
 * The key a message is ordered by when the list is sorted by subject.
 *
 * Sorting on the subject as stored put "Re: offerta" nowhere near
 * "Offerta", and every capitalised subject ahead of every lower-case one —
 * SQLite compares bytes. Mail clients sort a subject by what it is about:
 * the reply and forward prefixes each client adds ("Re:", "R:", "I:",
 * "Fwd:", "AW:", …) and the bracketed tags gateways insert ("[External]")
 * are stripped, however many are stacked, and case and accents are folded
 * away. A reply then sorts right beside the message it answers.
 */

/** One leading prefix: a reply/forward marker or a short bracketed tag. */
const SUBJECT_PREFIX_PATTERN =
  /^\s*(?:(?:re|r|aw|sv|vs|antw|rv|res|ref|fw|fwd|i|inoltra|wg|tr|enc|doorst)(?:\[\d+\])?\s*:|\[[^\]]{1,40}\])\s*/i

export function stripSubjectPrefixes(subject: string): string {
  let remaining = subject

  // Bounded: a hostile subject cannot keep the loop running.
  for (let pass = 0; pass < 20; pass += 1) {
    const next = remaining.replace(SUBJECT_PREFIX_PATTERN, '')

    if (next === remaining) {
      break
    }

    remaining = next
  }

  return remaining.trim()
}

export function subjectSortKey(subject: string): string {
  return stripSubjectPrefixes(subject)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
