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
 *
 * Result shape:
 *   • the query is parsed into an array of AND-groups
 *   • each group is an array of literal substring terms that are OR'd
 *     against each other
 *   • all comparisons are case-insensitive substring matches
 *
 * Examples:
 *   `foo bar`             → [ [foo], [bar] ]           (foo AND bar)
 *   `foo OR bar`          → [ [foo, bar] ]             (foo OR bar)
 *   `foo OR bar baz`      → [ [foo, bar], [baz] ]      ((foo OR bar) AND baz)
 *   `"foo bar" baz`       → [ [foo bar], [baz] ]       ("foo bar" AND baz)
 */

export interface SearchTermGroup {
  /** Substrings that should be OR'd against each other inside this group. */
  terms: string[]
}

export interface ParsedSearchQuery {
  /** Empty when the input had no usable terms (whitespace only). */
  groups: SearchTermGroup[]
  /** Flat de-duplicated lowercased list of every term, ready for highlighting. */
  highlightTerms: string[]
}

const OR_KEYWORD_PATTERN = /^or$/i

/**
 * Splits the raw query into atomic tokens, honoring double-quoted phrases.
 * Returned tokens are either:
 *   • { kind: 'word', value: 'foo' }
 *   • { kind: 'phrase', value: 'foo bar' }   (the quotes are stripped)
 *
 * Unbalanced quotes are tolerated: the unterminated phrase consumes the
 * rest of the input so the user keeps seeing live feedback while they're
 * still typing.
 */
function tokenizeRawQuery(query: string): Array<{ kind: 'word' | 'phrase'; value: string }> {
  const tokens: Array<{ kind: 'word' | 'phrase'; value: string }> = []
  const text = query
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }

    if (char === '"') {
      const closingIndex = text.indexOf('"', index + 1)
      const phraseEnd = closingIndex === -1 ? text.length : closingIndex
      const phraseValue = text.slice(index + 1, phraseEnd).trim()

      if (phraseValue) {
        tokens.push({ kind: 'phrase', value: phraseValue })
      }

      index = closingIndex === -1 ? text.length : phraseEnd + 1
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

    const wordValue = text.slice(index, wordEnd)
    if (wordValue) {
      tokens.push({ kind: 'word', value: wordValue })
    }
    index = wordEnd
  }

  return tokens
}

export function parseSearchQuery(rawQuery: string | null | undefined): ParsedSearchQuery {
  const trimmed = (rawQuery ?? '').trim()

  if (!trimmed) {
    return { groups: [], highlightTerms: [] }
  }

  const tokens = tokenizeRawQuery(trimmed)
  const groups: SearchTermGroup[] = []
  let cursor = 0

  while (cursor < tokens.length) {
    const token = tokens[cursor]

    if (token.kind === 'word' && OR_KEYWORD_PATTERN.test(token.value)) {
      const previousGroup = groups[groups.length - 1]
      const nextToken = tokens[cursor + 1]

      if (
        previousGroup &&
        nextToken &&
        !(nextToken.kind === 'word' && OR_KEYWORD_PATTERN.test(nextToken.value))
      ) {
        previousGroup.terms.push(nextToken.value)
        cursor += 2
        continue
      }

      // Degenerate OR (no previous OR no next valid term): treat the OR
      // as a literal search term so the user still gets some signal
      // back — they almost certainly typed it as a partial query.
      groups.push({ terms: [token.value] })
      cursor += 1
      continue
    }

    groups.push({ terms: [token.value] })
    cursor += 1
  }

  const highlightTerms = Array.from(
    new Set(
      groups
        .flatMap((group) => group.terms)
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean)
    )
  )

  return { groups, highlightTerms }
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
  highlightTerms: string[]
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
