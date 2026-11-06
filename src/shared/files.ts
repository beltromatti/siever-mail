/**
 * The File source, as it is today: this computer and the volumes mounted on
 * it, local and network. They are the File family's connections in all but
 * name (see `src/shared/workspace.ts`): when the user connects drives —
 * Google Drive, OneDrive… — these stay the first of them.
 */
export interface FileSource {
  /** The user's folders on this computer, a disk plugged in, a network share. */
  kind: 'computer' | 'volume' | 'rete'
  label: string
  /** Where it starts: the user's home, or the volume's mount point. */
  path: string
  /** A network share seen before and not mounted now: mounted again when needed. */
  mounted: boolean
}

export const FILES_IPC = {
  sources: 'files:sources'
} as const

export interface FilesApi {
  /** The File sources of this computer, the computer first. */
  sources: () => Promise<FileSource[]>
}
