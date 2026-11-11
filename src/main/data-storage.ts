import type { Sql } from '@main/ai/sql'
import type { DataStorageSection } from '@shared/models'

/**
 * What SIEVER Mail keeps on the computer, by whose it is (Impostazioni ›
 * Dati, vision §13.2): each connection — a mailbox, a calendar —, the
 * Segretario's share of each, what the Segretario keeps of no connection,
 * the extension's, and what every app shares. One database holds them all:
 * the bytes of each table come from SQLite itself (`dbstat`), and a table
 * several own is shared out by its rows.
 */

export interface StorageOwners {
  mail: ReadonlyArray<{ id: string; label: string }>
  calendars: ReadonlyArray<{ id: string; label: string }>
  /** The extension installed, with the start its tables' names take (`acme_srl_`). */
  extension: { label: string; tablePrefix: string } | null
}

/** Whose a row is: a mailbox, a calendar connection, their Segretario, or a whole share. */
type Owner =
  | `mail:${string}`
  | `calendar:${string}`
  | `segretario:mail:${string}`
  | `segretario:calendar:${string}`
  | 'segretario'
  | 'extension'
  | 'common'

/** The connection a calendar's key (`calendarKey`, `eventKey`, `seriesKey`) starts with. */
function connectionOf(column: string): string {
  return `substr(${column}, 1, instr(${column}, char(0)) - 1)`
}

/** The bytes a body takes, which its search index takes too: counted, not decoded. */
const BODY_WEIGHT = 'COALESCE(octet_length(body), 0) + COALESCE(octet_length(html), 0) + 64'

/**
 * How each table is shared out: SQL giving, for its rows, whose they are and
 * how much they weigh (rows, or the text they hold). A table not here is
 * shared by every app; an extension's goes to the extension.
 */
