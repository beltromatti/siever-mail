/**
 * Exercises the upgrade data lifecycle against a real SQLite file.
 *
 * The regression these tests exist for: releases up to 1.7.1 wiped the
 * whole database on every version change and restored only accounts and
 * signatures, which silently destroyed the SIEVER archive root, the
 * manually-added practices and the app preferences on each update.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `better-sqlite3` ships as a native module compiled against Electron's ABI
 * (electron-builder rebuilds it in `postinstall`), so plain Node cannot load
 * it and neither can vitest. Node's own `node:sqlite` speaks the same SQL
 * against the same engine, so the migration logic — which is what these
 * tests are about — runs unchanged on top of a thin adapter.
 */
class SqliteTestAdapter {
  private readonly db: DatabaseSync

  constructor(path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) {
    this.db = new DatabaseSync(path, { readOnly: Boolean(options?.readonly) })
  }

  pragma(statement: string): void {
    this.db.exec(`PRAGMA ${statement}`)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[]
    get: (...params: unknown[]) => unknown
    run: (...params: unknown[]) => unknown
  } {
    const statement = this.db.prepare(sql)
    return {
      all: (...params: unknown[]) => statement.all(...(params as never[])),
      get: (...params: unknown[]) => statement.get(...(params as never[])),
      run: (...params: unknown[]) => statement.run(...(params as never[]))
    }
  }

  close(): void {
    this.db.close()
  }
}

vi.mock('better-sqlite3', () => ({ default: SqliteTestAdapter }))

const Database = SqliteTestAdapter

const appState = {
  userDataPath: '',
  version: '1.0.0',
  isPackaged: true
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    getVersion: () => appState.version,
    getPath: () => appState.userDataPath
  }
}))

const { finalizeUpgradeMigration, prepareUpgradeMigration } = await import('./data-migration')
type MigrationSqlExecutor = import('./data-migration').MigrationSqlExecutor

const DB_FILE_NAME = 'siever-mail.sqlite'

function dbPath(): string {
  return join(appState.userDataPath, DB_FILE_NAME)
}

/**
 * Minimal stand-in for the host schema: two cache tables the migration is
 * allowed to drop, plus the user-authored tables it must preserve —
 * including `archive_practices`, which the public host knows nothing about
 * and which only reaches the database through the SIEVER extension.
 */
