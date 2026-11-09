import { fileSources } from '@main/files/file-sources'
import { handleIpc } from '@main/ipc/handle'
import { FILES_IPC } from '@shared/files'

/** The File source's channels: for now, what the computer holds — its folders and its volumes. */
export function registerFilesIpc(): void {
  handleIpc('files', FILES_IPC.sources, () => fileSources())
}
