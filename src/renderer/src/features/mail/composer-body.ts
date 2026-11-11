/**
 * How a message being written is laid out, and where its letterhead and
 * signature sit (vision §6.6).
 *
 * Top to bottom, a body has:
 *   - the mailbox's letterhead, in a `mail_letterhead` block: what heads
 *     every message written from it, a reply's too;
 *   - the lines the user writes on. A signature that starts with empty
 *     lines brings its own (they carry whatever colour or face its owner
 *     writes in), else the letterhead's own trailing ones; otherwise there
 *     are two plain ones, one to write on and one to set the signature apart;
 *   - the signature, in a `gmail_signature` block — the class Gmail and most
 *     clients mark a signature with;
 *   - the message a reply or forward quotes, after a blank line.
 *
 * The two blocks are marked so that sending from another mailbox can find
 * them and put that mailbox's own in their place. Their empty lines at
 * either end stay outside the blocks: the user types there, and what they
 * type must never go when a block is swapped.
 */

const SIGNATURE_CLASS = 'gmail_signature'
const LETTERHEAD_CLASS = 'mail_letterhead'
/** The letterhead block, for the editor to keep whole (`RichTextEditor.headSelector`). */
export const LETTERHEAD_SELECTOR = `.${LETTERHEAD_CLASS}`
const EMPTY_LINE = '<div><br></div>'
const VISIBLE_MEDIA_SELECTOR = 'img, svg, video, audio, table, hr'
const QUOTE_SELECTOR = 'blockquote, .gmail_quote'
/**
 * Where a quoted message begins, as the clients that write drafts mark it:
 * Gmail's and this app's quote, Outlook's reply header, Apple Mail's and
 * Thunderbird's cited block with its line above.
 */
const QUOTE_START_SELECTOR =
  '.gmail_quote, #appendonsend, #divRplyFwdMsg, .moz-cite-prefix, blockquote[type="cite"], blockquote'
const INVISIBLE_CHARACTERS = /[\u200B\u00A0]/g

/** What a mailbox puts around what is written: a letterhead above, a signature below. */
export interface ComposerDecorations {
  headerHtml: string | null
  signatureHtml: string | null
}

export const NO_DECORATIONS: ComposerDecorations = { headerHtml: null, signatureHtml: null }

export interface SignatureParts {
  /** Empty lines above the content, as authored; empty when there are none. */
  leading: string
  core: string
  /** Empty lines below it, as authored; empty when there are none. */
  trailing: string
}

export function parseBody(html: string): HTMLElement {
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  return document.body.firstElementChild as HTMLElement
}

function hasVisibleContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return Boolean(node.textContent?.replace(INVISIBLE_CHARACTERS, '').trim())
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false
  }

  const element = node as Element
  return (
    Boolean(element.textContent?.replace(INVISIBLE_CHARACTERS, '').trim()) ||
    element.matches(VISIBLE_MEDIA_SELECTOR) ||
    element.querySelector(VISIBLE_MEDIA_SELECTOR) !== null
  )
}

/** Serialises the empty lines at one end — or nothing, when there is no actual line. */
function serializeLines(nodes: Node[]): string {
  return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE) ? serialize(nodes) : ''
}

function serialize(nodes: Node[]): string {
  const container = nodes[0]?.ownerDocument?.createElement('div')

  if (!container) {
    return ''
  }

  container.append(...nodes.map((node) => node.cloneNode(true)))
  return container.innerHTML
}

function wrap(className: string, core: string): string {
  return `<div class="${className}">${core}</div>`
}

/**
 * Splits a stored letterhead or signature into its content and the empty
 * lines around it. `null` when it has nothing to show — no text, no picture.
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

/**
 * The body a message starts with: the letterhead, lines to write on, the
 * signature, the quote. `writtenHtml` is what is already written on those
 * lines — the Segretario's draft — followed by the line that sets the
 * signature apart.
 */
