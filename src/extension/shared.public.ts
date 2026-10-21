/**
 * No-op shared module for the public build: the host's own fonts, default
 * font and colours, and no commands of its own. `@app/extension/shared`
 * resolves here unless an extension is loaded.
 */
import type { ExtensionShared } from './types'

const publicShared: ExtensionShared = {
  composition: {
    fonts: [],
    textColors: [],
    extraFontStacks: []
  },
  commands: []
}

export default publicShared
