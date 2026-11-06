import type { PrismaClient } from '@prisma/client'

import type {
  CalendarChange,
  CalendarConnection,
  CalendarEvent,
  CalendarResponse,
  CalendarSearchQuery,
  CalendarSearchResult,
  EventChange,
  NewCalendarEvent
} from '@shared/calendar'
import type {
  MailAccount,
  MailAddress,
  MailAttachment,
  MailFolder,
  MailMessageDetail,
  MessageRef,
  MessagesActionResult
} from '@shared/models'
import type {
  ApprovalRequest,
  ComposeSpec,
  SendOutcome,
  ShowRequest,
  TaskKind
} from '@shared/segretario'

import type { AiStore } from '../ai-store'
import type { AskedSearch } from '../ask-mail'
import type { Notebook } from '../memory/notebook'
import type { ContentPart } from '../openrouter'
import type { Registry } from '../registry/registry'
import type { Actor, RegistryChange } from '../registry/types'
import type { HandleRecord, HandleRegistry } from './handles'

/** Where a message is, wherever that is — the Trash and Spam included. */
export interface MessageLocation {
  ref: MessageRef
  threadId: string
  dateIso: string
  subject: string
  from: MailAddress[]
  /** Only in the Trash or Spam: what is open in it is set aside until it comes back. */
  setAside: boolean
  /** A draft of the user's, not sent: it has not come or gone yet. */
  draft: boolean
}

/**
 * What the Segretario reaches of the mail: the mail service's own
 * operations, so what the Segretario does is exactly what the user's
 * clicks do — same engine, same undo, same views updating.
 */
