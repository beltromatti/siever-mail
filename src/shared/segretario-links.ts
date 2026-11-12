/**
 * The links the Segretario writes in its words: `[testo](mail:m4)` to
 * what a tool named in the run (`mail`, `file`, `bozza`, `progetto`,
 * `evento`), now and then the short name alone (`[testo](m4)`), and
 * `[testo](impegno:12)` to an open thing, whose number holds everywhere.
 *
 * Words that stay — the letter of Oggi, "Il punto", a meeting's
 * preparation — keep what their short names stood for next to them, as a
 * conversation does; a later run reads them without their links, the short
 * names of an earlier run not being its own.
 */

/**
 * A link to a short name of the run: the scheme (optional) and the name. A
 * prepared reply lives on its message: `risposta:m4` and `sollecito:m4` are
 * links to that message too.
 */
export const HANDLE_LINK_PATTERN =
  /\]\(\s*(?:(mail|file|bozza|progetto|evento|risposta|sollecito)\s*:\s*)?([mfbpe]\d+)\s*\)/gi

/** A link to an open thing, by its number. */
export const COMMITMENT_LINK_PATTERN = /\]\(\s*impegno\s*:\s*#?(\d+)\s*\)/gi

/** The scheme a short name is written with, by its letter: `m4` is a message wherever it is. */
export const SCHEME_OF_HANDLE: Readonly<Record<string, string>> = {
  m: 'mail',
  f: 'file',
  b: 'bozza',
  p: 'progetto',
  e: 'evento'
}

/** The short names a text links to, each once, in order. */
export function linkedHandles(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(new RegExp(HANDLE_LINK_PATTERN))].map((match) => match[2].toLowerCase())
    )
  ]
}

/**
 * A text as it reads without its links — `[l'offerta di Rossi](mail:m4)`
 * is "l'offerta di Rossi" — an open thing keeping its number, which a run
 * can use: "l'IBAN a Chiara (#5)".
 */
export function unlinked(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\(\s*impegno\s*:\s*#?(\d+)\s*\)/gi, '$1 (#$2)')
    .replace(
      /\[([^\]]*)\]\(\s*(?:(?:mail|file|bozza|progetto|evento|risposta|sollecito)\s*:\s*)?[mfbpe]\d+\s*\)/gi,
      '$1'
    )
}

/**
 * A link in words that stay, whatever it points at: a short name of the
 * run, an open thing by its number, a page on the web. An image is not a
 * link: its `!` keeps it out.
 */
const ANY_LINK_PATTERN = /(?<!!)\[([^\][\n]+)\]\(([^()\n]+)\)/g

/**
 * Words that stay as the user reads them to rewrite them: each link's
 * label, without where it points (vision §10.1).
 */
export function plainWords(text: string): string {
  return text.replace(new RegExp(ANY_LINK_PATTERN), '$1')
}

/** A letter or a digit: where a label's first or last character is one, the word must end there. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u

/** A word of a text, folded to compare, with where it stands. */
interface Word {
  text: string
  start: number
  end: number
}

function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}_]+/gu)].map((match) => ({
    text: match[0].toLocaleLowerCase(),
    start: match.index,
    end: match.index + match[0].length
  }))
}

/** Beyond this many pairs of words the middle of two texts is not aligned: the labels are looked for instead. */
const ALIGNED_PAIRS = 4_000_000

/**
 * For each word of `a`, the word of `b` it stays as through a rewrite — the
 * two texts aligned on the most words they share in order (a longest common
 * subsequence, after the beginning and the end they share) — or -1.
 */
function alignedWords(a: ReadonlyArray<Word>, b: ReadonlyArray<Word>): Int32Array {
  const match = new Int32Array(a.length).fill(-1)
  let head = 0

  while (head < a.length && head < b.length && a[head].text === b[head].text) {
    match[head] = head
    head++
  }

  let endA = a.length
  let endB = b.length

  while (endA > head && endB > head && a[endA - 1].text === b[endB - 1].text) {
    endA--
    endB--
    match[endA] = endB
  }

  const rows = endA - head
  const columns = endB - head

  if (rows === 0 || columns === 0 || rows * columns > ALIGNED_PAIRS) {
    return match
  }

  // How many words the rest of each text shares from each pair on, then the path back through them.
  const width = columns + 1
  const shared = new Uint32Array((rows + 1) * width)

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      shared[i * width + j] =
        a[head + i].text === b[head + j].text
          ? shared[(i + 1) * width + j + 1] + 1
          : Math.max(shared[(i + 1) * width + j], shared[i * width + j + 1])
    }
  }

  for (let i = 0, j = 0; i < rows && j < columns;) {
    if (a[head + i].text === b[head + j].text) {
      match[head + i] = head + j
      i++
      j++
    } else if (shared[(i + 1) * width + j] >= shared[i * width + j + 1]) {
      i++
    } else {
      j++
    }
  }

  return match
}

