import { placeholders, type Sql } from '../sql'
import { CommitmentStore } from './commitments'
import { NoteStore, type NoteInput } from './notes'
import { ProjectStore } from './projects'
import { CopyStore, ProposalStore } from './proposals'
import { ReplyStore } from './replies'
import {
  OWED_KINDS,
  type Actor,
  type CommitmentKind,
  type CommitmentRecord,
  type CommitmentStatus,
  type Evidence,
  type MessageAnchor,
  type NoteRecord,
  type ProjectRecord,
  type ProposalRecord,
  type ProposalStatus,
  type RegistryChange,
  type ReplyKind,
  type ReplyRecord,
  type ReplyStatus,
  type SavedCopy,
  type ThreadRef
} from './types'

/** A view of the Segretario's, by what it holds. */
export type RegistryView = 'da-gestire' | 'in-attesa' | 'bozze-pronte'

export interface RegistryHooks {
  /** Something changed: the views showing it refresh, the diary records it. */
  changed(change: RegistryChange): void
  /** The user corrected or decided something: a lesson for the reflection. */
  lesson(kind: string, payload: Record<string, unknown>): void
}

/** How long a message must stay missing before it is taken as deleted. */
const GONE_AFTER_MS = 30 * 60 * 1000

const KIND_WORDS: Record<CommitmentKind, string> = {
  ti_chiedono: 'ti chiedono',
  hai_promesso: 'hai promesso',
  aspetti: 'aspetti',
  da_fare: 'da fare'
}

const STATUS_LABELS: Record<CommitmentStatus, string> = {
  aperta: 'Riaperta',
  fatta: 'Fatta',
  non_serve: 'Non serve',
  rinviata: 'Rinviata'
}

/**
 * The registry: one door to the state of the user's work. Every change
 * goes through here, so each one refreshes what shows it, makes "Il punto"
 * of its projects stale, and — when the user made it — becomes a lesson.
 */
export class Registry {
  readonly notes: NoteStore
  readonly commitments: CommitmentStore
  readonly projects: ProjectStore
  readonly replies: ReplyStore
  readonly proposals: ProposalStore
  readonly copies: CopyStore

  constructor(
    private readonly sql: Sql,
    private readonly hooks: RegistryHooks
  ) {
    this.notes = new NoteStore(sql)
    this.commitments = new CommitmentStore(sql)
    this.projects = new ProjectStore(sql)
    this.replies = new ReplyStore(sql)
    this.proposals = new ProposalStore(sql)
    this.copies = new CopyStore(sql)
  }

  /* ─────────────────────────────── notes ─────────────────────────────── */

  async writeNote(
    anchor: MessageAnchor & { direction: 'in' | 'out'; messageDate: string },
    input: NoteInput,
    actor: Actor,
    options: { twinAccountId?: string | null; seenRevision?: number } = {}
  ): Promise<{ record: NoteRecord; change: RegistryChange }> {
    const before = await this.notes.get(anchor.accountId, anchor.messageKey)
    const { record, created } = await this.notes.write(anchor, input, actor, options)
    const projectIds = await this.projects.markStaleByThreads([anchor])

    if (actor.by === 'utente' && before) {
      this.hooks.lesson('nota_corretta', {
        prima: { sintesi: before.summary, natura: before.nature, importanza: before.priority },
        dopo: { sintesi: record.summary, natura: record.nature, importanza: record.priority }
      })
    }

    return {
      record,
      change: this.emit({
        object: 'nota',
        action: created ? 'scritta' : 'corretta',
        label: `${created ? 'Nota' : 'Nota corretta'}: ${record.summary}`,
        accountId: anchor.accountId,
        threadIds: [anchor.threadId],
        messageKeys: [anchor.messageKey],
        projectIds,
        id: `${anchor.accountId}:${anchor.messageKey}`
      })
    }
  }

  /* ───────────────────────────── commitments ───────────────────────────── */

