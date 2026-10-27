import type { BrowserWindow } from 'electron'

let appWindow: BrowserWindow | null = null

/**
 * The window the user works in. It is not the only one: a hidden page draws
 * scanned PDF pages for the Segretario (`ai/pdf-pages.ts`). So what the
 * interface is told, and what a notification brings forward, goes to this
 * window by name, never to "the first window".
 */
export function setAppWindow(window: BrowserWindow): void {
  appWindow = window
  window.once('closed', () => {
    if (appWindow === window) {
      appWindow = null
    }
  })
}

export function getAppWindow(): BrowserWindow | null {
  return appWindow && !appWindow.isDestroyed() ? appWindow : null
}
