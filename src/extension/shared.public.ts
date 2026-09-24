/**
 * No-op composition for the public build: the host's own fonts, default
 * font and colours, nothing added. `@app/extension/shared` resolves here
 * unless an extension is loaded.
 */
import type { ExtensionComposition } from './types'

const publicComposition: ExtensionComposition = {
  fonts: [],
  textColors: [],
  extraFontStacks: []
}

export default publicComposition
