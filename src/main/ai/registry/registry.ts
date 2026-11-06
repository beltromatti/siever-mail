import type { HandleLink } from '@shared/segretario'

import { movedUnder } from '../../files/paths'
import { placeholders, type Sql } from '../sql'
import { CommitmentStore } from './commitments'
import { DayStore } from './day'
import { NoteStore, type NoteInput } from './notes'
import { ProjectStore } from './projects'
import { CopyStore, ProposalStore } from './proposals'
import { ReplyStore } from './replies'
import {
  OWED_KINDS,
  type Actor,
  type CommitmentKind,
  type CommitmentOrigin,
  type CommitmentRecord,
  type CommitmentStatus,
  type Evidence,
  type MessageAnchor,
  type NoteRecord,
  type ProjectRecord,
  type ProjectResourceKind,
  type ProposalRecord,
  type ProposalStatus,
  type RegistryChange,
  type ReplyKind,
  type ReplyRecord,
  type ReplyStatus,
  type SavedCopy,
  type ThreadRef,
  type UndoSpec,
  SYSTEM,
  USER
} from './types'

/** A view of the Segretario's, by what it holds. */
export type RegistryView = 'da-gestire' | 'in-attesa' | 'bozze-pronte'

export interface RegistryHooks {
  /** Something changed, by whom: the views showing it refresh, the run's diary records it. */
  changed(change: RegistryChange, actor: Actor): void
  /** The user corrected or decided something: a lesson for the reflection. */
  lesson(kind: string, payload: Record<string, unknown>): void
}

/** How long a message must stay missing before it is taken as deleted. */
const GONE_AFTER_MS = 30 * 60 * 1000