function createSchema(db: SqliteTestAdapter): void {
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE account_signatures (account_id TEXT PRIMARY KEY, html TEXT NOT NULL);
    CREATE TABLE app_preferences (id INTEGER PRIMARY KEY, unified TEXT);
    CREATE TABLE contacts (email_normalized TEXT PRIMARY KEY, usage_count INTEGER);
    CREATE TABLE archive_settings (id INTEGER PRIMARY KEY, root_path TEXT);
    CREATE TABLE archive_practices (id TEXT PRIMARY KEY, practice_number TEXT, source TEXT);
    CREATE TABLE folders (id TEXT PRIMARY KEY, path TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, subject TEXT);
  `)
}

function seedUserAndCacheData(db: SqliteTestAdapter): void {
  db.prepare('INSERT INTO accounts VALUES (?, ?)').run('acc-1', 'a.beltrami@siever.it')
  db.prepare('INSERT INTO account_signatures VALUES (?, ?)').run('acc-1', '<p>Cordiali saluti</p>')
  db.prepare('INSERT INTO app_preferences VALUES (?, ?)').run(1, 'acc-1')
  db.prepare('INSERT INTO contacts VALUES (?, ?)').run('mario@rossi.it', 4)
  db.prepare('INSERT INTO archive_settings VALUES (?, ?)').run(1, 'Y:\\')
  db.prepare('INSERT INTO archive_practices VALUES (?, ?, ?)').run('p-1', '866', 'manual')
  db.prepare('INSERT INTO archive_practices VALUES (?, ?, ?)').run('p-2', '805', 'scan')
  db.prepare('INSERT INTO folders VALUES (?, ?)').run('f-1', 'INBOX')
  db.prepare('INSERT INTO messages VALUES (?, ?)').run('m-1', 'Sopralluogo')
}

/** Mirrors what `MailService` hands the finalize step in production. */
function createExecutor(db: SqliteTestAdapter): MigrationSqlExecutor {
  return {
    run: async (sql, params = []) => {
      db.prepare(sql).run(...(params as never[]))
    },
    all: async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
      db.prepare(sql).all(...(params as never[])) as T[]
  }
}

function countRows(db: SqliteTestAdapter, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total
}

beforeEach(() => {
  appState.userDataPath = mkdtempSync(join(tmpdir(), 'siever-migration-'))
  appState.version = '1.7.1'
  appState.isPackaged = true
})

afterEach(() => {
  rmSync(appState.userDataPath, { recursive: true, force: true })
})

describe('prepareUpgradeMigration', () => {
  it('stamps the version marker and does nothing else on a fresh install', () => {
    prepareUpgradeMigration()

    expect(existsSync(join(appState.userDataPath, 'install-version.json'))).toBe(true)
    expect(existsSync(join(appState.userDataPath, '.upgrade-pending.json'))).toBe(false)
  })

  it('is inert outside a packaged build unless explicitly forced', () => {
    appState.isPackaged = false

    prepareUpgradeMigration()

    expect(existsSync(join(appState.userDataPath, 'install-version.json'))).toBe(false)
  })

  it('never deletes the database when the version changes', () => {
    const db = new Database(dbPath())
    createSchema(db)
    seedUserAndCacheData(db)
    db.close()

    writeFileSync(
      join(appState.userDataPath, 'install-version.json'),
      JSON.stringify({ version: '1.7.0' })
    )
    appState.version = '1.8.0'

    prepareUpgradeMigration()

    expect(existsSync(dbPath())).toBe(true)
    expect(existsSync(join(appState.userDataPath, '.upgrade-backup.sqlite'))).toBe(true)
    expect(existsSync(join(appState.userDataPath, '.upgrade-pending.json'))).toBe(true)

    // The marker only moves once the upgrade is finalised, so an interrupted
    // run is still recognised as pending on the next launch.
    const marker = JSON.parse(
      readFileSync(join(appState.userDataPath, 'install-version.json'), 'utf8')
    ) as { version: string }
    expect(marker.version).toBe('1.7.0')
  })
})

describe('finalizeUpgradeMigration', () => {
  it('clears the resyncable cache and preserves every user-authored table', async () => {
    const db = new Database(dbPath())
    createSchema(db)
    seedUserAndCacheData(db)
    db.close()

    writeFileSync(
      join(appState.userDataPath, 'install-version.json'),
      JSON.stringify({ version: '1.7.0' })
    )
    appState.version = '1.8.0'

    prepareUpgradeMigration()

    const live = new Database(dbPath())
    await finalizeUpgradeMigration(createExecutor(live))

    // Cache: gone, the server is its source of truth.
    expect(countRows(live, 'messages')).toBe(0)
    expect(countRows(live, 'folders')).toBe(0)

    // User data: intact. This is the regression the customer reported.
    expect(countRows(live, 'accounts')).toBe(1)
    expect(countRows(live, 'account_signatures')).toBe(1)
    expect(countRows(live, 'app_preferences')).toBe(1)
    expect(countRows(live, 'contacts')).toBe(1)
    expect(countRows(live, 'archive_practices')).toBe(2)
    expect(
      (
        live.prepare('SELECT root_path FROM archive_settings WHERE id = 1').get() as {
          root_path: string
        }
      ).root_path
    ).toBe('Y:\\')

    live.close()

    // Bookkeeping is cleaned up and the new version is stamped.
    expect(existsSync(join(appState.userDataPath, '.upgrade-pending.json'))).toBe(false)
    expect(existsSync(join(appState.userDataPath, '.upgrade-backup.sqlite'))).toBe(false)
    const marker = JSON.parse(
      readFileSync(join(appState.userDataPath, 'install-version.json'), 'utf8')
    ) as { version: string }
    expect(marker.version).toBe('1.8.0')
  })

  it('recovers user data into a fresh schema when the previous upgrade never completed', async () => {
    const db = new Database(dbPath())
    createSchema(db)
    seedUserAndCacheData(db)
    db.close()

    writeFileSync(
      join(appState.userDataPath, 'install-version.json'),
      JSON.stringify({ version: '1.7.0' })
    )
    appState.version = '1.8.0'

    // First launch takes the backup, then dies before finalising.
    prepareUpgradeMigration()
    expect(existsSync(join(appState.userDataPath, '.upgrade-pending.json'))).toBe(true)

    // Second launch: the pending marker is still there, so the unusable file
    // is set aside and the app boots on a fresh schema.
    prepareUpgradeMigration()
    expect(existsSync(dbPath())).toBe(false)

    const fresh = new Database(dbPath())
    createSchema(fresh)
    await finalizeUpgradeMigration(createExecutor(fresh))

    // Everything the user authored is replayed — including the extension's
    // own tables, which the host never names anywhere.
    expect(countRows(fresh, 'accounts')).toBe(1)
    expect(countRows(fresh, 'account_signatures')).toBe(1)
    expect(countRows(fresh, 'contacts')).toBe(1)
    expect(countRows(fresh, 'archive_practices')).toBe(2)
    expect(
      (
        fresh.prepare('SELECT root_path FROM archive_settings WHERE id = 1').get() as {
          root_path: string
        }
      ).root_path
    ).toBe('Y:\\')

    // The cache is not replayed: it resyncs from the server.
    expect(countRows(fresh, 'messages')).toBe(0)
    expect(countRows(fresh, 'folders')).toBe(0)

    fresh.close()
    expect(existsSync(join(appState.userDataPath, '.upgrade-pending.json'))).toBe(false)
  })

  it('replays only the columns the new schema still has', async () => {
    const db = new Database(dbPath())
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL, legacy_column TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, subject TEXT);
    `)
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run('acc-1', 'a@siever.it', 'dropped')
    db.close()

    writeFileSync(
      join(appState.userDataPath, 'install-version.json'),
      JSON.stringify({ version: '1.7.0' })
    )
    appState.version = '1.8.0'

    prepareUpgradeMigration()
    prepareUpgradeMigration()

    const fresh = new Database(dbPath())
    fresh.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL, added_column TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, subject TEXT);
    `)
    await finalizeUpgradeMigration(createExecutor(fresh))

    const row = fresh.prepare('SELECT id, email, added_column FROM accounts').get() as {
      id: string
      email: string
      added_column: string | null
    }
    expect(row).toEqual({ id: 'acc-1', email: 'a@siever.it', added_column: null })
    fresh.close()
  })

  it('leaves the pending marker in place when finalising fails, so the next launch retries', async () => {
    const db = new Database(dbPath())
    createSchema(db)
    seedUserAndCacheData(db)
    db.close()

    writeFileSync(
      join(appState.userDataPath, 'install-version.json'),
      JSON.stringify({ version: '1.7.0' })
    )
    appState.version = '1.8.0'
    prepareUpgradeMigration()

    const failing: MigrationSqlExecutor = {
      run: async () => {
        throw new Error('database is locked')
      },
      all: async () => []
    }

    await finalizeUpgradeMigration(failing)

    expect(existsSync(join(appState.userDataPath, '.upgrade-pending.json'))).toBe(true)
    expect(existsSync(join(appState.userDataPath, '.upgrade-backup.sqlite'))).toBe(true)
    const marker = JSON.parse(
      readFileSync(join(appState.userDataPath, 'install-version.json'), 'utf8')
    ) as { version: string }
    expect(marker.version).toBe('1.7.0')
  })
})
