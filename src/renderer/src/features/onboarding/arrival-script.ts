import { lexer, type MarkedToken, type Token } from 'marked'

import { dayKey } from '@renderer/features/calendar/calendar-dates'
import {
  setupTurnsAiOn,
  type MemoryNote,
  type OnboardingState,
  type TodayPage
} from '@shared/segretario'

/**
 * The arrival's script (vision §12.2): after which setups it plays, whom it
 * greets, and the sentences of the Segretario's memory it shows while
 * today's letter is written. The memory is the model's, free in its names
 * and its shape (§10): nothing here asks it for a name. The note about the
 * user is looked for among the names it most likely has, in every
 * language, then the next likeliest; without them, the rest.
 */

/**
 * Whether «Entra» of this setup leads through the arrival: one that ran
 * Conoscimi with the AI on — turning it on, at the first start or later,
 * and Conoscimi done again. A connection added with the AI on already goes
 * back to what the user was doing; without the AI there is no memory and
 * no letter.
 */
export function arrivesAfter(state: OnboardingState, aiOn: boolean): boolean {
  return aiOn && state.step === 'entra' && (state.case === 'conoscimi' || setupTurnsAiOn(state))
}

/**
 * Where today's letter stands, for the arrival to wait on it: written today
 * and not being written again; on its way; or none coming — its run failed,
 * or nothing asked for one.
 */
export type LetterState = 'ready' | 'coming' | 'none'

export function letterState(
  page: Pick<TodayPage, 'day' | 'letter' | 'letterAt' | 'letterRewriting'>
): LetterState {
  if (page.letterRewriting) {
    return 'coming'
  }

  // A letter of another day is no letter for today.
  return page.letter !== null &&
    page.letterAt !== null &&
    dayKey(new Date(page.letterAt)) === page.day
    ? 'ready'
    : 'none'
}

/* ─────────────────────────────── the notes, likeliest first ─────────────────────────────── */

/**
 * What the note about the user is likely called — «tu», «you», «du», a
 * profile, «chi sono» — in the app's languages and the next ones a model
 * reaches for: names to look for, not a convention.
 */
const ABOUT_YOU = [
  'tu',
  'you',
  'du',
  'sie',
  'io',
  'me',
  'ich',
  'utente',
  'user',
  'nutzer',
  'benutzer',
  'profilo',
  'profile',
  'profil',
  'chi-sono',
  'about-me',
  'about',
  'uber-mich',
  'ueber-mich',
  'whoami',
  'myself'
]

/** Words that name the user's note within a longer name: «profilo-utente», «user-profile». */
const ABOUT_YOU_WORDS = new Set([
  'utente',
  'user',
  'nutzer',
  'benutzer',
  'profilo',
  'profile',
  'profil'
])

/** How the user writes and works: the next likeliest to say who they are. */
const HOW_YOU_WORK = [
  'stile',
  'style',
  'stil',
  'schreibstil',
  'scrittura',
  'writing',
  'tono',
  'tone',
  'come-scrivo',
  'how-i-write',
  'preferenze',
  'preferences',
  'vorlieben',
  'praferenzen',
  'abitudini',
  'habits',
  'gewohnheiten',
  'lavoro',
  'work',
  'arbeit',
  'come-lavoro',
  'how-i-work',
  'arbeitsweise'
]

const HOW_YOU_WORK_WORDS = new Set(['stile', 'style', 'stil', 'preferenze', 'preferences'])

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** A note's name as compared: its file name, lowercase, without accents, words joined by «-». */
function nameOf(path: string): string {
  return fold(path.split('/').pop() ?? path)
    .replace(/\.md$/, '')
    .replace(/[\s_.]+/g, '-')
}

/**
 * How likely a note is to say who the user is, as a rank to sort by: the
 * note about them, by its likeliest names, then within a longer name; then
 * how they write and work; then the rest — at the root before inside a
 * folder, the latest written first.
 */
