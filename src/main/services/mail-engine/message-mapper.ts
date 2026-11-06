import type { FetchMessageObject, MessageAddressObject, MessageStructureObject } from 'imapflow'
import type { AddressObject, ParsedMail } from 'mailparser'

import type { FetchedMessageDetail, MailAddress, MailAttachment } from '@shared/models'
import { cleanDisplayName, deriveSenderKey, deriveSenderName } from '@shared/sender'
import { EMPTY_SUBJECT_LABEL } from '@shared/subject'

import {
  contentDigest,
  headerValue,
  messageIdsIn,
  messageKeyFor,
  normalizeMessageId,
  threadKeyFor,
  type IdentityClaim
} from './message-identity'
import { extractPreview } from './preview'
import {
  attachmentFileName,
  parseMessageSource,
  partitionMessageAttachments
} from './message-parts'
import {
  isCertificationAttachment,
  isPecReceipt,
  pecOfHeaders,
  pecSender,
  pecSubject,
  type ReadPec
} from './pec'

export interface PartialMessage {
  accountId: string
  folderPath: string
  fetched: FetchMessageObject
}

function normalizeAddress(address: MessageAddressObject): MailAddress | null {
  if (!address.address) {
    return null
  }

  return {
    name: cleanDisplayName(address.name),
    address: address.address
  }
}

export function mapAddresses(addresses: MessageAddressObject[] | undefined): MailAddress[] {
  if (!addresses) {
    return []
  }

  return addresses
    .map(normalizeAddress)
    .filter((address): address is MailAddress => Boolean(address))
}

/** The References header as mailparser reads it: one id, several, or none. */
function parsedReferences(references: string | string[] | undefined): string[] {
  return (Array.isArray(references) ? references : references ? [references] : [])
    .map((reference) => reference.trim())
    .filter(Boolean)
}

/** A header mailparser read: one address list, or several when the header repeats. */
export function mapParsedAddresses(
  field: AddressObject | AddressObject[] | undefined
): MailAddress[] {
  const lists = Array.isArray(field) ? field : field ? [field] : []
  return mapAddresses(lists.flatMap((list) => list.value) as MessageAddressObject[])
}

export function pickAddresses(primary: MailAddress[], fallback: MailAddress[]): MailAddress[] {
  return primary.length > 0 ? primary : fallback
}

/**
 * An image part that carries a Content-ID is body imagery — a signature
 * logo, a banner, a picture from the quoted chain below. Clients only assign
 * a Content-ID to parts they intend to reference from the HTML.
 *
 * The envelope fetch has no body to check those references against (that is
 * what `partitionMessageAttachments` does once the body is in hand), so this
 * is the closest signal available at list time. Without it the paperclip
 * appears on nearly every message an Outlook user sends and stops meaning
 * anything.
 */
function isEmbeddedBodyImagePart(structure: MessageStructureObject): boolean {
  return Boolean(structure.id) && (structure.type ?? '').toLowerCase().startsWith('image/')
}

/**
 * Whether a message's structure carries a file the sender attached; the
 * parts `ignored` says are not files are not counted, what they hold is.
 */
export function hasAttachmentInStructure(
  structure?: MessageStructureObject,
  ignored: (node: MessageStructureObject) => boolean = () => false
): boolean {
  if (!structure) {
    return false
  }

  if (!ignored(structure) && !isEmbeddedBodyImagePart(structure)) {
    const disposition = structure.disposition?.toLowerCase()

    if (disposition === 'attachment') {
      return true
    }

    if (disposition === 'inline' && structure.dispositionParameters?.filename) {
      return true
    }
  }

  return Boolean(structure.childNodes?.some((node) => hasAttachmentInStructure(node, ignored)))
}

export function formatSubject(subject: string | undefined): string {
  return subject?.trim() ? subject.trim() : EMPTY_SUBJECT_LABEL
}

export function internalDateToIso(internalDate: Date | string | undefined): string {
  if (internalDate instanceof Date && !Number.isNaN(internalDate.valueOf())) {
    return internalDate.toISOString()
  }

  if (typeof internalDate === 'string' && internalDate.trim()) {
    const parsed = new Date(internalDate)

    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString()
    }
  }

  return new Date().toISOString()
}

