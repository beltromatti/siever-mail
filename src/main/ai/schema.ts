import type { Sql } from './sql'

/**
 * The Segretario's tables, as this build has them. User data: kept across
 * updates, emptied by "Elimina tutti i dati" and "Dimentica tutto" (see
 * `AiStore.clearData`). What the engine keeps between runs — how far it has
 * looked, the setup under way — is in `ai_meta`.
 *
 * The registry: what is open has a life (done, not needed, deferred,
 * reopened) and a history; every object a revision, so two of the
 * Segretario's runs never overwrite each other; projects, a conversation in
 * more than one; replies prepared that can go stale; proposals; the work
 * queue; the memory's versions; how far each connection is read.
 */
const SCHEMA: ReadonlyArray<string> = [
  'CREATE TABLE IF NOT EXISTS ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
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
    cost REAL NOT NULL DEFAULT 0,
    task TEXT,
    visibility TEXT NOT NULL DEFAULT 'pannello',
    work_id TEXT,
    scope_json TEXT
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
    read_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT
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
    revision INTEGER NOT NULL DEFAULT 1,
    run_id TEXT,
    updated_at INTEGER,
    written_by TEXT NOT NULL DEFAULT 'segretario',
    PRIMARY KEY (account_id, message_key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_notes_thread ON ai_notes(account_id, thread_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_notes_state ON ai_notes(state, message_date)',
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
    created_at INTEGER NOT NULL,
    links_json TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS ai_event_preps (
    event_key TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    run_id TEXT,
    written_at INTEGER NOT NULL,
    links_json TEXT NOT NULL DEFAULT '[]'
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
    revision INTEGER NOT NULL DEFAULT 1,
    run_id TEXT,
    updated_at INTEGER,
    stale_reason TEXT,
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
  )`,
  // An open thing comes from any source: a message, an event, or the user's word (then perhaps
  // about a project).
  `CREATE TABLE IF NOT EXISTS ai_items (
    id INTEGER PRIMARY KEY,
    account_id TEXT,
    thread_id TEXT,
    message_key TEXT,
    event_key TEXT,
    project_id TEXT,
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
  )`,
  'CREATE INDEX IF NOT EXISTS idx_ai_items_thread ON ai_items(account_id, thread_id)',
  'CREATE INDEX IF NOT EXISTS idx_ai_items_status ON ai_items(status, due)',
  'CREATE INDEX IF NOT EXISTS idx_ai_items_event ON ai_items(event_key) WHERE event_key IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_ai_items_project ON ai_items(project_id) WHERE project_id IS NOT NULL',
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
    state_links_json TEXT NOT NULL DEFAULT '[]',
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
  // How far back each connection is read one by one — what Conoscimi decided, why and when —
  // and, for a calendar, how far its events have been looked at.
  `CREATE TABLE IF NOT EXISTS ai_reading (
    connection_key TEXT PRIMARY KEY,
    days INTEGER,
    reason TEXT,
    set_by TEXT,
    set_at INTEGER,
    looked_from INTEGER,
    looked_until INTEGER
  )`
]

/** The Segretario's tables, created where they are not: safe to run at every start. */
export async function ensureAiSchema(sql: Sql): Promise<void> {
  for (const statement of SCHEMA) {
    await sql.run(statement)
  }
}
