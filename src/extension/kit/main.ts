/**
 * The host's helpers an extension's main side may use, besides the
 * contract (`../types.ts`): they keep their meaning here whatever moves
 * inside the host. `@app/extension/kit/main`.
 */
export { mapParsedAddresses } from '@main/services/mail-engine/message-mapper'
export {
  parseMessageSource,
  partitionMessageAttachments
} from '@main/services/mail-engine/message-parts'
export { canonicalPath, reachablePath } from '@main/services/network-volumes'
/**
 * The interface's language in the main process (vision §13.5): what the
 * extension says to the user — a notification, an error, a dialog — in it.
 */
export { currentLanguage, languageState, messages } from '@main/i18n'
