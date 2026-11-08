/**
 * The public build's main side: no extension. Vite resolves
 * `@app/extension/main` here unless an extension is loaded
 * (`LOAD_EXTENSION=1`, see `electron.vite.config.ts`).
 */
import type { ExtensionMain } from './types'

const noExtensionMain: ExtensionMain = {
  defaultAccountSignatureHtml: '',
  install(): void {
    /* nothing to install in the public build */
  },
  async clearData(): Promise<void> {
    /* nothing stored in the public build */
  }
}

export default noExtensionMain
