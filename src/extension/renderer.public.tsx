import type { ExtensionRenderer } from './types'

const noopExtensionRenderer: ExtensionRenderer = {
  id: 'noop',
  displayName: 'No extension',
  defaultAccountSignatureHtml: '',
  toolbarActions: [],
  settingsTabs: [],
  PrimaryActionDialog: null
}

export default noopExtensionRenderer
