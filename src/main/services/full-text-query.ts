import { foldSearchText, parseSearchQuery, type SearchFieldScope } from '@shared/search'

/**
 * The columns of the full-text index (`message_fts`) a term scoped to a
 * field looks in; an unscoped one looks in all of them.
 */
const SCOPE_COLUMNS: Readonly<Record<Exclude<SearchFieldScope, 'any'>, string>> = {
  from: 'sender',
  to: 'recipients',
  subject: 'subject'
}

/**
 * The words of a term as the index splits text: on anything that is not a
 * letter or a digit, case and accents folded. "l.rossi@idro.it" is the
 * words l, rossi, idro, it.
 */
export function indexTokens(value: string): string[] {
  return foldSearchText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** One term as an FTS5 phrase: its words in order, the last one a prefix. */
function termExpression(value: string, scope: SearchFieldScope): string | null {
  const tokens = indexTokens(value)

  if (tokens.length === 0) {
    return null
  }

  const phrase = `"${tokens.join(' ')}"*`
  return scope === 'any' ? phrase : `${SCOPE_COLUMNS[scope]} : ${phrase}`
}

/**
 * The app's search grammar (`parseSearchQuery`) as an FTS5 MATCH
 * expression, so the index answers exactly what the search box asks:
 * groups AND'ed, the terms of a group OR'ed, a scoped term confined to its
 * field. Each term matches words that start with what was typed — "preven"
 * finds "preventivo" — the way a word is looked up, not a substring in the
 * middle of one. Null when the query has nothing the index can look for.
 */
export function fullTextMatchExpression(query: string | null | undefined): string | null {
  const groups = parseSearchQuery(query)
    .groups.map((group) => {
      const terms = group.terms
        .map((term) => termExpression(term.value, term.scope))
        .filter((expression): expression is string => expression !== null)

      return terms.length === 0 ? null : terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`
    })
    .filter((expression): expression is string => expression !== null)

  return groups.length === 0 ? null : groups.join(' AND ')
}
