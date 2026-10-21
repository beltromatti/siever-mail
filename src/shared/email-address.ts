import type { MailAddress } from './models'
import { cleanDisplayName, isMeaningfulDisplayName } from './sender'

/** RFC 5321: an address travels in a path of 256 octets, angle brackets included. */
const MAX_ADDRESS_LENGTH = 254
const MAX_LOCAL_PART_LENGTH = 64

/** A dot-separated piece of the local part: RFC 5322 atext, and letters of any script (RFC 6531). */
const LOCAL_PART_ATOM = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+$/u
/** A domain label: letters and digits of any script (IDNA), inner hyphens, at most 63 long. */
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u
/** Every top-level domain IANA delegates is two letters or more, or its punycode form. */
const TOP_LEVEL_DOMAIN = /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu

/**
 * Whether mail can be addressed to `value`, as the mail clients people use
 * judge it: a local part of the characters addresses are made of, an "@",
 * and a domain whose last label is a real top-level one — so
 * "f.fuschini@siever.i", one letter short, is caught before it is sent,
 * while addresses in any script go through. Quoted local parts and IP
 * literals, which no one types, are not taken.
 */
export function isValidEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) {
    return false
  }

  const at = value.lastIndexOf('@')
  const localPart = value.slice(0, at)
  const domain = value.slice(at + 1)

  if (at <= 0 || localPart.length > MAX_LOCAL_PART_LENGTH || localPart.includes('@')) {
    return false
  }

  const labels = domain.split('.')

  return (
    localPart.split('.').every((atom) => LOCAL_PART_ATOM.test(atom)) &&
    labels.length >= 2 &&
    labels.every((label) => DOMAIN_LABEL.test(label)) &&
    TOP_LEVEL_DOMAIN.test(labels[labels.length - 1])
  )
}

/** One address however it is written: "Mario.Rossi@X.it " and "mario.rossi@x.it" are one person. */
export function addressKey(address: string): string {
  return address.trim().toLowerCase()
}

/** Characters that make a display name need quoting in a header (RFC 5322 specials). */
const NAME_SPECIALS = /[()<>[\]:;@\\,."]/

/**
 * A recipient as it is typed: "Mario Rossi <mario@x.it>", the name quoted
 * when it holds a comma or another special — read back by `parseRecipients`
 * as the same person.
 */
export function formatRecipient(recipient: MailAddress): string {
  const name = recipient.name?.trim()

  if (!name) {
    return recipient.address
  }

  const quoted = NAME_SPECIALS.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : name
  return `${quoted} <${recipient.address}>`
}

/** Where one recipient ends in a typed or pasted list. */
const RECIPIENT_SEPARATORS = new Set([',', ';', '\n', '\r', '\t'])

interface Segment {
  text: string
  /** What ended it: the merge of "Rossi, Mario <…>" happens only across a comma. */
  separator: string
}

/** Splits at separators outside quotes, angle brackets and comments. */
function splitSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let current = ''
  let quoted = false
  let angle = 0
  let comment = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quoted) {
      current += char

      if (char === '\\' && index + 1 < text.length) {
        index += 1
        current += text[index]
      } else if (char === '"') {
        quoted = false
      }

      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === '<') {
      angle += 1
    } else if (char === '>') {
      angle = Math.max(0, angle - 1)
    } else if (char === '(') {
      comment += 1
    } else if (char === ')') {
      comment = Math.max(0, comment - 1)
    } else if (angle === 0 && comment === 0 && RECIPIENT_SEPARATORS.has(char)) {
      segments.push({ text: current, separator: char })
      current = ''
      continue
    }

    current += char
  }

  segments.push({ text: current, separator: '' })
  return segments
}

/**
 * "Rossi, Mario <m@x.it>" — the way Exchange writes names — is one person,
 * not "Rossi" and "Mario <m@x.it>": a piece with no address joins the next
 * across a comma when that one is a name with its address in brackets.
 */
