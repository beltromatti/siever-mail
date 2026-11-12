import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { BrowserWindow, dialog, nativeImage, type OpenDialogOptions } from 'electron'

import { defineMessages } from '@shared/i18n'
import {
  allotAttachments,
  attachmentGoes,
  REQUEST_ATTACHMENTS,
  type AttachmentInfo,
  type AttachmentPreparation,
  type AttachmentShortfall,
  type AttachmentSource,
  type PreparedAttachment,
  type SentAttachment
} from '@shared/segretario'

import { diagnostics } from '@main/diagnostics/log'
import { reachablePath } from '@main/services/network-volumes'
import { messages } from '../i18n'
import type { HandleRecord, HandleRegistry } from './agent/handles'
import { documentData, extractContent, extractedParts, type ExtractedContent } from './extraction'
import type { ContentPart } from './openrouter'
import { countOf, MODEL_DATES } from './tools/format'

/**
 * The files and pictures a request carries (vision §8.1): read by the same
 * reader as `leggi`, but whole and at once — all the text, every page,
 * every scanned page drawn —, where `leggi` lets the model take what it
 * needs in parts. So a request has room (`REQUEST_ATTACHMENTS`): what does
 * not fit goes as a reference the model reads with `leggi`, what cannot be
 * read goes with why, and a picture without a file goes whole or not at all.
 */

const log = diagnostics('segretario')

/** What the user reads of adding a file: the dialog, and why one could not be added. */
const MESSAGES = defineMessages({
  chooseTitle: {
    en: 'Add to the request',
    it: 'Aggiungi alla richiesta',
    de: 'Zur Anfrage hinzufügen'
  },
  chooseButton: { en: 'Add', it: 'Aggiungi', de: 'Hinzufügen' },
  gone: {
    en: (name: string) => `“${name}” isn’t there any more.`,
    it: (name: string) => `«${name}» non c’è più.`,
    de: (name: string) => `„${name}“ ist nicht mehr vorhanden.`
  },
  folder: {
    en: (name: string) => `“${name}” is a folder: add the files in it.`,
    it: (name: string) => `«${name}» è una cartella: aggiungi i file che contiene.`,
    de: (name: string) => `„${name}“ ist ein Ordner: Fügen Sie die Dateien darin hinzu.`
  },
  notOpened: {
    en: (name: string) => `“${name}” can’t be opened.`,
    it: (name: string) => `«${name}» non si apre.`,
    de: (name: string) => `„${name}“ lässt sich nicht öffnen.`
  },
  notReady: {
    en: 'An attachment is no longer ready: add it again.',
    it: 'Un allegato non è più pronto: aggiungilo di nuovo.',
    de: 'Ein Anhang ist nicht mehr bereit: Fügen Sie ihn erneut hinzu.'
  },
  tooMany: {
    en: (count: number) => `At most ${count} attachments per request.`,
    it: (count: number) => `Al massimo ${count} allegati per richiesta.`,
    de: (count: number) => `Höchstens ${count} Anhänge pro Anfrage.`
  },
  empty: {
    en: 'Write something to the Segretario, or add a file.',
    it: 'Scrivi qualcosa al Segretario, o aggiungi un file.',
    de: 'Schreiben Sie dem Segretario etwas, oder fügen Sie eine Datei hinzu.'
  }
})

/** How much a file brings whole on its own, whatever goes with it: the room of a whole request. */
const ROOM = { chars: REQUEST_ATTACHMENTS.chars, pictures: REQUEST_ATTACHMENTS.pictures }
/** The longer side of a picture's thumbnail, in pixels: sharp at a chip's size on any screen. */
const THUMBNAIL_PX = 64
/**
 * Attachments kept read for requests being written, at most: a page that
 * reloads in the middle of one leaves what it had read, and the oldest go
 * first past a few requests' worth.
 */
const KEPT_AT_MOST = 4 * REQUEST_ATTACHMENTS.count

/** The pictures a file name says, for the chip's kind. */
const PICTURE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.gif',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
  '.heic',
  '.heif',
  '.avif'
])

