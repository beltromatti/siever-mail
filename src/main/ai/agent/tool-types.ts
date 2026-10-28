import type { PrismaClient } from '@prisma/client'

import type { CalendarEvent, CalendarResponse, NewCalendarEvent } from '@shared/calendar'
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
  Commitment,
  ComposeSpec,
  SendOutcome,
  ShowRequest,
  Topic,
  TopicDetail
} from '@shared/segretario'

import type { AiStore } from '../ai-store'
import type { ContentPart } from '../openrouter'
import type { HandleRecord, HandleRegistry } from './handles'

/**
 * What the Segretario's tools reach of SIEVER Mail: the mail service's own
 * operations, so what the Segretario does is exactly what the user's
 * clicks do — same engine, same undo, same views updating.
 */
export interface SegretarioMailPort {
  listAccounts(): Promise<MailAccount[]>
  /** Each account's signature as text, by account id: the user's own, as they sign. */
  accountSignatures(): Promise<Map<string, string>>
  listFolders(accountId: string): Promise<MailFolder[]>
  /**
   * The conversations of every account's inbox and sent mail with messages
   * since `sinceIso` that have no note yet and whose text is indexed: those
   * with the newest such message first, each with all of them, oldest
   * first — what one message opens, a later one may close.
   */
  untriagedThreads(
    sinceIso: string,
    limit: number
  ): Promise<
    Array<{
      accountId: string
      threadId: string
      messages: Array<{ ref: MessageRef; messageKey: string; dateIso: string }>
    }>
  >
  /**
   * The same message — by its Message-ID — in the user's other accounts
   * among those the Segretario looks after: a copy CC'd to both, a team
   * mailbox's. Each account's key and conversation.
   */
  sameMessageElsewhere(
    ref: MessageRef
  ): Promise<Array<{ accountId: string; messageKey: string; threadId: string }>>
  /** The accounts "Tutti gli account" gathers: those the Segretario's views and day are about. */
  includedAccountIds(): Promise<string[]>
  /** An account's conversations with mail from this address since a date, the latest first. */
  threadsFromSender(
    accountId: string,
    address: string,
    sinceIso: string,
    limit: number
  ): Promise<string[]>
  /** Whether the user has written, from any of those accounts, to one of these addresses: someone they deal with. */
  userWroteTo(addresses: ReadonlyArray<string>): Promise<boolean>
  /** Messages of an account by key, each where the user thinks of it, with who wrote it and what about. */
  messageSummaries(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<
    Map<string, { ref: MessageRef; subject: string; from: MailAddress[]; dateIso: string }>
  >
  /** Where a message is filed, in the folder the user thinks of it in, and when it was sent. */
  refForKey(
    accountId: string,
    messageKey: string
  ): Promise<{ ref: MessageRef; dateIso: string } | null>
  /** Whether the account's mail has arrived and its last `days` days are indexed: enough to get to know it. */
  recentMailIndexed(accountId: string, days: number): Promise<boolean>
  /** The client the search and the threads read from (see `mail-search.ts`). */
  searchClient(): Promise<PrismaClient>
  /**
   * A message with its text, downloaded when the cache does not have it:
   * the text the index keeps is enough to read, so nothing more is fetched.
   */
  readMessage(ref: MessageRef): Promise<MailMessageDetail & { textForReading: string }>
  /** An attachment's bytes, for reading. */
  attachmentContent(
    ref: MessageRef,
    attachment: MailAttachment
  ): Promise<{ data: Buffer; contentType?: string }>
  /** A copy of attachments on disk, for a draft to carry. */
  copyAttachments(
    ref: MessageRef,
    attachmentIds: string[]
  ): Promise<Array<{ path: string; name: string }>>
  archive(refs: MessageRef[]): Promise<MessagesActionResult>
  move(refs: MessageRef[], folderPath: string): Promise<MessagesActionResult>
  setSeen(refs: MessageRef[], seen: boolean): Promise<MessagesActionResult>
  setFlagged(refs: MessageRef[], flagged: boolean): Promise<MessagesActionResult>
  trash(refs: MessageRef[]): Promise<MessagesActionResult>
  /**
   * A message in Bozze as the draft the app writes on — the one it keeps
   * for it, or one made from it — opened as the user's click opens it;
   * null for a message that is not in Bozze.
   */
  draftOfMessage(ref: MessageRef): Promise<string | null>
  /** The drafts written in answer to a message: the newest first. */
  draftsReplyingTo(ref: MessageRef): Promise<string[]>
  /** A draft as stored: who it goes to, what it says, what it carries. */
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

/** What the Segretario keeps of the mail as it reads it: the topics and what is open. */
export interface SegretarioWorkPort {
  /** What topics are called in this build: "Argomenti", or the extension's word ("Pratiche"). */
  topicsLabel(): string
  listTopics(): Promise<Topic[]>
  getTopic(id: string): Promise<TopicDetail | null>
  /** The topic each conversation is in, by id; null for one in none. */
  conversationTopics(
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ): Promise<Array<string | null>>
  /** Files a conversation as the user asked — a choice the Segretario keeps to. */
  fileConversation(accountId: string, threadId: string, topicId: string | null): Promise<void>
  /** What is open across the accounts the Segretario looks after. */
  openCommitments(): Promise<Commitment[]>
  closeCommitment(id: number): Promise<boolean>
  /** A reply was written to a message: the one prepared for it ahead is taken up, not offered beside it. */
  replyWritten(accountId: string, messageKey: string): Promise<void>
}

/** The calendars, as the Segretario reaches them: the same as the page's. */
export interface SegretarioCalendarPort {
  /** The accounts whose calendar is connected. */
  connectedAccountIds(): Promise<string[]>
  events(fromIso: string, toIso: string): Promise<CalendarEvent[]>
  create(event: NewCalendarEvent): Promise<CalendarEvent>
  respond(
    eventKey: string,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<CalendarEvent>
}

/** What the page does for the Segretario. */
export interface SegretarioPagePort {
  /** Opens a draft in the composer as `spec` says; resolves with its id. */
  compose(spec: ComposeSpec, signal: AbortSignal): Promise<string>
  show(request: ShowRequest): void
}

export interface ToolContext {
  activityId: string
  signal: AbortSignal
  handles: HandleRegistry
  /** Names given during this call, to keep in the log. */
  newHandles: HandleRecord[]
  mail: SegretarioMailPort
  work: SegretarioWorkPort
  calendar: SegretarioCalendarPort
  page: SegretarioPagePort
  store: AiStore
  /**
   * Asks the user to confirm and waits for the answer. For a send, the page
   * sends the draft and says how it went.
   */
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
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function booleanArg(args: Record<string, unknown>, name: string): boolean {
  return args[name] === true
}
