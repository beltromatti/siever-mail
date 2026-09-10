/**
 * Upgrade / downgrade data lifecycle.
 *
 * SIEVER Mail keeps two very different kinds of rows in the same SQLite
 * file, and they deserve opposite treatment when the app version changes:
 *
 *   • CACHE — `messages` and `folders`. Local mirrors of what lives on the
 *     IMAP server: every row can be rebuilt by a resync. Their shape moves
 *     between releases (new envelope fields, a new preview format, …), so
 *     carrying them across an upgrade risks half-populated or stale rows.
 *
 *   • USER DATA — everything else: accounts, signatures, app preferences,
 *     the contact history, and any table an extension owns (the SIEVER
 *     archive root and its practices, for instance). None of it exists
 *     anywhere else; losing it is unrecoverable for the user.
 *
 * Up to 1.7.1 the upgrade path deleted the whole database and restored
 * only `accounts` + `account_signatures` from a JSON stash. That silently
 * wiped the archive root, every manually-added practice, the unified-inbox
 * preferences and the contact history on *every single release* — the
 * exact symptom the customer reported ("i percorsi preferiti non si devono
 * cancellare quando si aggiorna il software").
 *
 * The flow is now:
 *
 *   1. `prepareUpgradeMigration()` — before the database is opened.
 *      Detects the version change and takes a consistent backup copy of
 *      the file (WAL checkpointed first, so the copy is self-contained).
 *      Nothing is deleted.
 *   2. `AppDatabase` reconciles the schema additively, as it already does.
 *   3. `finalizeUpgradeMigration()` — as soon as the schema is ready and
 *      *before* the IMAP engine starts writing. Purges only the cache
 *      tables and the attachment scratch directories, stamps the new
 *      version marker, drops the backup.
 *
 * If step 2 never completes (an unopenable or unreconcilable file, a crash
 * mid-startup), the pending marker is still on disk at the next launch and
 * `prepareUpgradeMigration()` takes the recovery path instead: the unusable
 * file is set aside, the app boots on a fresh schema, and every table the
 * backup and the new schema have in common — minus the cache tables — is
 * copied back row by row.
 *
 * That copy is deliberately table-agnostic: it walks `sqlite_master`
 * instead of a hardcoded list, so extension-owned tables survive without
 * the public host ever having to know their names.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { app } from 'electron'

const DB_FILE_NAME = 'siever-mail.sqlite'
const DB_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const VERSION_MARKER_FILE_NAME = 'install-version.json'
const PENDING_UPGRADE_FILE_NAME = '.upgrade-pending.json'
const BACKUP_FILE_NAME = '.upgrade-backup.sqlite'
const ATTACHMENT_DIRECTORY_CANDIDATES = ['attachments', 'cache', 'temp', 'mail-cache']

/**
 * Tables the app is allowed to throw away on a version change because the
 * IMAP server is their source of truth. Everything else in the file is
 * user data and is preserved as-is.
 */
const CACHE_TABLE_NAMES = ['messages', 'folders'] as const

/**
 * SQLite's own bookkeeping tables. They must never be copied during a
 * recovery — the fresh database maintains its own.
 */
const INTERNAL_TABLE_PREFIX = 'sqlite_'

type UpgradePhase = 'purge-cache' | 'recover-user-data'

/**
 * SQL surface the finalize step runs against. It is always the host's own
 * database connection: opening a second handle to the same file while
 * Prisma holds one would contend on the WAL and make `VACUUM` fail with
 * SQLITE_BUSY. `prepareUpgradeMigration()` has no such constraint — it runs
 * before the host opens anything — so it still uses a direct handle.
 */
export interface MigrationSqlExecutor {
  run(sql: string, params?: unknown[]): Promise<void>
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
}

interface PendingUpgradeRecord {
  fromVersion: string
  toVersion: string
  startedAt: number
  phase: UpgradePhase
}

/**
 * The migration only makes sense against a real install: in dev the
 * database lives in a throwaway userData directory and `app.getVersion()`
 * is the placeholder `0.0.0` from package.json, so a version change never
 * happens. `SIEVER_FORCE_DATA_MIGRATION=1` opts a dev run in so the flow
 * can be exercised end to end without producing a packaged build.
 */
function shouldRunMigrations(): boolean {
  return app.isPackaged || process.env['SIEVER_FORCE_DATA_MIGRATION'] === '1'
}

interface MigrationPaths {
  userDataPath: string
  dbPath: string
  backupPath: string
  markerPath: string
  pendingPath: string
}

function resolveMigrationPaths(): MigrationPaths {
  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })

  return {
    userDataPath,
    dbPath: join(userDataPath, DB_FILE_NAME),
    backupPath: join(userDataPath, BACKUP_FILE_NAME),
    markerPath: join(userDataPath, VERSION_MARKER_FILE_NAME),
    pendingPath: join(userDataPath, PENDING_UPGRADE_FILE_NAME)
  }
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

