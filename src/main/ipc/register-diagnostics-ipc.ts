import { join } from 'node:path'

import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'

import { writeDiagnosticsBundle, type DiagnosticsBundleSource } from '@main/diagnostics/export'
import {
  diagnostics,
  diagnosticsFolder,
  diagnosticsInfo,
  localDay,
  recordDiagnostic
} from '@main/diagnostics/log'
import { messages } from '@main/i18n'
import { handleIpc } from '@main/ipc/handle'
import {
  DIAGNOSTICS_EXPORT_DAYS,
  DIAGNOSTICS_IPC,
  type DiagnosticsExport,
  type DiagnosticsExportOptions
} from '@shared/diagnostics'
import { defineMessages } from '@shared/i18n'

const log = diagnostics('app')

const MESSAGES = defineMessages({
  notReady: {
    en: 'The diagnostics aren’t ready yet.',
    it: 'La diagnostica non è ancora pronta.',
    de: 'Die Diagnose ist noch nicht bereit.'
  },
  exportTitle: {
    en: 'Export diagnostics',
    it: 'Esporta la diagnostica',
    de: 'Diagnose exportieren'
  },
  exportButton: { en: 'Export', it: 'Esporta', de: 'Exportieren' },
  fileName: {
    en: (day: string) => `SIEVER Mail diagnostics ${day}.zip`,
    it: (day: string) => `SIEVER Mail diagnostica ${day}.zip`,
    de: (day: string) => `SIEVER Mail Diagnose ${day}.zip`
  },
  zipArchive: { en: 'Zip archive', it: 'Archivio zip', de: 'ZIP-Archiv' }
})

/** What the page records: its own area or an extension's, a short event, its fields. */
const pageDiagnosticSchema = z.object({
  area: z.union([z.literal('ui'), z.string().regex(/^ext:[a-z0-9-]+$/)]),
  ev: z.string().min(1).max(300),
  lvl: z.enum(['info', 'warn', 'error']).optional(),
  fields: z.record(z.string(), z.unknown()).optional()
})

const exportOptionsSchema = z.object({
  days: z.union(DIAGNOSTICS_EXPORT_DAYS.map((days) => z.literal(days))),
  segretario: z.boolean()
})

/**
 * The diagnostics' channels (vision §14.4): what the page records, the log
 * as Settings shows it, its folder, and the export the user makes to hand
 * over.
 */
export function registerDiagnosticsIpc(
  source: () => DiagnosticsBundleSource,
  getWindow: () => BrowserWindow | null
): void {
  // Sent, never awaited: recording must not slow down what it records. What is not well formed
  // is dropped — the page's mistake is not worth a line of its own each time.
  ipcMain.removeAllListeners(DIAGNOSTICS_IPC.record)
  ipcMain.on(DIAGNOSTICS_IPC.record, (_event, payload: unknown) => {
    const parsed = pageDiagnosticSchema.safeParse(payload)

    if (parsed.success) {
      // The page's error comes as the error of the event, kept as the main process keeps its own.
      const { area, ev, lvl, fields } = parsed.data
      const { err, ...rest } = fields ?? {}
      recordDiagnostic(lvl ?? 'info', area as 'ui' | `ext:${string}`, ev, rest, err)
    }
  })

  handleIpc('app', DIAGNOSTICS_IPC.info, () => diagnosticsInfo())

  handleIpc('app', DIAGNOSTICS_IPC.openFolder, async () => {
    const folder = diagnosticsFolder()
    const failure = folder ? await shell.openPath(folder) : messages(MESSAGES).notReady

    if (failure) {
      throw new Error(failure)
    }
  })

  handleIpc(
    'app',
    DIAGNOSTICS_IPC.export,
    async (input: DiagnosticsExportOptions): Promise<DiagnosticsExport> => {
      const options = exportOptionsSchema.parse(input)
      const window = getWindow()
      const m = messages(MESSAGES)
      const dialogOptions = {
        title: m.exportTitle,
        buttonLabel: m.exportButton,
        defaultPath: join(app.getPath('downloads'), m.fileName(localDay())),
        filters: [{ name: m.zipArchive, extensions: ['zip'] }]
      }
      const choice =
        window && !window.isDestroyed()
          ? await dialog.showSaveDialog(window, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)

      if (choice.canceled || !choice.filePath) {
        return null
      }

      const path = choice.filePath.toLowerCase().endsWith('.zip')
        ? choice.filePath
        : `${choice.filePath}.zip`
      const startedAt = Date.now()
      const bytes = await writeDiagnosticsBundle(path, options, source())
      log.info('diagnostics.export', {
        by: 'user',
        days: options.days,
        segretario: options.segretario,
        bytes,
        ms: Date.now() - startedAt
      })
      // It is made to be handed over: shown where it is, ready to attach.
      shell.showItemInFolder(path)
      return { path, bytes }
    },
    // The save dialog waits for the user; how long writing took is in the event above.
    { untimed: true }
  )
}
