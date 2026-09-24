import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import extensionRenderer from '@app/extension/renderer'

import App from './App'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
