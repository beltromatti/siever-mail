/**
 * The diagnostics (vision §14.4): what SIEVER Mail writes down on this
 * computer of what happens in it — errors, the state of its parts, how it
 * is used, what the Segretario does — one structured line per event, for
 * whoever has to understand it later. Nothing leaves the computer unless
 * the user exports it and hands it over.
 */

/**
 * The part of SIEVER Mail an event belongs to: the shell, the page, each
 * app at par, the Segretario, an extension by its id. The console of the
 * main process — what a library prints — comes as `console`.
 */
export type DiagnosticArea =
  'app' | 'ui' | 'mail' | 'calendar' | 'files' | 'segretario' | 'console' | `ext:${string}`

export type DiagnosticLevel = 'info' | 'warn' | 'error'

/** Who made it happen: the user, the Segretario, or the app by itself (as the registry's actors, §3.2). */
export type DiagnosticActor = 'user' | 'segretario' | 'system'

/**
 * The fields every event may carry, besides its own. They tie events
 * together: who acted, the Segretario's run it belongs to, the connection
 * it is about, how long it took.
 */
export interface DiagnosticContext {
  by?: DiagnosticActor
  /** The Segretario's run (its activity id): its session, in full, is in the export. */
  run?: string
  /** The connection: a mailbox's id, a calendar connection's id. */
  conn?: string
  /** How long it took, in milliseconds. */
  ms?: number
}

export type DiagnosticFields = DiagnosticContext & Record<string, unknown>

/** An event the page records: what the user does there, what goes wrong in it. */
export interface PageDiagnostic {
  /** `ui`, or the extension the page part belongs to. */
  area: 'ui' | `ext:${string}`
  ev: string
  lvl?: DiagnosticLevel
  fields?: DiagnosticFields
}

/** What the export takes, chosen by the user. */
export interface DiagnosticsExportOptions {
  /** How many days back: the log, and the Segretario's sessions. */
  days: number
  /** The Segretario's work in full: its sessions and its memory — the text it read and wrote. */
  segretario: boolean
}

/** The diagnostics as Settings shows them. */
export interface DiagnosticsInfo {
  /** The folder they are kept in. */
  folder: string
  /** How many days are kept. */
  keptDays: number
  /** Their size on disk, in bytes. */
  bytes: number
  /** The oldest day kept (AAAA-MM-GG), null with none yet. */
  since: string | null
}

/** Where an export went, or null when the user let it go. */
export type DiagnosticsExport = { path: string; bytes: number } | null

/** The periods the export offers, in days. */
export const DIAGNOSTICS_EXPORT_DAYS = [1, 7, 21] as const

export const DIAGNOSTICS_IPC = {
  record: 'diagnostics:record',
  info: 'diagnostics:info',
  export: 'diagnostics:export',
  openFolder: 'diagnostics:open-folder'
} as const

/** The page's side: `window.diagnosticsApi`. */
export interface DiagnosticsApi {
  /** Written down, never awaited: recording must not slow down what it records. */
  record: (event: PageDiagnostic) => void
  info: () => Promise<DiagnosticsInfo>
  export: (options: DiagnosticsExportOptions) => Promise<DiagnosticsExport>
  openFolder: () => Promise<void>
}
