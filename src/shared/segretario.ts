import type { MessageRef } from './models'

/**
 * The Segretario: SIEVER Mail's agent. What the main process and the page
 * say to each other about it — the key and the switch, the user's work as
 * the Segretario keeps it (notes, commitments, projects, replies,
 * proposals), its runs and what happens in them.
 */

/* ──────────────────────────────── key and switch ──────────────────────────────── */

/** Where the OpenRouter key stands, as the last check found it. */
export type SegretarioKeyState =
  /** No key saved: the AI is off. */
  | 'missing'
  /** Saved and answered; `credit` says how much is left. */
  | 'ready'
  /** OpenRouter turned it down: revoked, mistyped, deleted. */
  | 'invalid'
  /** No credit left on the account, or the key reached its own limit. */
  | 'exhausted'
  /** It could not be checked: no network, OpenRouter down. Kept as it was. */
  | 'unchecked'

export interface SegretarioCredit {
  /** What can still be spent, in dollars: the lower of the account's balance and the key's limit. */
  available: number
  balance: number | null
  keyLimit: number | null
  keyRemaining: number | null
  keyLimitReset: string | null
}

export interface SegretarioStatus {
  keyState: SegretarioKeyState
  /** The key as OpenRouter labels it ("sk-or-v1-9b6…138"), never the key itself. */
  keyLabel: string | null
  credit: SegretarioCredit | null
  checkedAt: number | null
  problem: string | null
  /** The model in use, as OpenRouter names it. */
  modelName: string | null
}

/**
 * The AI is one switch: on, every function of the Segretario is there; off,
 * SIEVER Mail is a mail and calendar client with no trace of it, and what it
 * learnt is kept.
 */
export interface SegretarioPreferences {
  enabled: boolean
}

/** Off until the user turns it on, in the guided setup: the AI starts with Conoscimi, never by itself. */
export const DEFAULT_SEGRETARIO_PREFERENCES: SegretarioPreferences = { enabled: false }

/** How long a send waits for the Segretario's reread: past it the message goes as it is, and the reread stops. */
export const REVIEW_TIMEOUT_MS = 12_000

/** What the Segretario costs, in dollars, as OpenRouter billed each call. */
export interface SegretarioSpending {
  today: number
  thisMonth: number
  /** The last thirty days, by what it was spent on, the most first. */
  byFunction: Array<{ purpose: string; label: string; cost: number }>
}

/** Where the Segretario's own work stands: what it reads, what waits, what failed. */
export interface EngineState {
  /** The key was refused or the credit ran out: nothing runs until the user acts. */
  paused: string | null
  /** Of the messages of the last thirty days the Segretario reads, how many it has read. */
  reading: { read: number; total: number }
  /** Units of work waiting or running, by task. */
  queued: Partial<Record<TaskKind, number>>
  running: Partial<Record<TaskKind, number>>
  /** Units of work left failed after their attempts. */
  failed: number
}

/* ─────────────────────────────── the user's work ─────────────────────────────── */

/** Who changed something: the user, the Segretario, or the app itself. */
export type WorkActor = 'utente' | 'segretario' | 'sistema'

/** What a message asked of the user when it came, as the Segretario read it. */
export type NoteNature = 'da_rispondere' | 'da_fare' | 'in_attesa' | 'informativo' | 'rumore'
export type NotePriority = 'alta' | 'media' | 'bassa'

/**
 * What the Segretario wrote next to a message when it came (or left): the
 * one thing that counts, what it asked of the user, how much it matters.
 * History: what is still to do lives in the commitments.
 */
export interface MessageNote {
  accountId: string
  messageKey: string
  threadId: string
  direction: 'in' | 'out'
  summary: string
  nature: NoteNature
  priority: NotePriority
  reason: string
  due: string | null
  messageDate: string
  /** The same message came to another of the user's accounts: this copies that note. */
  twinAccountId: string | null
  writtenBy: WorkActor
}

export type CommitmentKind = 'ti_chiedono' | 'hai_promesso' | 'aspetti' | 'da_fare'

/** Open until done, not needed, or put off to a day; any of them can be opened again. */
export type CommitmentStatus = 'aperta' | 'fatta' | 'non_serve' | 'rinviata'

