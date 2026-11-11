/* eslint-disable no-control-regex -- binary formats: their control characters are the structure */
import { unzipSync } from 'fflate'

/**
 * Readers of the documents that are not text on their face: the binary
 * formats of offices that still travel every day — Word 97–2003, Outlook's
 * saved messages, RTF, the digitally signed envelopes (.p7m), archives — and
 * the text of any format, whatever the program that wrote it. Each gives
 * what a person reading the document would see, in order; none needs a
 * program of the computer, so they read the same on every system.
 */

const WINDOWS_1252 = new TextDecoder('windows-1252')
/** Bytes looked at to tell a text from a binary file. */
export const TEXT_SNIFF_BYTES = 64 * 1024

/**
 * A text file as it was written: UTF-8, UTF-16 with its mark (as Windows
 * writes "Unicode" text), and what is not UTF-8 in Windows' Western code
 * page — Excel's CSV, a program of the office, a file from an old PC.
 */
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(data.subarray(3))
  }

  if (data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(data.subarray(2))
  }

  if (data[0] === 0xfe && data[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(data.subarray(2))
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return WINDOWS_1252.decode(data)
  }
}

/**
 * Whether a file is text, from its first bytes: the formats of every trade
 * that are text inside — a drawing exchanged as DXF, a model as IFC or STEP,
 * a track, a dataset, a configuration, code — read as text, without a list
 * of their names.
 */
export function looksLikeText(data: Uint8Array): boolean {
  const head = data.subarray(0, TEXT_SNIFF_BYTES)

  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) {
    return true
  }

  let control = 0

  for (const byte of head) {
    if (byte === 0) {
      return false
    }

    // Tab, new lines, form feed and escape are text; the other control bytes are not.
    if (
      byte < 0x20 &&
      byte !== 0x09 &&
      byte !== 0x0a &&
      byte !== 0x0c &&
      byte !== 0x0d &&
      byte !== 0x1b
    ) {
      control++
    }
  }

  return control <= head.length / 100
}

/* ─────────────────────────── OLE compound files ─────────────────────────── */

/** The streams of an OLE compound file (Word 97–2003, Outlook .msg), by their full path. */
async function compoundStreams(data: Buffer): Promise<Map<string, Buffer>> {
  const { CFB } = await import('xlsx')
  const container = CFB.read(data, { type: 'buffer' })
  const streams = new Map<string, Buffer>()

  container.FullPaths.forEach((path, index) => {
    const content = container.FileIndex[index]?.content

    if (content && content.length > 0) {
      // "Root Entry/WordDocument" → "WordDocument"
      streams.set(path.slice(path.indexOf('/') + 1), Buffer.from(content as Uint8Array))
    }
  })

  return streams
}

/**
 * The text of a Word 97–2003 document: its pieces of text in order, as
 * the piece table of the document says ([MS-DOC] 2.8.35) — the body, then
 * notes, headers and footers. A field shows its result, not its code.
 */
