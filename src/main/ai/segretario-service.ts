import { randomUUID } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'

import { logMainError } from '@main/utils/error-utils'
import type { SegretarioView } from '@shared/folders'
import type { MailAccount, MailAddress, MessageRef } from '@shared/models'
import {
  SEGRETARIO_IPC,
  type ActivityDetail,
  type ActivityEntry,
  type AccountLearning,
  type ActivityEvent,
  type ActivityKind,
  type ActivityStatus,
  type ActivitySummary,
  type ComposeResult,
  type ComposeSpec,
  type HandleLink,
  type MemoryNote,
  type MessageNote,
  type NotesChange,
  type ThreadBrief,
  type SegretarioContext,
  type SegretarioPreferences,
  type SegretarioSpending,
  type SegretarioStatus,
  type SendOutcome,
  type ShowRequest
} from '@shared/segretario'

import { AiStore, type StoredEvent } from './ai-store'
import {
  buildConversation,
  handleRecords,
  type ApprovalPayload,
  type AssistantPayload,
  type ClearingPayload,
  type CompactionPayload,
  type ContextPayload,
  type ErrorPayload,
  type ToolPayload,
  type UserPayload
} from './agent/conversation'
import { HandleRegistry, type HandleRecord } from './agent/handles'
import {
  ToolInputError,
  type SegretarioMailPort,
  type SegretarioTool,
  type ToolContext
} from './agent/tool-types'
import {
  OpenRouterClient,
  SegretarioError,
  type ChatUsage,
  type FetchFunction,
  type ToolCall
} from './openrouter'
import { searchMail, searchScope, threadMessages } from './mail-search'
import { parseReadyDraft, READY_DRAFT_SCHEMA, readyDraftRequest } from './ready-drafts'
import { fillTemplate, PROMPTS } from './prompts'
import {
  parseTriage,
  TRIAGE_SCHEMA,
  TRIAGE_WINDOW_DAYS,
  triageRequest,
  type TriageMessage
} from './triage'
import { SEGRETARIO_TOOLS, toolDefinitions } from './tools'
import { clip, formatDateTime, withoutQuotedHistory } from './tools/format'
import { MAX_NOTE_CHARS, memoryIndex, normalizeMemoryPath } from './tools/memory-tool'

/** Model turns one message of the user may take, at most: a safeguard, not a plan. */
const MAX_STEPS_PER_TURN = 80
/** How much the model may write in one turn: a long draft fits. */
const MAX_TOKENS_PER_TURN = 16_000
/** From this size of conversation, old tool results make room (see `buildConversation`). */
const CLEAR_TOOL_RESULTS_AT = 60_000
/** Tool results kept whole when the others are cleared. */
const RECENT_TOOL_RESULTS_KEPT = 8
/** From this size, the older part of the conversation is summarised. */
const COMPACT_AT = 140_000
/** How long the page has to open a draft it was asked for. */
const COMPOSE_TIMEOUT_MS = 30_000
/** The key and its credit are looked at again this often while the app runs. */
const KEY_RECHECK_MS = 20 * 60 * 1000
/** How often it looks whether there is work to begin on its own. */
const OWN_WORK_CHECK_MS = 60_000
/** An account is got to know once this many recent days of its mail are indexed. */
const LEARNING_READY_DAYS = 90
/** Reflections come at most this often, and only with something new to learn from. */
const REFLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Corrections a reflection takes in at once; the rest wait for the next. */
const LESSONS_PER_REFLECTION = 20
/** A draft it wrote and nobody sent is forgotten after this. */
const DRAFT_RECORD_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How often triage looks for messages without a note. */
const TRIAGE_CHECK_MS = 20_000
/** Messages taken per look, and read side by side. */
const TRIAGE_BATCH = 12
const TRIAGE_CONCURRENCY = 3
/** A message whose note failed this many times is left alone until the app starts again. */
const TRIAGE_ATTEMPTS = 2
/** The messages of a conversation triage reads before the one it annotates. */
const TRIAGE_EARLIER_MESSAGES = 5
/** Notes on the people involved that triage reads, at most. */
const TRIAGE_PEOPLE_NOTES = 3
/** Replies prepared per look, one after the other. */
const READY_DRAFT_BATCH = 4
/** The user's own replies to the same person a prepared reply learns the voice from. */
const READY_DRAFT_EXAMPLES = 3
/** The core notes the context block carries whole; the others are in the index. */
const CORE_NOTES = ['tu.md', 'stile.md']
const STREAM_FLUSH_MS = 60

const EMPTY_STATUS: SegretarioStatus = {
  keyState: 'missing',
  keyLabel: null,
  credit: null,
  checkedAt: null,
  problem: null,
  modelName: null
}

interface RunningActivity {
  kind: ActivityKind
  controller: AbortController
  approvals: Map<
    string,
    {
      eventId: number
      payload: ApprovalPayload
      resolve: (answer: { approved: boolean; outcome?: SendOutcome }) => void
      reject: (error: Error) => void
    }
  >
}

export interface SegretarioServiceOptions {
  database: { storeClient(): Promise<PrismaClient> }
  mail: SegretarioMailPort
  fetch: FetchFunction
  /** Sends an event to the window. */
  send(channel: string, payload: unknown): void
}

/**
 * The Segretario at work: its key and credit, the activities it runs side
 * by side, and the loop each one turns — the model writes, calls its tools,
 * reads what they found, and goes on until the work is done. The harness
 * is deliberately plain: the model decides how to work; what is kept here
 * is what cannot be left to it — the user's confirmation before anything
 * leaves, the log every activity is rebuilt from, the size of what the
 * model reads.
 */
export class SegretarioService {
  private store: AiStore | null = null
  private readonly client: OpenRouterClient
  private status: SegretarioStatus = EMPTY_STATUS
  private readonly running = new Map<string, RunningActivity>()
  private readonly composeRequests = new Map<
    string,
    { resolve: (draftId: string) => void; reject: (error: Error) => void }
  >()
  private readonly tools: ReadonlyArray<SegretarioTool> = SEGRETARIO_TOOLS
  private readonly toolsByName = new Map(this.tools.map((tool) => [tool.name, tool]))
  private recheckTimer: ReturnType<typeof setInterval> | null = null
  private readonly opened = Promise.withResolvers<void>()
  private ownWorkTimer: NodeJS.Timeout | null = null
  private consideringOwnWork = false
  private triageTimer: NodeJS.Timeout | null = null
  private triaging = false
  /** Messages whose note failed, by account and key, with the attempts made. */
  private readonly triageFailures = new Map<string, number>()
  private preparing = false
  /** Messages whose prepared reply failed, by account and key, with the attempts made. */
  private readonly readyDraftFailures = new Map<string, number>()

  constructor(private readonly options: SegretarioServiceOptions) {
    this.client = new OpenRouterClient(options.fetch)
  }

  /** Resolves once `open` has run: what the page asks for waits on it. */
  whenReady(): Promise<void> {
    return this.opened.promise
  }

