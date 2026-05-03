/**
 * No-op preload-side hook. Resolved by `@app/extension/preload` in
 * public builds; a customised build can swap this for an installer that
 * exposes additional methods on `window.mailApi`.
 */
import type { ExtensionPreloadInstaller } from './types'

const noopExtensionPreloadInstaller: ExtensionPreloadInstaller = () => ({})

export default noopExtensionPreloadInstaller