  async openCommitment(
    anchor: MessageAnchor,
    input: { kind: CommitmentKind; text: string; due?: string | null; question?: string | null },
    actor: Actor
  ): Promise<{ record: CommitmentRecord; created: boolean; change: RegistryChange | null }> {
    const { record, created, historyId } = await this.commitments.create(anchor, input, actor)

    if (!created) {
      return { record, created, change: null }
    }

    const projectIds = await this.projects.markStaleByThreads([anchor])
    return {
      record,
      created,
      change: this.emit({
        object: 'impegno',
        action: 'aperta',
        label: `Aperta (${KIND_WORDS[record.kind]}): ${record.text}`,
        accountId: record.accountId,
        threadIds: [record.threadId],
        messageKeys: [record.messageKey],
        projectIds,
        id: record.id,
        undo: historyId ? { kind: 'impegno', itemId: record.id, historyId } : undefined
      })
    }
  }

  async editCommitment(
    id: number,
    changes: {
      text?: string
      due?: string | null
      kind?: CommitmentKind
      question?: string | null
    },
    actor: Actor,
    options: { seenRevision?: number; evidence?: Evidence; reason?: string } = {}
  ): Promise<{ record: CommitmentRecord; change: RegistryChange }> {
    const before = await this.commitments.get(id)
    const { record, historyId } = await this.commitments.edit(id, changes, actor, options)
    const projectIds = await this.projects.markStaleByThreads([record])

    if (actor.by === 'utente' && before) {
      this.hooks.lesson('impegno_corretto', {
        prima: { tipo: before.kind, testo: before.text, scadenza: before.due },
        dopo: { tipo: record.kind, testo: record.text, scadenza: record.due }
      })
    }

    return {
      record,
      change: this.emit({
        object: 'impegno',
        action: 'aggiornata',
        label: `Precisata: ${record.text}${record.due ? ` (entro il ${record.due})` : ''}`,
        accountId: record.accountId,
        threadIds: [record.threadId],
        messageKeys: [record.messageKey],
        projectIds,
        id: record.id,
        undo: { kind: 'impegno', itemId: record.id, historyId }
      })
    }
  }

  async setCommitmentStatus(
    id: number,
    status: CommitmentStatus,
    actor: Actor,
    options: {
      seenRevision?: number
      evidence?: Evidence
      reason?: string | null
      until?: string | null
    } = {}
  ): Promise<{ record: CommitmentRecord; change: RegistryChange | null }> {
    const before = await this.commitments.get(id)
    const { record, historyId } = await this.commitments.setStatus(id, status, actor, options)

    if (historyId === null) {
      return { record, change: null }
    }

    const projectIds = await this.projects.markStaleByThreads([record])

    if (actor.by === 'utente' && before) {
      // What teaches: a thing the Segretario opened that was not needed, one it closed that was not done.
      if (status === 'non_serve' || (status === 'aperta' && before.setBy === 'segretario')) {
        this.hooks.lesson(status === 'non_serve' ? 'impegno_non_serve' : 'impegno_riaperto', {
          tipo: record.kind,
          testo: record.text,
          prima: before.status,
          motivo: options.reason ?? null
        })
      }
    }

    const until = status === 'rinviata' && record.until ? ` fino al ${record.until}` : ''
    return {
      record,
      change: this.emit({
        object: 'impegno',
        action: status,
        label: `${STATUS_LABELS[status]}${until}: ${record.text}`,
        accountId: record.accountId,
        threadIds: [record.threadId],
        messageKeys: [record.messageKey],
        projectIds,
        id: record.id,
        undo: { kind: 'impegno', itemId: record.id, historyId }
      })
    }
  }

  async mergeCommitments(
    keepId: number,
    dropIds: ReadonlyArray<number>,
    actor: Actor
  ): Promise<RegistryChange[]> {
    const merged = await this.commitments.merge(keepId, dropIds, actor)
    const changes: RegistryChange[] = []

    for (const { record, historyId } of merged) {
      if (historyId !== null) {
        const projectIds = await this.projects.markStaleByThreads([record])
        changes.push(
          this.emit({
            object: 'impegno',
            action: 'unita',
            label: `Unita a #${keepId}: ${record.text}`,
            accountId: record.accountId,
            threadIds: [record.threadId],
            messageKeys: [record.messageKey],
            projectIds,
            id: record.id,
            undo: { kind: 'impegno', itemId: record.id, historyId }
          })
        )
      }
    }

    return changes
  }