  async open(): Promise<void> {
    const store = new AiStore(await this.options.database.storeClient())
    this.store = store
    this.status = (await store.getStoredStatus()) ?? EMPTY_STATUS

    // Work a quit cut short cannot go on by itself: it says so, and waits
    // for the user to pick it up again.
    for (const activity of await store.listUnfinished()) {
      await store.appendEvent<ErrorPayload>(activity.id, 'error', {
        code: 'interrupted',
        message: 'Interrotto: SIEVER Mail è stato chiuso mentre lavoravo. Scrivimi per riprendere.'
      })
      await store.updateActivity(activity.id, { status: 'failed', unseen: true })
      await this.afterOwnWork(activity.id, activity.kind, 'failed')
    }

    await store.pruneDrafts(Date.now() - DRAFT_RECORD_TTL_MS)

    if (this.status.keyState !== 'missing') {
      void this.checkKey()
    }

    this.recheckTimer = setInterval(() => {
      if (this.status.keyState !== 'missing') {
        void this.checkKey()
      }
    }, KEY_RECHECK_MS)
    this.ownWorkTimer = setInterval(() => void this.considerOwnWork(), OWN_WORK_CHECK_MS)
    this.triageTimer = setInterval(() => void this.triageRound(), TRIAGE_CHECK_MS)
    this.opened.resolve()
  }

  async stop(): Promise<void> {
    if (this.recheckTimer) {
      clearInterval(this.recheckTimer)
      this.recheckTimer = null
    }

    if (this.ownWorkTimer) {
      clearInterval(this.ownWorkTimer)
      this.ownWorkTimer = null
    }

    if (this.triageTimer) {
      clearInterval(this.triageTimer)
      this.triageTimer = null
    }

    for (const activity of this.running.values()) {
      activity.controller.abort()
    }
  }

  private requireStore(): AiStore {
    if (!this.store) {
      throw new Error('Il Segretario non è ancora pronto.')
    }

    return this.store
  }

  /* ─────────────────────────────── key and credit ─────────────────────────────── */

  getStatus(): SegretarioStatus {
    return this.status
  }

  private async setStatus(status: SegretarioStatus): Promise<SegretarioStatus> {
    const becameReady = status.keyState === 'ready' && this.status.keyState !== 'ready'
    this.status = status
    await this.requireStore().setStoredStatus(status)
    this.options.send(SEGRETARIO_IPC.statusChanged, status)

    if (becameReady) {
      void this.considerOwnWork()
      void this.triageRound()
    }

    return status
  }

  /** Checks a key and keeps it, encrypted, if OpenRouter knows it. */
  async saveKey(rawKey: string): Promise<SegretarioStatus> {
    const key = rawKey.trim()

    if (!/^sk-or-[\w-]{10,}$/.test(key)) {
      throw new Error('Questa non sembra una chiave OpenRouter: inizia con «sk-or-».')
    }

    let status: SegretarioStatus

    try {
      status = await this.statusFor(key)
    } catch (error) {
      if (error instanceof SegretarioError && error.code === 'invalid-key') {
        throw new Error(
          'OpenRouter non riconosce questa chiave: controlla di averla copiata intera.'
        )
      }

      // OpenRouter could not be reached: the key is kept, and checked later.
      status = {
        ...EMPTY_STATUS,
        keyState: 'unchecked',
        problem: error instanceof Error ? error.message : String(error)
      }
    }

    await this.requireStore().setApiKey(key, status)
    return this.setStatus(status)
  }

  async removeKey(): Promise<SegretarioStatus> {
    await this.requireStore().setApiKey(null, EMPTY_STATUS)
    return this.setStatus(EMPTY_STATUS)
  }

