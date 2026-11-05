/** The folders of an account the Segretario reads, and its drafts' own. */
export interface ReadFolders {
  read: ReadonlyArray<string>
  drafts: ReadonlyArray<string>
}

/** A message of an account the Segretario has not read yet, in its conversation. */
export interface UnnotedMessage {
  folderPath: string
  uid: number
  messageKey: string
  threadId: string
  dateIso: string
  /** The date of the conversation's newest message not read yet. */
  newest: string
}

/**
 * The statement that finds an account's conversations with messages the
 * Segretario has written no note for — in `folders.read` (every folder
 * but the Trash, Spam and Bozze), since `sinceIso`, their text indexed,
 * never a draft, which Gmail lists in All Mail too — in one pass over the
 * messages since then: each message once whatever folders hold it, the
 * `threadLimit` conversations whose newest such message is newest, and of
 * each its `messageLimit` newest such messages. Rows come conversation by
 * conversation, the newest first, each oldest message first.
 */
export function unnotedConversationsQuery(
  accountId: string,
  folders: ReadFolders,
  sinceIso: string,
  threadLimit: number,
  messageLimit: number
): { sql: string; params: unknown[] } {
  const marks = (count: number): string => Array.from({ length: count }, () => '?').join(', ')
  const drafts = folders.drafts.length > 0 ? [...folders.drafts] : ['']

  return {
    sql: `
      WITH unnoted AS MATERIALIZED (
        SELECT m.folder_path AS folderPath, m.uid AS uid, m.message_key AS messageKey,
          m.thread_id AS threadId, m.date_iso AS dateIso
        FROM messages m
        WHERE m.account_id = ?
          AND m.folder_path IN (${marks(folders.read.length)})
          AND m.date_iso >= ?
          AND EXISTS (
            SELECT 1 FROM message_bodies b
            WHERE b.account_id = m.account_id AND b.message_key = m.message_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM ai_notes n
            WHERE n.account_id = m.account_id AND n.message_key = m.message_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM messages d
            WHERE d.account_id = m.account_id AND d.message_key = m.message_key
              AND d.folder_path IN (${marks(drafts.length)})
          )
      ),
      copies AS (
        SELECT folderPath, uid, messageKey, threadId, dateIso,
          ROW_NUMBER() OVER (PARTITION BY messageKey ORDER BY folderPath, uid) AS copy
        FROM unnoted
      ),
      messages_once AS (
        SELECT folderPath, uid, messageKey, threadId, dateIso,
          ROW_NUMBER() OVER (PARTITION BY threadId ORDER BY dateIso DESC, messageKey) AS position
        FROM copies
        WHERE copy = 1
      ),
      conversations AS (
        SELECT threadId, MAX(dateIso) AS newest
        FROM messages_once
        GROUP BY threadId
        ORDER BY newest DESC, threadId
        LIMIT ?
      )
      SELECT o.folderPath AS folderPath, o.uid AS uid, o.messageKey AS messageKey,
        o.threadId AS threadId, o.dateIso AS dateIso, c.newest AS newest
      FROM messages_once o
      JOIN conversations c ON c.threadId = o.threadId
      WHERE o.position <= ?
      ORDER BY c.newest DESC, o.threadId, o.dateIso ASC, o.messageKey
    `,
    params: [accountId, ...folders.read, sinceIso, ...drafts, threadLimit, messageLimit]
  }
}

/** The rows of `unnotedConversationsQuery` as they come back from SQLite. */
export function unnotedMessagesOf(
  rows: ReadonlyArray<Omit<UnnotedMessage, 'uid'> & { uid: number | bigint }>
): UnnotedMessage[] {
  return rows.map((row) => ({ ...row, uid: Number(row.uid) }))
}
