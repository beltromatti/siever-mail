/**
 * Italian certified mail (PEC: DM 2 novembre 2005 and its technical annex;
 * RFC 6109), read for what it is.
 *
 *   • A certified message arrives in the provider's envelope (`busta di
 *     trasporto`, `X-Trasporto: posta-certificata`): its subject is
 *     "POSTA CERTIFICATA: " and the original's, its sender "Per conto di:
 *     <address>" on the provider's address, and inside — beside the
 *     provider's words — the message itself (`postacert.eml`) and what the
 *     provider certifies (`daticert.xml`), signed (`smime.p7s`). Mail that
 *     could not be certified comes the same way as an anomaly
 *     (`X-Trasporto: errore`, "ANOMALIA MESSAGGIO: ").
 *   • What the user sends comes back as receipts (`X-Ricevuta`): accepted
 *     by their provider, delivered to each recipient — or not — each
 *     naming the message by the Message-ID their client gave it
 *     (`X-Riferimento-Message-ID`), the one the copy in Sent keeps.
 *
 * So an envelope is shown as the message it carries, with what was
 * certified; a receipt is the state of the message it is about.
 */
import { XMLParser } from 'fast-xml-parser'
import type { Attachment, ParsedMail } from 'mailparser'
import type { MessageStructureObject } from 'imapflow'

import type { MailAddress, PecCertification, PecKind, PecMessage } from '@shared/models'

import { headerValue } from './message-identity'
import { parseMessageSource } from './message-parts'

/** The headers that say a message is the provider's, fetched with every message. */
export const PEC_HEADERS = ['x-trasporto', 'x-ricevuta', 'x-riferimento-message-id'] as const

const RECEIPT_KINDS: ReadonlySet<string> = new Set<PecKind>([
  'accettazione',
  'non-accettazione',
  'presa-in-carico',
  'avvenuta-consegna',
  'errore-consegna',
  'preavviso-errore-consegna',
  'rilevazione-virus'
])

/**
 * The prefixes the providers put before the original subject, longest
 * first: "AVVISO DI NON ACCETTAZIONE PER VIRUS: " before "AVVISO DI NON
 * ACCETTAZIONE: ".
 */
const SUBJECT_PREFIXES = [
  'AVVISO DI MANCATA CONSEGNA PER SUP. TEMPO MASSIMO: ',
  'AVVISO DI NON ACCETTAZIONE PER VIRUS: ',
  'AVVISO DI MANCATA CONSEGNA PER VIRUS: ',
  'AVVISO DI NON ACCETTAZIONE: ',
  'AVVISO DI MANCATA CONSEGNA: ',
  'ANOMALIA MESSAGGIO: ',
  'POSTA CERTIFICATA: ',
  'PROBLEMA DI SICUREZZA: ',
  'PRESA IN CARICO: ',
  'ACCETTAZIONE: ',
  'CONSEGNA: '
]

/** The certification's file names: the provider's own, and RFC 6109's. */
const CERTIFICATION_FILES = new Set(['daticert.xml', 'certdata.xml'])
const MESSAGE_FILE = 'postacert.eml'
const SIGNATURE_FILE = 'smime.p7s'

/** A Message-ID as the app keeps it: without its angle brackets. */
function bareMessageId(value: string | undefined): string | null {
  const bare = value?.trim().replace(/^<|>$/g, '').trim()
  return bare ? bare : null
}

/** What a message is in certified mail, from its headers; null for any other message. */
export function pecOfHeaders(headers: Buffer | string | undefined): PecMessage | null {
  const transport = headerValue(headers, 'x-trasporto')?.trim().toLowerCase()
  const receipt = headerValue(headers, 'x-ricevuta')?.trim().toLowerCase()
  const kind: PecKind | null =
    transport === 'posta-certificata'
      ? 'busta'
      : transport === 'errore'
        ? 'anomalia'
        : receipt && RECEIPT_KINDS.has(receipt)
          ? (receipt as PecKind)
          : null

  return kind
    ? { kind, ref: bareMessageId(headerValue(headers, 'x-riferimento-message-id')) }
    : null
}

/** Whether a certified message's kind is a receipt on a message sent, not a message carried. */
export function isPecReceipt(kind: PecKind): boolean {
  return kind !== 'busta' && kind !== 'anomalia'
}

/**
 * The subject without the provider's prefix — its own, the outer one: a
 * reply's "POSTA CERTIFICATA: R: POSTA CERTIFICATA: …" keeps what the
 * people wrote.
 */
