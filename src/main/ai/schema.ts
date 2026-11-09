import type { Sql } from './sql'

/**
 * The Segretario's tables, and how a database written by an earlier build
 * becomes one this build reads. User data: kept across updates, emptied by
 * "Elimina tutti i dati" (see `AiStore.clearData`).
 *
 * The schema has a version in `ai_meta`. A new install runs every step in
 * order, as an old one runs the steps it has not had: one path, so what a
 * fresh database looks like is what an upgraded one looks like.
 */
const SCHEMA_VERSION = 8

/** The tables of the first 2.0 builds, as they stood (version 1). */
/** The open things' indexes: by conversation, by state, and — from version 5 — by event. */
const ITEM_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_ai_items_thread ON ai_items(account_id, thread_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_items_status ON ai_items(status, due)',
  'CREATE INDEX IF NOT EXISTS idx_ai_items_event ON ai_items(event_key) WHERE event_key IS NOT NULL'
] as const

const BASELINE: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY,
    encrypted_api_key TEXT,
    key_status_json TEXT NOT NULL DEFAULT '{}',
    preferences_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL,
    activity_id TEXT,
    purpose TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    prompt_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    cost REAL NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at)',
  `CREATE TABLE IF NOT EXISTS ai_activities (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    unseen INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_activities_updated ON ai_activities(updated_at)',
  `CREATE TABLE IF NOT EXISTS ai_events (
    id INTEGER PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES ai_activities(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_events_activity ON ai_events(activity_id, id)',
  `CREATE TABLE IF NOT EXISTS ai_memory (
    path TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    read_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_learning (
    account_id TEXT PRIMARY KEY,
    activity_id TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS ai_lessons (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    reflection_id TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_lessons_reflection ON ai_lessons(reflection_id)',
  `CREATE TABLE IF NOT EXISTS ai_notes (
    account_id TEXT NOT NULL,
    message_key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    summary TEXT NOT NULL,
    state TEXT NOT NULL,
    priority TEXT NOT NULL,
    reason TEXT NOT NULL,
    due TEXT,
    message_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    dismissed_at INTEGER,
    twin_account_id TEXT,
    PRIMARY KEY (account_id, message_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_notes_thread ON ai_notes(account_id, thread_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_notes_state ON ai_notes(state, message_date)',
  `CREATE TABLE IF NOT EXISTS ai_items (
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
    closed_by TEXT
  )`,
  // The event's index comes with the column, in version 5.
  ...ITEM_INDEXES.slice(0, 2),
  `CREATE TABLE IF NOT EXISTS ai_saved_searches (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    summary TEXT NOT NULL,
    how TEXT NOT NULL,
    search_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_briefings (
    day TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    basis TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_ready_drafts (
    account_id TEXT NOT NULL,
    message_key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'risposta',
    text TEXT NOT NULL,
    doubts TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, message_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_ready_drafts_status ON ai_ready_drafts(status)',
  `CREATE TABLE IF NOT EXISTS ai_drafts (
    draft_id TEXT PRIMARY KEY,
    activity_id TEXT,
    account_id TEXT NOT NULL,
    text TEXT NOT NULL,
    snapshot TEXT,
    created_at INTEGER NOT NULL
  )`
]

/**
 * Version 2, the registry: what is open has a life (done, not needed,
 * deferred, reopened) and a history; every object a revision, so two of
 * the Segretario's runs never overwrite each other; projects in place of
 * topics, a conversation in more than one; replies prepared that can go
 * stale; proposals; copies saved outside the mail; the work queue; the
 * memory's versions.
 */
const REGISTRY: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS ai_item_history (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    run_id TEXT,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    reason TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_item_history_item ON ai_item_history(item_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_item_history_run ON ai_item_history(run_id)',
  `CREATE TABLE IF NOT EXISTS ai_projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    title_by TEXT NOT NULL,
    description TEXT,
    state TEXT,
    state_at INTEGER,
    stale_since INTEGER,
    origin TEXT NOT NULL,
    hidden_at INTEGER,
    closed_at INTEGER,
    closed_by TEXT,
    active_at INTEGER,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_project_threads (
    project_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    rejected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, account_id, thread_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_project_threads_thread ON ai_project_threads(account_id, thread_id)',
  `CREATE TABLE IF NOT EXISTS ai_project_resources (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    location TEXT NOT NULL,
    label TEXT,
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (project_id, location)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_proposals (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    account_id TEXT,
    message_key TEXT,
    thread_id TEXT,
    title TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    run_id TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    result_json TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_proposals_status ON ai_proposals(status, kind)',
  'CREATE INDEX IF NOT EXISTS idx_ai_proposals_message ON ai_proposals(account_id, message_key)',
  `CREATE TABLE IF NOT EXISTS ai_saved_copies (
    account_id TEXT NOT NULL,
    message_key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    source TEXT NOT NULL,
    destination TEXT NOT NULL,
    files_json TEXT NOT NULL,
    from_address TEXT,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, message_key, destination)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_saved_copies_thread ON ai_saved_copies(account_id, thread_id)',
  `CREATE TABLE IF NOT EXISTS ai_work (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    not_before INTEGER NOT NULL,
    activity_id TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_work_status ON ai_work(status, priority, not_before)',
  // One unit waiting per scope: what comes for it while it waits joins it.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_work_waiting ON ai_work(scope_key)
    WHERE status IN ('in_coda', 'da_riprovare')`,
  `CREATE TABLE IF NOT EXISTS ai_gone (
    account_id TEXT NOT NULL,
    message_key TEXT NOT NULL,
    since INTEGER NOT NULL,
    PRIMARY KEY (account_id, message_key)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_memory_history (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    revision INTEGER NOT NULL,
    content TEXT,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    run_id TEXT,
    at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_memory_history_path ON ai_memory_history(path, id)',
  `CREATE TABLE IF NOT EXISTS ai_event_preps (
    event_key TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    run_id TEXT,
    written_at INTEGER NOT NULL
  )`
]

const ADDED_COLUMNS: ReadonlyArray<{ table: string; column: string; definition: string }> = [
  { table: 'ai_drafts', column: 'snapshot', definition: 'TEXT' },
  { table: 'ai_activities', column: 'task', definition: 'TEXT' },
  { table: 'ai_activities', column: 'visibility', definition: "TEXT NOT NULL DEFAULT 'pannello'" },
  { table: 'ai_activities', column: 'work_id', definition: 'TEXT' },
  { table: 'ai_activities', column: 'scope_json', definition: 'TEXT' },
  { table: 'ai_notes', column: 'revision', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'ai_notes', column: 'run_id', definition: 'TEXT' },
  { table: 'ai_notes', column: 'updated_at', definition: 'INTEGER' },
  { table: 'ai_notes', column: 'written_by', definition: "TEXT NOT NULL DEFAULT 'segretario'" },
  { table: 'ai_items', column: 'revision', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'ai_items', column: 'updated_at', definition: 'INTEGER' },
  { table: 'ai_items', column: 'until', definition: 'TEXT' },
  { table: 'ai_items', column: 'reason', definition: 'TEXT' },
  { table: 'ai_items', column: 'evidence_key', definition: 'TEXT' },
  { table: 'ai_items', column: 'created_by', definition: "TEXT NOT NULL DEFAULT 'segretario'" },
  { table: 'ai_items', column: 'run_id', definition: 'TEXT' },
  { table: 'ai_items', column: 'question', definition: 'TEXT' },
  { table: 'ai_ready_drafts', column: 'revision', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'ai_ready_drafts', column: 'run_id', definition: 'TEXT' },
  { table: 'ai_ready_drafts', column: 'updated_at', definition: 'INTEGER' },
  { table: 'ai_ready_drafts', column: 'stale_reason', definition: 'TEXT' },
  { table: 'ai_memory', column: 'revision', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'ai_memory', column: 'updated_by', definition: 'TEXT' }
]

/** Version 3: who closed a project, so the user's closing stands; a proposal's revision. */
const STEP_3_COLUMNS: ReadonlyArray<{ table: string; column: string; definition: string }> = [
  { table: 'ai_projects', column: 'closed_by', definition: 'TEXT' },
  { table: 'ai_proposals', column: 'revision', definition: 'INTEGER NOT NULL DEFAULT 1' }
]

/** Version 4: what the short names in the words that stay (the letter, a meeting's preparation, "Il punto") stand for. */
const STEP_4_COLUMNS: ReadonlyArray<{ table: string; column: string; definition: string }> = [
  { table: 'ai_briefings', column: 'links_json', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'ai_event_preps', column: 'links_json', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'ai_projects', column: 'state_links_json', definition: "TEXT NOT NULL DEFAULT '[]'" }
]

/**
 * Version 6: how far back each connection is read one by one — what
 * Conoscimi decided, why and when — and, for a calendar, how far its events
 * have been looked at; and the project a thing born of the user's word is
 * about (`project_id`: the others stand in the projects of their source).
 */
const STEP_6: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS ai_reading (
    connection_key TEXT PRIMARY KEY,
    days INTEGER,
    reason TEXT,
    set_by TEXT,
    set_at INTEGER,
    looked_from INTEGER,
    looked_until INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_items_project ON ai_items(project_id) WHERE project_id IS NOT NULL'
]

async function hasTable(sql: Sql, table: string): Promise<boolean> {
  return (
    (await sql.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      table
    )) !== null
  )
}

async function addColumn(
  sql: Sql,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await sql.all<{ name: string }>(`PRAGMA table_info(${table})`)

  if (!columns.some((existing) => existing.name === column)) {
    await sql.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/**
 * Topics become projects. An extension's topics were a catalogue read from
 * its disk, most never seen in the mail: those with conversations become
 * the Segretario's projects, named as they were; the empty ones go — the
 * Segretario finds them again when the mail speaks of them.
 */
async function topicsToProjects(sql: Sql): Promise<void> {
  if (!(await hasTable(sql, 'ai_topics'))) {
    return
  }

  // Run again after a start cut short between two steps, it picks up where it was: the links
  // already copied stand for those of a table already dropped.
  const threads = await hasTable(sql, 'ai_topic_threads')
  const linked = threads
    ? 'EXISTS (SELECT 1 FROM ai_topic_threads x WHERE x.topic_id = t.id)'
    : 'EXISTS (SELECT 1 FROM ai_project_threads x WHERE x.project_id = t.id)'

  await sql.run(`
    INSERT OR IGNORE INTO ai_projects (
      id, title, title_by, description, state, state_at, stale_since, origin,
      hidden_at, closed_at, active_at, revision, created_at, updated_at
    )
    SELECT t.id, t.title,
      CASE WHEN t.origin = 'utente' THEN 'utente' ELSE 'segretario' END,
      COALESCE(t.gist, t.description), t.state, t.state_at, NULL,
      CASE WHEN t.origin = 'utente' THEN 'utente' ELSE 'segretario' END,
      NULL, t.archived_at, t.active_at, 1, t.created_at, t.updated_at
    FROM ai_topics t
    WHERE t.origin <> 'extension' OR ${linked}
  `)

  if (threads) {
    await sql.run(`
      INSERT OR IGNORE INTO ai_project_threads (project_id, account_id, thread_id, linked_by, rejected, created_at)
      SELECT x.topic_id, x.account_id, x.thread_id,
        CASE WHEN x.linked_by = 'utente' THEN 'utente' ELSE 'segretario' END, 0, x.created_at
      FROM ai_topic_threads x
      WHERE x.topic_id IN (SELECT id FROM ai_projects)
    `)
    await sql.run('DROP TABLE ai_topic_threads')
  }

  await sql.run(`
    INSERT OR IGNORE INTO ai_project_resources (project_id, kind, location, label, added_by, created_at)
    SELECT t.id, 'cartella', t.folder_path, NULL, 'segretario', t.created_at
    FROM ai_topics t
    WHERE t.folder_path IS NOT NULL AND t.id IN (SELECT id FROM ai_projects)
  `)
  await sql.run('DROP TABLE ai_topics')
}

async function registryStep(sql: Sql): Promise<void> {
  for (const statement of REGISTRY) {
    await sql.run(statement)
  }

  for (const { table, column, definition } of ADDED_COLUMNS) {
    await addColumn(sql, table, column, definition)
  }

  // What was open or closed keeps its meaning under the new words.
  await sql.run("UPDATE ai_items SET status = 'aperta' WHERE status = 'aperto'")
  await sql.run("UPDATE ai_items SET status = 'fatta' WHERE status = 'chiuso'")
  await sql.run(
    'UPDATE ai_items SET updated_at = COALESCE(closed_at, created_at) WHERE updated_at IS NULL'
  )
  await sql.run('UPDATE ai_notes SET updated_at = created_at WHERE updated_at IS NULL')
  await sql.run('UPDATE ai_ready_drafts SET updated_at = created_at WHERE updated_at IS NULL')
  await sql.run("UPDATE ai_activities SET kind = 'conoscimi' WHERE kind = 'conoscerti'")
  await sql.run("UPDATE ai_activities SET kind = 'al_passo' WHERE kind = 'aggiornamento'")
  await sql.run('UPDATE ai_activities SET task = kind WHERE task IS NULL')
  // What it did alone before there was a diary goes there: the panel keeps the user's requests.
  await sql.run(
    "UPDATE ai_activities SET visibility = 'diario' WHERE task IN ('al_passo', 'riflessione')"
  )
  await topicsToProjects(sql)
}

/**
 * Version 5: an open thing comes from any source — a message, an event,
 * or the user's word — so its message is no longer required, and its event
 * is kept. SQLite cannot loosen a column, so the table is built again: a
 * new one, the rows copied with their ids, the old one dropped, the new one
 * renamed. A start cut short anywhere picks up where it was: rows already
 * copied stay as they are, a table already dropped is not looked for, and
 * a table already renamed is done.
 */
async function itemsFromAnySource(sql: Sql): Promise<void> {
  const columns = await sql.all<{ name: string }>('PRAGMA table_info(ai_items)')

  if (!columns.some((column) => column.name === 'event_key')) {
    await rebuildItems(sql, columns)
  }

  // Also after a start cut short just past the rename: the indexes come with the new table.
  for (const statement of ITEM_INDEXES) {
    await sql.run(statement)
  }
}

async function rebuildItems(sql: Sql, columns: ReadonlyArray<{ name: string }>): Promise<void> {
  await sql.run(`CREATE TABLE IF NOT EXISTS ai_items_v5 (
    id INTEGER PRIMARY KEY,
    account_id TEXT,
    thread_id TEXT,
    message_key TEXT,
    event_key TEXT,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    due TEXT,
    status TEXT NOT NULL,
    until TEXT,
    closed_by TEXT,
    reason TEXT,
    evidence_key TEXT,
    question TEXT,
    created_by TEXT NOT NULL DEFAULT 'segretario',
    run_id TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    closed_at INTEGER
  )`)
  const copied = columns.map((column) => column.name).join(', ')
  await sql.run(`INSERT OR IGNORE INTO ai_items_v5 (${copied}) SELECT ${copied} FROM ai_items`)
  await sql.run('DROP TABLE ai_items')
  await sql.run('ALTER TABLE ai_items_v5 RENAME TO ai_items')
}

/** Brings the Segretario's tables to this build's shape; safe to run at every start. */
export async function ensureAiSchema(sql: Sql): Promise<void> {
  await sql.run('CREATE TABLE IF NOT EXISTS ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

  for (const statement of BASELINE) {
    await sql.run(statement)
  }

  const stored = await sql.get<{ value: string }>(
    "SELECT value FROM ai_meta WHERE key = 'schema_version'"
  )
  const version = stored ? Number(stored.value) : 1

  if (version < 2) {
    await registryStep(sql)
  }

  if (version < 3) {
    for (const { table, column, definition } of STEP_3_COLUMNS) {
      await addColumn(sql, table, column, definition)
    }
  }

  if (version < 4) {
    for (const { table, column, definition } of STEP_4_COLUMNS) {
      await addColumn(sql, table, column, definition)
    }
  }

  if (version < 5) {
    await itemsFromAnySource(sql)
  }

  if (version < 6) {
    await addColumn(sql, 'ai_items', 'project_id', 'TEXT')

    for (const statement of STEP_6) {
      await sql.run(statement)
    }
  }

  // Version 7: what an extension did with a message outside the mail is the mail's — a mark —
  // no longer a copy in the registry; the mail has taken the copies as marks (`AppDatabase`).
  if (version < 7) {
    await sql.run('DROP TABLE IF EXISTS ai_saved_copies')
  }

  // Version 8: a note says whether the user is to be told of its message now (§13.3).
  if (version < 8) {
    await addColumn(sql, 'ai_notes', 'notify', 'INTEGER NOT NULL DEFAULT 0')
  }

  if (version !== SCHEMA_VERSION) {
    await sql.run(
      "INSERT INTO ai_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      String(SCHEMA_VERSION)
    )
  }
}
