/**
 * The public build's shared side: no extension — no identity, the host's
 * own fonts, default font and colours, and no commands of its own.
 * `@app/extension/shared` resolves here unless an extension is loaded.
 */
import type { ExtensionShared } from './types'

const noExtensionShared: ExtensionShared = {
  identity: null,
  composition: {
    fonts: [],
    textColors: [],
    extraFontStacks: []
  },
  commands: []
}

export default noExtensionShared
