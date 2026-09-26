import type { MailAddress } from './models'

/**
 * Denormalised sender fields.
 *
 * Each message keeps the name its own header gave and the address it came
 * from; the database adds the label it is filed under — one per person as
 * the reader sees them — and orders on that label's key. The spellings one
 * address uses for the same person share a label (`isSameSenderName`), a
 * bare address takes the name that address is known by, and labels that
 * differ only in dress share a key (`senderSortKey`). Sorting the raw
 * `from_json` text, as the list once did, filed every nameless sender apart
 * from the named ones.
 */

/** The name this message's header gives its sender, or the address. */
export function deriveSenderName(from: ReadonlyArray<MailAddress>): string {
  const first = from[0]

  if (!first) {
    return ''
  }

  return first.name?.trim() || first.address.trim()
}

/**
 * Identity of the sender, independent of how they spelled their display
 * name in any given message: "M. Rossi" and "Mario Rossi" writing from
 * the same address are one sender.
 */
export function deriveSenderKey(from: ReadonlyArray<MailAddress>): string {
  return from[0]?.address.trim().toLowerCase() ?? ''
}

/**
 * Whether a header display name says more than the address itself. Plenty
 * of senders put their address in the name slot, or leave it empty; neither
 * is a name worth filing the sender under.
 */
export function isMeaningfulDisplayName(name: string | undefined, address: string): boolean {
  const trimmed = name?.trim() ?? ''
  return trimmed.length > 0 && trimmed.toLowerCase() !== address.trim().toLowerCase()
}

/** What follows a comma after a full name, rather than a given name. */
const NAME_SUFFIXES = new Set([
  'jr',
  'sr',
  'ii',
  'iii',
  'phd',
  'md',
  'dr',
  'ing',
  'arch',
  'avv',
  'dott',
  'geom',
  'prof',
  'rag'
])

/**
 * A name written "Surname, Name" — the form Exchange address books hand
 * out ("Lucci, Vincenzo") — turned the way people say it, so it files with
 * the same person writing as "Vincenzo Lucci". Only when both sides read as
 * a few plain words, and what follows the comma is not a title: "Rossi,
 * Bianchi & Partners" and "Mario Rossi, PhD" stay as they are.
 */
