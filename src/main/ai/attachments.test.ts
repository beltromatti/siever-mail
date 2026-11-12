import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The thumbnail is drawn by Electron's image: a stand-in that says what it was asked.
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
  nativeImage: {
    createFromDataURL: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 640, height: 320 }),
      resize: ({ width, height }: { width: number; height: number }) => ({
        toDataURL: () => `data:image/png;base64,THUMB${width}x${height}`
      }),
      toDataURL: () => 'data:image/png;base64,THUMB'
    }),
    // A format the system cannot draw.
    createFromBuffer: () => ({ isEmpty: () => true })
  }
}))
vi.mock('@main/services/network-volumes', () => ({ reachablePath: async (path: string) => path }))

// A PDF as the reader finds it, and its scanned pages drawn: what these tests give.
const pdf = vi.hoisted(() => ({ pages: [] as string[] }))
const drawn = vi.hoisted(() => [] as number[][])
vi.mock('unpdf', () => ({
  getDocumentProxy: async () => ({}),
  extractText: async () => ({ totalPages: pdf.pages.length, text: pdf.pages })
}))
vi.mock('./pdf-pages', () => ({
  renderPdfPages: async (_data: Uint8Array, pages: number[]) => {
    drawn.push(pages)
    return pages.map((page) => ({ page, jpeg: Buffer.from(`pagina ${page}`) }))
  }
}))

import { allotAttachments, REQUEST_ATTACHMENTS, type PreparedAttachment } from '@shared/segretario'

import { HandleRegistry, type HandleRecord } from './agent/handles'
import {
  AttachmentShelf,
  readAttachment,
  requestAttachments,
  type ReadyAttachment
} from './attachments'

