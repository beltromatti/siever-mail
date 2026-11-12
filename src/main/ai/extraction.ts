import { open, readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { strFromU8, unzipSync } from 'fflate'
import { NodeHtmlMarkdown } from 'node-html-markdown'

import { defineMessages } from '@shared/i18n'

import { messages } from '../i18n'
import { parseMessageSource } from '../services/mail-engine/message-parts'
import {
  decodeText,
  looksLikeText,
  outlookMessageText,
  rtfText,
  signedEnvelopeContent,
  TEXT_SNIFF_BYTES,
  wordDocumentText,
  zipListing
} from './document-formats'
import type { ContentPart } from './openrouter'
import { renderPdfPages } from './pdf-pages'

/** A failure of the reading, which the step's line shows the user. */
const ERRORS = defineMessages({
  pageNotDrawn: {
    en: (page: number) => `Page ${page} of the PDF wasn’t drawn.`,
    it: (page: number) => `La pagina ${page} del PDF non è stata disegnata.`,
    de: (page: number) => `Seite ${page} der PDF wurde nicht gezeichnet.`
  }
})

/**
 * What a document says, for the Segretario to read: an attachment, a file
 * on the computer or on a share. Text comes out of what can be read as
 * text — PDF, Word (also 97–2003), Excel and CSV, PowerPoint, OpenDocument,
 * RTF, HTML, mail (.eml, Outlook's .msg), a signed envelope's document
 * (.p7m), an archive's list, and any file that is text inside, whatever
 * its trade; a picture is handed to the model as a picture, and so is a
 * scanned page, or any page it asks to look at.
 */
export type ExtractedContent =
  | {
      kind: 'text'
      text: string
      /** Characters of the whole text, for the reader to know what it has not seen. */
      totalChars: number
      /** Where the next part starts, when the text was cut. */
      nextOffset: number | null
    }
  | {
      kind: 'pdf'
      totalPages: number
      /**
       * The pages read, in order: each page's text, and the page drawn as a
       * picture where it is a scan, or where the reader asked to look at it.
       */
      pages: Array<{ page: number; text: string; dataUrl?: string }>
      /** The page the document goes on from, when there is more. */
      nextPage: number | null
    }
  | { kind: 'image'; mimeType: string; dataUrl: string }
  | { kind: 'unreadable'; reason: string }
  /**
   * Asked whole, a document past the room given: how much text and how many
   * pictures it holds (its pages, for a PDF) — nothing of it read.
   */
  | { kind: 'oversize'; chars: number; pictures: number; totalPages: number | null }

export interface ExtractOptions {
  /** Where the text goes on from. */
  offset?: number
  /** The PDF page it goes on from. */
  page?: number
  /** Every page of a PDF as a picture too, with its text. */
  look?: boolean
  /**
   * The whole document at once, as a request's attachment takes it — all its
   * text, every PDF page's text and its scanned pages drawn — when it fits in
   * this room; `oversize` when it does not.
   */
  whole?: { chars: number; pictures: number }
}

/** Characters handed over at once: about a dozen thousand tokens. */
export const EXTRACT_PAGE_CHARS = 40_000
/** A picture larger than this is drawn smaller before it is sent: what a provider takes at once. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** How wide a picture drawn smaller is: as legible as a scanned page. */
const IMAGE_FIT_WIDTH = 2048
/** A PDF page with less text than this is a scan, or a picture: it is looked at instead. */
const PDF_TEXT_PAGE_MIN_CHARS = 20
/** Scanned pages looked at in one read: each is a picture the model reads. */
const PDF_PICTURES_PER_READ = 5
/** How wide a scanned page is drawn: small print stays legible. */
const PDF_PICTURE_WIDTH = 1600

/** The pictures the model takes as they are (OpenRouter: PNG, JPEG, WebP, GIF). */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/**
 * Pictures in a format the model does not take: sent as they are, the
 * provider would refuse the whole request. Drawn again as JPEG where the
 * system can, said otherwise.
 */
const OTHER_IMAGE_EXTENSIONS = new Set([
  '.tif',
  '.tiff',
  '.bmp',
  '.heic',
  '.heif',
  '.avif',
  '.ico',
  '.psd'
])

const WORD_EXTENSIONS = new Set(['.docx', '.docm', '.dotx', '.dotm'])
const SHEET_EXTENSIONS = new Set([
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.xltx',
  '.xltm',
  '.xls',
  '.ods',
  '.ots'
])
const SLIDES_EXTENSIONS = new Set(['.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm'])
const OPEN_DOCUMENT_EXTENSIONS = new Set(['.odt', '.ott', '.odp', '.otp'])

/**
 * The formats this reader knows by name; any other file is read when it is
 * text inside (`looksLikeText`).
 */
export function knownFormat(fileName: string): boolean {
  const extension = extname(fileName).toLowerCase()
  return (
    extension === '.pdf' ||
    Boolean(IMAGE_TYPES[extension]) ||
    OTHER_IMAGE_EXTENSIONS.has(extension) ||
    WORD_EXTENSIONS.has(extension) ||
    SHEET_EXTENSIONS.has(extension) ||
    SLIDES_EXTENSIONS.has(extension) ||
    OPEN_DOCUMENT_EXTENSIONS.has(extension) ||
    ['.doc', '.dot', '.msg', '.rtf', '.eml', '.ics', '.p7m', '.zip'].includes(extension)
  )
}

const htmlToMarkdown = new NodeHtmlMarkdown({ keepDataImages: false, maxConsecutiveNewlines: 2 })

/**
 * An iCalendar file as it reads: its long lines unfolded (RFC 5545 folds
 * them) and without its time zone definitions, long and of no use to a
 * reader — every time names its zone.
 */
function calendarText(text: string): string {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .replace(/^BEGIN:VTIMEZONE\r?$[\s\S]*?^END:VTIMEZONE\r?\n?/gim, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

/**
 * The part of `text` a reading gives: from `offset`, at most a page of it —
 * or, asked whole, all of it when it fits.
 */
function page(text: string, { offset = 0, whole }: ExtractOptions): ExtractedContent {
  if (whole) {
    return text.length > whole.chars
      ? { kind: 'oversize', chars: text.length, pictures: 0, totalPages: null }
      : { kind: 'text', text, totalChars: text.length, nextOffset: null }
  }

  const start = Math.max(0, Math.min(offset, text.length))
  const end = Math.min(text.length, start + EXTRACT_PAGE_CHARS)

  return {
    kind: 'text',
    text: text.slice(start, end),
    totalChars: text.length,
    nextOffset: end < text.length ? end : null
  }
}

export async function extractContent(
  fileName: string,
  contentType: string | undefined,
  data: Buffer,
  options: ExtractOptions = {}
): Promise<ExtractedContent> {
  const extension = extname(fileName).toLowerCase()
  const type = (contentType ?? '').toLowerCase().split(';')[0].trim()

  if (extension === '.pdf' || type === 'application/pdf') {
    return options.whole
      ? extractWholePdf(data, options.whole)
      : extractPdf(data, options.page ?? 1, options.look ?? false)
  }

  // A signed document (CAdES): the document it carries, read as what it is — "fattura.xml.p7m" as XML.
  if (
    extension === '.p7m' ||
    type === 'application/pkcs7-mime' ||
    type === 'application/x-pkcs7-mime'
  ) {
    const content = signedEnvelopeContent(data)

    if (!content) {
      return {
        kind: 'unreadable',
        reason: 'La busta firmata non contiene il documento (è solo la firma) o non si apre.'
      }
    }

    const inner = extension === '.p7m' ? fileName.slice(0, -extension.length) : 'documento'
    return extractContent(inner, undefined, content, options)
  }

  if (extension === '.svg' || type === 'image/svg+xml') {
    return page(decodeText(data), options)
  }

  const modelImageType =
    IMAGE_TYPES[extension] ?? (Object.values(IMAGE_TYPES).includes(type) ? type : undefined)

  if (modelImageType) {
    if (data.length <= IMAGE_MAX_BYTES) {
      return {
        kind: 'image',
        mimeType: modelImageType,
        dataUrl: `data:${modelImageType};base64,${data.toString('base64')}`
      }
    }

    // Too large to send as it is: drawn smaller, as a scanned page is.
    return (
      (await drawnAgain(data)) ?? {
        kind: 'unreadable',
        reason: `L'immagine è grande (${Math.round(data.length / (1024 * 1024))} MB) e in un formato che non riesco a ridurre.`
      }
    )
  }

  if (OTHER_IMAGE_EXTENSIONS.has(extension) || type.startsWith('image/')) {
    return (
      (await drawnAgain(data)) ?? {
        kind: 'unreadable',
        reason: `Le immagini ${extension || type} non riesco ancora a guardarle: posso guardare PNG, JPEG, WebP e GIF, e i PDF.`
      }
    )
  }

  if (WORD_EXTENSIONS.has(extension)) {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.convertToHtml({ buffer: data })
    return page(htmlToMarkdown.translate(value), options)
  }

  if (SHEET_EXTENSIONS.has(extension)) {
    return page(await sheetsText(data), options)
  }

  if (SLIDES_EXTENSIONS.has(extension) || OPEN_DOCUMENT_EXTENSIONS.has(extension)) {
    return page(officeXmlText(data), options)
  }

  if (extension === '.doc' || extension === '.dot' || type === 'application/msword') {
    return textOrReason(await wordDocumentText(data), options)
  }

  if (extension === '.msg' || type === 'application/vnd.ms-outlook') {
    return textOrReason(
      await outlookMessageText(data, (html) => htmlToMarkdown.translate(html)),
      options
    )
  }

  if (extension === '.rtf' || type === 'application/rtf' || type === 'text/rtf') {
    return page(rtfText(decodeText(data)), options)
  }

  if (['.html', '.htm', '.xhtml'].includes(extension) || type === 'text/html') {
    return page(htmlToMarkdown.translate(decodeText(data)), options)
  }

  if (extension === '.eml' || type === 'message/rfc822') {
    const parsed = await parseMessageSource(data)
    const header = [
      `Da: ${parsed.from?.text ?? ''}`,
      `A: ${[parsed.to]
        .flat()
        .map((list) => list?.text ?? '')
        .join(', ')}`,
      `Data: ${parsed.date?.toISOString() ?? ''}`,
      `Oggetto: ${parsed.subject ?? ''}`
    ].join('\n')
    const body = parsed.text?.trim() || (parsed.html ? htmlToMarkdown.translate(parsed.html) : '')
    const files = parsed.attachments.map((file) => file.filename).filter(Boolean)
    return page(
      `${header}\n\n${body}${files.length > 0 ? `\n\nAllegati: ${files.join(', ')}` : ''}`,
      options
    )
  }

  // An invitation travels as `text/calendar` in the message and as `application/ics` attached.
  if (extension === '.ics' || type === 'text/calendar' || type === 'application/ics') {
    return page(calendarText(decodeText(data)), options)
  }

  if (
    extension === '.zip' ||
    type === 'application/zip' ||
    type === 'application/x-zip-compressed'
  ) {
    return page(zipListing(data), options)
  }

  if (extension === '.ppt') {
    return {
      kind: 'unreadable',
      reason:
        'Le presentazioni .ppt del vecchio PowerPoint non si leggono: serve la versione .pptx, o un PDF.'
    }
  }

  // Anything that is text inside, whatever its name: a CSV, code, a drawing or a model exchanged as text.
  if (type.startsWith('text/') || looksLikeText(data)) {
    return page(decodeText(data), options)
  }

  return {
    kind: 'unreadable',
    reason: `I file ${extension || 'di questo tipo'} non sono testo e non so leggerli: di solito c'è anche una copia in PDF, o un formato d'ufficio.`
  }
}

/** A text, or why the document gave none. */
function textOrReason(
  read: string | { reason: string },
  options: ExtractOptions
): ExtractedContent {
  return typeof read === 'string'
    ? page(read, options)
    : { kind: 'unreadable', reason: read.reason }
}

/**
 * A picture drawn again as JPEG, at most as wide as a scanned page: one too
 * large to send, or in a format the model does not take. None where the
 * system cannot decode it.
 */
async function drawnAgain(data: Buffer): Promise<ExtractedContent | null> {
  const { nativeImage } = await import('electron')
  const picture = nativeImage.createFromBuffer(data)

  if (picture.isEmpty()) {
    return null
  }

  const fitted =
    picture.getSize().width > IMAGE_FIT_WIDTH
      ? picture.resize({ width: IMAGE_FIT_WIDTH, quality: 'best' })
      : picture

  return {
    kind: 'image',
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${fitted.toJPEG(85).toString('base64')}`
  }
}

/**
 * A PDF from `fromPage`, as many pages as one read holds: each page's
 * text, and — where a page has none, a scan — the page drawn as a picture.
 * A document of typed pages and a signed, scanned last one reads whole.
 * Asked to `look`, every page comes as a picture too, with its text: a
 * drawing, a plan, a chart, a form with its ticks and stamps say in their
 * layout what their words alone do not.
 */
async function extractPdf(
  data: Buffer,
  fromPage: number,
  look: boolean
): Promise<ExtractedContent> {
  const { totalPages, text } = await pdfText(data)
  const first = Math.max(1, Math.min(Math.trunc(fromPage), totalPages))
  const read: Array<{ page: number; text: string; picture: boolean }> = []
  let chars = 0
  let pictures = 0
  let next: number | null = null

  for (let page = first; page <= totalPages; page++) {
    const pageText = text[page - 1].trim()
    const picture = look || pageText.length < PDF_TEXT_PAGE_MIN_CHARS

    if (picture && pictures === PDF_PICTURES_PER_READ) {
      next = page
      break
    }

    if (!picture && read.length > 0 && chars + pageText.length > EXTRACT_PAGE_CHARS) {
      next = page
      break
    }

    // A page is read whole, however long: it is what the reading moves by.
    read.push({ page, text: picture && !look ? '' : pageText, picture })
    chars += pageText.length
    pictures += picture ? 1 : 0
  }

  return pdfPages(data, totalPages, read, next)
}

/**
 * A PDF whole, as a request's attachment takes it: every page's text, and
 * every scanned page drawn as a picture — or, past the room given, how much
 * there is (`oversize`), with nothing drawn.
 */
async function extractWholePdf(
  data: Buffer,
  room: { chars: number; pictures: number }
): Promise<ExtractedContent> {
  const { totalPages, text } = await pdfText(data)
  const read = text.map((raw, index) => {
    const pageText = raw.trim()
    const picture = pageText.length < PDF_TEXT_PAGE_MIN_CHARS
    return { page: index + 1, text: picture ? '' : pageText, picture }
  })
  const chars = read.reduce((sum, item) => sum + item.text.length, 0)
  const pictures = read.filter((item) => item.picture).length

  if (chars > room.chars || pictures > room.pictures) {
    return { kind: 'oversize', chars, pictures, totalPages }
  }

  return pdfPages(data, totalPages, read, null)
}

/** A PDF's pages and their text, page by page. */
async function pdfText(data: Buffer): Promise<{ totalPages: number; text: string[] }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  return extractText(await getDocumentProxy(new Uint8Array(data)), { mergePages: false })
}

/** The pages read of a PDF, those to look at drawn as pictures. */
async function pdfPages(
  data: Buffer,
  totalPages: number,
  read: ReadonlyArray<{ page: number; text: string; picture: boolean }>,
  nextPage: number | null
): Promise<ExtractedContent> {
  const toDraw = read.flatMap((item) => (item.picture ? [item.page] : []))
  const drawn = new Map(
    toDraw.length > 0
      ? (await renderPdfPages(new Uint8Array(data), toDraw, PDF_PICTURE_WIDTH)).map((image) => [
          image.page,
          `data:image/jpeg;base64,${image.jpeg.toString('base64')}`
        ])
      : []
  )

  return {
    kind: 'pdf',
    totalPages,
    pages: read.map(({ page, text: pageText, picture }) => {
      if (!picture) {
        return { page, text: pageText }
      }

      const dataUrl = drawn.get(page)

      if (!dataUrl) {
        throw new Error(messages(ERRORS).pageNotDrawn(page))
      }

      return { page, text: pageText, dataUrl }
    }),
    nextPage
  }
}

/**
 * What an extraction holds, as the model reads it: the text; a PDF's pages,
 * each marked, a scanned one as its picture; a picture as itself. The same
 * for what `leggi` reads and for what a request carries.
 */
export function extractedParts(
  extracted: Extract<ExtractedContent, { kind: 'text' | 'pdf' | 'image' }>
): ContentPart[] {
  switch (extracted.kind) {
    case 'text':
      return [{ type: 'text', text: extracted.text || '(nessun testo)' }]
    case 'image':
      return [{ type: 'image_url', image_url: { url: extracted.dataUrl } }]
    case 'pdf':
      return extracted.pages.flatMap((page): ContentPart[] => [
        page.dataUrl && !page.text
          ? { type: 'text', text: `— Pagina ${page.page} (scansione) —` }
          : { type: 'text', text: `— Pagina ${page.page} —\n${page.text}` },
        ...(page.dataUrl ? [{ type: 'image_url' as const, image_url: { url: page.dataUrl } }] : [])
      ])
  }
}

/** The first `bytes` of a file, without reading the rest. */
async function readHead(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, 'r')

  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(bytes), 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

/**
 * What of a file the reader needs: all of it — or, for a large file of a
 * format not known by name, its first bytes when they are not text: a video
 * or a program is said for what it is, not loaded to be refused.
 */
export async function documentData(path: string, size: number): Promise<Buffer> {
  if (knownFormat(path) || size <= TEXT_SNIFF_BYTES) {
    return readFile(path)
  }

  const head = await readHead(path, TEXT_SNIFF_BYTES)
  return looksLikeText(head) ? readFile(path) : head
}

async function sheetsText(data: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(data, { type: 'buffer', cellDates: true })

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) : ''
    return `— Foglio «${name}» —\n${csv.trim()}`
  }).join('\n\n')
}

/**
 * The text of an Office Open XML presentation or an OpenDocument file: the
 * runs of text of each slide with its speaker notes, or the paragraphs of
 * the content, in order.
 */
function officeXmlText(data: Buffer): string {
  const files = unzipSync(new Uint8Array(data), {
    filter: (file) =>
      /^ppt\/(slides|notesSlides)\/\w+\.xml$/.test(file.name) || file.name === 'content.xml'
  })
  const decode = (xml: string): string =>
    xml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&amp;/g, '&')
  const runs = (xml: string): string =>
    xml
      .split(/<\/a:p>/)
      .map((paragraph) =>
        [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((run) => decode(run[1])).join('')
      )
      .filter((line) => line.trim())
      .join('\n')
  const numbered = (folder: string): string[] =>
    Object.keys(files)
      .filter((name) => name.startsWith(folder))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1]) - Number(b.match(/(\d+)\.xml$/)?.[1]))

  const slides = numbered('ppt/slides/')

  if (slides.length > 0) {
    // A slide's notes are the notes slide that names it (its number, as PowerPoint writes them).
    const notes = new Map(
      numbered('ppt/notesSlides/').map((name) => [name.match(/(\d+)\.xml$/)?.[1], name])
    )

    return slides
      .map((name, index) => {
        const number = name.match(/(\d+)\.xml$/)?.[1]
        const note = notes.get(number)
        const noteText = note ? runs(strFromU8(files[note])).replace(/^\d+$/m, '').trim() : ''
        return `— Diapositiva ${index + 1} —\n${runs(strFromU8(files[name]))}${
          noteText ? `\n[Note: ${noteText}]` : ''
        }`
      })
      .join('\n\n')
  }

  const content = files['content.xml']

  if (!content) {
    return ''
  }

  return decode(
    strFromU8(content)
      .replace(/<text:(?:p|h)[^>]*>/g, '\n')
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
