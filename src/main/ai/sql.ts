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
 * read-then-write across awaits.
 */
export interface Sql {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>
  get<T>(sql: string, ...params: unknown[]): Promise<T | null>
  /** Runs a statement; resolves with how many rows it changed. */
  run(sql: string, ...params: unknown[]): Promise<number>
}

export function prismaSql(prisma: PrismaClient): Sql {
  return {
    all: async <T>(sql: string, ...params: unknown[]) =>
      prisma.$queryRawUnsafe<T[]>(sql, ...params),
    get: async <T>(sql: string, ...params: unknown[]) =>
      (await prisma.$queryRawUnsafe<T[]>(sql, ...params))[0] ?? null,
    run: (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params)
  }
}

/** The placeholders for a list in an `IN (…)`: `?, ?, ?`. */
export function placeholders(values: ReadonlyArray<unknown>): string {
  return values.map(() => '?').join(', ')
}
