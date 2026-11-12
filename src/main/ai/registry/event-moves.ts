import type { Sql, SqlStatement } from '../sql'

/** An event moved to another calendar (vision §7.5): its key before, and its key there. */
export interface EventMove {
  from: string
  to: string
}

/**
 * The rows the registry keeps by an event's key: what was open from it, its
 * preparation, what the user was told of it, whose it is, its place in
 * projects. A row already under the new key — none should be — gives way to
 * the one that moves, which is the event's.
 */
const KEYED: ReadonlyArray<string> = [
  'UPDATE ai_items SET event_key = ? WHERE event_key = ?',
  'UPDATE OR REPLACE ai_event_preps SET event_key = ? WHERE event_key = ?',
  'UPDATE ai_alerts SET event_key = ? WHERE event_key = ?',
  'UPDATE OR REPLACE ai_own_events SET event_key = ? WHERE event_key = ?',
  "UPDATE OR REPLACE ai_project_resources SET location = ? WHERE kind = 'evento' AND location = ?"
]

/**
 * The words kept as JSON that name events by key: the diary's pages (the
 * names a run gave — what a conversation goes on with —, the changes with
 * their undo), the lessons, the proposals, the history of open things (an
 * undo puts its event back), and the links of the words that stay (the
 * letter, a preparation, «Il punto»).
 */
const NAMING: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'ai_events', column: 'payload_json' },
  { table: 'ai_lessons', column: 'payload_json' },
  { table: 'ai_proposals', column: 'payload_json' },
  { table: 'ai_proposals', column: 'result_json' },
  { table: 'ai_item_history', column: 'before_json' },
  { table: 'ai_item_history', column: 'after_json' },
  { table: 'ai_event_preps', column: 'links_json' },
  { table: 'ai_briefings', column: 'links_json' },
  { table: 'ai_projects', column: 'state_links_json' }
]

/** Up to how many keys the words are looked for one by one (see `relocateEvents`). */
const SOUGHT_ONE_BY_ONE = 8

/** A JSON string, whole: scanned from a document's start, every match is one string value. */
const JSON_STRING = /"[^"\\]*(?:\\.[^"\\]*)*"/g

/** A text SQLite gave as `hex()`: its UTF-8 bytes. */
function fromHex(hex: string): string {
  return Buffer.from(hex, 'hex').toString('utf8')
}

/** The calendar an event's key — or a series' — begins with: `connection\0calendar`. */
function calendarOf(key: string): string {
  return key.split('\u0000').slice(0, 2).join('\u0000')
}

/**
 * Moves what the registry keeps of events to their new keys, in one
 * transaction (vision §7.5): an event moved is the same event. Its
 * revisions stay — nothing in it changed. The mark of a series the user's
 * (`ai_own_events.series_key`) follows the series to its key there:
 * `seriesOf` says it of an event as it is now, asked only when a series of
 * the calendars it left is marked. How many rows followed.
 */
export async function relocateEvents(
  sql: Sql,
  moves: ReadonlyArray<EventMove>,
  seriesOf: (eventKey: string) => Promise<string | null>
): Promise<number> {
  const events = new Map(
    moves.filter((move) => move.from && move.to && move.from !== move.to).map((m) => [m.from, m.to])
  )

  if (events.size === 0) {
    return 0
  }

  const left = [...new Set([...events.keys()].map(calendarOf))]
  const series = await seriesMoves(sql, events, left, seriesOf)
  const statements: SqlStatement[] = [
    ...[...events].flatMap(([from, to]) =>
      KEYED.map((statement) => ({ sql: statement, params: [to, from] }))
    ),
    ...[...series].map(([from, to]) => ({
      sql: 'UPDATE ai_own_events SET series_key = ? WHERE series_key = ?',
      params: [to, from]
    }))
  ]
  // As JSON writes them — quoted, a NUL as \u0000 —: a key is a whole string value, never part of one.
  const renamed = new Map(
    [...events, ...series].map(([from, to]) => [JSON.stringify(from), JSON.stringify(to)])
  )
  // What the words are looked for by, in one pass of each table: the keys themselves when they are
  // few — only what names them is read —, else the calendars they left, which every one begins with.
  const sought =
    renamed.size <= SOUGHT_ONE_BY_ONE
      ? [...renamed.keys()]
      : left.map((calendar) => JSON.stringify(`${calendar}\u0000`).slice(0, -1))

  for (const { table, column } of NAMING) {
    const rows = await sql.all<{ id: number; text: string }>(
      `SELECT rowid AS id, ${column} AS text FROM ${table}
       WHERE ${sought.map(() => `instr(${column}, ?) > 0`).join(' OR ')}`,
      ...sought
    )

    for (const row of rows) {
      const text = row.text.replace(JSON_STRING, (value) => renamed.get(value) ?? value)

      // Only over the words as they were read: one written meanwhile is left as it was written.
      if (text !== row.text) {
        statements.push({
          sql: `UPDATE ${table} SET ${column} = ? WHERE rowid = ? AND ${column} = ?`,
          params: [text, row.id, row.text]
        })
      }
    }
  }

  return (await sql.batch(statements)).reduce((sum, changed) => sum + changed, 0)
}

/**
 * The series that moved with the events, by their keys before and after —
 * only those the registry marks the user's, in the calendars left. A move
 * within a connection keeps the series' id; one that copies the event gives
 * it a new one, known from the mark's own event when that moved too.
 */
async function seriesMoves(
  sql: Sql,
  events: ReadonlyMap<string, string>,
  left: ReadonlyArray<string>,
  seriesOf: (eventKey: string) => Promise<string | null>
): Promise<Map<string, string>> {
  // Read as hex: a key holds NULs, which not every driver gives back whole.
  const marked = (
    await sql.all<{ event_key: string; series_key: string }>(
      `SELECT hex(event_key) AS event_key, hex(series_key) AS series_key FROM ai_own_events
       WHERE series_key IS NOT NULL AND (${left.map(() => 'instr(series_key, ?) = 1').join(' OR ')})`,
      ...left.map((calendar) => `${calendar}\u0000`)
    )
  ).map((row) => ({ event: fromHex(row.event_key), series: fromHex(row.series_key) }))
  const moved = new Map<string, string>()

  if (marked.length === 0) {
    return moved
  }

  const markedSeries = new Set(marked.map((row) => row.series))
  const seriesAt = new Map(marked.map((row) => [row.event, row.series]))

  for (const [from, to] of events) {
    const now = await seriesOf(to)
    const calendar = `${calendarOf(to)}\u0000`

    if (!now || !now.startsWith(calendar)) {
      continue
    }

    for (const before of [
      seriesAt.get(from),
      `${calendarOf(from)}\u0000${now.slice(calendar.length)}`
    ]) {
      if (before && before !== now && markedSeries.has(before)) {
        moved.set(before, now)
      }
    }
  }

  return moved
}
