export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const FIRST_LETTER_PATTERN = /\p{L}/u

/**
 * The letters an avatar shows for a person: the first letter of their
 * first two words — "Giudici & Polidori" is GP, "'marco conti'" is MC — or,
 * for a bare address, of the first two parts of its name, so
 * "a.angelini@siever.it" is AA. Words without a letter ("&", "+1") are
 * passed over.
 */
export function initialsFromName(value: string): string {
  const cleaned = value.trim()
  const atIndex = cleaned.indexOf('@')
  const words =
    atIndex > 0 && !/\s/.test(cleaned)
      ? cleaned.slice(0, atIndex).split(/[._\-+]+/)
      : cleaned.split(/\s+/)
  const initials = words
    .map((word) => word.match(FIRST_LETTER_PATTERN)?.[0])
    .filter((letter): letter is string => Boolean(letter))
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('it-IT')

  return initials || '?'
}