/**
 * Who a fetched message is, and the conversation it belongs to (see
 * `message-identity.ts`), from what every fetch asks for: the server's ids
 * (`emailId`, `threadId`), the envelope, and the References header. Worked
 * out from the envelope alone, so the list's fetch and a body's agree.
 */
export function fetchedIdentity(
  fetched: FetchMessageObject,
  references: ReadonlyArray<string> = messageIdsIn(headerValue(fetched.headers, 'references'))
): { messageKey: string; threadId: string } {
  const envelope = fetched.envelope
  const messageKey = messageKeyFor({
    emailId: fetched.emailId,
    messageId: envelope?.messageId,
    from: mapAddresses(envelope?.from),
    date: internalDateToIso(fetched.internalDate),
    subject: formatSubject(envelope?.subject),
    size: fetched.size ?? 0
  })

  return {
    messageKey,
    threadId: threadKeyFor({
      serverThreadId: fetched.threadId,
      references,
      inReplyTo: envelope?.inReplyTo,
      messageId: envelope?.messageId,
      messageKey
    })
  }
}

/** The Date header as the envelope gives it: parsed when it could be, as written otherwise. */
function headerDateText(date: Date | string | undefined): string | undefined {
  if (date instanceof Date) {
    return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
  }

  return date?.trim() || undefined
}

/**
 * Who a message fetched for the list says it is, for the cache to settle
 * (see `settleIdentity`): `fetchedIdentity`, and what tells it from another
 * message. A reply that names no References, on a server that gives no
 * thread, names the message it replies to.
 */
export function fetchedIdentityClaim(fetched: FetchMessageObject): IdentityClaim {
  const envelope = fetched.envelope
  const references = messageIdsIn(headerValue(fetched.headers, 'references'))
  // A PEC receipt names no References: it is the message sent's, which it names otherwise.
  const pec = pecOfHeaders(fetched.headers)
  const parent =
    !fetched.threadId?.trim() && references.length === 0
      ? pec && isPecReceipt(pec.kind)
        ? normalizeMessageId(pec.ref ?? undefined)
        : normalizeMessageId(envelope?.inReplyTo)
      : null

  return {
    uid: fetched.uid,
    ...fetchedIdentity(fetched, references),
    parentMessageId: parent ?? undefined,
    date: internalDateToIso(fetched.internalDate),
    digest: contentDigest({
      sentAt: headerDateText(envelope?.date),
      from: mapAddresses(envelope?.from),
      subject: formatSubject(envelope?.subject)
    })
  }
}

export async function mapFetchedToDetail(
  accountId: string,
  folderPath: string,
  fetched: FetchMessageObject,
  pec: ReadPec | null = null
): Promise<FetchedMessageDetail> {
  if (!fetched.source) {
    throw new Error('Message source not available from IMAP server.')
  }

  const parsed = await parseMessageSource(fetched.source)

  return mergeSummaryAndParsedIntoDetail(accountId, folderPath, fetched, parsed, pec)
}

function buildDataUri(contentType: string | undefined, content: Buffer): string {
  const type = contentType?.trim() || 'application/octet-stream'
  return `data:${type};base64,${content.toString('base64')}`
}

