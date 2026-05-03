/**
 * No-op host-side implementation of the extension contract. Vite resolves
 * `@app/extension/main` to this file in standard public builds; a
 * customised build (e.g. SIEVER_FEATURES=1) swaps the alias to the real
 * extension's main entry.
 */
import type { ExtensionMain } from './types'

const noopExtensionMain: ExtensionMain = {
  id: 'noop',
  displayName: 'No extension',
  defaultAccountSignatureHtml: '',
  install(): void {
    /* nothing to install in the public build */
  }
}

export default noopExtensionMain
