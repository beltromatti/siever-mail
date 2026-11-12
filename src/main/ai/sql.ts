import type { PrismaClient } from '@prisma/client'

/**
 * The few things the Segretario's stores ask of the database: run a
 * statement, read rows. The app hands them the Prisma client's raw
 * queries; the tests hand them Node's own SQLite, so what is tested is the
 * very SQL the app runs.
 *
 * There is one connection, and statements from different callers may
 * interleave between two awaits: what must hold together is written as a
 * single statement — `UPDATE … WHERE revision = ?` — never as a
 * read-then-write across awaits; what spans several tables, as one
 * transaction (`batch`).
 */
export interface Sql {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>
  get<T>(sql: string, ...params: unknown[]): Promise<T | null>
  /** Runs a statement; resolves with how many rows it changed. */
  run(sql: string, ...params: unknown[]): Promise<number>
  /** Runs statements as one transaction — all of them or none —; resolves with how many rows each changed. */
  batch(statements: ReadonlyArray<SqlStatement>): Promise<number[]>
}

/** A statement and its parameters, for `Sql.batch`. */
export interface SqlStatement {
  sql: string
  params: unknown[]
}

export function prismaSql(prisma: PrismaClient): Sql {
  return {
    all: async <T>(sql: string, ...params: unknown[]) =>
      prisma.$queryRawUnsafe<T[]>(sql, ...params),
    get: async <T>(sql: string, ...params: unknown[]) =>
      (await prisma.$queryRawUnsafe<T[]>(sql, ...params))[0] ?? null,
    run: (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params),
    batch: async (statements) =>
      statements.length === 0
        ? []
        : prisma.$transaction(
            statements.map((statement) =>
              prisma.$executeRawUnsafe(statement.sql, ...statement.params)
            )
          )
  }
}

/** The placeholders for a list in an `IN (…)`: `?, ?, ?`. */
export function placeholders(values: ReadonlyArray<unknown>): string {
  return values.map(() => '?').join(', ')
}
