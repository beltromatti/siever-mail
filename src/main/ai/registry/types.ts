/**
 * The registry: the state of the user's work as the Segretario keeps it —
 * what each message said, what is open, the projects, the replies
 * prepared, the proposals. Not memory:
 * these are facts the interface shows and other runs rely on, so they live
 * in tables with invariants, and change only through the registry.
 */

import type { EventChange, NewCalendarEvent } from '@shared/calendar'
import type { HandleLink } from '@shared/segretario'

/** Who changed something: the user, the Segretario (in a run), or the app itself. */
export type ActorKind = 'utente' | 'segretario' | 'sistema'

export interface Actor {
  by: ActorKind
  /** The run (activity) that did it, for the Segretario. */
  runId?: string | null
  /**
   * A run of the Segretario's own, in the background: it reads mail it
   * cannot trust and nobody watches it, so it never overturns what the
   * user decided without something newer to show for it.
   */
  background?: boolean
}

export const USER: Actor = { by: 'utente' }
export const SYSTEM: Actor = { by: 'sistema' }

/** A message by its stable key in its account, with its conversation. */
export interface MessageAnchor {
  accountId: string
  messageKey: string
  threadId: string
}

export interface ThreadRef {
  accountId: string
  threadId: string
}

/* ─────────────────────────────── notes ─────────────────────────────── */

/**
 * What a message is, for the user: it asks a reply, asks something done,
 * waits on someone, informs, or is noise. A note says what the message
 * said when it came: it is history, written once and corrected only when
 * it was wrong — what is still to do lives in the commitments.
 */
export type NoteNature = 'da_rispondere' | 'da_fare' | 'in_attesa' | 'informativo' | 'rumore'
export type NotePriority = 'alta' | 'media' | 'bassa'

export interface NoteRecord extends MessageAnchor {
  direction: 'in' | 'out'
  summary: string
  nature: NoteNature
  priority: NotePriority
  reason: string
  /** The date to act by, AAAA-MM-GG. */
  due: string | null
  messageDate: string
  /** The same message came to another of the user's accounts, read there: this copies that note. */
  twinAccountId: string | null
  /** The Segretario said to tell the user of the message now, with a notification (§13.3). */
  notify: boolean
  revision: number
  runId: string | null
  /** Who wrote it last: a note the user corrected is not rewritten by a run in the background. */
  writtenBy: ActorKind
  createdAt: number
  updatedAt: number
}

/* ───────────────────────────── commitments ───────────────────────────── */

export type CommitmentKind = 'ti_chiedono' | 'hai_promesso' | 'aspetti' | 'da_fare'

/**
 * `aperta` until it is done (`fatta`), turns out not to be needed
 * (`non_serve`), or is put off to a day (`rinviata`, open again on
 * `until`). Any of them can be opened again.
 */
export type CommitmentStatus = 'aperta' | 'fatta' | 'non_serve' | 'rinviata'

/** What the user owes, as opposed to what they wait for. */
export const OWED_KINDS: ReadonlyArray<CommitmentKind> = ['ti_chiedono', 'hai_promesso', 'da_fare']

/**
 * Where an open thing comes from: a message (with its conversation), an
 * event, or — neither — the user's word, said to the Segretario or written
 * by hand. In the table, the message's columns and the event's, both empty
 * for the user's word.
 */
export type CommitmentOrigin =
  | ({ kind: 'messaggio' } & MessageAnchor)
  | { kind: 'evento'; eventKey: string }
  /** The user's word, with the project it is about when there is one. */
  | { kind: 'utente'; projectId?: string }

export interface CommitmentRecord {
  id: number
  origin: CommitmentOrigin
  kind: CommitmentKind
  text: string
  due: string | null
  status: CommitmentStatus
  /** For `rinviata`: the day it opens again. */
  until: string | null
  /** Who made its last change of status, and why. */
  setBy: ActorKind
  reason: string | null
  /** The message that showed it done, not needed or open again. */
  evidenceKey: string | null
  /** A question for the user, when the Segretario cannot tell whether it is still open. */
  question: string | null
  createdBy: ActorKind
  runId: string | null
  revision: number
  createdAt: number
  updatedAt: number
  closedAt: number | null
}

/** A message given as proof of a change: where it is, and when it came — newer than a decision it overturns. */
export interface Evidence {
  messageKey: string
  dateIso: string
}

export interface CommitmentHistoryEntry {
  id: number
  itemId: number
  at: number
  actor: ActorKind
  runId: string | null
  action: string
  before: Partial<CommitmentRecord> | null
  after: Partial<CommitmentRecord>
  reason: string | null
}

/* ─────────────────────────────── projects ─────────────────────────────── */

