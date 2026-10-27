import { join } from 'node:path'

import { is } from '@electron-toolkit/utils'
import { BrowserWindow } from 'electron'

import { PDF_PAGES_IPC, type PdfPagesRequest, type PdfPagesResult } from '@shared/pdf-pages'

/** The hidden page closes when nothing has been drawn for this long. */
const IDLE_CLOSE_MS = 60_000
/** A page that does not answer in this time is given up, and the window with it. */
const RENDER_TIMEOUT_MS = 90_000

interface PendingRender {
  resolve: (images: Array<{ page: number; jpeg: Buffer }>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Draws a PDF's pages as JPEG pictures, for the Segretario to look at a
 * scan. The drawing happens in a hidden, sandboxed window — PDF.js on the
 * browser's own canvas, its image decoders in WebAssembly — opened when a
 * scan is first read and closed a minute after the last.
 */
class PdfPageRenderer {
  private window: BrowserWindow | null = null
  private loaded: Promise<BrowserWindow> | null = null
  private readonly pending = new Map<number, PendingRender>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null

  async render(
    data: Uint8Array,
    pages: number[],
    width: number
  ): Promise<Array<{ page: number; jpeg: Buffer }>> {
    this.cancelIdleClose()

    try {
      const window = await this.open()
      const id = this.nextId++

      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error('Le pagine del PDF non sono state disegnate in tempo.'))
          this.close()
        }, RENDER_TIMEOUT_MS)

        this.pending.set(id, { resolve, reject, timer })
        window.webContents.send(PDF_PAGES_IPC.render, {
          id,
          data,
          pages,
          width
        } satisfies PdfPagesRequest)
      })
    } finally {
      if (this.pending.size === 0) {
        this.scheduleIdleClose()
      }
    }
  }

  private open(): Promise<BrowserWindow> {
    if (this.loaded) {
      return this.loaded
    }

    const window = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        preload: join(__dirname, '../preload/pdf-pages.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false
      }
    })

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.ipc.on(PDF_PAGES_IPC.rendered, (_event, result: PdfPagesResult) =>
      this.settle(result)
    )
    window.webContents.on('render-process-gone', (_event, details) => {
      this.failAll(new Error(`La pagina che disegna i PDF si è chiusa (${details.reason}).`))
      this.close()
    })
    window.once('closed', () => {
      this.failAll(new Error('La pagina che disegna i PDF è stata chiusa.'))

      if (this.window === window) {
        this.window = null
        this.loaded = null
      }
    })

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    const loading =
      is.dev && rendererUrl
        ? window.loadURL(`${rendererUrl}/pdf-pages.html`)
        : window.loadFile(join(__dirname, '../renderer/pdf-pages.html'))

    this.window = window
    this.loaded = loading.then(
      () => window,
      (error: unknown) => {
        this.close()
        throw error instanceof Error ? error : new Error(String(error))
      }
    )

    return this.loaded
  }

  private settle(result: PdfPagesResult): void {
    const pending = this.pending.get(result.id)

    if (!pending) {
      return
    }

    this.pending.delete(result.id)
    clearTimeout(pending.timer)

    if (result.ok) {
      pending.resolve(
        result.images.map((image) => ({ page: image.page, jpeg: Buffer.from(image.jpeg) }))
      )
    } else {
      pending.reject(new Error(result.error))
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose()
    this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS)
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private close(): void {
    this.cancelIdleClose()
    const window = this.window
    this.window = null
    this.loaded = null

    if (window && !window.isDestroyed()) {
      window.destroy()
    }
  }
}

const renderer = new PdfPageRenderer()

/** Pages of a PDF drawn as JPEG pictures `width` pixels wide, counted from 1. */
export function renderPdfPages(
  data: Uint8Array,
  pages: number[],
  width: number
): Promise<Array<{ page: number; jpeg: Buffer }>> {
  return renderer.render(data, pages, width)
}
