import type { MessageRef } from './models'

/**
 * The Segretario: SIEVER Mail's agent. What the main process and the page
 * say to each other about it — the key, the credit, the activities and
 * what happens in them.
 */

/** Where the OpenRouter key stands, as the last check found it. */
export type SegretarioKeyState =
  /** No key saved: the Segretario is off. */
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
  /** The account's balance (credits bought less usage), when OpenRouter says it. */
  balance: number | null
  /** The key's own limit and what is left of it, when it has one. */
  keyLimit: number | null
  keyRemaining: number | null
  /** When the key's limit starts again: daily, weekly, monthly. */
  keyLimitReset: string | null
}

export interface SegretarioStatus {
  keyState: SegretarioKeyState
  /** The key as OpenRouter labels it ("sk-or-v1-9b6…138"), never the key itself. */
  keyLabel: string | null
  credit: SegretarioCredit | null
  /** When it was last checked, epoch ms. */
  checkedAt: number | null
  /** What went wrong at the last check, in the user's words. */
  problem: string | null
  /** The model in use, as OpenRouter names it ("DeepSeek: DeepSeek V4.1 Flash 1017"). */
  modelName: string | null
}

/** What the Segretario does on its own; each can be switched off (see Impostazioni → Segretario). */
export interface SegretarioPreferences {
  /** Reads every message as it arrives: what it asks, by when, how it matters. */
  triage: boolean
  /** Prepares replies, in the user's voice, to the messages that need one. */
  readyDrafts: boolean
  /**
   * Gets to know the user — reads what they wrote from each account — and
   * keeps learning from how they correct its drafts. Null until the user
   * has said yes or no: it reads their mail on its own, so it asks first.
   */
  learning: boolean | null
  /** Rereads each message as it is sent, for what the user would want to correct first. */
  reviewBeforeSend: boolean
}

export const DEFAULT_SEGRETARIO_PREFERENCES: SegretarioPreferences = {
  triage: true,
  readyDrafts: true,
  learning: null,
  reviewBeforeSend: true
}

/* ─────────────────────────── notes on the mail ─────────────────────────── */

/** Where a message leaves the user, as the Segretario read it. */
export type NoteState = 'da_rispondere' | 'da_fare' | 'in_attesa' | 'informativo' | 'rumore'
export type NotePriority = 'alta' | 'media' | 'bassa'

/**
 * What the Segretario wrote next to a message when it arrived (or left):
 * the one thing that counts, where it leaves the user, how much it matters.
 * Kept by the message's stable key, whatever folder holds it.
 */
export interface MessageNote {
  accountId: string
  messageKey: string
  threadId: string
  /** Received, or written by the user. */
  direction: 'in' | 'out'
  summary: string
  state: NoteState
  priority: NotePriority
  reason: string
  /** By when, AAAA-MM-GG. */
  due: string | null
  messageDate: string
  /** The user said it is handled. */
  dismissedAt: number | null
  /**
   * The same message came to another of the user's accounts, and is
   * followed there: this note copies that one's, and opens nothing.
   */
  twinAccountId: string | null
}

export type CommitmentKind = 'ti_chiedono' | 'hai_promesso' | 'aspetti' | 'da_fare'

/** Something open between the user and someone: asked, promised, awaited, to do. */
export interface Commitment {
  id: number
  accountId: string
  threadId: string
  /** The message it came from. */
  messageKey: string
  kind: CommitmentKind
  text: string
  due: string | null
  status: 'aperto' | 'chiuso'
  createdAt: number
  closedAt: number | null
  /** Closed by a later message the Segretario read, or by the user. */
  closedBy: 'segretario' | 'utente' | null
}

/** A conversation as the reader shows it: its latest note, what is open in it, the reply prepared. */
export interface ThreadBrief {
  note: MessageNote | null
  /** The topic it belongs to, if any. */
  topic: Pick<Topic, 'id' | 'title' | 'folderPath'> | null
  commitments: Commitment[]
  /** A reply the Segretario prepared ahead for the latest message, until taken up or set aside. */
  readyDraft: { messageKey: string; kind: ReadyDraftKind; text: string; doubts: string } | null
  /** Where it was filed outside the mail — a pratica's folder — and when; null if it was not. */
  archived: { folder: string; at: number } | null
}

