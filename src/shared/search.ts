/**
 * Search-query grammar shared between the renderer (highlight matched
 * substrings in the list view) and the main process (translate the same
 * tokens into a Prisma WHERE). Keeping the parser in one place is what
 * guarantees the highlighter and the DB filter never drift apart.
 *
 * Grammar:
 *   • whitespace separates terms; implicit operator between terms is AND
 *   • the literal keyword OR (case-insensitive, ASCII only, surrounded by
 *     whitespace) groups the term immediately before and the term
 *     immediately after into a single alternation
 *   • a double-quoted run becomes a single term whose value is the
 *     literal substring (no further OR/AND parsing inside the quotes)
 *   • a term may be scoped to one field with an `xxx:` prefix — `da:`,
 *     `a:` and `oggetto:` (plus the English `from:` / `to:` / `subject:`).
 *     Unscoped terms still match across every indexed field.
 *
 * Field scoping is what makes "show me only this sender's mail" work:
 * typing a name unscoped matches it in Cc lines and message bodies too,
 * which is exactly the noise the SIEVER team reported when they searched
 * for a colleague and got unrelated threads interleaved.
 *
 * Result shape:
 *   • the query is parsed into an array of AND-groups
 *   • each group is an array of terms that are OR'd against each other
 *   • all comparisons are case-insensitive substring matches
 *
 * Examples:
 *   `foo bar`               → [ [foo], [bar] ]         (foo AND bar)
 *   `foo OR bar`            → [ [foo, bar] ]           (foo OR bar)
 *   `foo OR bar baz`        → [ [foo, bar], [baz] ]    ((foo OR bar) AND baz)
 *   `"foo bar" baz`         → [ [foo bar], [baz] ]     ("foo bar" AND baz)
 *   `da:marconi ikea`       → [ [marconi@from], [ikea] ]
 *   `da:"a. beltrami"`      → [ [a. beltrami@from] ]
 */

/** Which indexed field a term is restricted to. */
export type SearchFieldScope = 'any' | 'from' | 'to' | 'subject'

/** Fields the renderer highlights independently. */
export type SearchHighlightField = 'sender' | 'recipients' | 'subject' | 'body'

export interface SearchTerm {
  /** Literal substring to match, lowercased. */
  value: string
  scope: SearchFieldScope
}

export interface SearchTermGroup {
  /** Terms that should be OR'd against each other inside this group. */
  terms: SearchTerm[]
}

export interface ParsedSearchQuery {
  /** Empty when the input had no usable terms (whitespace only). */
  groups: SearchTermGroup[]
  /** Every term, de-duplicated, regardless of scope. */
  terms: SearchTerm[]
  /**
   * True when at least one term carries an explicit field scope. The UI
   * uses it to explain an empty result set differently — an unscoped
   * multi-term query that found nothing is usually an over-eager AND,
   * while a scoped one is usually just a genuine miss.
   */
  hasScopedTerms: boolean
}

const OR_KEYWORD_PATTERN = /^or$/i

/**
 * Recognised field prefixes. Italian first — the app's UI language — with
 * the English equivalents accepted as aliases because they are what most
 * people have muscle memory for from Gmail and Outlook.
 */
const FIELD_SCOPE_PREFIXES: ReadonlyArray<{ prefix: string; scope: SearchFieldScope }> = [
  { prefix: 'da', scope: 'from' },
  { prefix: 'from', scope: 'from' },
  { prefix: 'mittente', scope: 'from' },
  { prefix: 'a', scope: 'to' },
  { prefix: 'to', scope: 'to' },
  { prefix: 'destinatario', scope: 'to' },
  { prefix: 'oggetto', scope: 'subject' },
  { prefix: 'subject', scope: 'subject' }
]

/** Which highlight fields a given scope is allowed to paint. */
const SCOPE_TO_HIGHLIGHT_FIELDS: Record<SearchFieldScope, ReadonlyArray<SearchHighlightField>> = {
  any: ['sender', 'recipients', 'subject', 'body'],
  from: ['sender'],
  to: ['recipients'],
  subject: ['subject']
}

interface RawToken {
  kind: 'word' | 'phrase'
  value: string
  scope: SearchFieldScope
}

/**
 * Splits a leading `field:` prefix off a raw word. Returns the scope and
 * the remainder. An unknown prefix is left alone so a literal colon in a
 * search term (a message-id, a time, a Windows path) still searches for
 * itself rather than silently matching nothing.
 */
function splitFieldScope(rawValue: string): { scope: SearchFieldScope; value: string } {
  const separatorIndex = rawValue.indexOf(':')

  if (separatorIndex <= 0) {
    return { scope: 'any', value: rawValue }
  }

  const candidatePrefix = rawValue.slice(0, separatorIndex).toLowerCase()
  const match = FIELD_SCOPE_PREFIXES.find((entry) => entry.prefix === candidatePrefix)

  if (!match) {
    return { scope: 'any', value: rawValue }
  }

  return { scope: match.scope, value: rawValue.slice(separatorIndex + 1) }
}

/**
 * Splits the raw query into atomic tokens, honoring double-quoted phrases
 * and `field:` prefixes (including `da:"due parole"`).
 *
 * Unbalanced quotes are tolerated: the unterminated phrase consumes the
 * rest of the input so the user keeps seeing live feedback while they're
 * still typing.
 */