export interface ProjectRecord {
  id: string
  title: string
  /** Who named it: a name the user gave is kept. */
  titleBy: ActorKind
  /** What it is about, in a line or two. */
  description: string | null
  /** "Il punto": where it stands now, what its short names stand for, and when it was written. */
  state: string | null
  stateLinks: HandleLink[]
  stateAt: number | null
  /** Since when "Il punto" no longer tells the whole story: something moved after it. */
  staleSince: number | null
  origin: ActorKind
  hiddenAt: number | null
  closedAt: number | null
  /** Who concluded it — or, when it is open, opened it again; null for neither. */
  closedBy: ActorKind | null
  activeAt: number | null
  revision: number
  createdAt: number
  updatedAt: number
}

export interface ProjectSummary extends ProjectRecord {
  conversations: number
  openCommitments: number
  /** The date of its newest message with a note. */
  lastMessageAt: string | null
}

/**
 * What a project gathers besides its conversations, from any source: a
 * folder on the computer or a network volume (later a drive's), an event
 * (by its key, its title as the label), a link.
 */
export type ProjectResourceKind = 'cartella' | 'evento' | 'link'

export interface ProjectResource {
  id: number
  projectId: string
  kind: ProjectResourceKind
  location: string
  label: string | null
  addedBy: ActorKind
}

export interface ProjectLink extends ThreadRef {
  projectId: string
  linkedBy: ActorKind
  /** The user said this conversation is not of the project: never filed there again. */
  rejected: boolean
}

/* ──────────────────────────── replies prepared ──────────────────────────── */

export type ReplyKind = 'risposta' | 'sollecito'

/**
 * `pronta` to use; `da_rivedere` when a newer message came in its
 * conversation (kept, not counted as ready); `usata`, `scartata`, or
 * `superata` by another reply.
 */
export type ReplyStatus = 'pronta' | 'da_rivedere' | 'usata' | 'scartata' | 'superata'

export interface ReplyRecord extends MessageAnchor {
  kind: ReplyKind
  text: string
  doubts: string
  status: ReplyStatus
  /** Why it is to be looked at again. */
  staleReason: string | null
  revision: number
  runId: string | null
  createdAt: number
  updatedAt: number
}

/* ────────────────────────────── proposals ────────────────────────────── */

/**
 * Something the Segretario recommends but may not do on its own — an event
 * with guests, a copy into a company archive — waiting for the user.
 */
export type ProposalStatus = 'aperta' | 'accettata' | 'scartata' | 'superata'

export interface ProposalRecord {
  id: string
  kind: string
  accountId: string | null
  messageKey: string | null
  threadId: string | null
  title: string
  payload: Record<string, unknown>
  status: ProposalStatus
  runId: string | null
  /** Up by one each time a run writes it again. */
  revision: number
  createdAt: number
  decidedAt: number | null
  result: Record<string, unknown> | null
}

/* ─────────────────────────────── changes ─────────────────────────────── */

/**
 * What a change touched, for the views to refresh and the diary to show.
 * `undo` is what puts it back, when it can be put back.
 */
export interface RegistryChange {
  object:
    'nota' | 'impegno' | 'progetto' | 'risposta' | 'proposta' | 'copia' | 'evento' | 'giornata'
  action: string
  /** One line for the diary: "Aperta: mandare il computo a Giulia". */
  label: string
  accountId: string | null
  threadIds: string[]
  messageKeys: string[]
  projectIds: string[]
  /** The registry's id of what changed. */
  id: string | number
  undo?: UndoSpec
}

export type UndoSpec =
  | { kind: 'impegno'; itemId: number; historyId: number }
  | {
      kind: 'progetto-collegamento'
      projectId: string
      accountId: string
      threadId: string
      linked: boolean
    }
  | { kind: 'risposta'; accountId: string; messageKey: string; status: ReplyStatus }
  /** A project the Segretario made: undone, it goes, unless the user has worked on it since. */
  | { kind: 'progetto-creato'; projectId: string }
  /** A project it renamed: undone, it has its old name. */
  | { kind: 'progetto-rinominato'; projectId: string; title: string }
  /** A project it hid or showed again: undone, it is as it was. */
  | { kind: 'progetto-nascosto'; projectId: string; hidden: boolean }
  /** An event the Segretario put in the calendar: undone, it goes. */
  | { kind: 'evento-creato'; eventKey: string }
  /** An event it changed: undone, it is as it was. */
  | { kind: 'evento-modificato'; eventKey: string; before: EventChange }
  /** An event it took away: undone, it is put back as it was. */
  | { kind: 'evento-eliminato'; event: NewCalendarEvent }

/** A change was refused: the conflict or the rule, said so the model can act on it. */
export class RegistryRefusal extends Error {
  constructor(
    message: string,
    /** The object as it is now, for the caller to look at again. */
    readonly current?: unknown
  ) {
    super(message)
    this.name = 'RegistryRefusal'
  }
}

/**
 * A write over a revision newer than the one read: someone wrote in
 * between. The message says what the object is now, so the caller has
 * seen it and may decide again — the same write included.
 */
export class RevisionConflict extends RegistryRefusal {
  constructor(
    message: string,
    readonly current: { revision: number }
  ) {
    super(message, current)
    this.name = 'RevisionConflict'
  }
}