  /** Asks OpenRouter again about the key and its credit. */
  async checkKey(): Promise<SegretarioStatus> {
    const key = await this.requireStore().getApiKey()

    if (!key) {
      return this.setStatus(EMPTY_STATUS)
    }

    try {
      return await this.setStatus(await this.statusFor(key))
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error)

      if (error instanceof SegretarioError && error.code === 'invalid-key') {
        return this.setStatus({
          ...this.status,
          keyState: 'invalid',
          problem,
          checkedAt: Date.now()
        })
      }

      return this.setStatus({ ...this.status, keyState: 'unchecked', problem })
    }
  }

  private async statusFor(key: string): Promise<SegretarioStatus> {
    const [check, modelName] = await Promise.all([
      this.client.checkKey(key),
      this.client.modelName(key).catch(() => this.status.modelName)
    ])
    const limits = [check.balance, check.limitRemaining].filter(
      (value): value is number => value !== null
    )
    const available = limits.length > 0 ? Math.min(...limits) : null

    return {
      keyState: available !== null && available <= 0 ? 'exhausted' : 'ready',
      keyLabel: check.label,
      credit:
        available === null
          ? null
          : {
              available,
              balance: check.balance,
              keyLimit: check.limit,
              keyRemaining: check.limitRemaining,
              keyLimitReset: check.limitReset
            },
      checkedAt: Date.now(),
      problem:
        available !== null && available <= 0
          ? 'Il credito OpenRouter è finito: ricaricalo su openrouter.ai per riprendere.'
          : null,
      modelName
    }
  }

  /** The key, or the reason the Segretario cannot work now. */
  private async requireKey(): Promise<string> {
    const key = await this.requireStore().getApiKey()

    if (!key) {
      throw new SegretarioError(
        'no-key',
        'Per lavorare mi serve una chiave OpenRouter: inseriscila in Impostazioni → Segretario.'
      )
    }

    return key
  }

  getPreferences(): Promise<SegretarioPreferences> {
    return this.requireStore().getPreferences()
  }

  async setPreferences(preferences: SegretarioPreferences): Promise<SegretarioPreferences> {
    const stored = await this.requireStore().setPreferences(preferences)
    void this.considerOwnWork()
    void this.triageRound()
    return stored
  }

  /** What the Segretario has cost today and this month, by the local calendar. */
  async getSpending(): Promise<SegretarioSpending> {
    const now = new Date()
    const store = this.requireStore()
    const [today, thisMonth] = await Promise.all([
      store.spentSince(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()),
      store.spentSince(new Date(now.getFullYear(), now.getMonth(), 1).getTime())
    ])

    return { today, thisMonth }
  }

  /** What the model was paid for, so far: every call goes through here. */
  private async recordUsage(
    activityId: string | null,
    purpose: string,
    result: { usage: ChatUsage; model: string | null; provider: string | null }
  ): Promise<void> {
    await this.requireStore().recordUsage({
      activityId,
      purpose,
      model: result.model,
      provider: result.provider,
      usage: result.usage
    })
  }

  /* ───────────────────────────────── activities ───────────────────────────────── */

  listActivities(): Promise<ActivitySummary[]> {
    return this.requireStore().listActivities()
  }

  async getActivity(id: string): Promise<ActivityDetail | null> {
    const store = this.requireStore()
    const summary = await store.getActivity(id)

    if (!summary) {
      return null
    }

    const entries = (await store.listEvents(id))
      .map(entryOf)
      .filter((entry): entry is ActivityEntry => entry !== null)

    return { ...summary, entries }
  }

  async startActivity(text: string, context: SegretarioContext): Promise<ActivitySummary> {
    const store = this.requireStore()
    await this.requireKey()
    const id = randomUUID()
    const summary = await store.createActivity({
      id,
      kind: 'richiesta',
      title: firstLine(text),
      status: 'running'
    })

    this.emit({ type: 'summary', activity: summary })
    await store.appendEvent<ContextPayload>(id, 'context', { text: await this.contextBlock() })
    const request = await this.appendUserMessage(id, text, context)
    void this.nameActivity(id, request)
    void this.runTurn(id)
    return summary
  }

  async sendMessage(id: string, text: string, context: SegretarioContext): Promise<void> {
    const store = this.requireStore()

    if (this.running.has(id)) {
      throw new Error('Sto ancora lavorando su questo: aspetta che finisca o fermami.')
    }

    if (!(await store.getActivity(id))) {
      throw new Error('Questo lavoro non esiste più.')
    }

    await this.requireKey()
    await this.appendUserMessage(id, text, context)
    void this.runTurn(id)
  }

  async cancelActivity(id: string): Promise<void> {
    this.running.get(id)?.controller.abort()
  }

  async removeActivity(id: string): Promise<void> {
    this.running.get(id)?.controller.abort()
    await this.requireStore().deleteActivity(id)
    this.emit({ type: 'removed', activityId: id })
  }

  async markActivitySeen(id: string): Promise<void> {
    const summary = await this.requireStore().updateActivity(id, { unseen: false })

    if (summary) {
      this.emit({ type: 'summary', activity: summary })
    }
  }

  async resolveApproval(
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: SendOutcome
  ): Promise<void> {
    const pending = this.running.get(activityId)?.approvals.get(approvalId)

    if (!pending) {
      throw new Error('Questa conferma non è più in attesa.')
    }

    pending.resolve({ approved, outcome })
  }

  /** The page opened the draft a compose request asked for, or could not. */
  completeCompose(requestId: string, result: ComposeResult): void {
    const request = this.composeRequests.get(requestId)

    if (!request) {
      return
    }

    this.composeRequests.delete(requestId)

    if ('draftId' in result) {
      request.resolve(result.draftId)
    } else {
      request.reject(new ToolInputError(result.error))
    }
  }

  /** Everything but the key and the settings, for "Elimina tutti i dati". */
  async clearData(): Promise<void> {
    for (const id of [...this.running.keys()]) {
      this.running.get(id)?.controller.abort()
    }

    await this.requireStore().clearData()
  }

  /* ─────────────────────────── notes on the mail ─────────────────────────── */

  getNotes(
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<MessageNote[]> {
    return this.requireStore().getNotes(messages)
  }

  getThreadBrief(accountId: string, threadId: string): Promise<ThreadBrief> {
    return this.requireStore().threadBrief(accountId, threadId)
  }

  /** The messages a view of the Segretario's holds, one per conversation (see `AiStore.viewMessages`). */
  viewMessages(
    view: SegretarioView,
    accountIds: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; messageKey: string }>> {
    return this.requireStore().viewMessages(view, accountIds)
  }

  async readyDraftSource(accountId: string, messageKey: string): Promise<MessageRef | null> {
    return (await this.options.mail.refForKey(accountId, messageKey))?.ref ?? null
  }

  async takeUpReadyDraft(accountId: string, messageKey: string, draftId: string): Promise<void> {
    const store = this.requireStore()
    const used = await store.closeReadyDraft(accountId, messageKey, 'usata')

    if (used) {
      await store.recordDraft({ draftId, activityId: null, accountId, text: used.text })
      this.emitNotes({ accountId, messageKeys: [messageKey], threadIds: [used.threadId] })
    }
  }

  async discardReadyDraft(accountId: string, messageKey: string): Promise<void> {
    const discarded = await this.requireStore().closeReadyDraft(accountId, messageKey, 'scartata')

    if (discarded) {
      this.emitNotes({ accountId, messageKeys: [messageKey], threadIds: [discarded.threadId] })
    }
  }

  async closeCommitment(id: number): Promise<void> {
    const closed = await this.requireStore().closeCommitment(id)

    if (closed) {
      this.emitNotes({ accountId: closed.accountId, messageKeys: [], threadIds: [closed.threadId] })
    }
  }

  async dismissNote(accountId: string, messageKey: string): Promise<void> {
    const note = await this.requireStore().dismissNote(accountId, messageKey)

    if (note) {
      this.emitNotes({ accountId, messageKeys: [messageKey], threadIds: [note.threadId] })
    }
  }

  private emitNotes(change: NotesChange): void {
    this.options.send(SEGRETARIO_IPC.notesChanged, change)
  }

  /**
   * Writes the note of every message of the last two weeks, received or
   * sent, that has none and whose text is indexed — the newest first, a
   * few at a time. Each note is one quick call, without reasoning, held to
   * the schema the views read.
   */
  private async triageRound(): Promise<void> {
    if (this.triaging || !this.store || this.status.keyState !== 'ready') {
      return
    }

    this.triaging = true

    try {
      const store = this.store

      while ((await store.getPreferences()).triage && this.status.keyState === 'ready') {
        const since = new Date(Date.now() - TRIAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        const failing = (accountId: string, messageKey: string): boolean =>
          (this.triageFailures.get(`${accountId}\u0000${messageKey}`) ?? 0) >= TRIAGE_ATTEMPTS
        const threads = (
          await this.options.mail.untriagedThreads(
            since.toISOString(),
            TRIAGE_BATCH + this.triageFailures.size
          )
        )
          .map((thread) => ({
            ...thread,
            messages: thread.messages.filter(
              (message) => !failing(thread.accountId, message.messageKey)
            )
          }))
          .filter((thread) => thread.messages.length > 0)
          .slice(0, TRIAGE_BATCH)

        if (threads.length === 0) {
          return
        }

        const key = await this.requireKey()
        const accounts = await this.options.mail.listAccounts()
        const notes = await store.listMemory()
        const queue = [...threads]
        let reachable = true

        // Conversations side by side; within one, its messages in the order
        // they were written: what one opens, a later one may close.
        await Promise.all(
          Array.from({ length: TRIAGE_CONCURRENCY }, async () => {
            for (let thread = queue.shift(); thread && reachable; thread = queue.shift()) {
              for (const message of thread.messages) {
                reachable = await this.triageOne(
                  { ...message, threadId: thread.threadId },
                  key,
                  accounts,
                  notes
                )

                if (!reachable) {
                  break
                }
              }
            }
          })
        )

        // OpenRouter out of reach, or the key refused: the next look tries again.
        if (!reachable) {
          return
        }
      }
    } catch (error) {
      logMainError('Segretario: triage round failed', error)
    } finally {
      this.triaging = false
      // With the notes written, the replies they call for.
      void this.prepareReadyDrafts()
    }
  }

  /**
   * Prepares, one at a time, the replies the user will want: for each
   * conversation that waits on the user's answer and matters, the reply in
   * their voice, from the conversation, what is known of the person and how
   * the user writes to them. It stays a proposal until the user takes it up.
   */
  private async prepareReadyDrafts(): Promise<void> {
    if (this.preparing || !this.store || this.status.keyState !== 'ready') {
      return
    }

    this.preparing = true

    try {
      const store = this.store

      while ((await store.getPreferences()).readyDrafts && this.status.keyState === 'ready') {
        const since = new Date(Date.now() - TRIAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
        const wanted = (
          await store.messagesWantingReadyDraft(
            since.toISOString(),
            READY_DRAFT_BATCH + this.readyDraftFailures.size
          )
        )
          .filter(
            (item) =>
              (this.readyDraftFailures.get(`${item.accountId}\u0000${item.messageKey}`) ?? 0) <
              TRIAGE_ATTEMPTS
          )
          .slice(0, READY_DRAFT_BATCH)

        if (wanted.length === 0) {
          return
        }

        const key = await this.requireKey()
        const accounts = await this.options.mail.listAccounts()
        const notes = await store.listMemory()

        for (const item of wanted) {
          if (!(await this.prepareReadyDraft(item, key, accounts, notes))) {
            return
          }
        }
      }
    } catch (error) {
      logMainError('Segretario: preparing replies failed', error)
    } finally {
      this.preparing = false
    }
  }

  private async prepareReadyDraft(
    item: { accountId: string; messageKey: string; threadId: string },
    key: string,
    accounts: ReadonlyArray<MailAccount>,
    notes: ReadonlyArray<{ path: string; content: string }>
  ): Promise<boolean> {
    const failureKey = `${item.accountId}\u0000${item.messageKey}`

    try {
      const store = this.requireStore()
      const account = accounts.find((candidate) => candidate.id === item.accountId)
      const located = await this.options.mail.refForKey(item.accountId, item.messageKey)
      const [note] = await store.getNotes([item])

      if (!account || !located || !note) {
        // Gone meanwhile: the account, the message, its note.
        this.readyDraftFailures.set(failureKey, TRIAGE_ATTEMPTS)
        return true
      }

      const own = new Set(accounts.map((candidate) => candidate.email.toLowerCase()))
      const { target, thread, people, accountNote } = await this.conversationFor(
        { ...item, ref: located.ref, dateIso: located.dateIso },
        account,
        own,
        notes
      )
      const sender = target.from[0]?.address
      const examples = sender ? await this.repliesTo(account, accounts, sender) : []
      const tu = notes.find((candidate) => candidate.path === 'tu.md')
      const style = notes.find((candidate) => candidate.path === 'stile.md')

      const result = await this.client.chat(key, {
        messages: [
          {
            role: 'system',
            content: [
              PROMPTS.readyDraft,
              tu ? `# Chi è l'utente\n\n${tu.content.trim()}` : null,
              style ? `# Come scrive l'utente\n\n${style.content.trim()}` : null
            ]
              .filter(Boolean)
              .join('\n\n')
          },
          {
            role: 'user',
            content: readyDraftRequest({
              today: new Date(),
              accountEmail: account.email,
              accountName: account.displayName,
              accountNote: accountNote?.content ?? null,
              people,
              note: { summary: note.summary, due: note.due },
              thread,
              examples
            })
          }
        ],
        reasoningEffort: 'low',
        maxTokens: 3000,
        responseSchema: { name: 'risposta', schema: READY_DRAFT_SCHEMA }
      })

      await this.recordUsage(null, 'risposta-pronta', result)
      const draft = parseReadyDraft(result.content)

      await store.saveReadyDraft({ ...item, text: draft.text, doubts: draft.doubts })
      this.readyDraftFailures.delete(failureKey)
      this.emitNotes({
        accountId: item.accountId,
        messageKeys: [item.messageKey],
        threadIds: [item.threadId]
      })
      return true
    } catch (error) {
      if (error instanceof SegretarioError) {
        if (error.code === 'no-credit' || error.code === 'invalid-key') {
          void this.checkKey()
          return false
        }

        if (error.retryable) {
          return false
        }
      }

      const attempts = (this.readyDraftFailures.get(failureKey) ?? 0) + 1
      this.readyDraftFailures.set(failureKey, attempts)

      if (attempts === TRIAGE_ATTEMPTS) {
        logMainError('Segretario: a reply could not be prepared', error, {
          messageKey: item.messageKey
        })
      }

      return true
    }
  }

  /** The user's latest replies to someone from an account: how they write to them. */
  private async repliesTo(
    account: MailAccount,
    accounts: ReadonlyArray<MailAccount>,
    address: string
  ): Promise<Array<{ date: string; subject: string; text: string }>> {
    const mail = this.options.mail
    const scope = searchScope(
      accounts,
      new Map([[account.id, await mail.listFolders(account.id)]]),
      {
        accounts: [account.email],
        folder: 'inviata'
      }
    )
    const hits = await searchMail(await mail.searchClient(), scope, {
      text: `a:${address}`,
      limit: READY_DRAFT_EXAMPLES
    })
    const examples: Array<{ date: string; subject: string; text: string }> = []

    for (const hit of hits) {
      const message = await mail.readMessage(hit.ref)
      examples.push({
        date: formatDateTime(message.date),
        subject: message.subject,
        text: withoutQuotedHistory(message.textForReading).text
      })
    }

    return examples
  }

  /**
   * A message as the work done ahead reads it: the conversation up to it,
   * what is known of the account and of the people involved.
   */
  private async conversationFor(
    item: { ref: MessageRef; messageKey: string; threadId: string; dateIso: string },
    account: MailAccount,
    own: ReadonlySet<string>,
    notes: ReadonlyArray<{ path: string; content: string }>
  ): Promise<{
    target: Awaited<ReturnType<SegretarioMailPort['readMessage']>>
    thread: TriageMessage[]
    people: Array<{ path: string; content: string }>
    accountNote: { path: string; content: string } | undefined
  }> {
    const mail = this.options.mail
    const target = await mail.readMessage(item.ref)
    const earlier = (
      await threadMessages(
        await mail.searchClient(),
        account.id,
        item.threadId,
        await mail.listFolders(account.id),
        item.dateIso
      )
    ).filter((ref) => !(ref.folderPath === item.ref.folderPath && ref.uid === item.ref.uid))
    const thread: TriageMessage[] = []

    for (const ref of earlier.slice(-TRIAGE_EARLIER_MESSAGES)) {
      const message = await mail.readMessage(ref)

      if (message.messageKey !== item.messageKey) {
        thread.push(triageMessage(message, false))
      }
    }

    thread.push(triageMessage(target, true))

    const addresses = new Set(
      thread
        .flatMap((message) => [...message.from, ...message.to, ...message.cc])
        .map((address) => address.address.toLowerCase())
        .filter((address) => !own.has(address))
    )

    return {
      target,
      thread,
      people: notes
        .filter(
          (note) =>
            note.path.startsWith('persone/') &&
            [...addresses].some((address) => note.content.toLowerCase().includes(address))
        )
        .slice(0, TRIAGE_PEOPLE_NOTES),
      accountNote: notes.find(
        (note) => note.path === normalizeMemoryPath(`account/${account.email}`)
      )
    }
  }

  private async triageOne(
    item: { ref: MessageRef; messageKey: string; threadId: string; dateIso: string },
    key: string,
    accounts: ReadonlyArray<MailAccount>,
    notes: ReadonlyArray<{ path: string; content: string }>
  ): Promise<boolean> {
    const failureKey = `${item.ref.accountId}\u0000${item.messageKey}`
    const account = accounts.find((candidate) => candidate.id === item.ref.accountId)

    if (!account) {
      return true
    }

    try {
      const store = this.requireStore()
      const own = new Set(accounts.map((candidate) => candidate.email.toLowerCase()))
      const { target, thread, people, accountNote } = await this.conversationFor(
        item,
        account,
        own,
        notes
      )
      const tu = notes.find((note) => note.path === 'tu.md')
      const open = await store.openCommitments(account.id, item.threadId)
      const fromUser = target.from.some((address) => own.has(address.address.toLowerCase()))

      const result = await this.client.chat(key, {
        messages: [
          {
            role: 'system',
            content: tu
              ? `${PROMPTS.triage}\n\n# Cosa sai dell'utente\n\n${tu.content.trim()}`
              : PROMPTS.triage
          },
          {
            role: 'user',
            content: triageRequest({
              today: new Date(),
              accountEmail: account.email,
              accountName: account.displayName,
              accountNote: accountNote?.content ?? null,
              fromUser,
              people,
              open,
              thread
            })
          }
        ],
        reasoningEffort: 'none',
        maxTokens: 1000,
        responseSchema: { name: 'nota', schema: TRIAGE_SCHEMA }
      })

      await this.recordUsage(null, 'smistamento', result)
      const triage = parseTriage(result.content)

      await store.saveTriage(
        {
          accountId: account.id,
          messageKey: item.messageKey,
          threadId: item.threadId,
          direction: fromUser ? 'out' : 'in',
          summary: triage.summary,
          state: triage.state,
          priority: triage.priority,
          reason: triage.reason,
          due: triage.due,
          messageDate: item.dateIso
        },
        triage.opened,
        triage.closed.filter((id) => open.some((commitment) => commitment.id === id))
      )
      this.triageFailures.delete(failureKey)
      this.emitNotes({
        accountId: account.id,
        messageKeys: [item.messageKey],
        threadIds: [item.threadId]
      })
      return true
    } catch (error) {
      // Not the message's fault: the network, OpenRouter, the key. It waits for the next look.
      if (error instanceof SegretarioError) {
        if (error.code === 'no-credit' || error.code === 'invalid-key') {
          void this.checkKey()
          return false
        }

        if (error.retryable) {
          return false
        }
      }

      const attempts = (this.triageFailures.get(failureKey) ?? 0) + 1
      this.triageFailures.set(failureKey, attempts)

      if (attempts === TRIAGE_ATTEMPTS) {
        logMainError('Segretario: a message could not be annotated', error, {
          messageKey: item.messageKey
        })
      }

      return true
    }
  }

  /* ──────────────────────────────── its memory ──────────────────────────────── */

  async listMemory(): Promise<MemoryNote[]> {
    return (await this.requireStore().listMemory()).map((note) => ({
      path: note.path,
      content: note.content,
      updatedAt: note.updatedAt
    }))
  }

  /** A note as the user corrected it. */
  async writeMemory(path: string, content: string): Promise<MemoryNote[]> {
    if (content.length > MAX_NOTE_CHARS) {
      throw new Error('La nota è troppo lunga: dividila in più note.')
    }

    await this.requireStore().writeMemory(normalizeMemoryPath(path), content)
    return this.listMemory()
  }

  async deleteMemory(path: string): Promise<MemoryNote[]> {
    await this.requireStore().deleteMemory(normalizeMemoryPath(path))
    return this.listMemory()
  }

  /** Forgets everything it learnt, and begins getting to know every account again. */
  async forgetEverything(): Promise<void> {
    const store = this.requireStore()

    for (const running of this.running.values()) {
      if (running.kind !== 'richiesta') {
        running.controller.abort()
      }
    }

    await store.clearMemory()
    await store.resetLearning()
    void this.considerOwnWork()
  }

  /* ──────────────────────── getting to know the user ──────────────────────── */

  async listLearning(): Promise<AccountLearning[]> {
    const accounts = await this.options.mail.listAccounts()
    const rows = new Map(
      (await this.requireStore().listLearning()).map((row) => [row.accountId, row])
    )

    return accounts.map((account) => {
      const row = rows.get(account.id)
      const state: AccountLearning['state'] = !row
        ? 'waiting'
        : row.finishedAt !== null
          ? 'done'
          : row.activityId && this.running.has(row.activityId)
            ? 'running'
            : 'stopped'

      return {
        accountId: account.id,
        email: account.email,
        state,
        activityId: row?.activityId ?? null,
        finishedAt: row?.finishedAt ?? null
      }
    })
  }

  /** Gets to know an account again, from the start. */
  async relearnAccount(accountId: string): Promise<AccountLearning[]> {
    const store = this.requireStore()
    const row = (await store.listLearning()).find((item) => item.accountId === accountId)

    if (row?.activityId) {
      this.running.get(row.activityId)?.controller.abort()
    }

    await store.resetLearning(accountId)
    void this.considerOwnWork()
    return this.listLearning()
  }

  /**
   * A draft went out. When the Segretario had written it, what the user
   * changed — or that they changed nothing — is kept for the next
   * reflection.
   */
  async draftSent(draftId: string, writtenText: string): Promise<void> {
    const store = this.requireStore()
    const draft = await store.takeDraft(draftId)

    if (!draft || (await store.getPreferences()).learning !== true) {
      return
    }

    const comparable = (text: string): string =>
      text
        .replace(/\*\*/g, '')
        .replace(/^\s*[-•*]\s+/gm, '- ')
        .replace(/\s+/g, ' ')
        .trim()

    if (comparable(draft.text) === comparable(writtenText)) {
      await store.addLesson('confermata', { accountId: draft.accountId })
    } else {
      await store.addLesson('correzione', {
        accountId: draft.accountId,
        written: draft.text,
        sent: writtenText
      })
    }
  }

  /** An account was removed: what was learnt about it alone goes, and the next reflection hears of it. */
  async forgetAccount(accountId: string, email: string): Promise<void> {
    const store = this.requireStore()
    const row = (await store.listLearning()).find((item) => item.accountId === accountId)

    if (row?.activityId) {
      this.running.get(row.activityId)?.controller.abort()
    }

    await store.forgetAccount(accountId, normalizeMemoryPath(`account/${email}`))

    if ((await store.getPreferences()).learning === true) {
      await store.addLesson('account-rimosso', { email })
    }
  }

  /* ───────────────────────── work it begins itself ───────────────────────── */

  /**
   * Begins what it does on its own, one thing at a time, when it may: a key
   * that answers and the user's yes to learning. First it gets to know each
   * account whose recent mail is indexed; then, with corrections to learn
   * from and the user not waiting on it, it reflects.
   */
  private async considerOwnWork(): Promise<void> {
    if (this.consideringOwnWork || !this.store || this.status.keyState !== 'ready') {
      return
    }

    this.consideringOwnWork = true

    try {
      const running = [...this.running.values()].map((activity) => activity.kind)

      if (
        (await this.store.getPreferences()).learning !== true ||
        running.includes('conoscerti') ||
        running.includes('riflessione')
      ) {
        return
      }

      if (!(await this.beginLearning()) && !running.includes('richiesta')) {
        await this.beginReflection()
      }
    } catch (error) {
      logMainError('Segretario: own work could not begin', error)
    } finally {
      this.consideringOwnWork = false
    }
  }

  private async beginLearning(): Promise<boolean> {
    const store = this.requireStore()
    const accounts = await this.options.mail.listAccounts()
    const rows = new Map((await store.listLearning()).map((row) => [row.accountId, row]))

    for (const account of accounts) {
      if (
        rows.has(account.id) ||
        !(await this.options.mail.recentMailIndexed(account.id, LEARNING_READY_DAYS))
      ) {
        continue
      }

      const known = accounts.filter(
        (other) => other.id !== account.id && rows.get(other.id)?.finishedAt
      )
      const id = await this.beginOwnActivity(
        'conoscerti',
        `Conoscerti · ${account.email}`,
        `Comincio a conoscerti da ${account.email}: leggo la posta che hai scritto e prendo appunti.`,
        fillTemplate(PROMPTS.learning, {
          account: account.email,
          nome: account.displayName,
          altri_account:
            known.length > 0
              ? `Conosci già ${known.map((other) => other.email).join(', ')}: rileggi le loro note prima di scrivere, perché tutto resti coerente.`
              : ''
        })
      )

      await store.startLearning(account.id, id)
      void this.runTurn(id)
      return true
    }

    return false
  }

  private async beginReflection(): Promise<void> {
    const store = this.requireStore()
    const lessons = (await store.pendingLessons()).slice(0, LESSONS_PER_REFLECTION)
    const last = await store.lastReflectionAt()

    if (
      !lessons.some((lesson) => lesson.kind !== 'confermata') ||
      (last !== null && Date.now() - last < REFLECTION_INTERVAL_MS)
    ) {
      return
    }

    const emails = new Map(
      (await this.options.mail.listAccounts()).map((account) => [account.id, account.email])
    )
    const confirmed = new Map<string, number>()
    const parts: string[] = []

    for (const lesson of lessons) {
      const payload = lesson.payload as {
        accountId?: string
        email?: string
        written?: string
        sent?: string
      }
      const from = emails.get(payload.accountId ?? '') ?? 'un account rimosso'
      const when = formatDateTime(new Date(lesson.createdAt).toISOString())

      switch (lesson.kind) {
        case 'correzione':
          parts.push(
            [
              `## Bozza da ${from}, mandata ${when}`,
              'Avevi scritto:',
              quoteBlock(payload.written ?? ''),
              "L'utente ha mandato:",
              quoteBlock(payload.sent ?? '')
            ].join('\n\n')
          )
          break
        case 'confermata':
          confirmed.set(from, (confirmed.get(from) ?? 0) + 1)
          break
        case 'account-rimosso':
          parts.push(`## Account rimosso\n\n${payload.email} è stato rimosso ${when}.`)
          break
      }
    }

    for (const [from, count] of confirmed) {
      parts.push(
        `## Bozze mandate così com'erano\n\n${count === 1 ? 'Una bozza' : `${count} bozze`} da ${from}.`
      )
    }

    const id = await this.beginOwnActivity(
      'riflessione',
      'Riflessione',
      'Rimetto in ordine quello che ho imparato dalle ultime bozze che hai mandato.',
      fillTemplate(PROMPTS.reflection, { materiale: parts.join('\n\n') })
    )

    await store.claimLessons(
      lessons.map((lesson) => lesson.id),
      id
    )
    void this.runTurn(id)
  }

  /** An activity it began on its own, with the goal it set out with. */
  private async beginOwnActivity(
    kind: ActivityKind,
    title: string,
    shown: string,
    goal: string
  ): Promise<string> {
    const store = this.requireStore()
    const id = randomUUID()
    const summary = await store.createActivity({ id, kind, title, status: 'running' })

    this.emit({ type: 'summary', activity: summary })
    await store.appendEvent<ContextPayload>(id, 'context', { text: await this.contextBlock() })
    const event = await store.appendEvent<UserPayload>(id, 'user', {
      text: shown,
      forModel: `[${formatDateTime(new Date().toISOString())}]\n\n${goal}`,
      handles: [],
      origin: 'segretario'
    })

    this.emitEntry(id, event)
    return id
  }

  /** What follows from the end of work it began itself. */
  private async afterOwnWork(id: string, kind: ActivityKind, ended: ActivityStatus): Promise<void> {
    const store = this.requireStore()

    switch (kind) {
      case 'conoscerti':
        // Stopped by the user, it waits for them; failed, it begins again later.
        if (ended !== 'cancelled') {
          await store.endLearning(id, ended === 'done')
        }
        return
      case 'riflessione':
        await store.endReflection(id, ended === 'done')
        return
      case 'richiesta':
        return
    }
  }

  private emit(event: ActivityEvent): void {
    this.options.send(SEGRETARIO_IPC.activityEvent, event)
  }

  private async emitSummary(id: string): Promise<void> {
    const summary = await this.requireStore().getActivity(id)

    if (summary) {
      this.emit({ type: 'summary', activity: summary })
    }
  }

  private emitEntry(activityId: string, event: StoredEvent): void {
    const entry = entryOf(event)

    if (entry) {
      this.emit({ type: 'entry', activityId, entry })
    }
  }

  /**
   * The context block an activity begins with (`contesto.md`): the date,
   * the accounts, the memory's index and its core notes, with the note of
   * each account. The model reads the rest of the memory when it needs it.
   */
  private async contextBlock(): Promise<string> {
    const store = this.requireStore()
    const [accounts, signatures] = await Promise.all([
      this.options.mail.listAccounts(),
      this.options.mail.accountSignatures()
    ])
    const notes = await store.listMemory()
    const now = new Date()
    const accountNotes = notes.filter((note) => note.path.startsWith('account/'))
    const core = [
      ...CORE_NOTES.map((path) => notes.find((note) => note.path === path)).filter(
        (note): note is NonNullable<typeof note> => note !== undefined
      ),
      ...accountNotes
    ]

    return fillTemplate(PROMPTS.context, {
      data: new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(now),
      ora: new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(now),
      fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
      account:
        accounts.length === 0
          ? '(nessun account)'
          : accounts
              .map((account) => {
                const signature = signatures.get(account.id)
                return [
                  `- ${account.email} — ${account.displayName}`,
                  signature
                    ? `  Firma dell'utente da questo account: «${clip(signature.replace(/\s+/g, ' '), 400).text}»`
                    : '  Nessuna firma per questo account.'
                ].join('\n')
              })
              .join('\n'),
      indice_memoria: await memoryIndex(store),
      note_principali: core.map((note) => `### ${note.path}\n\n${note.content.trim()}`).join('\n\n')
    })
  }

  /**
   * The user's words, with the moment and what they are looking at, as the
   * model reads them — and as it returns them.
   */
  private async appendUserMessage(
    id: string,
    text: string,
    context: SegretarioContext
  ): Promise<string> {
    const store = this.requireStore()
    const handles = new HandleRegistry(handleRecords(await store.listEvents(id)))
    const added: HandleRecord[] = []
    const lines = [`[${formatDateTime(new Date().toISOString())}]`]

    if (context.messages.length > 0) {
      const described = await this.describeMessages(context.messages, handles, added)
      lines.push(
        context.messages.length === 1
          ? `L'utente sta guardando: ${described[0]}`
          : `L'utente ha selezionato ${context.messages.length} messaggi:\n${described.map((line) => `- ${line}`).join('\n')}`
      )
    } else if (context.folderLabel) {
      lines.push(`L'utente è in: ${context.folderLabel}.`)
    }

    lines.push('', text.trim())
    const forModel = lines.join('\n')
    const event = await store.appendEvent<UserPayload>(id, 'user', {
      text: text.trim(),
      context,
      forModel,
      handles: added
    })

    this.emitEntry(id, event)
    return forModel
  }

  private async describeMessages(
    refs: ReadonlyArray<MessageRef>,
    handles: HandleRegistry,
    added: HandleRecord[]
  ): Promise<string[]> {
    const lines: string[] = []

    for (const ref of refs.slice(0, 20)) {
      try {
        const message = await this.options.mail.readMessage(ref)
        const handle = handles.name({ kind: 'message', ref, messageKey: message.messageKey }, added)
        const sender = message.from[0]?.name || message.from[0]?.address || 'mittente sconosciuto'
        lines.push(`${handle} «${message.subject}» da ${sender}, ${formatDateTime(message.date)}`)
      } catch {
        // A message that left meanwhile is simply not described.
      }
    }

    return lines
  }

  /**
   * A short title for the activity, written by the model while it starts
   * working, from the request as the model reads it: "riassumimi" says
   * little without the message the user was looking at.
   */
  private async nameActivity(id: string, request: string): Promise<void> {
    try {
      const key = await this.requireKey()
      const result = await this.client.chat(key, {
        messages: [
          { role: 'system', content: PROMPTS.title },
          { role: 'user', content: request.slice(0, 4_000) }
        ],
        reasoningEffort: 'none',
        maxTokens: 40
      })

      await this.recordUsage(id, 'titolo', result)
      const title = result.content
        .trim()
        .replace(/^["«]|["».]$/g, '')
        .slice(0, 80)

      if (title) {
        await this.requireStore().updateActivity(id, { title })
        await this.emitSummary(id)
      }
    } catch (error) {
      logMainError('Naming an activity failed', error)
    }
  }

  /**
   * One turn of an activity: the model works until it has nothing left to
   * call — or the user stops it, or it needs them.
   */
  private async runTurn(id: string): Promise<void> {
    const store = this.requireStore()
    const kind = (await store.getActivity(id))?.kind ?? 'richiesta'
    const activity: RunningActivity = {
      kind,
      controller: new AbortController(),
      approvals: new Map()
    }
    let ended: ActivityStatus = 'failed'
    const { signal } = activity.controller
    this.running.set(id, activity)
    await store.updateActivity(id, { status: 'running' })
    await this.emitSummary(id)

    try {
      const key = await this.requireKey()
      const tools = toolDefinitions(this.tools)

      for (let step = 0; step < MAX_STEPS_PER_TURN; step += 1) {
        const events = await store.listEvents(id)
        const handles = new HandleRegistry(handleRecords(events))
        let streamed = ''
        let flushTimer: ReturnType<typeof setTimeout> | null = null

        const result = await this.client.chat(
          key,
          {
            messages: buildConversation(PROMPTS.system, events),
            tools,
            reasoningEffort: 'low',
            maxTokens: MAX_TOKENS_PER_TURN,
            sessionId: id
          },
          {
            signal,
            onText: (text) => {
              streamed += text
              flushTimer ??= setTimeout(() => {
                flushTimer = null
                this.emit({ type: 'stream', activityId: id, text: streamed })
              }, STREAM_FLUSH_MS)
            }
          }
        )

        if (flushTimer) {
          clearTimeout(flushTimer)
        }

        await this.recordUsage(id, 'attivita', result)
        const assistant = await store.appendEvent<AssistantPayload>(id, 'assistant', {
          content: result.content,
          toolCalls: result.toolCalls,
          reasoningDetails: result.reasoningDetails
        })

        this.emit({ type: 'stream', activityId: id, text: '' })
        this.emitEntry(id, assistant)

        if (result.toolCalls.length === 0) {
          break
        }

        await Promise.all(result.toolCalls.map((call) => this.runTool(id, call, handles, activity)))
        await this.manageContext(id, key, result.usage.promptTokens, signal)

        if (step === MAX_STEPS_PER_TURN - 1) {
          const event = await store.appendEvent<ErrorPayload>(id, 'error', {
            code: 'too-long',
            message:
              'Mi sono fermato: il lavoro stava richiedendo troppi passaggi. Dimmi come proseguire.'
          })
          this.emitEntry(id, event)
        }
      }

      // A reflection is quiet work: it is there to read, never waiting to be seen.
      await store.updateActivity(id, { status: 'done', unseen: kind !== 'riflessione' })
      ended = 'done'
    } catch (raw) {
      const error = raw instanceof SegretarioError ? raw : null

      if (signal.aborted || error?.code === 'cancelled') {
        await store.updateActivity(id, { status: 'cancelled' })
        ended = 'cancelled'
      } else {
        const message =
          error?.message ??
          (raw instanceof Error ? raw.message : 'Qualcosa è andato storto mentre lavoravo.')

        if (!error) {
          logMainError('Segretario activity failed', raw, { activityId: id })
        }

        const event = await store.appendEvent<ErrorPayload>(id, 'error', {
          code: error?.code ?? 'internal',
          message
        })
        this.emitEntry(id, event)
        await store.updateActivity(id, { status: 'failed', unseen: true })

        if (error?.code === 'no-credit' || error?.code === 'invalid-key') {
          void this.checkKey()
        }
      }
    } finally {
      for (const approval of activity.approvals.values()) {
        approval.reject(new SegretarioError('cancelled', 'Interrotto.'))
      }

      this.running.delete(id)
      await this.emitSummary(id)
      await this.afterOwnWork(id, kind, ended)
      void this.considerOwnWork()
    }
  }

  private async runTool(
    activityId: string,
    call: ToolCall,
    handles: HandleRegistry,
    activity: RunningActivity
  ): Promise<void> {
    const store = this.requireStore()
    const tool = this.toolsByName.get(call.function.name)
    let args: Record<string, unknown> = {}
    let argsProblem: string | null = null

    try {
      const parsed = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {}
      args = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      argsProblem = 'Gli argomenti non sono JSON valido: riprova.'
    }

    const payload: ToolPayload = {
      callId: call.id,
      name: call.function.name,
      args,
      status: 'running',
      summary: tool ? tool.running(args) : call.function.name,
      handles: []
    }
    const event = await store.appendEvent(activityId, 'tool', payload)
    this.emitEntry(activityId, event)

    const finish = async (changes: Partial<ToolPayload>): Promise<void> => {
      Object.assign(payload, changes)
      await store.updateEvent(event.id, payload)
      this.emitEntry(activityId, { ...event, payload })
    }

    if (!tool || argsProblem) {
      await finish({
        status: 'error',
        summary: tool ? 'Argomenti non validi' : `Strumento sconosciuto: ${call.function.name}`,
        result: argsProblem ?? `Non esiste lo strumento «${call.function.name}».`
      })
      return
    }

    const context: ToolContext = {
      activityId,
      signal: activity.controller.signal,
      handles,
      newHandles: [],
      mail: this.options.mail,
      store,
      page: {
        compose: (spec, signal) => this.requestCompose(spec, signal),
        show: (request: ShowRequest) => this.options.send(SEGRETARIO_IPC.showRequest, request)
      },
      requestApproval: (request) => this.requestApproval(activityId, call.id, request, activity)
    }

    try {
      const outcome = await tool.execute(args, context)
      await finish({
        status: outcome.failed ? 'error' : 'done',
        summary: outcome.summary,
        result: outcome.content,
        messages: outcome.messages,
        files: outcome.files,
        handles: context.newHandles
      })
    } catch (error) {
      if (error instanceof SegretarioError && error.code === 'cancelled') {
        await finish({ status: 'error', summary: 'Interrotto', result: 'Interrotto.' })
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)

      if (!(error instanceof ToolInputError)) {
        logMainError(`Segretario tool ${tool.name} failed`, error, { activityId })
      }

      await finish({
        status: 'error',
        summary: `Non riuscito: ${message.slice(0, 120)}`,
        result: `Errore: ${message}`,
        handles: context.newHandles
      })
    }
  }

  private async requestApproval(
    activityId: string,
    callId: string,
    request: Omit<ApprovalPayload, 'approvalId' | 'status' | 'callId'>,
    activity: RunningActivity
  ): Promise<{ approved: boolean; outcome?: SendOutcome }> {
    const store = this.requireStore()
    const payload: ApprovalPayload = {
      ...request,
      approvalId: randomUUID(),
      status: 'pending',
      callId
    }
    const event = await store.appendEvent(activityId, 'approval', payload)
    this.emitEntry(activityId, event)
    await store.updateActivity(activityId, { status: 'waiting', unseen: true })
    await this.emitSummary(activityId)

    try {
      const answer = await new Promise<{ approved: boolean; outcome?: SendOutcome }>(
        (resolve, reject) => {
          activity.approvals.set(payload.approvalId, {
            eventId: event.id,
            payload,
            resolve,
            reject
          })
          activity.controller.signal.addEventListener(
            'abort',
            () => reject(new SegretarioError('cancelled', 'Interrotto.')),
            { once: true }
          )
        }
      )

      payload.status = answer.approved ? 'approved' : 'rejected'
      return answer
    } catch (error) {
      payload.status = 'rejected'
      throw error
    } finally {
      activity.approvals.delete(payload.approvalId)
      await store.updateEvent(event.id, payload)
      this.emitEntry(activityId, { ...event, payload })
      await store.updateActivity(activityId, { status: 'running' })
      await this.emitSummary(activityId)
    }
  }

  private requestCompose(spec: ComposeSpec, signal: AbortSignal): Promise<string> {
    const requestId = randomUUID()

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.composeRequests.delete(requestId)
        reject(new ToolInputError('La finestra non ha aperto la bozza: riprova.'))
      }, COMPOSE_TIMEOUT_MS)
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          clearTimeout(timer)
          fn(value)
        }

      this.composeRequests.set(requestId, { resolve: settle(resolve), reject: settle(reject) })
      signal.addEventListener(
        'abort',
        () => {
          this.composeRequests.delete(requestId)
          clearTimeout(timer)
          reject(new SegretarioError('cancelled', 'Interrotto.'))
        },
        { once: true }
      )
      this.options.send(SEGRETARIO_IPC.composeRequest, { requestId, spec })
    })
  }

  /**
   * Keeps what the model reads within reach: past a size, old tool results
   * are cleared in one stroke; past a larger one, the older part of the
   * conversation is summarised (`compattazione.md`) and the summary takes
   * its place. The log keeps everything.
   */
  private async manageContext(
    id: string,
    key: string,
    promptTokens: number,
    signal: AbortSignal
  ): Promise<void> {
    const store = this.requireStore()

    if (promptTokens >= COMPACT_AT) {
      const events = await store.listEvents(id)
      const result = await this.client.chat(
        key,
        {
          messages: [
            ...buildConversation(PROMPTS.system, events),
            { role: 'user', content: PROMPTS.compaction }
          ],
          tools: toolDefinitions(this.tools),
          toolChoice: 'none',
          reasoningEffort: 'low',
          maxTokens: 8_000,
          sessionId: id
        },
        { signal }
      )

      await this.recordUsage(id, 'compattazione', result)
      const event = await store.appendEvent<CompactionPayload>(id, 'compaction', {
        summary: result.content.trim(),
        coveredUntil: events[events.length - 1]?.id ?? 0
      })
      this.emitEntry(id, event)
      return
    }

    if (promptTokens >= CLEAR_TOOL_RESULTS_AT) {
      const events = await store.listEvents(id)
      const cleared = events
        .filter((event) => event.type === 'clearing')
        .reduce(
          (boundary, event) => Math.max(boundary, (event.payload as ClearingPayload).before),
          0
        )
      const tools = events.filter((event) => event.type === 'tool' && event.id >= cleared)

      if (tools.length > RECENT_TOOL_RESULTS_KEPT) {
        await store.appendEvent<ClearingPayload>(id, 'clearing', {
          before: tools[tools.length - RECENT_TOOL_RESULTS_KEPT].id
        })
      }
    }
  }
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'Nuovo lavoro'
}

