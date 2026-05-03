import type { FetchMessageObject, MessageAddressObject, MessageStructureObject } from 'imapflow'
import type { ParsedMail } from 'mailparser'

import type { MailAddress, MailAttachment, MailMessageDetail } from '@shared/models'

import { extractPreview, parseMessagePayload } from './preview'

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
    name: address.name || undefined,
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

export function pickAddresses(primary: MailAddress[], fallback: MailAddress[]): MailAddress[] {
  return primary.length > 0 ? primary : fallback
}

export function hasAttachmentInStructure(structure?: MessageStructureObject): boolean {
  if (!structure) {
    return false
  }

  const disposition = structure.disposition?.toLowerCase()

  if (disposition === 'attachment') {
    return true
  }

  if (disposition === 'inline' && structure.dispositionParameters?.filename) {
    return true
  }

  return Boolean(structure.childNodes?.some((node) => hasAttachmentInStructure(node)))
}

export function formatSubject(subject: string | undefined): string {
  return subject?.trim() ? subject.trim() : '(Senza oggetto)'
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

export async function mapFetchedToDetail(
  accountId: string,
  folderPath: string,
  fetched: FetchMessageObject
): Promise<MailMessageDetail> {
  if (!fetched.source) {
    throw new Error('Message source not available from IMAP server.')
  }

  const parsed = await parseMessagePayload(fetched.source)

  return mergeSummaryAndParsedIntoDetail(accountId, folderPath, fetched, parsed)
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

export function mergeSummaryAndParsedIntoDetail(
  accountId: string,
  folderPath: string,
  fetched: FetchMessageObject,
  parsed: ParsedMail
): MailMessageDetail {
  const envelope = fetched.envelope
  const flags = [...(fetched.flags ?? new Set<string>())]
  const subject = formatSubject(parsed.subject || envelope?.subject)

  const attachments: MailAttachment[] = parsed.attachments.map((attachment, index) => ({
    id: `${fetched.uid}-${index}`,
    fileName: attachment.filename || `attachment-${index + 1}`,
    contentType: attachment.contentType,
    size: attachment.size,
    cid: attachment.cid || undefined
  }))

  const rawHtml = typeof parsed.html === 'string' ? parsed.html : undefined
  const html = rawHtml ? inlineCidReferences(rawHtml, parsed) : undefined

  return {
    accountId,
    folderPath,
    uid: fetched.uid,
    threadId: fetched.threadId,
    messageId: envelope?.messageId,
    subject,
    from: pickAddresses(
      mapAddresses(parsed.from?.value as MessageAddressObject[] | undefined),
      mapAddresses(envelope?.from)
    ),
    to: pickAddresses(
      mapAddresses(parsed.to?.value as MessageAddressObject[] | undefined),
      mapAddresses(envelope?.to)
    ),
    cc: pickAddresses(
      mapAddresses(parsed.cc?.value as MessageAddressObject[] | undefined),
      mapAddresses(envelope?.cc)
    ),
    bcc: pickAddresses(
      mapAddresses(parsed.bcc?.value as MessageAddressObject[] | undefined),
      mapAddresses(envelope?.bcc)
    ),
    date: internalDateToIso(fetched.internalDate),
    preview: extractPreview(parsed, subject),
    // Full body is available here (mergeSummaryAndParsedIntoDetail is called for
    // message-open / archive / attachment fetches, all of which hand over the
    // complete parsed MIME tree), so the preview we extract is authoritative.
    previewHydrated: true,
    flags,
    isRead: flags.includes('\\Seen'),
    hasAttachments: attachments.length > 0 || hasAttachmentInStructure(fetched.bodyStructure),
    size: fetched.size ?? fetched.source?.length ?? 0,
    html,
    text: parsed.text || undefined,
    attachments
  }
}
