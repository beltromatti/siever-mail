import { buildMailFrameDocument, sanitizeMailHtml } from './mail-html'

/**
 * The HTML a message leaves with: exactly what the composer showed, with
 * nothing left for the recipient's client to decide.
 *
 * The composer renders on the same baseline as the reader, but every mail
 * client brings defaults of its own. Outlook's Word engine is the extreme
 * case: it gives each paragraph its "Normal" spacing unless one is
 * declared, ignores a unitless `line-height: 1.5`, and does not carry a
 * font from a wrapper into a paragraph or a table cell. So before sending,
 * the message is laid out once more off screen and what it actually
 * rendered as is written onto it:
 *
 *   • every element holding text declares its font, size and colour;
 *   • paragraphs, headings, lists and quotes declare their margins;
 *   • a line height is written in pixels wherever it changes, which is how
 *     a unitless value behaves and the one form every client honours;
 *   • links keep their colour and underline instead of the client's own;
 *   • images carry their size, so Outlook on a scaled display does not
 *     blow them up.
 *
 * Declarations the author already wrote are never overridden. The result
 * is wrapped in a complete document that tells Outlook to lay it out at 96
 * dpi, the density it was designed at.
 */

/** Elements whose own margins differ between clients. `div` has none anywhere. */
const SPACED_BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'HR',
  'DL',
  'DD',
  'FIGURE'
])

/** Elements that are never text containers. */
const SKIPPED_TAGS = new Set(['BR', 'IMG', 'STYLE', 'SCRIPT', 'TEMPLATE', 'WBR'])

const MARGIN_PROPERTIES = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const

/** A line height written as a bare number: what Outlook ignores. */
const UNITLESS_NUMBER_PATTERN = /^\s*[\d.]+\s*$/

function hasOwnText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
  )
}

function declare(element: HTMLElement, property: string, value: string): void {
  if (!element.style.getPropertyValue(property)) {
    element.style.setProperty(property, value)
  }
}

interface RenderedStyle {
  fontFamily: string
  fontSize: string
  color: string
  lineHeight: string
  parentLineHeight: string | null
  margins: string[]
  paddingLeft: string
  textDecorationLine: string
}

/**
 * Everything is read before anything is written: declaring a parent's line
 * height in pixels changes what its children compute, and a 24 px span
 * inside a 1.5 paragraph must keep the 36 px it was rendered with.
 */
function readRenderedStyle(element: HTMLElement, view: Window): RenderedStyle {
  const computed = view.getComputedStyle(element)
  const parent = element.parentElement

  return {
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    color: computed.color,
    lineHeight: computed.lineHeight,
    parentLineHeight: parent ? view.getComputedStyle(parent).lineHeight : null,
    margins: MARGIN_PROPERTIES.map((property) => computed.getPropertyValue(property)),
    paddingLeft: computed.paddingLeft,
    textDecorationLine: computed.textDecorationLine
  }
}

function freezeElement(element: HTMLElement, rendered: RenderedStyle): void {
  if (hasOwnText(element)) {
    declare(element, 'font-family', rendered.fontFamily)
    declare(element, 'font-size', rendered.fontSize)
    declare(element, 'color', rendered.color)
  }

  // Resolved line heights are pixels (or `normal`). Writing one wherever it
  // differs from the parent reproduces a unitless value exactly: children
  // at the same size inherit it, a bigger span gets its own. A bare number
  // the author wrote is the same value in the one form Outlook honours, so
  // it is the single declaration that gets replaced rather than kept.
  if (UNITLESS_NUMBER_PATTERN.test(element.style.lineHeight)) {
    element.style.setProperty('line-height', rendered.lineHeight)
  } else if (rendered.lineHeight !== rendered.parentLineHeight) {
    declare(element, 'line-height', rendered.lineHeight)
  }

  if (SPACED_BLOCK_TAGS.has(element.tagName)) {
    MARGIN_PROPERTIES.forEach((property, index) => {
      declare(element, property, rendered.margins[index])
    })
  }

  if (element.tagName === 'UL' || element.tagName === 'OL') {
    declare(element, 'padding-left', rendered.paddingLeft)
  }

  if (element.tagName === 'A') {
    declare(element, 'color', rendered.color)
    declare(element, 'text-decoration', rendered.textDecorationLine)
  }
}

function freezeImage(image: HTMLImageElement, box: DOMRect): void {
  const width = Math.round(box.width)
  const height = Math.round(box.height)

  if (width > 0 && !image.hasAttribute('width')) {
    image.setAttribute('width', String(width))
  }

  if (height > 0 && !image.hasAttribute('height')) {
    image.setAttribute('height', String(height))
  }
}

function loadFrame(frame: HTMLIFrameElement, html: string): Promise<Document> {
  return new Promise((resolve, reject) => {
    frame.addEventListener(
      'load',
      () => {
        const document = frame.contentDocument
        if (document) {
          resolve(document)
        } else {
          reject(new Error("Impossibile preparare il messaggio per l'invio."))
        }
      },
      { once: true }
    )
    frame.srcdoc = html
  })
}

/**
 * Builds the HTML to send from the composer's body. The frame is laid out
 * at the composer's width, so percentages and images resolve to what the
 * user was looking at.
 */
export async function buildOutgoingMailHtml(bodyHtml: string, layoutWidth = 920): Promise<string> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${layoutWidth}px;height:10px;border:0;visibility:hidden;pointer-events:none`
  document.body.appendChild(frame)

  try {
    // A quoted message's own <style> blocks travel in the head, where they
    // shaped what the composer showed.
    const { bodyHtml: sanitizedBody, headHtml } = sanitizeMailHtml(bodyHtml)
    const frameDocument = await loadFrame(
      frame,
      buildMailFrameDocument({ bodyHtml: sanitizedBody, headHtml })
    )
    const view = frameDocument.defaultView

    if (!view) {
      throw new Error("Impossibile preparare il messaggio per l'invio.")
    }

    // Images the message carries (pasted, signature logos) are measured once
    // decoded. Remote pictures in a quoted message already declare their
    // size, and are not worth holding the send for.
    await Promise.all(
      Array.from(frameDocument.images)
        .filter((image) => !image.complete && image.src.startsWith('data:'))
        .map((image) => image.decode().catch(() => undefined))
    )

    const body = frameDocument.body

    const elements = Array.from(body.querySelectorAll<HTMLElement>('*')).filter(
      (element) => !SKIPPED_TAGS.has(element.tagName)
    )
    const images = Array.from(frameDocument.images).map((image) => ({
      image,
      box: image.getBoundingClientRect()
    }))
    const rendered = elements.map((element) => readRenderedStyle(element, view))

    elements.forEach((element, index) => freezeElement(element, rendered[index]))
    images.forEach(({ image, box }) => freezeImage(image, box))

    // Text sitting directly in the body inherits from this wrapper, the
    // one element every client carries styles through.
    const bodyStyle = view.getComputedStyle(body)
    const wrapperStyle = [
      `font-family: ${bodyStyle.fontFamily}`,
      `font-size: ${bodyStyle.fontSize}`,
      `line-height: ${bodyStyle.lineHeight}`,
      `color: ${bodyStyle.color}`
    ].join('; ')

    return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
${headHtml}
</head>
<body style="margin: 0; padding: 0; -webkit-text-size-adjust: 100%;">
<div style="${wrapperStyle.replaceAll('"', "'")}">${body.innerHTML}</div>
</body>
</html>`
  } finally {
    frame.remove()
  }
}