function rankOf(note: MemoryNote): number[] {
  const name = nameOf(note.path)
  const words = name.split('-')
  const nested = note.path.includes('/') ? 1 : 0
  const about = ABOUT_YOU.indexOf(name)
  const work = HOW_YOU_WORK.indexOf(name)
  const [tier, order] =
    about >= 0
      ? [0, about]
      : words.some((word) => ABOUT_YOU_WORDS.has(word))
        ? [1, 0]
        : work >= 0
          ? [2, work]
          : words.some((word) => HOW_YOU_WORK_WORDS.has(word))
            ? [3, 0]
            : [4, 0]

  return [tier, nested, order, -note.updatedAt]
}

/** Notes by how likely they are to say who the user is, each with its tier (0–1 the user's own). */
function ranked(notes: ReadonlyArray<MemoryNote>): Array<{ note: MemoryNote; tier: number }> {
  return notes
    .map((note) => ({ note, rank: rankOf(note) }))
    .sort((a, b) => {
      const at = a.rank.findIndex((value, index) => value !== b.rank[index])
      return at < 0 ? a.note.path.localeCompare(b.note.path) : a.rank[at] - b.rank[at]
    })
    .map(({ note, rank }) => ({ note, tier: rank[0] }))
}

/** The notes, the likeliest to say who the user is first. */
export function rankNotes(notes: ReadonlyArray<MemoryNote>): MemoryNote[] {
  return ranked(notes).map(({ note }) => note)
}

/** The note about the user, when it has one of the names it likely has. */
export function aboutYouNote(notes: ReadonlyArray<MemoryNote>): MemoryNote | null {
  const first = ranked(notes)[0]
  return first && first.tier <= 1 ? first.note : null
}

/* ─────────────────────────────── the sentences ─────────────────────────────── */

/** What is not words to show — code, an address of the web or of mail: its sentence goes. */
const HIDDEN = ''

/** What a sentence shown alone may not hold: addresses, code, tables, arrows, markup left over. */
const NOT_ALONE = [
  HIDDEN,
  '@',
  '://',
  'www.',
  '`',
  '|',
  '{',
  '}',
  '<',
  '>',
  '→',
  '->',
  '=>',
  '\\',
  '#'
]

/** A path or a file: «contatti/rossi», «offerta.pdf». */
const PATH = /\p{L}{2,}\/\p{L}{2,}|\.(?:md|pdf|docx?|xlsx?|pptx?|txt|csv|zip|png|jpe?g)\b/iu

/** How long a sentence shown alone may be: enough to say something, short enough to read in a breath. */
const SHORTEST = 30
const LONGEST = 160

/** Titles before a name, which the greeting leaves out: «Dott.», «Ing.», «Dr.», «Herr». */
const TITLES = new Set([
  'dott',
  'dottssa',
  'dr',
  'dssa',
  'ing',
  'arch',
  'avv',
  'geom',
  'prof',
  'rag',
  'sig',
  'sigra',
  'mr',
  'mrs',
  'ms',
  'miss',
  'herr',
  'frau',
  'dipl',
  'mag'
])

/** Words that are an organisation's, not a person's: a mailbox sending as an office or a company. */
const NOT_A_PERSON = new Set([
  'srl',
  'srls',
  'spa',
  'sas',
  'snc',
  'gmbh',
  'ag',
  'kg',
  'ug',
  'ohg',
  'ltd',
  'llc',
  'inc',
  'corp',
  'plc',
  'sa',
  'sarl',
  'bv',
  'nv',
  'studio',
  'ufficio',
  'office',
  'buro',
  'bureau',
  'team',
  'info',
  'amministrazione',
  'administration',
  'verwaltung',
  'segreteria',
  'sekretariat',
  'support',
  'servizio',
  'service',
  'gruppo',
  'group',
  'comune',
  'azienda',
  'company'
])

function inlineText(tokens: ReadonlyArray<Token> | undefined, fallback: string): string {
  if (!tokens) {
    return fallback
  }

  return tokens
    .map((generic) => {
      const token = generic as MarkedToken

      switch (token.type) {
        case 'text':
          return inlineText(token.tokens, token.text)
        case 'strong':
        case 'em':
        case 'del':
          return inlineText(token.tokens, token.text)
        case 'link':
          // A note's link keeps its words; an address written out is an address.
          return token.autolink ||
            token.text === token.href ||
            /^(?:mailto:|https?:|www\.)/i.test(token.text)
            ? HIDDEN
            : inlineText(token.tokens, token.text)
        case 'codespan':
          return HIDDEN
        case 'escape':
          return token.text
        case 'br':
          return ' '
        default:
          // Images, markup, a task's box: not words.
          return ''
      }
    })
    .join('')
}