function inlineCidReferences(html: string, parsed: ParsedMail): string {
  const cidIndex = new Map<string, { contentType: string; content: Buffer }>()

  for (const attachment of parsed.attachments) {
    const cid = attachment.cid?.trim()
    if (!cid) {
      continue
    }

    cidIndex.set(cid.toLowerCase(), {
      contentType: attachment.contentType || 'application/octet-stream',
      content: Buffer.from(attachment.content)
    })
  }

  if (cidIndex.size === 0) {
    return html
  }

  // Matches href/src/background/poster="cid:..." in any quoting style.
  const cidReferencePattern = /(src|href|background|poster)\s*=\s*(['"]?)cid:([^'"\s>]+)\2/gi

  return html.replace(
    cidReferencePattern,
    (match, attribute: string, quote: string, cid: string) => {
      const resolved = cidIndex.get(cid.trim().toLowerCase())
      if (!resolved) {
        return match
      }

      const quoteChar = quote || '"'
      return `${attribute}=${quoteChar}${buildDataUri(resolved.contentType, resolved.content)}${quoteChar}`
    }
  )
}

/**
 * A fetched message as the app reads it. A certified envelope (`pec`, read
 * by `readPec`) is the message it carries — its sender, subject, words and
 * files — with what the provider certified beside it; a receipt keeps the
 * provider's words, its subject the message's it is about. The provider's
 * own files (certification, signature) are not among the files.
 */
export function mergeSummaryAndParsedIntoDetail(
  accountId: string,
  folderPath: string,
  fetched: FetchMessageObject,
  outer: ParsedMail,
  pec: ReadPec | null = null
): FetchedMessageDetail {
  const envelope = fetched.envelope
  const flags = [...(fetched.flags ?? new Set<string>())]
  const receipt = pec !== null && isPecReceipt(pec.message.kind)
  // The message carried, for an envelope: what is read is it.
  const parsed = pec?.inner ?? outer
  const subject = formatSubject(
    pec?.inner
      ? parsed.subject || pecSubject(envelope?.subject ?? '')
      : pec
        ? pecSubject(outer.subject || envelope?.subject || '')
        : parsed.subject || envelope?.subject
  )

  // Only what the sender actually attached reaches the reading pane's
  // attachment list. Body imagery is already rendered inside the message, so
  // listing it again offers the user `image005.png` next to the one document
  // that matters. The id keeps the attachment's ORIGINAL index: downloads
  // re-parse the message and index straight into `parsed.attachments`, so
  // renumbering a filtered list would fetch the wrong file.
  //
  // A certified envelope's files are the outer message's — mailparser reads the message the
  // provider carries in line as part of it, its files with their parts — but for the
  // provider's own; a receipt has none of the user's (its copy of the message sent is in Sent).
  const attachments: MailAttachment[] = receipt
    ? []
    : partitionMessageAttachments(outer)
        .official.filter(({ attachment }) => !pec || !isCertificationAttachment(attachment))
        .map(({ index, attachment }) => ({
          id: `${fetched.uid}-${index}`,
          fileName: attachmentFileName(attachment, index),
          contentType: attachment.contentType,
          size: attachment.size,
          cid: attachment.cid || undefined,
          part: attachment.partId ?? undefined
        }))

  const rawHtml = typeof parsed.html === 'string' ? parsed.html : undefined
  const html = rawHtml ? inlineCidReferences(rawHtml, parsed) : undefined

  const from = pec?.inner
    ? pickAddresses(
        mapParsedAddresses(parsed.from),
        pecSender(mapAddresses(envelope?.from), mapAddresses(envelope?.replyTo))
      )
    : pec?.message.kind === 'busta' || pec?.message.kind === 'anomalia'
      ? pecSender(mapAddresses(envelope?.from), mapAddresses(envelope?.replyTo))
      : pickAddresses(mapParsedAddresses(parsed.from), mapAddresses(envelope?.from))
  const references = parsedReferences(parsed.references)

  return {
    accountId,
    folderPath,
    uid: fetched.uid,
    ...fetchedIdentity(
      fetched,
      references.map((reference) => reference.replace(/^<|>$/g, ''))
    ),
    messageId: envelope?.messageId,
    subject,
    from,
    to: pickAddresses(mapParsedAddresses(parsed.to), mapAddresses(envelope?.to)),
    cc: pickAddresses(mapParsedAddresses(parsed.cc), mapAddresses(envelope?.cc)),
    bcc: pickAddresses(mapParsedAddresses(parsed.bcc), mapAddresses(envelope?.bcc)),
    replyTo: pickAddresses(mapParsedAddresses(parsed.replyTo), mapAddresses(envelope?.replyTo)),
    references,
    date: internalDateToIso(fetched.internalDate),
    preview: extractPreview(parsed, subject),
    // Full body is available here (mergeSummaryAndParsedIntoDetail is called for
    // message-open / archive / attachment fetches, all of which hand over the
    // complete parsed MIME tree), so the preview we extract is authoritative.
    previewHydrated: true,
    flags,
    isRead: flags.includes('\\Seen'),
    isFlagged: flags.includes('\\Flagged'),
    hasAttachments: attachments.length > 0 || hasAttachmentInStructure(fetched.bodyStructure),
    size: fetched.size ?? fetched.source?.length ?? 0,
    senderName: deriveSenderName(from),
    senderKey: deriveSenderKey(from),
    html,
    text: parsed.text || undefined,
    attachments,
    ...(pec
      ? {
          pec: pec.message,
          pecDetail: {
            ...pec.message,
            certification: pec.certification,
            envelopeText: pec.inner ? outer.text?.trim() || null : null
          }
        }
      : {})
  }
}