  /** Moves what was open in conversations that repeat another to the message that carries it now. */
  async carryCommitments(
    from: ReadonlyArray<ThreadRef>,
    to: MessageAnchor,
    actor: Actor
  ): Promise<CommitmentRecord[]> {
    const moved = await this.commitments.carry(from, to, actor)

    if (moved.length > 0) {
      await this.projects.markStaleByThreads([to, ...from])
      this.emit({
        object: 'impegno',
        action: 'spostate',
        label: `${moved.length === 1 ? 'Spostata' : `Spostate ${moved.length} cose`} sul messaggio più recente`,
        accountId: to.accountId,
        threadIds: [to.threadId, ...from.map((thread) => thread.threadId)],
        messageKeys: [to.messageKey, ...moved.map((record) => record.messageKey)],
        projectIds: [],
        id: to.messageKey
      })
    }

    return moved
  }

  async undoCommitment(historyId: number, actor: Actor): Promise<CommitmentRecord | null> {
    const undone = await this.commitments.undo(historyId, actor)

    if (!undone) {
      return null
    }

    await this.projects.markStaleByThreads([undone.record])
    this.emit({
      object: 'impegno',
      action: 'annullata',
      label: `Annullato: ${undone.record.text}`,
      accountId: undone.record.accountId,
      threadIds: [undone.record.threadId],
      messageKeys: [undone.record.messageKey],
      projectIds: [],
      id: undone.record.id
    })
    return undone.record
  }

  /** What was put off until today is open again. */
  async wakeDeferred(today: string): Promise<CommitmentRecord[]> {
    const woken = await this.commitments.wakeDeferred(today)

    for (const record of woken) {
      this.emit({
        object: 'impegno',
        action: 'aperta',
        label: `Di nuovo aperta: ${record.text}`,
        accountId: record.accountId,
        threadIds: [record.threadId],
        messageKeys: [record.messageKey],
        projectIds: [],
        id: record.id
      })
    }

    return woken
  }

  /* ─────────────────────────────── projects ─────────────────────────────── */

  async createProject(
    title: string,
    actor: Actor,
    options: { description?: string | null } = {}
  ): Promise<{ record: ProjectRecord; created: boolean }> {
    const result = await this.projects.create(title, actor, options)

    if (result.created) {
      this.emit({
        object: 'progetto',
        action: 'creato',
        label: `Nuovo progetto: ${result.record.title}`,
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [result.record.id],
        id: result.record.id
      })
    }

    return result
  }

  async renameProject(id: string, title: string, actor: Actor): Promise<ProjectRecord> {
    const before = await this.projects.get(id)
    const record = await this.projects.rename(id, title, actor)

    if (actor.by === 'utente' && before && before.title !== record.title) {
      this.hooks.lesson('progetto_rinominato', { prima: before.title, dopo: record.title })
    }

    this.emitProject(
      record,
      'rinominato',
      `Progetto rinominato: ${before?.title ?? ''} → ${record.title}`
    )
    return record
  }

  async describeProject(id: string, description: string, actor: Actor): Promise<ProjectRecord> {
    const record = await this.projects.describe(id, description, actor)
    this.emitProject(record, 'descritto', `Di cosa si tratta: ${record.title}`)
    return record
  }

  async setProjectState(id: string, state: string, actor: Actor): Promise<ProjectRecord> {
    const record = await this.projects.setState(id, state, actor)
    this.emitProject(record, 'punto', `Il punto aggiornato: ${record.title}`)
    return record
  }

  async setProjectHidden(id: string, hidden: boolean, actor: Actor): Promise<ProjectRecord> {
    const record = await this.projects.setHidden(id, hidden, actor)

    if (actor.by === 'utente' && hidden) {
      this.hooks.lesson('progetto_nascosto', { progetto: record.title })
    }

    this.emitProject(
      record,
      hidden ? 'nascosto' : 'mostrato',
      `${hidden ? 'Nascosto' : 'Di nuovo visibile'}: ${record.title}`
    )
    return record
  }