export function buildComposerBody(
  decorations: ComposerDecorations,
  quoteHtml: string | undefined,
  writtenHtml?: string
): string {
  const header = splitSignature(decorations.headerHtml)
  const signature = splitSignature(decorations.signatureHtml)
  const quote = quoteHtml?.trim() ?? ''
  // What is already written takes the style of the lines it is written on.
  const writingLines = signature?.leading || header?.trailing || ''
  const model = writingLines ? parseBody(writingLines).firstElementChild : null
  const written = writtenHtml?.trim()
    ? styledLines(`${writtenHtml.trim()}${EMPTY_LINE}`, model)
    : ''
  const letterhead = header ? wrap(LETTERHEAD_CLASS, header.core) : ''

  if (!signature) {
    const lines = written || header?.trailing || (quote ? `${EMPTY_LINE}${EMPTY_LINE}` : EMPTY_LINE)
    return `${letterhead}${lines}${quote}`
  }

  const lines = written || signature.leading || header?.trailing || `${EMPTY_LINE}${EMPTY_LINE}`
  const afterSignature = signature.trailing || (quote ? EMPTY_LINE : '')

  return `${letterhead}${lines}${wrap(SIGNATURE_CLASS, signature.core)}${afterSignature}${quote}`
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `**bold**` within a line, the one emphasis the Segretario's plain text carries. */
function inlineHtml(line: string): string {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}

/**
 * A passage written over a selection: one line stays inside the line it
 * goes into; several are lines of their own, made like `model` — the line
 * the selection starts in — when it is given.
 */
export function passageToComposerHtml(text: string, model?: Element | null): string {
  const passage = text.replace(/\r\n?/g, '\n').trim()

  if (!passage.includes('\n')) {
    return inlineHtml(passage)
  }

  return styledLines(plainTextToComposerHtml(passage), model ?? null)
}

/**
 * Plain text as the lines of a message: a line per block, an empty one per
 * blank line, `- ` items as a list — the way the editor itself writes, so
 * the text reads and edits as if typed.
 */
export function plainTextToComposerHtml(text: string): string {
  const blocks: string[] = []
  let items: string[] = []
  const flushItems = (): void => {
    if (items.length > 0) {
      blocks.push(`<ul>${items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`)
      items = []
    }
  }

  for (const line of text.replace(/\r\n?/g, '\n').trim().split('\n')) {
    const item = /^\s*[-•*]\s+(.*)$/.exec(line)

    if (item) {
      items.push(item[1])
      continue
    }

    flushItems()
    blocks.push(line.trim() ? `<div>${inlineHtml(line)}</div>` : EMPTY_LINE)
  }

  flushItems()
  return blocks.join('')
}

/**
 * The line of the body where the quoted message starts — found at any
 * depth, as another client may wrap it — or undefined when there is none.
 * Not one inside the letterhead or the signature, which may quote too.
 */
function findQuote(root: Element): Element | undefined {
  for (const candidate of Array.from(root.querySelectorAll(QUOTE_START_SELECTOR))) {
    if (candidate.closest(`.${LETTERHEAD_CLASS}, .${SIGNATURE_CLASS}`)) {
      continue
    }

    const line = topLevelOf(root, candidate)

    if (line) {
      return line
    }
  }

  return undefined
}

/** The quoted message of a body, as it is: kept when the body is laid out again. */
export function quoteOf(html: string): string | undefined {
  return findQuote(parseBody(html))?.outerHTML
}

/** A letterhead or signature block of the body — never one of the quoted message. */
function findBlock(root: Element, className: string): Element | null {
  return (
    Array.from(root.querySelectorAll(`.${className}`)).find(
      (element) => !element.parentElement?.closest(QUOTE_SELECTOR)
    ) ?? null
  )
}

/** The line of `root` holding `node`: `node` itself when it is one. */
function topLevelOf(root: Element, node: Element | null): Element | null {
  let current = node

  while (current && current.parentElement !== root) {
    current = current.parentElement
  }

  return current
}

/** Whether anything besides the letterhead, the signature and the quote has content. */
function hasWrittenOutside(root: Element): boolean {
  const kept = new Set<Node | null>([
    findQuote(root) ?? null,
    topLevelOf(root, findBlock(root, LETTERHEAD_CLASS)),
    topLevelOf(root, findBlock(root, SIGNATURE_CLASS))
  ])
  return Array.from(root.childNodes).some((node) => !kept.has(node) && hasVisibleContent(node))
}

/** What a letterhead or signature says, as a reader sees it: its words and its pictures. */
function fingerprint(element: Element): string {
  const words = (element.textContent ?? '').replace(INVISIBLE_CHARACTERS, ' ').replace(/\s+/g, ' ')
  return `${words.trim()}|${element.querySelectorAll(VISIBLE_MEDIA_SELECTOR).length}`
}

/**
 * The first line the user writes on: the one after the letterhead, else
 * the first of the body.
 */
export function firstWritingLine(root: Element): Element | null {
  const letterhead = topLevelOf(root, findBlock(root, LETTERHEAD_CLASS))
  return letterhead ? letterhead.nextElementSibling : root.firstElementChild
}

/**
 * Puts another mailbox's letterhead and signature where the current ones
 * are, when the sending mailbox changes — in `root` itself, the live body
 * included, so the caret stays where the user left it.
 *
 * Both are text like the rest of the message, and the user may have
 * written in them. One that no longer says what `previous` said is theirs
 * now and stays as it is; one they left alone is swapped, or goes when the
 * new mailbox has none. A missing one stays missing when the user deleted
 * it; when the previous mailbox had none, the new one's is put in — the
 * letterhead on top, the signature after what is written, above the
 * quote. `previous` unknown — a draft taken up again — swaps what is
 * there and adds nothing.
 */
export function swapDecorationsIn(
  root: Element,
  next: ComposerDecorations,
  previous?: ComposerDecorations
): void {
  const document = root.ownerDocument
  const insert = (html: string, before: Node | null): void => {
    const template = document.createElement('template')
    template.innerHTML = html
    root.insertBefore(template.content, before)
  }

  for (const [className, key] of [
    [LETTERHEAD_CLASS, 'headerHtml'],
    [SIGNATURE_CLASS, 'signatureHtml']
  ] as const) {
    const current = findBlock(root, className)
    const before = previous ? splitSignature(previous[key]) : undefined
    const after = splitSignature(next[key])

    if (current) {
      if (before && fingerprint(current) !== fingerprint(parseBody(before.core))) {
        continue
      }

      if (after) {
        current.innerHTML = after.core
      } else {
        current.remove()
      }

      continue
    }

    // Deleted by the user, or not known to have been there: it stays as it is.
    if (!after || before !== null) {
      continue
    }

    if (className === LETTERHEAD_CLASS) {
      insert(wrap(LETTERHEAD_CLASS, after.core), root.firstChild)
      continue
    }

    const quote = findQuote(root) ?? null
    const lineAbove = quote ? quote.previousElementSibling : root.lastElementChild

    insert(
      [
        lineAbove && hasVisibleContent(lineAbove) ? EMPTY_LINE : '',
        wrap(SIGNATURE_CLASS, after.core),
        after.trailing || (quote ? EMPTY_LINE : '')
      ].join(''),
      quote
    )
  }
}

/**
 * The body as sending from another mailbox makes it (`swapDecorationsIn`):
 * a body nobody wrote in yet is simply laid out again, so its lines take
 * on the new mailbox's style too.
 */
export function replaceComposerDecorations(
  html: string,
  next: ComposerDecorations,
  previous?: ComposerDecorations
): string {
  const root = parseBody(html)

  if (!hasWrittenOutside(root)) {
    return buildComposerBody(next, findQuote(root)?.outerHTML)
  }

  swapDecorationsIn(root, next, previous)
  return root.innerHTML
}

/**
 * Whether the user has written anything in the body: text or pictures
 * outside the letterhead, the signature and the quoted message. Those are
 * the composer's own doing, so a body holding only them loses nothing when
 * closed.
 */
export function hasWrittenContent(html: string): boolean {
  return hasWrittenOutside(parseBody(html))
}

/** `html` as lines made like `model` (`linesLike`), as HTML. */
function styledLines(html: string, model: Element | null): string {
  if (!model) {
    return html
  }

  const container = model.ownerDocument.createElement('div')
  container.append(linesLike(model.ownerDocument, html, model))
  return container.innerHTML
}

/** A line whose kind and style written lines may take: a plain DIV or P of the text. */
function isStyleModel(element: Element): boolean {
  return (
    ['DIV', 'P'].includes(element.tagName) &&
    !element.matches(`.${LETTERHEAD_CLASS}, .${SIGNATURE_CLASS}, ${QUOTE_START_SELECTOR}`)
  )
}

/**
 * Lines written in, made like `model`: the line they take the place of —
 * its kind and its style (a colour, a face a mailbox writes in) — so they
 * read as if typed there. A list keeps its kind and takes the style.
 */
function linesLike(document: Document, html: string, model: Element | null): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  const fragment = template.content

  // Only a line of text lends its style: never a list item, a letterhead or a signature.
  if (!model || !isStyleModel(model)) {
    return fragment
  }

  for (const block of Array.from(fragment.children)) {
    if (block.tagName === 'DIV') {
      const line = document.createElement(model.tagName)
      Array.from(model.attributes).forEach((attribute) =>
        line.setAttribute(attribute.name, attribute.value)
      )
      line.append(...Array.from(block.childNodes))
      block.replaceWith(line)
    } else if (model.hasAttribute('style')) {
      block.setAttribute('style', model.getAttribute('style') ?? '')
    }
  }

  return fragment
}