/** An attachment read, until its request goes: what the page sees of it, and what the model will read. */
export interface ReadyAttachment extends PreparedAttachment {
  /** What the model reads of it whole: its text, its pages, its pictures; empty when it cannot go whole. */
  body: ContentPart[]
  /** What it is, in the model's words: «PDF», «immagine PNG», «file .dxf». */
  what: string
  /** For one that cannot be read, why, as the reader says it to the model. */
  reason: string | null
}

function kindOf(name: string): AttachmentInfo['kind'] {
  const extension = extname(name).toLowerCase()
  return extension === '.pdf' ? 'pdf' : PICTURE_EXTENSIONS.has(extension) ? 'image' : 'file'
}

/** What a file is, in the model's words, by its name: «PDF», «immagine PNG», «file .dxf». */
function whatOf(name: string): string {
  const extension = extname(name).toLowerCase()

  if (extension === '.pdf') {
    return 'PDF'
  }

  if (PICTURE_EXTENSIONS.has(extension)) {
    return `immagine ${extension.slice(1).toUpperCase()}`
  }

  return extension ? `file ${extension}` : 'file senza estensione'
}

/** The format of a picture without a file, by its type or its name: «PNG». */
function pictureFormat(name: string, type: string): string {
  return (type.split('/')[1]?.split('+')[0] || extname(name).slice(1) || 'immagine').toUpperCase()
}

/** A size as the model reads it, as `cerca_file` writes it. */
function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** A small picture of a picture, for its chip; none where the system cannot draw it. */
function thumbnailOf(dataUrl: string): string | null {
  const picture = nativeImage.createFromDataURL(dataUrl)

  if (picture.isEmpty()) {
    return null
  }

  const { width, height } = picture.getSize()
  const scale = THUMBNAIL_PX / Math.max(width, height, 1)
  const small =
    scale < 1
      ? picture.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good'
        })
      : picture

  return small.toDataURL()
}

type Unread = Omit<ReadyAttachment, 'body' | 'reason' | 'chars' | 'pictures' | 'shortfall'>

/** An attachment from what the reader made of it, whole or not. */
function fromExtraction(base: Unread, extracted: ExtractedContent): ReadyAttachment {
  const none = { chars: 0, pictures: 0, body: [], reason: null, shortfall: null }

  switch (extracted.kind) {
    case 'image':
      return {
        ...base,
        ...none,
        kind: 'image',
        pictures: 1,
        body: extractedParts(extracted),
        thumbnail: thumbnailOf(extracted.dataUrl)
      }
    case 'pdf':
      return {
        ...base,
        ...none,
        kind: 'pdf',
        pages: extracted.totalPages,
        chars: extracted.pages.reduce((sum, page) => sum + page.text.length, 0),
        pictures: extracted.pages.filter((page) => page.dataUrl).length,
        body: extractedParts(extracted)
      }
    case 'text':
      return { ...base, ...none, chars: extracted.text.length, body: extractedParts(extracted) }
    case 'oversize':
      return {
        ...base,
        ...none,
        pages: extracted.totalPages,
        chars: extracted.chars,
        pictures: extracted.pictures,
        shortfall: extracted.chars > ROOM.chars ? 'too-long' : 'too-many-pictures'
      }
    case 'unreadable':
      return { ...base, ...none, shortfall: 'unreadable', reason: extracted.reason }
  }
}

/** Reads it whole, or says why it cannot be: the reader's own failure is a reason like the others. */
async function readWhole(
  base: Unread,
  read: () => Promise<{ data: Buffer; type?: string }>
): Promise<ReadyAttachment> {
  try {
    const { data, type } = await read()
    return fromExtraction(base, await extractContent(base.name, type, data, { whole: ROOM }))
  } catch (error) {
    return fromExtraction(base, {
      kind: 'unreadable',
      reason: `non si apre (${error instanceof Error ? error.message : String(error)}).`
    })
  }
}

/**
 * A file or a picture read for a request: what it brings whole — or why it
 * does not, on its own —, or why it cannot be added at all, in the user's
 * words: gone, a folder, a share that cannot be reached.
 */
