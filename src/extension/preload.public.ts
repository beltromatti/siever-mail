/**
 * The public build's preload side: no extension, so no `window.extensionApi`
 * bridge of its own. Resolved by `@app/extension/preload` unless an
 * extension is loaded.
 */
import type { ExtensionPreloadInstaller } from './types'

const noExtensionPreload: ExtensionPreloadInstaller = () => ({})

export default noExtensionPreload
