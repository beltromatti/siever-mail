/**
 * Drafts: the messages being written.
 *
 * A draft is kept twice. Here, in the `drafts` table, on every save the
 * composer makes as the user types — so a crash, a quit or a lost
 * connection never costs a word — and in the account's Bozze on the
 * server, once typing settles, so it is there in Gmail, Outlook and on the
 * phone. Each server save files the draft as a new message and deletes the
 * version it replaces for good, as every IMAP client does; a version
 * carries its own Message-ID (Gmail drops a second message with one it has
 * seen) and the draft's id in `X-Siever-Draft-Id`, which is how a draft is
 * known again when it is opened from Bozze.
 *
 * A save the server refused is tried again later, and a draft not yet on
 * the server is reopened at the next launch; sending deletes the draft
 * once the message has gone, and throwing it away moves its copy to the
 * Trash.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { app } from 'electron'
import type { ParsedMail } from 'mailparser'

import { diagnostics } from '@main/diagnostics/log'
import type {
  DraftAttachment,
  DraftContent,
  DraftStatus,
  MessageRef,
  StoredDraft
} from '@shared/models'

import type { AppDatabase, StoredDraftRecord } from './database'
import { writeUniqueFile } from './file-utils'
import type { MailEngine } from './mail-engine'
import {
  buildRawOutgoingMessage,
  createOutgoingMessagePayload,
  type AccountWithSecret
} from './mail-engine/mail-transport'
import { mapParsedAddresses } from './mail-engine/message-mapper'
import { partitionMessageAttachments } from './mail-engine/message-parts'
import { plainTextOfHtml } from './mail-engine/preview'

const log = diagnostics('mail')

/** A draft goes to the server this long after the last word typed. */
const SERVER_SAVE_DELAY_MS = 5_000
/** A save the server refused is tried again after this long. */
const SERVER_RETRY_DELAY_MS = 30_000
export const DRAFT_ID_HEADER = 'X-Siever-Draft-Id'
const DRAFTS_DIRECTORY_NAME = 'drafts'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DraftServiceDependencies {
  database: AppDatabase
  engine: MailEngine
  /** The account a draft goes out from, with its secret, or null when it is gone. */
  getAccount: (accountId: string) => Promise<AccountWithSecret | null>
  onStatus: (status: DraftStatus) => void
}

