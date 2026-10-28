/**
 * How mail names a topic, compared the way people write it: case, accents
 * and punctuation aside, and a number joined to the word before it however
 * it is written — "Prat2451", "Prat. 2451", "PRAT 2451" are one name, as
 * are "pratica n. 2451" and "pratica n.2451". A word after a number stays
 * apart: "Prat2486 (snc)" still says "Prat2486".
 */
export function nameForm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(?<=\p{L}) (?=\p{N})/gu, '')
    .trim()
}

/** The names, in their compared form, that are worth looking for: three characters or more. */
export function nameForms(names: ReadonlyArray<string>): string[] {
  return [...new Set(names.map(nameForm).filter((name) => name.length >= 3))]
}

/** Whether a text, in its compared form, says one of the names — each whole, never inside a word. */
export function saysAnyName(formedText: string, formedNames: ReadonlyArray<string>): boolean {
  const padded = ` ${formedText} `
  return formedNames.some((name) => padded.includes(` ${name} `))
}

/**
 * Each topic's names that no other topic has: a client's name shared by
 * several of its pratiche says the client, not which of them.
 */
export function distinctNames(namesOf: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  const topicsNaming = new Map<string, number>()

  for (const names of namesOf) {
    for (const name of new Set(names)) {
      topicsNaming.set(name, (topicsNaming.get(name) ?? 0) + 1)
    }
  }

  return namesOf.map((names) => names.filter((name) => topicsNaming.get(name) === 1))
}