/** A PNG of one pixel. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'richiesta-'))
  pdf.pages = []
  drawn.length = 0
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

async function file(name: string, content: string | Buffer): Promise<string> {
  const path = join(folder, name)
  await writeFile(path, content)
  return path
}

async function ready(path: string): Promise<ReadyAttachment> {
  const read = await readAttachment({ path })

  if ('error' in read) {
    throw new Error(read.error)
  }

  return read
}

describe('readAttachment', () => {
  it('reads a file whole, by the same reader as `leggi`', async () => {
    const path = await file('preventivo.csv', 'voce;importo\nponteggio;1200\n')
    const read = await ready(path)

    expect(read).toMatchObject({
      name: 'preventivo.csv',
      kind: 'file',
      path,
      chars: 28,
      pictures: 0,
      shortfall: null,
      thumbnail: null,
      what: 'file .csv'
    })
    expect(read.body).toEqual([{ type: 'text', text: 'voce;importo\nponteggio;1200\n' }])
  })

  it('looks at a picture as the model takes it, with a small one for its chip', async () => {
    const read = await ready(await file('pianta.png', PIXEL))

    expect(read).toMatchObject({ kind: 'image', pictures: 1, chars: 0, what: 'immagine PNG' })
    expect(read.body).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PIXEL.toString('base64')}` } }
    ])
    // Fitted to 64 pixels on its longer side.
    expect(read.thumbnail).toBe('data:image/png;base64,THUMB64x32')
  })

  it('reads every page of a PDF, its scanned ones drawn, past which it is a reference', async () => {
    pdf.pages = [
      'Verbale di consegna dei lavori, firmato dalle parti.',
      '',
      'Allegato tecnico con le misure.  '
    ]
    const read = await ready(await file('verbale.pdf', '%PDF-1.7'))

    expect(read).toMatchObject({ kind: 'pdf', pages: 3, pictures: 1, shortfall: null })
    expect(read.chars).toBe(52 + 31)
    expect(drawn).toEqual([[2]])
    expect(read.body.map((part) => (part.type === 'text' ? part.text : 'immagine'))).toEqual([
      '— Pagina 1 —\nVerbale di consegna dei lavori, firmato dalle parti.',
      '— Pagina 2 (scansione) —',
      'immagine',
      '— Pagina 3 —\nAllegato tecnico con le misure.'
    ])

    // More scanned pages than a request carries: none drawn, its reference goes.
    drawn.length = 0
    pdf.pages = Array.from({ length: REQUEST_ATTACHMENTS.pictures + 1 }, () => '')
    const scans = await ready(await file('scansione.pdf', '%PDF-1.7'))
    expect(scans).toMatchObject({ shortfall: 'too-many-pictures', pages: 11, pictures: 11 })
    expect(scans.body).toEqual([])
    expect(drawn).toEqual([])
  })

  it('takes as a reference what is too long or too big, without loading what it cannot carry', async () => {
    const long = await ready(
      await file(
        'registro.txt',
        'riga del registro\n'.repeat(Math.ceil(REQUEST_ATTACHMENTS.chars / 18) + 1)
      )
    )
    expect(long).toMatchObject({ shortfall: 'too-long', chars: 600_012 + 18 })
    expect(long.body).toEqual([])

    const path = join(folder, 'rilievo.dwg')
    await writeFile(path, '')
    await truncate(path, REQUEST_ATTACHMENTS.fileBytes + 1)
    expect(await ready(path)).toMatchObject({
      shortfall: 'too-big',
      size: REQUEST_ATTACHMENTS.fileBytes + 1,
      body: []
    })
  })

  it('says why what cannot be read does not read, and refuses what cannot be added', async () => {
    const binary = await ready(await file('modello.bin', Buffer.from([0, 1, 2, 3, 0, 255, 0, 7])))
    expect(binary).toMatchObject({ shortfall: 'unreadable', what: 'file .bin' })
    expect(binary.reason).toContain('non sono testo')

    await mkdir(join(folder, 'Casa al mare'))
    expect(await readAttachment({ path: join(folder, 'Casa al mare') })).toEqual({
      error: '“Casa al mare” is a folder: add the files in it.'
    })
    expect(await readAttachment({ path: join(folder, 'sparito.pdf') })).toEqual({
      error: '“sparito.pdf” isn’t there any more.'
    })
  })

  it('reads a pasted picture, which has no file', async () => {
    const read = await readAttachment({
      picture: { name: 'image.png', type: 'image/png', data: new Uint8Array(PIXEL) }
    })

    expect(read).toMatchObject({
      kind: 'image',
      path: null,
      pictures: 1,
      shortfall: null,
      what: 'PNG',
      size: PIXEL.length
    })
  })
})

describe('allotAttachments', () => {
  const item = (
    chars: number,
    pictures = 0,
    shortfall: PreparedAttachment['shortfall'] = null
  ): Pick<PreparedAttachment, 'chars' | 'pictures' | 'shortfall'> => ({
    chars,
    pictures,
    shortfall
  })

  it('carries whole what has room, in order, and says why the rest does not go whole', () => {
    expect(
      allotAttachments([
        item(400_000),
        item(250_000),
        item(150_000),
        item(0, 6),
        item(0, 5),
        item(0, 4),
        item(0, 0, 'unreadable')
      ])
    ).toEqual([null, 'too-long', null, null, 'too-many-pictures', null, 'unreadable'])
  })
})

describe('requestAttachments', () => {
  function attachment(overrides: Partial<ReadyAttachment>): ReadyAttachment {
    return {
      id: 'x',
      name: 'nota.txt',
      kind: 'file',
      size: 2_048,
      pages: null,
      path: '/Lavori/nota.txt',
      thumbnail: null,
      chars: 4,
      pictures: 0,
      shortfall: null,
      body: [{ type: 'text', text: 'Ciao' }],
      what: 'file .txt',
      reason: null,
      ...overrides
    }
  }

  it('gives the model each one after the words — whole, by reference, or why — named as `cerca_file` names them', () => {
    const handles = new HandleRegistry([
      { handle: 'f1', target: { kind: 'file', file: { kind: 'path', path: '/a', fileName: 'a' } } }
    ])
    const added: HandleRecord[] = []
    const picture = (id: string): ReadyAttachment =>
      attachment({
        id,
        name: 'image.png',
        kind: 'image',
        path: null,
        chars: 0,
        pictures: 1,
        what: 'PNG',
        size: 240 * 1024,
        thumbnail: 'data:image/png;base64,T',
        body: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,P' } }]
      })
    const { parts, sent } = requestAttachments(
      [
        attachment({}),
        attachment({
          id: 'b',
          name: 'archivio.pdf',
          kind: 'pdf',
          path: '/Lavori/archivio.pdf',
          pages: 900,
          chars: 1_250_000,
          size: 48 * 1024 * 1024,
          what: 'PDF',
          shortfall: 'too-long',
          body: []
        }),
        attachment({
          id: 'c',
          name: 'disegno.dwg',
          path: '/Lavori/disegno.dwg',
          what: 'file .dwg',
          shortfall: 'unreadable',
          reason: 'i file .dwg non sono testo.',
          body: []
        }),
        attachment({
          id: 'd',
          name: 'scansione.pdf',
          kind: 'pdf',
          path: '/Lavori/scansione.pdf',
          pages: 5,
          chars: 0,
          pictures: 5,
          what: 'PDF',
          body: Array.from({ length: 5 }, () => ({
            type: 'image_url' as const,
            image_url: { url: 'data:image/jpeg;base64,S' }
          }))
        }),
        // Five pictures fill the ten; the sixth has no room, and no file to be read by.
        ...Array.from({ length: 6 }, (_, index) => picture(`p${index}`))
      ],
      handles,
      added
    )

    expect(added.map((record) => record.handle)).toEqual(['f2', 'f3', 'f4', 'f5'])
    expect(handles.file('f3')).toEqual({
      kind: 'path',
      path: '/Lavori/archivio.pdf',
      fileName: 'archivio.pdf'
    })

    const texts = parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
    expect(texts[0]).toBe('# Allegati alla richiesta (9)')
    expect(texts[1]).toBe(
      '## Allegato f2 · nota.txt\nPercorso: /Lavori/nota.txt\nfile .txt, 2 KB · qui sotto, intero.'
    )
    expect(texts[2]).toBe('Ciao')
    expect(texts[3]).toBe(
      '## Allegato f3 · archivio.pdf\nPercorso: /Lavori/archivio.pdf\nPDF, 900 pagine, 48.0 MB · solo il riferimento: con il suo testo (1.250.000 caratteri) la richiesta passerebbe i 600.000 che porta intera. Si legge con `leggi f3`, quanto serve.'
    )
    expect(texts[4]).toBe(
      '## Allegato f4 · disegno.dwg\nPercorso: /Lavori/disegno.dwg\nfile .dwg, 2 KB · non si legge: i file .dwg non sono testo.'
    )
    expect(texts[5]).toBe(
      '## Allegato f5 · scansione.pdf\nPercorso: /Lavori/scansione.pdf\nPDF, 5 pagine, 2 KB · qui sotto, intero.'
    )
    expect(texts[6]).toBe('## Immagine incollata · PNG, 240 KB · qui sotto, intero.')
    expect(texts).toHaveLength(11)
    expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(10)

    expect(sent.map(({ name, handle, shortfall }) => [name, handle, shortfall])).toEqual([
      ['nota.txt', 'f2', null],
      ['archivio.pdf', 'f3', 'too-long'],
      ['disegno.dwg', 'f4', 'unreadable'],
      ['scansione.pdf', 'f5', null],
      ...Array.from({ length: 5 }, () => ['image.png', null, null])
    ])
    expect(sent[0]).toEqual({
      name: 'nota.txt',
      kind: 'file',
      size: 2_048,
      pages: null,
      path: '/Lavori/nota.txt',
      thumbnail: null,
      handle: 'f2',
      shortfall: null
    })
  })
})

describe('AttachmentShelf', () => {
  it('keeps what it read for the request, without what the model reads, until it goes', async () => {
    const shelf = new AttachmentShelf()
    const prepared = await shelf.prepare({ path: await file('nota.txt', 'Ciao') })

    if ('error' in prepared) {
      throw new Error(prepared.error)
    }

    expect(prepared).not.toHaveProperty('body')
    expect(shelf.take([prepared.id], '')[0]).toMatchObject({
      id: prepared.id,
      body: [{ text: 'Ciao' }]
    })

    shelf.drop([prepared.id])
    expect(() => shelf.take([prepared.id], 'Leggilo')).toThrow(
      'An attachment is no longer ready: add it again.'
    )
  })

  it('refuses a request with no words and nothing that goes', async () => {
    const shelf = new AttachmentShelf()
    const pasted = await shelf.prepare({
      picture: { name: 'image.heic', type: 'image/heic', data: new Uint8Array([1, 2, 3]) }
    })

    if ('error' in pasted) {
      throw new Error(pasted.error)
    }

    // A picture without a file that cannot be read does not go.
    expect(pasted.shortfall).toBe('unreadable')
    expect(() => shelf.take([pasted.id], '  ')).toThrow(
      'Write something to the Segretario, or add a file.'
    )
    expect(shelf.take([pasted.id], 'Guarda')).toHaveLength(1)
  })
})