function mergeSurnameFirstNames(segments: Segment[]): string[] {
  const merged: string[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const next = segments[index + 1]
    const nameOnly = segment.text.trim() && !/[@<>]/.test(segment.text)
    const nextIsNamedAddress =
      next !== undefined && /^[^@<]+<[^>]*@/.test(next.text.trim()) && segment.separator === ','

    if (nameOnly && nextIsNamedAddress) {
      next.text = `${segment.text.trim()}, ${next.text.trim()}`
      continue
    }

    merged.push(segment.text)
  }

  return merged
}

/** "mailto:a@b.it", 'a@b.it', <a@b.it> — the address alone. */
function bareAddress(value: string): string {
  let address = value.trim().replace(/^mailto:/i, '')

  for (;;) {
    const unwrapped = address.replace(/^(["'<\u2018\u201c])(.*)(["'>\u2019\u201d])$/s, '$2').trim()

    if (unwrapped === address) {
      return address.split('?')[0]
    }

    address = unwrapped
  }
}

/** A quoted display name with its escapes undone. */
function unquote(name: string): string {
  const trimmed = name.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1
    ? trimmed.slice(1, -1).replace(/\\(.)/g, '$1')
    : trimmed
}

function recipient(address: string, name?: string): MailAddress {
  const cleanName = cleanDisplayName(name ? unquote(name) : undefined)

  return isMeaningfulDisplayName(cleanName, address) ? { name: cleanName, address } : { address }
}

function parseSegment(text: string): MailAddress[] {
  const open = text.indexOf('<')

  if (open >= 0) {
    const close = text.indexOf('>', open)
    const address = bareAddress(text.slice(open + 1, close < 0 ? undefined : close))
    const name = `${text.slice(0, open)} ${close < 0 ? '' : text.slice(close + 1)}`
      .replace(/\(([^)]*)\)/g, ' ')
      .trim()

    return address ? [recipient(address, name)] : name ? [{ address: name }] : []
  }

  // "a@x.it (Mario Rossi)": the comment names who the address is.
  const comment = /\(([^)]*)\)/.exec(text)?.[1]
  const words = text
    .replace(/\(([^)]*)\)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const addresses = words.filter((word) => word.includes('@'))

  if (addresses.length === 0) {
    const typed = words.join(' ')
    return typed ? [{ address: typed }] : []
  }

  if (addresses.length === 1) {
    const others = words.filter((word) => !word.includes('@')).join(' ')
    return [recipient(bareAddress(addresses[0]), others || comment)]
  }

  // Several addresses apart by spaces: each is someone, and a stray word
  // is kept, to be seen and fixed.
  return words.map((word) => ({ address: bareAddress(word) }))
}

/**
 * The people in what was typed or pasted into a recipient field: "Mario
 * Rossi <mario@x.it>; anna@y.it", a column of addresses out of a
 * spreadsheet, the list Outlook or Gmail copies, "mailto:" links. Whatever
 * does not read as an address comes back as it was written — for the field
 * to show as wrong, never to be dropped without a word (see
 * `isValidEmailAddress`).
 */
export function parseRecipients(text: string): MailAddress[] {
  return mergeSurnameFirstNames(splitSegments(text)).flatMap((segment) =>
    segment.trim() ? parseSegment(segment.trim()) : []
  )
}

/** `recipients` and then `added`, each address once — the first spelling and the first name kept. */
export function mergeRecipients(
  recipients: ReadonlyArray<MailAddress>,
  added: ReadonlyArray<MailAddress>
): MailAddress[] {
  const merged = [...recipients]
  const known = new Set(recipients.map((entry) => addressKey(entry.address)))

  for (const entry of added) {
    const key = addressKey(entry.address)

    if (key && !known.has(key)) {
      known.add(key)
      merged.push(entry)
    }
  }

  return merged
}