export async function readAttachment(
  source: AttachmentSource
): Promise<ReadyAttachment | { error: string }> {
  const m = messages(MESSAGES)

  if ('picture' in source) {
    const { name, type, data } = source.picture
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const base: Unread = {
      id: randomUUID(),
      name,
      kind: 'image',
      size: bytes.length,
      pages: null,
      path: null,
      thumbnail: null,
      what: pictureFormat(name, type)
    }

    return bytes.length > REQUEST_ATTACHMENTS.fileBytes
      ? { ...base, chars: 0, pictures: 0, body: [], reason: null, shortfall: 'too-big' }
      : readWhole(base, async () => ({ data: bytes, type }))
  }

  let path: string

  try {
    // A file on a share a restart left unmounted, or mounted elsewhere, is still there.
    path = await reachablePath(source.path)
  } catch (error) {
    return { error: error instanceof Error ? error.message : m.notOpened(basename(source.path)) }
  }

  const name = basename(path)
  const info = await stat(path).catch(() => null)

  if (!info) {
    return { error: m.gone(name) }
  }

  if (info.isDirectory()) {
    return { error: m.folder(name) }
  }

  if (!info.isFile()) {
    return { error: m.notOpened(name) }
  }

  const base: Unread = {
    id: randomUUID(),
    name,
    kind: kindOf(name),
    size: info.size,
    pages: null,
    path,
    thumbnail: null,
    what: whatOf(name)
  }

  return info.size > REQUEST_ATTACHMENTS.fileBytes
    ? { ...base, chars: 0, pictures: 0, body: [], reason: null, shortfall: 'too-big' }
    : readWhole(base, async () => ({ data: await documentData(path, info.size) }))
}

/** What the page sees of an attachment read: never what the model will read of it. */
function preparedView(read: ReadyAttachment): PreparedAttachment {
  const { id, name, kind, size, pages, path, thumbnail, chars, pictures, shortfall } = read
  return { id, name, kind, size, pages, path, thumbnail, chars, pictures, shortfall }
}

/**
 * The attachments read for the requests being written, until they go with
 * their request or are let go: what is read once — a long PDF, its scanned
 * pages drawn — is not read again to be sent.
 */
export class AttachmentShelf {
  private readonly kept = new Map<string, ReadyAttachment>()

  async prepare(source: AttachmentSource): Promise<AttachmentPreparation> {
    const startedAt = Date.now()
    const read = await readAttachment(source)

    if ('error' in read) {
      // How often a file cannot be added, never which: its name stays with the user.
      log.warn('attachment.refused', { from: 'path' in source ? 'file' : 'picture' })
      return read
    }

    log.info('attachment.read', {
      kind: read.kind,
      size: read.size,
      chars: read.chars,
      pictures: read.pictures,
      shortfall: read.shortfall ?? undefined,
      ms: Date.now() - startedAt
    })
    this.kept.set(read.id, read)

    for (const id of [...this.kept.keys()].slice(0, Math.max(0, this.kept.size - KEPT_AT_MOST))) {
      this.kept.delete(id)
    }

    return preparedView(read)
  }

  drop(ids: ReadonlyArray<string>): void {
    for (const id of ids) {
      this.kept.delete(id)
    }
  }

  /**
   * The attachments of a request about to go with these words, in its
   * order; refused, said, when there are more than a request carries, when
   * one is no longer here, or when neither words nor anything that goes
   * would be sent. They stay until the request is written (`drop`): one that
   * fails to go can go again.
   */
  take(ids: ReadonlyArray<string>, words: string): ReadyAttachment[] {
    if (ids.length > REQUEST_ATTACHMENTS.count) {
      throw new Error(messages(MESSAGES).tooMany(REQUEST_ATTACHMENTS.count))
    }

    const taken = ids.map((id) => {
      const kept = this.kept.get(id)

      if (!kept) {
        throw new Error(messages(MESSAGES).notReady)
      }

      return kept
    })
    const fates = allotAttachments(taken)

    if (!words.trim() && !taken.some((item, index) => attachmentGoes(item, fates[index]))) {
      throw new Error(messages(MESSAGES).empty)
    }

    return taken
  }
}

