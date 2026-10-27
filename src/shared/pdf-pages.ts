/**
 * A scanned PDF has no text to read: its pages are pictures. The main
 * process has them drawn by a hidden page (`src/renderer/pdf-pages.html`),
 * with the browser's own canvas and PDF.js, so the Segretario can look at
 * them — no native module to build for every platform.
 */
export const PDF_PAGES_IPC = {
  render: 'pdf-pages:render',
  rendered: 'pdf-pages:rendered'
} as const

export interface PdfPagesRequest {
  id: number
  data: Uint8Array
  /** The pages to draw, counted from 1. */
  pages: number[]
  /** How wide each picture is drawn, in pixels. */
  width: number
}

export type PdfPagesResult =
  | { id: number; ok: true; images: Array<{ page: number; jpeg: Uint8Array }> }
  | { id: number; ok: false; error: string }

/** What the hidden page's preload gives it. */
export interface PdfPagesBridge {
  onRequest(listener: (request: PdfPagesRequest) => void): void
  reply(result: PdfPagesResult): void
}
