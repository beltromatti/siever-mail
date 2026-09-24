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
 *     the contact history, the recent files, and any table an extension
 *     owns. None of it exists anywhere else; losing it is unrecoverable for
 *     the user.
 *
 * The flow:
 *
 *   1. `prepareUpgradeMigration()` — before the database is opened.
 *      Detects the version change and copies every user table, schema and
 *      rows, into a small backup file. The cache is left out: it is the
 *      bulk of the file and is rebuilt anyway. Nothing is deleted.
 *   2. `AppDatabase` reconciles the schema additively, as it always does.
 *   3. `finalizeUpgradeMigration()` — once the schema is ready and before
 *      anything reads or syncs (the IPC layer waits for it). Purges the
 *      cache tables and the attachment scratch directories, stamps the new
 *      version marker, drops the backup.
 *
 * If step 3 never ran — a file the new schema could not be applied to, a
 * crash, the app quit mid-way — the pending record is still on disk at the
 * next launch, and `prepareUpgradeMigration()` takes the recovery path: the
 * file is set aside, the app boots on a fresh schema, and the finalize
 * step puts every user table back from the backup. A table the fresh
 * database does not have yet (an extension's, created only when the
 * extension installs, after this) is recreated as it was, and its owner
 * reconciles it like after any upgrade. The copy walks `sqlite_master`,
 * so extension tables come back without the host knowing their names.
 *
 * Nothing here may stop the app from starting: every failure is logged,
 * the recovery is attempted at most `MAX_RECOVERY_ATTEMPTS` times, and a
 * backup that could not be fully restored is kept on disk, never deleted.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { app } from 'electron'

const DB_FILE_NAME = 'siever-mail.sqlite'
const DB_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const
const VERSION_MARKER_FILE_NAME = 'install-version.json'
const PENDING_UPGRADE_FILE_NAME = '.upgrade-pending.json'
const BACKUP_FILE_NAME = '.upgrade-backup.sqlite'
const BACKUP_SCHEMA_NAME = 'upgrade_backup'
const ATTACHMENT_DIRECTORY_CANDIDATES = ['attachments', 'cache', 'temp', 'mail-cache']

/**
 * Tables the app is allowed to throw away on a version change because the
 * IMAP server is their source of truth. Everything else in the file is
 * user data and is preserved as-is.
 */
const CACHE_TABLE_NAMES: ReadonlySet<string> = new Set(['messages', 'folders'])

/**
 * SQLite's own bookkeeping tables. They must never be copied — every
 * database maintains its own.
 */
const INTERNAL_TABLE_PREFIX = 'sqlite_'

/**
 * Launches a recovery gets before it is given up. One retry covers a crash
 * or an app quit halfway; a recovery that fails twice would fail for ever,
 * and must not keep the app from starting.
 */
const MAX_RECOVERY_ATTEMPTS = 2

type UpgradePhase = 'purge-cache' | 'recover-user-data'

/**
 * SQL surface the finalize step runs against. It is always the host's own
 * database connection: opening a second handle to the same file while
 * Prisma holds one would contend on the WAL and make `VACUUM` fail with
 * SQLITE_BUSY. `prepareUpgradeMigration()` has no such constraint — it runs
 * before the host opens anything — so it uses a direct handle.
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
  /** Launches that have started the recovery so far. */
  attempts: number
  /** Databases the recovery set aside; removed once it has fully succeeded. */
  setAsidePaths: string[]
}

interface TableDefinition {
  name: string
  sql: string
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
      phase: parsed.phase,
      // Records written before attempts were counted: a recovery in flight
      // has had its one launch.
      attempts:
        typeof parsed.attempts === 'number'
          ? parsed.attempts
          : parsed.phase === 'recover-user-data'
            ? 1
            : 0,
      setAsidePaths: Array.isArray(parsed.setAsidePaths)
        ? parsed.setAsidePaths.filter((path): path is string => typeof path === 'string')
        : []
    }
  } catch {
    return null
  }
}

