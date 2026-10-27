import { Prisma, type PrismaClient } from '@prisma/client'

import {
  folderDisplayName,
  folderForRole,
  folderRole,
  folderRoleLabel,
  type FolderRole
} from '@shared/folders'
import type { MailAccount, MailAddress, MailFolder, MessageRef } from '@shared/models'

import { buildMessageSearchWhere } from '../services/database'
import { fullTextMatchExpression } from '../services/full-text-query'

/** What the Segretario asks of the mail when it searches. */
export interface AgentSearchQuery {
  text?: string
  /** Account addresses to search; all when empty. */
  accounts?: string[]
  /** A role (`arrivo`, `inviata`…) or a folder's name. */
  folder?: string
  from?: string
  to?: string
  unreadOnly?: boolean
  withAttachments?: boolean
  limit: number
}

export interface AgentSearchHit {
  ref: MessageRef
  messageKey: string
  threadId: string
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  date: string
  folderLabel: string
  accountEmail: string
  isRead: boolean
  hasAttachments: boolean
  /** Where the search matched, or the preview. */
  snippet: string
}

/** The words the agent may use for a folder's role. */
const ROLE_WORDS: Readonly<Record<string, FolderRole>> = {
  arrivo: '\\Inbox',
  'posta in arrivo': '\\Inbox',
  inbox: '\\Inbox',
  inviata: '\\Sent',
  'posta inviata': '\\Sent',
  inviati: '\\Sent',
  bozze: '\\Drafts',
  archivio: '\\Archive',
  cestino: '\\Trash',
  spam: '\\Junk'
}

/** A folder as the agent named it, as the user reads it: "arrivo" is Posta in arrivo. */
export function folderQueryLabel(folder: string): string {
  const role = ROLE_WORDS[folder.trim().toLowerCase()]
  return role ? folderRoleLabel(role) : folder.trim()
}

/**
 * Which row of a message to show when several folders hold it — a Gmail
 * message is in "Tutti i messaggi" and in the inbox: the folder the user
 * thinks of it in.
 */
function folderRank(folder: MailFolder | undefined): number {
  if (!folder) {
    return 9
  }

  switch (folderRole(folder)) {
    case '\\Inbox':
      return 0
    case '\\Sent':
      return 1
    case '\\Drafts':
      return 2
    case '\\Archive':
      return 4
    case '\\Junk':
      return 7
    case '\\Trash':
      return 8
    default:
      return folder.specialUse ? 5 : 3
  }
}

export interface SearchScope {
  /** Folder paths to look in, by account id. */
  mailboxes: Map<string, string[]>
  folders: Map<string, MailFolder[]>
  accountEmails: Map<string, string>
}

/**
 * Where a search looks: the accounts asked for (all by default), and in
 * each the folders the query names — by role or by name — or every folder
 * but Spam and the Trash.
 */
export function searchScope(
  accounts: ReadonlyArray<MailAccount>,
  foldersByAccount: ReadonlyMap<string, ReadonlyArray<MailFolder>>,
  query: Pick<AgentSearchQuery, 'accounts' | 'folder'>
): SearchScope {
  const wanted = (query.accounts ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean)
  const scope: SearchScope = { mailboxes: new Map(), folders: new Map(), accountEmails: new Map() }
  const folderQuery = query.folder?.trim().toLowerCase()
  const role = folderQuery ? ROLE_WORDS[folderQuery] : undefined

  for (const account of accounts) {
    if (wanted.length > 0 && !wanted.includes(account.email.toLowerCase())) {
      continue
    }

    const folders = [...(foldersByAccount.get(account.id) ?? [])]
    let paths: string[]

    if (role) {
      const folder = folderForRole(folders, role)
      paths = folder ? [folder.path] : []
    } else if (folderQuery) {
      paths = folders
        .filter(
          (folder) =>
            folder.path.toLowerCase() === folderQuery ||
            folder.name.toLowerCase() === folderQuery ||
            folderDisplayName(folder).toLowerCase() === folderQuery
        )
        .map((folder) => folder.path)
    } else {
      paths = folders
        .filter((folder) => {
          const folderRoleName = folderRole(folder)
          return folderRoleName !== '\\Junk' && folderRoleName !== '\\Trash'
        })
        .map((folder) => folder.path)
    }

    if (paths.length > 0) {
      scope.mailboxes.set(account.id, paths)
      scope.folders.set(account.id, folders)
      scope.accountEmails.set(account.id, account.email)
    }
  }

  return scope
}