/** Why an attachment did not go whole, as the model is told. */
function shortfallWords(item: ReadyAttachment, shortfall: AttachmentShortfall): string {
  const number = (value: number): string => value.toLocaleString(MODEL_DATES.locale)

  switch (shortfall) {
    case 'unreadable':
      return `non si legge: ${item.reason ?? 'il lettore non lo conosce.'}`
    case 'too-big':
      return `solo il riferimento: pesa più dei ${REQUEST_ATTACHMENTS.fileBytes / (1024 * 1024)} MB che si allegano interi.`
    case 'too-long':
      return `solo il riferimento: con il suo testo (${number(item.chars)} caratteri) la richiesta passerebbe i ${number(REQUEST_ATTACHMENTS.chars)} che porta intera.`
    case 'too-many-pictures':
      return `solo il riferimento: con ${item.kind === 'image' ? 'questa' : `le sue ${countOf(item.pictures, 'pagina scansionata', 'pagine scansionate')}`} la richiesta passerebbe le ${REQUEST_ATTACHMENTS.pictures} immagini che porta.`
  }
}

/** An attachment's line, before its content: its name in the run, the file, what it is, how it goes. */
function attachmentLine(
  item: ReadyAttachment,
  handle: string | null,
  shortfall: AttachmentShortfall | null
): string {
  const facts = [
    item.what,
    item.pages ? countOf(item.pages, 'pagina', 'pagine') : '',
    sizeWords(item.size)
  ]
    .filter(Boolean)
    .join(', ')
  const how = shortfall
    ? `${shortfallWords(item, shortfall)}${handle && shortfall !== 'unreadable' ? ` Si legge con \`leggi ${handle}\`, quanto serve.` : ''}`
    : 'qui sotto, intero.'

  return handle
    ? `## Allegato ${handle} · ${item.name}\nPercorso: ${item.path}\n${facts} · ${how}`
    : `## Immagine incollata · ${facts} · ${how}`
}

/**
 * What the model reads of a request's attachments, after its words, and
 * what the page shows of them under the words: each that goes, whole or as
 * a reference or with why it does not read, with a short name in the run —
 * as `cerca_file` gives them, so `leggi f3` and a link to it work after.
 */
export function requestAttachments(
  items: ReadonlyArray<ReadyAttachment>,
  handles: HandleRegistry,
  added: HandleRecord[]
): { parts: ContentPart[]; sent: SentAttachment[] } {
  const fates = allotAttachments(items)
  const parts: ContentPart[] = []
  const sent: SentAttachment[] = []

  items.forEach((item, index) => {
    const shortfall = fates[index]

    if (!attachmentGoes(item, shortfall)) {
      return
    }

    const handle = item.path
      ? handles.name(
          { kind: 'file', file: { kind: 'path', path: item.path, fileName: item.name } },
          added
        )
      : null

    parts.push(
      { type: 'text', text: attachmentLine(item, handle, shortfall) },
      ...(shortfall ? [] : item.body)
    )
    sent.push({
      name: item.name,
      kind: item.kind,
      size: item.size,
      pages: item.pages,
      path: item.path,
      thumbnail: item.thumbnail,
      handle,
      shortfall
    })
  })

  return {
    parts:
      sent.length > 0
        ? [{ type: 'text', text: `# Allegati alla richiesta (${sent.length})` }, ...parts]
        : [],
    sent
  }
}

/** Files to add to a request, chosen in the system's dialog over the window in front. */
export async function chooseFiles(): Promise<string[]> {
  const m = messages(MESSAGES)
  const options: OpenDialogOptions = {
    title: m.chooseTitle,
    buttonLabel: m.chooseButton,
    properties: ['openFile', 'multiSelections']
  }
  const parent = BrowserWindow.getFocusedWindow()
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  return result.canceled ? [] : result.filePaths
}
