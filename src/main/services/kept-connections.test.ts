import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** `better-sqlite3` is built for Electron: the same SQL runs on Node's own SQLite (see data-migration.test.ts). */
class SqliteTestAdapter {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
  }

  pragma(statement: string): void {
    this.db.exec(`PRAGMA ${statement}`)
  }

  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[]
    get: (...params: unknown[]) => unknown
  } {
    const statement = this.db.prepare(sql)
    return {
      all: (...params: unknown[]) => statement.all(...(params as never[])),
      get: (...params: unknown[]) => statement.get(...(params as never[]))
    }
  }

  close(): void {
    this.db.close()
  }
}

vi.mock('better-sqlite3', () => ({ default: SqliteTestAdapter }))
vi.mock('electron', () => ({ app: {}, dialog: {}, shell: {} }))

const {
  KEPT_CONNECTIONS_FILE,
  insertStatements,
  keptConnectionsOf,
  readConnections,
  writeKeptConnections
} = await import('./kept-connections')
const { clearProfile } = await import('../uninstall')

const ACCOUNTS = `CREATE TABLE accounts (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL,
  smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL,
  username TEXT NOT NULL, auth_type TEXT NOT NULL, encrypted_secret TEXT NOT NULL,
  last_viewed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
const CALENDARS = `CREATE TABLE calendar_connections (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, mail_account_id TEXT,
  server_url TEXT, username TEXT, encrypted_secret TEXT, connected_at INTEGER NOT NULL,
  last_sync_at INTEGER, problem TEXT)`

let profile: string

/** A profile as the app leaves it: the database with its connections and everything else. */
function makeProfile(withConnections = true): void {
  const db = new DatabaseSync(join(profile, 'siever-mail.sqlite'))
  db.exec(ACCOUNTS)
  db.exec(CALENDARS)
  db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, subject TEXT)')
  db.exec("INSERT INTO messages VALUES ('m1', 'Preventivo cucina')")

  if (withConnections) {
    db.exec(`INSERT INTO accounts VALUES ('a1', 'imap', 'anna@brenta.it', 'Anna', 'imap.brenta.it', 993, 1,
      'smtp.brenta.it', 465, 1, 'anna@brenta.it', 'password', 'c2VncmV0bw==', 1700000000000, 1690000000000, 1700000000000)`)
    db.exec(`INSERT INTO calendar_connections VALUES ('c1', 'caldav', 'Lavoro', NULL, 'https://dav.brenta.it',
      'anna', 'c2VncmV0bw==', 1690000000000, 1700000000000, NULL)`)
  }

  db.close()
  mkdirSync(join(profile, 'drafts'))
  writeFileSync(join(profile, 'drafts', 'bozza.eml'), 'x')
  writeFileSync(join(profile, 'Local State'), '{"os_crypt":{}}')
  writeFileSync(join(profile, 'theme-mode'), 'dark')
}

beforeEach(() => {
  profile = join(mkdtempSync(join(tmpdir(), 'siever-kept-')), 'siever-mail')
  mkdirSync(profile)
})

afterEach(() => {
  rmSync(join(profile, '..'), { recursive: true, force: true })
})

describe('kept connections', () => {
  it('reads the connections of a profile, without what says how they were used', () => {
    makeProfile()
    const kept = readConnections(profile)

    expect(kept?.accounts).toEqual([
      expect.objectContaining({
        id: 'a1',
        email: 'anna@brenta.it',
        encrypted_secret: 'c2VncmV0bw=='
      })
    ])
    expect(kept?.accounts[0]).not.toHaveProperty('last_viewed_at')
    expect(kept?.calendarConnections[0]).toMatchObject({ id: 'c1', provider: 'caldav' })
    expect(kept?.calendarConnections[0]).not.toHaveProperty('last_sync_at')
  })

  it('keeps nothing where there is nothing to keep', () => {
    expect(readConnections(profile)).toBeNull()
    makeProfile(false)
    expect(readConnections(profile)).toBeNull()
  })

  it('goes through its file and back, and refuses a file it cannot read', () => {
    makeProfile()
    writeKeptConnections(profile, readConnections(profile)!)
    expect(keptConnectionsOf(profile)?.accounts[0]).toMatchObject({ id: 'a1' })

    writeFileSync(join(profile, KEPT_CONNECTIONS_FILE), '{"format":9}')
    expect(() => keptConnectionsOf(profile)).toThrow()
  })

  it('puts kept rows into a newer table by the columns it has, the rest left to their defaults', () => {
    makeProfile()
    const kept = readConnections(profile)!
    const fresh = new DatabaseSync(':memory:')
    fresh.exec(
      ACCOUNTS.replace(
        'last_viewed_at INTEGER,',
        'last_viewed_at INTEGER, graph_send INTEGER NOT NULL DEFAULT 0,'
      )
    )
    const columns = new Set(
      (fresh.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    )

    for (const { sql, values } of insertStatements(
      'accounts',
      [...kept.accounts, { email: 'x' }],
      columns
    )) {
      fresh.prepare(sql).run(...values)
      fresh.prepare(sql).run(...values)
    }

    expect(
      fresh.prepare('SELECT id, email, graph_send, last_viewed_at FROM accounts').all()
    ).toEqual([{ id: 'a1', email: 'anna@brenta.it', graph_send: 0, last_viewed_at: null }])
  })
})

describe('clearProfile', () => {
  it('keeps the connections alone, with the key that opens them where the system keeps it there', async () => {
    makeProfile()

    expect(await clearProfile(profile, 'connessioni', 'win32')).toEqual([])
    expect(readdirSync(profile).sort()).toEqual(['Local State', KEPT_CONNECTIONS_FILE])
    expect(keptConnectionsOf(profile)?.calendarConnections[0]).toMatchObject({ id: 'c1' })
  })

  it('keeps no key file on macOS, where the key is in the keychain', async () => {
    makeProfile()

    await clearProfile(profile, 'connessioni', 'darwin')
    expect(readdirSync(profile)).toEqual([KEPT_CONNECTIONS_FILE])
  })

  it('takes everything, the profile too, when nothing is to stay', async () => {
    makeProfile()

    expect(await clearProfile(profile, 'niente', 'win32')).toEqual([])
    expect(existsSync(profile)).toBe(false)
  })

  it('keeps what a former uninstall kept, uninstalled again before a start', async () => {
    makeProfile()
    await clearProfile(profile, 'connessioni', 'linux')
    await clearProfile(profile, 'connessioni', 'linux')

    expect(readdirSync(profile).sort()).toEqual(['Local State', KEPT_CONNECTIONS_FILE])
  })

  it('never empties a folder that is not a SIEVER Mail profile', async () => {
    writeFileSync(join(profile, 'documento.txt'), 'mio')

    expect(await clearProfile(profile, 'niente', 'win32')).toHaveLength(1)
    expect(readdirSync(profile)).toEqual(['documento.txt'])
  })
})
