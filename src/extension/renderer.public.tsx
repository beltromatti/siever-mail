/**
 * The public build's renderer side: no extension. Resolved by
 * `@app/extension/renderer` unless an extension is loaded.
 */
import type { ExtensionRenderer } from './types'

const noExtensionRenderer: ExtensionRenderer = {
  toolbarActions: [],
  settingsTabs: [],
  PrimaryActionDialog: null,
  fontFaceCss: '',
  localDataLabel: ''
}

export default noExtensionRenderer
