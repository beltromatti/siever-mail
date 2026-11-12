/**
 * An event's description as words and links, whatever wrote it: Google
 * keeps the HTML its editor makes (`<b>`, `<br>`, `<a href>`), Microsoft's
 * body arrives as Markdown, a CalDAV server and a link give plain text. The
 * panel shows it as text — never as the page's HTML — with its links.
 */

export type DescriptionPart = { text: string; href?: undefined } | { text: string; href: string }

/** Tags that say the text is HTML, as calendars' editors write it. */
const HTML_TAG =
  /<\/?(?:a|b|i|u|s|br|p|div|span|ul|ol|li|strong|em|font|h[1-6]|table|tr|td|blockquote|hr|html|body)\b[^>]*>/i

/** Elements that stand on lines of their own. */
const BLOCKS = new Set([
  'P',
  'DIV',
  'UL',
  'OL',
  'LI',
  'TR',
  'TABLE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR'
])

/** A Markdown link, or an address of the web written out: what becomes a link in plain text. */
const LINK =
  /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]'’”])/gi

/** Where a link may lead: the web, a mail address, a phone number. */
const SAFE_HREF = /^(?:https?:|mailto:|tel:)/i

/** Markdown's escapes and strong marks, which plain text shows as written. */
function unmark(text: string): string {
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/(\*\*|__)(\S.*?\S|\S)\1/g, '$2')
}

/** Plain text — or Markdown — cut where its links are. */
function plainParts(text: string): DescriptionPart[] {
  const parts: DescriptionPart[] = []
  let from = 0

  for (const match of text.matchAll(LINK)) {
    const index = match.index ?? 0
    parts.push({ text: unmark(text.slice(from, index)) })

    if (match[1] !== undefined) {
      parts.push({ text: unmark(match[1]), href: match[2] })
    } else {
      const address = match[3]
      parts.push({
        text: address,
        href: /^www\./i.test(address) ? `https://${address}` : address
      })
    }

    from = index + match[0].length
  }

  parts.push({ text: unmark(text.slice(from)) })
  return parts
}

/** HTML read as a page would show it: its lines, its list items, its links. */
function htmlParts(html: string): DescriptionPart[] {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  const parts: DescriptionPart[] = []
  // A block starts on a line of its own: one line end between blocks, however they nest.
  const breakLine = (): void => {
    const last = parts[parts.length - 1]

    if (last && !last.text.endsWith('\n')) {
      parts.push({ text: '\n' })
    }
  }

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Spaces and line ends in HTML's source are one space on the page.
      parts.push(...plainParts((node.textContent ?? '').replace(/\s+/g, ' ')))
      return
    }

    if (!(node instanceof Element)) {
      return
    }

    const tag = node.tagName

    if (tag === 'SCRIPT' || tag === 'STYLE') {
      return
    }

    if (tag === 'BR') {
      parts.push({ text: '\n' })
      return
    }

    const block = BLOCKS.has(tag)

    if (block) {
      breakLine()

      if (tag === 'LI') {
        parts.push({ text: '• ' })
      }
    }

    const href = tag === 'A' ? node.getAttribute('href')?.trim() : undefined

    if (href && SAFE_HREF.test(href)) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      parts.push({ text: text || href, href })
    } else {
      node.childNodes.forEach(walk)
    }

    if (block) {
      breakLine()
    }
  }

  body.childNodes.forEach(walk)
  return parts
}

/**
 * A description as the panel shows it: text and links, adjacent text
 * joined, lines trimmed of the spaces HTML leaves at their ends, at most
 * one empty line in a row, nothing empty at either end.
 */
export function descriptionParts(description: string): DescriptionPart[] {
  const raw = HTML_TAG.test(description)
    ? htmlParts(description)
    : plainParts(description.replace(/\r\n?/g, '\n'))
  const joined: DescriptionPart[] = []

  for (const part of raw) {
    const last = joined[joined.length - 1]

    if (!part.href && last && !last.href) {
      joined[joined.length - 1] = { text: last.text + part.text }
    } else if (part.href || part.text) {
      joined.push(part)
    }
  }

  const tidy = joined.map((part): DescriptionPart =>
    part.href
      ? part
      : {
          text: part.text
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
        }
  )

  if (tidy.length > 0 && !tidy[0].href) {
    tidy[0] = { text: tidy[0].text.replace(/^\s+/, '') }
  }

  const end = tidy.length - 1

  if (end >= 0 && !tidy[end].href) {
    tidy[end] = { text: tidy[end].text.replace(/\s+$/, '') }
  }

  return tidy.filter((part) => part.href || part.text)
}