const SPLITS: Readonly<Record<string, string>> = {
  accounts: "SELECT 'mail:' || id AS owner, 1 AS weight FROM accounts",
  folders:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM folders GROUP BY account_id",
  messages:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM messages GROUP BY account_id",
  message_bodies: `SELECT 'mail:' || account_id AS owner, SUM(${BODY_WEIGHT}) AS weight FROM message_bodies GROUP BY account_id`,
  left_out_messages:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM left_out_messages GROUP BY account_id",
  message_id_keys:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM message_id_keys GROUP BY account_id",
  account_signatures:
    "SELECT 'mail:' || account_id AS owner, octet_length(html) + 32 AS weight FROM account_signatures",
  recent_folders:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM recent_folders GROUP BY account_id",
  drafts:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM drafts GROUP BY account_id",
  outbox:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM outbox GROUP BY account_id",
  message_marks:
    "SELECT 'mail:' || account_id AS owner, COUNT(*) AS weight FROM message_marks GROUP BY account_id",
  // The search index of the bodies: as the bodies are.
  message_fts: `SELECT 'mail:' || account_id AS owner, SUM(${BODY_WEIGHT}) AS weight FROM message_bodies GROUP BY account_id`,

  calendar_connections: "SELECT 'calendar:' || id AS owner, 1 AS weight FROM calendar_connections",
  calendar_calendars:
    "SELECT 'calendar:' || connection_id AS owner, COUNT(*) AS weight FROM calendar_calendars GROUP BY connection_id",
  calendar_events:
    "SELECT 'calendar:' || connection_id AS owner, COUNT(*) AS weight FROM calendar_events GROUP BY connection_id",
  calendar_objects:
    "SELECT 'calendar:' || connection_id AS owner, COUNT(*) AS weight FROM calendar_objects GROUP BY connection_id",
  calendar_changes:
    "SELECT 'calendar:' || connection_id AS owner, COUNT(*) AS weight FROM calendar_changes GROUP BY connection_id",

  ai_notes:
    "SELECT 'segretario:mail:' || account_id AS owner, COUNT(*) AS weight FROM ai_notes GROUP BY account_id",
  ai_read:
    "SELECT 'segretario:mail:' || account_id AS owner, COUNT(*) AS weight FROM ai_read GROUP BY account_id",
  ai_ready_drafts:
    "SELECT 'segretario:mail:' || account_id AS owner, COUNT(*) AS weight FROM ai_ready_drafts GROUP BY account_id",
  ai_drafts:
    "SELECT 'segretario:mail:' || account_id AS owner, COUNT(*) AS weight FROM ai_drafts GROUP BY account_id",
  ai_project_threads:
    "SELECT 'segretario:mail:' || account_id AS owner, COUNT(*) AS weight FROM ai_project_threads GROUP BY account_id",
  ai_gone:
    "SELECT 'segretario:mail:' || account_id AS owner, COUNT(*) AS weight FROM ai_gone GROUP BY account_id",
  ai_reading: `SELECT CASE WHEN connection_key LIKE 'calendario:%'
      THEN 'segretario:calendar:' || substr(connection_key, 12)
      ELSE 'segretario:mail:' || connection_key END AS owner, COUNT(*) AS weight
    FROM ai_reading GROUP BY owner`,
  ai_learning: `SELECT CASE WHEN account_id LIKE 'calendario:%'
      THEN 'segretario:calendar:' || substr(account_id, 12)
      ELSE 'segretario:mail:' || account_id END AS owner, COUNT(*) AS weight
    FROM ai_learning GROUP BY owner`,
  ai_alerts: `SELECT CASE WHEN account_id IS NOT NULL THEN 'segretario:mail:' || account_id
      WHEN event_key IS NOT NULL THEN 'segretario:calendar:' || ${connectionOf('event_key')}
      ELSE 'segretario' END AS owner, COUNT(*) AS weight
    FROM ai_alerts GROUP BY owner`,
  ai_items: `SELECT CASE WHEN account_id IS NOT NULL THEN 'segretario:mail:' || account_id
      WHEN event_key IS NOT NULL THEN 'segretario:calendar:' || ${connectionOf('event_key')}
      ELSE 'segretario' END AS owner, COUNT(*) AS weight
    FROM ai_items GROUP BY owner`,
  ai_proposals: `SELECT CASE WHEN account_id IS NOT NULL THEN 'segretario:mail:' || account_id
      ELSE 'segretario' END AS owner, COUNT(*) AS weight
    FROM ai_proposals GROUP BY owner`,
  ai_event_preps: `SELECT 'segretario:calendar:' || ${connectionOf('event_key')} AS owner,
      SUM(octet_length(text) + 64) AS weight FROM ai_event_preps GROUP BY owner`,
  ai_own_events: `SELECT 'segretario:calendar:' || ${connectionOf('event_key')} AS owner,
      COUNT(*) AS weight FROM ai_own_events GROUP BY owner`,
  ai_calendar_roles: `SELECT 'segretario:calendar:' || ${connectionOf('calendar_key')} AS owner,
      COUNT(*) AS weight FROM ai_calendar_roles GROUP BY owner`,
  // The key and the switch are the Segretario's while there is a key; the schema's version, the app's.
  ai_settings: `SELECT CASE WHEN encrypted_api_key IS NOT NULL THEN 'segretario' ELSE 'common' END
      AS owner, COUNT(*) AS weight FROM ai_settings GROUP BY owner`,
  ai_meta: `SELECT CASE WHEN key = 'schema_version' THEN 'common' ELSE 'segretario' END AS owner,
      COUNT(*) AS weight FROM ai_meta GROUP BY owner`
}

/** The tables of the search index of the bodies, which SQLite names after it. */
function splitOf(table: string): string | undefined {
  return SPLITS[table] ?? (table.startsWith('message_fts_') ? SPLITS.message_fts : undefined)
}

/** Whose a table is when none of its rows says: an empty one, or one of no connection. */
function defaultOwner(table: string, extensionPrefix: string | null): Owner {
  if (extensionPrefix && table.startsWith(extensionPrefix)) {
    return 'extension'
  }

  return table.startsWith('ai_') ? 'segretario' : 'common'
}