function reorderSurnameFirst(name: string): string {
  const parts = name.split(',')

  if (parts.length !== 2) {
    return name
  }

  const [surname, given] = parts.map((part) => part.trim())
  const plainWords = /^[\p{L}][\p{L}'.\- ]*$/u
  const isShort = (value: string): boolean => value.split(/\s+/).length <= 3

  return surname &&
    given &&
    plainWords.test(surname) &&
    plainWords.test(given) &&
    isShort(surname) &&
    isShort(given) &&
    !NAME_SUFFIXES.has(given.replace(/\./g, ''))
    ? `${given} ${surname}`
    : name
}

/**
 * The key a sender is ordered and grouped by.
 *
 * Ordering on the display label as stored was case- and accent-sensitive —
 * SQLite compares bytes — so every capitalised name sorted ahead of every
 * lower-case address and "Élite" landed after "Zeta". The key folds that
 * away, and with it everything that only dresses a name: punctuation and
 * spacing ("A. Beltrami - SIEVER" and "A.beltrami-SIEVER" are one key), a
 * qualifier in brackets ("Mario Rossi (Ufficio tecnico)"), the quotes some
 * clients add, and the "Surname, Name" order.
 */
export function senderSortKey(label: string): string {
  const folded = label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const words = (value: string): string => value.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const key = words(reorderSurnameFirst(folded.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')))

  // A label that is nothing but a qualifier keeps its words.
  return key || words(folded)
}

/**
 * Words that tie a name to its company rather than name anyone: "Marie
 * from Babbel", "The Calendly Team".
 */
const LINKING_WORDS = new Set(['the', 'from', 'of', 'by', 'via', 'at', 'di', 'da', 'dal', 'per'])

/**
 * Words that name a company's desk, channel or tier rather than anyone —
 * the team, the support line, the receipts, the weekly newsletter — in the
 * two languages the mailbox is read in. "HYPE" and "Team HYPE", "Steam
 * Support" and "Steam Team", "Revolut" and "Revolut Business" are one
 * sender.
 */
const DESK_WORDS = new Set([
  'account',
  'accounts',
  'admin',
  'administrator',
  'ai',
  'alerts',
  'app',
  'billing',
  'bot',
  'business',
  'care',
  'community',
  'customer',
  'daily',
  'digest',
  'help',
  'helpdesk',
  'info',
  'it',
  'mail',
  'marketing',
  'monthly',
  'news',
  'newsletter',
  'noreply',
  'notification',
  'notifications',
  'official',
  'orders',
  'payments',
  'premium',
  'receipts',
  'rewards',
  'sales',
  'security',
  'service',
  'services',
  'shop',
  'store',
  'support',
  'team',
  'updates',
  'weekly',
  'aggiornamenti',
  'amministrazione',
  'assistenza',
  'avvisi',
  'clienti',
  'commerciale',
  'comunicazione',
  'comunicazioni',
  'fatturazione',
  'fatture',
  'informazioni',
  'italia',
  'negozio',
  'notifiche',
  'notizie',
  'ordini',
  'pagamenti',
  'premi',
  'ricevute',
  'riepiloghi',
  'riepilogo',
  'segreteria',
  'servizi',
  'servizio',
  'sicurezza',
  'staff',
  'supporto',
  'ufficiale',
  'ufficio',
  'vendite'
])

/**
 * Whether two names one address has used belong to the same sender.
 *
 * Only the words that identify someone count — not linking or desk words
 * — in any order and however they are spaced. Every word of the shorter
 * name needs a partner in the longer one, either the same word or an
 * initial of it ("M." for "Mario"), and at least one full word is shared.
 * So "Cristian Sangiorgi" matches "Sangiorgi Cristian", "Ing. Cristian
 * Sangiorgi" and "C. Sangiorgi"; "HYPE" matches "Team HYPE" and
 * "internationalweek" "International Week"; while the different people a
 * shared address speaks for — LinkedIn's "Celeste Moro" and "Saba Asim",
 * GitHub's contributors — stay apart.
 *
 * A single word only ever matches itself: "Mario" says too little to be
 * "Mario Rossi" rather than the "Mario Bianchi" the same relay address
 * also carries, and "SIEVER" is not "Mario Rossi - SIEVER". A name that is
 * only a desk ("Amministrazione") is that desk of whoever the other name
 * says ("Amministrazione In-Domus").
 */
export function isSameSenderName(first: string, second: string): boolean {
  const firstWords = senderSortKey(first).split(' ').filter(Boolean)
  const secondWords = senderSortKey(second).split(' ').filter(Boolean)

  if (firstWords.length === 0 || secondWords.length === 0) {
    return false
  }

  const identifying = (words: string[]): string[] =>
    words.filter((word) => !LINKING_WORDS.has(word) && !DESK_WORDS.has(word))
  const firstIdentifying = identifying(firstWords)
  const secondIdentifying = identifying(secondWords)

  if (firstIdentifying.length === 0 || secondIdentifying.length === 0) {
    const [desk, other] =
      firstIdentifying.length === 0 ? [firstWords, secondWords] : [secondWords, firstWords]
    const deskWords = desk.filter((word) => !LINKING_WORDS.has(word))

    return (deskWords.length > 0 ? deskWords : desk).every((word) => other.includes(word))
  }

  if (firstIdentifying.join('') === secondIdentifying.join('')) {
    return true
  }

  const [shorter, longer] =
    firstIdentifying.length <= secondIdentifying.length
      ? [firstIdentifying, secondIdentifying]
      : [secondIdentifying, firstIdentifying]

  if (shorter.length === 1) {
    return false
  }

  // Whole words pair up first, so an initial never takes a word that a
  // whole word needed.
  const unmatched = [...longer]
  const pending: string[] = []

  for (const word of shorter) {
    const index = unmatched.indexOf(word)

    if (index >= 0) {
      unmatched.splice(index, 1)
    } else {
      pending.push(word)
    }
  }

  if (pending.length === shorter.length) {
    return false
  }

  for (const word of pending) {
    const index = unmatched.findIndex(
      (candidate) =>
        (word.length === 1 && candidate.startsWith(word)) ||
        (candidate.length === 1 && word.startsWith(candidate))
    )

    if (index < 0) {
      return false
    }

    unmatched.splice(index, 1)
  }

  return true
}
