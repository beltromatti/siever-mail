/**
 * How a message being written is laid out, and where its signature sits.
 *
 * Top to bottom, a body has:
 *   - the lines the user writes on. A signature that starts with empty lines
 *     brings its own (they carry whatever colour or face its owner writes
 *     in); otherwise there are two plain ones, one to write on and one to
 *     set the signature apart;
 *   - the signature, in a `gmail_signature` block — the class Gmail and most
 *     clients mark a signature with — so that sending from another account
 *     can find it and put that account's signature in its place;
 *   - the message a reply or forward quotes, after a blank line.
 *
 * The signature's own empty lines at either end stay outside the block: the
 * user types there, and what they type must never go when the signature is
 * swapped.
 */

const SIGNATURE_CLASS = 'gmail_signature'
const EMPTY_LINE = '<div><br></div>'
const VISIBLE_MEDIA_SELECTOR = 'img, svg, video, audio, table, hr'
const QUOTE_SELECTOR = 'blockquote, .gmail_quote'
const INVISIBLE_CHARACTERS = /[\u200B\u00A0]/g

export interface SignatureParts {
  /** Empty lines above the signature, as authored; empty when there are none. */
  leading: string
  core: string
  /** Empty lines below it, as authored; empty when there are none. */
  trailing: string
}

function parseBody(html: string): HTMLElement {
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  return document.body.firstElementChild as HTMLElement
}

function hasVisibleContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return Boolean(node.textContent?.replace(INVISIBLE_CHARACTERS, '').trim())
  }

  if (!(node instanceof Element)) {
    return false
  }

  return (
    Boolean(node.textContent?.replace(INVISIBLE_CHARACTERS, '').trim()) ||
    node.matches(VISIBLE_MEDIA_SELECTOR) ||
    node.querySelector(VISIBLE_MEDIA_SELECTOR) !== null
  )
}

/** Serialises the empty lines at one end — or nothing, when there is no actual line. */
function serializeLines(nodes: Node[]): string {
  return nodes.some((node) => node instanceof Element) ? serialize(nodes) : ''
}

function serialize(nodes: Node[]): string {
  const container = nodes[0]?.ownerDocument?.createElement('div')

  if (!container) {
    return ''
  }

  container.append(...nodes.map((node) => node.cloneNode(true)))
  return container.innerHTML
}

function wrapSignature(core: string): string {
  return `<div class="${SIGNATURE_CLASS}">${core}</div>`
}

/**
 * Splits a stored signature into its content and the empty lines around
 * it. `null` when it has nothing to show — no text, no picture.
 */
export function splitSignature(html: string | null | undefined): SignatureParts | null {
  const root = parseBody((html ?? '').trim())
  const nodes = Array.from(root.childNodes)
  const first = nodes.findIndex(hasVisibleContent)

  if (first < 0) {
    return null
  }

  const last = nodes.length - 1 - [...nodes].reverse().findIndex(hasVisibleContent)

  return {
    leading: serializeLines(nodes.slice(0, first)),
    core: serialize(nodes.slice(first, last + 1)),
    trailing: serializeLines(nodes.slice(last + 1))
  }
}

/** The body a message starts with: lines to write on, the signature, the quote. */
export function buildComposerBody(
  signatureHtml: string | null,
  quoteHtml: string | undefined
): string {
  const signature = splitSignature(signatureHtml)
  const quote = quoteHtml?.trim() ?? ''

  if (!signature) {
    return quote ? `${EMPTY_LINE}${EMPTY_LINE}${quote}` : EMPTY_LINE
  }

  const writingLines = signature.leading || `${EMPTY_LINE}${EMPTY_LINE}`
  const afterSignature = signature.trailing || (quote ? EMPTY_LINE : '')

  return `${writingLines}${wrapSignature(signature.core)}${afterSignature}${quote}`
}

function findQuote(root: HTMLElement): Element | undefined {
  return Array.from(root.children).find((element) => element.matches(QUOTE_SELECTOR))
}

/** Whether anything besides the signature and the quote has content. */
function hasWrittenOutside(root: HTMLElement, quote: Element | undefined): boolean {
  return Array.from(root.childNodes).some((node) => node !== quote && hasVisibleContent(node))
}

function findSignatureBlock(root: HTMLElement): Element | null {
  return (
    Array.from(root.querySelectorAll(`.${SIGNATURE_CLASS}`)).find(
      // A quoted message can carry its own author's signature.
      (element) => !element.parentElement?.closest(QUOTE_SELECTOR)
    ) ?? null
  )
}

/**
 * Puts another account's signature where the current one is, when the
 * sending account changes.
 *
 * A body the user has not written in yet is simply laid out again, so the
 * lines above the signature take on the new account's style too. Otherwise
 * only the signature block changes. With no signature block in the body
 * there are two cases. The user deleted the one they had: that stays their
 * choice. Or there never was one, because the previous account has none:
 * then, with `insertIfMissing`, the new signature goes after what they
 * wrote, above the quote.
 */
export function replaceComposerSignature(
  html: string,
  signatureHtml: string | null,
  insertIfMissing: boolean
): string {
  const root = parseBody(html)
  const current = findSignatureBlock(root)

  if (!current && !insertIfMissing) {
    return html
  }

  const marker = root.ownerDocument.createComment('signature')
  current?.replaceWith(marker)

  const quote = findQuote(root)

  if (!hasWrittenOutside(root, quote)) {
    return buildComposerBody(signatureHtml, quote?.outerHTML)
  }

  const signature = splitSignature(signatureHtml)

  if (current) {
    if (signature) {
      current.innerHTML = signature.core
      marker.replaceWith(current)
    } else {
      marker.remove()
    }

    return root.innerHTML
  }

  marker.remove()

  if (!signature) {
    return html
  }

  const lineAbove = quote ? quote.previousElementSibling : root.lastElementChild
  const block = root.ownerDocument.createElement('template')
  block.innerHTML = [
    lineAbove && hasVisibleContent(lineAbove) ? EMPTY_LINE : '',
    wrapSignature(signature.core),
    signature.trailing || (quote ? EMPTY_LINE : '')
  ].join('')

  root.insertBefore(block.content, quote ?? null)
  return root.innerHTML
}

/**
 * Whether the user has written anything in the body: text or pictures
 * outside the signature and the quoted message. Signatures and quotes are
 * the composer's own doing, so a body holding only them loses nothing when
 * closed.
 */
export function hasWrittenContent(html: string): boolean {
  const root = parseBody(html)
  findSignatureBlock(root)?.remove()
  return hasWrittenOutside(root, findQuote(root))
}
