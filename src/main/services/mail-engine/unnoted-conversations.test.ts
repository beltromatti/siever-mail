import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  unnotedConversationsQuery,
  unnotedMessagesOf,
  type UnnotedMessage
} from './unnoted-conversations'

/** The columns the statement reads, as the app's tables have them. */
const SCHEMA = `
  CREATE TABLE messages (
    account_id TEXT NOT NULL, folder_path TEXT NOT NULL, uid INTEGER NOT NULL,
    message_key TEXT NOT NULL, thread_id TEXT NOT NULL, date_iso TEXT NOT NULL,
    UNIQUE (account_id, folder_path, uid)
  );
  CREATE INDEX idx_messages_folder_date ON messages(account_id, folder_path, date_iso DESC);
  CREATE INDEX idx_messages_key ON messages(account_id, message_key);
  CREATE TABLE message_bodies (
    account_id TEXT NOT NULL, message_key TEXT NOT NULL, UNIQUE (account_id, message_key)
  );
  CREATE TABLE ai_notes (
    account_id TEXT NOT NULL, message_key TEXT NOT NULL, PRIMARY KEY (account_id, message_key)
  );
`

const FOLDERS = { read: ['INBOX', '[Gmail]/Tutti i messaggi', 'Sent'], drafts: ['Drafts'] }
const SINCE = '2026-10-06T00:00:00.000Z'

describe('unnotedConversationsQuery', () => {
  let db: DatabaseSync

  const message = (
    folder: string,
    uid: number,
    key: string,
    thread: string,
    date: string,
    { body = true, account = 'a' }: { body?: boolean; account?: string } = {}
  ): void => {
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(
      account,
      folder,
      uid,
      key,
      thread,
      `2026-${date}T08:00:00.000Z`
    )

    if (body) {
      db.prepare('INSERT OR IGNORE INTO message_bodies VALUES (?, ?)').run(account, key)
    }
  }
  const run = (threadLimit = 300, messageLimit = 300): UnnotedMessage[] => {
    const query = unnotedConversationsQuery('a', FOLDERS, SINCE, threadLimit, messageLimit)
    return unnotedMessagesOf(
      db.prepare(query.sql).all(...(query.params as Array<string | number>)) as never
    )
  }

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec(SCHEMA)
  })

  afterEach(() => db.close())

  it('lists each conversation once, the latest first, its messages oldest first', () => {
    message('INBOX', 1, 'e:1', 't:A', '10-20')
    message('Sent', 2, 'e:2', 't:A', '10-21')
    message('INBOX', 3, 'e:3', 't:A', '11-02')
    message('INBOX', 4, 'e:4', 't:B', '11-04')
    // The same message under two labels is one message.
    message('[Gmail]/Tutti i messaggi', 104, 'e:4', 't:B', '11-04')

    expect(run().map((row) => [row.threadId, row.messageKey, row.newest.slice(5, 10)])).toEqual([
      ['t:B', 'e:4', '11-04'],
      ['t:A', 'e:1', '11-02'],
      ['t:A', 'e:2', '11-02'],
      ['t:A', 'e:3', '11-02']
    ])
  })

  it('leaves out what is noted, not indexed, a draft, too old, elsewhere or another account’s', () => {
    message('INBOX', 1, 'e:noted', 't:A', '11-01')
    db.prepare('INSERT INTO ai_notes VALUES (?, ?)').run('a', 'e:noted')
    message('INBOX', 2, 'e:waiting', 't:A', '11-01', { body: false })
    message('[Gmail]/Tutti i messaggi', 3, 'e:draft', 't:B', '11-01')
    message('Drafts', 4, 'e:draft', 't:B', '11-01')
    message('INBOX', 5, 'e:old', 't:C', '09-01')
    message('Trash', 6, 'e:binned', 't:D', '11-01')
    message('INBOX', 7, 'e:other', 't:E', '11-01', { account: 'b' })
    message('INBOX', 8, 'e:read-me', 't:F', '11-03')

    expect(run().map((row) => row.messageKey)).toEqual(['e:read-me'])
  })

  it('keeps the latest conversations, and of each its latest messages', () => {
    message('INBOX', 1, 'e:1', 't:A', '10-20')
    message('INBOX', 2, 'e:2', 't:A', '10-25')
    message('INBOX', 3, 'e:3', 't:A', '10-30')
    message('INBOX', 4, 'e:4', 't:B', '10-10')
    message('INBOX', 5, 'e:5', 't:C', '11-01')

    expect(run(2, 2).map((row) => `${row.threadId}:${row.messageKey}`)).toEqual([
      't:C:e:5',
      't:A:e:2',
      't:A:e:3'
    ])
  })

  it('reads the messages since the date by their index, never the whole account', () => {
    for (let index = 0; index < 50; index += 1) {
      message('INBOX', index + 1, `e:${index}`, `t:${index % 7}`, `10-${String(10 + (index % 20))}`)
    }

    const query = unnotedConversationsQuery('a', FOLDERS, SINCE, 300, 300)
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .all(...(query.params as Array<string | number>))
      .map((row) => String((row as { detail: string }).detail))

    // Sorting the account by key for the copies was the planner's first choice: every row read.
    expect(plan).toContainEqual(expect.stringMatching(/^SEARCH m USING .*idx_messages_folder_date/))
    expect(plan).not.toContainEqual(
      expect.stringMatching(/^(SCAN m\b|SEARCH m USING INDEX idx_messages_key)/)
    )
    expect(run()).toHaveLength(50)
  })
})