function readPendingUpgrade(pendingPath: string): PendingUpgradeRecord | null {
  if (!existsSync(pendingPath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(pendingPath, 'utf8')) as Partial<PendingUpgradeRecord>

    if (parsed.phase !== 'purge-cache' && parsed.phase !== 'recover-user-data') {
      return null
    }

    return {
      fromVersion: typeof parsed.fromVersion === 'string' ? parsed.fromVersion : 'unknown',
      toVersion: typeof parsed.toVersion === 'string' ? parsed.toVersion : 'unknown',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
      phase: parsed.phase
    }
  } catch {
    return null
  }
}

function writePendingUpgrade(pendingPath: string, record: PendingUpgradeRecord): void {
  writeFileSync(pendingPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

function removeDatabaseSidecars(dbPath: string): void {
  for (const suffix of DB_SIDECAR_SUFFIXES) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
}

/**
 * Copies the live database to `destinationPath`. The WAL is checkpointed
 * and truncated first so the single copied file carries every committed
 * page — without that step a crash-consistent copy would be missing
 * anything still sitting in the -wal sidecar.
 */
function backupDatabaseFile(dbPath: string, destinationPath: string): void {
  const db = new Database(dbPath)

  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }

  rmSync(destinationPath, { force: true })
  removeDatabaseSidecars(destinationPath)
  copyFileSync(dbPath, destinationPath)
}

function listRestorableTables(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
    name?: string
  }>

  return rows
    .map((row) => row.name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => !name.startsWith(INTERNAL_TABLE_PREFIX))
    .filter((name) => !CACHE_TABLE_NAMES.includes(name as (typeof CACHE_TABLE_NAMES)[number]))
}

function listColumns(db: Database.Database, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name?: string }>
  return rows.map((row) => row.name).filter((name): name is string => Boolean(name))
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Detects a version change and takes a backup so the upgrade can be
 * finished (or recovered from) after the schema is reconciled.
 *
 * Must run BEFORE the database is opened by `MailService`.
 */