/** A reply to a message that waits on the user, or a reminder after the user's own that waits too long. */
export type ReadyDraftKind = 'risposta' | 'sollecito'

/* ──────────────────────────────── topics ──────────────────────────────── */

/**
 * A matter that lasts — a job, a project, a negotiation; in a company's
 * build, a pratica of its archive — and the conversations that belong to
 * it, across the accounts. The Segretario files conversations into topics
 * as they arrive and keeps a word on where each stands.
 */
export interface Topic {
  id: string
  title: string
  description: string | null
  /** Where its files are, when it has a folder: a pratica's, on the archive. */
  folderPath: string | null
  /** Brought by the extension (a pratica), made by the Segretario, or by the user. */
  origin: 'extension' | 'segretario' | 'utente'
  /** The extension's key for it ("pratica:2451"); null for the Segretario's and the user's own. */
  externalKey: string | null
  /** What it is about in a line, as the Segretario learnt it from its mail; null until it has. */
  gist: string | null
  /** Where it stands, as the Segretario last wrote it; null until written. */
  state: string | null
  stateAt: number | null
  lastActivityAt: number | null
  conversations: number
  openCommitments: number
  archived: boolean
}

export interface TopicDetail extends Topic {
  /** Its conversations, each by its latest message, the newest first. */
  messages: BriefingItem[]
  commitments: Commitment[]
}

/** A line of the day's page: a conversation that asks something, or a thing open in one. */
export interface BriefingItem {
  /** What it is, as the Segretario put it. */
  text: string
  priority: NotePriority | null
  due: string | null
  /** For a thing open: asked, promised, awaited, to do. */
  commitmentKind: CommitmentKind | null
  /** For a text prepared: a reply, or a reminder. */
  readyKind?: ReadyDraftKind
  ref: MessageRef
  /** The message's key in its account: the same in every folder it is in. */
  messageKey: string
  subject: string
  /** Who wrote the message, as a name. */
  from: string
  date: string
}

/** The day as the Segretario sees it: "Oggi". */
export interface Briefing {
  /** AAAA-MM-GG, local. */
  day: string
  /** What it writes at the top of the day; null until written. */
  opening: string | null
  openingAt: number | null
  /** How many lines came since the opening was written: past zero, it is behind the day. */
  openingBehind: number
  /** Messages triage has still to read: while there are, the day is not written about. */
  reading: number
  /** What is due today, or overdue. */
  today: BriefingItem[]
  /** What is due in the next seven days. */
  week: BriefingItem[]
  /** Who waits on the user, without a date. */
  waiting: BriefingItem[]
  /** What the user waits on, the longest first. */
  awaited: BriefingItem[]
  /** Replies prepared, to look at. */
  ready: BriefingItem[]
}

/** What the user asks of the Segretario while writing a message. */
export interface WritingRequest {
  /** The draft being written, kept so what the user changes afterwards is learnt from. */
  draftId: string
  accountId: string
  /** "Scrivi la risposta", "più breve", "in inglese"… */
  instruction: string
  /** What is written so far, without the signature and the quote. */
  writtenText: string
  subject: string
  to: string[]
  /** The message answered or forwarded, for its conversation. */
  replyTo: MessageRef | null
}

/** A message about to be sent, for the Segretario to reread. */
export interface ReviewRequest {
  accountId: string
  to: string[]
  cc: string[]
  subject: string
  /** What the user wrote, without the signature and the quote. */
  writtenText: string
  /** The names of the files it carries. */
  attachments: string[]
  /** The message it answers, if it answers one. */
  replyTo: MessageRef | null
}

/** Notes were written or changed: the views showing these refresh. */
export interface NotesChange {
  accountId: string
  messageKeys: string[]
  threadIds: string[]
}

/** A note of the Segretario's memory, as Impostazioni shows it. */
export interface MemoryNote {
  /** "tu.md", "persone/anna-rossi.md". */
  path: string
  content: string
  updatedAt: number
}

/** Where getting to know an account stands. */
export interface AccountLearning {
  accountId: string
  email: string
  /**
   * `waiting`: not begun — the user has not agreed, or the account's recent
   * mail is still being indexed; `running`; `done`; `stopped`: the user
   * stopped it, and it waits for them to begin it again.
   */
  state: 'waiting' | 'running' | 'done' | 'stopped'
  activityId: string | null
  finishedAt: number | null
}

