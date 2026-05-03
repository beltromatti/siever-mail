import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import extensionMain from '@app/extension/main'
import { logMainError } from '@main/utils/error-utils'
import type {
  DataStorageBreakdown,
  DataStorageSection,
  MailAccount,
  MailAddress,
  MailAttachment,
  MailAccountSignature,
  MailContactSuggestion,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  MessageRef
} from '@shared/models'

export interface StoredMailAccount extends MailAccount {
  encryptedSecret: string
}

export interface FolderSyncState {
  uidValidity?: bigint
  highestModseq?: bigint
  lastKnownUid?: number
  lastSyncedAt?: number
}

interface CreateAccountInput {
  id: string
  type: MailAccount['type']
  email: string
  displayName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  authType: MailAccount['authType']
  encryptedSecret: string
}

interface FolderPersistenceInput extends MailFolder {}
interface ContactSuggestionInput extends MailContactSuggestion {}

type MessagePersistenceInput = MailMessageSummary

const APP_PREFERENCES_SINGLETON_ID = 1
const CONTACT_SUGGESTION_QUERY_SCAN_LIMIT = 120

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function normalizeAccountIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedIds = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)

  return Array.from(new Set(normalizedIds))
}

function toNumber(value: bigint | number): number {
  return Number(value)
}

function toBigIntStringOrNull(value: bigint | undefined): string | null {
  return typeof value === 'bigint' ? value.toString() : null
}

function fromBigIntString(value: string | null | undefined): bigint | undefined {
  if (!value) {
    return undefined
  }

  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

function toFiniteNonNegativeNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  return 0
}

function normalizeMessageSearchQuery(query?: string): string | null {
  const normalized = (query || '').trim()
  return normalized ? normalized : null
}

function buildMessageSearchWhere(query?: string): Prisma.MessageWhereInput | null {
  const normalizedQuery = normalizeMessageSearchQuery(query)

  if (!normalizedQuery) {
    return null
  }

  return {
    OR: [
      { subject: { contains: normalizedQuery } },
      { preview: { contains: normalizedQuery } },
      { fromJson: { contains: normalizedQuery } },
      { toJson: { contains: normalizedQuery } },
      { ccJson: { contains: normalizedQuery } },
      { bccJson: { contains: normalizedQuery } },
      { textBody: { contains: normalizedQuery } },
      { htmlBody: { contains: normalizedQuery } }
    ]
  }
}

function normalizeStorageSectionSizesToTotal(
  sections: DataStorageSection[],
  targetTotalBytes: number
): DataStorageSection[] {
  if (sections.length === 0) {
    return sections
  }

  const safeTargetTotal = Math.max(0, Math.floor(targetTotalBytes))
  const currentTotal = sections.reduce(
    (total, section) => total + Math.max(0, section.sizeBytes),
    0
  )

  if (safeTargetTotal === 0 || currentTotal <= 0) {
    return sections.map((section) => ({ ...section, sizeBytes: 0 }))
  }

  const scaled = sections.map((section) => {
    const exact = (Math.max(0, section.sizeBytes) / currentTotal) * safeTargetTotal
    const floor = Math.floor(exact)

    return {
      ...section,
      sizeBytes: floor,
      _fraction: exact - floor
    }
  })

  let remaining = safeTargetTotal - scaled.reduce((total, section) => total + section.sizeBytes, 0)

  if (remaining > 0) {
    scaled.sort((left, right) => right._fraction - left._fraction)

    for (let index = 0; index < scaled.length && remaining > 0; index += 1) {
      scaled[index].sizeBytes += 1
      remaining -= 1
    }
  }

  return scaled
    .map((section) => ({
      id: section.id,
      label: section.label,
      kind: section.kind,
      sizeBytes: section.sizeBytes
    }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
}

function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeContactName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function sanitizeContactName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined
  }

  const normalized = name.trim().replace(/\s+/g, ' ')

  if (!normalized) {
    return undefined
  }

  return normalized
}

function isLikelyValidEmail(value: string): boolean {
  if (!value || value.includes(' ')) {
    return false
  }

  const atIndex = value.indexOf('@')
  if (atIndex <= 0 || atIndex !== value.lastIndexOf('@')) {
    return false
  }

  const domainPart = value.slice(atIndex + 1)
  return domainPart.includes('.')
}

function buildContactSuggestionInput(
  email: string | undefined,
  name?: string
): ContactSuggestionInput | null {
  if (!email) {
    return null
  }

  const trimmedEmail = email.trim()
  const normalizedEmail = normalizeContactEmail(trimmedEmail)

  if (!isLikelyValidEmail(normalizedEmail)) {
    return null
  }

  return {
    email: normalizedEmail,
    name: sanitizeContactName(name)
  }
}

function extractContactSuggestionsFromAddresses(
  addresses: MailAddress[]
): ContactSuggestionInput[] {
  return addresses
    .map((address) => buildContactSuggestionInput(address.address, address.name))
    .filter((address): address is ContactSuggestionInput => Boolean(address))
}

function extractContactSuggestionsFromUnknownAddresses(
  addresses: unknown[]
): ContactSuggestionInput[] {
  const suggestions: ContactSuggestionInput[] = []

  for (const address of addresses) {
    if (!address || typeof address !== 'object') {
      continue
    }

    const candidate = address as { address?: unknown; name?: unknown }
    const email = typeof candidate.address === 'string' ? candidate.address : undefined
    const name = typeof candidate.name === 'string' ? candidate.name : undefined
    const suggestion = buildContactSuggestionInput(email, name)

    if (suggestion) {
      suggestions.push(suggestion)
    }
  }

  return suggestions
}

function collapseContactSuggestions(
  suggestions: ContactSuggestionInput[]
): ContactSuggestionInput[] {
  const uniqueByEmail = new Map<string, ContactSuggestionInput>()

  for (const suggestion of suggestions) {
    const normalized = buildContactSuggestionInput(suggestion.email, suggestion.name)

    if (!normalized) {
      continue
    }

    const existing = uniqueByEmail.get(normalized.email)

    if (!existing) {
      uniqueByEmail.set(normalized.email, normalized)
      continue
    }

    if (!existing.name && normalized.name) {
      uniqueByEmail.set(normalized.email, normalized)
    }
  }

  return [...uniqueByEmail.values()]
}

function folderPriority(folder: Pick<MailFolder, 'specialUse'>): number {
  if (folder.specialUse === '\\Inbox') {
    return 0
  }

  if (folder.specialUse === '\\Sent') {
    return 1
  }

  if (folder.specialUse === '\\Drafts') {
    return 2
  }

  if (folder.specialUse === '\\Trash') {
    return 3
  }

  if (folder.specialUse === '\\Junk') {
    return 4
  }

  if (folder.specialUse === '\\Archive') {
    return 5
  }

  return 6
}