export function prepareUpgradeMigration(): void {
  if (!shouldRunMigrations()) {
    return
  }

  const { dbPath, backupPath, markerPath, pendingPath } = resolveMigrationPaths()
  const currentVersion = app.getVersion()
  const pendingUpgrade = readPendingUpgrade(pendingPath)

  // A pending record still on disk means the previous launch never reached
  // `finalizeUpgradeMigration()`. The new schema could not be applied to the
  // old file (or the process died trying), so re-running the same path would
  // just fail again: set the file aside and boot on a fresh schema instead.
  // The backup taken before that attempt still holds every user-authored
  // row and is replayed by `finalizeUpgradeMigration()` once the new schema
  // exists.
  if (pendingUpgrade) {
    if (!existsSync(backupPath)) {
      // Nothing to recover from — clear the marker so a broken pending file
      // can never wedge startup, and let the app continue on whatever the
      // database currently holds.
      console.warn(
        '[data-migration] Pending upgrade found without a backup; clearing it and continuing.'
      )
      rmSync(pendingPath, { force: true })
      writeVersionMarker(markerPath, currentVersion)
      return
    }

    if (existsSync(dbPath)) {
      const setAsidePath = `${dbPath}.failed-${Date.now()}`
      renameSync(dbPath, setAsidePath)
      removeDatabaseSidecars(dbPath)
      console.warn(
        `[data-migration] Upgrade ${pendingUpgrade.fromVersion} -> ${pendingUpgrade.toVersion} ` +
          `did not complete; database set aside at ${setAsidePath}. ` +
          'Booting on a fresh schema and restoring user data from the backup.'
      )
    }

    writePendingUpgrade(pendingPath, { ...pendingUpgrade, phase: 'recover-user-data' })
    return
  }

  if (!existsSync(dbPath)) {
    // Fresh install (or a wiped profile): nothing to migrate.
    rmSync(backupPath, { force: true })
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  const recordedVersion = readVersionMarker(markerPath)

  if (recordedVersion === currentVersion) {
    return
  }

  try {
    backupDatabaseFile(dbPath, backupPath)
  } catch (error) {
    // A database we cannot even checkpoint is one we must not touch. Skip
    // the migration entirely rather than risk destroying the only copy of
    // the user's data; the app still boots and the schema reconciliation
    // gets its chance.
    console.error(
      '[data-migration] Could not back up the existing database; skipping migration.',
      error
    )
    return
  }

  writePendingUpgrade(pendingPath, {
    fromVersion: recordedVersion ?? 'unknown',
    toVersion: currentVersion,
    startedAt: Date.now(),
    phase: 'purge-cache'
  })

  console.info(
    `[data-migration] Upgrade ${recordedVersion ?? 'unknown'} -> ${currentVersion} detected; ` +
      'backup taken, user data will be preserved.'
  )
}

/**
 * Completes the migration started by `prepareUpgradeMigration()`.
 *
 * Must run AFTER the schema has been reconciled and BEFORE the mail engine
 * starts syncing, so purging the cache tables cannot race an incoming write.
 */
export async function finalizeUpgradeMigration(executor: MigrationSqlExecutor): Promise<void> {
  if (!shouldRunMigrations()) {
    return
  }

  const { userDataPath, dbPath, backupPath, markerPath, pendingPath } = resolveMigrationPaths()
  const currentVersion = app.getVersion()
  const pendingUpgrade = readPendingUpgrade(pendingPath)

  if (!pendingUpgrade) {
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  if (!existsSync(dbPath)) {
    console.warn(
      '[data-migration] Database missing at finalize; leaving the pending marker in place.'
    )
    return
  }

  try {
    if (pendingUpgrade.phase === 'recover-user-data') {
      await recoverUserDataFromBackup(executor, backupPath, pendingUpgrade)
    } else {
      await purgeCacheTables(executor, pendingUpgrade)
    }
  } catch (error) {
    console.error(
      '[data-migration] Finalize step failed; leaving the pending marker so the next launch retries.',
      error
    )
    return
  }

  purgeAttachmentScratchDirectories(userDataPath)

  rmSync(pendingPath, { force: true })
  rmSync(backupPath, { force: true })
  removeDatabaseSidecars(backupPath)
  writeVersionMarker(markerPath, currentVersion)
}

async function listExistingTables(executor: MigrationSqlExecutor): Promise<Set<string>> {
  const rows = await executor.all<{ name?: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`
  )

  return new Set(
    rows
      .map((row) => row.name)
      .filter((name): name is string => Boolean(name))
      .filter((name) => !name.startsWith(INTERNAL_TABLE_PREFIX))
  )
}

async function listTargetColumns(
  executor: MigrationSqlExecutor,
  tableName: string
): Promise<string[]> {
  const rows = await executor.all<{ name?: string }>(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`
  )
  return rows.map((row) => row.name).filter((name): name is string => Boolean(name))
}

/**
 * Drops the resyncable mirrors so the new build repopulates them in its own
 * shape. Everything else in the file — accounts, signatures, preferences,
 * contacts, extension-owned tables — is left untouched.
 */
async function purgeCacheTables(
  executor: MigrationSqlExecutor,
  pendingUpgrade: PendingUpgradeRecord
): Promise<void> {
  const existingTables = await listExistingTables(executor)

  for (const tableName of CACHE_TABLE_NAMES) {
    if (existingTables.has(tableName)) {
      await executor.run(`DELETE FROM ${quoteIdentifier(tableName)}`)
    }
  }

  await executor.run('PRAGMA wal_checkpoint(TRUNCATE)')
  await executor.run('VACUUM')

  console.info(
    `[data-migration] Upgrade ${pendingUpgrade.fromVersion} -> ${pendingUpgrade.toVersion} ` +
      'completed: message cache cleared, user data preserved.'
  )
}

/**
 * Replays every user-authored table from the pre-upgrade backup into the
 * freshly created database. Driven by `sqlite_master` rather than a fixed
 * list, so tables owned by an extension come across without the host
 * knowing anything about them; only columns present on both sides are
 * copied, which keeps the replay tolerant of additive schema changes.
 */
async function recoverUserDataFromBackup(
  executor: MigrationSqlExecutor,
  backupPath: string,
  pendingUpgrade: PendingUpgradeRecord
): Promise<void> {
  if (!existsSync(backupPath)) {
    console.warn('[data-migration] No backup to recover from; starting clean.')
    return
  }

  const targetTables = await listExistingTables(executor)
  const source = new Database(backupPath, { readonly: true, fileMustExist: true })
  const restoredTables: string[] = []
  let restoredRows = 0

  try {
    for (const tableName of listRestorableTables(source)) {
      if (!targetTables.has(tableName)) {
        continue
      }

      const targetColumns = new Set(await listTargetColumns(executor, tableName))
      const sharedColumns = listColumns(source, tableName).filter((column) =>
        targetColumns.has(column)
      )

      if (sharedColumns.length === 0) {
        continue
      }

      const quotedColumns = sharedColumns.map(quoteIdentifier).join(', ')
      const rows = source
        .prepare(`SELECT ${quotedColumns} FROM ${quoteIdentifier(tableName)}`)
        .all() as Array<Record<string, unknown>>

      if (rows.length === 0) {
        continue
      }

      const insertSql =
        `INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${quotedColumns}) ` +
        `VALUES (${sharedColumns.map(() => '?').join(', ')})`

      for (const row of rows) {
        await executor.run(
          insertSql,
          sharedColumns.map((column) => row[column] ?? null)
        )
      }

      restoredTables.push(`${tableName}(${rows.length})`)
      restoredRows += rows.length
    }
  } finally {
    source.close()
  }

  console.info(
    `[data-migration] Recovered ${restoredRows} user row(s) after the failed upgrade ` +
      `${pendingUpgrade.fromVersion} -> ${pendingUpgrade.toVersion}: ` +
      `${restoredTables.join(', ') || 'nothing to restore'}.`
  )
}

/**
 * Attachment scratch directories mirror message bodies we just dropped, so
 * they go with them. Nothing here is user-authored: every file is
 * re-downloadable from the server on demand.
 */
function purgeAttachmentScratchDirectories(userDataPath: string): void {
  for (const directoryName of ATTACHMENT_DIRECTORY_CANDIDATES) {
    rmSync(join(userDataPath, directoryName), { recursive: true, force: true })
  }
}
