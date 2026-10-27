import { fetchData, getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import type { PdfPagesBridge, PdfPagesRequest, PdfPagesResult } from '@shared/pdf-pages'

declare global {
  interface Window {
    pdfPages: PdfPagesBridge
  }
}

GlobalWorkerOptions.workerSrc = workerUrl

/**
 * The files PDF.js asks for by name, as the build placed them: the
 * WebAssembly decoders of JBIG2 and JPEG 2000 scans and of colour
 * profiles, and the two standard fonts the system cannot stand in for.
 */
function byFileName(assets: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(assets).map(([path, url]) => [path.split('/').pop() ?? path, url]))
}

const WASM = byFileName(
  import.meta.glob('../../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', {
    query: '?url',
    import: 'default',
    eager: true
  })
)
const STANDARD_FONTS = byFileName(
  import.meta.glob(
    '../../../../node_modules/pdfjs-dist/standard_fonts/Foxit{Symbol,Dingbats}.pfb',
    { query: '?url', import: 'default', eager: true }
  )
)

/** Hands PDF.js its files from where the build put them, rather than from a folder of fixed names. */
class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = (
      kind === 'wasmUrl' ? WASM : kind === 'standardFontDataUrl' ? STANDARD_FONTS : null
    )?.get(filename)

    if (!url) {
      throw new Error(`PDF.js chiede ${filename} (${kind}), che non è incluso nell'app.`)
    }

    return (await fetchData(url, 'bytes')) as Uint8Array
  }
}

/** A JPEG is a fraction of a PNG for a scan, and reads as well. */
const JPEG_QUALITY = 0.82
/** No picture a page declares may take more than this many pixels to decode. */
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024

async function render(request: PdfPagesRequest): Promise<PdfPagesResult> {
  const loading = getDocument({
    data: request.data,
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
    enableXfa: false,
    maxImageSize: MAX_IMAGE_PIXELS
  })

  try {
    const pdf = await loading.promise
    const images: Array<{ page: number; jpeg: Uint8Array }> = []

    for (const pageNumber of request.pages) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({
        scale: request.width / page.getViewport({ scale: 1 }).width
      })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)

      // Printing draws without waiting for animation frames, which a
      // window never shown does not get.
      await page.render({ canvas, viewport, intent: 'print' }).promise
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
      )

      if (!blob) {
        throw new Error(`La pagina ${pageNumber} non si è potuta salvare come immagine.`)
      }

      images.push({ page: pageNumber, jpeg: new Uint8Array(await blob.arrayBuffer()) })
      page.cleanup()
    }

    return { id: request.id, ok: true, images }
  } finally {
    await loading.destroy()
  }
}

window.pdfPages.onRequest((request) => {
  render(request)
    .then((result) => window.pdfPages.reply(result))
    .catch((error: unknown) =>
      window.pdfPages.reply({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    )
})