  async setProjectClosed(id: string, closed: boolean, actor: Actor): Promise<ProjectRecord> {
    const record = await this.projects.setClosed(id, closed, actor)
    this.emitProject(
      record,
      closed ? 'chiuso' : 'riaperto',
      `${closed ? 'Concluso' : 'Riaperto'}: ${record.title}`
    )
    return record
  }

  async mergeProjects(
    keepId: string,
    dropIds: ReadonlyArray<string>,
    actor: Actor
  ): Promise<ProjectRecord> {
    const dropped = (await Promise.all(dropIds.map((id) => this.projects.get(id)))).filter(
      (project): project is ProjectRecord => project !== null
    )
    const record = await this.projects.merge(keepId, dropIds, actor)

    if (actor.by === 'utente') {
      this.hooks.lesson('progetti_uniti', {
        tenuto: record.title,
        uniti: dropped.map((project) => project.title)
      })
    }

    this.emit({
      object: 'progetto',
      action: 'uniti',
      label: `Uniti in ${record.title}: ${dropped.map((project) => project.title).join(', ')}`,
      accountId: null,
      threadIds: [],
      messageKeys: [],
      projectIds: [record.id, ...dropIds],
      id: record.id
    })
    return record
  }

  async linkThread(
    projectId: string,
    thread: ThreadRef,
    actor: Actor
  ): Promise<RegistryChange | null> {
    const { changed } = await this.projects.link(projectId, thread, actor)

    if (!changed) {
      return null
    }

    const project = await this.projects.get(projectId)

    if (actor.by === 'utente') {
      this.hooks.lesson('progetto_conversazione', { progetto: project?.title, azione: 'messa' })
    }

    return this.emit({
      object: 'progetto',
      action: 'collegata',
      label: `Conversazione in ${project?.title ?? 'un progetto'}`,
      accountId: thread.accountId,
      threadIds: [thread.threadId],
      messageKeys: [],
      projectIds: [projectId],
      id: projectId,
      undo: {
        kind: 'progetto-collegamento',
        projectId,
        accountId: thread.accountId,
        threadId: thread.threadId,
        linked: true
      }
    })
  }

  async unlinkThread(
    projectId: string,
    thread: ThreadRef,
    actor: Actor
  ): Promise<RegistryChange | null> {
    const removed = await this.projects.unlink(projectId, thread, actor)
    const project = await this.projects.get(projectId)

    if (actor.by === 'utente') {
      this.hooks.lesson('progetto_conversazione', { progetto: project?.title, azione: 'tolta' })
    }

    if (!removed && actor.by !== 'utente') {
      return null
    }

    return this.emit({
      object: 'progetto',
      action: 'tolta',
      label: `Conversazione tolta da ${project?.title ?? 'un progetto'}`,
      accountId: thread.accountId,
      threadIds: [thread.threadId],
      messageKeys: [],
      projectIds: [projectId],
      id: projectId,
      undo: {
        kind: 'progetto-collegamento',
        projectId,
        accountId: thread.accountId,
        threadId: thread.threadId,
        linked: false
      }
    })
  }

  async addProjectResource(
    projectId: string,
    resource: { kind: 'cartella' | 'link'; location: string; label?: string | null },
    actor: Actor
  ): Promise<void> {
    await this.projects.addResource(projectId, resource, actor)
    const project = await this.projects.get(projectId)
    this.emit({
      object: 'progetto',
      action: 'risorsa',
      label: `Collegata a ${project?.title ?? 'un progetto'}: ${resource.label ?? resource.location}`,
      accountId: null,
      threadIds: [],
      messageKeys: [],
      projectIds: [projectId],
      id: projectId
    })
  }