/** Something open between the user and someone: asked, promised, awaited, to do. */
/**
 * Where an open thing comes from, to open it: a message (with its
 * conversation), an event, or the user's word — said to the Segretario or
 * written by hand.
 */
export type CommitmentSource =
  | { kind: 'message'; accountId: string; threadId: string; messageKey: string }
  | { kind: 'event'; eventKey: string }
  | { kind: 'user' }

export interface Commitment {
  id: number
  source: CommitmentSource
  kind: CommitmentKind
  text: string
  due: string | null
  status: CommitmentStatus
  /** For `rinviata`: the day it opens again. */
  until: string | null
  /** Who made its last change of status, why, and the message that showed it. */
  setBy: WorkActor
  reason: string | null
  evidenceKey: string | null
  /** A question the Segretario asks the user about it: is it still open? */
  question: string | null
  createdAt: number
  updatedAt: number
}

/** A project a conversation is in, for a row's badge and the reader. */
export interface ProjectLabel {
  id: string
  title: string
}

/** An event's share of the work: the open things born from it (and those closed lately), its projects. */
export interface EventWork {
  commitments: Commitment[]
  projects: ProjectLabel[]
}

/** A reply prepared ahead, while it waits for the user. */
export interface PreparedReply {
  accountId: string
  messageKey: string
  kind: 'risposta' | 'sollecito'
  text: string
  doubts: string
  /** `da_rivedere` when the conversation moved on after it was written. */
  status: 'pronta' | 'da_rivedere'
  staleReason: string | null
}

/** Something the Segretario recommends and leaves the user to decide. */
export interface Proposal {
  id: string
  /** `evento`, or an extension's own (`archivia_siever`). */
  kind: string
  title: string
  payload: Record<string, unknown>
  accountId: string | null
  messageKey: string | null
  /** The version shown: an answer to an older one is refused, the proposal having changed. */
  revision: number
  createdAt: number
  /** Its message, where the proposal is shown away from it (Oggi): who wrote it and about what. */
  source?: { ref: MessageRef; from: string; subject: string }
}

/** A copy of a message saved outside the mail by an extension, as the message shows it. */
export interface SavedCopyInfo {
  /** What it is called: "Archiviato Siever". */
  label: string
  destination: string
  savedAt: number
}

/**
 * What the reader shows of a message: its note, what is open (and settled
 * lately) in its conversation, its projects, the reply prepared, the copies
 * saved, the proposals waiting.
 */
export interface MessageWork {
  note: MessageNote | null
  commitments: Commitment[]
  projects: ProjectLabel[]
  reply: PreparedReply | null
  copies: SavedCopyInfo[]
  proposals: Proposal[]
}

/**
 * What a message's row in a list shows of the Segretario's work: its note
 * — what it said — and what is open from it now, which is what decides.
 */
export interface MessageRowWork {
  accountId: string
  messageKey: string
  note: MessageNote | null
  /** The first of what the user owes from it, the soonest due first; null when nothing is owed. */
  owed: { kind: CommitmentKind; due: string | null } | null
  /** Something is awaited from it. */
  awaited: boolean
  /** A reply prepared for it: ready, or to look at again. */
  reply: 'pronta' | 'da_rivedere' | null
  /** A copy of it saved outside the mail by an extension, by its label ("Archiviato Siever"); null when none. */
  saved: string | null
}

/** Where an earlier copy went, and how near the messages it was: their conversation, or only their sender. */
export interface SavedBefore {
  destination: string
  /** `mittente`: no message of these conversations was saved, one from the same sender was — a hint, not the place. */
  from: 'conversazione' | 'mittente'
}

/** Where messages about to be saved outside the mail are likely to go, and what is proposed for them. */
export interface FilingContext {
  /** The latest copy of an earlier message of their conversations, or else of their senders. */
  savedBefore: SavedBefore | null
  /** The folders linked to the projects their conversations are in: where their work is kept. */
  projectFolders: string[]
  /** The proposals open on these messages, every kind: an extension takes its own. */
  proposals: Proposal[]
}

/* ──────────────────────────────── projects ──────────────────────────────── */

/**
 * A matter that lasts — a job, a practice, a negotiation, a match to
 * organise — and the conversations, folders and commitments that belong
 * to it, across the accounts.
 */