interface HitRow {
  accountId: string
  folderPath: string
  uid: number | bigint
  messageKey: string
  threadId: string
  subject: string
  fromJson: string
  toJson: string
  ccJson: string
  dateIso: string
  isRead: number | bigint | boolean
  hasAttachments: number | bigint | boolean
  preview: string
  snippet: string | null
}

function parseAddresses(json: string): MailAddress[] {
  try {
    return JSON.parse(json) as MailAddress[]
  } catch {
    return []
  }
}

function scopeSql(scope: SearchScope): Prisma.Sql {
  return Prisma.join(
    [...scope.mailboxes].map(
      ([accountId, paths]) =>
        Prisma.sql`(m.account_id = ${accountId} AND m.folder_path IN (${Prisma.join(paths)}))`
    ),
    ' OR '
  )
}

function filterSql(query: AgentSearchQuery): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`1 = 1`]

  if (query.unreadOnly) {
    clauses.push(Prisma.sql`m.is_read = 0`)
  }

  if (query.withAttachments) {
    clauses.push(Prisma.sql`m.has_attachments = 1`)
  }

  if (query.from) {
    clauses.push(Prisma.sql`m.date_iso >= ${query.from}`)
  }

  if (query.to) {
    // The whole day of the end date is in.
    clauses.push(Prisma.sql`m.date_iso < ${`${query.to}T23:59:59.999Z`}`)
  }

  return Prisma.join(clauses, ' AND ')
}

/**
 * The Segretario's search: the full-text index over every message whose
 * text is stored, ranked by relevance (BM25, the subject and the people
 * weighing more than the body), and the envelopes of the messages not yet
 * indexed, so a message is never missed for not having been read yet. One
 * hit per message, shown in the folder the user thinks of it in.
 */
export async function searchMail(
  prisma: PrismaClient,
  scope: SearchScope,
  query: AgentSearchQuery
): Promise<AgentSearchHit[]> {
  if (scope.mailboxes.size === 0) {
    return []
  }

  const expression = fullTextMatchExpression(query.text)
  const overfetch = query.limit * 4
  let rows: HitRow[]

  if (expression) {
    const indexed = await prisma.$queryRaw<HitRow[]>`
      SELECT m.account_id AS accountId, m.folder_path AS folderPath, m.uid AS uid,
        m.message_key AS messageKey, m.thread_id AS threadId, m.subject AS subject,
        m.from_json AS fromJson, m.to_json AS toJson, m.cc_json AS ccJson, m.date_iso AS dateIso,
        m.is_read AS isRead, m.has_attachments AS hasAttachments, m.preview AS preview,
        snippet(message_fts, 3, '«', '»', '…', 16) AS snippet
      FROM message_fts
      JOIN message_bodies b ON b.id = message_fts.rowid
      JOIN messages m ON m.account_id = b.account_id AND m.message_key = b.message_key
      WHERE message_fts MATCH ${expression}
        AND (${scopeSql(scope)})
        AND ${filterSql(query)}
      ORDER BY bm25(message_fts, 6.0, 3.0, 2.0, 1.0), m.date_iso DESC
      LIMIT ${overfetch}
    `
    rows = [...indexed, ...(await unindexedMatches(prisma, scope, query))]
  } else {
    rows = await prisma.$queryRaw<HitRow[]>`
      SELECT m.account_id AS accountId, m.folder_path AS folderPath, m.uid AS uid,
        m.message_key AS messageKey, m.thread_id AS threadId, m.subject AS subject,
        m.from_json AS fromJson, m.to_json AS toJson, m.cc_json AS ccJson, m.date_iso AS dateIso,
        m.is_read AS isRead, m.has_attachments AS hasAttachments, m.preview AS preview,
        NULL AS snippet
      FROM messages m
      WHERE (${scopeSql(scope)}) AND ${filterSql(query)}
      ORDER BY m.date_iso DESC
      LIMIT ${overfetch}
    `
  }

  // One hit per message, in the order found, shown where the user knows it.
  const byKey = new Map<string, HitRow>()
  const order: string[] = []

  for (const row of rows) {
    const key = `${row.accountId}\u0000${row.messageKey}`
    const known = byKey.get(key)

    if (!known) {
      byKey.set(key, row)
      order.push(key)
    } else {
      const folders = scope.folders.get(row.accountId) ?? []
      const rank = (path: string): number =>
        folderRank(folders.find((folder) => folder.path === path))

      if (rank(row.folderPath) < rank(known.folderPath)) {
        byKey.set(key, { ...row, snippet: known.snippet ?? row.snippet })
      }
    }
  }

  return order.slice(0, query.limit).map((key) => {
    const row = byKey.get(key) as HitRow
    const folder = scope.folders.get(row.accountId)?.find((item) => item.path === row.folderPath)

    return {
      ref: { accountId: row.accountId, folderPath: row.folderPath, uid: Number(row.uid) },
      messageKey: row.messageKey,
      threadId: row.threadId,
      subject: row.subject,
      from: parseAddresses(row.fromJson),
      to: parseAddresses(row.toJson),
      cc: parseAddresses(row.ccJson),
      date: row.dateIso,
      folderLabel: folder ? folderDisplayName(folder) : row.folderPath,
      accountEmail: scope.accountEmails.get(row.accountId) ?? '',
      isRead: Boolean(Number(row.isRead)),
      hasAttachments: Boolean(Number(row.hasAttachments)),
      snippet: row.snippet ?? row.preview
    }
  })
}