/** Where a lesson about an open thing comes from: its message or its event; nothing for the user's word. */
function lessonSource(
  record: CommitmentRecord
): { messaggio: { accountId: string; messageKey: string } } | { evento: string } | object {
  const { origin } = record
  return origin.kind === 'messaggio'
    ? { messaggio: { accountId: origin.accountId, messageKey: origin.messageKey } }
    : origin.kind === 'evento'
      ? { evento: origin.eventKey }
      : {}
}

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
  readonly day: DayStore

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
    this.day = new DayStore(sql)
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
        messaggio: { accountId: record.accountId, messageKey: record.messageKey },
        prima: { sintesi: before.summary, natura: before.nature, importanza: before.priority },
        dopo: { sintesi: record.summary, natura: record.nature, importanza: record.priority }
      })
    }

    return {
      record,
      change: this.emit(
        {
          object: 'nota',
          action: created ? 'scritta' : 'corretta',
          label: `${created ? 'Nota' : 'Nota corretta'}: ${record.summary}`,
          accountId: anchor.accountId,
          threadIds: [anchor.threadId],
          messageKeys: [anchor.messageKey],
          projectIds,
          id: `${anchor.accountId}:${anchor.messageKey}`
        },
        actor
      )
    }
  }

  /* ───────────────────────────── commitments ───────────────────────────── */

  /**
   * Where a change to an open thing shows, from where it comes: its
   * message's account and conversation, and the projects that gather it —
   * the conversation's, or the event's — whose "Il punto" is now behind.
   */
  private async commitmentPlace(
    record: CommitmentRecord
  ): Promise<Pick<RegistryChange, 'accountId' | 'threadIds' | 'messageKeys' | 'projectIds'>> {
    const { origin } = record

    if (origin.kind === 'messaggio') {
      return {
        accountId: origin.accountId,
        threadIds: [origin.threadId],
        messageKeys: [origin.messageKey],
        projectIds: await this.projects.markStaleByThreads([origin])
      }
    }

    const projectIds =
      origin.kind === 'evento'
        ? await this.projects.markStaleByEvents([origin.eventKey])
        : origin.projectId
          ? [origin.projectId]
          : []

    if (origin.kind === 'utente' && origin.projectId) {
      await this.projects.markStale([origin.projectId])
    }

    return { accountId: null, threadIds: [], messageKeys: [], projectIds }
  }

  async openCommitment(
    origin: CommitmentOrigin & { dateIso?: string },
    input: { kind: CommitmentKind; text: string; due?: string | null; question?: string | null },
    actor: Actor
  ): Promise<{ record: CommitmentRecord; created: boolean; change: RegistryChange | null }> {
    const { record, created, historyId } = await this.commitments.create(origin, input, actor)

    if (!created) {
      return { record, created, change: null }
    }

    return {
      record,
      created,
      change: this.emit(
        {
          object: 'impegno',
          action: 'aperta',
          label: `Aperta (${KIND_WORDS[record.kind]}): ${record.text}`,
          ...(await this.commitmentPlace(record)),
          id: record.id,
          undo: historyId ? { kind: 'impegno', itemId: record.id, historyId } : undefined
        },
        actor
      )
    }
  }

  async editCommitment(
    id: number,
    changes: {
      text?: string
      due?: string | null
      kind?: CommitmentKind
      question?: string | null
      origin?: CommitmentOrigin
    },
    actor: Actor,
    options: { seenRevision?: number; evidence?: Evidence; reason?: string } = {}
  ): Promise<{ record: CommitmentRecord; change: RegistryChange }> {
    const before = await this.commitments.get(id)
    const { record, historyId } = await this.commitments.edit(id, changes, actor, options)
    const place = await this.commitmentPlace(record)

    if (actor.by === 'utente' && before) {
      this.hooks.lesson('impegno_corretto', {
        ...lessonSource(record),
        impegno: record.id,
        prima: { tipo: before.kind, testo: before.text, scadenza: before.due },
        dopo: { tipo: record.kind, testo: record.text, scadenza: record.due }
      })
    }

    return {
      record,
      change: this.emit(
        {
          object: 'impegno',
          action: 'aggiornata',
          label: `Precisata: ${record.text}${record.due ? ` (entro il ${record.due})` : ''}`,
          ...place,
          id: record.id,
          undo: { kind: 'impegno', itemId: record.id, historyId }
        },
        actor
      )
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

    const place = await this.commitmentPlace(record)

    if (actor.by === 'utente' && before) {
      // What teaches: a thing the Segretario opened that was not needed, one it closed that was
      // not done, the answer to what it asked.
      if (
        status === 'non_serve' ||
        (status === 'aperta' && before.status !== 'aperta' && before.setBy === 'segretario')
      ) {
        this.hooks.lesson(status === 'non_serve' ? 'impegno_non_serve' : 'impegno_riaperto', {
          ...lessonSource(record),
          impegno: record.id,
          tipo: record.kind,
          testo: record.text,
          prima: before.status,
          motivo: options.reason ?? null
        })
      } else if (before.question) {
        this.hooks.lesson('domanda_risposta', {
          ...lessonSource(record),
          impegno: record.id,
          tipo: record.kind,
          testo: record.text,
          domanda: before.question,
          risposta: status === before.status ? 'ancora aperta' : STATUS_LABELS[status]
        })
      }
    }

    const until = status === 'rinviata' && record.until ? ` fino al ${record.until}` : ''
    return {
      record,
      change: this.emit(
        {
          object: 'impegno',
          action: status,
          label: `${before?.status === status ? 'Ancora aperta' : STATUS_LABELS[status]}${until}: ${record.text}`,
          ...place,
          id: record.id,
          undo: { kind: 'impegno', itemId: record.id, historyId }
        },
        actor
      )
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
        const place = await this.commitmentPlace(record)
        changes.push(
          this.emit(
            {
              object: 'impegno',
              action: 'unita',
              label: `Unita a #${keepId}: ${record.text}`,
              ...place,
              id: record.id,
              undo: { kind: 'impegno', itemId: record.id, historyId }
            },
            actor
          )
        )
      }
    }

    return changes
  }

  async undoCommitment(historyId: number, actor: Actor): Promise<CommitmentRecord | null> {
    const undone = await this.commitments.undo(historyId, actor)

    if (!undone) {
      return null
    }

    const place = await this.commitmentPlace(undone.record)
    this.emit(
      {
        object: 'impegno',
        action: 'annullata',
        label: `Annullato: ${undone.record.text}`,
        ...place,
        id: undone.record.id
      },
      actor
    )
    return undone.record
  }

  /** What was put off until today is open again. */
  async wakeDeferred(today: string): Promise<CommitmentRecord[]> {
    const woken = await this.commitments.wakeDeferred(today)
    const actor = SYSTEM

    for (const record of woken) {
      // Open again, it is news for its projects: their "Il punto" is behind.
      const place = await this.commitmentPlace(record)
      this.emit(
        {
          object: 'impegno',
          action: 'aperta',
          label: `Di nuovo aperta: ${record.text}`,
          ...place,
          id: record.id
        },
        actor
      )
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
      this.emit(
        {
          object: 'progetto',
          action: 'creato',
          label: `Nuovo progetto: ${result.record.title}`,
          accountId: null,
          threadIds: [],
          messageKeys: [],
          projectIds: [result.record.id],
          id: result.record.id,
          undo: { kind: 'progetto-creato', projectId: result.record.id }
        },
        actor
      )
    }

    return result
  }

  /** Takes away a project made by mistake (the undo of its creation). */
  async removeProject(id: string, actor: Actor): Promise<ProjectRecord> {
    const record = await this.projects.remove(id)
    this.emitProject(record, 'eliminato', `Tolto il progetto: ${record.title}`, actor)
    return record
  }

  async renameProject(
    id: string,
    title: string,
    actor: Actor,
    seenRevision?: number
  ): Promise<ProjectRecord> {
    const before = await this.projects.get(id)
    const record = await this.projects.rename(id, title, actor, seenRevision)

    if (actor.by === 'utente' && before && before.title !== record.title) {
      this.hooks.lesson('progetto_rinominato', { prima: before.title, dopo: record.title })
    }

    this.emitProject(
      record,
      'rinominato',
      `Progetto rinominato: ${before?.title ?? ''} → ${record.title}`,
      actor,
      before && before.title !== record.title
        ? { kind: 'progetto-rinominato', projectId: id, title: before.title }
        : undefined
    )
    return record
  }

  async describeProject(
    id: string,
    description: string,
    actor: Actor,
    seenRevision?: number
  ): Promise<ProjectRecord> {
    const record = await this.projects.describe(id, description, actor, seenRevision)
    this.emitProject(record, 'descritto', `Di cosa si tratta: ${record.title}`, actor)
    return record
  }

  /** "Il punto", with what its short names stand for; `basisAt` is when its writer last saw the project. */
  async setProjectState(
    id: string,
    state: string,
    links: ReadonlyArray<HandleLink>,
    basisAt: number,
    actor: Actor,
    seenRevision?: number
  ): Promise<ProjectRecord> {
    const record = await this.projects.setState(id, state, links, basisAt, seenRevision)
    this.emitProject(record, 'punto', `Il punto aggiornato: ${record.title}`, actor)
    return record
  }

  async setProjectHidden(
    id: string,
    hidden: boolean,
    actor: Actor,
    seenRevision?: number
  ): Promise<ProjectRecord> {
    const record = await this.projects.setHidden(id, hidden, actor, seenRevision)

    if (actor.by === 'utente' && hidden) {
      this.hooks.lesson('progetto_nascosto', { progetto: record.title })
    }

    this.emitProject(
      record,
      hidden ? 'nascosto' : 'mostrato',
      `${hidden ? 'Nascosto' : 'Di nuovo visibile'}: ${record.title}`,
      actor,
      { kind: 'progetto-nascosto', projectId: id, hidden }
    )
    return record
  }

  async setProjectClosed(
    id: string,
    closed: boolean,
    actor: Actor,
    seenRevision?: number
  ): Promise<ProjectRecord> {
    const record = await this.projects.setClosed(id, closed, actor, seenRevision)
    this.emitProject(
      record,
      closed ? 'chiuso' : 'riaperto',
      `${closed ? 'Concluso' : 'Riaperto'}: ${record.title}`,
      actor
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

    this.emit(
      {
        object: 'progetto',
        action: 'uniti',
        label: `Uniti in ${record.title}: ${dropped.map((project) => project.title).join(', ')}`,
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [record.id, ...dropIds],
        id: record.id
      },
      actor
    )
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

    return this.emit(
      {
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
      },
      actor
    )
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

    return this.emit(
      {
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
      },
      actor
    )
  }

  async addProjectResource(
    projectId: string,
    resource: { kind: ProjectResourceKind; location: string; label?: string | null },
    actor: Actor
  ): Promise<void> {
    await this.projects.addResource(projectId, resource, actor)

    // An appointment in the project changes where it stands: "Il punto" is behind.
    if (resource.kind === 'evento') {
      await this.projects.markStale([projectId])
    }

    const project = await this.projects.get(projectId)
    this.emit(
      {
        object: 'progetto',
        action: 'risorsa',
        label: `Collegata a ${project?.title ?? 'un progetto'}: ${resource.label ?? resource.location}`,
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [projectId],
        id: projectId
      },
      actor
    )
  }

  async removeProjectResource(projectId: string, location: string, actor: Actor): Promise<void> {
    const removed = (await this.projects.resources(projectId)).find(
      (resource) => resource.location === location
    )
    await this.projects.removeResource(projectId, location, actor)

    if (removed?.kind === 'evento') {
      await this.projects.markStale([projectId])
    }

    this.emit(
      {
        object: 'progetto',
        action: 'risorsa-tolta',
        label: `Tolta: ${removed?.label ?? location}`,
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [projectId],
        id: projectId
      },
      actor
    )
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
      change: this.emit(
        {
          object: 'risposta',
          action: created ? 'preparata' : 'riscritta',
          label:
            record.kind === 'sollecito'
              ? `Sollecito ${created ? 'preparato' : 'riscritto'}`
              : `Risposta ${created ? 'preparata' : 'riscritta'}`,
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
        },
        actor
      )
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

    this.emit(
      {
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
      },
      actor
    )
    return record
  }

  /** A newer message came in a conversation: the replies prepared before it are to be looked at again. */
  async markRepliesStale(
    thread: ThreadRef,
    beforeIso: string,
    reason: string
  ): Promise<ReplyRecord[]> {
    const stale = await this.replies.markStaleBefore(thread, beforeIso, reason)
    const actor = SYSTEM

    if (stale.length > 0) {
      this.emit(
        {
          object: 'risposta',
          action: 'da_rivedere',
          label: `Da rivedere: ${reason}`,
          accountId: thread.accountId,
          threadIds: [thread.threadId],
          messageKeys: stale.map((reply) => reply.messageKey),
          projectIds: [],
          id: `${thread.accountId}:${thread.threadId}`
        },
        actor
      )
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
      replaces?: string | null
      perMessage?: boolean
    },
    actor: Actor
  ): Promise<ProposalRecord> {
    const { record, created } = await this.proposals.propose(input, actor)
    this.emit(
      {
        object: 'proposta',
        action: created ? 'proposta' : 'aggiornata',
        label: `Proposta: ${record.title}`,
        accountId: record.accountId,
        threadIds: record.threadId ? [record.threadId] : [],
        messageKeys: record.messageKey ? [record.messageKey] : [],
        projectIds: [],
        id: record.id
      },
      actor
    )
    return record
  }

  /** The Segretario takes back a proposal of its own that no longer holds: no lesson, it is not the user's word. */
  async withdrawProposal(id: string, reason: string, actor: Actor): Promise<ProposalRecord> {
    const record = await this.proposals.decide(id, 'superata', { motivo: reason })
    this.emit(
      {
        object: 'proposta',
        action: 'superata',
        label: `Ritirata: ${record.title} (${reason})`,
        accountId: record.accountId,
        threadIds: record.threadId ? [record.threadId] : [],
        messageKeys: record.messageKey ? [record.messageKey] : [],
        projectIds: [],
        id: record.id
      },
      actor
    )
    return record
  }

  async decideProposal(
    id: string,
    status: Exclude<ProposalStatus, 'aperta'>,
    result: Record<string, unknown> | null = null
  ): Promise<ProposalRecord> {
    const record = await this.proposals.decide(id, status, result)
    const actor = USER

    // What teaches is what the user changed or refused: an event taken as it was proposed says
    // only that it was right — like a draft sent as written, nothing to learn a rule from.
    if (status !== 'accettata' || record.kind !== 'evento') {
      this.hooks.lesson(status === 'accettata' ? 'proposta_accettata' : 'proposta_scartata', {
        tipo: record.kind,
        proposta: record.title,
        dati: record.payload,
        scelta: result
      })
    }
    this.emit(
      {
        object: 'proposta',
        action: status,
        label: `${status === 'accettata' ? 'Accettata' : 'Scartata'}: ${record.title}`,
        accountId: record.accountId,
        threadIds: record.threadId ? [record.threadId] : [],
        messageKeys: record.messageKey ? [record.messageKey] : [],
        projectIds: [],
        id: record.id
      },
      actor
    )
    return record
  }

  /**
   * A folder moved — the archive's root, to where it is now: what is kept
   * under it — copies saved there, projects' folders — kept under the new
   * place. How many were.
   */
  async relocatePaths(from: string, to: string): Promise<number> {
    const moved = movedUnder(from, to)
    return (await this.copies.relocate(moved)) + (await this.projects.relocateFolders(moved))
  }

  async saveCopies(copies: ReadonlyArray<Omit<SavedCopy, 'savedAt'>>, actor: Actor): Promise<void> {
    await this.copies.save(copies)

    for (const accountId of new Set(copies.map((copy) => copy.accountId))) {
      const mine = copies.filter((copy) => copy.accountId === accountId)
      this.emit(
        {
          object: 'copia',
          action: 'salvata',
          label: `Salvat${mine.length === 1 ? 'o' : 'i'} in ${mine[0].destination}`,
          accountId,
          threadIds: [...new Set(mine.map((copy) => copy.threadId))],
          messageKeys: mine.map((copy) => copy.messageKey),
          projectIds: [],
          id: mine[0].messageKey
        },
        actor
      )
    }
  }

  /* ──────────────────────────────── views ──────────────────────────────── */

  /**
   * The messages a view holds, by key: those from which something open
   * comes that the user owes (`da-gestire`) or waits for (`in-attesa`), or
   * that have a reply ready (`bozze-pronte`). Where the message is filed
   * does not count; the mail service drops what is only in the Trash or Spam.
   * What is open from an event or the user's word is no message's: it is not
   * in the mail's views.
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
         WHERE status = 'aperta' AND message_key IS NOT NULL
           AND kind IN (${placeholders(kinds)}) ${accounts}`,
        ...kinds,
        ...(accountIds ?? [])
      )
    )
  }

  /**
   * What is open from each of these messages of an account, the reply
   * prepared for it, whether a copy of it was saved outside: what their
   * rows show.
   */
  async rowWork(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<
    Map<
      string,
      {
        owed: { kind: CommitmentKind; due: string | null } | null
        awaited: boolean
        reply: 'pronta' | 'da_rivedere' | null
        saved: boolean
      }
    >
  > {
    const work = new Map<
      string,
      {
        owed: { kind: CommitmentKind; due: string | null } | null
        awaited: boolean
        reply: 'pronta' | 'da_rivedere' | null
        saved: boolean
      }
    >()

    if (messageKeys.length === 0) {
      return work
    }

    const entry = (key: string): NonNullable<ReturnType<typeof work.get>> => {
      const known = work.get(key) ?? { owed: null, awaited: false, reply: null, saved: false }
      work.set(key, known)
      return known
    }
    // The soonest due first, those without a date last.
    const items = await this.sql.all<{
      message_key: string
      kind: CommitmentKind
      due: string | null
    }>(
      `SELECT message_key, kind, due FROM ai_items
       WHERE account_id = ? AND status = 'aperta' AND message_key IN (${placeholders(messageKeys)})
       ORDER BY due IS NULL, due`,
      accountId,
      ...messageKeys
    )

    for (const item of items) {
      const known = entry(item.message_key)

      if (item.kind === 'aspetti') {
        known.awaited = true
      } else if (!known.owed) {
        known.owed = { kind: item.kind, due: item.due }
      }
    }

    const replies = await this.sql.all<{ message_key: string; status: 'pronta' | 'da_rivedere' }>(
      `SELECT message_key, status FROM ai_ready_drafts
       WHERE account_id = ? AND status IN ('pronta', 'da_rivedere') AND message_key IN (${placeholders(messageKeys)})`,
      accountId,
      ...messageKeys
    )

    for (const reply of replies) {
      entry(reply.message_key).reply = reply.status
    }

    const copies = await this.sql.all<{ message_key: string }>(
      `SELECT DISTINCT message_key FROM ai_saved_copies
       WHERE account_id = ? AND message_key IN (${placeholders(messageKeys)})`,
      accountId,
      ...messageKeys
    )

    for (const copy of copies) {
      entry(copy.message_key).saved = true
    }

    return work
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
        `SELECT account_id, message_key FROM ai_items
         WHERE status = 'aperta' AND message_key IS NOT NULL ${accounts}
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
         -- Every folder read since it went missing: moved to one not read yet, it is not gone.
         AND NOT EXISTS (
           SELECT 1 FROM folders f WHERE f.account_id = g.account_id
             AND (f.last_synced_at IS NULL OR f.last_synced_at < g.since)
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

  /* ──────────────────────────────── the day ──────────────────────────────── */

  /** The letter at the top of Oggi, for a day. */
  async saveLetter(
    day: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    actor: Actor
  ): Promise<void> {
    await this.day.saveLetter(day, text, links)
    this.emit(
      {
        object: 'giornata',
        action: 'lettera',
        label: 'Scritta la lettera di oggi',
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [],
        id: day
      },
      actor
    )
  }

  /** How to prepare for a meeting, under the event. */
  async savePrep(
    eventKey: string,
    title: string,
    text: string,
    links: ReadonlyArray<HandleLink>,
    actor: Actor
  ): Promise<void> {
    await this.day.savePrep(eventKey, text, links, actor.runId ?? null)
    this.emit(
      {
        object: 'giornata',
        action: 'preparazione',
        label: `Preparata la riunione: ${title}`,
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [],
        id: eventKey
      },
      actor
    )
  }

  private emit(change: RegistryChange, actor: Actor): RegistryChange {
    this.hooks.changed(change, actor)
    return change
  }

  private emitProject(
    record: ProjectRecord,
    action: string,
    label: string,
    actor: Actor,
    undo?: UndoSpec
  ): void {
    this.emit(
      {
        object: 'progetto',
        action,
        label,
        accountId: null,
        threadIds: [],
        messageKeys: [],
        projectIds: [record.id],
        id: record.id,
        undo
      },
      actor
    )
  }

  private mapKeys(rows: unknown[]): Array<{ accountId: string; messageKey: string }> {
    return (rows as Array<{ account_id: string; message_key: string }>).map((row) => ({
      accountId: row.account_id,
      messageKey: row.message_key
    }))
  }
}