/** What the Segretario has cost, in dollars, as OpenRouter billed each call. */
export interface SegretarioSpending {
  today: number
  thisMonth: number
}

/* ─────────────────────────────── activities ─────────────────────────────── */

/**
 * A piece of work of the Segretario: asked by the user, or begun on its own
 * (getting to know an account, a reflection). Activities run side by side.
 */
export type ActivityStatus =
  /** At work. */
  | 'running'
  /** Needs the user: a confirmation, or an answer. */
  | 'waiting'
  /** Finished; the user can write to it again. */
  | 'done'
  /** Stopped by an error it could not get past. */
  | 'failed'
  /** Stopped by the user. */
  | 'cancelled'

export type ActivityKind = 'richiesta' | 'conoscerti' | 'riflessione'

export interface ActivitySummary {
  id: string
  kind: ActivityKind
  title: string
  status: ActivityStatus
  createdAt: number
  updatedAt: number
  /** Something happened the user has not seen yet. */
  unseen: boolean
  /** What it cost so far, in dollars. */
  cost: number
}

/** What the user is looking at when they write: the Segretario reads it as context. */
export interface SegretarioContext {
  /** The message open in the reader, or the selection. */
  messages: MessageRef[]
  /** The account the user is in, and the folder or view. */
  accountId: string | null
  folderLabel: string | null
}

/** A step a tool took, as the user sees it: one line, and what it touched. */
export interface ToolActivity {
  callId: string
  name: string
  status: 'running' | 'done' | 'error'
  /** "Cercato «Hera» da lunedì · 9 conversazioni". */
  summary: string
  /** Messages it found or read, to open with a click. */
  messages?: MessageRef[]
  /** Files it read. */
  files?: string[]
}