function writePendingUpgrade(pendingPath: string, record: PendingUpgradeRecord): void {
  writeFileSync(pendingPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/** Removes a database file together with its WAL and journal sidecars. */
function removeDatabaseFile(path: string): void {
  rmSync(path, { force: true })

  for (const suffix of DB_SIDECAR_SUFFIXES) {
    rmSync(`${path}${suffix}`, { force: true })
  }
}

/**
 * Renames a database file and its sidecars together: a WAL left behind
 * under the old name would hold committed pages of the file that moved,
 * and be replayed into whatever database is created there next.
 */
function moveDatabaseFile(fromPath: string, toPath: string): void {
  renameSync(fromPath, toPath)

  for (const suffix of DB_SIDECAR_SUFFIXES) {
    if (existsSync(`${fromPath}${suffix}`)) {
      renameSync(`${fromPath}${suffix}`, `${toPath}${suffix}`)
    }
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * The tables that hold user data, with the statement that created each.
 * Virtual tables and the shadow tables behind them are left out: they are
 * indexes over other tables, rebuilt by their owner.
 */
function listUserTables(db: Database.Database): TableDefinition[] {
  const rows = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY rowid`)
    .all() as Array<{ name?: string; sql?: string | null }>
  const tables = rows.filter(
    (row): row is TableDefinition => typeof row.name === 'string' && typeof row.sql === 'string'
  )
  const virtualTables = tables
    .filter((table) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql))
    .map((table) => table.name)

  return tables.filter(
    (table) =>
      !table.name.startsWith(INTERNAL_TABLE_PREFIX) &&
      !CACHE_TABLE_NAMES.has(table.name) &&
      !virtualTables.some(
        (virtualTable) => table.name === virtualTable || table.name.startsWith(`${virtualTable}_`)
      )
  )
}

function listColumns(db: Database.Database, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{
    name?: string
  }>
  return rows.map((row) => row.name).filter((name): name is string => Boolean(name))
}

/**
 * Copies every user table, definition and rows, into a new database file
 * at `backupPath`. The cache — most of the file — is left out, so taking
 * the backup costs little however large the mailbox.
 */
function backupUserTables(dbPath: string, backupPath: string): void {
  removeDatabaseFile(backupPath)

  const source = new Database(dbPath, { fileMustExist: true })

  try {
    const tables = listUserTables(source)
    const backup = new Database(backupPath)

    try {
      for (const table of tables) {
        backup.exec(table.sql)
      }
    } finally {
      backup.close()
    }

    source.exec(`ATTACH DATABASE ${quoteLiteral(backupPath)} AS ${BACKUP_SCHEMA_NAME}`)

    try {
      source.exec('BEGIN')

      try {
        for (const table of tables) {
          const columns = listColumns(source, table.name).map(quoteIdentifier).join(', ')
          source.exec(
            `INSERT INTO ${BACKUP_SCHEMA_NAME}.${quoteIdentifier(table.name)} (${columns}) ` +
              `SELECT ${columns} FROM main.${quoteIdentifier(table.name)}`
          )
        }

        source.exec('COMMIT')
      } catch (error) {
        source.exec('ROLLBACK')
        throw error
      }
    } finally {
      source.exec(`DETACH DATABASE ${BACKUP_SCHEMA_NAME}`)
    }
  } finally {
    source.close()
  }
}

/**
 * Detects a version change and takes the user-data backup, or — when the
 * previous upgrade never finished — sets the database aside for recovery.
 *
 * Must run BEFORE the database is opened by `MailService`. Never throws: a
 * migration that cannot even be prepared must not stop the app starting.
 */
export function prepareUpgradeMigration(): void {
  if (!shouldRunMigrations()) {
    return
  }

  try {
    prepare(resolveMigrationPaths(), app.getVersion())
  } catch (error) {
    console.error('[data-migration] Could not prepare the upgrade; starting without it.', error)
  }
}

function prepare(paths: MigrationPaths, currentVersion: string): void {
  const { dbPath, backupPath, markerPath, pendingPath } = paths
  const pendingUpgrade = readPendingUpgrade(pendingPath)

  if (pendingUpgrade) {
    prepareRecovery(paths, pendingUpgrade, currentVersion)
    return
  }

  if (!existsSync(dbPath)) {
    // Fresh install (or a wiped profile): nothing to migrate.
    removeDatabaseFile(backupPath)
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  const recordedVersion = readVersionMarker(markerPath)

  if (recordedVersion === currentVersion) {
    return
  }

  try {
    backupUserTables(dbPath, backupPath)
  } catch (error) {
    // A database we cannot read is one we must not touch. Skip the
    // migration rather than risk the only copy of the user's data; the
    // app still boots and the schema reconciliation gets its chance.
    removeDatabaseFile(backupPath)
    console.error('[data-migration] Could not back up the user data; skipping migration.', error)
    return
  }

  writePendingUpgrade(pendingPath, {
    fromVersion: recordedVersion ?? 'unknown',
    toVersion: currentVersion,
    startedAt: Date.now(),
    phase: 'purge-cache',
    attempts: 0,
    setAsidePaths: []
  })

  console.info(
    `[data-migration] Upgrade ${recordedVersion ?? 'unknown'} -> ${currentVersion} detected; ` +
      'user data backed up, it will be preserved.'
  )
}

/**
 * A pending record means the previous launch never reached the end of
 * `finalizeUpgradeMigration()`. Retrying the same path on the same file
 * could fail the same way, so the file is set aside and the app boots on a
 * fresh schema, into which the finalize step restores the backup.
 */
function prepareRecovery(
  paths: MigrationPaths,
  pendingUpgrade: PendingUpgradeRecord,
  currentVersion: string
): void {
  const { dbPath, backupPath, markerPath, pendingPath } = paths
  const upgrade = `${pendingUpgrade.fromVersion} -> ${pendingUpgrade.toVersion}`

  if (!existsSync(backupPath)) {
    // Nothing to recover from — clear the record so a broken pending file
    // can never wedge startup, and continue on whatever the database holds.
    console.warn(`[data-migration] Upgrade ${upgrade} left no backup; continuing without it.`)
    rmSync(pendingPath, { force: true })
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  if (
    pendingUpgrade.phase === 'recover-user-data' &&
    pendingUpgrade.attempts >= MAX_RECOVERY_ATTEMPTS
  ) {
    const keptPath = `${dbPath}.user-data-${Date.now()}`
    moveDatabaseFile(backupPath, keptPath)
    rmSync(pendingPath, { force: true })
    writeVersionMarker(markerPath, currentVersion)
    console.error(
      `[data-migration] Recovery after the upgrade ${upgrade} did not complete in ` +
        `${pendingUpgrade.attempts} launches; giving up. The user data is kept at ${keptPath}.`
    )
    return
  }

  const setAsidePath = existsSync(dbPath) ? `${dbPath}.failed-${Date.now()}` : null

  if (setAsidePath) {
    moveDatabaseFile(dbPath, setAsidePath)
  }

  try {
    writePendingUpgrade(pendingPath, {
      ...pendingUpgrade,
      phase: 'recover-user-data',
      attempts: pendingUpgrade.phase === 'recover-user-data' ? pendingUpgrade.attempts + 1 : 1,
      setAsidePaths: setAsidePath
        ? [...pendingUpgrade.setAsidePaths, setAsidePath]
        : pendingUpgrade.setAsidePaths
    })
  } catch (error) {
    // Without the record the next finalize would not know to restore: put
    // the database back and leave things as the last launch did.
    if (setAsidePath) {
      moveDatabaseFile(setAsidePath, dbPath)
    }

    throw error
  }

  if (setAsidePath) {
    console.warn(
      `[data-migration] Upgrade ${upgrade} did not complete; database set aside at ` +
        `${setAsidePath}. Booting on a fresh schema and restoring user data from the backup.`
    )
  }
}

/**
 * Completes the migration started by `prepareUpgradeMigration()`.
 *
 * Must run AFTER the schema has been reconciled and BEFORE the mail engine
 * starts syncing, so purging the cache tables cannot race an incoming write.
 * Never throws: a failure leaves the pending record for the next launch.
 */
export async function finalizeUpgradeMigration(executor: MigrationSqlExecutor): Promise<void> {
  if (!shouldRunMigrations()) {
    return
  }

  try {
    await finalize(resolveMigrationPaths(), app.getVersion(), executor)
  } catch (error) {
    console.error(
      '[data-migration] Finalize step failed; leaving the pending record so the next launch retries.',
      error
    )
  }
}

async function finalize(
  paths: MigrationPaths,
  currentVersion: string,
  executor: MigrationSqlExecutor
): Promise<void> {
  const { userDataPath, dbPath, backupPath, markerPath, pendingPath } = paths
  const pendingUpgrade = readPendingUpgrade(pendingPath)

  if (!pendingUpgrade) {
    writeVersionMarker(markerPath, currentVersion)
    return
  }

  if (!existsSync(dbPath)) {
    console.warn(
      '[data-migration] Database missing at finalize; leaving the pending record in place.'
    )
    return
  }

  if (pendingUpgrade.phase === 'recover-user-data') {
    const failedTables = await recoverUserDataFromBackup(executor, backupPath, pendingUpgrade)

    if (failedTables.length > 0) {
      // What could not be put back stays on disk, in the backup and in the
      // databases set aside, for whoever looks into it.
      const keptPath = `${dbPath}.user-data-${Date.now()}`
      moveDatabaseFile(backupPath, keptPath)
      console.error(
        `[data-migration] Could not restore ${failedTables.join(', ')}; ` +
          `the user data is kept at ${keptPath}.`
      )
    } else {
      pendingUpgrade.setAsidePaths.forEach(removeDatabaseFile)
    }
  } else {
    await purgeCacheTables(executor, pendingUpgrade)
  }

  purgeAttachmentScratchDirectories(userDataPath)

  rmSync(pendingPath, { force: true })
  removeDatabaseFile(backupPath)
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
 * Puts every table of the backup back into the fresh database. Tables the
 * new schema has get the columns both sides share, so additive schema
 * changes cost nothing; tables it does not have yet — an extension's,
 * created only when the extension installs — are recreated as they were.
 *
 * Each table succeeds or fails on its own, and foreign keys are off while
 * rows go in, since the tables arrive in whatever order they were created.
 * Returns the tables that could not be restored.
 */
async function recoverUserDataFromBackup(
  executor: MigrationSqlExecutor,
  backupPath: string,
  pendingUpgrade: PendingUpgradeRecord
): Promise<string[]> {
  const source = new Database(backupPath, { readonly: true, fileMustExist: true })
  const targetTables = await listExistingTables(executor)
  const [foreignKeys] = await executor.all<{ foreign_keys?: number }>('PRAGMA foreign_keys')
  const restoredTables: string[] = []
  const failedTables: string[] = []

  await executor.run('PRAGMA foreign_keys = OFF')

  try {
    for (const table of listUserTables(source)) {
      try {
        if (!targetTables.has(table.name)) {
          await executor.run(table.sql)
        }

        const targetColumns = new Set(await listTargetColumns(executor, table.name))
        const sharedColumns = listColumns(source, table.name).filter((column) =>
          targetColumns.has(column)
        )

        if (sharedColumns.length === 0) {
          continue
        }

        const quotedColumns = sharedColumns.map(quoteIdentifier).join(', ')
        const rows = source
          .prepare(`SELECT ${quotedColumns} FROM ${quoteIdentifier(table.name)}`)
          .all() as Array<Record<string, unknown>>
        const insertSql =
          `INSERT OR REPLACE INTO ${quoteIdentifier(table.name)} (${quotedColumns}) ` +
          `VALUES (${sharedColumns.map(() => '?').join(', ')})`

        for (const row of rows) {
          await executor.run(
            insertSql,
            sharedColumns.map((column) => row[column] ?? null)
          )
        }

        restoredTables.push(`${table.name}(${rows.length})`)
      } catch (error) {
        failedTables.push(table.name)
        console.error(`[data-migration] Could not restore table ${table.name}.`, error)
      }
    }
  } finally {
    source.close()
    await executor.run(`PRAGMA foreign_keys = ${foreignKeys?.foreign_keys ? 'ON' : 'OFF'}`)
  }

  console.info(
    `[data-migration] Restored after the failed upgrade ` +
      `${pendingUpgrade.fromVersion} -> ${pendingUpgrade.toVersion}: ` +
      `${restoredTables.join(', ') || 'nothing to restore'}.`
  )

  return failedTables
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