export interface SegretarioMailPort {
  listAccounts(): Promise<MailAccount[]>
  /** Each account's signature as text, by account id: the user's own, as they sign. */
  accountSignatures(): Promise<Map<string, string>>
  listFolders(accountId: string): Promise<MailFolder[]>
  /**
   * The conversations with messages the Segretario has not read yet — in
   * any folder but the Trash, Spam and Bozze, each account since its own
   * horizon (`sinceOf`), their text indexed — those with the newest such
   * message first, each with all of them, oldest first.
   */
  unreadConversations(
    sinceOf: (accountId: string) => string,
    limit: number
  ): Promise<
    Array<{
      accountId: string
      threadId: string
      messages: Array<{ ref: MessageRef; messageKey: string; dateIso: string }>
    }>
  >
  /**
   * Of the messages the Segretario reads — each account since its horizon,
   * in these accounts or all — how many it has read.
   */
  readingProgress(
    sinceOf: (accountId: string) => string,
    accountIds?: ReadonlyArray<string>
  ): Promise<{ read: number; total: number }>
  /**
   * The same message — by its Message-ID — in the user's other accounts:
   * a copy CC'd to both, a team mailbox's. Each account's key and conversation.
   */
  sameMessageElsewhere(
    ref: MessageRef
  ): Promise<Array<{ accountId: string; messageKey: string; threadId: string }>>
  /** An account's conversations with mail from this address since a date, the latest first. */
  threadsFromSender(
    accountId: string,
    address: string,
    sinceIso: string,
    limit: number
  ): Promise<string[]>
  /** Whether the user has written, from any account, to one of these addresses: someone they deal with. */
  userWroteTo(addresses: ReadonlyArray<string>): Promise<boolean>
  /** Messages of an account by key, each where the user thinks of it (never only-in-Trash), with who and what. */
  messageSummaries(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<
    Map<string, { ref: MessageRef; subject: string; from: MailAddress[]; dateIso: string }>
  >
  /** Where messages are, the Trash and Spam included: those not anywhere are gone. */
  locate(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<Map<string, MessageLocation>>
  /** The keys of a conversation's messages, oldest first. */
  threadKeys(accountId: string, threadId: string): Promise<string[]>
  /** Whether the account's mail has arrived and its last `days` days are indexed. */
  recentMailIndexed(accountId: string, days: number): Promise<boolean>
  /** The client the search and the threads read from (see `mail-search.ts`). */
  searchClient(): Promise<PrismaClient>
  /** A message with its text, downloaded when the cache does not have it. */
  readMessage(ref: MessageRef): Promise<MailMessageDetail & { textForReading: string }>
  attachmentContent(
    ref: MessageRef,
    attachment: MailAttachment
  ): Promise<{ data: Buffer; contentType?: string }>
  copyAttachments(
    ref: MessageRef,
    attachmentIds: string[]
  ): Promise<Array<{ path: string; name: string }>>
  archive(refs: MessageRef[]): Promise<MessagesActionResult>
  move(refs: MessageRef[], folderPath: string): Promise<MessagesActionResult>
  setSeen(refs: MessageRef[], seen: boolean): Promise<MessagesActionResult>
  setFlagged(refs: MessageRef[], flagged: boolean): Promise<MessagesActionResult>
  trash(refs: MessageRef[]): Promise<MessagesActionResult>
  /** A message in Bozze as the draft the app writes on; null for one that is not in Bozze. */
  draftOfMessage(ref: MessageRef): Promise<string | null>
  /** The drafts written in answer to a message: the newest first. */
  draftsReplyingTo(ref: MessageRef): Promise<string[]>
  getDraft(draftId: string): Promise<{
    accountId: string
    to: string[]
    cc: string[]
    bcc: string[]
    subject: string
    text: string
    attachments: string[]
  } | null>
}

/** The calendars, as the Segretario reaches them: the same as the page's. */
export interface SegretarioCalendarPort {
  /** The calendars, each with what it is called, whose it is, whether it takes events and whether the user keeps it shown. */
  calendars(): Promise<
    Array<{
      key: string
      connectionId: string
      name: string
      connection: string
      primary: boolean
      writable: boolean
      hidden: boolean
    }>
  >
  /** The calendar connections: who they are with, and their calendars. */
  connections(): Promise<CalendarConnection[]>
  events(fromIso: string, toIso: string): Promise<CalendarEvent[]>
  /** The events kept, past and future, with every word: the ones to come first, then the latest past. */
  search(query: CalendarSearchQuery): Promise<CalendarSearchResult>
  event(eventKey: string): Promise<CalendarEvent | null>
  create(event: NewCalendarEvent): Promise<CalendarEvent>
  update(eventKey: string, change: EventChange): Promise<CalendarEvent>
  remove(eventKey: string): Promise<void>
  respond(
    eventKey: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<CalendarEvent>
  /** What changed in the calendars not through the app, after a point, the oldest first. */
  changesSince(afterId: number, limit: number): Promise<CalendarChange[]>
  /** The point the changes noted so far reach. */
  latestChangeId(): Promise<number>
}

/** What the page does for the Segretario. */
export interface SegretarioPagePort {
  /** Opens a draft in the composer as `spec` says; resolves with its id. */
  compose(spec: ComposeSpec, signal: AbortSignal): Promise<string>
  show(request: ShowRequest): void
  /** Runs a search and opens its list in the window, as a search asked in words; resolves with how many it found. */
  showSearch(search: AskedSearch, question: string): Promise<number>
}

export type { TaskKind } from '@shared/segretario'

/** What an interactive run hands back to whoever is waiting for it. */
export interface RunResults {
  /** For `scrittura`: the text that goes in the editor, in place of what was written or selected. */
  editorText?: string
  /** For `revisione`: what to point out before sending; empty when all is well. */
  review?: string[]
  /** For `ricerca`: the search to show. */
  search?: AskedSearch
}

/** One run of the Segretario, as its tools see it. */
export interface RunContext {
  activityId: string
  task: TaskKind
  /** When the run began: what moved after it, it may not have seen. */
  startedAt: number
  /**
   * Working on its own, nobody watching: it reads mail it cannot trust, so
   * it does nothing that reaches other people or the mail's place — it
   * proposes instead — and never overturns the user without a newer fact.
   */
  background: boolean
  /**
   * The user has this run in front of them and can confirm what it asks:
   * the panel's conversations. Work on its own, and the user's work that
   * shows no conversation (the reread before sending, the help in the
   * editor, the search in words), cannot ask — and so cannot act outward.
   */
  watched: boolean
  actor: Actor
  /** The revision of each object of the registry and of the memory this run last saw. */
  seen: Map<string, number>
  /** What this run changed, for the diary. */
  changes: RegistryChange[]
  results: RunResults
  /** For `scrittura`: the draft open in the editor, and the passage selected in it. */
  editor: { draftId: string; selection: string | null } | null
}

/** The key the run remembers a revision under: `item:12`, `note:acc:key`, `memory:tu.md`… */
export function seenKey(
  kind: 'item' | 'note' | 'project' | 'reply' | 'memory',
  ...parts: Array<string | number>
): string {
  return `${kind}:${parts.join(':')}`
}

export interface ToolContext {
  run: RunContext
  signal: AbortSignal
  handles: HandleRegistry
  /** Names given during this call, to keep in the log. */
  newHandles: HandleRecord[]
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  page: SegretarioPagePort
  registry: Registry
  notebook: Notebook
  store: AiStore
  /** Asks the user to confirm and waits for the answer. For a send, the page sends and says how it went. */
  requestApproval(
    request: Omit<ApprovalRequest, 'approvalId' | 'status'>
  ): Promise<{ approved: boolean; outcome?: SendOutcome }>
}

/** What a tool hands back: what the model reads, and the line the user sees. */
export interface ToolOutcome {
  content: string | ContentPart[]
  /** "Cercato «Hera» · 9 messaggi". */
  summary: string
  /** Messages it found or read, to open with a click. */
  messages?: MessageRef[]
  files?: string[]
  /** The tool did not do what was asked: the line shows it. */
  failed?: boolean
}

export interface SegretarioTool {
  name: string
  description: string
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>
  /** The line the user sees while it runs, from its arguments. */
  running(args: Record<string, unknown>): string
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome>
}

/** A tool's mistake the model can correct: said back to it, not thrown at the user. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

/**
 * Refused because what the call writes changed since the run read it. The
 * run has now seen it as it is: the same call, made again, is a decision
 * taken knowingly, not a mistake repeated.
 */
export class ToolConflict extends ToolInputError {
  constructor(message: string) {
    super(message)
    this.name = 'ToolConflict'
  }
}

/**
 * A short name the run was never given: the call may be right once a tool
 * names it — so, unlike other failures, it may be made again then.
 */
export class UnknownHandle extends ToolInputError {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownHandle'
  }
}

/** Something this run may not do on its own: said back, with what it can do instead. */
export function requireInteractive(context: ToolContext, what: string, instead: string): void {
  if (!context.run.watched) {
    throw new ToolInputError(
      context.run.background
        ? `In questo lavoro, che fai da solo senza poter chiedere conferma all'utente, non puoi ${what}: ${instead}`
        : `In questo lavoro l'utente non ha davanti la conversazione con te e non può confermare: non puoi ${what}. ${instead}`
    )
  }
}

export function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function requireString(args: Record<string, unknown>, name: string): string {
  const value = stringArg(args, name)

  if (!value) {
    throw new ToolInputError(`Manca il parametro \`${name}\`.`)
  }

  return value
}

export function stringListArg(args: Record<string, unknown>, name: string): string[] {
  const value = args[name]

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }

  return typeof value === 'string' && value.trim() ? [value.trim()] : []
}

export function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  // Models now and then write a number as text.
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim())
  }

  return undefined
}

export function booleanArg(args: Record<string, unknown>, name: string): boolean {
  return args[name] === true || args[name] === 'true'
}

/** A list of objects, each a record of arguments. */
export function objectListArg(
  args: Record<string, unknown>,
  name: string
): Array<Record<string, unknown>> {
  const value = args[name]
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
    : []
}
