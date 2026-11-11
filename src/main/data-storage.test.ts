import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureAiSchema } from './ai/schema'
import { memorySql } from './ai/testing/memory-sql'
import { measureDatabase, storageSections, type StorageOwners } from './data-storage'

const OWNERS: StorageOwners = {
  mail: [
    { id: 'lavoro', label: 'lucia@studio.example' },
    { id: 'casa', label: 'lucia@casa.example' }
  ],
  calendars: [{ id: 'cal', label: 'lucia' }],
  extension: { label: 'Acme S.r.l.', tablePrefix: 'acme_srl_' }
}

describe('what SIEVER Mail keeps, by whose it is', () => {
  let sql: ReturnType<typeof memorySql>

  beforeEach(async () => {
    sql = memorySql()
    await sql.run(
      'CREATE TABLE message_bodies (id INTEGER PRIMARY KEY, account_id TEXT, message_key TEXT, body TEXT, html TEXT)'
    )
    await sql.run('CREATE TABLE contacts (email TEXT)')
    await sql.run(
      'CREATE TABLE calendar_events (key TEXT PRIMARY KEY, connection_id TEXT, title TEXT)'
    )
    await sql.run('CREATE TABLE acme_srl_practices (id INTEGER PRIMARY KEY, name TEXT)')
    await ensureAiSchema(sql)
  })

  afterEach(() => sql.close())

  const bodies = async (accountId: string, count: number, size: number): Promise<void> => {
    for (let index = 0; index < count; index += 1) {
      await sql.run(
        'INSERT INTO message_bodies (account_id, message_key, body, html) VALUES (?, ?, ?, ?)',
        accountId,
        `m${index}`,
        'x'.repeat(size),
        ''
      )
    }
  }

  it('shares a table out by its rows: a mailbox, its Segretario, a calendar, the extension, the rest', async () => {
    await bodies('lavoro', 30, 3000)
    await bodies('casa', 10, 3000)
    await sql.run("INSERT INTO contacts VALUES ('anna@brenta.example')")
    await sql.run(
      "INSERT INTO calendar_events VALUES ('cal' || char(0) || 'e1', 'cal', 'Riunione')"
    )
    await sql.run("INSERT INTO acme_srl_practices (name) VALUES ('Prat 1')")
    await sql.run(
      `INSERT INTO ai_notes (account_id, message_key, thread_id, direction, summary, state, priority,
         reason, message_date, created_at, written_by)
       VALUES ('lavoro', 'm1', 't', 'in', 'Una nota', 'informativo', 'bassa', '', '2026-11-11', 1, 'segretario')`
    )
    await sql.run(
      "INSERT INTO ai_memory (path, content, created_at, updated_at, read_at) VALUES ('tu.md', 'Lucia', 1, 1, 1)"
    )

    const shares = await measureDatabase(sql, OWNERS)
    const sections = storageSections(shares, OWNERS, {
      attachments: 2048,
      draftFiles: 0,
      diagnostics: 1024
    })
    const of = (id: string): (typeof sections)[number] =>
      sections.find((section) => section.id === id) as (typeof sections)[number]

    // The bodies of the work mailbox weigh three times the home one's.
    expect(of('mail:lavoro').sizeBytes - of('mail:lavoro').segretarioBytes).toBeGreaterThan(
      2.5 * (of('mail:casa').sizeBytes - of('mail:casa').segretarioBytes)
    )
    expect(of('mail:lavoro').segretarioBytes).toBeGreaterThan(0)
    expect(of('mail:casa').segretarioBytes).toBe(0)
    expect(of('calendar:cal').sizeBytes).toBeGreaterThan(0)
    expect(of('segretario').sizeBytes).toBeGreaterThan(0)
    expect(of('extension').sizeBytes).toBeGreaterThan(0)
    expect(of('common').sizeBytes).toBeGreaterThan(0)
    expect(of('attachments').sizeBytes).toBe(2048)
  })

  it('gives nothing to the Segretario once it has forgotten everything: empty tables are the app’s', async () => {
    const sections = storageSections(await measureDatabase(sql, OWNERS), OWNERS, {
      attachments: 0,
      draftFiles: 0,
      diagnostics: 0
    })

    expect(sections.find((section) => section.id === 'segretario')?.sizeBytes).toBe(0)
    expect(sections.every((section) => section.segretarioBytes === 0)).toBe(true)
  })

  it('measures a table it cannot share out whole, with its default owner', async () => {
    await bodies('lavoro', 5, 3000)
    // A body table without the columns its split reads: it stays the app's, and the rest is told.
    await sql.run('ALTER TABLE message_bodies RENAME COLUMN html TO markup')

    const shares = await measureDatabase(sql, OWNERS)

    expect(shares.get('common')).toBeGreaterThan(5 * 3000)
    expect(shares.get('mail:lavoro') ?? 0).toBe(0)
  })
})