export interface Project {
  id: string
  title: string
  description: string | null
  /** "Il punto": where it stands, as last written; null until written. */
  state: string | null
  /** What the short names in "Il punto" stand for. */
  stateLinks: HandleLink[]
  stateAt: number | null
  /** Something moved after "Il punto" was written. */
  stale: boolean
  origin: WorkActor
  hidden: boolean
  closed: boolean
  conversations: number
  openCommitments: number
  lastMessageAt: string | null
}

export interface ProjectDetail extends Project {
  /** What it gathers besides its conversations: folders, events (by key, titled), links. */
  resources: Array<{ kind: 'cartella' | 'evento' | 'link'; location: string; label: string | null }>
  commitments: Commitment[]
}

/* ──────────────────────────────── the day ──────────────────────────────── */

/**
 * Where a line of the day comes from, to say it and to open it: a message
 * (who wrote it — "Tu" for the user, from any of their accounts —, its
 * subject, when), an event (its title, when it is), or the user's word
 * (when they said it).
 */
export type DayLineSource =
  | {
      kind: 'message'
      ref: MessageRef
      messageKey: string
      subject: string
      from: string
      date: string
    }
  /** An event; its title and start null once it is no longer in the calendar. */
  | {
      kind: 'event'
      eventKey: string
      title: string | null
      start: string | null
      allDay: boolean
    }
  | { kind: 'user'; date: string }

/** A line of the day's page, of the agenda and of a project: something to do, with what makes it count. */
export interface DayLine {
  text: string
  priority: NotePriority | null
  due: string | null
  commitment: Commitment | null
  readyKind?: 'risposta' | 'sollecito'
  source: DayLineSource
}

/** The day as the Segretario sees it: "Oggi". */
export interface TodayPage {
  day: string
  /** The letter at the top, and when it was written; null until written. */
  letter: string | null
  /** What the short names in the letter stand for. */
  letterLinks: HandleLink[]
  letterAt: number | null
  /** The day is being looked at again: a new letter is on its way. */
  letterRewriting: boolean
  /** Messages still to be read: while there are, the day is not complete. */
  reading: number
  /** Why the Segretario is stopped (the key, the credit, the connection), when it is. */
  paused: string | null
  /** What is due today, or overdue. */
  today: DayLine[]
  /** What is due in the next seven days. */
  week: DayLine[]
  /** What the user owes, without a date or later. */
  waiting: DayLine[]
  /** What the user waits on, the longest first. */
  awaited: DayLine[]
  /** Replies and reminders prepared, to look at. */
  ready: DayLine[]
  /** What the Segretario asks the user about: is it still open? */
  questions: DayLine[]
  proposals: Proposal[]
  /** Today's meetings with what the Segretario prepared for them, by event key. */
  preps: Record<string, LinkedText>
}

/** Words of the Segretario that stay, with what their short names stand for. */
export interface LinkedText {
  text: string
  links: HandleLink[]
}

/* ──────────────────────────────── writing ──────────────────────────────── */

/** What the user asks of the Segretario while writing a message. */
export interface WritingRequest {
  draftId: string
  accountId: string
  instruction: string
  writtenText: string
  selectedText: string | null
  subject: string
  to: string[]
  replyTo: MessageRef | null
}

/** A message about to be sent, for the Segretario to reread. */
export interface ReviewRequest {
  accountId: string
  to: string[]
  cc: string[]
  subject: string
  writtenText: string
  attachments: string[]
  replyTo: MessageRef | null
}

/** A search asked in words, as it was run: the list it makes. */
export interface AskedMail {
  id: string
  question: string
  summary: string
  how: string
  count: number
}

/** A search asked in words that the user kept as a folder. */
export interface SavedSearch {
  id: string
  question: string
  summary: string
  how: string
}

/** The user's work changed: the views showing these refresh. */
export interface WorkChange {
  accountIds: string[]
  threadIds: string[]
  messageKeys: string[]
  projectIds: string[]
}

/* ──────────────────────────────── memory ──────────────────────────────── */

export interface MemoryNote {
  path: string
  content: string
  updatedAt: number
  revision: number
  /** Who wrote it last: the user, or the Segretario. */
  updatedBy: 'utente' | 'segretario'
}

export interface MemoryVersion {
  revision: number
  content: string | null
  action: string
  actor: string
  at: number
}