/** The folder the files of a draft opened from Bozze are written to. */
function draftDirectory(id: string): string {
  return join(app.getPath('userData'), DRAFTS_DIRECTORY_NAME, id)
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * A draft read off the server, as the composer takes it: the body with the
 * pictures it shows inline again (`cid:` back to `data:`), the files it
 * carries as `files` to write next to it, its recipients — Bcc included,
 * which a draft keeps — and the thread it answers.
 */
export function draftFromParsedMail(
  parsed: ParsedMail,
  accountId: string
): { content: Omit<DraftContent, 'attachments'>; files: Array<{ name: string; content: Buffer }> } {
  const headerId = parsed.headers.get(DRAFT_ID_HEADER.toLowerCase())
  const id =
    typeof headerId === 'string' && UUID_PATTERN.test(headerId.trim())
      ? headerId.trim()
      : randomUUID()
  const { official, embedded } = partitionMessageAttachments(parsed)
  let html =
    typeof parsed.html === 'string' && parsed.html.trim()
      ? parsed.html
      : `<div>${escapeHtml(parsed.text ?? '').replace(/\r?\n/g, '<br>')}</div>`

  for (const { attachment } of embedded) {
    if (attachment.cid) {
      html = html
        .split(`cid:${attachment.cid}`)
        .join(
          `data:${attachment.contentType || 'application/octet-stream'};base64,${Buffer.from(attachment.content).toString('base64')}`
        )
    }
  }

  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : []

  return {
    content: {
      id,
      kind: parsed.inReplyTo ? 'reply' : 'new',
      accountId,
      to: mapParsedAddresses(parsed.to),
      cc: mapParsedAddresses(parsed.cc),
      bcc: mapParsedAddresses(parsed.bcc),
      subject: parsed.subject ?? '',
      html,
      inReplyTo: parsed.inReplyTo || undefined,
      references
    },
    files: official.map(({ index, attachment }) => ({
      name: attachment.filename || `allegato-${index + 1}`,
      content: Buffer.from(attachment.content)
    }))
  }
}

/** Drafts held while their copies leave Bozze (see `DraftService.hold`). */
export interface HeldDrafts {
  /** The copy to act on, by the ref the caller had: the draft's copy as it is now on the server. */
  current: ReadonlyMap<string, MessageRef>
  /** Refs left where they are: their draft has changes the server could not take yet. */
  refused: MessageRef[]
  error?: string
  /** With the copies the action moved: their drafts are let go, the others written on again. */
  settle(moved: ReadonlyArray<MessageRef>): Promise<void>
}

export function draftRefKey(ref: MessageRef): string {
  return `${ref.accountId}\u0000${ref.folderPath}\u0000${ref.uid}`
}

export class DraftService {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly uploads = new Map<string, Promise<DraftStatus>>()
  private readonly statuses = new Map<string, DraftStatus>()
  /** Drafts whose copy is leaving Bozze: written here, not filed, until it is settled. */
  private readonly held = new Set<string>()
  /** Drafts whose copy left Bozze: a composer's late save no longer brings them back. */
  private readonly released = new Set<string>()
  /** Messages being opened, so one opened twice at once is made a draft once. */
  private readonly opening = new Map<string, Promise<StoredDraft>>()

  constructor(private readonly deps: DraftServiceDependencies) {}

  /** Keeps the draft as it is now; the server gets it once typing settles. */
  async save(content: DraftContent): Promise<DraftStatus> {
    if (this.released.has(content.id)) {
      return { id: content.id, state: 'gone' }
    }

    await this.deps.database.saveDraft(content)

    if (!this.held.has(content.id)) {
      this.schedule(content.id, SERVER_SAVE_DELAY_MS)
    }

    return this.setStatus({
      id: content.id,
      state: 'pending',
      savedAt: this.statuses.get(content.id)?.savedAt
    })
  }

  /** Files the draft on the server now, when the server does not have it as it is. */
  async flush(id: string): Promise<DraftStatus> {
    if (this.released.has(id)) {
      return { id, state: 'gone' }
    }

    // Its copy is leaving Bozze: a new one is not filed meanwhile.
    if (this.held.has(id)) {
      return this.statuses.get(id) ?? { id, state: 'pending' }
    }

    this.clearTimer(id)
    return this.upload(id)
  }

  /** The composer let go of the draft: it is filed, and no longer reopened at launch. */
  async close(id: string): Promise<DraftStatus> {
    await this.deps.database.setDraftDocked(id, false)
    return this.flush(id)
  }

  /** Throws the draft away: its copy on the server goes to the Trash. */
  async discard(id: string): Promise<void> {
    const record = await this.forget(id)
    const server = record?.server

    if (server?.uid != null) {
      const moved = await this.deps.engine.moveMessagesToTrash([
        { accountId: server.accountId, folderPath: server.folderPath, uid: server.uid }
      ])

      if (moved.failed.length > 0) {
        throw new Error(
          `La bozza è rimasta in Bozze: ${moved.error ?? 'il server non l’ha spostata nel Cestino.'}`
        )
      }
    }
  }

  /** The message went: its draft, and the draft's copy on the server, go too. */
  async sent(id: string): Promise<void> {
    const server = (await this.forget(id))?.server

    if (server?.uid != null) {
      const purged = await this.deps.engine.purgeMessages([
        { accountId: server.accountId, folderPath: server.folderPath, uid: server.uid }
      ])

      if (purged.failed.length > 0) {
        // The server's answer: the draft stays in Bozze, said there.
        log.warn('draft.not-deleted', { draftId: id, err: { message: purged.error ?? 'refused' } })
      }
    }
  }

  /**
   * The drafts the app left open, or that the server does not have as they
   * are, for the composer to take up again. Copies of an original message's
   * attachments that are gone — the cache was emptied — are made again.
   */
  async listDocked(): Promise<StoredDraft[]> {
    const records = await this.deps.database.listDockedDrafts()
    return Promise.all(records.map((record) => this.storedDraftOf(record)))
  }

  /** A draft kept here, by its id, to take up again; null when there is none. */
  async get(id: string): Promise<StoredDraft | null> {
    const record = await this.deps.database.getDraft(id)
    return record ? this.storedDraftOf(record) : null
  }

  /** A stored draft as the composer takes it up: copies of originals that are gone, made again. */
  private async storedDraftOf(record: StoredDraftRecord): Promise<StoredDraft> {
    return {
      content: {
        ...record.content,
        attachments: await Promise.all(
          record.content.attachments.map(async (attachment): Promise<DraftAttachment> => {
            const present =
              !attachment.path ||
              (await stat(attachment.path).then(
                (stats) => stats.isFile(),
                () => false
              ))

            return present || !attachment.originalId
              ? attachment
              : {
                  name: attachment.name,
                  size: attachment.size,
                  originalId: attachment.originalId
                }
          })
        )
      },
      status: this.statusOf(record)
    }
  }

  /**
   * A message in Bozze, opened to be written on: the draft the app keeps
   * for it, or one made from it — its files written next to it.
   */
  openMessage(ref: MessageRef): Promise<StoredDraft> {
    const key = `${ref.accountId}\n${ref.folderPath}\n${ref.uid}`
    const running = this.opening.get(key)

    if (running) {
      return running
    }

    const task = this.openMessageOnce(ref).finally(() => this.opening.delete(key))
    this.opening.set(key, task)
    return task
  }

  private async openMessageOnce(ref: MessageRef): Promise<StoredDraft> {
    const known = await this.deps.database.findDraftByServerCopy(
      ref.accountId,
      ref.folderPath,
      ref.uid
    )

    if (known) {
      await this.deps.database.setDraftDocked(known.content.id, true)
      return { content: known.content, status: this.statusOf(known) }
    }

    let read: ReturnType<typeof draftFromParsedMail> | null = null
    const { missing } = await this.deps.engine.fetchMessageRawSources([ref], async (_, message) => {
      read = draftFromParsedMail(message.parsed, ref.accountId)
    })
    const draft = read as ReturnType<typeof draftFromParsedMail> | null

    if (missing.length > 0 || !draft) {
      throw new Error('La bozza non è più sul server.')
    }

    // This draft, open in a composer or not yet filed as it is now, is newer than any copy.
    const local = await this.deps.database.getDraft(draft.content.id)

    if (local && (local.docked || local.revision > local.serverRevision)) {
      await this.deps.database.setDraftDocked(local.content.id, true)
      return { content: local.content, status: this.statusOf(local) }
    }

    const directory = draftDirectory(draft.content.id)
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    const attachments: DraftAttachment[] = []

    for (const file of draft.files) {
      const path = await writeUniqueFile(directory, file.name, file.content)
      attachments.push({ name: basename(path), size: file.content.length, path })
    }

    const record = await this.deps.database.adoptServerDraft({ ...draft.content, attachments }, ref)
    return { content: record.content, status: this.statusOf(record) }
  }

  /**
   * Messages of Bozze about to leave it — moved, archived, thrown away. The
   * drafts they are copies of stop being filed while it happens; what is
   * newer here than on the server is filed first, so the copy that leaves
   * is the draft as it is, and is the one to act on. A draft the server
   * cannot take as it is stays, with its copy, and says why. `settle`, with
   * the copies the action moved, lets their drafts go — a composer holding
   * one closes — and has the others filed again as they were.
   */
  async hold(refs: ReadonlyArray<MessageRef>): Promise<HeldDrafts> {
    const current = new Map<string, MessageRef>()
    const refused: MessageRef[] = []
    const heldIds = new Map<string, string>()
    let error: string | undefined

    for (const ref of refs) {
      const known = await this.deps.database.findDraftByServerCopy(
        ref.accountId,
        ref.folderPath,
        ref.uid
      )

      if (!known || this.released.has(known.content.id)) {
        continue
      }

      const id = known.content.id
      this.held.add(id)
      this.clearTimer(id)
      await this.uploads.get(id)?.catch(() => undefined)
      let record = await this.deps.database.getDraft(id)

      if (record && record.revision > record.serverRevision) {
        await this.upload(id)
        record = await this.deps.database.getDraft(id)
      }

      const server = record?.server

      if (!record || !server || server.uid == null || record.revision > record.serverRevision) {
        this.held.delete(id)

        if (record && record.revision > record.serverRevision) {
          this.schedule(id, SERVER_RETRY_DELAY_MS)
        }

        refused.push(ref)
        error = 'Una bozza ha modifiche che il server non ha ancora preso: resta in Bozze.'
        continue
      }

      const copy = { accountId: server.accountId, folderPath: server.folderPath, uid: server.uid }
      current.set(draftRefKey(ref), copy)
      heldIds.set(draftRefKey(copy), id)
    }

    return {
      current,
      refused,
      error,
      settle: async (moved) => {
        const movedKeys = new Set(moved.map(draftRefKey))

        for (const [copyKey, id] of heldIds) {
          this.held.delete(id)

          if (movedKeys.has(copyKey)) {
            this.released.add(id)
            await this.forget(id)
            this.deps.onStatus({ id, state: 'gone' })
            continue
          }

          const record = await this.deps.database.getDraft(id)

          if (record && record.revision > record.serverRevision) {
            this.schedule(id, SERVER_SAVE_DELAY_MS)
          }
        }
      }
    }
  }

  /** Files the drafts the server does not have yet — at launch, once connected. */
  async resume(): Promise<void> {
    for (const id of await this.deps.database.listUnfiledDraftIds()) {
      this.schedule(id, SERVER_SAVE_DELAY_MS)
    }
  }

  /** Files what is waiting, before the app quits, for as long as `deadlineMs` allows. */
  async flushAll(deadlineMs: number): Promise<void> {
    const ids = await this.deps.database.listUnfiledDraftIds()
    let timer: NodeJS.Timeout | undefined

    await Promise.race([
      Promise.allSettled(ids.map((id) => this.flush(id))),
      new Promise((resolve) => {
        timer = setTimeout(resolve, deadlineMs)
      })
    ])
    clearTimeout(timer)

    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id)
    }
  }

  private statusOf(record: StoredDraftRecord): DraftStatus {
    return (
      this.statuses.get(record.content.id) ??
      (record.revision > record.serverRevision || !record.server
        ? { id: record.content.id, state: 'pending' }
        : {
            id: record.content.id,
            state: 'saved',
            savedAt: record.serverSavedAt ?? undefined
          })
    )
  }

  private setStatus(status: DraftStatus): DraftStatus {
    this.statuses.set(status.id, status)
    this.deps.onStatus(status)
    return status
  }

  private schedule(id: string, delayMs: number): void {
    // A copy leaving Bozze, or gone: nothing is filed for it meanwhile.
    if (this.held.has(id) || this.released.has(id)) {
      return
    }

    this.clearTimer(id)
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        void this.upload(id)
      }, delayMs)
    )
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id)

    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
  }

  /** One server save at a time per draft; one asked for meanwhile follows it. */
  private upload(id: string): Promise<DraftStatus> {
    const running = this.uploads.get(id)

    if (running) {
      return running.then(() => this.upload(id))
    }

    const task = this.uploadOnce(id).finally(() => this.uploads.delete(id))
    this.uploads.set(id, task)
    return task
  }

  private async uploadOnce(id: string): Promise<DraftStatus> {
    const record = await this.deps.database.getDraft(id)

    if (!record) {
      return { id, state: 'saved' }
    }

    const { content } = record
    const onServer = record.server?.accountId === content.accountId ? record.server : null

    if (record.revision <= record.serverRevision && onServer) {
      return this.setStatus(this.statusOf(record))
    }

    this.setStatus({ id, state: 'saving', savedAt: this.statuses.get(id)?.savedAt })

    try {
      const account = await this.deps.getAccount(content.accountId)

      if (!account) {
        throw new Error('L’account da cui parte la bozza non c’è più.')
      }

      const domain = account.email.split('@')[1] || 'siever-mail.local'
      const messageId = `<draft.${id}.${record.revision}@${domain}>`
      const raw = await buildRawOutgoingMessage({
        ...createOutgoingMessagePayload(account, {
          accountId: content.accountId,
          to: content.to,
          cc: content.cc,
          bcc: content.bcc,
          subject: content.subject,
          html: content.html,
          text: plainTextOfHtml(content.html),
          inReplyTo: content.inReplyTo,
          references: content.references,
          // A file moved or deleted since is left out of the server's copy;
          // sending names it.
          attachments: (
            await Promise.all(
              content.attachments.map(async (attachment) =>
                attachment.path &&
                (await stat(attachment.path).then(
                  (stats) => stats.isFile(),
                  () => false
                ))
                  ? [{ path: attachment.path, name: attachment.name }]
                  : []
              )
            )
          ).flat()
        }),
        messageId,
        date: new Date(),
        headers: { [DRAFT_ID_HEADER]: id },
        keepBcc: true
      })
      const placed = await this.deps.engine.saveDraft(
        content.accountId,
        raw,
        messageId,
        onServer?.uid != null ? { folderPath: onServer.folderPath, uid: onServer.uid } : null
      )

      // The draft left another account: its copy there goes.
      if (record.server && !onServer && record.server.uid != null) {
        await this.deps.engine.purgeMessages([
          {
            accountId: record.server.accountId,
            folderPath: record.server.folderPath,
            uid: record.server.uid
          }
        ])
      }

      const filed = await this.deps.database.markDraftFiled(id, {
        revision: record.revision,
        accountId: content.accountId,
        folderPath: placed.folderPath,
        uid: placed.uid
      })

      if (filed && filed.revision > filed.serverRevision) {
        this.schedule(id, SERVER_SAVE_DELAY_MS)
        return this.setStatus({ id, state: 'pending', savedAt: Date.now() })
      }

      return this.setStatus({ id, state: 'saved', savedAt: Date.now() })
    } catch (error) {
      // Tried again by itself (§14.1).
      log.warn('draft.not-filed', { draftId: id, err: error })

      // Thrown away or sent meanwhile: nothing left to file.
      if (!(await this.deps.database.getDraft(id))) {
        return { id, state: 'saved' }
      }

      this.schedule(id, SERVER_RETRY_DELAY_MS)
      return this.setStatus({
        id,
        state: 'error',
        savedAt: this.statuses.get(id)?.savedAt,
        message: errorText(error, 'Il server non ha salvato la bozza.')
      })
    }
  }

  /** Stops filing the draft and deletes what the app keeps of it; resolves with what it was. */
  private async forget(id: string): Promise<StoredDraftRecord | null> {
    this.clearTimer(id)
    await this.uploads.get(id)?.catch(() => undefined)

    const record = await this.deps.database.getDraft(id)
    await this.deps.database.deleteDraft(id)
    await rm(draftDirectory(id), { recursive: true, force: true })
    this.statuses.delete(id)
    return record
  }
}
