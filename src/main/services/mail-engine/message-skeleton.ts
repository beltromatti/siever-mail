import type { MessageStructureObject } from 'imapflow'

/**
 * A large message is read without its attachments. Fifteen megabytes of
 * drawings behind three lines of text used to keep the reading pane waiting
 * for all fifteen; past this size only the text and the pictures the text
 * draws are downloaded, and each attachment comes down by itself when it is
 * opened or saved. Below it, one download of the whole message is quicker
 * than the two round trips that picking parts takes.
 */
export const PARTIAL_BODY_THRESHOLD_BYTES = 512 * 1024

/** The types mailparser reads as the body of a message, and not as files. */
const BODY_TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/html',
  'message/delivery-status'
])

/** What a message without its attachments is downloaded as. */
export interface PartialBodyPlan {
  /** Every part below the top, by the header that describes it. */
  headerParts: string[]
  /** The parts whose content the body needs: its text, and the pictures it draws. */
  contentParts: string[]
  /** The parts left out, with their size on the wire. */
  omittedParts: Map<string, MessageStructureObject>
}

/**
 * Whether a part is part of what the reader shows. The test mirrors how
 * mailparser tells body from files — by type and disposition — so the
 * message rebuilt from the parts it names reads exactly as the whole one
 * would, files in the same places and order:
 *   • the body's text is a text part not marked as an attachment;
 *   • a picture with a Content-ID is one the HTML draws through `cid:`
 *     (Outlook marks its signature logos as attachments all the same);
 *   • an embedded message not marked as an attachment may be read as part
 *     of the body, its files with it, so it comes whole.
 */
function isBodyContent(node: MessageStructureObject): boolean {
  const type = node.type.toLowerCase()
  const disposition = node.disposition?.toLowerCase()

  if (type === 'message/rfc822') {
    return disposition !== 'attachment'
  }

  if (BODY_TEXT_TYPES.has(type)) {
    return !disposition || disposition === 'inline'
  }

  return Boolean(node.id) && type.startsWith('image/')
}

function isMultipart(node: MessageStructureObject): boolean {
  return node.type.toLowerCase().startsWith('multipart/')
}

/**
 * The parts to download for the body of a message with this structure, or
 * null when it cannot be rebuilt from parts — a message that is a single
 * part, or a container whose boundary the server did not report.
 */
export function planPartialBody(structure: MessageStructureObject): PartialBodyPlan | null {
  if (!isMultipart(structure) || !structure.parameters?.boundary) {
    return null
  }

  const plan: PartialBodyPlan = { headerParts: [], contentParts: [], omittedParts: new Map() }

  const walk = (node: MessageStructureObject): boolean =>
    (node.childNodes ?? []).every((child) => {
      if (!child.part) {
        return false
      }

      plan.headerParts.push(child.part)

      if (isMultipart(child)) {
        return Boolean(child.parameters?.boundary) && walk(child)
      }

      if (isBodyContent(child)) {
        plan.contentParts.push(child.part)
      } else {
        plan.omittedParts.set(child.part, child)
      }

      return true
    })

  return walk(structure) ? plan : null
}

/** IMAP names a part's own header `<part>.MIME`; imapflow keys answers in lowercase. */
export function partHeaderKey(part: string): string {
  return `${part}.mime`
}

/** A header block that ends with exactly the empty line separating it from the content. */
function headerBlock(header: Buffer): Buffer {
  let end = header.length

  while (end > 0 && (header[end - 1] === 0x0a || header[end - 1] === 0x0d)) {
    end -= 1
  }

  return Buffer.concat([header.subarray(0, end), Buffer.from('\r\n\r\n')])
}

/**
 * The message as it is on the server, but with only the content of the
 * parts in `parts` (keyed as imapflow keys them: `1.2`, and `1.2.mime` for
 * a part's header): every other part keeps its header and is left empty.
 * Parsed, it yields the same body and the same attachments in the same
 * order as the whole message — the files just have no content.
 */
export function buildPartialSource(
  header: Buffer,
  structure: MessageStructureObject,
  parts: ReadonlyMap<string, Buffer>
): Buffer {
  const chunks: Buffer[] = [headerBlock(header)]

  const writeMultipart = (node: MessageStructureObject): void => {
    const boundary = node.parameters?.boundary as string

    for (const child of node.childNodes ?? []) {
      const part = child.part as string
      const childHeader = parts.get(partHeaderKey(part))

      if (!childHeader) {
        throw new Error(`Il server non ha inviato l'intestazione della parte ${part}.`)
      }

      chunks.push(Buffer.from(`--${boundary}\r\n`), headerBlock(childHeader))

      if (isMultipart(child)) {
        writeMultipart(child)
      } else {
        chunks.push(parts.get(part) ?? Buffer.alloc(0))
      }

      // The line break before a delimiter belongs to the delimiter.
      chunks.push(Buffer.from('\r\n'))
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`))
  }

  writeMultipart(structure)
  return Buffer.concat(chunks)
}

/** One part on its own, as a message of a single part, for its content alone. */
export function buildPartSource(partHeader: Buffer, content: Buffer): Buffer {
  return Buffer.concat([headerBlock(partHeader), content])
}

/**
 * The size of a part's content once decoded, from its size on the wire:
 * base64 carries three bytes in four characters, in lines of 76 and a line
 * break. Shown next to an attachment that was not downloaded.
 */
export function decodedPartSize(node: MessageStructureObject): number {
  const size = node.size ?? 0
  return node.encoding?.toLowerCase() === 'base64' ? Math.floor((size * 57) / 78) : size
}