/* ──────────────────────────────── the guided setup ──────────────────────────────── */

/**
 * Why the guided setup runs: the first launch; connections added; the AI
 * turned on for the first time, or again; Conoscimi done again.
 */
export type OnboardingCase =
  'primo-avvio' | 'nuova-connessione' | 'ai-prima-volta' | 'ai-riaccesa' | 'conoscimi'

/** Its steps, in their order: not every case has every one. */
export type OnboardingStep =
  'connessioni' | 'segretario' | 'preparazione' | 'conoscimi' | 'lettura' | 'entra'

/**
 * The guided setup under way, kept so that a quit in the middle of it
 * brings the user back to the same step.
 */
export interface OnboardingState {
  case: OnboardingCase
  step: OnboardingStep
  /** The connections it is for: the new ones, or every one; empty until there are. */
  accountIds: string[]
  /** The Conoscimi run of this setup, once started. */
  conoscimiId: string | null
  startedAt: number
  /**
   * The AI was turned on in this setup — its own case, or a new connection
   * added with the AI off and turned on along the way: everything then
   * waits for Conoscimi and the reading.
   */
  turnsAiOn?: boolean
}

/** Whether a setup is the one that turns the AI on: everything waits for it. */
export function setupTurnsAiOn(state: OnboardingState): boolean {
  return state.case === 'primo-avvio' ||
    state.case === 'ai-prima-volta' ||
    state.case === 'ai-riaccesa'
    ? true
    : state.turnsAiOn === true
}

/** Whether a connection's recent mail is in, read by the index: what the Segretario needs to start. */
export interface ConnectionReadiness {
  accountId: string
  recentMailIndexed: boolean
}

/** Where the reading of the last thirty days stands, for the setup to wait on it. */
export interface ReadingStatus {
  read: number
  total: number
  /** Conversations waiting or being read. */
  waiting: number
  running: number
  /** Conversations it could not read after its attempts: listed, retried later. */
  failed: Array<{ title: string; error: string | null }>
  /** Nothing left to read but what failed. */
  done: boolean
}

/** Whether the Segretario knows a connection — a mailbox or a calendar — from Conoscimi. */
export interface ConnectionLearning {
  /** The connection as Conoscimi records it: a mailbox's id, or `calendarLearningKey(id)`. */
  key: string
  kind: 'posta' | 'calendario'
  /** Its address, or a calendar's name. */
  label: string
  state: 'waiting' | 'running' | 'done'
  activityId: string | null
  finishedAt: number | null
}

/** A calendar connection as Conoscimi records it: apart from the mailboxes, whose ids it may share. */
export function calendarLearningKey(connectionId: string): string {
  return `calendario:${connectionId}`
}

/* ──────────────────────────────── runs ──────────────────────────────── */

/**
 * The moments the Segretario is woken in: one identity, many runs. Each is
 * a goal (`prompts/compiti/<task>.md`), the data it starts from, what it may
 * do without asking, and what it must leave.
 */
export type TaskKind =
  | 'richiesta'
  | 'lettura'
  | 'giornata'
  | 'punto'
  | 'calendario'
  | 'scrittura'
  | 'revisione'
  | 'ricerca'
  | 'conoscimi'
  | 'riflessione'
  | 'al_passo'

/** What a task is called for the user. */
export const TASK_LABELS: Readonly<Record<TaskKind, string>> = {
  richiesta: 'Richiesta',
  lettura: 'Lettura della posta',
  giornata: 'La giornata',
  punto: 'Il punto di un progetto',
  calendario: 'Calendario',
  scrittura: 'Scrittura',
  revisione: 'Revisione',
  ricerca: 'Ricerca in parole',
  conoscimi: 'Conoscimi',
  riflessione: 'Riflessione',
  al_passo: 'Al passo'
}

export type ActivityStatus = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

/** Where a run shows: the panel (the user's requests, Conoscimi), the diary (work on its own), nowhere (inline help). */
export type ActivityVisibility = 'pannello' | 'diario' | 'nascosta'

export interface ActivitySummary {
  id: string
  task: TaskKind
  title: string
  status: ActivityStatus
  createdAt: number
  updatedAt: number
  unseen: boolean
  cost: number
  visibility: ActivityVisibility
}