function bytesOf(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

async function hasRows(sql: Sql, table: string): Promise<boolean> {
  try {
    return (await sql.get(`SELECT 1 AS one FROM "${table.replace(/"/g, '""')}" LIMIT 1`)) !== null
  } catch {
    // A table that cannot be read row by row (an index of a virtual one): its pages, as they are.
    return true
  }
}

/** The bytes of each table, its indexes with it, as SQLite has them on its pages. */
async function tableBytes(sql: Sql): Promise<Map<string, number>> {
  const rows = await sql.all<{ tbl: string; bytes: number | bigint }>(
    `SELECT m.tbl_name AS tbl, SUM(d.pgsize) AS bytes
     FROM dbstat AS d JOIN sqlite_master AS m ON m.name = d.name
     GROUP BY m.tbl_name`
  )
  return new Map(rows.map((row) => [row.tbl, bytesOf(row.bytes)]))
}

/**
 * The database shared out among its owners, in bytes. What belongs to a
 * connection no longer there — a remnant the cleanup has not reached — is
 * counted where it is: shared by the app, or the Segretario's.
 */
export async function measureDatabase(
  sql: Sql,
  owners: StorageOwners
): Promise<Map<Owner, number>> {
  const known = new Set<string>([
    ...owners.mail.map((mailbox) => `mail:${mailbox.id}`),
    ...owners.calendars.map((calendar) => `calendar:${calendar.id}`)
  ])
  const prefix = owners.extension?.tablePrefix ?? null
  const shares = new Map<Owner, number>()
  const add = (owner: Owner, bytes: number): void => {
    shares.set(owner, (shares.get(owner) ?? 0) + bytes)
  }
  // The bodies and every table of their index share one reading of the text.
  const weighed = new Map<string, Promise<Array<{ owner: string; weight: number }>>>()
  const weigh = (split: string): Promise<Array<{ owner: string; weight: number }>> => {
    let weights = weighed.get(split)

    if (!weights) {
      weights = sql
        .all<{ owner: string | null; weight: number | bigint | null }>(split)
        .then((rows) =>
          rows
            .map((row) => ({ owner: row.owner ?? '', weight: bytesOf(row.weight) }))
            .filter((row) => row.weight > 0)
        )
        // A table that cannot be shared out stays whole, with its default owner.
        .catch(() => [])
      weighed.set(split, weights)
    }

    return weights
  }

  for (const [table, bytes] of await tableBytes(sql)) {
    const split = splitOf(table)
    // An empty table is the app's structure, whoever's its rows would be: after «Dimentica
    // tutto», nothing of the Segretario.
    const fallback = (await hasRows(sql, table)) ? defaultOwner(table, prefix) : 'common'

    if (!split) {
      add(fallback, bytes)
      continue
    }

    const weights = await weigh(split)
    const total = weights.reduce((sum, row) => sum + row.weight, 0)

    if (total === 0) {
      add(fallback, bytes)
      continue
    }

    for (const { owner, weight } of weights) {
      const connection = owner.replace(/^segretario:/, '')
      const whose: Owner = known.has(connection)
        ? (owner as Owner)
        : owner.startsWith('segretario')
          ? 'segretario'
          : 'common'
      add(whose, (bytes * weight) / total)
    }
  }

  return shares
}

/**
 * The sections Impostazioni › Dati shows: each connection with the
 * Segretario's share of it, the Segretario's own, the extension's, what is
 * shared, and the files beside the database.
 */
export function storageSections(
  shares: ReadonlyMap<Owner, number>,
  owners: StorageOwners,
  files: { attachments: number; draftFiles: number; diagnostics: number }
): DataStorageSection[] {
  const bytes = (owner: Owner): number => Math.round(shares.get(owner) ?? 0)
  const sections: DataStorageSection[] = [
    ...owners.mail.map((mailbox): DataStorageSection => {
      const segretario = bytes(`segretario:mail:${mailbox.id}`)
      return {
        id: `mail:${mailbox.id}`,
        kind: 'mail',
        connectionId: mailbox.id,
        label: mailbox.label,
        sizeBytes: bytes(`mail:${mailbox.id}`) + segretario,
        segretarioBytes: segretario
      }
    }),
    ...owners.calendars.map((calendar): DataStorageSection => {
      const segretario = bytes(`segretario:calendar:${calendar.id}`)
      return {
        id: `calendar:${calendar.id}`,
        kind: 'calendar',
        connectionId: calendar.id,
        label: calendar.label,
        sizeBytes: bytes(`calendar:${calendar.id}`) + segretario,
        segretarioBytes: segretario
      }
    }),
    {
      id: 'segretario',
      kind: 'segretario',
      label: 'Il Segretario',
      sizeBytes: bytes('segretario'),
      segretarioBytes: bytes('segretario')
    },
    {
      id: 'common',
      kind: 'common',
      label: 'Comuni a tutte le app',
      // The files local drafts were opened with are the user's own, as the rest here.
      sizeBytes: bytes('common') + files.draftFiles,
      segretarioBytes: 0
    },
    ...(owners.extension
      ? [
          {
            id: 'extension',
            kind: 'extension' as const,
            label: owners.extension.label,
            sizeBytes: bytes('extension'),
            segretarioBytes: 0
          }
        ]
      : []),
    {
      id: 'attachments',
      kind: 'attachments',
      label: 'Copie degli allegati',
      sizeBytes: files.attachments,
      segretarioBytes: 0
    },
    {
      id: 'diagnostics',
      kind: 'diagnostics',
      label: 'Diagnostica',
      sizeBytes: files.diagnostics,
      segretarioBytes: 0
    }
  ]

  return sections
}