export function pecSubject(subject: string): string {
  const upper = subject.toUpperCase()
  const prefix = SUBJECT_PREFIXES.find((candidate) => upper.startsWith(candidate))
  return prefix ? subject.slice(prefix.length).trim() || subject : subject
}

/**
 * Who an envelope is from: the address the provider names after "Per
 * conto di:" — else the Reply-To it carries over, which is the sender's
 * unless they asked otherwise — never the provider's own address.
 */
export function pecSender(from: MailAddress[], replyTo: MailAddress[]): MailAddress[] {
  const onBehalf = /^per conto di:\s*<?([^\s<>"]+@[^\s<>"]+)>?/i.exec(from[0]?.name?.trim() ?? '')

  if (onBehalf) {
    return [{ address: onBehalf[1].toLowerCase() }]
  }

  return replyTo.length > 0 ? replyTo : from
}

/** A part of the envelope's structure, its file name as given. */
function fileNameOf(node: MessageStructureObject): string {
  return (node.dispositionParameters?.filename ?? node.parameters?.name ?? '').toLowerCase()
}

/** The parts of a certified message that say what it is, by their IMAP part. */
export interface PecParts {
  /** The message carried (`postacert.eml`): its whole source. */
  message?: string
  /** What the provider certifies (`daticert.xml`), and how its content is encoded. */
  certification?: { part: string; encoding: string }
}

/**
 * Where an envelope's message and certification are in its structure: by
 * their names, as the providers send them, or — a provider naming the
 * message otherwise — the one message part beside the certification.
 */
export function pecPartsOf(structure: MessageStructureObject | undefined): PecParts {
  const parts: PecParts = {}
  const messages: string[] = []

  const walk = (node: MessageStructureObject): void => {
    const type = node.type.toLowerCase()

    if (type.startsWith('multipart/')) {
      for (const child of node.childNodes ?? []) {
        walk(child)
      }
      return
    }

    if (!node.part) {
      return
    }

    const name = fileNameOf(node)

    if (CERTIFICATION_FILES.has(name)) {
      parts.certification ??= {
        part: node.part,
        encoding: (node.encoding ?? '7bit').toLowerCase()
      }
    } else if (type === 'message/rfc822') {
      if (name === MESSAGE_FILE) {
        parts.message ??= node.part
      }
      messages.push(node.part)
    }
  }

  if (structure) {
    walk(structure)
  }

  if (!parts.message && messages.length === 1) {
    parts.message = messages[0]
  }

  return parts
}

/** A part's content as the server keeps it, decoded. */
export function decodePart(content: Buffer, encoding: string): Buffer {
  switch (encoding.toLowerCase()) {
    case 'base64':
      return Buffer.from(content.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
    case 'quoted-printable':
      return Buffer.from(
        content
          .toString('latin1')
          .replace(/=\r?\n/g, '')
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          ),
        'latin1'
      )
    default:
      return content
  }
}

/** The certification's text: UTF-8 as the annex wants it, UTF-16 when it carries the byte order mark. */
function certificationText(content: Buffer): string {
  if (content[0] === 0xff && content[1] === 0xfe) {
    return content.subarray(2).toString('utf16le')
  }

  if (content[0] === 0xfe && content[1] === 0xff) {
    const swapped = Buffer.from(content.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }

  return content.toString('utf8').replace(/^\uFEFF/, '')
}

const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  trimValues: true,
  processEntities: true,
  isArray: (name) => name === 'destinatari' || name === 'ricezione'
})

type XmlNode = string | number | { '#text'?: string | number; [key: string]: unknown } | undefined

function textOf(node: XmlNode): string | null {
  const value = node === undefined ? undefined : typeof node === 'object' ? node['#text'] : node
  const text = value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim()
  return text ? text : null
}

function attributeOf(node: XmlNode, name: string): string | null {
  return node && typeof node === 'object' && typeof node[`@${name}`] === 'string'
    ? (node[`@${name}`] as string).trim() || null
    : null
}

/**
 * The certification's moment: its day (dd/mm/yyyy) and time (hh:mm:ss) in
 * the zone it states ("+0200"), as an ISO moment.
 */
function certifiedAt(data: XmlNode): string | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const day = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(textOf(data.giorno as XmlNode) ?? '')
  const time = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(textOf(data.ora as XmlNode) ?? '')
  const zone = /^([+-])(\d{2})(\d{2})$/.exec(attributeOf(data, 'zona') ?? '+0000')

  if (!day || !time || !zone) {
    return null
  }

  const pad = (value: string): string => value.padStart(2, '0')
  const at = Date.parse(
    `${day[3]}-${pad(day[2])}-${pad(day[1])}T${pad(time[1])}:${time[2]}:${time[3]}${zone[1]}${zone[2]}:${zone[3]}`
  )
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