/** What the user is looking at when they write: the Segretario reads it as context. */
export interface SegretarioContext {
  messages: MessageRef[]
  accountId: string | null
  /** The folder, view, project or page in sight: "Posta in arrivo", "Progetto Hotel Lido", "Oggi". */
  folderLabel: string | null
  /** The calendar's event open in front of the user, by its key. */
  eventKey?: string | null
}

/** A step a tool took, as the user sees it: one line, and what it touched. */
export interface ToolActivity {
  callId: string
  name: string
  status: 'running' | 'done' | 'error'
  summary: string
  messages?: MessageRef[]
  files?: string[]
}

/** Something the Segretario wants the user to confirm before it happens. */
export interface ApprovalRequest {
  approvalId: string
  kind: 'send' | 'action'
  title: string
  status: 'pending' | 'approved' | 'rejected'
  details?: string[]
  confirmLabel?: string
  draft?: {
    draftId: string
    accountId: string
    to: string[]
    cc: string[]
    subject: string
    text: string
    attachments: string[]
  }
}

/** What a short name the Segretario writes stands for, for the page to make a link of. */
export type HandleLink =
  /** `ref` is where the message was when named; `messageKey` finds it wherever it is now. */
  | { handle: string; kind: 'message'; ref: MessageRef; messageKey?: string }
  | {
      handle: string
      kind: 'file'
      fileName: string
      path?: string
      ref?: MessageRef
      attachmentId?: string
    }
  | { handle: string; kind: 'draft'; draftId: string }
  | { handle: string; kind: 'project'; projectId: string; title: string }
  | { handle: string; kind: 'event'; eventKey: string; title: string }
  /** An open thing, by its number: it opens on the message it comes from. */
  | { handle: string; kind: 'commitment'; commitmentId: number }

/** A change a run made to the user's work, as its page of the diary shows it. */
export interface WorkChangeLine {
  object:
    'nota' | 'impegno' | 'progetto' | 'risposta' | 'proposta' | 'copia' | 'evento' | 'giornata'
  label: string
  undoable: boolean
  /** The user undid it. */
  undone: boolean
  accountId: string | null
  messageKeys: string[]
  projectIds: string[]
}

/** What the page shows of an activity, in order. */
export type ActivityEntry =
  | {
      kind: 'user'
      id: number
      text: string
      context?: SegretarioContext
      /** Set when the Segretario began the work on its own: what it set out to do. */
      origin?: 'segretario'
      at: number
      handles: HandleLink[]
    }
  | { kind: 'assistant'; id: number; text: string; at: number }
  | { kind: 'tool'; id: number; tool: ToolActivity; at: number; handles: HandleLink[] }
  | { kind: 'approval'; id: number; approval: ApprovalRequest; at: number }
  | { kind: 'changes'; id: number; changes: WorkChangeLine[]; at: number }
  | { kind: 'compaction'; id: number; at: number }
  | { kind: 'error'; id: number; message: string; at: number }

export interface ActivityDetail extends ActivitySummary {
  entries: ActivityEntry[]
}

/** What changes in an activity, as it happens. */
export type ActivityEvent =
  | { type: 'summary'; activity: ActivitySummary }
  | { type: 'entry'; activityId: string; entry: ActivityEntry }
  | { type: 'stream'; activityId: string; text: string }
  | { type: 'removed'; activityId: string }

/* ────────────────────────── the page's part of the work ────────────────────────── */

/** A message the Segretario writes for the user, handed to the page to open as a draft. */
export interface ComposeSpec {
  kind: 'reply' | 'replyAll' | 'forward' | 'new'
  source?: MessageRef
  accountId?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  text: string
  attachments?: Array<{ path: string; name: string }>
  draftId?: string
}

export type ComposeResult = { draftId: string } | { error: string }

/** What the Segretario wants the user to see, in the main window. */
export type ShowRequest =
  | { kind: 'message'; ref: MessageRef }
  | { kind: 'draft'; draftId: string }
  /** A search it ran, kept for the session: the list to open. */
  | { kind: 'search'; search: AskedMail }
  | { kind: 'project'; projectId: string }
  | { kind: 'event'; eventKey: string }
  | { kind: 'day'; day: string }

/** How an approved send went, as the page reports it. */
export type SendOutcome = { sent: true } | { sent: false; error: string }

