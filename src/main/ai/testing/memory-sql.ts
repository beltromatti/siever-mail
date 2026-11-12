import { DatabaseSync } from 'node:sqlite'

import type { Sql } from '../sql'

/**
 * The stores' `Sql` over Node's own SQLite, in memory: the app runs the
 * same statements through Prisma, so a test exercises the real SQL.
 */
export function memorySql(): Sql & { close(): void } {
  const db = new DatabaseSync(':memory:')
  const bind = (params: unknown[]): Array<string | number | bigint | null> =>
    params.map((param) => {
      if (param === undefined || param === null) {
        return null
      }

      if (typeof param === 'boolean') {
        return param ? 1 : 0
      }

      return param as string | number | bigint
    })

  return {
    all: async <T>(sql: string, ...params: unknown[]) =>
      db.prepare(sql).all(...bind(params)) as T[],
    get: async <T>(sql: string, ...params: unknown[]) =>
      (db.prepare(sql).all(...bind(params))[0] as T | undefined) ?? null,
    run: async (sql: string, ...params: unknown[]) =>
      Number(db.prepare(sql).run(...bind(params)).changes),
    batch: async (statements) => {
      db.exec('BEGIN')

      try {
        const changed = statements.map((statement) =>
          Number(db.prepare(statement.sql).run(...bind(statement.params)).changes)
        )
        db.exec('COMMIT')
        return changed
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close: () => db.close()
  }
}
