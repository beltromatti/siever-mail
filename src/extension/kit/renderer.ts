/**
 * The host's helpers an extension's renderer side may use, besides the
 * contract (`../types.ts`) and the interface's components
 * (`@renderer/components/ui/*`): they keep their meaning here whatever
 * moves inside the host. `@app/extension/kit/renderer`.
 */
export { useCommandKeys } from '@renderer/lib/command-shortcuts'
/** What the extension's page records, in the app's diagnostics under its area (`ext:<id>`, §14.4). */
export { diagnosticsFor } from '@renderer/lib/diagnostics'
export { summaryToMessageRef } from '@renderer/lib/message-selection'
export { cn } from '@renderer/lib/utils'
