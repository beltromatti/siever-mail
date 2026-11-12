import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'

import extensionRenderer from '@app/extension/renderer'
import { defineMessages } from '@shared/i18n'

import App from './App'
import { ErrorBoundary } from './components/error-boundary'
import { uiLog } from './lib/diagnostics'
import { LanguageProvider, messagesNow } from './lib/i18n'
// The app's own faces, bundled: Mona Sans for the interface, every weight
// and width; Newsreader for what the Segretario writes.
import '@fontsource-variable/mona-sans/standard.css'
import '@fontsource-variable/mona-sans/standard-italic.css'
import '@fontsource-variable/newsreader/standard.css'
import '@fontsource-variable/newsreader/standard-italic.css'
import './styles/globals.css'

const MESSAGES = defineMessages({
  failed: {
    en: 'Something went wrong',
    it: 'Qualcosa non è andato',
    de: 'Etwas ist schiefgelaufen'
  }
})

// Fonts an extension bundles are available to the whole app — the editor's
// font menu shows each name in its own face.
if (extensionRenderer.fontFaceCss) {
  const fontFaces = document.createElement('style')
  fontFaces.textContent = extensionRenderer.fontFaceCss
  document.head.append(fontFaces)
}

// A file dropped anywhere that is not a drop target would make Chromium
// navigate the window to it, replacing the app with the file. Drop targets
// claim their drags with preventDefault; only an unclaimed one is refused.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => {
    if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'none'
  })
}

// A promise nobody waited on that failed: written in the log, and said — an action the user
// asked for never fails in silence (§14.3). A request stopped on purpose is not a failure.
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason

  if (reason instanceof DOMException && reason.name === 'AbortError') {
    return
  }

  // Written once, here, with where it came from: not printed again to the console.
  event.preventDefault()
  uiLog.error('promise.rejected', reason)
  // The same failure again, from every call it breaks, is said once.
  const message = reason instanceof Error ? reason.message : undefined
  toast.error(messagesNow(MESSAGES).failed, {
    id: `unhandled:${message ?? ''}`,
    description: message
  })
})

// What broke while drawing, as React reports it: written in the log with the component it broke
// in (§14.3, §14.4), in place of React's printing it.
const drawingFailed =
  (ev: string) =>
  (error: unknown, info: { componentStack?: string }): void =>
    uiLog.error(ev, error, { componentStack: info.componentStack?.trim() })

createRoot(document.getElementById('root')!, {
  // A part of the window that broke and shows it (`ErrorBoundary`).
  onCaughtError: drawingFailed('ui.broken'),
  // Nothing around it took it: the window is gone.
  onUncaughtError: drawingFailed('ui.crashed'),
  // React drew it again by itself, and it went.
  onRecoverableError: (error, info) =>
    uiLog.warn('ui.recovered', {
      message: error instanceof Error ? error.message : String(error),
      componentStack: info.componentStack?.trim()
    })
}).render(
  <StrictMode>
    <LanguageProvider>
      <ErrorBoundary whole className="paper h-screen">
        <App />
      </ErrorBoundary>
    </LanguageProvider>
  </StrictMode>
)
