/**
 * Lays `html` out in a frame nobody sees, at `width`, and hands its document
 * to `work`. The frame is sandboxed like the reading pane — no script runs
 * in it — and removed when `work` settles.
 */
export function withOffscreenFrame<T>(
  html: string,
  width: number,
  work: (document: Document) => T | Promise<T>
): Promise<T> {
  return withOffscreenFrames([html], width, ([document]) => work(document))
}

/** `withOffscreenFrame` for several documents, laid out at the same width. */
export async function withOffscreenFrames<T>(
  htmls: ReadonlyArray<string>,
  width: number,
  work: (documents: Document[]) => T | Promise<T>
): Promise<T> {
  const frames = htmls.map(() => createFrame(width))

  try {
    return await work(await Promise.all(frames.map((frame, index) => load(frame, htmls[index]))))
  } finally {
    frames.forEach((frame) => frame.remove())
  }
}

function createFrame(width: number): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:10px;border:0;visibility:hidden;pointer-events:none`
  document.body.appendChild(frame)
  return frame
}

function load(frame: HTMLIFrameElement, html: string): Promise<Document> {
  return new Promise((resolve, reject) => {
    frame.addEventListener(
      'load',
      () => {
        if (frame.contentDocument) {
          resolve(frame.contentDocument)
        } else {
          reject(new Error('Impossibile preparare il messaggio.'))
        }
      },
      { once: true }
    )
    frame.srcdoc = html
  })
}
