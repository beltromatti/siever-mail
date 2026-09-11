/**
 * Canonical parsing of a raw RFC 822 message, and the one rule that decides
 * whether a MIME part is a file the sender attached or an image the body
 * renders.
 *
 * That distinction is not cosmetic. A modern Outlook message carries the
 * sender's signature logos, the corporate banner and every image from the
 * quoted chain below as `cid:`-referenced parts — a dozen of them is
 * ordinary. Treating those as attachments means the message list shows a
 * paperclip on almost everything, the reading pane offers `image005.png`
 * next to the real document, and the SIEVER archive writes them all out as
 * loose files beside the message. The customer's report of "vengono
 * scompattate le immagini presenti nel corpo delle mail" is that last
 * symptom; the first two are the same defect seen from other angles.
 */
import type { Attachment, ParsedMail } from 'mailparser'
import { simpleParser } from 'mailparser'

/**
 * Options every full-message parse in the app shares.
 *
 * `skipImageLinks` is the load-bearing one: left at its default, mailparser
 * rewrites each `cid:` reference in the HTML into an inline `data:` URI.
 * That is convenient for a viewer but lossy for anything that wants to
 * reconstruct the message — the archive would end up with base64 bloat in
 * the body *and* the same images written out as files. Keeping the `cid:`
 * references intact lets a consumer rebuild the original MIME structure.
 */
const MESSAGE_PARSE_OPTIONS = {
  skipImageLinks: true,
  skipTextToHtml: true,
  skipTextLinks: true
} as const

export async function parseMessageSource(source: Buffer | string): Promise<ParsedMail> {
  return simpleParser(source, MESSAGE_PARSE_OPTIONS)
}

export interface ClassifiedAttachment {
  /**
   * Position in `parsed.attachments`. Attachment downloads are keyed by this
   * index, so it has to travel with the attachment even after filtering —
   * renumbering a filtered list would hand the user the wrong file.
   */
  index: number
  attachment: Attachment
}

export interface PartitionedMessageAttachments {
  /** Files the sender deliberately attached. */
  official: ClassifiedAttachment[]
  /** Images the body renders through `cid:` — logos, signatures, quoted replies. */
  embedded: ClassifiedAttachment[]
}

/** Matches `src="cid:x"`, `background=cid:x`, and `url(cid:x)` in inline CSS. */
const CID_REFERENCE_PATTERN = /(?:src|href|background|poster)\s*=\s*(["']?)cid:([^"'\s>]+)\1/gi
const CSS_CID_REFERENCE_PATTERN = /url\(\s*(["']?)cid:([^"')\s]+)\1\s*\)/gi

/**
 * Content-IDs are quoted with angle brackets on the wire and may arrive
 * percent-encoded inside a URL. mailparser hands back the bare id, so both
 * sides are normalised to the same shape before comparing.
 */
function normalizeContentId(rawContentId: string | undefined): string {
  if (!rawContentId) {
    return ''
  }

  let value = rawContentId.trim().replace(/^<|>$/g, '')

  try {
    value = decodeURIComponent(value)
  } catch {
    // Malformed percent-escapes: compare what we were given.
  }

  return value.toLowerCase()
}

export function collectReferencedContentIds(html: string | undefined | false): Set<string> {
  const referenced = new Set<string>()

  if (typeof html !== 'string' || !html) {
    return referenced
  }

  for (const pattern of [CID_REFERENCE_PATTERN, CSS_CID_REFERENCE_PATTERN]) {
    // Shared regex objects carry `lastIndex` between calls; reset before use.
    pattern.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.exec(html)) !== null) {
      const contentId = normalizeContentId(match[2])

      if (contentId) {
        referenced.add(contentId)
      }
    }
  }

  return referenced
}

/**
 * mailparser sets `related: true` on parts that live in the message's
 * `multipart/related` container. It is not in the published typings, so it
 * is read defensively rather than cast.
 */
function isRelatedPart(attachment: Attachment): boolean {
  return (attachment as { related?: unknown }).related === true
}

/**
 * Splits a message's parts into what the sender attached and what its body
 * displays.
 *
 * A part counts as body content when any of these hold:
 *   • its Content-ID is referenced from the HTML — the decisive signal, and
 *     the reason disposition alone is not enough: Outlook happily labels a
 *     signature logo `Content-Disposition: attachment` while still drawing
 *     it through `cid:`;
 *   • mailparser placed it in the `multipart/related` container, which is
 *     where clients put body imagery even when a particular image ended up
 *     orphaned after the quoted chain was trimmed;
 *   • it is `inline` and carries a Content-ID.
 *
 * A message with no HTML body has nothing that could reference a `cid:`, so
 * everything it carries is an attachment. Without that guard a plain-text
 * message with an inline-disposed file would lose it.
 */
export function partitionMessageAttachments(parsed: ParsedMail): PartitionedMessageAttachments {
  const official: ClassifiedAttachment[] = []
  const embedded: ClassifiedAttachment[] = []
  const hasHtmlBody = typeof parsed.html === 'string' && parsed.html.trim().length > 0
  const referencedContentIds = collectReferencedContentIds(parsed.html)

  parsed.attachments.forEach((attachment, index) => {
    const classified: ClassifiedAttachment = { index, attachment }

    if (!hasHtmlBody) {
      official.push(classified)
      return
    }

    const contentId = normalizeContentId(attachment.cid)
    const disposition = attachment.contentDisposition?.trim().toLowerCase()
    const isBodyContent =
      (contentId !== '' && referencedContentIds.has(contentId)) ||
      isRelatedPart(attachment) ||
      (disposition === 'inline' && contentId !== '')

    if (isBodyContent) {
      embedded.push(classified)
      return
    }

    official.push(classified)
  })

  return { official, embedded }
}
