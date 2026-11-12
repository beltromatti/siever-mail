import { statSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem, version as osVersion } from 'node:os'

import { app } from 'electron'

import { languageState } from '@main/i18n'

import { diagnosticsInfo, diagnosticsSession } from './log'

/**
 * Which SIEVER Mail profile this is (vision §15.3): the installed app's,
 * development's, or one given on the command line — the studio di prova's.
 */
export function profileKind(): 'installed' | 'development' | 'custom' {
  if (app.commandLine.hasSwitch('user-data-dir')) {
    return 'custom'
  }

  return app.isPackaged ? 'installed' : 'development'
}

/** The system the app runs on, in one line: `darwin 25.6.0 arm64`. */
export function systemLine(): string {
  return `${platform()} ${release()} ${arch()}`
}

/**
 * The shell's own state in an export (§14.4): the build and its edition,
 * the system, the profile, the interface's language and how it writes
 * dates, how long it has run and what it takes, the database's size, the log's.
 */
export function appDiagnosticState(about: {
  edition: string
  databasePath: string
}): Record<string, unknown> {
  const memory = process.memoryUsage()
  const megabytes = (bytes: number): number => Math.round(bytes / 1024 / 1024)
  const sizeOf = (path: string): number | null => {
    try {
      return statSync(path).size
    } catch {
      return null
    }
  }

  return {
    version: app.getVersion(),
    edition: about.edition,
    packaged: app.isPackaged,
    profile: profileKind(),
    session: diagnosticsSession(),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    system: {
      os: systemLine(),
      osVersion: osVersion(),
      cpus: cpus().length,
      memoryMb: megabytes(totalmem())
    },
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    locale: app.getLocale(),
    language: languageState(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    memoryMb: {
      rss: megabytes(memory.rss),
      heapUsed: megabytes(memory.heapUsed),
      external: megabytes(memory.external)
    },
    // Each of the app's processes — the main one, the window, the GPU —: what it takes now.
    processes: app.getAppMetrics().map((metric) => ({
      type: metric.type,
      memoryMb: Math.round(metric.memory.workingSetSize / 1024),
      cpuPercent: Math.round(metric.cpu.percentCPUUsage * 10) / 10
    })),
    databaseBytes: sizeOf(about.databasePath),
    databaseWalBytes: sizeOf(`${about.databasePath}-wal`),
    diagnostics: diagnosticsInfo()
  }
}