function toSqliteUrl(filePath: string): string {
  return `file:${resolve(filePath)}`
}

function mapFolderRow(row: {
  id: string
  accountId: string
  path: string
  name: string
  delimiter: string | null
  specialUse: string | null
  messageCount: number
  unseenCount: number
  lastSyncedAt: bigint | null
}): MailFolder {
  return {
    id: row.id,
    accountId: row.accountId,
    path: row.path,
    name: row.name,
    delimiter: row.delimiter ?? undefined,
    specialUse: row.specialUse ?? undefined,
    messageCount: row.messageCount,
    unseenCount: row.unseenCount,
    lastSyncedAt: row.lastSyncedAt ? toNumber(row.lastSyncedAt) : undefined
  }
}

export class AppDatabase {
  private readonly prisma: PrismaClient
  private readonly ready: Promise<void>
  private contactSuggestionsSeeded = false
  private contactSuggestionSeedInFlight: Promise<void> | null = null
  private readonly queuedContactSuggestions = new Map<string, ContactSuggestionInput>()
  private queuedContactSuggestionsFlushTimer: ReturnType<typeof setTimeout> | null = null
  private queuedContactSuggestionsFlushInFlight: Promise<void> | null = null

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true })

    const adapter = new PrismaBetterSqlite3({
      url: toSqliteUrl(filePath)
    })

    this.prisma = new PrismaClient({ adapter })
    this.ready = this.initialize()
  }

  /**
   * Raw SQL escape hatch for extensions. The extension owns the schema
   * for its own tables; the host's only job is to share the SQLite
   * connection so the writes participate in the same WAL.
   */
  async runRawSql(sql: string, params: unknown[] = []): Promise<void> {
    await this.ready
    await this.prisma.$executeRawUnsafe(sql, ...params)
  }

  async runRawSqlQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ready
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...params)
  }

  async getAccounts(): Promise<MailAccount[]> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT
        id,
        type,
        email,
        display_name AS displayName,
        imap_host AS imapHost,
        imap_port AS imapPort,
        imap_secure AS imapSecure,
        smtp_host AS smtpHost,
        smtp_port AS smtpPort,
        smtp_secure AS smtpSecure,
        username,
        auth_type AS authType,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM accounts
      ORDER BY
        CASE WHEN last_viewed_at IS NULL THEN 1 ELSE 0 END ASC,
        last_viewed_at DESC,
        created_at ASC
    `) as Array<{
      id: string
      type: string
      email: string
      displayName: string
      imapHost: string
      imapPort: number
      imapSecure: boolean
      smtpHost: string
      smtpPort: number
      smtpSecure: boolean
      username: string
      authType: string
      createdAt: bigint
      updatedAt: bigint
    }>

    return rows.map((row) => this.mapAccountRow(row))
  }

  async listAccountSignatures(): Promise<MailAccountSignature[]> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT account_id AS accountId, html AS html, updated_at AS updatedAt
      FROM account_signatures
      ORDER BY updated_at DESC
    `) as Array<{ accountId: string; html: string; updatedAt: bigint }>

    return rows
      .filter((row) => typeof row.accountId === 'string' && typeof row.html === 'string')
      .map((row) => ({
        accountId: row.accountId,
        html: row.html,
        updatedAt: toNumber(row.updatedAt)
      }))
  }

  async getAccountSignature(accountId: string): Promise<MailAccountSignature | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT account_id AS accountId, html AS html, updated_at AS updatedAt
      FROM account_signatures
      WHERE account_id = ${accountId}
      LIMIT 1
    `) as Array<{ accountId: string; html: string; updatedAt: bigint }>
    const row = rows[0]

    if (!row || typeof row.accountId !== 'string' || typeof row.html !== 'string') {
      return null
    }

    return {
      accountId: row.accountId,
      html: row.html,
      updatedAt: toNumber(row.updatedAt)
    }
  }

  async setAccountSignature(
    accountId: string,
    html: string | null
  ): Promise<MailAccountSignature | null> {
    await this.ready

    const now = BigInt(Date.now())
    const persistedHtml = html ?? ''

    await this.prisma.$executeRaw`
      INSERT INTO account_signatures(account_id, html, updated_at)
      VALUES (${accountId}, ${persistedHtml}, ${now})
      ON CONFLICT(account_id) DO UPDATE SET
        html = excluded.html,
        updated_at = excluded.updated_at
    `

    if (!persistedHtml) {
      return null
    }

    return {
      accountId,
      html: persistedHtml,
      updatedAt: toNumber(now)
    }
  }

  async getDataStorageBreakdown(): Promise<DataStorageBreakdown> {
    await this.ready

    const accounts = await this.prisma.account.findMany({
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        id: true,
        email: true,
        displayName: true
      }
    })

    const accountEstimateRows = (await this.prisma.$queryRawUnsafe(`
      SELECT account_id AS accountId, COALESCE(SUM(estimated_bytes), 0) AS bytes
      FROM (
        SELECT
          id AS account_id,
          (
            LENGTH(id) +
            LENGTH(type) +
            LENGTH(email) +
            LENGTH(display_name) +
            LENGTH(imap_host) +
            LENGTH(smtp_host) +
            LENGTH(username) +
            LENGTH(auth_type) +
            LENGTH(encrypted_secret) +
            64
          ) AS estimated_bytes
        FROM accounts
        UNION ALL
        SELECT
          account_id,
          (
            LENGTH(id) +
            LENGTH(path) +
            LENGTH(name) +
            LENGTH(COALESCE(delimiter, '')) +
            LENGTH(COALESCE(special_use, '')) +
            48
          ) AS estimated_bytes
        FROM folders
        UNION ALL
        SELECT
          account_id,
          (
            LENGTH(id) +
            LENGTH(folder_path) +
            LENGTH(COALESCE(thread_id, '')) +
            LENGTH(COALESCE(message_id, '')) +
            LENGTH(subject) +
            LENGTH(from_json) +
            LENGTH(to_json) +
            LENGTH(cc_json) +
            LENGTH(bcc_json) +
            LENGTH(date_iso) +
            LENGTH(preview) +
            LENGTH(flags_json) +
            LENGTH(COALESCE(html_body, '')) +
            LENGTH(COALESCE(text_body, '')) +
            LENGTH(attachments_json) +
            96
          ) AS estimated_bytes
        FROM messages
        UNION ALL
        SELECT
          account_id,
          (
            LENGTH(account_id) +
            LENGTH(html) +
            32
          ) AS estimated_bytes
        FROM account_signatures
      ) account_scoped
      GROUP BY account_id
    `)) as Array<{ accountId?: string | null; bytes?: bigint | number | string | null }>

    const globalEstimateRows = (await this.prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(estimated_bytes), 0) AS bytes
      FROM (
        SELECT
          (
            LENGTH(email_normalized) +
            LENGTH(email_address) +
            LENGTH(COALESCE(display_name, '')) +
            LENGTH(COALESCE(name_normalized, '')) +
            40
          ) AS estimated_bytes
        FROM contacts
      ) global_scoped
    `)) as Array<{ bytes?: bigint | number | string | null }>

    const pageCountRow = (await this.prisma.$queryRawUnsafe('PRAGMA page_count')) as Array<{
      page_count?: bigint | number | string | null
    }>
    const pageSizeRow = (await this.prisma.$queryRawUnsafe('PRAGMA page_size')) as Array<{
      page_size?: bigint | number | string | null
    }>

    const accountBytesById = new Map<string, number>()

    for (const row of accountEstimateRows) {
      const accountId = (row.accountId || '').trim()

      if (!accountId) {
        continue
      }

      accountBytesById.set(accountId, toFiniteNonNegativeNumber(row.bytes))
    }

    const sections: DataStorageSection[] = accounts.map((account) => ({
      id: account.id,
      label: account.displayName || account.email,
      kind: 'account',
      sizeBytes: accountBytesById.get(account.id) ?? 0
    }))

    sections.push({
      id: 'global-data',
      label: 'Dati globali',
      kind: 'global',
      sizeBytes: toFiniteNonNegativeNumber(globalEstimateRows[0]?.bytes)
    })

    const estimatedTotalBytes = sections.reduce((total, section) => total + section.sizeBytes, 0)
    const pageCount = toFiniteNonNegativeNumber(pageCountRow[0]?.page_count)
    const pageSize = toFiniteNonNegativeNumber(pageSizeRow[0]?.page_size)
    const dbTotalBytes = Math.max(0, Math.floor(pageCount * pageSize))

    if (dbTotalBytes > 0) {
      const normalizedSections =
        estimatedTotalBytes > 0
          ? normalizeStorageSectionSizesToTotal(sections, dbTotalBytes)
          : [
              {
                id: 'global-data',
                label: 'Dati globali',
                kind: 'global' as const,
                sizeBytes: dbTotalBytes
              }
            ]

      return {
        totalBytes: dbTotalBytes,
        sections: normalizedSections
      }
    }

    return {
      totalBytes: estimatedTotalBytes,
      sections: [...sections].sort((left, right) => right.sizeBytes - left.sizeBytes)
    }
  }

  async clearAccountData(accountId: string): Promise<void> {
    await this.ready

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({
        where: {
          accountId
        }
      }),
      this.prisma.folder.deleteMany({
        where: {
          accountId
        }
      }),
      this.prisma.$executeRaw`
        DELETE FROM account_signatures
        WHERE account_id = ${accountId}
      `
    ])

    // Checkpoint + VACUUM the same way clearAllDataKeepAccounts does: SQLite
    // keeps deleted rows' pages as reusable "free pages" and never returns
    // their bytes to the OS until VACUUM rewrites the file. Without this, the
    // Settings > Dati breakdown (which normalises per-account sizes against
    // PRAGMA page_count × page_size) would misattribute the freed pages to
    // "Dati globali" until the account's bootstrap refills them — looks like
    // the data wasn't actually deleted, even though it was.
    await this.prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
    await this.prisma.$executeRawUnsafe('VACUUM')
  }

  async clearAllDataKeepAccounts(): Promise<void> {
    await this.ready
    const now = BigInt(Date.now())

    await this.prisma.$transaction([
      this.prisma.message.deleteMany(),
      this.prisma.folder.deleteMany(),
      this.prisma.contact.deleteMany(),
      this.prisma.$executeRaw`DELETE FROM account_signatures`,
      // Reset the singleton row of app preferences (unified inbox toggle)
      // back to its empty state. Extensions own their own tables and are
      // expected to clear themselves via their own IPC handlers when the
      // user requests it.
      this.prisma.$executeRaw`
        UPDATE app_preferences
        SET unified_inbox_included_account_ids = NULL,
            updated_at = ${now}
        WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
      `
    ])

    await this.prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
    await this.prisma.$executeRawUnsafe('VACUUM')
  }

  async getStoredAccountById(accountId: string): Promise<StoredMailAccount | null> {
    await this.ready

    const row = await this.prisma.account.findUnique({
      where: {
        id: accountId
      }
    })

    if (!row) {
      return null
    }

    return {
      ...this.mapAccountRow(row),
      encryptedSecret: row.encryptedSecret
    }
  }

  private async getDefaultSignatureHtmlForNewAccount(
    tx: Prisma.TransactionClient
  ): Promise<string> {
    const existingAccounts = (await tx.$queryRaw`
      SELECT id AS id
      FROM accounts
      ORDER BY created_at ASC
      LIMIT 1
    `) as Array<{ id: string }>
    const firstAccountId = existingAccounts[0]?.id

    if (typeof firstAccountId === 'string' && firstAccountId) {
      const signatureRows = (await tx.$queryRaw`
        SELECT html AS html
        FROM account_signatures
        WHERE account_id = ${firstAccountId}
        LIMIT 1
      `) as Array<{ html: string }>

      return typeof signatureRows[0]?.html === 'string' ? signatureRows[0].html : ''
    }

    return extensionMain.defaultAccountSignatureHtml
  }

  async createAccount(input: CreateAccountInput): Promise<MailAccount> {
    await this.ready

    const now = BigInt(Date.now())

    const created = await this.prisma.$transaction(async (tx) => {
      const defaultSignatureHtml = await this.getDefaultSignatureHtmlForNewAccount(tx)
      const account = await tx.account.create({
        data: {
          id: input.id,
          type: input.type,
          email: input.email,
          displayName: input.displayName,
          imapHost: input.imapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
          smtpHost: input.smtpHost,
          smtpPort: input.smtpPort,
          smtpSecure: input.smtpSecure,
          username: input.username,
          authType: input.authType,
          encryptedSecret: input.encryptedSecret,
          createdAt: now,
          updatedAt: now
        }
      })

      await tx.$executeRaw`
        INSERT INTO account_signatures(account_id, html, updated_at)
        VALUES (${account.id}, ${defaultSignatureHtml}, ${now})
        ON CONFLICT(account_id) DO NOTHING
      `

      return account
    })

    return this.mapAccountRow(created)
  }

  async markAccountLastViewed(accountId: string, lastViewedAt = Date.now()): Promise<void> {
    await this.ready

    await this.prisma.$executeRaw`
      UPDATE accounts
      SET last_viewed_at = ${lastViewedAt}
      WHERE id = ${accountId}
    `
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.ready

    await this.prisma.account.deleteMany({
      where: {
        id: accountId
      }
    })
  }

  async replaceFolders(accountId: string, folders: FolderPersistenceInput[]): Promise<void> {
    await this.ready

    const now = BigInt(Date.now())
    const folderPaths = folders.map((folder) => folder.path)

    await this.prisma.$transaction(async (tx) => {
      if (folderPaths.length === 0) {
        await tx.folder.deleteMany({
          where: {
            accountId
          }
        })
        return
      }

      await Promise.all(
        folders.map(async (folder) => {
          await tx.folder.upsert({
            where: {
              accountId_path: {
                accountId,
                path: folder.path
              }
            },
            create: {
              id: folder.id,
              accountId,
              path: folder.path,
              name: folder.name,
              delimiter: folder.delimiter ?? null,
              specialUse: folder.specialUse ?? null,
              messageCount: folder.messageCount,
              unseenCount: folder.unseenCount,
              lastSyncedAt: folder.lastSyncedAt ? BigInt(folder.lastSyncedAt) : null,
              updatedAt: now
            },
            update: {
              id: folder.id,
              name: folder.name,
              delimiter: folder.delimiter ?? null,
              specialUse: folder.specialUse ?? null,
              messageCount: folder.messageCount,
              unseenCount: folder.unseenCount,
              updatedAt: now
            }
          })
        })
      )

      await tx.folder.deleteMany({
        where: {
          accountId,
          path: {
            notIn: folderPaths
          }
        }
      })

      await tx.message.deleteMany({
        where: {
          accountId,
          folderPath: {
            notIn: folderPaths
          }
        }
      })
    })
  }

  async listFolders(accountId: string): Promise<MailFolder[]> {
    await this.ready

    const rows = await this.prisma.folder.findMany({
      where: {
        accountId
      }
    })

    return rows
      .map((row) => mapFolderRow(row))
      .sort((a, b) => {
        const priorityDiff = folderPriority(a) - folderPriority(b)

        if (priorityDiff !== 0) {
          return priorityDiff
        }

        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
  }

  async getFolder(accountId: string, folderPath: string): Promise<MailFolder | null> {
    await this.ready

    const row = await this.prisma.folder.findUnique({
      where: {
        accountId_path: {
          accountId,
          path: folderPath
        }
      }
    })

    return row ? mapFolderRow(row) : null
  }

  async getFolderSyncState(accountId: string, folderPath: string): Promise<FolderSyncState | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT uid_validity AS uidValidity, highest_modseq AS highestModseq, last_known_uid AS lastKnownUid, last_synced_at AS lastSyncedAt
      FROM folders
      WHERE account_id = ${accountId} AND path = ${folderPath}
      LIMIT 1
    `) as Array<{
      uidValidity: string | null
      highestModseq: string | null
      lastKnownUid: number | null
      lastSyncedAt: bigint | null
    }>

    const row = rows[0]

    if (!row) {
      return null
    }

    return {
      uidValidity: fromBigIntString(row.uidValidity),
      highestModseq: fromBigIntString(row.highestModseq),
      lastKnownUid: row.lastKnownUid ?? undefined,
      lastSyncedAt: row.lastSyncedAt ? toNumber(row.lastSyncedAt) : undefined
    }
  }

  async updateFolderSyncState(
    accountId: string,
    folderPath: string,
    state: {
      uidValidity?: bigint
      highestModseq?: bigint
      lastKnownUid?: number
      lastSyncedAt?: number
    }
  ): Promise<void> {
    await this.ready

    const uidValidity = toBigIntStringOrNull(state.uidValidity)
    const highestModseq = toBigIntStringOrNull(state.highestModseq)
    const lastKnownUid = state.lastKnownUid ?? null
    const lastSyncedAt = typeof state.lastSyncedAt === 'number' ? BigInt(state.lastSyncedAt) : null
    const now = BigInt(Date.now())

    await this.prisma.$executeRaw`
      UPDATE folders
      SET uid_validity = COALESCE(${uidValidity}, uid_validity),
          highest_modseq = COALESCE(${highestModseq}, highest_modseq),
          last_known_uid = COALESCE(${lastKnownUid}, last_known_uid),
          last_synced_at = COALESCE(${lastSyncedAt}, last_synced_at),
          updated_at = ${now}
      WHERE account_id = ${accountId} AND path = ${folderPath}
    `
  }

  async resetFolderSyncState(accountId: string, folderPath: string): Promise<void> {
    await this.ready

    const now = BigInt(Date.now())

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({
        where: { accountId, folderPath }
      }),
      this.prisma.$executeRaw`
        UPDATE folders
        SET uid_validity = NULL,
            highest_modseq = NULL,
            last_known_uid = NULL,
            last_synced_at = NULL,
            updated_at = ${now}
        WHERE account_id = ${accountId} AND path = ${folderPath}
      `
    ])
  }

  async updateFolderCounts(
    accountId: string,
    folderPath: string,
    messageCount: number,
    unseenCount: number
  ): Promise<void> {
    await this.ready

    await this.prisma.folder.updateMany({
      where: {
        accountId,
        path: folderPath
      },
      data: {
        messageCount,
        unseenCount,
        updatedAt: BigInt(Date.now())
      }
    })
  }

  async upsertContactSuggestions(suggestions: ContactSuggestionInput[]): Promise<void> {
    await this.ready

    const collapsedSuggestions = collapseContactSuggestions(suggestions)

    if (collapsedSuggestions.length === 0) {
      return
    }

    await this.insertMissingContactSuggestions(collapsedSuggestions)
  }

  queueContactSuggestions(suggestions: ContactSuggestionInput[]): void {
    const collapsedSuggestions = collapseContactSuggestions(suggestions)

    if (collapsedSuggestions.length === 0) {
      return
    }

    for (const suggestion of collapsedSuggestions) {
      const existing = this.queuedContactSuggestions.get(suggestion.email)

      if (!existing || (!existing.name && suggestion.name)) {
        this.queuedContactSuggestions.set(suggestion.email, suggestion)
      }
    }

    if (this.queuedContactSuggestionsFlushTimer !== null) {
      return
    }

    this.queuedContactSuggestionsFlushTimer = setTimeout(() => {
      this.queuedContactSuggestionsFlushTimer = null
      void this.flushQueuedContactSuggestions()
    }, 150)
  }

  async ensureContactSuggestionsSeeded(): Promise<void> {
    await this.ready

    if (this.contactSuggestionsSeeded) {
      return
    }

    const pendingSeed = this.contactSuggestionSeedInFlight

    if (pendingSeed) {
      await pendingSeed
      return
    }

    const seedPromise = (async () => {
      const existingContacts = await this.prisma.contact.count()

      if (existingContacts > 0) {
        this.contactSuggestionsSeeded = true
        return
      }

      const messages = await this.prisma.message.findMany({
        select: {
          fromJson: true,
          toJson: true,
          ccJson: true,
          bccJson: true
        }
      })
      const suggestions: ContactSuggestionInput[] = []

      for (const message of messages) {
        suggestions.push(
          ...extractContactSuggestionsFromAddresses(parseJsonArray<MailAddress>(message.fromJson)),
          ...extractContactSuggestionsFromAddresses(parseJsonArray<MailAddress>(message.toJson)),
          ...extractContactSuggestionsFromAddresses(parseJsonArray<MailAddress>(message.ccJson)),
          ...extractContactSuggestionsFromUnknownAddresses(parseJsonArray(message.bccJson))
        )
      }

      if (suggestions.length > 0) {
        await this.insertMissingContactSuggestions(collapseContactSuggestions(suggestions))
      }

      this.contactSuggestionsSeeded = true
    })()

    this.contactSuggestionSeedInFlight = seedPromise

    try {
      await seedPromise
    } finally {
      if (this.contactSuggestionSeedInFlight === seedPromise) {
        this.contactSuggestionSeedInFlight = null
      }
    }
  }

  async listContactSuggestions(query: string, limit: number): Promise<MailContactSuggestion[]> {
    await this.ready

    const normalizedEmailQuery = normalizeContactEmail(query)
    const normalizedNameQuery = normalizeContactName(query)
    const hasEmailQuery = Boolean(normalizedEmailQuery)
    const hasNameQuery = Boolean(normalizedNameQuery)

    if (!hasEmailQuery && !hasNameQuery) {
      return []
    }

    const normalizedLimit = Math.max(1, Math.floor(limit))
    const orFilters: Array<{
      emailNormalized?: { contains: string }
      nameNormalized?: { contains: string }
    }> = []

    if (hasEmailQuery) {
      orFilters.push({
        emailNormalized: {
          contains: normalizedEmailQuery
        }
      })
    }

    if (hasNameQuery) {
      orFilters.push({
        nameNormalized: {
          contains: normalizedNameQuery
        }
      })
    }

    const candidates = await this.prisma.contact.findMany({
      where: {
        OR: orFilters
      },
      orderBy: [{ usageCount: 'desc' }, { lastUsedAt: 'desc' }],
      take: Math.max(normalizedLimit * 4, CONTACT_SUGGESTION_QUERY_SCAN_LIMIT)
    })

    return candidates
      .map((candidate) => {
        const emailScore =
          hasEmailQuery && candidate.emailNormalized.startsWith(normalizedEmailQuery)
            ? 100
            : hasEmailQuery && candidate.emailNormalized.includes(normalizedEmailQuery)
              ? 40
              : 0
        const nameNormalized = candidate.nameNormalized ?? ''
        const nameScore =
          hasNameQuery && nameNormalized.startsWith(normalizedNameQuery)
            ? 80
            : hasNameQuery && nameNormalized.includes(normalizedNameQuery)
              ? 30
              : 0

        return {
          score: emailScore + nameScore + Math.min(candidate.usageCount, 50),
          usageCount: candidate.usageCount,
          lastUsedAt: toNumber(candidate.lastUsedAt),
          value: {
            email: candidate.emailAddress,
            name: candidate.displayName ?? undefined
          } satisfies MailContactSuggestion
        }
      })
      .sort((left, right) => {
        const scoreDiff = right.score - left.score

        if (scoreDiff !== 0) {
          return scoreDiff
        }

        const usageDiff = right.usageCount - left.usageCount

        if (usageDiff !== 0) {
          return usageDiff
        }

        return right.lastUsedAt - left.lastUsedAt
      })
      .slice(0, normalizedLimit)
      .map((entry) => entry.value)
  }

  private async insertMissingContactSuggestions(
    suggestions: ContactSuggestionInput[]
  ): Promise<void> {
    if (suggestions.length === 0) {
      return
    }

    const normalizedEmails = suggestions.map((suggestion) => suggestion.email)
    const existingContacts = await this.prisma.contact.findMany({
      where: {
        emailNormalized: {
          in: normalizedEmails
        }
      },
      select: {
        emailNormalized: true
      }
    })
    const existingEmails = new Set(existingContacts.map((contact) => contact.emailNormalized))
    const newContacts = suggestions.filter((suggestion) => !existingEmails.has(suggestion.email))

    if (newContacts.length === 0) {
      return
    }

    const now = BigInt(Date.now())

    await this.prisma.contact.createMany({
      data: newContacts.map((contact) => ({
        emailNormalized: contact.email,
        emailAddress: contact.email,
        displayName: contact.name ?? null,
        nameNormalized: contact.name ? normalizeContactName(contact.name) : null,
        usageCount: 1,
        lastUsedAt: now,
        updatedAt: now
      }))
    })
  }

  private async flushQueuedContactSuggestions(): Promise<void> {
    if (this.queuedContactSuggestionsFlushInFlight) {
      await this.queuedContactSuggestionsFlushInFlight
      return
    }

    const flushPromise = (async () => {
      while (this.queuedContactSuggestions.size > 0) {
        const batch = [...this.queuedContactSuggestions.values()]
        this.queuedContactSuggestions.clear()

        try {
          await this.insertMissingContactSuggestions(batch)
        } catch (error) {
          for (const suggestion of batch) {
            const existing = this.queuedContactSuggestions.get(suggestion.email)

            if (!existing || (!existing.name && suggestion.name)) {
              this.queuedContactSuggestions.set(suggestion.email, suggestion)
            }
          }

          logMainError('Background contact suggestion flush failed', error, {
            pendingSuggestions: batch.length
          })
          return
        }
      }
    })()

    this.queuedContactSuggestionsFlushInFlight = flushPromise

    try {
      await flushPromise
    } finally {
      if (this.queuedContactSuggestionsFlushInFlight === flushPromise) {
        this.queuedContactSuggestionsFlushInFlight = null
      }
    }
  }

  async getUnifiedInboxIncludedAccountIds(): Promise<string[] | null> {
    await this.ready

    const rows = (await this.prisma.$queryRaw`
      SELECT unified_inbox_included_account_ids AS includedAccountIds
      FROM app_preferences
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
      LIMIT 1
    `) as Array<{ includedAccountIds?: unknown }>
    const row = rows[0]

    if (!row || typeof row.includedAccountIds !== 'string' || !row.includedAccountIds.trim()) {
      return null
    }

    try {
      const parsed = JSON.parse(row.includedAccountIds) as unknown
      return normalizeAccountIdList(parsed)
    } catch {
      return null
    }
  }

  async setUnifiedInboxIncludedAccountIds(accountIds: string[]): Promise<void> {
    await this.ready

    const normalizedIds = normalizeAccountIdList(accountIds)
    const now = Date.now()

    await this.prisma.$executeRaw`
      UPDATE app_preferences
      SET unified_inbox_included_account_ids = ${JSON.stringify(normalizedIds)},
          updated_at = ${now}
      WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
    `
  }

  async upsertMessageSummaries(
    accountId: string,
    folderPath: string,
    messages: MessagePersistenceInput[]
  ): Promise<{ added: MailMessageSummary[]; updated: MailMessageSummary[] }> {
    await this.ready

    const result = { added: [] as MailMessageSummary[], updated: [] as MailMessageSummary[] }

    if (messages.length === 0) {
      return result
    }

    const uids = messages.map((message) => message.uid)
    const existingRows = await this.prisma.message.findMany({
      where: {
        accountId,
        folderPath,
        uid: { in: uids }
      },
      select: {
        uid: true,
        messageId: true,
        subject: true,
        preview: true,
        previewHydrated: true,
        isRead: true,
        dateIso: true,
        fromJson: true,
        hasAttachments: true
      }
    })

    const existingByUid = new Map(existingRows.map((row) => [row.uid, row]))
    const contactSuggestions: ContactSuggestionInput[] = []
    const now = BigInt(Date.now())

    await this.prisma.$transaction(
      messages.map((message) => {
        const existing = existingByUid.get(message.uid) || null

        contactSuggestions.push(
          ...extractContactSuggestionsFromAddresses(message.from),
          ...extractContactSuggestionsFromAddresses(message.to),
          ...extractContactSuggestionsFromAddresses(message.cc)
        )

        const create = {
          id: this.makeMessagePrimaryId(accountId, folderPath, message.uid),
          accountId,
          folderPath,
          uid: message.uid,
          threadId: message.threadId ?? null,
          messageId: message.messageId ?? null,
          subject: message.subject,
          fromJson: JSON.stringify(message.from),
          toJson: JSON.stringify(message.to),
          ccJson: JSON.stringify(message.cc),
          bccJson: '[]',
          dateIso: message.date,
          preview: message.preview,
          previewHydrated: message.previewHydrated,
          flagsJson: JSON.stringify(message.flags),
          isRead: message.isRead,
          hasAttachments: message.hasAttachments,
          size: message.size,
          htmlBody: null,
          textBody: null,
          attachmentsJson: '[]',
          updatedAt: now
        }
        // Never overwrite an already-hydrated preview with an envelope-only write.
        // The envelope phase doesn't know the preview (incoming messages come in
        // with `previewHydrated: false, preview: ''`), so if the row already has
        // a good preview we keep it. This keeps the per-row state monotonic.
        const keepExistingPreview = existing?.previewHydrated === true && !message.previewHydrated
        const update = {
          threadId: message.threadId ?? null,
          messageId: message.messageId ?? null,
          subject: message.subject,
          fromJson: JSON.stringify(message.from),
          toJson: JSON.stringify(message.to),
          ccJson: JSON.stringify(message.cc),
          dateIso: message.date,
          preview: keepExistingPreview ? existing!.preview : message.preview,
          previewHydrated: keepExistingPreview ? true : message.previewHydrated,
          flagsJson: JSON.stringify(message.flags),
          isRead: message.isRead,
          hasAttachments: message.hasAttachments,
          size: message.size,
          updatedAt: now
        }

        if (existing) {
          result.updated.push({
            ...message,
            preview: update.preview,
            previewHydrated: update.previewHydrated
          })
        } else {
          result.added.push(message)
        }

        return this.prisma.message.upsert({
          where: {
            accountId_folderPath_uid: {
              accountId,
              folderPath,
              uid: message.uid
            }
          },
          create,
          update
        })
      })
    )

    this.queueContactSuggestions(contactSuggestions)
    return result
  }

  async updateMessagePreviews(
    accountId: string,
    folderPath: string,
    updates: Array<{ uid: number; preview: string }>
  ): Promise<MailMessageSummary[]> {
    await this.ready

    if (updates.length === 0) {
      return []
    }

    const now = BigInt(Date.now())

    await this.prisma.$transaction(
      updates.map((entry) =>
        this.prisma.message.updateMany({
          where: { accountId, folderPath, uid: entry.uid },
          data: {
            preview: entry.preview,
            previewHydrated: true,
            updatedAt: now
          }
        })
      )
    )

    const uids = updates.map((entry) => entry.uid)
    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath, uid: { in: uids } }
    })

    return rows.map((row) => this.mapMessageRowToSummary(row))
  }

  async listUnhydratedMessageUids(accountId: string, folderPath: string): Promise<number[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath, previewHydrated: false },
      select: { uid: true },
      orderBy: { uid: 'desc' }
    })

    return rows.map((row) => row.uid)
  }

  private mapMessageRowToSummary(row: {
    accountId: string
    folderPath: string
    uid: number
    threadId: string | null
    messageId: string | null
    subject: string
    fromJson: string
    toJson: string
    ccJson: string
    dateIso: string
    preview: string
    previewHydrated: boolean
    flagsJson: string
    isRead: boolean
    hasAttachments: boolean
    size: number
  }): MailMessageSummary {
    return {
      accountId: row.accountId,
      folderPath: row.folderPath,
      uid: row.uid,
      threadId: row.threadId ?? undefined,
      messageId: row.messageId ?? undefined,
      subject: row.subject,
      from: parseJsonArray(row.fromJson),
      to: parseJsonArray(row.toJson),
      cc: parseJsonArray(row.ccJson),
      date: row.dateIso,
      preview: row.preview,
      previewHydrated: row.previewHydrated,
      flags: parseJsonArray(row.flagsJson),
      isRead: row.isRead,
      hasAttachments: row.hasAttachments,
      size: row.size
    }
  }

  async listMessages(
    accountId: string,
    folderPath: string,
    limit: number,
    query?: string
  ): Promise<MailMessageSummary[]> {
    await this.ready

    const normalizedLimit = Math.max(1, Math.floor(limit))
    const searchWhere = buildMessageSearchWhere(query)
    const where: Prisma.MessageWhereInput = searchWhere
      ? {
          accountId,
          folderPath,
          AND: [searchWhere]
        }
      : {
          accountId,
          folderPath
        }

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ dateIso: 'desc' }, { uid: 'desc' }],
      take: normalizedLimit
    })

    return rows.map((row) => this.mapMessageRowToSummary(row))
  }

  async countMessages(accountId: string, folderPath: string, query?: string): Promise<number> {
    await this.ready

    const searchWhere = buildMessageSearchWhere(query)
    const where: Prisma.MessageWhereInput = searchWhere
      ? {
          accountId,
          folderPath,
          AND: [searchWhere]
        }
      : {
          accountId,
          folderPath
        }

    return this.prisma.message.count({
      where
    })
  }

  async listAllMessageUids(accountId: string, folderPath: string): Promise<number[]> {
    await this.ready

    const rows = await this.prisma.message.findMany({
      where: { accountId, folderPath },
      select: { uid: true }
    })

    return rows.map((row) => row.uid)
  }

  async deleteMessageUids(accountId: string, folderPath: string, uids: number[]): Promise<void> {
    await this.ready

    if (uids.length === 0) {
      return
    }

    const chunkSize = 400

    for (let index = 0; index < uids.length; index += chunkSize) {
      const chunk = uids.slice(index, index + chunkSize)

      await this.prisma.message.deleteMany({
        where: {
          accountId,
          folderPath,
          uid: { in: chunk }
        }
      })
    }
  }

  async listMessagesInMailboxes(
    mailboxes: Array<{ accountId: string; folderPath: string }>,
    limit: number,
    query?: string
  ): Promise<MailMessageSummary[]> {
    await this.ready

    if (mailboxes.length === 0) {
      return []
    }

    const normalizedLimit = Math.max(1, Math.floor(limit))
    const mailboxWhere =
      mailboxes.length === 1
        ? { accountId: mailboxes[0]?.accountId || '', folderPath: mailboxes[0]?.folderPath || '' }
        : {
            OR: mailboxes.map((mailbox) => ({
              accountId: mailbox.accountId,
              folderPath: mailbox.folderPath
            }))
          }
    const searchWhere = buildMessageSearchWhere(query)
    const where: Prisma.MessageWhereInput = searchWhere
      ? {
          ...mailboxWhere,
          AND: [searchWhere]
        }
      : mailboxWhere

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ dateIso: 'desc' }, { accountId: 'asc' }, { folderPath: 'asc' }, { uid: 'desc' }],
      take: normalizedLimit
    })

    return rows.map((row) => this.mapMessageRowToSummary(row))
  }

  async countMessagesInMailboxes(
    mailboxes: Array<{ accountId: string; folderPath: string }>,
    query?: string
  ): Promise<number> {
    await this.ready

    if (mailboxes.length === 0) {
      return 0
    }

    const mailboxWhere =
      mailboxes.length === 1
        ? { accountId: mailboxes[0]?.accountId || '', folderPath: mailboxes[0]?.folderPath || '' }
        : {
            OR: mailboxes.map((mailbox) => ({
              accountId: mailbox.accountId,
              folderPath: mailbox.folderPath
            }))
          }
    const searchWhere = buildMessageSearchWhere(query)
    const where: Prisma.MessageWhereInput = searchWhere
      ? {
          ...mailboxWhere,
          AND: [searchWhere]
        }
      : mailboxWhere

    return this.prisma.message.count({
      where
    })
  }

  async getMessage(ref: MessageRef): Promise<MailMessageDetail | null> {
    await this.ready

    const row = await this.prisma.message.findUnique({
      where: {
        accountId_folderPath_uid: {
          accountId: ref.accountId,
          folderPath: ref.folderPath,
          uid: ref.uid
        }
      }
    })

    if (!row) {
      return null
    }

    return {
      accountId: row.accountId,
      folderPath: row.folderPath,
      uid: row.uid,
      threadId: row.threadId ?? undefined,
      messageId: row.messageId ?? undefined,
      subject: row.subject,
      from: parseJsonArray(row.fromJson),
      to: parseJsonArray(row.toJson),
      cc: parseJsonArray(row.ccJson),
      bcc: parseJsonArray(row.bccJson),
      date: row.dateIso,
      preview: row.preview,
      previewHydrated: row.previewHydrated,
      flags: parseJsonArray(row.flagsJson),
      isRead: row.isRead,
      hasAttachments: row.hasAttachments,
      size: row.size,
      html: row.htmlBody ?? undefined,
      text: row.textBody ?? undefined,
      attachments: parseJsonArray<MailAttachment>(row.attachmentsJson)
    }
  }

  async updateMessageBody(
    ref: MessageRef,
    html: string | undefined,
    text: string | undefined,
    bcc: unknown[],
    attachments: MailAttachment[]
  ): Promise<void> {
    await this.ready

    await this.prisma.message.updateMany({
      where: {
        accountId: ref.accountId,
        folderPath: ref.folderPath,
        uid: ref.uid
      },
      data: {
        htmlBody: html ?? null,
        textBody: text ?? (html ? null : ''),
        bccJson: JSON.stringify(bcc),
        attachmentsJson: JSON.stringify(attachments),
        updatedAt: BigInt(Date.now())
      }
    })

    const bccSuggestions = extractContactSuggestionsFromUnknownAddresses(bcc)

    if (bccSuggestions.length > 0) {
      this.queueContactSuggestions(bccSuggestions)
    }
  }

  async deleteMessage(ref: MessageRef): Promise<void> {
    await this.ready

    await this.prisma.message.deleteMany({
      where: {
        accountId: ref.accountId,
        folderPath: ref.folderPath,
        uid: ref.uid
      }
    })
  }

  async updateMessageReadState(ref: MessageRef, seen: boolean): Promise<void> {
    await this.ready

    await this.prisma.message.updateMany({
      where: {
        accountId: ref.accountId,
        folderPath: ref.folderPath,
        uid: ref.uid
      },
      data: {
        isRead: seen,
        updatedAt: BigInt(Date.now())
      }
    })
  }

  async updateMessageFlags(
    accountId: string,
    folderPath: string,
    uid: number,
    flags: string[]
  ): Promise<MailMessageSummary | null> {
    await this.ready

    await this.prisma.message.updateMany({
      where: { accountId, folderPath, uid },
      data: {
        flagsJson: JSON.stringify(flags),
        isRead: flags.includes('\\Seen'),
        updatedAt: BigInt(Date.now())
      }
    })

    const row = await this.prisma.message.findUnique({
      where: {
        accountId_folderPath_uid: { accountId, folderPath, uid }
      }
    })

    if (!row) {
      return null
    }

    return this.mapMessageRowToSummary(row)
  }

  close(): void {
    void this.prisma.$disconnect()
  }

  private async initialize(): Promise<void> {
    await this.prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL')
    await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('gmail', 'imap')),
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_secure INTEGER NOT NULL,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        smtp_secure INTEGER NOT NULL,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'oauth')),
        encrypted_secret TEXT NOT NULL,
        last_viewed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.ensureAccountLastViewedAtColumn()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        delimiter TEXT,
        special_use TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        unseen_count INTEGER NOT NULL DEFAULT 0,
        uid_validity TEXT,
        highest_modseq TEXT,
        last_known_uid INTEGER,
        last_synced_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, path)
      )
    `)
    await this.ensureFolderColumns()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        uid INTEGER NOT NULL,
        thread_id TEXT,
        message_id TEXT,
        subject TEXT NOT NULL,
        from_json TEXT NOT NULL,
        to_json TEXT NOT NULL,
        cc_json TEXT NOT NULL,
        bcc_json TEXT NOT NULL DEFAULT '[]',
        date_iso TEXT NOT NULL,
        preview TEXT NOT NULL,
        preview_hydrated INTEGER NOT NULL DEFAULT 0,
        flags_json TEXT NOT NULL,
        is_read INTEGER NOT NULL,
        has_attachments INTEGER NOT NULL,
        size INTEGER NOT NULL,
        html_body TEXT,
        text_body TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, folder_path, uid)
      )
    `)
    await this.ensureMessageColumns()

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS contacts (
        email_normalized TEXT PRIMARY KEY,
        email_address TEXT NOT NULL,
        display_name TEXT,
        name_normalized TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS account_signatures (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        html TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_preferences (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        unified_inbox_included_account_ids TEXT,
        updated_at INTEGER NOT NULL
      )
    `)
    await this.migrateUnifiedInboxFromLegacyArchiveSettings()

    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_accounts_last_viewed ON accounts(last_viewed_at DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_folders_account ON folders(account_id)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(account_id, folder_path, date_iso DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_date_uid ON messages(account_id, folder_path, date_iso DESC, uid DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_messages_folder_uid ON messages(account_id, folder_path, uid DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_contacts_last_used ON contacts(last_used_at DESC)'
    )
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_contacts_name_normalized ON contacts(name_normalized)'
    )
    await this.prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO app_preferences(id, unified_inbox_included_account_ids, updated_at)
      VALUES (${APP_PREFERENCES_SINGLETON_ID}, NULL, ${Date.now()})
    `)
  }

  /**
   * On upgrade from a host build that stored unified-inbox preferences on
   * the legacy `archive_settings` table (now owned by the SIEVER archive
   * extension), migrate the value into the new host-owned `app_preferences`
   * table so the user's setting survives the schema split. The migration
   * is a no-op if the legacy table doesn't exist or its column was never
   * populated.
   */
  private async migrateUnifiedInboxFromLegacyArchiveSettings(): Promise<void> {
    try {
      const legacyTable = (await this.prisma.$queryRawUnsafe(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'archive_settings'"
      )) as Array<{ name?: string }>

      if (!legacyTable[0]?.name) {
        return
      }

      const legacyColumns = (await this.prisma.$queryRawUnsafe(
        'PRAGMA table_info(archive_settings)'
      )) as Array<{ name?: string }>

      if (!legacyColumns.some((column) => column.name === 'unified_inbox_included_account_ids')) {
        return
      }

      const legacyRows = (await this.prisma.$queryRawUnsafe(
        'SELECT unified_inbox_included_account_ids AS value FROM archive_settings WHERE id = 1 LIMIT 1'
      )) as Array<{ value?: unknown }>

      const legacyValue = legacyRows[0]?.value

      if (typeof legacyValue !== 'string' || !legacyValue.trim()) {
        return
      }

      const now = Date.now()
      await this.prisma.$executeRawUnsafe(
        `UPDATE app_preferences
         SET unified_inbox_included_account_ids = ?,
             updated_at = ?
         WHERE id = ${APP_PREFERENCES_SINGLETON_ID}
           AND (unified_inbox_included_account_ids IS NULL OR unified_inbox_included_account_ids = '')`,
        legacyValue,
        now
      )
    } catch (error) {
      logMainError('Unified inbox preference migration from legacy archive_settings failed', error)
    }
  }

  private async ensureFolderColumns(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe('PRAGMA table_info(folders)')) as Array<{
      name?: string
    }>
    const columnNames = new Set(columns.map((column) => column.name ?? ''))

    if (!columnNames.has('last_synced_at')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE folders ADD COLUMN last_synced_at INTEGER')
    }

    if (!columnNames.has('uid_validity')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE folders ADD COLUMN uid_validity TEXT')
    }

    if (!columnNames.has('highest_modseq')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE folders ADD COLUMN highest_modseq TEXT')
    }

    if (!columnNames.has('last_known_uid')) {
      await this.prisma.$executeRawUnsafe('ALTER TABLE folders ADD COLUMN last_known_uid INTEGER')
    }
  }

  private async ensureMessageColumns(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe('PRAGMA table_info(messages)')) as Array<{
      name?: string
    }>
    const columnNames = new Set(columns.map((column) => column.name ?? ''))

    if (!columnNames.has('preview_hydrated')) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE messages ADD COLUMN preview_hydrated INTEGER NOT NULL DEFAULT 0'
      )
      // Migration: rows whose preview was populated by the previous bulk-body sync
      // path already have a real preview. Mark them as hydrated so we don't redo
      // the work after the upgrade, and so the UI never shows the placeholder for
      // messages that already have a valid preview.
      await this.prisma.$executeRawUnsafe(
        "UPDATE messages SET preview_hydrated = 1 WHERE preview IS NOT NULL AND preview <> ''"
      )
    }
  }

  private async ensureAccountLastViewedAtColumn(): Promise<void> {
    const columns = (await this.prisma.$queryRawUnsafe('PRAGMA table_info(accounts)')) as Array<{
      name?: string
    }>
    const hasLastViewedAt = columns.some((column) => column.name === 'last_viewed_at')

    if (hasLastViewedAt) {
      return
    }

    await this.prisma.$executeRawUnsafe('ALTER TABLE accounts ADD COLUMN last_viewed_at INTEGER')
  }

  private mapAccountRow(row: {
    id: string
    type: string
    email: string
    displayName: string
    imapHost: string
    imapPort: number
    imapSecure: boolean
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    username: string
    authType: string
    createdAt: bigint
    updatedAt: bigint
  }): MailAccount {
    return {
      id: row.id,
      type: row.type as MailAccount['type'],
      email: row.email,
      displayName: row.displayName,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecure: row.imapSecure,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      username: row.username,
      authType: row.authType as MailAccount['authType'],
      createdAt: toNumber(row.createdAt),
      updatedAt: toNumber(row.updatedAt)
    }
  }

  private makeMessagePrimaryId(accountId: string, folderPath: string, uid: number): string {
    return `${accountId}:${folderPath}:${uid}`
  }
}