  async removeProjectResource(projectId: string, location: string, actor: Actor): Promise<void> {
    await this.projects.removeResource(projectId, location, actor)
    this.emit({
      object: 'progetto',
      action: 'risorsa-tolta',
      label: `Tolta: ${location}`,
      accountId: null,
      threadIds: [],
      messageKeys: [],
      projectIds: [projectId],
      id: projectId
    })
  }

  /* ──────────────────────────── replies prepared ──────────────────────────── */

  async saveReply(
    anchor: MessageAnchor,
    input: { kind: ReplyKind; text: string; doubts: string },
    actor: Actor
  ): Promise<{ record: ReplyRecord; change: RegistryChange }> {
    const before = await this.replies.get(anchor.accountId, anchor.messageKey)
    const { record, created } = await this.replies.save(anchor, input, actor)
    return {
      record,
      change: this.emit({
        object: 'risposta',
        action: created ? 'preparata' : 'riscritta',
        label: `${record.kind === 'sollecito' ? 'Sollecito' : 'Risposta'} ${created ? 'preparata' : 'riscritta'}`,
        accountId: anchor.accountId,
        threadIds: [anchor.threadId],
        messageKeys: [anchor.messageKey],
        projectIds: [],
        id: `${anchor.accountId}:${anchor.messageKey}`,
        undo: before
          ? undefined
          : {
              kind: 'risposta',
              accountId: anchor.accountId,
              messageKey: anchor.messageKey,
              status: 'scartata'
            }
      })
    }
  }

  async setReplyStatus(
    accountId: string,
    messageKey: string,
    status: ReplyStatus,
    actor: Actor,
    options: { reason?: string | null; seenRevision?: number } = {}
  ): Promise<ReplyRecord | null> {
    const before = await this.replies.get(accountId, messageKey)
    const record = await this.replies.setStatus(accountId, messageKey, status, actor, options)

    if (!record || before?.status === record.status) {
      return record
    }

    if (actor.by === 'utente' && status === 'scartata') {
      this.hooks.lesson('risposta_scartata', { tipo: record.kind, testo: record.text })
    }

    this.emit({
      object: 'risposta',
      action: status,
      label:
        status === 'pronta'
          ? 'Risposta confermata'
          : status === 'da_rivedere'
            ? `Risposta da rivedere${options.reason ? `: ${options.reason}` : ''}`
            : status === 'scartata'
              ? 'Risposta scartata'
              : status === 'usata'
                ? 'Risposta usata'
                : 'Risposta superata',
      accountId,
      threadIds: [record.threadId],
      messageKeys: [messageKey],
      projectIds: [],
      id: `${accountId}:${messageKey}`
    })
    return record
  }

  /** A newer message came in a conversation: the replies prepared before it are to be looked at again. */
  async markRepliesStale(
    thread: ThreadRef,
    beforeIso: string,
    reason: string
  ): Promise<ReplyRecord[]> {
    const stale = await this.replies.markStaleBefore(thread, beforeIso, reason)

    if (stale.length > 0) {
      this.emit({
        object: 'risposta',
        action: 'da_rivedere',
        label: `Da rivedere: ${reason}`,
        accountId: thread.accountId,
        threadIds: [thread.threadId],
        messageKeys: stale.map((reply) => reply.messageKey),
        projectIds: [],
        id: `${thread.accountId}:${thread.threadId}`
      })
    }

    return stale
  }

  /* ───────────────────────────── proposals and copies ───────────────────────────── */

  async propose(
    input: {
      kind: string
      title: string
      payload: Record<string, unknown>
      accountId?: string | null
      messageKey?: string | null
      threadId?: string | null
    },
    actor: Actor
  ): Promise<ProposalRecord> {
    const { record, created } = await this.proposals.propose(input, actor)
    this.emit({
      object: 'proposta',
      action: created ? 'proposta' : 'aggiornata',
      label: `Proposta: ${record.title}`,
      accountId: record.accountId,
      threadIds: record.threadId ? [record.threadId] : [],
      messageKeys: record.messageKey ? [record.messageKey] : [],
      projectIds: [],
      id: record.id
    })
    return record
  }

