import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  forgetLeftKeysStatement,
  keyHoldersQuery,
  keysHeldStatement,
  keysLeftStatement,
  MESSAGE_ID_KEYS_SCHEMA,
  rememberKeysStatement
} from './message-id-keys'

/** The columns the statements read, as the app's tables have them. */
const SCHEMA = `
  CREATE TABLE accounts (id TEXT PRIMARY KEY);
  CREATE TABLE folders (account_id TEXT NOT NULL, path TEXT NOT NULL, last_synced_at INTEGER);
  CREATE TABLE messages (
    account_id TEXT NOT NULL, folder_path TEXT NOT NULL, uid INTEGER NOT NULL,
    message_key TEXT NOT NULL
  );
  CREATE TABLE ai_notes (account_id TEXT NOT NULL, message_key TEXT NOT NULL);
  CREATE TABLE ai_items (account_id TEXT NOT NULL, message_key TEXT NOT NULL);
  CREATE TABLE ai_ready_drafts (account_id TEXT NOT NULL, message_key TEXT NOT NULL);
  CREATE TABLE ai_proposals (account_id TEXT, message_key TEXT);
  CREATE TABLE ai_saved_copies (account_id TEXT NOT NULL, message_key TEXT NOT NULL);
  CREATE TABLE ai_gone (account_id TEXT NOT NULL, message_key TEXT NOT NULL);
  INSERT INTO accounts VALUES ('a'), ('b');
`

describe('message_id_keys', () => {
  let db: DatabaseSync

  const run = (statement: { sql: string; params: unknown[] }): void => {
    db.prepare(statement.sql).run(...(statement.params as Array<string | number | null>))
  }
  const keys = (): Array<{ key: string; leftAt: number | null }> =>
    db
      .prepare(
        'SELECT message_key AS key, left_at AS leftAt FROM message_id_keys ORDER BY account_id, message_key'
      )
      .all() as Array<{ key: string; leftAt: number | null }>
  const row = (key: string, folder = 'INBOX', account = 'a'): void => {
    db.prepare('INSERT INTO messages VALUES (?, ?, 1, ?)').run(account, folder, key)
  }
  const unrow = (key: string): void => {
    db.prepare('DELETE FROM messages WHERE message_key = ?').run(key)
  }
  const folders = (...syncedAt: Array<number | null>): void => {
    syncedAt.forEach((at, index) =>
      db.prepare('INSERT INTO folders VALUES (?, ?, ?)').run('a', `F${index}`, at)
    )
  }

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec(SCHEMA)
    MESSAGE_ID_KEYS_SCHEMA.forEach((statement) => db.exec(statement))
    run(
      rememberKeysStatement(
        'a',
        [
          { messageKey: 'm:x', threadId: 'r:x', digest: 'aaaa' },
          { messageKey: 'm:x#bbbb', threadId: 'r:x', digest: 'bbbb' }
        ],
        100
      )
    )
  })

  afterEach(() => db.close())

  it('remembers who settled a key first, as held by no row until the rows are stored', () => {
    run(
      rememberKeysStatement('a', [{ messageKey: 'm:x', threadId: 'r:other', digest: 'cccc' }], 200)
    )
    expect(keys()).toEqual([
      { key: 'm:x', leftAt: 100 },
      { key: 'm:x#bbbb', leftAt: 100 }
    ])

    const query = keyHoldersQuery('a', ['m:x', 'm:y'])
    expect(db.prepare(query.sql).all(...(query.params as string[]))).toEqual([
      { messageKey: 'm:x', threadId: 'r:x', digest: 'aaaa' }
    ])

    run(keysHeldStatement('a', ['m:x']))
    expect(keys()[0]).toEqual({ key: 'm:x', leftAt: null })
  })

  it('marks a key left only once no row holds it', () => {
    row('m:x', 'INBOX')
    row('m:x', 'Archivio')
    run(keysHeldStatement('a', ['m:x', 'm:x#bbbb']))

    unrow('m:x#bbbb')
    db.prepare("DELETE FROM messages WHERE folder_path = 'INBOX'").run()
    run(keysLeftStatement('a', 300, ['m:x', 'm:x#bbbb']))
    expect(keys()).toEqual([
      { key: 'm:x', leftAt: null },
      { key: 'm:x#bbbb', leftAt: 300 }
    ])

    unrow('m:x')
    run(keysLeftStatement('a', 400, null))
    expect(keys()).toEqual([
      { key: 'm:x', leftAt: 400 },
      // Left already: since when is kept.
      { key: 'm:x#bbbb', leftAt: 300 }
    ])
  })

  it('forgets a key left once every folder was read since, unless the Segretario names it', () => {
    run(keysHeldStatement('a', ['m:x', 'm:x#bbbb']))
    run(keysLeftStatement('a', 300, null))

    // A folder not read since: the message may be there.
    folders(500, 250)
    run(forgetLeftKeysStatement('a'))
    expect(keys()).toHaveLength(2)

    db.prepare("UPDATE folders SET last_synced_at = 600 WHERE path = 'F1'").run()
    db.prepare("INSERT INTO ai_saved_copies VALUES ('a', 'm:x#bbbb')").run()
    run(forgetLeftKeysStatement('a'))
    expect(keys()).toEqual([{ key: 'm:x#bbbb', leftAt: 300 }])

    db.prepare('DELETE FROM ai_saved_copies').run()
    db.prepare("INSERT INTO ai_notes VALUES ('b', 'm:x#bbbb')").run()
    run(forgetLeftKeysStatement('a'))
    expect(keys()).toEqual([])
  })

  it('keeps every key while a folder has never been read, or none is known', () => {
    run(keysHeldStatement('a', ['m:x', 'm:x#bbbb']))
    run(keysLeftStatement('a', 300, null))
    run(forgetLeftKeysStatement('a'))
    expect(keys()).toHaveLength(2)

    folders(500, null)
    run(forgetLeftKeysStatement('a'))
    expect(keys()).toHaveLength(2)
  })

  it('never forgets a key a row holds', () => {
    folders(500)
    row('m:x')
    run(forgetLeftKeysStatement('a'))
    expect(keys().map((entry) => entry.key)).toEqual(['m:x'])
  })
})