/** What the provider certifies, read from `daticert.xml`; null when it cannot be read. */
export function parseCertification(content: Buffer): PecCertification | null {
  let root: Record<string, XmlNode>

  try {
    const parsed = XML.parse(certificationText(content)) as Record<string, unknown>
    root = parsed.postacert as Record<string, XmlNode>
  } catch {
    return null
  }

  if (!root || typeof root !== 'object') {
    return null
  }

  const header = (root.intestazione ?? {}) as Record<string, XmlNode>
  const data = (root.dati ?? {}) as Record<string, XmlNode>
  const recipients = (Array.isArray(header.destinatari) ? header.destinatari : []) as XmlNode[]
  const error = attributeOf(root as XmlNode, 'errore')

  return {
    kind: attributeOf(root as XmlNode, 'tipo') ?? '',
    error: error && error !== 'nessuno' ? error : null,
    sender: textOf(header.mittente),
    recipients: recipients.flatMap((recipient) => {
      const address = textOf(recipient)
      return address
        ? [
            {
              address: address.toLowerCase(),
              certified: attributeOf(recipient, 'tipo') !== 'esterno'
            }
          ]
        : []
    }),
    subject: textOf(header.oggetto),
    provider: textOf(data['gestore-emittente']),
    at: certifiedAt(data.data),
    id: textOf(data.identificativo),
    delivery: textOf(data.consegna)?.toLowerCase() ?? null,
    errorDetail: textOf(data['errore-esteso'])
  }
}

/**
 * Whether an attachment of a certified message is the provider's — the
 * certification, the signature — not a file the sender attached: shown with
 * what was certified, not among the files. The message carried is not
 * among them: in line, as the providers send it, its files are the
 * envelope's; as an attachment, it stays one, to be opened.
 */
export function isCertificationAttachment(
  attachment: Pick<Attachment, 'filename' | 'contentType'>
): boolean {
  const name = attachment.filename?.toLowerCase() ?? ''
  return (
    CERTIFICATION_FILES.has(name) ||
    name === SIGNATURE_FILE ||
    /pkcs7-signature/i.test(attachment.contentType)
  )
}

/** Whether a part of a message's structure is a PEC certification: small, and what says the rest. */
export function isCertificationPart(node: MessageStructureObject): boolean {
  return CERTIFICATION_FILES.has(fileNameOf(node))
}

/**
 * Whether a part of a certified message is the provider's own and not a
 * file: the certification, the signature, the wrapping of the message
 * carried (whose files are files).
 */
export function isPecProviderPart(node: MessageStructureObject): boolean {
  const type = node.type.toLowerCase()
  return (
    isCertificationPart(node) ||
    /pkcs7-signature/.test(type) ||
    fileNameOf(node) === SIGNATURE_FILE ||
    (type === 'message/rfc822' && fileNameOf(node) === MESSAGE_FILE)
  )
}

/** What a certified message is, read: the message it carries, and what the provider certifies. */
export interface ReadPec {
  message: PecMessage
  /** The message carried, parsed — for an envelope; null for a receipt, or when it cannot be read. */
  inner: ParsedMail | null
  certification: PecCertification | null
}

/**
 * Reads the parts of a certified message that say what it is, through
 * `partsOf` — the parts already downloaded, or fetched now: the message an
 * envelope carries, and the certification of either kind.
 */
export async function readPec(
  message: PecMessage,
  structure: MessageStructureObject | undefined,
  partsOf: (parts: string[]) => Promise<Map<string, Buffer>>
): Promise<ReadPec> {
  const parts = pecPartsOf(structure)
  const wanted = [
    ...(parts.certification ? [parts.certification.part] : []),
    ...(parts.message && !isPecReceipt(message.kind) ? [parts.message] : [])
  ]
  const contents = wanted.length > 0 ? await partsOf(wanted) : new Map<string, Buffer>()
  const certification = parts.certification ? contents.get(parts.certification.part) : undefined
  const carried = parts.message ? contents.get(parts.message) : undefined

  return {
    message,
    inner:
      carried && !isPecReceipt(message.kind)
        ? await parseMessageSource(carried).catch(() => null)
        : null,
    certification: certification
      ? parseCertification(decodePart(certification, parts.certification!.encoding))
      : null
  }
}