/** The line `html` would be written on: the first of the body's written part. */
function writingModel(root: Element): Element | null {
  const line = firstWritingLine(root)
  return line && isStyleModel(line) ? line : null
}

/**
 * Whether the body has the marks that say where what the user writes
 * ends — a letterhead, a signature, a quoted message. A draft from another
 * client may have none: then the whole body may be what it quotes too.
 */
export function hasWrittenBounds(root: Element): boolean {
  return Boolean(
    findBlock(root, LETTERHEAD_CLASS) || findBlock(root, SIGNATURE_CLASS) || findQuote(root)
  )
}

/**
 * Writes new lines in place of the user's, in `root` itself: everything
 * between the letterhead and the signature (or the quote, without one) is
 * replaced by `writtenHtml` — in the style of the line it was written on —
 * and the empty line that sets the signature apart; the rest stays as it is.
 */
export function replaceWrittenPartIn(root: Element, writtenHtml: string): void {
  const start = topLevelOf(root, findBlock(root, LETTERHEAD_CLASS))
  const end = topLevelOf(root, findBlock(root, SIGNATURE_CLASS)) ?? findQuote(root) ?? null
  const lines = linesLike(
    root.ownerDocument,
    end ? `${writtenHtml}${EMPTY_LINE}` : writtenHtml,
    writingModel(root)
  )

  let node = start ? start.nextSibling : root.firstChild

  while (node && node !== end) {
    const following: ChildNode | null = node.nextSibling
    node.remove()
    node = following
  }

  root.insertBefore(lines, end)
}