/**
 * Messages not yet indexed whose envelope — subject, people, preview —
 * matches the query the way the app's own search matches it
 * (`buildMessageSearchWhere`): the indexer has not read them yet, but they
 * are not to be missed.
 */
async function unindexedMatches(
  prisma: PrismaClient,
  scope: SearchScope,
  query: AgentSearchQuery
): Promise<HitRow[]> {
  const where = buildMessageSearchWhere(query.text)

  if (!where) {
    return []
  }

  const rows = await prisma.message.findMany({
    where: {
      AND: [
        where,
        {
          OR: [...scope.mailboxes].map(([accountId, paths]) => ({
            accountId,
            folderPath: { in: paths }
          }))
        },
        ...(query.unreadOnly ? [{ isRead: false }] : []),
        ...(query.withAttachments ? [{ hasAttachments: true }] : []),
        ...(query.from ? [{ dateIso: { gte: query.from } }] : []),
        ...(query.to ? [{ dateIso: { lt: `${query.to}T23:59:59.999Z` } }] : [])
      ]
    },
    orderBy: { dateIso: 'desc' },
    take: query.limit * 4,
    select: {
      accountId: true,
      folderPath: true,
      uid: true,
      messageKey: true,
      threadId: true,
      subject: true,
      fromJson: true,
      toJson: true,
      ccJson: true,
      dateIso: true,
      isRead: true,
      hasAttachments: true,
      preview: true
    }
  })

  if (rows.length === 0) {
    return []
  }

  const indexed = new Set(
    (
      await prisma.messageBody.findMany({
        where: {
          OR: [...new Set(rows.map((row) => row.accountId))].map((accountId) => ({
            accountId,
            messageKey: {
              in: rows.filter((row) => row.accountId === accountId).map((row) => row.messageKey)
            }
          }))
        },
        select: { accountId: true, messageKey: true }
      })
    ).map((body) => `${body.accountId}\u0000${body.messageKey}`)
  )

  return rows
    .filter((row) => !indexed.has(`${row.accountId}\u0000${row.messageKey}`))
    .map((row) => ({ ...row, snippet: null }))
}

/**
 * The messages of a conversation, oldest first, one row per message — the
 * replies the user sent included, wherever they are filed.
 */
export async function threadMessages(
  prisma: PrismaClient,
  accountId: string,
  threadId: string,
  folders: ReadonlyArray<MailFolder>
): Promise<MessageRef[]> {
  const rows = await prisma.message.findMany({
    where: { accountId, threadId },
    select: { folderPath: true, uid: true, messageKey: true, dateIso: true },
    orderBy: { dateIso: 'asc' }
  })
  const byKey = new Map<string, (typeof rows)[number]>()

  for (const row of rows) {
    const known = byKey.get(row.messageKey)
    const rank = (path: string): number =>
      folderRank(folders.find((folder) => folder.path === path))

    if (!known || rank(row.folderPath) < rank(known.folderPath)) {
      byKey.set(row.messageKey, row)
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
    .map((row) => ({ accountId, folderPath: row.folderPath, uid: row.uid }))
}