function tokenizeRawQuery(query: string): RawToken[] {
  const tokens: RawToken[] = []
  const text = query
  let index = 0

  const readQuotedPhrase = (start: number): { value: string; nextIndex: number } => {
    const closingIndex = text.indexOf('"', start + 1)
    const phraseEnd = closingIndex === -1 ? text.length : closingIndex

    return {
      value: text.slice(start + 1, phraseEnd).trim(),
      nextIndex: closingIndex === -1 ? text.length : phraseEnd + 1
    }
  }

  while (index < text.length) {
    const char = text[index]

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }

    if (char === '"') {
      const phrase = readQuotedPhrase(index)

      if (phrase.value) {
        tokens.push({ kind: 'phrase', value: phrase.value, scope: 'any' })
      }

      index = phrase.nextIndex
      continue
    }

    let wordEnd = index
    while (wordEnd < text.length) {
      const next = text[wordEnd]
      if (next === ' ' || next === '\t' || next === '\n' || next === '\r' || next === '"') {
        break
      }
      wordEnd += 1
    }

    const rawWord = text.slice(index, wordEnd)
    const { scope, value } = splitFieldScope(rawWord)

    // `da:"alessandro marconi"` — the prefix consumed the word, and the
    // quoted phrase that immediately follows is its value.
    if (scope !== 'any' && !value && text[wordEnd] === '"') {
      const phrase = readQuotedPhrase(wordEnd)

      if (phrase.value) {
        tokens.push({ kind: 'phrase', value: phrase.value, scope })
      }

      index = phrase.nextIndex
      continue
    }

    if (value) {
      tokens.push({ kind: 'word', value, scope })
    }

    index = wordEnd
  }

  return tokens
}

function toSearchTerm(token: RawToken): SearchTerm {
  return { value: token.value.trim().toLowerCase(), scope: token.scope }
}

function isOrKeyword(token: RawToken): boolean {
  return token.kind === 'word' && token.scope === 'any' && OR_KEYWORD_PATTERN.test(token.value)
}

export function parseSearchQuery(rawQuery: string | null | undefined): ParsedSearchQuery {
  const trimmed = (rawQuery ?? '').trim()

  if (!trimmed) {
    return { groups: [], terms: [], hasScopedTerms: false }
  }

  const tokens = tokenizeRawQuery(trimmed)
  const groups: SearchTermGroup[] = []
  let cursor = 0

  while (cursor < tokens.length) {
    const token = tokens[cursor]

    if (isOrKeyword(token)) {
      const previousGroup = groups[groups.length - 1]
      const nextToken = tokens[cursor + 1]

      if (previousGroup && nextToken && !isOrKeyword(nextToken)) {
        previousGroup.terms.push(toSearchTerm(nextToken))
        cursor += 2
        continue
      }

      // Degenerate OR (no previous OR no next valid term): treat the OR
      // as a literal search term so the user still gets some signal
      // back — they almost certainly typed it as a partial query.
      groups.push({ terms: [toSearchTerm(token)] })
      cursor += 1
      continue
    }

    groups.push({ terms: [toSearchTerm(token)] })
    cursor += 1
  }

  // Drop terms that reduced to nothing (a lone `da:`, a `""`), then drop
  // any group left empty by that filtering.
  const usableGroups = groups
    .map((group) => ({ terms: group.terms.filter((term) => term.value.length > 0) }))
    .filter((group) => group.terms.length > 0)

  const seenTermKeys = new Set<string>()
  const terms: SearchTerm[] = []

  for (const group of usableGroups) {
    for (const term of group.terms) {
      const key = `${term.scope}:${term.value}`

      if (!seenTermKeys.has(key)) {
        seenTermKeys.add(key)
        terms.push(term)
      }
    }
  }

  return {
    groups: usableGroups,
    terms,
    hasScopedTerms: terms.some((term) => term.scope !== 'any')
  }
}

/**
 * Terms the renderer should highlight inside a given field. A term scoped
 * to another field is deliberately left out: searching `da:marconi` must
 * not paint "marconi" inside a message body, because the row was not
 * matched on that text.
 */
export function highlightTermsForField(
  parsed: ParsedSearchQuery,
  field: SearchHighlightField
): string[] {
  return parsed.terms
    .filter((term) => SCOPE_TO_HIGHLIGHT_FIELDS[term.scope].includes(field))
    .map((term) => term.value)
}

/**
 * Escapes the special regex metacharacters inside a literal search term so
 * the renderer can build a highlight regex from user input without
 * worrying about accidental quantifiers, anchors, or character classes.
 */
export function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Returns the (start, end) character ranges in `text` that should be
 * highlighted, given the de-duplicated lowercased highlight terms. The
 * matches are merged so overlapping/touching ranges produce a single
 * highlight span — that way the renderer can iterate the result and emit
 * one `<mark>` per range without worrying about nesting.
 *
 * Returns an empty array when there are no terms or no matches.
 */
export function findHighlightRanges(
  text: string,
  highlightTerms: readonly string[]
): Array<{ start: number; end: number }> {
  if (!text || highlightTerms.length === 0) {
    return []
  }

  const lowercased = text.toLowerCase()
  const ranges: Array<{ start: number; end: number }> = []

  for (const term of highlightTerms) {
    if (!term) {
      continue
    }

    let cursor = 0

    while (cursor < lowercased.length) {
      const matchIndex = lowercased.indexOf(term, cursor)
      if (matchIndex === -1) {
        break
      }
      ranges.push({ start: matchIndex, end: matchIndex + term.length })
      cursor = matchIndex + term.length
    }
  }

  if (ranges.length === 0) {
    return []
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end)

  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  return merged
}
