import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { app } from 'electron'

const DB_FILE_NAME = 'siever-mail.sqlite'
const DB_SIDECAR_FILE_NAMES = [
  `${DB_FILE_NAME}-wal`,
  `${DB_FILE_NAME}-shm`,
  `${DB_FILE_NAME}-journal`
]
const VERSION_MARKER_FILE_NAME = 'install-version.json'
const UPGRADE_STASH_FILE_NAME = '.upgrade-credentials-stash.json'
const ATTACHMENT_DIRECTORY_CANDIDATES = ['attachments', 'cache', 'temp', 'mail-cache']

const ACCOUNT_COLUMNS = [
  'id',
  'type',
  'email',
  'display_name',
  'imap_host',
  'imap_port',
  'imap_secure',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'username',
  'auth_type',
  'encrypted_secret',
  'last_viewed_at',
  'created_at',
  'updated_at'
] as const

type AccountColumn = (typeof ACCOUNT_COLUMNS)[number]
type AccountStashRow = Partial<Record<AccountColumn, unknown>>
type SignatureStashRow = { account_id: string; html: string; updated_at: number | bigint }

interface UpgradeStash {
  fromVersion: string
  toVersion: string
  stashedAt: number
  accounts: AccountStashRow[]
  signatures: SignatureStashRow[]
}

function shouldRunMigrations(): boolean {
  return app.isPackaged
}

function readVersionMarker(markerPath: string): string | null {
  if (!existsSync(markerPath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

function writeVersionMarker(markerPath: string, version: string): void {
  writeFileSync(
    markerPath,
    `${JSON.stringify({ version, updatedAt: Date.now() }, null, 2)}\n`,
    'utf8'
  )
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name?: string } | undefined
  return Boolean(row?.name)
}

function listExistingColumns(db: Database.Database, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>
  return rows.map((row) => row.name).filter((name): name is string => Boolean(name))
}

function extractStashFromExistingDb(
  dbPath: string,
  fromVersion: string,
  toVersion: string
): UpgradeStash {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })

  try {
    let accounts: AccountStashRow[] = []

    if (tableExists(db, 'accounts')) {
      const presentColumns = new Set(listExistingColumns(db, 'accounts'))
      const columnsToFetch = ACCOUNT_COLUMNS.filter((column) => presentColumns.has(column))

      if (columnsToFetch.length > 0) {
        accounts = db
          .prepare(`SELECT ${columnsToFetch.join(', ')} FROM accounts`)
          .all() as AccountStashRow[]
      }
    }

    const signatures = tableExists(db, 'account_signatures')
      ? (db
          .prepare(`SELECT account_id, html, updated_at FROM account_signatures`)
          .all() as SignatureStashRow[])
      : []

    return { fromVersion, toVersion, stashedAt: Date.now(), accounts, signatures }
  } finally {
    db.close()
  }
}

function wipeUserDataExceptStash(userDataPath: string, stashFileName: string): void {
  for (const fileName of [DB_FILE_NAME, ...DB_SIDECAR_FILE_NAMES]) {
    rmSync(join(userDataPath, fileName), { force: true })
  }

  for (const directoryName of ATTACHMENT_DIRECTORY_CANDIDATES) {
    rmSync(join(userDataPath, directoryName), { recursive: true, force: true })
  }

  // Defensive: stash file lives in userData; never delete it during a wipe.
  void stashFileName
}

/**
 * Detects an upgrade (or downgrade) versus the previously installed version recorded
 * in `userData/install-version.json`. When detected, extracts the saved login rows
 * (accounts + their signatures) into a stash JSON file and wipes the database and
 * any cached user data so the new app starts on a clean schema.
 *
 * Must run BEFORE the database is opened by `MailService`.
 */
export function prepareUpgradeMigration(): void {
  if (!shouldRunMigrations()) {
    return
  }

  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })

  const markerPath = join(userDataPath, VERSION_MARKER_FILE_NAME)
  const stashPath = join(userDataPath, UPGRADE_STASH_FILE_NAME)
  const dbPath = join(userDataPath, DB_FILE_NAME)
  const currentVersion = app.getVersion()
  const recordedVersion = readVersionMarker(markerPath)

  // Stash from a previous, interrupted migration takes precedence: never overwrite it.
  if (existsSync(stashPath)) {
    return
  }

  if (!existsSync(dbPath)) {
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  if (recordedVersion === currentVersion) {
    return
  }

  let stash: UpgradeStash
  try {
    stash = extractStashFromExistingDb(dbPath, recordedVersion ?? 'unknown', currentVersion)
  } catch (error) {
    console.error(
      '[upgrade-migration] Failed to read existing database; skipping wipe to avoid data loss.',
      error
    )
    return
  }

  writeFileSync(stashPath, `${JSON.stringify(stash, null, 2)}\n`, 'utf8')
  wipeUserDataExceptStash(userDataPath, UPGRADE_STASH_FILE_NAME)

  console.info(
    `[upgrade-migration] Wiped data on upgrade ${stash.fromVersion} -> ${stash.toVersion}; ` +
      `${stash.accounts.length} account(s) and ${stash.signatures.length} signature(s) stashed.`
  )
}

/**
 * If a stash exists from a prior `prepareUpgradeMigration()` run, re-inserts the
 * saved logins into the freshly-created database and removes the stash. Writes
 * the new install-version marker only once the restore succeeds, so a crash
 * mid-restore leaves the stash in place for a retry on next launch.
 *
 * Must run AFTER `MailService.start()` has created the schema.
 */
export function restoreUpgradeStashIfNeeded(): void {
  if (!shouldRunMigrations()) {
    return
  }

  const userDataPath = app.getPath('userData')
  const stashPath = join(userDataPath, UPGRADE_STASH_FILE_NAME)
  const markerPath = join(userDataPath, VERSION_MARKER_FILE_NAME)
  const dbPath = join(userDataPath, DB_FILE_NAME)
  const currentVersion = app.getVersion()

  if (!existsSync(stashPath)) {
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  if (!existsSync(dbPath)) {
    console.warn(
      '[upgrade-migration] Stash present but database missing; aborting restore until DB exists.'
    )
    return
  }

  let stash: UpgradeStash
  try {
    stash = JSON.parse(readFileSync(stashPath, 'utf8')) as UpgradeStash
  } catch (error) {
    console.error(
      '[upgrade-migration] Failed to parse stash file; removing it to unblock startup.',
      error
    )
    rmSync(stashPath, { force: true })
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  const db = new Database(dbPath)

  try {
    const accountInsert = db.prepare(
      `INSERT OR REPLACE INTO accounts(${ACCOUNT_COLUMNS.join(', ')}) ` +
        `VALUES (${ACCOUNT_COLUMNS.map(() => '?').join(', ')})`
    )
    const signatureInsert = db.prepare(
      'INSERT OR REPLACE INTO account_signatures(account_id, html, updated_at) VALUES (?, ?, ?)'
    )

    const restoreTransaction = db.transaction(() => {
      for (const account of stash.accounts) {
        accountInsert.run(...ACCOUNT_COLUMNS.map((column) => account[column] ?? null))
      }
      for (const signature of stash.signatures) {
        signatureInsert.run(signature.account_id, signature.html, signature.updated_at)
      }
    })

    restoreTransaction()
  } finally {
    db.close()
  }

  rmSync(stashPath, { force: true })
  writeVersionMarker(markerPath, currentVersion)

  console.info(
    `[upgrade-migration] Restored ${stash.accounts.length} account(s) and ` +
      `${stash.signatures.length} signature(s) after upgrade to ${currentVersion}.`
  )
}