/** `replaceWrittenPartIn`, on a body as HTML. */
export function replaceWrittenPart(html: string, writtenHtml: string): string {
  const root = parseBody(html)
  replaceWrittenPartIn(root, writtenHtml)
  return root.innerHTML
}

/**
 * What the signature says, as plain text: the Segretario writes above it,
 * and should not close the message as the signature already does.
 */
export function signatureText(html: string): string {
  const signature = findBlock(parseBody(html), SIGNATURE_CLASS)
  return signature ? writtenText(signature.innerHTML) : ''
}

const LINE_BLOCKS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'PRE', 'TR'])

/**
 * What the user wrote in a message, as plain text: the lines between the
 * letterhead and the signature or the quote, one per block as the editor
 * writes them, an empty line for an empty one, `- ` before a list item. The
 * Segretario reads it, and learns from comparing it with what it had written.
 */
export function writtenText(html: string): string {
  const root = parseBody(html)
  findBlock(root, LETTERHEAD_CLASS)?.remove()
  findBlock(root, SIGNATURE_CLASS)?.remove()
  findQuote(root)?.remove()

  const lines: string[] = []
  let line = ''
  const endLine = (): void => {
    lines.push(line)
    line = ''
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      line += node.textContent ?? ''
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return
    }

    const element = node as Element

    if (element.tagName === 'BR') {
      endLine()
      return
    }

    const block = LINE_BLOCKS.has(element.tagName)

    if (block && line) {
      endLine()
    }

    if (element.tagName === 'LI') {
      line += '- '
    }

    element.childNodes.forEach(walk)

    if (block && line) {
      endLine()
    }
  }

  root.childNodes.forEach(walk)

  if (line) {
    endLine()
  }

  return lines
    .map((text) =>
      text
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .trimEnd()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
