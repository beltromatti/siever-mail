import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureAiSchema } from './schema'
import { memorySql } from './testing/memory-sql'

describe('ensureAiSchema', () => {
  let sql: ReturnType<typeof memorySql>

  beforeEach(() => {
    sql = memorySql()
  })

  afterEach(() => sql.close())

  it('makes the Segretario’s tables, and runs again changing nothing', async () => {
    await ensureAiSchema(sql)
    await sql.run(
      `INSERT INTO ai_items (id, account_id, thread_id, message_key, kind, text, due, status, created_at)
       VALUES (1, 'a', 't', 'k', 'da_fare', 'Fare', NULL, 'aperta', 1)`
    )
    await sql.run(
      `INSERT INTO ai_items (id, kind, text, status, created_at, created_by)
       VALUES (2, 'da_fare', 'Chiamare il commercialista', 'aperta', 1, 'utente')`
    )

    await ensureAiSchema(sql)

    expect(await sql.all('SELECT id, message_key, status FROM ai_items ORDER BY id')).toEqual([
      { id: 1, message_key: 'k', status: 'aperta' },
      { id: 2, message_key: null, status: 'aperta' }
    ])
    expect(
      await sql.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_saved_copies'"
      )
    ).toEqual([])
  })
})