/**
 * The user's rewrite of words that stay, with their links put back where
 * their words survive (vision §10.1). Each link follows its own words
 * through the rewrite — the two texts aligned word by word —, so a label
 * that also stands elsewhere as a plain word keeps the place it had; where
 * its words were rewritten, the occurrence of its label nearest to where
 * they stood — whatever its case, a whole word, not inside another link —;
 * a label gone, its link goes. Links the user wrote themselves stay as they are.
 */
export function relinked(written: string, before: string): string {
  const taken: Array<{ start: number; end: number; href?: string }> = [
    ...written.matchAll(new RegExp(ANY_LINK_PATTERN))
  ].map((match) => ({ start: match.index, end: match.index + match[0].length }))
  const free = (start: number, end: number): boolean =>
    taken.every((span) => end <= span.start || start >= span.end)
  const wholeWord = (start: number, end: number): boolean =>
    !(
      (WORD_CHARACTER.test(written[start]) && WORD_CHARACTER.test(written[start - 1] ?? '')) ||
      (WORD_CHARACTER.test(written[end - 1]) && WORD_CHARACTER.test(written[end] ?? ''))
    )

  // The text before as the user read it, and where each of its links stood in it.
  const links: Array<{ start: number; end: number; label: string; href: string }> = []
  let plain = ''
  let from = 0

  for (const match of before.matchAll(new RegExp(ANY_LINK_PATTERN))) {
    plain += before.slice(from, match.index)
    links.push({
      start: plain.length,
      end: plain.length + match[1].length,
      label: match[1],
      href: match[2]
    })
    plain += match[1]
    from = match.index + match[0].length
  }

  plain += before.slice(from)
  const oldWords = wordsOf(plain)
  const newWords = wordsOf(written)
  const aligned = alignedWords(oldWords, newWords)
  const sameLabel = (start: number, end: number, label: string): boolean =>
    written.slice(start, end).toLocaleLowerCase() === label.toLocaleLowerCase()

  for (const link of links) {
    const inside = oldWords.flatMap((word, index) =>
      word.start >= link.start && word.end <= link.end ? [index] : []
    )
    let place: { start: number; end: number } | null = null

    // Its words, still together where the rewrite left them.
    if (
      inside.length > 0 &&
      inside.every(
        (index, at) =>
          aligned[index] >= 0 && (at === 0 || aligned[index] === aligned[inside[at - 1]] + 1)
      )
    ) {
      const first = oldWords[inside[0]]
      const last = oldWords[inside[inside.length - 1]]
      const start = newWords[aligned[inside[0]]].start - (first.start - link.start)
      const end = newWords[aligned[inside[inside.length - 1]]].end + (link.end - last.end)

      if (start >= 0 && sameLabel(start, end, link.label) && free(start, end)) {
        place = { start, end }
      }
    }

    // Rewritten: its label where it reads nearest to where its words stood.
    if (!place) {
      const before = oldWords.findLastIndex(
        (word, index) => word.end <= link.start && aligned[index] >= 0
      )
      const near = before >= 0 ? newWords[aligned[before]].end : 0
      const label = new RegExp(link.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
      const found = [...written.matchAll(label)]
        .map((match) => ({ start: match.index, end: match.index + match[0].length }))
        .filter((span) => free(span.start, span.end) && wholeWord(span.start, span.end))
        .sort((a, b) => Math.abs(a.start - near) - Math.abs(b.start - near))[0]
      place = found ?? null
    }

    if (place) {
      taken.push({ ...place, href: link.href })
    }
  }

  let result = ''
  let at = 0

  for (const span of taken
    .filter((candidate) => candidate.href !== undefined)
    .sort((a, b) => a.start - b.start)) {
    result += `${written.slice(at, span.start)}[${written.slice(span.start, span.end)}](${span.href})`
    at = span.end
  }

  return result + written.slice(at)
}