/** The runs of prose in a note: its paragraphs, each item of its lists, its quotes. */
function proseOf(tokens: ReadonlyArray<Token>, runs: string[]): string[] {
  for (const generic of tokens) {
    const token = generic as MarkedToken

    switch (token.type) {
      case 'paragraph':
      case 'text':
        runs.push(inlineText(token.tokens, token.text))
        break
      case 'list':
        for (const item of token.items) {
          proseOf(item.tokens, runs)
        }
        break
      case 'blockquote':
        proseOf(token.tokens, runs)
        break
      default:
        // Headings, code, tables and rules are not sentences.
        break
    }
  }

  return runs
}

/** A run of prose made plain: wiki links to their words, asides and footnotes left out. */
function plainRun(run: string): string {
  return run
    .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[[^\]]*\]\]/g, HIDDEN)
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/\[([^\]]*)\]/g, '$1')
    .replace(/\s*\([^()]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim()
}

/** Whether what a sentence opens it also closes: an aside, a quote. */
function balanced(sentence: string): boolean {
  const count = (mark: string): number => sentence.split(mark).length - 1
  return count('«') === count('»') && count('(') === count(')') && count('"') % 2 === 0
}

/** A sentence as shown alone — a capital first, a full stop last — or null when it does not read alone. */
function shownAlone(raw: string, locale: string): string | null {
  let sentence = raw.replace(/^[\s\-–—•*+>]+/u, '').trim()

  if (
    NOT_ALONE.some((mark) => sentence.includes(mark)) ||
    PATH.test(sentence) ||
    (sentence.match(/\d/g)?.length ?? 0) >= 7 ||
    !balanced(sentence) ||
    // One that leads into what follows does not stand alone.
    /:$/.test(sentence) ||
    // A rule written as a template — choices between slashes, words quoted to copy — is not prose.
    / \/ /.test(sentence) ||
    (sentence.match(/["“”«»]/g)?.length ?? 0) >= 4
  ) {
    return null
  }

  sentence = sentence.replace(/\s*[,;]$/, '')

  if (!/[.!?…]["'»”’)]*$/u.test(sentence)) {
    sentence = `${sentence}.`
  }

  sentence = sentence.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase(locale))

  return sentence.length >= SHORTEST && sentence.length <= LONGEST ? sentence : null
}

/**
 * Abbreviations a sentence never ends on — a title before a name, «z.B.»,
 * «tel.» —, where the sentence breaks of the platform would cut it.
 */
const ABBREVIATIONS = new Set([
  ...TITLES,
  'nr',
  'tel',
  'vgl',
  'bzw',
  'ca',
  'zb',
  'ua',
  'dh',
  'vs',
  'eg',
  'ie',
  'pag',
  'sr',
  'jr',
  'sigg',
  'spett',
  'egr',
  'gent'
])

/** The sentences of a run of text, as the language breaks them, never after an abbreviation. */
function sentencesOf(text: string, segmenter: Intl.Segmenter): string[] {
  const sentences: string[] = []
  let held = ''

  for (const { segment } of segmenter.segment(text)) {
    const sentence = held + segment
    // The last word, after an article it is joined to: «l'ing.» is «ing.».
    const last = fold(sentence.trim().split(/\s+/).pop() ?? '').replace(/^.*['’«"(]/u, '')

    if (last.endsWith('.') && ABBREVIATIONS.has(last.replace(/\./g, ''))) {
      held = sentence
      continue
    }

    sentences.push(sentence)
    held = ''
  }

  return held ? [...sentences, held] : sentences
}

/**
 * A note's sentences that read well alone, in its order: no heading, links
 * reduced to their words, each item of a list a sentence of its own, nothing
 * holding an address, a path or code, of a sensible length.
 */
export function noteSentences(markdown: string, locale: string): string[] {
  // Front matter is not prose.
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })

  return proseOf(lexer(body), []).flatMap((run) =>
    sentencesOf(plainRun(run), segmenter).flatMap((segment) => {
      const sentence = shownAlone(segment, locale)
      return sentence ? [sentence] : []
    })
  )
}

/** How many sentences the arrival keeps: enough for a long wait, said again when longer. */
const POOL = 12

/** The note about the user says enough on its own from this many sentences: the others wait. */
const ENOUGH_OF_ONE = 4

/**
 * The sentences the arrival shows, in their order: the note about the user,
 * alone when it says enough — it is who they are, in the Segretario's words;
 * only when it says little, or there is none, how they write and work, then
 * the rest, a couple from each; each once.
 */
export function arrivalSentences(notes: ReadonlyArray<MemoryNote>, locale: string): string[] {
  const seen = new Set<string>()
  const pool: string[] = []
  const take = (note: MemoryNote, share: number): void => {
    let taken = 0

    for (const sentence of noteSentences(note.content, locale)) {
      const key = fold(sentence)

      if (taken === share || pool.length === POOL) {
        return
      }

      if (!seen.has(key)) {
        seen.add(key)
        pool.push(sentence)
        taken += 1
      }
    }
  }
  const order = ranked(notes)

  for (const { note } of order.filter(({ tier }) => tier <= 1)) {
    take(note, POOL)
  }

  if (pool.length >= ENOUGH_OF_ONE) {
    return pool
  }

  for (const { note, tier } of order.filter(({ tier }) => tier > 1)) {
    take(note, tier <= 3 ? 3 : 2)
  }

  return pool
}

/* ─────────────────────────────── the name ─────────────────────────────── */

/** A word in capitals or in small letters, written as a name is: «MARIO», «mario» → «Mario». */
function asName(word: string): string {
  if (word !== word.toLocaleUpperCase() && word !== word.toLocaleLowerCase()) {
    return word
  }

  return word
    .toLocaleLowerCase()
    .replace(
      /(^|[-'’])(\p{L})/gu,
      (_, before: string, letter: string) => `${before}${letter.toLocaleUpperCase()}`
    )
}

/**
 * The person a mailbox sends as — titles left out, a directory's «Rossi,
 * Mario» set right — or null when its name is no person's: an address, a
 * number, an office or a company, nothing.
 */
export function senderName(displayName: string): { full: string; first: string } | null {
  let name = displayName
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .trim()

  if (!name || name.includes('@') || /\d/.test(name)) {
    return null
  }

  const parts = name.split(',')

  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    name = `${parts[1].trim()} ${parts[0].trim()}`
  }

  const words = name.split(/\s+/)
  const plain = words.map((word) => fold(word).replace(/\./g, ''))

  if (plain.some((word) => NOT_A_PERSON.has(word))) {
    return null
  }

  const own = words.filter((_, index) => !TITLES.has(plain[index]))
  const first = own[0]

  if (!first || !/^\p{L}[\p{L}'’-]*\p{L}$/u.test(first)) {
    return null
  }

  return { full: own.join(' '), first: asName(first) }
}

/**
 * The user's first name, for the greeting: the name their mailboxes send
 * with — of several, the one the note about them names, else the first
 * mailbox's —, or null, and the greeting goes without.
 */
export function greetingName(
  accounts: ReadonlyArray<{ displayName: string }>,
  aboutYou: string | null
): string | null {
  const names = [
    ...new Map(
      accounts.flatMap((account) => {
        const name = senderName(account.displayName)
        return name ? [[fold(name.full), name] as const] : []
      })
    ).values()
  ]

  if (names.length <= 1 || !aboutYou) {
    return names[0]?.first ?? null
  }

  const note = fold(aboutYou)
  const words = new Set(note.split(/[^\p{L}'’-]+/u))
  const named =
    names.find((name) => note.includes(fold(name.full))) ??
    names.find((name) => words.has(fold(name.first)))

  return (named ?? names[0]).first
}
