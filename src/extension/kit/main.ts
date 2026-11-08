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