/* ───────────────────────────────── IPC ───────────────────────────────── */

export const SEGRETARIO_IPC = {
  getStatus: 'segretario:get-status',
  saveKey: 'segretario:save-key',
  removeKey: 'segretario:remove-key',
  forgetAll: 'segretario:forget-all',
  checkKey: 'segretario:check-key',
  getPreferences: 'segretario:get-preferences',
  setPreferences: 'segretario:set-preferences',
  getSpending: 'segretario:get-spending',
  getEngineState: 'segretario:get-engine-state',
  retryFailedWork: 'segretario:retry-failed-work',
  listMemory: 'segretario:list-memory',
  writeMemory: 'segretario:write-memory',
  deleteMemory: 'segretario:delete-memory',
  memoryHistory: 'segretario:memory-history',
  restoreMemory: 'segretario:restore-memory',
  forgetEverything: 'segretario:forget-everything',
  listLearning: 'segretario:list-learning',
  startConoscimi: 'segretario:start-conoscimi',
  getOnboarding: 'segretario:get-onboarding',
  setOnboarding: 'segretario:set-onboarding',
  connectionReadiness: 'segretario:connection-readiness',
  getReadingStatus: 'segretario:get-reading-status',
  setPreparing: 'segretario:set-preparing',
  draftSent: 'segretario:draft-sent',
  getRowWork: 'segretario:get-row-work',
  filingContext: 'segretario:filing-context',
  getMessageWork: 'segretario:get-message-work',
  setCommitmentStatus: 'segretario:set-commitment-status',
  editCommitment: 'segretario:edit-commitment',
  undoCommitmentStatus: 'segretario:undo-commitment-status',
  openCommitment: 'segretario:open-commitment',
  markHandled: 'segretario:mark-handled',
  undoChange: 'segretario:undo-change',
  replySource: 'segretario:reply-source',
  takeUpReply: 'segretario:take-up-reply',
  discardReply: 'segretario:discard-reply',
  decideProposal: 'segretario:decide-proposal',
  listProposals: 'segretario:list-proposals',
  eventPrep: 'segretario:event-prep',
  eventWork: 'segretario:event-work',
  commitmentSource: 'segretario:commitment-source',
  getToday: 'segretario:get-today',
  refreshToday: 'segretario:refresh-today',
  getDue: 'segretario:get-due',
  assistWriting: 'segretario:assist-writing',
  reviewDraft: 'segretario:review-draft',
  askMail: 'segretario:ask-mail',
  listSavedSearches: 'segretario:list-saved-searches',
  saveSearch: 'segretario:save-search',
  removeSavedSearch: 'segretario:remove-saved-search',
  listProjects: 'segretario:list-projects',
  getProject: 'segretario:get-project',
  refreshProject: 'segretario:refresh-project',
  createProject: 'segretario:create-project',
  updateProject: 'segretario:update-project',
  mergeProjects: 'segretario:merge-projects',
  setConversationProject: 'segretario:set-conversation-project',
  conversationProjects: 'segretario:conversation-projects',
  openProjectFolder: 'segretario:open-project-folder',
  workChanged: 'segretario:work-changed',
  engineChanged: 'segretario:engine-changed',
  listActivities: 'segretario:list-activities',
  getActivity: 'segretario:get-activity',
  startActivity: 'segretario:start-activity',
  sendMessage: 'segretario:send-message',
  cancelActivity: 'segretario:cancel-activity',
  removeActivity: 'segretario:remove-activity',
  markActivitySeen: 'segretario:mark-activity-seen',
  resolveApproval: 'segretario:resolve-approval',
  completeCompose: 'segretario:complete-compose',
  statusChanged: 'segretario:status-changed',
  preferencesChanged: 'segretario:preferences-changed',
  activityEvent: 'segretario:activity-event',
  composeRequest: 'segretario:compose-request',
  showRequest: 'segretario:show-request'
} as const

