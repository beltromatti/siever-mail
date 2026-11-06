import { ipcMain } from 'electron'

import { fileSources } from '@main/files/file-sources'
import { logMainError } from '@main/utils/error-utils'
import { FILES_IPC } from '@shared/files'

/** The File source's channels: for now, what the computer holds — its folders and its volumes. */
export function registerFilesIpc(): void {
  ipcMain.handle(FILES_IPC.sources, async () => {
    try {
      return await fileSources()
    } catch (error) {
      logMainError('Reading the File sources failed', error)
      throw error
    }
  })
}