/** The names an event gave, as the page links them. */
function handleLinks(records: ReadonlyArray<HandleRecord> | undefined): HandleLink[] {
  return (records ?? []).map(({ handle, target }): HandleLink => {
    switch (target.kind) {
      case 'message':
        return { handle, kind: 'message', ref: target.ref }
      case 'draft':
        return { handle, kind: 'draft', draftId: target.draftId }
      case 'file':
        return target.file.kind === 'path'
          ? { handle, kind: 'file', fileName: target.file.fileName, path: target.file.path }
          : {
              handle,
              kind: 'file',
              fileName: target.file.fileName,
              ref: target.file.ref,
              attachmentId: target.file.attachmentId
            }
    }
  })
}

/** What the page shows of a stored event; null for those it does not show. */
/** A message as triage reads it: who, when, what — its own words, without the quoted history. */
function triageMessage(
  message: {
    date: string
    from: MailAddress[]
    to: MailAddress[]
    cc: MailAddress[]
    subject: string
    textForReading: string
  },
  target: boolean
): TriageMessage {
  return {
    date: message.date,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    text: withoutQuotedHistory(message.textForReading).text,
    target
  }
}

/** Text set as a Markdown quote. */
function quoteBlock(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function entryOf(event: StoredEvent): ActivityEntry | null {
  switch (event.type) {
    case 'user': {
      const payload = event.payload as UserPayload
      return {
        kind: 'user',
        id: event.id,
        text: payload.text,
        context: payload.context,
        ...(payload.origin ? { origin: payload.origin } : {}),
        at: event.createdAt,
        handles: handleLinks(payload.handles)
      }
    }
    case 'assistant': {
      const payload = event.payload as AssistantPayload
      return payload.content.trim()
        ? { kind: 'assistant', id: event.id, text: payload.content, at: event.createdAt }
        : null
    }
    case 'tool': {
      const payload = event.payload as ToolPayload
      return {
        kind: 'tool',
        id: event.id,
        at: event.createdAt,
        handles: handleLinks(payload.handles),
        tool: {
          callId: payload.callId,
          name: payload.name,
          status: payload.status,
          summary: payload.summary,
          messages: payload.messages,
          files: payload.files
        }
      }
    }
    case 'approval': {
      const { approvalId, kind, title, status, draft } = event.payload as ApprovalPayload
      return {
        kind: 'approval',
        id: event.id,
        approval: { approvalId, kind, title, status, draft },
        at: event.createdAt
      }
    }
    case 'compaction':
      return { kind: 'compaction', id: event.id, at: event.createdAt }
    case 'error':
      return {
        kind: 'error',
        id: event.id,
        message: (event.payload as ErrorPayload).message,
        at: event.createdAt
      }
    default:
      return null
  }
}
