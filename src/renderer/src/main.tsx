import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'

import extensionRenderer from '@app/extension/renderer'

import App from './App'
import { ErrorBoundary } from './components/error-boundary'
// The app's own faces, bundled: Mona Sans for the interface, every weight
// and width; Newsreader for what the Segretario writes.
import '@fontsource-variable/mona-sans/standard.css'
import '@fontsource-variable/mona-sans/standard-italic.css'
import '@fontsource-variable/newsreader/standard.css'
import '@fontsource-variable/newsreader/standard-italic.css'
import './styles/globals.css'

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
// asked for never fails in silence (§13ter.3). A request stopped on purpose is not a failure.
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason

  if (reason instanceof DOMException && reason.name === 'AbortError') {
    return
  }

  console.error('[renderer] Unhandled rejection', reason)
  // The same failure again, from every call it breaks, is said once.
  const message = reason instanceof Error ? reason.message : undefined
  toast.error('Qualcosa non è andato', { id: `unhandled:${message ?? ''}`, description: message })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary whole className="paper h-screen">
      <App />
    </ErrorBoundary>
  </StrictMode>
)
