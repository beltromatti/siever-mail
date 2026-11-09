import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureAiSchema } from './schema'
import { memorySql } from './testing/memory-sql'

/** The tables of the 1.x builds that the registry replaces, as they stood. */
const V1_TABLES = [
  `CREATE TABLE ai_topics (
    id TEXT PRIMARY KEY, external_key TEXT UNIQUE, title TEXT NOT NULL, description TEXT,
    folder_path TEXT, aliases TEXT, rank INTEGER, active_at INTEGER, gist TEXT,
    gist_conversations INTEGER, origin TEXT NOT NULL, state TEXT, state_at INTEGER,
    archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE ai_topic_threads (
    account_id TEXT NOT NULL, thread_id TEXT NOT NULL, topic_id TEXT NOT NULL,
    linked_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (account_id, thread_id)
  )`
]

/** The open things as version 4 kept them: a message required, no event. */
const V4_ITEMS = `CREATE TABLE ai_items (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  due TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  closed_by TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER,
  until TEXT,
  reason TEXT,
  evidence_key TEXT,
  created_by TEXT NOT NULL DEFAULT 'segretario',
  run_id TEXT,
  question TEXT
)`

describe('ensureAiSchema', () => {
  let sql: ReturnType<typeof memorySql>

  beforeEach(() => {
    sql = memorySql()
  })

  afterEach(() => sql.close())

  it('brings a 1.x database to the registry, keeping what it held', async () => {
    // A database at version 1: the tables there are, the 1.x ones and their data.
    await ensureAiSchema(sql)
    await sql.run("UPDATE ai_meta SET value = '1' WHERE key = 'schema_version'")

    for (const statement of V1_TABLES) {
      await sql.run(statement)
    }

    await sql.run(
      `INSERT INTO ai_topics VALUES
        ('t1', 'cliente:1', 'Casa al mare', NULL, '/archivio/Casa al mare', NULL, 1, 5, 'La ristrutturazione', 1, 'extension', 'A buon punto', 9, NULL, 1, 2),
        ('t2', 'cliente:2', 'Mai vista', NULL, '/archivio/Mai vista', NULL, 2, NULL, NULL, NULL, 'extension', NULL, NULL, NULL, 1, 1),
        ('t3', NULL, 'Partita del giovedì', NULL, NULL, NULL, NULL, 5, NULL, NULL, 'utente', NULL, NULL, NULL, 1, 1)`
    )
    await sql.run(
      `INSERT INTO ai_topic_threads VALUES ('a', 'th1', 't1', 'segretario', 1), ('a', 'th2', 't3', 'utente', 1)`
    )
    await sql.run(
      `INSERT INTO ai_items (id, account_id, thread_id, message_key, kind, text, due, status, created_at, closed_at, closed_by)
       VALUES (1, 'a', 'th1', 'k1', 'ti_chiedono', 'Mandare il computo', NULL, 'aperto', 1, NULL, NULL),
              (2, 'a', 'th1', 'k1', 'hai_promesso', 'Chiamare Rossi', NULL, 'chiuso', 1, 3, 'utente')`
    )
    await sql.run(
      `INSERT INTO ai_activities (id, kind, title, status, created_at, updated_at)
       VALUES ('x1', 'aggiornamento', 'Al passo', 'done', 1, 1), ('x2', 'conoscerti', 'Conoscimi', 'done', 1, 1)`
    )
    await ensureAiSchema(sql)

    expect(
      await sql.all('SELECT id, title, title_by, description, state FROM ai_projects ORDER BY id')
    ).toEqual([
      {
        id: 't1',
        title: 'Casa al mare',
        title_by: 'segretario',
        description: 'La ristrutturazione',
        state: 'A buon punto'
      },
      { id: 't3', title: 'Partita del giovedì', title_by: 'utente', description: null, state: null }
    ])
    expect(
      await sql.all(
        'SELECT project_id, thread_id, linked_by FROM ai_project_threads ORDER BY project_id'
      )
    ).toEqual([
      { project_id: 't1', thread_id: 'th1', linked_by: 'segretario' },
      { project_id: 't3', thread_id: 'th2', linked_by: 'utente' }
    ])
    expect(await sql.all('SELECT project_id, kind, location FROM ai_project_resources')).toEqual([
      { project_id: 't1', kind: 'cartella', location: '/archivio/Casa al mare' }
    ])
    expect(await sql.all('SELECT id, status FROM ai_items ORDER BY id')).toEqual([
      { id: 1, status: 'aperta' },
      { id: 2, status: 'fatta' }
    ])
    expect(await sql.all('SELECT id, task, visibility FROM ai_activities ORDER BY id')).toEqual([
      { id: 'x1', task: 'al_passo', visibility: 'diario' },
      { id: 'x2', task: 'conoscimi', visibility: 'pannello' }
    ])
    expect(
      await sql.get(
        "SELECT name FROM sqlite_master WHERE name IN ('ai_topics', 'ai_topic_threads')"
      )
    ).toBeNull()
    expect(await sql.get("SELECT value FROM ai_meta WHERE key = 'schema_version'")).toEqual({
      value: '8'
    })
  })

  it('gives a version 3 database the links of the words that stay', async () => {
    await ensureAiSchema(sql)
    await sql.run('ALTER TABLE ai_briefings DROP COLUMN links_json')
    await sql.run('ALTER TABLE ai_event_preps DROP COLUMN links_json')
    await sql.run('ALTER TABLE ai_projects DROP COLUMN state_links_json')
    await sql.run("UPDATE ai_meta SET value = '3' WHERE key = 'schema_version'")
    await sql.run(
      `INSERT INTO ai_briefings (day, text, basis, created_at) VALUES ('2026-11-05', 'La giornata', '[]', 1)`
    )

    await ensureAiSchema(sql)

    expect(await sql.all('SELECT day, links_json FROM ai_briefings')).toEqual([
      { day: '2026-11-05', links_json: '[]' }
    ])
    expect(
      await sql.all(
        "SELECT name FROM pragma_table_info('ai_projects') WHERE name = 'state_links_json'"
      )
    ).toEqual([{ name: 'state_links_json' }])
  })

  it('lets a version 4 database keep open things from any source, keeping those it held', async () => {
    await ensureAiSchema(sql)
    await sql.run('DROP TABLE ai_items')
    await sql.run(V4_ITEMS)
    await sql.run(
      `INSERT INTO ai_items (id, account_id, thread_id, message_key, kind, text, status, created_at, revision, created_by)
       VALUES (7, 'a', 'th1', 'm:1', 'da_fare', 'Mandare il computo', 'aperta', 1, 3, 'segretario')`
    )
    await sql.run("UPDATE ai_meta SET value = '4' WHERE key = 'schema_version'")

    await ensureAiSchema(sql)

    expect(
      await sql.all('SELECT id, account_id, message_key, event_key, revision FROM ai_items')
    ).toEqual([{ id: 7, account_id: 'a', message_key: 'm:1', event_key: null, revision: 3 }])
    await sql.run(
      `INSERT INTO ai_items (event_key, kind, text, status, created_at) VALUES ('g:e1', 'da_fare', 'Portare la planimetria', 'aperta', 2)`
    )
    await sql.run(
      `INSERT INTO ai_items (kind, text, status, created_at) VALUES ('da_fare', 'Chiamare il geometra', 'aperta', 3)`
    )
    expect(
      await sql.all("SELECT name FROM sqlite_master WHERE name = 'idx_ai_items_event'")
    ).toEqual([{ name: 'idx_ai_items_event' }])
  })

  it('picks up the rebuilding of the open things where a quit cut it short', async () => {
    await ensureAiSchema(sql)
    // Cut short after the rows were copied and the old table dropped, before the new one was renamed.
    await sql.run('ALTER TABLE ai_items RENAME TO ai_items_v5')
    await sql.run(
      `INSERT INTO ai_items_v5 (id, account_id, thread_id, message_key, kind, text, status, created_at)
       VALUES (7, 'a', 'th1', 'm:1', 'da_fare', 'Mandare il computo', 'aperta', 1)`
    )
    await sql.run("UPDATE ai_meta SET value = '4' WHERE key = 'schema_version'")

    await ensureAiSchema(sql)

    expect(await sql.all('SELECT id, text FROM ai_items')).toEqual([
      { id: 7, text: 'Mandare il computo' }
    ])
    expect(await sql.all("SELECT name FROM sqlite_master WHERE name = 'ai_items_v5'")).toEqual([])
  })

  it('gives the open things their event index after a quit just past the rebuild', async () => {
    await ensureAiSchema(sql)
    // Cut short after the new table was renamed, before its indexes were made.
    await sql.run('DROP INDEX idx_ai_items_event')
    await sql.run("UPDATE ai_meta SET value = '4' WHERE key = 'schema_version'")

    await ensureAiSchema(sql)

    expect(
      await sql.all("SELECT name FROM sqlite_master WHERE name = 'idx_ai_items_event'")
    ).toEqual([{ name: 'idx_ai_items_event' }])
  })

  it('picks up a migration a quit cut short between two steps', async () => {
    await ensureAiSchema(sql)
    await sql.run("UPDATE ai_meta SET value = '1' WHERE key = 'schema_version'")
    await sql.run(V1_TABLES[0])
    await sql.run(
      `INSERT INTO ai_topics VALUES
        ('t1', 'cliente:1', 'Casa al mare', NULL, NULL, NULL, 1, 5, 'La ristrutturazione', 1, 'extension', NULL, NULL, NULL, 1, 2),
        ('t2', 'cliente:2', 'Mai vista', NULL, NULL, NULL, 2, NULL, NULL, NULL, 'extension', NULL, NULL, NULL, 1, 1)`
    )
    // Cut short after the links were copied and their table dropped, before the topics were.
    await sql.run(
      `INSERT INTO ai_projects (id, title, title_by, origin, revision, created_at, updated_at)
       VALUES ('t1', 'Casa al mare', 'segretario', 'segretario', 1, 1, 2)`
    )
    await sql.run(
      `INSERT INTO ai_project_threads (project_id, account_id, thread_id, linked_by, rejected, created_at)
       VALUES ('t1', 'a', 'th1', 'segretario', 0, 1)`
    )

    await ensureAiSchema(sql)

    expect(await sql.all("SELECT name FROM sqlite_master WHERE name = 'ai_topics'")).toEqual([])
    expect(await sql.all('SELECT id FROM ai_projects ORDER BY id')).toEqual([{ id: 't1' }])
  })

  it('gives a version 2 database the columns of version 3', async () => {
    // A database at version 2, as the registry first wrote it: without the two columns.
    await ensureAiSchema(sql)
    await sql.run('ALTER TABLE ai_projects DROP COLUMN closed_by')
    await sql.run('ALTER TABLE ai_proposals DROP COLUMN revision')
    await sql.run("UPDATE ai_meta SET value = '2' WHERE key = 'schema_version'")
    await sql.run(
      `INSERT INTO ai_proposals (id, kind, title, payload_json, status, created_at)
       VALUES ('p1', 'archivia', 'Archivia', '{}', 'aperta', 1)`
    )

    await ensureAiSchema(sql)

    expect(
      await sql.all("SELECT name FROM pragma_table_info('ai_projects') WHERE name = 'closed_by'")
    ).toEqual([{ name: 'closed_by' }])
    expect(await sql.all('SELECT id, revision FROM ai_proposals')).toEqual([
      { id: 'p1', revision: 1 }
    ])
    expect(await sql.get("SELECT value FROM ai_meta WHERE key = 'schema_version'")).toEqual({
      value: '8'
    })
  })

  it('gives a version 5 database how far each connection is read, and the project of the user’s word', async () => {
    await ensureAiSchema(sql)
    await sql.run('DROP INDEX idx_ai_items_project')
    await sql.run('ALTER TABLE ai_items DROP COLUMN project_id')
    await sql.run('DROP TABLE ai_reading')
    await sql.run(
      `INSERT INTO ai_items (id, kind, text, status, created_at) VALUES (3, 'da_fare', 'Chiamare il geometra', 'aperta', 1)`
    )
    await sql.run("UPDATE ai_meta SET value = '5' WHERE key = 'schema_version'")

    await ensureAiSchema(sql)

    expect(await sql.all('SELECT id, project_id FROM ai_items')).toEqual([
      { id: 3, project_id: null }
    ])
    await sql.run(
      `INSERT INTO ai_reading (connection_key, days, reason, set_by, set_at) VALUES ('a', 90, 'questioni lunghe', 'segretario', 1)`
    )
    expect(
      await sql.all("SELECT name FROM sqlite_master WHERE name = 'idx_ai_items_project'")
    ).toEqual([{ name: 'idx_ai_items_project' }])
    expect(await sql.get("SELECT value FROM ai_meta WHERE key = 'schema_version'")).toEqual({
      value: '8'
    })
  })

  it('lets a version 6 database go of the copies, which the mail keeps as marks', async () => {
    await ensureAiSchema(sql)
    await sql.run("UPDATE ai_meta SET value = '6' WHERE key = 'schema_version'")
    await sql.run(
      `CREATE TABLE ai_saved_copies (
        account_id TEXT NOT NULL, message_key TEXT NOT NULL, thread_id TEXT NOT NULL,
        source TEXT NOT NULL, destination TEXT NOT NULL, files_json TEXT NOT NULL,
        from_address TEXT, saved_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, message_key, destination)
      )`
    )

    await ensureAiSchema(sql)

    expect(
      await sql.get("SELECT name FROM sqlite_master WHERE name = 'ai_saved_copies'")
    ).toBeNull()
    expect(await sql.get("SELECT value FROM ai_meta WHERE key = 'schema_version'")).toEqual({
      value: '8'
    })
  })

  it('gives a version 7 database the notes that say whether to tell the user now', async () => {
    await ensureAiSchema(sql)
    await sql.run("UPDATE ai_meta SET value = '7' WHERE key = 'schema_version'")
    await sql.run('ALTER TABLE ai_notes DROP COLUMN notify')

    await ensureAiSchema(sql)

    const columns = await sql.all<{ name: string }>('PRAGMA table_info(ai_notes)')
    expect(columns.map((column) => column.name)).toContain('notify')
    expect(await sql.get("SELECT value FROM ai_meta WHERE key = 'schema_version'")).toEqual({
      value: '8'
    })
  })

  it('runs again on a database already brought up, changing nothing', async () => {
    await ensureAiSchema(sql)
    await sql.run(
      `INSERT INTO ai_items (id, account_id, thread_id, message_key, kind, text, due, status, created_at)
       VALUES (1, 'a', 't', 'k', 'da_fare', 'Fare', NULL, 'aperta', 1)`
    )

    await ensureAiSchema(sql)

    expect(await sql.all('SELECT id, status, revision FROM ai_items')).toEqual([
      { id: 1, status: 'aperta', revision: 1 }
    ])
  })
})