export async function wordDocumentText(data: Buffer): Promise<string | { reason: string }> {
  const streams = await compoundStreams(data)
  const word = streams.get('WordDocument')

  if (!word || word.length < 0x1aa) {
    return { reason: 'Il file .doc non ha il testo di un documento Word.' }
  }

  const flags = word.readUInt16LE(0x0a)

  if (flags & 0x0100) {
    return { reason: 'Il documento Word è protetto da password.' }
  }

  const table = streams.get(flags & 0x0200 ? '1Table' : '0Table')
  // FibRgFcLcb97.fcClx / lcbClx: where the piece table is, in the table stream.
  const clxStart = word.readUInt32LE(0x1a2)
  const clxEnd = clxStart + word.readUInt32LE(0x1a6)

  if (!table || clxEnd > table.length || clxEnd === clxStart) {
    return { reason: 'Il documento Word non dice dove sta il suo testo.' }
  }

  let at = clxStart

  // Formatting first (Prc), then the piece table (Pcdt).
  while (at < clxEnd && table[at] === 0x01) {
    at += 3 + table.readUInt16LE(at + 1)
  }

  if (table[at] !== 0x02) {
    return { reason: 'Il documento Word non dice dove sta il suo testo.' }
  }

  const plc = at + 5
  const pieces = Math.floor((table.readUInt32LE(at + 1) - 4) / 12)
  let text = ''

  for (let piece = 0; piece < pieces; piece++) {
    const length = table.readUInt32LE(plc + (piece + 1) * 4) - table.readUInt32LE(plc + piece * 4)
    const fc = table.readUInt32LE(plc + (pieces + 1) * 4 + piece * 8 + 2)
    const offset = fc & 0x3fffffff

    text +=
      fc & 0x40000000
        ? WINDOWS_1252.decode(word.subarray(offset / 2, offset / 2 + length))
        : word.subarray(offset, offset + length * 2).toString('utf16le')
  }

  return text
    .replace(/\u0013[^\u0013\u0014\u0015]*\u0014/g, '')
    .replace(/\u0013[^\u0013\u0014\u0015]*\u0015/g, '')
    .replace(/[\u0014\u0015]/g, '')
    .replace(/\u0007/g, '\t')
    .replace(/[\r\u000b\u000c]/g, '\n')
    .replace(/[\u0000-\u0008\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A message saved from Outlook (.msg) as it reads: who wrote it, to whom,
 * when, the subject, the text and the names of its attachments
 * ([MS-OXMSG]: each property a stream, Unicode or the code page's).
 */
export async function outlookMessageText(
  data: Buffer,
  htmlToText: (html: string) => string
): Promise<string | { reason: string }> {
  const streams = await compoundStreams(data)
  const property = (id: string, inside = ''): string | undefined => {
    const unicode = streams.get(`${inside}__substg1.0_${id}001F`)

    if (unicode) {
      return unicode.toString('utf16le').replace(/\u0000+$/, '')
    }

    const ansi = streams.get(`${inside}__substg1.0_${id}001E`)
    return ansi ? WINDOWS_1252.decode(ansi).replace(/\u0000+$/, '') : undefined
  }

  const subject = property('0037')
  const body =
    property('1000')?.trim() ||
    htmlToText(decodeText(streams.get('__substg1.0_10130102') ?? Buffer.alloc(0))).trim()

  if (subject === undefined && !body) {
    return { reason: 'Il file .msg non ha le parti di un messaggio di Outlook.' }
  }

  const sender = [property('0C1A'), property('5D01') ?? property('0C1F')].filter(Boolean).join(' ')
  const date = property('007D')
    ?.match(/^Date:\s*(.+)$/im)?.[1]
    ?.trim()
  const attachments = [
    ...new Set(
      [...streams.keys()]
        .map((path) => path.match(/^(__attach_version1\.0_#[0-9A-F]{8}\/)/i)?.[1])
        .filter((path): path is string => Boolean(path))
    )
  ]
    .map((inside) => property('3707', inside) ?? property('3704', inside))
    .filter(Boolean)

  return [
    `Da: ${sender}`,
    `A: ${property('0E04') ?? ''}`,
    ...(property('0E03') ? [`Cc: ${property('0E03')}`] : []),
    ...(date ? [`Data: ${date}`] : []),
    `Oggetto: ${subject ?? ''}`,
    '',
    body ?? '',
    ...(attachments.length > 0 ? ['', `Allegati: ${attachments.join(', ')}`] : [])
  ].join('\n')
}

/* ─────────────────────────────────── RTF ─────────────────────────────────── */

/** Groups whose words are not the document's text: tables of fonts and colours, pictures, metadata. */
const RTF_SKIPPED_GROUPS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'filetbl',
  'revtbl',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf'
])

/** The text of an RTF document, as a word processor shows it: paragraphs, tabs, accented letters. */
export function rtfText(source: string): string {
  const out: string[] = []
  // Per group: whether its words are skipped, and how many characters follow a \u as its fallback.
  const stack: Array<{ skip: boolean; uc: number }> = [{ skip: false, uc: 1 }]
  let state = stack[0]
  let fallback = 0
  let bytes: number[] = []
  const flush = (): void => {
    if (bytes.length > 0) {
      out.push(WINDOWS_1252.decode(Uint8Array.from(bytes)))
      bytes = []
    }
  }
  const emit = (text: string): void => {
    flush()

    if (!state.skip) {
      out.push(text)
    }
  }

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (char === '{') {
      flush()
      state = { ...state }
      stack.push(state)
      continue
    }

    if (char === '}') {
      flush()
      stack.pop()
      state = stack[stack.length - 1] ?? { skip: false, uc: 1 }
      continue
    }

    if (char === '\\') {
      const next = source[i + 1]

      if (next === "'") {
        const byte = parseInt(source.slice(i + 2, i + 4), 16)
        i += 3

        if (fallback > 0) {
          fallback--
        } else if (!state.skip && !Number.isNaN(byte)) {
          bytes.push(byte)
        }

        continue
      }

      // A backslash before a new line is a paragraph, as \par is.
      if (next === '\n' || next === '\r') {
        emit('\n')
        i++
        continue
      }

      if (next === '\\' || next === '{' || next === '}') {
        emit(next)
        i++
        continue
      }

      if (next === '*') {
        state.skip = true
        i++
        continue
      }

      const word = /^([a-z]+)(-?\d+)? ?/i.exec(source.slice(i + 1, i + 40))

      if (!word) {
        // A control symbol: \~ is a space that does not break, \- and \_ are hyphens.
        emit(next === '~' ? ' ' : next === '_' ? '-' : '')
        i++
        continue
      }

      i += word[0].length
      const [, name, value] = word

      if (RTF_SKIPPED_GROUPS.has(name)) {
        state.skip = true
      } else if (name === 'uc') {
        state.uc = Number(value ?? 1)
      } else if (name === 'u') {
        const code = Number(value)
        emit(String.fromCharCode(code < 0 ? code + 65536 : code))
        fallback = state.uc
      } else if (name === 'par' || name === 'line' || name === 'row' || name === 'sect') {
        emit('\n')
      } else if (name === 'tab' || name === 'cell') {
        emit('\t')
      } else if (name === 'emdash') {
        emit('—')
      } else if (name === 'endash') {
        emit('–')
      } else if (name === 'bullet') {
        emit('•')
      } else if (name === 'lquote' || name === 'rquote') {
        emit(name === 'lquote' ? '‘' : '’')
      } else if (name === 'ldblquote' || name === 'rdblquote') {
        emit(name === 'ldblquote' ? '“' : '”')
      }

      continue
    }

    if (char === '\r' || char === '\n') {
      continue
    }

    if (fallback > 0) {
      fallback--
      continue
    }

    emit(char)
  }

  flush()
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ──────────────────────────── signed envelopes ──────────────────────────── */

interface Tlv {
  tag: number
  start: number
  end: number
  next: number
}

/** One BER element at `at`: definite or indefinite length. */
function tlv(data: Uint8Array, at: number): Tlv {
  if (at + 2 > data.length) {
    throw new Error('ASN.1 troncato')
  }

  const tag = data[at]
  let cursor = at + 1
  const first = data[cursor++]

  if (first === 0x80) {
    const start = cursor
    let end = start

    while (!(data[end] === 0 && data[end + 1] === 0)) {
      end = tlv(data, end).next

      if (end >= data.length) {
        throw new Error('ASN.1 troncato')
      }
    }

    return { tag, start, end, next: end + 2 }
  }

  let length = first

  if (first & 0x80) {
    length = 0

    for (let count = first & 0x7f; count > 0; count--) {
      length = length * 256 + data[cursor++]
    }
  }

  if (cursor + length > data.length) {
    throw new Error('ASN.1 troncato')
  }

  return { tag, start: cursor, end: cursor + length, next: cursor + length }
}

function children(data: Uint8Array, node: Tlv): Tlv[] {
  const found: Tlv[] = []

  for (let at = node.start; at < node.end;) {
    const child = tlv(data, at)
    found.push(child)
    at = child.next
  }

  return found
}

function octets(data: Uint8Array, node: Tlv): Uint8Array[] {
  return node.tag === 0x04
    ? [data.subarray(node.start, node.end)]
    : children(data, node).flatMap((child) => octets(data, child))
}

/**
 * The document inside a digitally signed envelope (CAdES, `.p7m`): the
 * signed content of the CMS SignedData (RFC 5652), in DER or BER, or in
 * Base64 as some programs save it. None when the envelope does not carry
 * it (a detached signature).
 */
export function signedEnvelopeContent(data: Buffer): Buffer | null {
  let der: Uint8Array = data

  if (data[0] !== 0x30) {
    const base64 = data
      .toString('latin1')
      .replace(/-----[^-]+-----/g, '')
      .replace(/\s+/g, '')

    if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
      return null
    }

    der = Buffer.from(base64, 'base64')
  }

  try {
    // ContentInfo { contentType, [0] SignedData { version, digestAlgorithms, encapContentInfo { eContentType, [0] eContent } } }
    const signedData = children(der, tlv(der, 0)).find((node) => node.tag === 0xa0)
    const sequence = signedData && children(der, signedData)[0]
    const encapsulated = sequence && children(der, sequence).find((node) => node.tag === 0x30)
    const explicit = encapsulated && children(der, encapsulated).find((node) => node.tag === 0xa0)
    const content = explicit && children(der, explicit)[0]

    return content ? Buffer.concat(octets(der, content)) : null
  } catch {
    return null
  }
}

/* ───────────────────────────────── archives ──────────────────────────────── */

/** What a ZIP archive holds, without unpacking it: each file with its size. */
export function zipListing(data: Buffer): string {
  const entries: Array<{ name: string; size: number }> = []

  unzipSync(new Uint8Array(data), {
    filter: (file) => {
      if (!file.name.endsWith('/')) {
        entries.push({ name: file.name, size: file.originalSize })
      }

      return false
    }
  })

  const size = (bytes: number): string =>
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`

  return [
    `Archivio ZIP con ${entries.length === 1 ? '1 file' : `${entries.length} file`} (l'elenco: i file dentro non si leggono senza estrarli):`,
    ...entries.map((entry) => `${entry.name} · ${size(entry.size)}`)
  ].join('\n')
}
