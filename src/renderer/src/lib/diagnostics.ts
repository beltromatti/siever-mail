import type { DiagnosticFields, PageDiagnostic } from '@shared/diagnostics'

/**
 * The page's side of the diagnostics (vision §14.4): what the user does
 * here and what goes wrong, written in the same log as the rest. Each
 * event is a short name (`app.open`, `composer.open`) with its fields:
 * never the text of a message, a search or a note — the counts, the kinds,
 * where it happened. Recording never waits and never fails what it records.
 */
export interface PageDiagnostics {
  info(ev: string, fields?: DiagnosticFields): void
  warn(ev: string, fields?: DiagnosticFields): void
  /** Something failed: `ev` says what, the error why. */
  error(ev: string, error?: unknown, fields?: DiagnosticFields): void
}

function record(event: PageDiagnostic): void {
  try {
    window.diagnosticsApi?.record(event)
  } catch {
    // A page without its bridge — a test — records nothing.
  }
}

/** An error as it crosses to the main process, which keeps it as its own (`errorOf`). */
function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: typeof error === 'string' ? error : String(error) }
}

/** The diagnostics of a part of the page: the app's (`ui`), or an extension's (`ext:<id>`). */
export function diagnosticsFor(area: PageDiagnostic['area']): PageDiagnostics {
  return {
    info: (ev, fields) => record({ area, ev, fields }),
    warn: (ev, fields) => record({ area, ev, lvl: 'warn', fields }),
    error: (ev, error, fields) =>
      record({
        area,
        ev,
        lvl: 'error',
        fields: error === undefined ? fields : { ...fields, err: errorFields(error) }
      })
  }
}

/** The app's page. */
export const uiLog = diagnosticsFor('ui')
