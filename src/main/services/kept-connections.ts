import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'

/**
 * The connections an uninstall keeps when the user asks it to (vision
 * §13.2): the mailboxes and the calendar connections as they were set up,
 * with their access as the database had it — encrypted by the system's
 * keychain, which stays —, and nothing else of the profile. The next
 * install finds them connected; everything else starts new.
 *
 * They wait in a file of their own, beside nothing but the key that opens
 * them: a database left behind would be the user's mail left behind. The
 * rows are kept column by column, so a later version — with columns this
 * one does not know — takes what it has and gives the rest its defaults.
 */
export const KEPT_CONNECTIONS_FILE = 'connessioni-conservate.json'

/** A row as SQLite gives it: text, numbers, nothing. */
type Row = Record<string, string | number | null>

export interface KeptConnections {
  format: 1
  keptAt: number
  accounts: Row[]
  calendarConnections: Row[]
}

/**
 * What a connection's row says of how it was used, not of how it connects:
 * left out, and found again by the new install.
 */
const LEFT_OUT: Readonly<Record<string, ReadonlySet<string>>> = {
  accounts: new Set(['last_viewed_at']),
  calendar_connections: new Set(['last_sync_at'])
}

function rowsOf(database: Database.Database, table: 'accounts' | 'calendar_connections'): Row[] {
  const known = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)

  if (!known) {
    return []
  }

  return (database.prepare(`SELECT * FROM ${table}`).all() as Row[]).map((row) =>
    Object.fromEntries(Object.entries(row).filter(([column]) => !LEFT_OUT[table].has(column)))
  )
}

/** The connections of the profile's database, read before it goes; none when there is none. */
export function readConnections(profile: string): KeptConnections | null {
  const path = join(profile, 'siever-mail.sqlite')

  if (!existsSync(path)) {
    return null
  }

  // Opened to write: a log the app left behind is folded in, and nothing of it is lost.
  const database = new Database(path, { fileMustExist: true })

  try {
    database.pragma('busy_timeout = 5000')
    const kept: KeptConnections = {
      format: 1,
      keptAt: Date.now(),
      accounts: rowsOf(database, 'accounts'),
      calendarConnections: rowsOf(database, 'calendar_connections')
    }

    return kept.accounts.length + kept.calendarConnections.length > 0 ? kept : null
  } finally {
    database.close()
  }
}

export function writeKeptConnections(profile: string, kept: KeptConnections): void {
  writeFileSync(join(profile, KEPT_CONNECTIONS_FILE), JSON.stringify(kept), { mode: 0o600 })
}

/** The connections a former install kept for this one, if it did; read, not yet taken. */
export function keptConnectionsOf(profile: string): KeptConnections | null {
  const path = join(profile, KEPT_CONNECTIONS_FILE)

  if (!existsSync(path)) {
    return null
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<KeptConnections>

  if (parsed.format !== 1 || !Array.isArray(parsed.accounts)) {
    throw new Error('Le connessioni conservate sono in un formato che non si legge.')
  }

  return {
    format: 1,
    keptAt: Number(parsed.keptAt) || 0,
    accounts: parsed.accounts,
    calendarConnections: Array.isArray(parsed.calendarConnections) ? parsed.calendarConnections : []
  }
}

export function forgetKeptConnections(profile: string): void {
  rmSync(join(profile, KEPT_CONNECTIONS_FILE), { force: true })
}

/**
 * The statements that put kept rows into a table of this version: only the
 * columns it has, the others left to their defaults; a row already there
 * (the same connection added again) stays as it is.
 */
export function insertStatements(
  table: 'accounts' | 'calendar_connections',
  rows: ReadonlyArray<Row>,
  columns: ReadonlySet<string>
): Array<{ sql: string; values: Array<string | number | null> }> {
  return rows.flatMap((row) => {
    const names = Object.keys(row).filter((name) => columns.has(name))

    if (!names.includes('id')) {
      return []
    }

    return [
      {
        sql: `INSERT OR IGNORE INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        values: names.map((name) => row[name] ?? null)
      }
    ]
  })
}
