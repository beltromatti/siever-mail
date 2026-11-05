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