/** Something the Segretario wants the user to confirm before it happens. */
export interface ApprovalRequest {
  approvalId: string
  /** A draft to send, or something else to do — an extension's action. */
  kind: 'send' | 'action'
  /** One line for the card's header. */
  title: string
  status: 'pending' | 'approved' | 'rejected'
  /** For an action: what will happen, a line each, and the word on its button. */
  details?: string[]
  confirmLabel?: string
  /** The draft to send: the card shows exactly what goes out. */
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

/**
 * What a short name the Segretario writes stands for — `m4` a message,
 * `f2` a file or attachment, `b1` a draft — for the page to make a link of.
 */
export type HandleLink =
  | { handle: string; kind: 'message'; ref: MessageRef }
  | {
      handle: string
      kind: 'file'
      fileName: string
      path?: string
      ref?: MessageRef
      attachmentId?: string
    }
  | { handle: string; kind: 'draft'; draftId: string }
  | { handle: string; kind: 'topic'; topicId: string; title: string }
  | { handle: string; kind: 'event'; eventKey: string; title: string }

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
  | { kind: 'compaction'; id: number; at: number }
  | { kind: 'error'; id: number; message: string; at: number }

export interface ActivityDetail extends ActivitySummary {
  entries: ActivityEntry[]
}

/** What changes in an activity, as it happens. */
export type ActivityEvent =
  | { type: 'summary'; activity: ActivitySummary }
  | { type: 'entry'; activityId: string; entry: ActivityEntry }
  /** Text the Segretario is writing now, not yet a whole entry. */
  | { type: 'stream'; activityId: string; text: string }
  | { type: 'removed'; activityId: string }

/* ────────────────────────── the page's part of the work ────────────────────────── */

/**
 * A message the Segretario writes for the user, handed to the page to open
 * as a draft in the composer — exactly as the user's own reply, forward or
 * new message would be: signature, quote, thread, account. Its text
 * becomes the lines the user writes on; the draft is kept and filed in
 * Bozze at once, and waits in the dock.
 */
export interface ComposeSpec {
  kind: 'reply' | 'replyAll' | 'forward' | 'new'
  /** The message answered or forwarded. */
  source?: MessageRef
  /** For a new message, the account it goes out from. */
  accountId?: string
  /** When given, in place of the reply's own recipients. */
  to?: string[]
  cc?: string[]
  bcc?: string[]
  /** For a new message; replies and forwards keep the original's. */
  subject?: string
  /** What the message says, as plain text: blank lines between paragraphs. */
  text: string
  /** Files to attach, by path. */
  attachments?: Array<{ path: string; name: string }>
  /** A draft the Segretario already wrote, to be rewritten in place. */
  draftId?: string
}

export type ComposeResult = { draftId: string } | { error: string }

/** What the Segretario wants the user to see, in the main window. */
export type ShowRequest =
  | { kind: 'message'; ref: MessageRef }
  | { kind: 'search'; query: string; accountId: string | null; folderPath: string | null }
  | { kind: 'draft'; draftId: string }

/** How an approved send went, as the page reports it. */
export type SendOutcome = { sent: true } | { sent: false; error: string }

/* ───────────────────────────────── IPC ───────────────────────────────── */

export const SEGRETARIO_IPC = {
  getStatus: 'segretario:get-status',
  saveKey: 'segretario:save-key',
  removeKey: 'segretario:remove-key',
  checkKey: 'segretario:check-key',
  getPreferences: 'segretario:get-preferences',
  setPreferences: 'segretario:set-preferences',
  getSpending: 'segretario:get-spending',
  listMemory: 'segretario:list-memory',
  writeMemory: 'segretario:write-memory',
  deleteMemory: 'segretario:delete-memory',
  forgetEverything: 'segretario:forget-everything',
  listLearning: 'segretario:list-learning',
  relearnAccount: 'segretario:relearn-account',
  draftSent: 'segretario:draft-sent',
  getNotes: 'segretario:get-notes',
  getThreadBrief: 'segretario:get-thread-brief',
  closeCommitment: 'segretario:close-commitment',
  dismissNote: 'segretario:dismiss-note',
  takeUpReadyDraft: 'segretario:take-up-ready-draft',
  discardReadyDraft: 'segretario:discard-ready-draft',
  readyDraftSource: 'segretario:ready-draft-source',
  getBriefing: 'segretario:get-briefing',
  assistWriting: 'segretario:assist-writing',
  listTopics: 'segretario:list-topics',
  getTopic: 'segretario:get-topic',
  writeTopicState: 'segretario:write-topic-state',
  setConversationTopic: 'segretario:set-conversation-topic',
  updateTopic: 'segretario:update-topic',
  topicsLabel: 'segretario:topics-label',
  createTopic: 'segretario:create-topic',
  conversationTopics: 'segretario:conversation-topics',
  filingHint: 'segretario:filing-hint',
  reviewDraft: 'segretario:review-draft',
  openTopicFolder: 'segretario:open-topic-folder',
  writeBriefingOpening: 'segretario:write-briefing-opening',
  notesChanged: 'segretario:notes-changed',
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
  activityEvent: 'segretario:activity-event',
  composeRequest: 'segretario:compose-request',
  showRequest: 'segretario:show-request'
} as const

export interface SegretarioApi {
  getStatus: () => Promise<SegretarioStatus>
  /** Checks a key with OpenRouter and, if it answers, keeps it encrypted. */
  saveKey: (key: string) => Promise<SegretarioStatus>
  removeKey: () => Promise<SegretarioStatus>
  /** Asks OpenRouter again about the key and its credit. */
  checkKey: () => Promise<SegretarioStatus>
  getPreferences: () => Promise<SegretarioPreferences>
  setPreferences: (preferences: SegretarioPreferences) => Promise<SegretarioPreferences>
  getSpending: () => Promise<SegretarioSpending>
  listMemory: () => Promise<MemoryNote[]>
  /** Writes a note as the user corrected it. */
  writeMemory: (path: string, content: string) => Promise<MemoryNote[]>
  deleteMemory: (path: string) => Promise<MemoryNote[]>
  /** Empties the memory and starts getting to know every account again. */
  forgetEverything: () => Promise<void>
  listLearning: () => Promise<AccountLearning[]>
  /** Gets to know one account again, from the start. */
  relearnAccount: (accountId: string) => Promise<AccountLearning[]>
  /**
   * A draft went out: what the user wrote in it, without the signature and
   * the quote. When the Segretario had written it, the difference is what
   * it learns from.
   */
  draftSent: (draftId: string, writtenText: string) => Promise<void>
  /** The notes of these messages, those that have one. */
  getNotes: (messages: Array<{ accountId: string; messageKey: string }>) => Promise<MessageNote[]>
  getThreadBrief: (accountId: string, threadId: string) => Promise<ThreadBrief>
  /** The user closed something open: done, or no longer needed. */
  closeCommitment: (id: number) => Promise<void>
  /** The user said a message is handled: it leaves "Da gestire". */
  dismissNote: (accountId: string, messageKey: string) => Promise<void>
  onNotesChanged: (listener: (change: NotesChange) => void) => () => void
  /** Where the message a prepared reply answers is, to open the reply on it. */
  readyDraftSource: (accountId: string, messageKey: string) => Promise<MessageRef | null>
  /** The user took a prepared reply up: it became draft `draftId`, and is learnt from like the others. */
  takeUpReadyDraft: (accountId: string, messageKey: string, draftId: string) => Promise<void>
  discardReadyDraft: (accountId: string, messageKey: string) => Promise<void>
  getBriefing: () => Promise<Briefing>
  /** What topics are called in this build: "Argomenti", or the extension's word ("Pratiche"). */
  topicsLabel: () => Promise<string>
  listTopics: () => Promise<Topic[]>
  getTopic: (id: string) => Promise<TopicDetail | null>
  /** Writes again where the topic stands, from its conversations and what is open in them. */
  writeTopicState: (id: string) => Promise<TopicDetail | null>
  /** Files a conversation into a topic, or out of any (null): the user's choice is kept. */
  setConversationTopic: (
    accountId: string,
    threadId: string,
    topicId: string | null
  ) => Promise<void>
  /** The topic each conversation is in, by id, in the order asked; null for one in none. */
  conversationTopics: (
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ) => Promise<Array<string | null>>
  /**
   * Where these conversations are kept, for an extension's filing: the
   * extension topic they all share, and the subfolder of its folder their
   * earlier messages were filed in, when they were.
   */
  filingHint: (
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ) => Promise<{ topicKey: string | null; destination: string | null }>
  /** Rereads a message about to be sent: what the user would want to correct first, a line each. */
  reviewDraft: (request: ReviewRequest) => Promise<string[]>
  /** A topic the user makes, by its title. */
  createTopic: (title: string) => Promise<Topic>
  /** Opens a topic's folder — a pratica's, on the archive — in Finder or Explorer. */
  openTopicFolder: (id: string) => Promise<void>
  /** Renames, archives or brings back a topic. */
  updateTopic: (id: string, change: { title?: string; archived?: boolean }) => Promise<Topic | null>
  /** Writes or rewrites the message being written, as asked: the whole text, ready to send. */
  assistWriting: (request: WritingRequest) => Promise<{ text: string }>
  /** Writes the day's opening again, from the day as it stands. */
  writeBriefingOpening: () => Promise<Briefing>
  listActivities: () => Promise<ActivitySummary[]>
  getActivity: (id: string) => Promise<ActivityDetail | null>
  /** Begins a new activity with what the user asked. */
  startActivity: (text: string, context: SegretarioContext) => Promise<ActivitySummary>
  /** Writes to an activity: an answer, a correction, a new request on the same thread. */
  sendMessage: (id: string, text: string, context: SegretarioContext) => Promise<void>
  cancelActivity: (id: string) => Promise<void>
  removeActivity: (id: string) => Promise<void>
  markActivitySeen: (id: string) => Promise<void>
  /**
   * The user's answer to a confirmation. For a send, the page sends the
   * draft itself — through the composer, as any message goes — and reports
   * how it went.
   */
  resolveApproval: (
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: SendOutcome
  ) => Promise<void>
  /** The page opened the draft a compose request asked for, or could not. */
  completeCompose: (requestId: string, result: ComposeResult) => Promise<void>
  onStatusChanged: (listener: (status: SegretarioStatus) => void) => () => void
  onActivityEvent: (listener: (event: ActivityEvent) => void) => () => void
  onComposeRequest: (
    listener: (request: { requestId: string; spec: ComposeSpec }) => void
  ) => () => void
  onShowRequest: (listener: (request: ShowRequest) => void) => () => void
}
