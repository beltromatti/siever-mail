import type { PrismaClient } from '@prisma/client'

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

/** A number short enough to be part of everything is looked up only on its own. */
const MIN_NUMBER_DIGITS = 3
/** The words written around a number a search widens to, the most used first. */
const MAX_NUMBER_WORDS = 30

/**
 * One term as an FTS5 phrase: its words in order, the last one a prefix. A
 * number on its own matches also the words of the index it is written in
 * (`numberWords`).
 */
function termExpression(
  value: string,
  scope: SearchFieldScope,
  numberWords: ReadonlyMap<string, ReadonlyArray<string>>
): string | null {
  const tokens = indexTokens(value)

  if (tokens.length === 0) {
    return null
  }

  const inColumn = (phrase: string): string =>
    scope === 'any' ? phrase : `${SCOPE_COLUMNS[scope]} : ${phrase}`
  const phrases = [
    `"${tokens.join(' ')}"*`,
    ...(tokens.length === 1 ? (numberWords.get(tokens[0]) ?? []) : []).map((word) => `"${word}"`)
  ].map(inColumn)

  return phrases.length === 1 ? phrases[0] : `(${phrases.join(' OR ')})`
}

/**
 * The numbers a query looks for on their own — "2463" — which the index
 * holds whole only where they stand apart: in a code ("Ord2463") the word
 * is the code. Their words are looked up with `numberWords`.
 */
export function queryNumbers(query: string | null | undefined): string[] {
  return [
    ...new Set(
      parseSearchQuery(query)
        .groups.flatMap((group) => group.terms)
        .map((term) => indexTokens(term.value))
        .filter((tokens) => tokens.length === 1 && /^\d+$/.test(tokens[0]))
        .map(([digits]) => digits)
        .filter((digits) => digits.length >= MIN_NUMBER_DIGITS)
    )
  ]
}

/**
 * The words of the index a number is written in after letters — "ord2463"
 * and "ord24630" for 2463, as a word is looked up from its start — the most
 * used first: a code is found by its number. Read from the index's
 * vocabulary (`message_fts_vocab`); a hash with the number somewhere in its
 * middle is not a word that writes it.
 */
export async function numberWords(prisma: PrismaClient, digits: string): Promise<string[]> {
  const written = new RegExp(`^\\p{L}+${digits}\\d*\\p{L}*$`, 'u')
  const rows = await prisma.$queryRawUnsafe<Array<{ term: string }>>(
    'SELECT term FROM message_fts_vocab WHERE term GLOB ? ORDER BY doc DESC, term',
    `*${digits}*`
  )

  return rows
    .map((row) => row.term)
    .filter((term) => written.test(term))
    .slice(0, MAX_NUMBER_WORDS)
}

/**
 * The app's search grammar (`parseSearchQuery`) as an FTS5 MATCH
 * expression, so the index answers exactly what the search box asks:
 * groups AND'ed, the terms of a group OR'ed, a scoped term confined to its
 * field. Each term matches words that start with what was typed — "preven"
 * finds "preventivo" — the way a word is looked up, not a substring in the
 * middle of one. Null when the query has nothing the index can look for.
 */
export function fullTextMatchExpression(
  query: string | null | undefined,
  numberWords: ReadonlyMap<string, ReadonlyArray<string>> = new Map()
): string | null {
  const groups = parseSearchQuery(query)
    .groups.map((group) => {
      const terms = group.terms
        .map((term) => termExpression(term.value, term.scope, numberWords))
        .filter((expression): expression is string => expression !== null)

      return terms.length === 0 ? null : terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`
    })
    .filter((expression): expression is string => expression !== null)

  return groups.length === 0 ? null : groups.join(' AND ')
}