  async decideProposal(
    id: string,
    status: Exclude<ProposalStatus, 'aperta'>,
    result: Record<string, unknown> | null = null
  ): Promise<ProposalRecord> {
    const record = await this.proposals.decide(id, status, result)
    this.hooks.lesson(status === 'accettata' ? 'proposta_accettata' : 'proposta_scartata', {
      tipo: record.kind,
      proposta: record.title,
      dati: record.payload,
      scelta: result
    })
    this.emit({
      object: 'proposta',
      action: status,
      label: `${status === 'accettata' ? 'Accettata' : 'Scartata'}: ${record.title}`,
      accountId: record.accountId,
      threadIds: record.threadId ? [record.threadId] : [],
      messageKeys: record.messageKey ? [record.messageKey] : [],
      projectIds: [],
      id: record.id
    })
    return record
  }

  async saveCopies(copies: ReadonlyArray<Omit<SavedCopy, 'savedAt'>>): Promise<void> {
    await this.copies.save(copies)

    for (const accountId of new Set(copies.map((copy) => copy.accountId))) {
      const mine = copies.filter((copy) => copy.accountId === accountId)
      this.emit({
        object: 'copia',
        action: 'salvata',
        label: `Salvat${mine.length === 1 ? 'o' : 'i'} in ${mine[0].destination}`,
        accountId,
        threadIds: [...new Set(mine.map((copy) => copy.threadId))],
        messageKeys: mine.map((copy) => copy.messageKey),
        projectIds: [],
        id: mine[0].messageKey
      })
    }
  }

  /* ──────────────────────────────── views ──────────────────────────────── */

  /**
   * The messages a view holds, by key: those from which something open
   * comes that the user owes (`da-gestire`) or waits for (`in-attesa`), or
   * that have a reply ready (`bozze-pronte`). Where the message is filed
   * does not count; the mail service drops what is only in the Trash or Spam.
   */
  async viewKeys(
    view: RegistryView,
    accountIds?: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; messageKey: string }>> {
    if (accountIds && accountIds.length === 0) {
      return []
    }

    const accounts = accountIds ? `AND account_id IN (${placeholders(accountIds)})` : ''

    if (view === 'bozze-pronte') {
      return this.mapKeys(
        await this.sql.all(
          `SELECT DISTINCT account_id, message_key FROM ai_ready_drafts WHERE status = 'pronta' ${accounts}`,
          ...(accountIds ?? [])
        )
      )
    }

    const kinds = view === 'da-gestire' ? OWED_KINDS : (['aspetti'] as const)
    return this.mapKeys(
      await this.sql.all(
        `SELECT DISTINCT account_id, message_key FROM ai_items
         WHERE status = 'aperta' AND kind IN (${placeholders(kinds)}) ${accounts}`,
        ...kinds,
        ...(accountIds ?? [])
      )
    )
  }

  /** Which of these messages of an account have something open, or a reply waiting: the "Attivi". */
  async activeKeys(accountId: string, messageKeys: ReadonlyArray<string>): Promise<Set<string>> {
    if (messageKeys.length === 0) {
      return new Set()
    }

    const rows = await this.sql.all<{ message_key: string }>(
      `SELECT message_key FROM ai_items
       WHERE account_id = ? AND status = 'aperta' AND message_key IN (${placeholders(messageKeys)})
       UNION
       SELECT message_key FROM ai_ready_drafts
       WHERE account_id = ? AND status IN ('pronta', 'da_rivedere') AND message_key IN (${placeholders(messageKeys)})`,
      accountId,
      ...messageKeys,
      accountId,
      ...messageKeys
    )
    return new Set(rows.map((row) => row.message_key))
  }

  /** Every message of an account with something open or a reply waiting: the "Attivi" of a whole list. */
  async allActiveKeys(
    accountIds?: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; messageKey: string }>> {
    if (accountIds && accountIds.length === 0) {
      return []
    }

    const accounts = accountIds ? `AND account_id IN (${placeholders(accountIds)})` : ''
    return this.mapKeys(
      await this.sql.all(
        `SELECT account_id, message_key FROM ai_items WHERE status = 'aperta' ${accounts}
         UNION
         SELECT account_id, message_key FROM ai_ready_drafts WHERE status IN ('pronta', 'da_rivedere') ${accounts}`,
        ...(accountIds ?? []),
        ...(accountIds ?? [])
      )
    )
  }

