import type { StoredIdentity } from './message-identity'

/**
 * The messages of each account known by a key made of a Message-ID — the
 * one kind of key a different message can claim too (see
 * `settleIdentity`): the message holding each, by its `contentDigest`, and
 * the conversation it was filed in.
 *
 * A key is remembered while no folder holds it (`left_at`): a message
 * moved by another program, or whose folder is read anew, is stored again
 * as who it was — not as whichever message sharing its Message-ID came
 * first. It is forgotten once every folder of its account has been read
 * since it left, unless something names it — the Segretario, or an
 * extension's mark: a different message reusing the Message-ID of one
 * deleted is then not taken for it — for its note, its open items, its
 * marks.
 *
 * Kept apart from the cache, it outlives a cache dropped and downloaded
 * again (see `AppDatabase.resetCacheIfOutdated`).
 */
export const MESSAGE_ID_KEYS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS message_id_keys (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    left_at INTEGER,
    PRIMARY KEY (account_id, message_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_message_id_keys_left
    ON message_id_keys(account_id, left_at) WHERE left_at IS NOT NULL`
] as const

/**
 * The tables that name a message by its key — the Segretario's (see
 * `src/main/ai/schema.ts`) and extensions' marks: a key one of them names
 * stays remembered.
 */
const NAMING_TABLES = [
  'ai_notes',
  'ai_read',
  'ai_alerts',
  'ai_items',
  'ai_ready_drafts',
  'ai_proposals',
  'ai_gone',
  'message_marks'
] as const

interface Statement {
  sql: string
  params: unknown[]
}

const marks = (count: number): string => Array.from({ length: count }, () => '?').join(', ')

/** The messages holding `keys` (see `StoredIdentity`), as `message_id_keys` rows read back. */
export function keyHoldersQuery(accountId: string, keys: ReadonlyArray<string>): Statement {
  return {
    sql: `
      SELECT message_key AS messageKey, thread_id AS threadId, content_digest AS digest
      FROM message_id_keys
      WHERE account_id = ? AND message_key IN (${marks(keys.length)})
    `,
    params: [accountId, ...keys]
  }
}

/**
 * Remembers who holds keys just settled, as having no row yet: storing
 * the rows marks them held (`keysHeldStatement`). A key known already
 * keeps its holder — settling gave it to the message with its digest.
 */
export function rememberKeysStatement(
  accountId: string,
  identities: ReadonlyArray<Required<StoredIdentity>>,
  at: number
): Statement {
  return {
    sql: `
      INSERT INTO message_id_keys (account_id, message_key, thread_id, content_digest, left_at)
      VALUES ${identities.map(() => '(?, ?, ?, ?, ?)').join(', ')}
      ON CONFLICT (account_id, message_key) DO NOTHING
    `,
    params: identities.flatMap((identity) => [
      accountId,
      identity.messageKey,
      identity.threadId,
      identity.digest,
      at
    ])
  }
}

/** Keys a folder's rows hold again. */
export function keysHeldStatement(accountId: string, keys: ReadonlyArray<string>): Statement {
  return {
    sql: `
      UPDATE message_id_keys SET left_at = NULL
      WHERE account_id = ? AND left_at IS NOT NULL AND message_key IN (${marks(keys.length)})
    `,
    params: [accountId, ...keys]
  }
}

/**
 * Marks the keys of `keys` — every key of the account when it is null —
 * that no row holds any longer as gone since `at`.
 */
export function keysLeftStatement(
  accountId: string,
  at: number,
  keys: ReadonlyArray<string> | null
): Statement {
  return {
    sql: `
      UPDATE message_id_keys SET left_at = ?
      WHERE account_id = ? AND left_at IS NULL
        ${keys ? `AND message_key IN (${marks(keys.length)})` : ''}
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.account_id = message_id_keys.account_id AND m.message_key = message_id_keys.message_key
        )
    `,
    params: [at, accountId, ...(keys ?? [])]
  }
}

/**
 * Forgets the keys of an account no folder holds, that left before every
 * one of its folders was last read and that the Segretario does not name.
 */
export function forgetLeftKeysStatement(accountId: string): Statement {
  return {
    sql: `
      DELETE FROM message_id_keys
      WHERE account_id = ?
        AND left_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM folders f WHERE f.account_id = message_id_keys.account_id)
        -- Every folder read since it left: moved to one not read yet, it may come back.
        AND NOT EXISTS (
          SELECT 1 FROM folders f WHERE f.account_id = message_id_keys.account_id
            AND (f.last_synced_at IS NULL OR f.last_synced_at < message_id_keys.left_at)
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.account_id = message_id_keys.account_id AND m.message_key = message_id_keys.message_key
        )
        ${NAMING_TABLES.map(
          (table) => `AND NOT EXISTS (
          SELECT 1 FROM ${table} r
          WHERE r.account_id = message_id_keys.account_id AND r.message_key = message_id_keys.message_key
        )`
        ).join('\n        ')}
    `,
    params: [accountId]
  }
}
