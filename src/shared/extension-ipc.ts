/**
 * An extension's own IPC channel: its name, under the extension's id, so it
 * is never one of the host's channels nor another extension's.
 */
export function extensionChannel(extensionId: string, name: string): string {
  return `extension:${extensionId}:${name}`
}
