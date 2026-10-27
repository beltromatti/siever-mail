import { extname } from 'node:path'

import { strFromU8, unzipSync } from 'fflate'
import { NodeHtmlMarkdown } from 'node-html-markdown'

import { parseMessageSource } from '../services/mail-engine/message-parts'
import { renderPdfPages } from './pdf-pages'

/**
 * What a document says, for the Segretario to read: an attachment, a file
 * on the computer or on a share. Text comes out of what can be read as
 * text — PDF, Word, Excel and CSV, PowerPoint, OpenDocument, HTML, mail;
 * a picture is handed to the model as a picture, and so is a scanned page.
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
      /** The pages read, in order: a page's text, or the page drawn as a picture where it is a scan. */
      pages: Array<{ page: number; text: string } | { page: number; dataUrl: string }>
      /** The page the document goes on from, when there is more. */
      nextPage: number | null
    }
  | { kind: 'image'; mimeType: string; dataUrl: string }
  | { kind: 'unreadable'; reason: string }

/** Characters handed over at once: about a dozen thousand tokens. */
export const EXTRACT_PAGE_CHARS = 40_000
/** A picture larger than this is described, not sent. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** A PDF page with less text than this is a scan, or a picture: it is looked at instead. */
const PDF_TEXT_PAGE_MIN_CHARS = 20
/** Scanned pages looked at in one read: each is a picture the model reads. */
const PDF_PICTURES_PER_READ = 5
/** How wide a scanned page is drawn: small print stays legible. */
const PDF_PICTURE_WIDTH = 1600
/** Rows of a sheet read at most. */
const SHEET_MAX_ROWS = 2_000

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

const PLAIN_TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.log',
  '.ini',
  '.yaml',
  '.yml'
])

const htmlToMarkdown = new NodeHtmlMarkdown({ keepDataImages: false, maxConsecutiveNewlines: 2 })

/** The part of `text` from `offset`, at most a page of it. */
function page(text: string, offset: number): ExtractedContent {
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
  options: { offset?: number; page?: number } = {}
): Promise<ExtractedContent> {
  const extension = extname(fileName).toLowerCase()
  const type = (contentType ?? '').toLowerCase()
  const offset = options.offset ?? 0

  if (extension === '.pdf' || type === 'application/pdf') {
    return extractPdf(data, options.page ?? 1)
  }

  if (IMAGE_TYPES[extension] || type.startsWith('image/')) {
    if (data.length > IMAGE_MAX_BYTES) {
      return { kind: 'unreadable', reason: "L'immagine è troppo grande da guardare." }
    }

    const mimeType = IMAGE_TYPES[extension] ?? type
    return {
      kind: 'image',
      mimeType,
      dataUrl: `data:${mimeType};base64,${data.toString('base64')}`
    }
  }

  if (extension === '.docx') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.convertToHtml({ buffer: data })
    return page(htmlToMarkdown.translate(value), offset)
  }

  if (['.xlsx', '.xlsm', '.xls', '.ods'].includes(extension)) {
    return page(await sheetsText(data), offset)
  }

  if (['.pptx', '.odp', '.odt'].includes(extension)) {
    return page(officeXmlText(data, extension), offset)
  }

  if (['.html', '.htm'].includes(extension) || type === 'text/html') {
    return page(htmlToMarkdown.translate(data.toString('utf8')), offset)
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
      offset
    )
  }

  if (PLAIN_TEXT_EXTENSIONS.has(extension) || type.startsWith('text/')) {
    return page(data.toString('utf8'), offset)
  }

  if (extension === '.doc' || extension === '.ppt') {
    return {
      kind: 'unreadable',
      reason: `I file ${extension} del vecchio Office non si leggono: serve la versione ${extension}x.`
    }
  }

  return { kind: 'unreadable', reason: `Non so leggere i file ${extension || 'di questo tipo'}.` }
}

/**
 * A PDF from `fromPage`, as many pages as one read holds: each page's
 * text, or — where a page has none, a scan — the page drawn as a picture.
 * A document of typed pages and a signed, scanned last one reads whole.
 */
async function extractPdf(data: Buffer, fromPage: number): Promise<ExtractedContent> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { totalPages, text } = await extractText(await getDocumentProxy(new Uint8Array(data)), {
    mergePages: false
  })
  const first = Math.max(1, Math.min(Math.trunc(fromPage), totalPages))
  const read: Array<{ page: number; text: string } | { page: number; picture: true }> = []
  let chars = 0
  let pictures = 0
  let next: number | null = null

  for (let page = first; page <= totalPages; page++) {
    const pageText = text[page - 1].trim()

    if (pageText.length >= PDF_TEXT_PAGE_MIN_CHARS) {
      if (read.length > 0 && chars + pageText.length > EXTRACT_PAGE_CHARS) {
        next = page
        break
      }

      const kept = pageText.slice(0, EXTRACT_PAGE_CHARS)
      read.push({
        page,
        text: kept.length < pageText.length ? `${kept}\n[Pagina accorciata.]` : kept
      })
      chars += kept.length
    } else {
      if (pictures === PDF_PICTURES_PER_READ) {
        next = page
        break
      }

      read.push({ page, picture: true })
      pictures++
    }
  }

  const drawn = new Map(
    pictures > 0
      ? (
          await renderPdfPages(
            new Uint8Array(data),
            read.flatMap((item) => ('picture' in item ? [item.page] : [])),
            PDF_PICTURE_WIDTH
          )
        ).map((image) => [image.page, `data:image/jpeg;base64,${image.jpeg.toString('base64')}`])
      : []
  )

  return {
    kind: 'pdf',
    totalPages,
    pages: read.map((item) => {
      if (!('picture' in item)) {
        return item
      }

      const dataUrl = drawn.get(item.page)

      if (!dataUrl) {
        throw new Error(`La pagina ${item.page} del PDF non è stata disegnata.`)
      }

      return { page: item.page, dataUrl }
    }),
    nextPage: next
  }
}

async function sheetsText(data: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(data, { type: 'buffer', cellDates: true, sheetRows: SHEET_MAX_ROWS })

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false }) : ''
    return `— Foglio «${name}» —\n${csv.trim()}`
  }).join('\n\n')
}

/**
 * The text of an Office Open XML presentation or an OpenDocument file: the
 * runs of text of each slide, or the paragraphs of the content, in order.
 */
function officeXmlText(data: Buffer, extension: string): string {
  const files = unzipSync(new Uint8Array(data))
  const decode = (xml: string): string =>
    xml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')

  if (extension === '.pptx') {
    const slides = Object.keys(files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))

    return slides
      .map((name, index) => {
        const xml = strFromU8(files[name])
        const paragraphs = xml
          .split(/<\/a:p>/)
          .map((paragraph) =>
            [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((run) => decode(run[1])).join('')
          )
        return `— Diapositiva ${index + 1} —\n${paragraphs.filter((line) => line.trim()).join('\n')}`
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
