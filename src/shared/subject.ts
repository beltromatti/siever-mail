import { defineMessages, LANGUAGES, messagesIn, type Language } from './i18n'

/**
 * The key a message is ordered by when the list is sorted by subject.
 *
 * Sorting on the subject as stored put "Re: offerta" nowhere near
 * "Offerta", and every capitalised subject ahead of every lower-case one —
 * SQLite compares bytes. Mail clients sort a subject by what it is about:
 * the reply and forward prefixes each client adds, in its own language
 * ("Re:", "R:", "I:", "Fwd:", "AW:", "WG:", …) and the bracketed tags
 * gateways insert ("[External]") are stripped, however many are stacked,
 * and case and accents are folded away. A reply then sorts right beside the
 * message it answers.
 */

const NO_SUBJECT = defineMessages({
  label: { en: '(No subject)', it: '(Senza oggetto)', de: '(Kein Betreff)' }
})

/**
 * What a message without a subject is listed as, in `language`: stored so
 * as the message is read, in the language of that moment.
 */
export function emptySubjectLabel(language: Language): string {
  return messagesIn(NO_SUBJECT, language).label
}

/** Whether a subject is the placeholder of a message without one, in any language. */
export function isEmptySubjectLabel(subject: string): boolean {
  const trimmed = subject.trim()
  return LANGUAGES.some((language) => emptySubjectLabel(language) === trimmed)
}

/**
 * The prefixes clients put before a subject they reply to, and before one
 * they forward, language by language — each written once, lower case, for
 * a pattern that takes any case. Some say either ("VS" is a Finnish reply
 * and a Danish forward), or not always one ("Rif:"): those only ever go
 * when a subject is sorted, and never stand for a reply or a forward.
 */
const REPLY_PREFIXES = [
  're', // Latin, everywhere; RE in Outlook
  'r', // Italian Outlook
  'aw', // German (Antwort)
  'antw', // Dutch
  'sv', // Danish, Norwegian, Swedish (svar)
  'res', // Portuguese (resposta)
  'odp', // Polish (odpowiedź)
  'ynt', // Turkish (yanıt)
  'atb' // Latvian (atbilde)
]
const FORWARD_PREFIXES = [
  'fwd',
  'fw',
  'i', // Italian Outlook (inoltrato)
  'inoltro',
  'inoltra',
  'inoltrato',
  'wg', // German (weitergeleitet)
  'wtr', // Dutch (doorgestuurd, Outlook's abbreviation)
  'doorst', // Dutch
  'tr', // French (transféré)
  'enc', // Portuguese (encaminhado)
  'rv', // Spanish (reenviado)
  'vb', // Swedish (vidarebefordrat)
  'vl', // Finnish (välitetty)
  'pd', // Polish (przekazanie dalej)
  'ilt' // Turkish (iletilen)
]
const EITHER_PREFIXES = [
  'vs', // Finnish reply (vastaus), Danish and Norwegian forward (videresendt)
  'ref',
  'rif' // Italian (riferimento): a reply in some clients, a reference typed by hand in others
]

/** A prefix, with the counter some clients add ("RE[2]:", "Re(3):") and the colon; `：` is the full-width one. */
function prefixPattern(words: ReadonlyArray<string>): string {
  return `(?:${words.join('|')})(?:\\[\\d+\\]|\\(\\d+\\))?\\s*[:\\uFF1A]`
}

const REPLY_PATTERN = new RegExp(`^\\s*${prefixPattern(REPLY_PREFIXES)}`, 'iu')
const FORWARD_PATTERN = new RegExp(`^\\s*${prefixPattern(FORWARD_PREFIXES)}`, 'iu')

/**
 * The prefixes a reply and a forward are given, in the language they are
 * written in, as that language's clients write them: "Re:" and "Fwd:" in
 * English and Italian, "AW:" and "WG:" in German. Each is among the ones
 * known when the subject comes back.
 */
const PREFIXES = defineMessages({
  reply: { en: 'Re:', it: 'Re:', de: 'AW:' },
  forward: { en: 'Fwd:', it: 'Fwd:', de: 'WG:' }
})

/**
 * The subject of a reply, and of a forward, written in `language`: the
 * prefix once — a subject that already has one, in whatever language its
 * client wrote it ("Re:", "AW:", "R:", "WG:", "I:"), keeps it as it is —
 * and nothing of the placeholder a message without a subject is listed as,
 * which is not its subject.
 */
export function replySubject(subject: string, language: Language): string {
  return withPrefix(messagesIn(PREFIXES, language).reply, REPLY_PATTERN, subject)
}

export function forwardSubject(subject: string, language: Language): string {
  return withPrefix(messagesIn(PREFIXES, language).forward, FORWARD_PATTERN, subject)
}

function withPrefix(prefix: string, already: RegExp, subject: string): string {
  const own = isEmptySubjectLabel(subject) ? '' : subject.trim()

  if (already.test(own)) {
    return own
  }

  return `${prefix} ${own}`.trim()
}

/** One leading prefix: a reply/forward marker or a short bracketed tag. */
const SUBJECT_PREFIX_PATTERN = new RegExp(
  `^\\s*(?:${prefixPattern([...REPLY_PREFIXES, ...FORWARD_PREFIXES, ...EITHER_PREFIXES])}|\\[[^\\]]{1,40}\\])\\s*`,
  'iu'
)

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

/**
 * Beyond the prefixes, a subject sorts by its first letter or digit: the
 * quotes, brackets and symbols it may open with ("\"Offerta\"", "(Urgente)",
 * "$5 di sconto") do not file it apart. A message without a subject — the
 * placeholder in any language, or a reply to one — sorts with the others
 * like it, first.
 */
export function subjectSortKey(subject: string): string {
  const stripped = stripSubjectPrefixes(subject)

  if (!stripped || isEmptySubjectLabel(stripped)) {
    return ''
  }

  const folded = stripped
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  // A subject of nothing but symbols keeps them.
  return folded.replace(/^[^\p{L}\p{N}]+/u, '') || folded
}