export interface SegretarioApi {
  getStatus: () => Promise<SegretarioStatus>
  /** Checks a key with OpenRouter and, if it answers, keeps it encrypted. */
  saveKey: (key: string) => Promise<SegretarioStatus>
  removeKey: () => Promise<SegretarioStatus>
  /** Everything the Segretario knows and did, gone; the key and the archived copies stay, the AI turns off. */
  forgetAll: () => Promise<void>
  checkKey: () => Promise<SegretarioStatus>
  getPreferences: () => Promise<SegretarioPreferences>
  setPreferences: (preferences: SegretarioPreferences) => Promise<SegretarioPreferences>
  getSpending: () => Promise<SegretarioSpending>
  getEngineState: () => Promise<EngineState>
  /** Tries the work that failed again, now. */
  retryFailedWork: () => Promise<EngineState>
  listMemory: () => Promise<MemoryNote[]>
  /** Writes a note as the user corrected it; `seenRevision`, the version they opened: changed since, the write is refused. */
  writeMemory: (path: string, content: string, seenRevision?: number) => Promise<MemoryNote[]>
  deleteMemory: (path: string) => Promise<MemoryNote[]>
  memoryHistory: (path: string) => Promise<MemoryVersion[]>
  restoreMemory: (path: string, revision: number) => Promise<MemoryNote[]>
  /** Empties the memory and what the Segretario knows of every connection. */
  forgetEverything: () => Promise<void>
  listLearning: () => Promise<ConnectionLearning[]>
  /**
   * Starts Conoscimi on these connections (`ConnectionLearning.key`; all when
   * none are named): the Segretario gets to know them, building on what it
   * knows. Resolves with the run, which the page shows as it goes.
   */
  startConoscimi: (keys?: string[]) => Promise<ActivitySummary>
  /** The guided setup under way, or null. */
  getOnboarding: () => Promise<OnboardingState | null>
  /** Keeps where the guided setup is, or — null — that it is over. */
  setOnboarding: (state: OnboardingState | null) => Promise<void>
  connectionReadiness: (accountIds: string[]) => Promise<ConnectionReadiness[]>
  /** Of these accounts — the connections a setup adds — or of all. */
  getReadingStatus: (accountIds?: string[]) => Promise<ReadingStatus>
  /** The first reading is prepared with the user waiting: more of it at once. */
  setPreparing: (preparing: boolean) => Promise<void>
  /** A draft went out: what the user wrote in it, to learn from when the Segretario had written it. */
  draftSent: (draftId: string, writtenText: string) => Promise<void>
  /** What the rows of these messages show: the note, what is owed or awaited, the reply. */
  getRowWork: (
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ) => Promise<MessageRowWork[]>
  getMessageWork: (accountId: string, messageKey: string) => Promise<MessageWork>
  /**
   * For messages about to be saved outside the mail (an extension's
   * archive): where earlier messages of their conversations — or else of
   * their senders — were saved, and what the Segretario proposes for them.
   */
  filingContext: (
    messages: ReadonlyArray<{
      accountId: string
      messageKey: string
      threadId: string
      from: string | null
    }>
  ) => Promise<FilingContext>
  /** Done, not needed, put off until a day, or open again. */
  setCommitmentStatus: (
    id: number,
    status: CommitmentStatus,
    options?: { until?: string; reason?: string }
  ) => Promise<Commitment>
  /** Takes back the user's last tick (or setting aside, or putting off) of an open thing. */
  undoCommitmentStatus: (id: number) => Promise<Commitment>
  /** The user corrects what a commitment says. */
  editCommitment: (
    id: number,
    changes: { text?: string; due?: string | null; kind?: CommitmentKind }
  ) => Promise<Commitment>
  /** The user opens a commitment: from a message, from an event, or of their own. */
  openCommitment: (
    from:
      | { kind: 'message'; accountId: string; messageKey: string }
      | { kind: 'event'; eventKey: string }
      | { kind: 'user' },
    input: { kind: CommitmentKind; text: string; due: string | null }
  ) => Promise<Commitment>
  /** "Segna come gestito": what these messages ask of the user is done; what they wait for stays. */
  markHandled: (
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ) => Promise<number>
  /** Undoes a change a run made: its page of the diary, the change's place on it. */
  undoChange: (activityId: string, eventId: number, index: number) => Promise<void>
  replySource: (accountId: string, messageKey: string) => Promise<MessageRef | null>
  /** The user took a prepared reply up: it became draft `draftId`, and is learnt from like the others. */
  takeUpReply: (accountId: string, messageKey: string, draftId: string) => Promise<void>
  discardReply: (accountId: string, messageKey: string) => Promise<void>
  /** The proposals waiting for the user, the newest first: events among them show in the calendar. */
  listProposals: () => Promise<Proposal[]>
  /** How to prepare for an event, as the Segretario wrote it, and when; null when it has not. */
  eventPrep: (eventKey: string) => Promise<(LinkedText & { writtenAt: number }) | null>
  /** What the work holds of an event, as the reader shows it of a message: its open things and its projects. */
  eventWork: (eventKey: string) => Promise<EventWork>
  /**
   * Where an open thing comes from, to open it: its message where it is now,
   * its event, the user's word; null when its message or event is gone.
   */
  commitmentSource: (
    id: number
  ) => Promise<
    | { kind: 'message'; ref: MessageRef }
    | { kind: 'event'; eventKey: string }
    | { kind: 'user' }
    | null
  >
  /**
   * The user accepted a proposal — with what they changed — or set it aside;
   * `revision` is the version shown: one changed since is refused.
   */
  decideProposal: (
    id: string,
    accepted: boolean,
    result?: Record<string, unknown>,
    revision?: number
  ) => Promise<void>
  getToday: () => Promise<TodayPage>
  /** Asks the Segretario to look at the day again now. */
  refreshToday: () => Promise<void>
  /** What is due from today through a day: the calendar's deadlines. */
  getDue: (throughDay: string) => Promise<DayLine[]>
  assistWriting: (request: WritingRequest) => Promise<{ text: string }>
  reviewDraft: (request: ReviewRequest) => Promise<string[]>
  askMail: (question: string) => Promise<AskedMail>
  listSavedSearches: () => Promise<SavedSearch[]>
  saveSearch: (id: string) => Promise<SavedSearch[]>
  removeSavedSearch: (id: string) => Promise<SavedSearch[]>
  listProjects: (options?: { includeHidden?: boolean }) => Promise<Project[]>
  getProject: (id: string) => Promise<ProjectDetail | null>
  /** "Il punto" is behind: the Segretario writes it again, now. */
  refreshProject: (id: string) => Promise<void>
  createProject: (title: string) => Promise<Project>
  /** Renames, hides or brings back, closes or reopens a project: the user's word, kept. */
  updateProject: (
    id: string,
    change: { title?: string; hidden?: boolean; closed?: boolean }
  ) => Promise<Project | null>
  mergeProjects: (keepId: string, otherIds: string[]) => Promise<Project | null>
  /** Puts a conversation in a project, or takes it out of one: the user's word, kept. */
  setConversationProject: (
    thread: { accountId: string; threadId: string },
    projectId: string,
    linked: boolean
  ) => Promise<void>
  /** The projects each conversation is in, in the order asked. */
  conversationProjects: (
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ) => Promise<ProjectLabel[][]>
  openProjectFolder: (id: string) => Promise<void>
  onWorkChanged: (listener: (change: WorkChange) => void) => () => void
  onEngineChanged: (listener: (state: EngineState) => void) => () => void
  /** The panel's activities: the user's requests and Conoscimi; with `diary`, the work done alone too. */
  listActivities: (options?: { diary?: boolean }) => Promise<ActivitySummary[]>
  getActivity: (id: string) => Promise<ActivityDetail | null>
  startActivity: (text: string, context: SegretarioContext) => Promise<ActivitySummary>
  sendMessage: (id: string, text: string, context: SegretarioContext) => Promise<void>
  cancelActivity: (id: string) => Promise<void>
  removeActivity: (id: string) => Promise<void>
  markActivitySeen: (id: string) => Promise<void>
  resolveApproval: (
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: SendOutcome
  ) => Promise<void>
  completeCompose: (requestId: string, result: ComposeResult) => Promise<void>
  onStatusChanged: (listener: (status: SegretarioStatus) => void) => () => void
  /** The AI was switched on or off, here or in another window. */
  onPreferencesChanged: (listener: (preferences: SegretarioPreferences) => void) => () => void
  onActivityEvent: (listener: (event: ActivityEvent) => void) => () => void
  onComposeRequest: (
    listener: (request: { requestId: string; spec: ComposeSpec }) => void
  ) => () => void
  onShowRequest: (listener: (request: ShowRequest) => void) => () => void
}