  /* ───────────────────────── messages deleted for good ───────────────────────── */

  /**
   * Settles what came from messages deleted for good: the Trash emptied,
   * an expunge from another client. A message is taken as deleted only once
   * it has been missing from every folder for a while and its account's
   * folders are all synced — a move, or a cache being rebuilt, never closes
   * anything. What was open from it is closed as not needed, its replies
   * and proposals with it; its note stays, as history.
   */
  async settleDeleted(now = Date.now()): Promise<number> {
    await this.sql.run(
      `INSERT OR IGNORE INTO ai_gone (account_id, message_key, since)
       SELECT DISTINCT a.account_id, a.message_key, ? FROM (
         SELECT account_id, message_key FROM ai_items WHERE status IN ('aperta', 'rinviata')
         UNION SELECT account_id, message_key FROM ai_ready_drafts WHERE status IN ('pronta', 'da_rivedere')
         UNION SELECT account_id, message_key FROM ai_proposals WHERE status = 'aperta' AND message_key IS NOT NULL
       ) a
       WHERE EXISTS (SELECT 1 FROM accounts c WHERE c.id = a.account_id)
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.account_id = a.account_id AND m.message_key = a.message_key)`,
      now
    )
    await this.sql.run(
      `DELETE FROM ai_gone WHERE EXISTS (
         SELECT 1 FROM messages m WHERE m.account_id = ai_gone.account_id AND m.message_key = ai_gone.message_key
       ) OR NOT EXISTS (SELECT 1 FROM accounts c WHERE c.id = ai_gone.account_id)`
    )

    const confirmed = await this.sql.all<{ account_id: string; message_key: string }>(
      `SELECT g.account_id, g.message_key FROM ai_gone g
       WHERE g.since <= ?
         AND EXISTS (SELECT 1 FROM folders f WHERE f.account_id = g.account_id)
         AND NOT EXISTS (
           SELECT 1 FROM folders f WHERE f.account_id = g.account_id AND f.last_synced_at IS NULL
         )`,
      now - GONE_AFTER_MS
    )

    for (const gone of confirmed) {
      const items = (
        await this.sql.all<{ id: number }>(
          `SELECT id FROM ai_items WHERE account_id = ? AND message_key = ? AND status IN ('aperta', 'rinviata')`,
          gone.account_id,
          gone.message_key
        )
      ).map((row) => Number(row.id))

      for (const id of items) {
        await this.setCommitmentStatus(
          id,
          'non_serve',
          { by: 'sistema' },
          {
            reason: 'Il messaggio da cui nasceva è stato eliminato.'
          }
        )
      }

      const reply = await this.replies.get(gone.account_id, gone.message_key)

      if (reply && (reply.status === 'pronta' || reply.status === 'da_rivedere')) {
        await this.setReplyStatus(gone.account_id, gone.message_key, 'superata', { by: 'sistema' })
      }

      await this.proposals.supersedeFor(gone.account_id, [gone.message_key])
      await this.sql.run(
        'DELETE FROM ai_gone WHERE account_id = ? AND message_key = ?',
        gone.account_id,
        gone.message_key
      )
    }

    return confirmed.length
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private emit(change: RegistryChange): RegistryChange {
    this.hooks.changed(change)
    return change
  }

  private emitProject(record: ProjectRecord, action: string, label: string): void {
    this.emit({
      object: 'progetto',
      action,
      label,
      accountId: null,
      threadIds: [],
      messageKeys: [],
      projectIds: [record.id],
      id: record.id
    })
  }

  private mapKeys(rows: unknown[]): Array<{ accountId: string; messageKey: string }> {
    return (rows as Array<{ account_id: string; message_key: string }>).map((row) => ({
      accountId: row.account_id,
      messageKey: row.message_key
    }))
  }
}
