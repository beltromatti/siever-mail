import { randomUUID } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'

import extensionMain from '@app/extension/main'
import type { MessageRef } from '@shared/models'
import {
  SEGRETARIO_IPC,
  TASK_LABELS,
  type ActivityDetail,
  type ActivityEntry,
  type ActivityEvent,
  type ActivitySummary,
  type AskedMail,
  type Commitment,
  type CommitmentKind,
  type CommitmentStatus,
  type ComposeResult,
  type ComposeSpec,
  calendarLearningKey,
  type ConnectionLearning,
  type ConnectionReadiness,
  type DayLine,
  type FilingContext,
  type EngineState,
  type MemoryNote,
  type MemoryVersion,
  type MessageNote,
  type MessageRowWork,
  type MessageWork,
  type OnboardingState,
  type Project,
  type ProjectDetail,
  type ProjectLabel,
  type Proposal,
  type ReadingStatus,
  type ReviewRequest,
  type SavedSearch,
  type SegretarioContext,
  type SegretarioPreferences,
  type SegretarioSpending,
  type SegretarioStatus,
  type SendOutcome,
  type TodayPage,
  type WorkChange,
  type WritingRequest,
  REVIEW_TIMEOUT_MS
} from '@shared/segretario'

import { logMainError } from '../utils/error-utils'
import type { ContextPayload, ChangesPayload, UserPayload } from './agent/conversation'
import { handleRecords } from './agent/conversation'
import { entryOf, firstLine } from './agent/entries'
import { HandleRegistry, type HandleRecord } from './agent/handles'
import { AgentRunner } from './agent/runner'
import {
  ToolInputError,
  type SegretarioCalendarPort,
  type SegretarioMailPort,
  type SegretarioPagePort
} from './agent/tool-types'
import { AiStore } from './ai-store'
import { periodWords, searchPeriod, type AskedSearch } from './ask-mail'
import { READING_HORIZON_DAYS, SegretarioEngine } from './engine/engine'
import { WorkQueue } from './engine/work-queue'
import { folderQueryLabel, searchMail, searchScope } from './mail-search'
import { MAX_NOTE_CHARS, normalizeMemoryPath, Notebook } from './memory/notebook'
import { OpenRouterClient, SegretarioError, type ChatUsage, type FetchFunction } from './openrouter'
import { PROMPTS } from './prompts'
import { Registry, type RegistryView } from './registry/registry'
import {
  OWED_KINDS,
  RegistryRefusal,
  USER,
  type CommitmentRecord,
  type NoteRecord,
  type ProjectSummary
} from './registry/types'
import { prismaSql } from './sql'
import { contextBlock, nowLine } from './tasks/context'
import { prepareSearch, prepareReview, prepareWriting } from './tasks/interactive'
import { prepareConoscimi } from './tasks/memory-work'
import { startRun, type RunStarter } from './tasks/start-run'
import { SEGRETARIO_TOOLS } from './tools'
import { eventLine } from './tools/calendar'
import { localDay } from './tools/day'
import { comparableText, formatDateTime, shortDate } from './tools/format'

const KEY_RECHECK_MS = 20 * 60 * 1000
/** New mail wakes the engine at most this often. */
const MAIL_WAKE_MS = 2_000
/** How long a draft the Segretario wrote is remembered, to learn from what the user sends. */
const DRAFT_RECORD_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How long the diary keeps the work done alone. */
const DIARY_KEPT_MS = 21 * 24 * 60 * 60 * 1000
const COMPOSE_TIMEOUT_MS = 30_000
/** How long the writing in the editor and the search asked in words may take at most. */
const INLINE_TIMEOUT_MS = 90_000
const ASK_MAIL_LIMIT = 200
const ASKED_SEARCHES_KEPT = 20
const WEEK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const EMPTY_STATUS: SegretarioStatus = {
  keyState: 'missing',
  keyLabel: null,
  credit: null,
  checkedAt: null,
  problem: null,
  modelName: null
}

/** What spending is shown under, beside the tasks. */
const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  ...TASK_LABELS,
  compattazione: 'Riassunti dei lavori lunghi',
  titolo: 'Titoli dei lavori',
  attivita: 'Richieste (prima versione)',
  smistamento: 'Lettura della posta (prima versione)',
  'risposta-pronta': 'Risposte pronte (prima versione)',
  sollecito: 'Solleciti (prima versione)',
  oggi: 'La giornata (prima versione)',
  argomento: 'Argomenti (prima versione)',
  scrittura: TASK_LABELS.scrittura
}

const PRIORITY_ORDER = { alta: 0, media: 1, bassa: 2 } as const
/** In `ai_meta`: the guided setup under way. */
const ONBOARDING = 'onboarding'

export interface SegretarioServiceOptions {
  database: { storeClient(): Promise<PrismaClient> }
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  fetch: FetchFunction
  /** Sends an event to the window. */
  send(channel: string, payload: unknown): void
  /** Whether new mail is read as it comes — the AI on, with a working key. */
  onReadingChange(reading: boolean): void
  /** A message's note, written as it was read: an alert waiting for it is let go. */
  onNoteWritten(note: MessageNote): void
}

function noteOf(record: NoteRecord): MessageNote {
  return {
    accountId: record.accountId,
    messageKey: record.messageKey,
    threadId: record.threadId,
    direction: record.direction,
    summary: record.summary,
    nature: record.nature,
    priority: record.priority,
    reason: record.reason,
    due: record.due,
    messageDate: record.messageDate,
    twinAccountId: record.twinAccountId,
    writtenBy: record.writtenBy
  }
}

function commitmentOf(record: CommitmentRecord): Commitment {
  return {
    id: record.id,
    accountId: record.accountId,
    threadId: record.threadId,
    messageKey: record.messageKey,
    kind: record.kind,
    text: record.text,
    due: record.due,
    status: record.status,
    until: record.until,
    setBy: record.setBy,
    reason: record.reason,
    evidenceKey: record.evidenceKey,
    question: record.question,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

function projectOf(summary: ProjectSummary): Project {
  return {
    id: summary.id,
    title: summary.title,
    description: summary.description,
    state: summary.state,
    stateAt: summary.stateAt,
    stale: summary.staleSince !== null,
    origin: summary.origin,
    hidden: summary.hiddenAt !== null,
    closed: summary.closedAt !== null,
    conversations: summary.conversations,
    openCommitments: summary.openCommitments,
    lastMessageAt: summary.lastMessageAt
  }
}

/** A refusal of the registry is the user's to read: a plain error. */
function plainly<T>(work: Promise<T>): Promise<T> {
  return work.catch((error: unknown) => {
    throw error instanceof RegistryRefusal ? new Error(error.message) : error
  })
}

/**
 * The Segretario, as the rest of the app speaks to it: the key and the one
 * switch, the user's work as the interface shows and changes it, the
 * conversations of the panel, the help in the editor and in the search,
 * the memory, getting to know the connections. Underneath, one agent — the
 * runner — woken by the engine for the work it does alone and by the user
 * for the rest, over one registry and one notebook.
 */
export class SegretarioService {
  private store: AiStore | null = null
  private registry: Registry | null = null
  private notebook: Notebook | null = null
  private runner: AgentRunner | null = null
  private engine: SegretarioEngine | null = null
  private readonly client: OpenRouterClient
  private status: SegretarioStatus = EMPTY_STATUS
  private recheckTimer: ReturnType<typeof setInterval> | null = null
  private readonly opened = (() => {
    const opened = Promise.withResolvers<void>()
    // Waited for by every request: one that fails says so to each, not to nobody.
    opened.promise.catch(() => undefined)
    return opened
  })()
  private readonly composeRequests = new Map<
    string,
    { resolve: (draftId: string) => void; reject: (error: Error) => void }
  >()
  /** Searches asked this session, the latest few: their lists, to open and to keep. */
  private readonly searches = new Map<
    string,
    { asked: AskedMail; search: AskedSearch; refs: MessageRef[] }
  >()
  private reading: boolean | null = null
  private engineStateTimer: NodeJS.Timeout | null = null
  private mailWakeTimer: NodeJS.Timeout | null = null
  /** Proposals being answered now. */
  private readonly deciding = new Set<string>()
  /** The computer is asleep: the engine, made or yet to be made, waits for it to wake. */
  private asleep = false

  constructor(private readonly options: SegretarioServiceOptions) {
    this.client = new OpenRouterClient(options.fetch)
  }

  whenReady(): Promise<void> {
    return this.opened.promise
  }

  /** Opens the Segretario; requests wait for it, and fail with it rather than wait for ever. */
  async open(): Promise<void> {
    try {
      await this.openAll()
      this.opened.resolve()
    } catch (error) {
      this.abandon(error)
      throw error
    }
  }

  /** The app could not start: what waits for the Segretario is told so, rather than left waiting. */
  abandon(error: unknown): void {
    this.opened.reject(error instanceof Error ? error : new Error(String(error)))
  }

  private async openAll(): Promise<void> {
    // The database is open, and the tables shaped (see `ensureAiSchema`).
    const sql = prismaSql(await this.options.database.storeClient())
    const store = new AiStore(sql)
    const notebook = new Notebook(sql)
    const registry = new Registry(sql, {
      changed: (change, actor) => {
        this.runner?.recordChange(change, actor)
        this.workChanged({
          accountIds: change.accountId ? [change.accountId] : [],
          threadIds: change.threadIds,
          messageKeys: change.messageKeys,
          projectIds: change.projectIds
        })

        if (change.object === 'nota' && change.accountId && change.messageKeys[0]) {
          void this.noteWritten(change.accountId, change.messageKeys[0])
        }
      },
      lesson: (kind, payload) => {
        void store
          .addLesson(kind, payload)
          .catch((error: unknown) => logMainError('A lesson could not be kept', error))
      }
    })
    const page: SegretarioPagePort = {
      compose: (spec, signal) => this.requestCompose(spec, signal),
      show: (request) => this.options.send(SEGRETARIO_IPC.showRequest, request),
      showSearch: async (search, question) => {
        const entry = await this.keepSearch(search, question)
        this.options.send(SEGRETARIO_IPC.showRequest, { kind: 'search', search: entry })
        return entry.count
      }
    }
    const runner = new AgentRunner({
      client: this.client,
      store,
      registry,
      notebook,
      tools: SEGRETARIO_TOOLS,
      mail: this.options.mail,
      calendar: this.options.calendar,
      page,
      requireKey: () => this.requireKey(),
      emit: (event) => this.emit(event),
      recordUsage: (activityId, purpose, result) => this.recordUsage(activityId, purpose, result)
    })

    this.store = store
    this.notebook = notebook
    this.registry = registry
    this.runner = runner
    this.engine = new SegretarioEngine({
      store,
      registry,
      notebook,
      runner,
      mail: this.options.mail,
      calendar: this.options.calendar,
      queue: new WorkQueue(sql),
      emit: (event) => this.emit(event),
      ready: () => this.ready(),
      onboarding: () => this.getOnboarding(),
      onStateChange: () => this.engineChanged(),
      onPause: (reason) => {
        if (reason) {
          void this.checkKey()
        }

        this.engineChanged()
      }
    })
    this.engine.setAsleep(this.asleep)
    this.status = (await store.getStoredStatus()) ?? EMPTY_STATUS

    // A conversation a quit cut short cannot go on by itself: it says so, and
    // waits for the user. Work done alone starts over from the queue.
    for (const activity of await store.listUnfinished()) {
      if (activity.visibility === 'pannello') {
        const event = await store.appendEvent(activity.id, 'error', {
          code: 'interrupted',
          message:
            'Interrotto: SIEVER Mail è stato chiuso mentre lavoravo. Scrivimi per riprendere.'
        })
        void event
        await store.updateActivity(activity.id, { status: 'failed', unseen: true })

        if (activity.task === 'conoscimi') {
          await store.endLearning(activity.id, false)
        }
      } else {
        await store.updateActivity(activity.id, { status: 'cancelled' })
      }
    }

    await store.pruneDrafts(Date.now() - DRAFT_RECORD_TTL_MS)
    await store.pruneActivities(DIARY_KEPT_MS)

    if (this.status.keyState !== 'missing') {
      void this.checkKey()
    }

    this.recheckTimer = setInterval(() => {
      if (this.status.keyState !== 'missing') {
        void this.checkKey()
      }
    }, KEY_RECHECK_MS)
    // An engine that does not start leaves the work done alone stopped, not the Segretario.
    await this.engine
      .start()
      .catch((error: unknown) => logMainError('The Segretario’s engine did not start', error))
    await this.sayWhetherReading()
  }

  async stop(): Promise<void> {
    if (this.recheckTimer) {
      clearInterval(this.recheckTimer)
      this.recheckTimer = null
    }

    if (this.mailWakeTimer) {
      clearTimeout(this.mailWakeTimer)
      this.mailWakeTimer = null
    }

    // The engine first: what it runs is put back to wait for the next start; cancelled by the
    // runner before, it would count as the user's cancelling — failed, or the day taken as done.
    await this.engine?.stop()
    this.runner?.cancelAll()
  }

  /** The computer goes to sleep, or wakes: the work done alone waits for it to be awake. */
  setSystemAsleep(asleep: boolean): void {
    this.asleep = asleep
    this.engine?.setAsleep(asleep)
  }

  /**
   * New mail is indexed, or mail went away: the engine looks now rather than at its next round —
   * at most every few seconds, so an index filling up does not keep it planning.
   */
  mailChanged(): void {
    if (this.mailWakeTimer) {
      return
    }

    this.mailWakeTimer = setTimeout(() => {
      this.mailWakeTimer = null
      this.engine?.wake()
    }, MAIL_WAKE_MS)
  }

  private require<T>(value: T | null): T {
    if (value === null) {
      throw new Error('Il Segretario non è ancora pronto.')
    }

    return value
  }

  private get db(): {
    store: AiStore
    registry: Registry
    notebook: Notebook
    runner: AgentRunner
    engine: SegretarioEngine
  } {
    return {
      store: this.require(this.store),
      registry: this.require(this.registry),
      notebook: this.require(this.notebook),
      runner: this.require(this.runner),
      engine: this.require(this.engine)
    }
  }

  private starter(): RunStarter {
    const { store, runner, notebook } = this.db
    return {
      store,
      runner,
      sources: { mail: this.options.mail, calendar: this.options.calendar, notebook },
      emit: (event) => this.emit(event)
    }
  }

  /* ─────────────────────────────── key and switch ─────────────────────────────── */

  getStatus(): SegretarioStatus {
    return this.status
  }

  /** Whether the Segretario works: the AI on, a key that answers (or could not be checked). */
  private async ready(): Promise<boolean> {
    return (
      (this.status.keyState === 'ready' || this.status.keyState === 'unchecked') &&
      (await this.db.store.getPreferences()).enabled
    )
  }

  private async sayWhetherReading(): Promise<void> {
    const reading =
      this.status.keyState === 'ready' && (await this.db.store.getPreferences()).enabled

    if (reading !== this.reading) {
      this.reading = reading
      this.options.onReadingChange(reading)
    }
  }

  private async setStatus(status: SegretarioStatus): Promise<SegretarioStatus> {
    // A key found working lifts a pause — the credit topped up leaves the key as it was, ready.
    const lifts =
      status.keyState === 'ready' &&
      (this.status.keyState !== 'ready' || (this.engine?.paused ?? null) !== null)
    this.status = status
    await this.db.store.setStoredStatus(status)
    this.options.send(SEGRETARIO_IPC.statusChanged, status)
    await this.sayWhetherReading()

    if (lifts) {
      this.engine?.resume()
      this.engine?.wake()
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

    await this.db.store.setApiKey(key, status)
    return this.setStatus(status)
  }

  async removeKey(): Promise<SegretarioStatus> {
    this.runner?.cancelAll()
    this.engine?.cancelRunning()
    await this.db.store.setApiKey(null, EMPTY_STATUS)
    return this.setStatus(EMPTY_STATUS)
  }

  /** Asks OpenRouter again about the key and its credit. */
  async checkKey(): Promise<SegretarioStatus> {
    const key = await this.db.store.getApiKey()

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
    const key = await this.db.store.getApiKey()

    if (!key) {
      throw new SegretarioError(
        'no-key',
        'Per lavorare mi serve una chiave OpenRouter: inseriscila in Impostazioni › Segretario.'
      )
    }

    return key
  }

  getPreferences(): Promise<SegretarioPreferences> {
    return this.db.store.getPreferences()
  }

  /**
   * The one switch. Off: every run stops, nothing is read or prepared, and
   * what was learnt is kept. On: the engine catches up with what came meanwhile.
   */
  async setPreferences(preferences: SegretarioPreferences): Promise<SegretarioPreferences> {
    const stored = await this.db.store.setPreferences(preferences)
    this.options.send(SEGRETARIO_IPC.preferencesChanged, stored)

    if (!stored.enabled) {
      this.runner?.cancelAll()
      await this.engine?.switchedOff()
    }

    await this.sayWhetherReading()
    this.engine?.wake()
    this.engineChanged()
    return stored
  }

  /** What the Segretario has cost today, this month, and in the last thirty days by function. */
  async getSpending(): Promise<SegretarioSpending> {
    const now = new Date()
    const { store } = this.db
    const [today, thisMonth, byPurpose] = await Promise.all([
      store.spentSince(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()),
      store.spentSince(new Date(now.getFullYear(), now.getMonth(), 1).getTime()),
      store.spentByPurpose(Date.now() - 30 * DAY_MS)
    ])
    const byLabel = new Map<string, number>()

    for (const entry of byPurpose) {
      const label = PURPOSE_LABELS[entry.purpose] ?? entry.purpose
      byLabel.set(label, (byLabel.get(label) ?? 0) + entry.cost)
    }

    return {
      today,
      thisMonth,
      byFunction: [...byLabel.entries()]
        .map(([label, cost]) => ({ purpose: label, label, cost }))
        .sort((a, b) => b.cost - a.cost)
    }
  }

  private async recordUsage(
    activityId: string | null,
    purpose: string,
    result: { usage: ChatUsage; model: string | null; provider: string | null }
  ): Promise<void> {
    await this.db.store.recordUsage({
      activityId,
      purpose,
      model: result.model,
      provider: result.provider,
      usage: result.usage
    })
  }

  async getEngineState(): Promise<EngineState> {
    return this.db.engine.state()
  }

  async retryFailedWork(): Promise<EngineState> {
    await this.db.engine.queue.retryFailed()
    this.db.engine.wake()
    return this.getEngineState()
  }

  /** The first reading is prepared with the user waiting: more runs at once. */
  setPreparing(preparing: boolean): void {
    this.engine?.setPreparing(preparing)
  }

  /* ──────────────────────────────── the guided setup ──────────────────────────────── */

  async getOnboarding(): Promise<OnboardingState | null> {
    const stored = await this.db.store.meta(ONBOARDING)
    return stored ? (JSON.parse(stored) as OnboardingState) : null
  }

  async setOnboarding(state: OnboardingState | null): Promise<void> {
    if (state) {
      await this.db.store.setMeta(ONBOARDING, JSON.stringify(state))
    } else {
      const finished = await this.getOnboarding()
      await this.db.store.deleteMeta(ONBOARDING)
      // The setup is over: the reading goes back to its usual pace.
      this.setPreparing(false)

      // "Pronto" promised the day in Oggi: with the AI on, it is written now, even before dawn.
      if (finished && (await this.ready())) {
        await this.engine?.writeDayNow()
      }
    }

    // A step on may let work through that waited for it.
    this.engine?.wake()
  }

  /** Whether each connection's recent mail is in and read by the index: what Conoscimi and the reading start from. */
  async connectionReadiness(accountIds: ReadonlyArray<string>): Promise<ConnectionReadiness[]> {
    return Promise.all(
      accountIds.map(async (accountId) => ({
        accountId,
        recentMailIndexed: await this.options.mail.recentMailIndexed(
          accountId,
          READING_HORIZON_DAYS
        )
      }))
    )
  }

  getReadingStatus(): Promise<ReadingStatus> {
    return this.db.engine.readingStatus()
  }

  /** Tells the window the engine's state, at most a few times a second. */
  private engineChanged(): void {
    if (this.engineStateTimer) {
      return
    }

    this.engineStateTimer = setTimeout(() => {
      this.engineStateTimer = null
      void this.getEngineState()
        .then((state) => this.options.send(SEGRETARIO_IPC.engineChanged, state))
        .catch(() => undefined)
    }, 400)
  }

  private workChanged(change: WorkChange): void {
    this.options.send(SEGRETARIO_IPC.workChanged, change)
  }

  private async noteWritten(accountId: string, messageKey: string): Promise<void> {
    const note = await this.registry?.notes.get(accountId, messageKey)

    if (note) {
      this.options.onNoteWritten(noteOf(note))
    }
  }

  /* ───────────────────────────────── the memory ───────────────────────────────── */

  async listMemory(): Promise<MemoryNote[]> {
    return (await this.db.notebook.list()).map((note) => ({
      path: note.path,
      content: note.content,
      updatedAt: note.updatedAt,
      revision: note.revision,
      updatedBy: note.updatedBy === 'utente' ? 'utente' : 'segretario'
    }))
  }

  /** A note as the user corrected it: a version like any other, and a lesson. */
  async writeMemory(path: string, content: string): Promise<MemoryNote[]> {
    if (content.length > MAX_NOTE_CHARS) {
      throw new Error('La nota è troppo lunga: dividila in più note.')
    }

    const normalized = normalizeMemoryPath(path)
    const before = await this.db.notebook.read(normalized)
    await plainly(this.db.notebook.write(normalized, content, USER))

    if (before) {
      await this.db.store.addLesson('memoria_corretta', {
        nota: normalized,
        prima: before.content,
        dopo: content
      })
    }

    return this.listMemory()
  }

  async deleteMemory(path: string): Promise<MemoryNote[]> {
    await this.db.notebook.delete(normalizeMemoryPath(path), USER)
    return this.listMemory()
  }

  async memoryHistory(path: string): Promise<MemoryVersion[]> {
    return (await this.db.notebook.history(normalizeMemoryPath(path))).map((version) => ({
      revision: version.revision,
      content: version.content,
      action: version.action,
      actor: version.actor,
      at: version.at
    }))
  }

  async restoreMemory(path: string, revision: number): Promise<MemoryNote[]> {
    await plainly(this.db.notebook.restore(normalizeMemoryPath(path), revision, USER))
    return this.listMemory()
  }

  /** Forgets what it learnt, and that it knows the connections: Conoscimi is to be done again. */
  async forgetEverything(): Promise<void> {
    await this.db.notebook.clear()
    await this.db.store.resetLearning()
  }

  /* ──────────────────────── getting to know the connections ──────────────────────── */

  /**
   * Which connections the Segretario knows from Conoscimi: each mailbox,
   * each calendar — a calendar that came with a mailbox known with it.
   */
  async listLearning(): Promise<ConnectionLearning[]> {
    const [accounts, calendars, learnt] = await Promise.all([
      this.options.mail.listAccounts(),
      this.options.calendar.connections(),
      this.db.store.listLearning()
    ])
    const rows = new Map(learnt.map((row) => [row.accountId, row]))
    const entry = (
      key: string,
      kind: ConnectionLearning['kind'],
      label: string,
      row: (typeof learnt)[number] | undefined
    ): ConnectionLearning => ({
      key,
      kind,
      label,
      state: !row
        ? 'waiting'
        : row.finishedAt !== null
          ? 'done'
          : row.activityId && this.runner?.isRunning(row.activityId)
            ? 'running'
            : 'waiting',
      activityId: row?.activityId ?? null,
      finishedAt: row?.finishedAt ?? null
    })

    return [
      ...accounts.map((account) => entry(account.id, 'posta', account.email, rows.get(account.id))),
      ...calendars.map((connection) => {
        const key = calendarLearningKey(connection.id)
        return entry(
          key,
          'calendario',
          connection.label,
          rows.get(key) ??
            (connection.mailAccountId ? rows.get(connection.mailAccountId) : undefined)
        )
      })
    ]
  }

  /**
   * Conoscimi: the Segretario gets to know these connections — all of them
   * when none are named — building on what it already knows. The user
   * watches it in the panel; it may not act on anything outside.
   */
  async startConoscimi(keys?: string[]): Promise<ActivitySummary> {
    await this.requireKey()
    const [accounts, calendars] = await Promise.all([
      this.options.mail.listAccounts(),
      this.options.calendar.connections()
    ])
    const all = [
      ...accounts.map((account) => account.id),
      ...calendars.map((connection) => calendarLearningKey(connection.id))
    ]
    const chosen = keys && keys.length > 0 ? all.filter((key) => keys.includes(key)) : all

    if (chosen.length === 0) {
      throw new Error('Non ci sono connessioni da conoscere.')
    }

    const { store } = this.db
    const data = await prepareConoscimi({ mail: this.options.mail, store, calendars }, chosen)
    const created = Promise.withResolvers<string>()

    void startRun(this.starter(), {
      task: 'conoscimi',
      background: true,
      visibility: 'pannello',
      data,
      shown: 'Fatti conoscere',
      onCreated: async (activityId) => {
        await store.startLearning(chosen, activityId)
        created.resolve(activityId)
      }
    })
      .then((result) => store.endLearning(result.activityId, result.status === 'done'))
      .catch((error: unknown) => {
        logMainError('Conoscimi failed', error)
        created.reject(error instanceof Error ? error : new Error(String(error)))
      })

    const activity = await store.getActivity(await created.promise)
    return activity!
  }

  /**
   * A draft went out. When the Segretario had written it, what the user
   * changed — or that they changed nothing — is kept for the next reflection.
   */
  async draftSent(draftId: string, writtenText: string): Promise<void> {
    const { store } = this.db
    const draft = await store.takeDraft(draftId)

    if (!draft) {
      return
    }

    await store.addLesson(
      comparableText(draft.text) === comparableText(writtenText) ? 'confermata' : 'correzione',
      {
        accountId: draft.accountId,
        written: draft.text,
        sent: writtenText
      }
    )
  }

  /**
   * A connection was removed: what was kept about it alone goes, and the
   * next reflection hears of it — the memory is the Segretario's to correct,
   * wherever it wrote of that mailbox.
   */
  async forgetAccount(accountId: string, email: string): Promise<void> {
    const { store } = this.db

    for (const row of await store.listLearning()) {
      if (row.accountId === accountId && row.activityId) {
        this.runner?.cancel(row.activityId)
      }
    }

    await store.forgetAccount(accountId)
    await store.addLesson('account-rimosso', { email })
    this.workChanged({ accountIds: [accountId], threadIds: [], messageKeys: [], projectIds: [] })
  }

  /** Everything but the key and the settings, for "Elimina tutti i dati". */
  async clearData(): Promise<void> {
    this.runner?.cancelAll()
    this.engine?.cancelRunning()
    await this.db.store.clearData()
    this.searches.clear()
  }

  /**
   * "Dimentica tutto": what the Segretario knows and did goes — memory,
   * notes, open things, projects, replies, diary, spending — the key and
   * the copies archived stay. The AI turns off: on again, it starts from
   * the guided setup, knowing nothing.
   */
  async forgetAll(): Promise<void> {
    this.runner?.cancelAll()
    this.engine?.cancelRunning()
    await this.db.store.clearData({ keepSavedCopies: true })
    this.searches.clear()
    await this.setPreferences({ enabled: false })
  }

  /* ──────────────────────────────── the user's work ──────────────────────────────── */

  /** What the rows of these messages show: the note, what is owed or awaited from each, the reply. */
  async getRowWork(
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<MessageRowWork[]> {
    const { registry } = this.db
    const notes = new Map(
      (await registry.notes.many(messages)).map((note) => [
        `${note.accountId}\u0000${note.messageKey}`,
        note
      ])
    )
    const rows: MessageRowWork[] = []

    for (const accountId of new Set(messages.map((message) => message.accountId))) {
      const keys = messages
        .filter((message) => message.accountId === accountId)
        .map((message) => message.messageKey)
      const work = await registry.rowWork(accountId, keys)

      for (const messageKey of keys) {
        const note = notes.get(`${accountId}\u0000${messageKey}`)
        const open = work.get(messageKey)

        if (note || open) {
          rows.push({
            accountId,
            messageKey,
            note: note ? noteOf(note) : null,
            owed: open?.owed ?? null,
            awaited: open?.awaited ?? false,
            reply: open?.reply ?? null,
            saved: open?.saved ? (extensionMain.assistant?.savedCopyLabel ?? 'Salvato') : null
          })
        }
      }
    }

    return rows
  }

  /** What the reader shows of a message: its note, its conversation's commitments and projects, the reply, copies, proposals. */
  async getMessageWork(accountId: string, messageKey: string): Promise<MessageWork> {
    const { registry } = this.db
    const note = await registry.notes.get(accountId, messageKey)
    const location = (await this.options.mail.locate(accountId, [messageKey])).get(messageKey)
    const threadId = note?.threadId ?? location?.threadId ?? null
    const thread = threadId ? { accountId, threadId } : null
    // The reply and the proposals are the conversation's: whichever of its messages is open shows them.
    const [commitments, links, replies, copies, proposals] = await Promise.all([
      thread ? registry.commitments.ofThreads([thread]) : Promise.resolve([]),
      thread ? registry.projects.linksOf([thread]) : Promise.resolve([]),
      thread ? registry.replies.liveOfThreads([thread]) : Promise.resolve([]),
      registry.copies.ofMessages(accountId, [messageKey]),
      registry.proposals.open(
        thread ? { threads: [thread] } : { messages: [{ accountId, messageKey }] }
      )
    ])
    const reply = [...replies].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    const projects = (
      await Promise.all(
        links.filter((link) => !link.rejected).map((link) => registry.projects.get(link.projectId))
      )
    ).filter((project) => project !== null)
    const label = extensionMain.assistant?.savedCopyLabel ?? 'Salvato'

    return {
      note: note ? noteOf(note) : null,
      commitments: commitments.map(commitmentOf),
      projects: projects.map((project) => ({ id: project!.id, title: project!.title })),
      reply:
        reply && (reply.status === 'pronta' || reply.status === 'da_rivedere')
          ? {
              accountId,
              messageKey: reply.messageKey,
              kind: reply.kind,
              text: reply.text,
              doubts: reply.doubts,
              status: reply.status,
              staleReason: reply.staleReason
            }
          : null,
      copies: copies.map((copy) => ({
        label,
        destination: copy.destination,
        savedAt: copy.savedAt
      })),
      proposals: proposals.map((proposal) => this.proposalOf(proposal))
    }
  }

  private proposalOf(proposal: {
    id: string
    kind: string
    title: string
    payload: Record<string, unknown>
    accountId: string | null
    messageKey: string | null
    revision: number
    createdAt: number
  }): Proposal {
    return {
      id: proposal.id,
      kind: proposal.kind,
      title: proposal.title,
      payload: proposal.payload,
      accountId: proposal.accountId,
      messageKey: proposal.messageKey,
      revision: proposal.revision,
      createdAt: proposal.createdAt
    }
  }

  async setCommitmentStatus(
    id: number,
    status: CommitmentStatus,
    options: { until?: string; reason?: string } = {}
  ): Promise<Commitment> {
    const { record } = await plainly(
      this.db.registry.setCommitmentStatus(id, status, USER, {
        until: options.until ?? null,
        reason: options.reason ?? null
      })
    )
    return commitmentOf(record)
  }

  async editCommitment(
    id: number,
    changes: { text?: string; due?: string | null; kind?: CommitmentKind }
  ): Promise<Commitment> {
    const { record } = await plainly(this.db.registry.editCommitment(id, changes, USER))
    return commitmentOf(record)
  }

  async openCommitment(
    message: { accountId: string; messageKey: string },
    input: { kind: CommitmentKind; text: string; due: string | null }
  ): Promise<Commitment> {
    const location = (await this.options.mail.locate(message.accountId, [message.messageKey])).get(
      message.messageKey
    )

    if (!location) {
      throw new Error('Il messaggio non è più nella posta.')
    }

    const { record } = await plainly(
      this.db.registry.openCommitment({ ...message, threadId: location.threadId }, input, USER)
    )
    return commitmentOf(record)
  }

  /**
   * "Segna come gestito": what the conversations of these messages ask of
   * the user is done — a decision of theirs, kept. What they wait for
   * stays open. Resolves with how many conversations changed.
   */
  async markHandled(
    messages: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<number> {
    const { registry } = this.db
    const threads = new Map<string, { accountId: string; threadId: string }>()

    for (const accountId of new Set(messages.map((message) => message.accountId))) {
      const keys = messages
        .filter((message) => message.accountId === accountId)
        .map((message) => message.messageKey)

      for (const location of (await this.options.mail.locate(accountId, keys)).values()) {
        threads.set(`${accountId}\u0000${location.threadId}`, {
          accountId,
          threadId: location.threadId
        })
      }
    }

    let changed = 0

    for (const thread of threads.values()) {
      const owed = await registry.commitments.open({ threads: [thread], kinds: OWED_KINDS })

      for (const record of owed) {
        await registry.setCommitmentStatus(record.id, 'fatta', USER, {
          reason: 'Segnata come gestita.'
        })
      }

      if (owed.length > 0) {
        changed += 1
      }
    }

    return changed
  }

  /** Undoes a change a run made, from its page of the diary. */
  async undoChange(activityId: string, eventId: number, index: number): Promise<void> {
    const { store, registry } = this.db
    const event = await store.getEvent(eventId)

    if (!event || event.activityId !== activityId || event.type !== 'changes') {
      throw new Error('Questa modifica non c’è più.')
    }

    const payload = event.payload as ChangesPayload
    const change = payload.changes[index]
    const undo = change?.undo

    if (!undo) {
      throw new Error('Questa modifica non si può annullare da qui.')
    }

    if (change.undoneAt !== undefined) {
      throw new Error('Questa modifica è già stata annullata.')
    }

    switch (undo.kind) {
      case 'impegno':
        await plainly(registry.undoCommitment(undo.historyId, USER))
        break
      case 'progetto-collegamento':
        await plainly(
          undo.linked
            ? registry.unlinkThread(
                undo.projectId,
                { accountId: undo.accountId, threadId: undo.threadId },
                USER
              )
            : registry.linkThread(
                undo.projectId,
                { accountId: undo.accountId, threadId: undo.threadId },
                USER
              )
        )
        break
      case 'risposta':
        await registry.setReplyStatus(undo.accountId, undo.messageKey, 'scartata', USER)
        break
      case 'progetto-creato':
        await plainly(registry.removeProject(undo.projectId, USER))
        break
      case 'progetto-rinominato':
        await plainly(registry.renameProject(undo.projectId, undo.title, USER))
        break
      case 'progetto-nascosto':
        await plainly(registry.setProjectHidden(undo.projectId, !undo.hidden, USER))
        break
      case 'evento-creato':
        await this.options.calendar.remove(undo.eventKey)
        break
      case 'evento-modificato':
        await this.options.calendar.update(undo.eventKey, undo.before)
        break
      case 'evento-eliminato':
        await this.options.calendar.create(undo.event)
        break
    }

    const updated: ChangesPayload = {
      changes: payload.changes.map((candidate, at) =>
        at === index ? { ...candidate, undoneAt: Date.now() } : candidate
      )
    }
    await store.updateEvent(eventId, updated)
    const entry = entryOf({ ...event, payload: updated })

    if (entry) {
      this.emit({ type: 'entry', activityId, entry })
    }
  }

  async replySource(accountId: string, messageKey: string): Promise<MessageRef | null> {
    return (await this.options.mail.locate(accountId, [messageKey])).get(messageKey)?.ref ?? null
  }

  /** The user took a prepared reply up: it became their draft, learnt from like the others. */
  async takeUpReply(accountId: string, messageKey: string, draftId: string): Promise<void> {
    const { registry, store } = this.db
    const reply = await registry.replies.get(accountId, messageKey)
    await registry.setReplyStatus(accountId, messageKey, 'usata', USER)

    if (reply) {
      await store.recordDraft({ draftId, activityId: reply.runId, accountId, text: reply.text })
    }
  }

  async discardReply(accountId: string, messageKey: string): Promise<void> {
    await this.db.registry.setReplyStatus(accountId, messageKey, 'scartata', USER)
  }

  /** How to prepare for an event, as written for it (by the day's work, or asked in the chat). */
  async eventPrep(eventKey: string): Promise<{ text: string; writtenAt: number } | null> {
    return this.db.registry.day.prep(eventKey)
  }

  async listProposals(): Promise<Proposal[]> {
    return (await this.db.registry.proposals.open()).map((proposal) => this.proposalOf(proposal))
  }

  /**
   * The user's word on a proposal. An event: accepted, it is put in the
   * calendar as proposed — the user's own act, invitations included.
   * An extension's: the extension did what it proposes; this records how.
   */
  /**
   * The user's answer to a proposal — to the version they saw (`revision`):
   * one a run wrote again since is refused, to be looked at again. One
   * answer at a time for each: a second click does not create twice.
   */
  async decideProposal(
    id: string,
    accepted: boolean,
    result?: Record<string, unknown>,
    revision?: number
  ): Promise<void> {
    if (this.deciding.has(id)) {
      throw new Error('Questa proposta si sta già decidendo.')
    }

    this.deciding.add(id)

    try {
      await this.decideProposalNow(id, accepted, result, revision)
    } finally {
      this.deciding.delete(id)
    }
  }

  private async decideProposalNow(
    id: string,
    accepted: boolean,
    result: Record<string, unknown> | undefined,
    revision: number | undefined
  ): Promise<void> {
    const { registry } = this.db
    const proposal = await registry.proposals.get(id)

    if (!proposal || proposal.status !== 'aperta') {
      throw new Error('Questa proposta non è più in attesa.')
    }

    if (revision !== undefined && revision !== proposal.revision) {
      throw new Error('La proposta è cambiata da quando l’hai vista: guardala di nuovo.')
    }

    if (accepted && proposal.kind === 'evento') {
      const payload = proposal.payload as {
        title: string
        start: string
        end: string
        allDay: boolean
        location: string | null
        description: string | null
        attendees: string[]
        calendar: string | null
        eventKey: string | null
      }
      const calendars = (await this.options.calendar.calendars()).filter(
        (calendar) => calendar.writable
      )
      const calendar =
        calendars.find(
          (candidate) =>
            payload.calendar &&
            `${candidate.name} ${candidate.connection}`
              .toLowerCase()
              .includes(payload.calendar.toLowerCase())
        ) ??
        calendars.find((candidate) => candidate.primary) ??
        calendars[0]

      if (payload.eventKey) {
        const updated = await this.options.calendar.update(payload.eventKey, {
          title: payload.title,
          start: payload.start,
          end: payload.end,
          allDay: payload.allDay,
          location: payload.location,
          description: payload.description,
          attendees: payload.attendees
        })
        await registry.decideProposal(id, 'accettata', { eventKey: updated.key, ...result })
        return
      }

      if (!calendar) {
        throw new Error(
          'Nessun calendario collegato in cui metterlo: collegalo in Impostazioni › Connessioni.'
        )
      }

      const created = await this.options.calendar.create({
        calendarKey: calendar.key,
        title: payload.title,
        start: payload.start,
        end: payload.end,
        allDay: payload.allDay,
        location: payload.location,
        description: payload.description,
        attendees: payload.attendees,
        origin: { by: 'segretario', accountId: proposal.accountId, messageKey: proposal.messageKey }
      })
      await registry.decideProposal(id, 'accettata', { eventKey: created.key, ...result })
      return
    }

    await registry.decideProposal(id, accepted ? 'accettata' : 'scartata', result ?? null)
  }

  /* ─────────────────────────────── copies saved outside ─────────────────────────────── */

  /** Copies an extension saved outside the mail: facts on each message, and where the user files. */
  async copiesSaved(
    entries: ReadonlyArray<{
      ref: MessageRef
      messageKey: string
      threadId: string
      fromAddress: string | null
      destination: string
      files: string[]
    }>
  ): Promise<void> {
    await this.db.registry.saveCopies(
      entries.map((entry) => ({
        accountId: entry.ref.accountId,
        messageKey: entry.messageKey,
        threadId: entry.threadId,
        source: extensionMain.id,
        destination: entry.destination,
        files: entry.files,
        fromAddress: entry.fromAddress
      })),
      USER
    )
  }

  /**
   * Where messages about to be saved outside the mail are likely to go —
   * as earlier ones of their conversations, or else of their senders — and
   * what the Segretario proposes for them.
   */
  async filingContext(
    messages: ReadonlyArray<{
      accountId: string
      messageKey: string
      threadId: string
      from: string | null
    }>
  ): Promise<FilingContext> {
    const { registry } = this.db
    const threads = [
      ...new Map(
        messages.map((message) => [`${message.accountId}\u0000${message.threadId}`, message])
      ).values()
    ].map(({ accountId, threadId }) => ({ accountId, threadId }))
    const latest = (
      copies: ReadonlyArray<{ destination: string; savedAt: number }>
    ): string | null => [...copies].sort((a, b) => b.savedAt - a.savedAt)[0]?.destination ?? null
    const senders = [
      ...new Set(
        messages.flatMap((message) => (message.from ? [message.from.trim().toLowerCase()] : []))
      )
    ]

    const projectIds = [
      ...new Set(
        (await registry.projects.linksOf(threads))
          .filter((link) => !link.rejected)
          .map((link) => link.projectId)
      )
    ]
    const resources = await Promise.all(projectIds.map((id) => registry.projects.resources(id)))

    return {
      savedBefore:
        latest(await registry.copies.ofThreads(threads)) ??
        (senders.length > 0 ? latest(await registry.copies.fromSenders(senders, '')) : null),
      projectFolders: [
        ...new Set(
          resources
            .flat()
            .filter((resource) => resource.kind === 'cartella')
            .map((resource) => resource.location)
        )
      ],
      proposals: (
        await registry.proposals.open({
          messages: messages.map(({ accountId, messageKey }) => ({ accountId, messageKey }))
        })
      ).map((proposal) => this.proposalOf(proposal))
    }
  }

  /** The copies of a message saved outside the mail. */
  async copiesOf(
    accountId: string,
    messageKey: string
  ): Promise<Array<{ destination: string; files: string[] }>> {
    return (await this.db.registry.copies.ofMessages(accountId, [messageKey])).map((copy) => ({
      destination: copy.destination,
      files: copy.files
    }))
  }

  /** Which of these messages of an account were saved outside the mail, with what label. */
  async savedCopies(
    accountId: string,
    messageKeys: ReadonlyArray<string>
  ): Promise<Map<string, string>> {
    const label = extensionMain.assistant?.savedCopyLabel ?? 'Salvato'
    return new Map(
      (await this.db.registry.copies.ofMessages(accountId, messageKeys)).map((copy) => [
        copy.messageKey,
        label
      ])
    )
  }

  /* ───────────────────────────────── views ───────────────────────────────── */

  /** The messages a view holds, by key, across all accounts. */
  viewKeys(view: RegistryView): Promise<Array<{ accountId: string; messageKey: string }>> {
    return this.db.registry.viewKeys(view)
  }

  /** The messages with something open or a reply waiting: the "Attivi" filter. */
  activeKeys(
    accountIds?: ReadonlyArray<string>
  ): Promise<Array<{ accountId: string; messageKey: string }>> {
    return this.db.registry.allActiveKeys(accountIds)
  }

  /** The conversations of a project. */
  projectThreads(projectId: string): Promise<Array<{ accountId: string; threadId: string }>> {
    return this.db.registry.projects.threadsOf(projectId)
  }

  /* ──────────────────────────────── the day ──────────────────────────────── */

  /**
   * Lines of the day, from what is open and prepared: each with its
   * message — in the folder the user thinks of it in, never one only in
   * the Trash or Spam (what is open from those is set aside).
   */
  private async dayLines(
    records: ReadonlyArray<CommitmentRecord>,
    replies: ReadonlyArray<{
      accountId: string
      messageKey: string
      kind: 'risposta' | 'sollecito'
    }> = []
  ): Promise<{ commitments: Map<number, DayLine>; replies: DayLine[] }> {
    const { registry } = this.db
    const own = new Set(
      (await this.options.mail.listAccounts()).map((account) => account.email.toLowerCase())
    )
    const wanted = [
      ...records.map((record) => ({ accountId: record.accountId, messageKey: record.messageKey })),
      ...replies
    ]
    const summaries = new Map<
      string,
      { ref: MessageRef; subject: string; from: string; dateIso: string }
    >()

    for (const accountId of new Set(wanted.map((item) => item.accountId))) {
      const found = await this.options.mail.messageSummaries(
        accountId,
        wanted.filter((item) => item.accountId === accountId).map((item) => item.messageKey)
      )

      for (const [key, summary] of found) {
        const sender = summary.from[0]
        summaries.set(`${accountId}\u0000${key}`, {
          ref: summary.ref,
          subject: summary.subject,
          from:
            sender && own.has(sender.address.toLowerCase())
              ? 'Tu'
              : sender?.name || sender?.address || '',
          dateIso: summary.dateIso
        })
      }
    }

    const notes = new Map(
      (await registry.notes.many(wanted)).map((note) => [
        `${note.accountId}\u0000${note.messageKey}`,
        note
      ])
    )
    const lines = new Map<number, DayLine>()

    for (const record of records) {
      const summary = summaries.get(`${record.accountId}\u0000${record.messageKey}`)

      if (summary) {
        lines.set(record.id, {
          text: record.text,
          priority: notes.get(`${record.accountId}\u0000${record.messageKey}`)?.priority ?? null,
          due: record.due,
          commitment: commitmentOf(record),
          ref: summary.ref,
          messageKey: record.messageKey,
          subject: summary.subject,
          from: summary.from,
          date: summary.dateIso
        })
      }
    }

    const replyLines: DayLine[] = []

    for (const reply of replies) {
      const summary = summaries.get(`${reply.accountId}\u0000${reply.messageKey}`)
      const note = notes.get(`${reply.accountId}\u0000${reply.messageKey}`)

      if (summary) {
        replyLines.push({
          text: note?.summary ?? summary.subject,
          priority: note?.priority ?? null,
          due: note?.due ?? null,
          commitment: null,
          readyKind: reply.kind,
          ref: summary.ref,
          messageKey: reply.messageKey,
          subject: summary.subject,
          from: summary.from,
          date: summary.dateIso
        })
      }
    }

    return { commitments: lines, replies: replyLines }
  }

  async getToday(): Promise<TodayPage> {
    const { registry, engine } = this.db
    const now = new Date()
    const today = localDay(now)
    const weekEnd = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + WEEK_DAYS))
    const [open, replies, proposals, letter, state] = await Promise.all([
      registry.commitments.open(),
      registry.replies.withStatus(['pronta']),
      registry.proposals.open(),
      registry.day.letter(today),
      engine.state()
    ])
    const { commitments, replies: ready } = await this.dayLines(open, replies)
    const byPriority = (a: DayLine, b: DayLine): number =>
      (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
      PRIORITY_ORDER[a.priority ?? 'media'] - PRIORITY_ORDER[b.priority ?? 'media']
    const owed = open.filter((record) => OWED_KINDS.includes(record.kind))
    const lineOf = (record: CommitmentRecord): DayLine[] => {
      const line = commitments.get(record.id)
      return line ? [line] : []
    }
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const events = await this.options.calendar
      .events(startOfDay.toISOString(), new Date(startOfDay.getTime() + DAY_MS).toISOString())
      .catch(() => [])

    return {
      day: today,
      letter: letter?.text ?? null,
      letterAt: letter?.writtenAt ?? null,
      reading: Math.max(0, state.reading.total - state.reading.read),
      today: owed
        .filter((record) => record.due !== null && record.due <= today)
        .flatMap(lineOf)
        .sort(byPriority),
      week: owed
        .filter((record) => record.due !== null && record.due > today && record.due <= weekEnd)
        .flatMap(lineOf)
        .sort(byPriority),
      waiting: owed
        .filter((record) => record.due === null || record.due > weekEnd)
        .flatMap(lineOf)
        .sort(byPriority),
      awaited: open
        .filter((record) => record.kind === 'aspetti')
        .sort((a, b) => a.createdAt - b.createdAt)
        .flatMap(lineOf),
      ready,
      questions: open.filter((record) => record.question !== null).flatMap(lineOf),
      proposals: proposals.map((proposal) => this.proposalOf(proposal)),
      preps: Object.fromEntries(await registry.day.preps(events.map((event) => event.key)))
    }
  }

  async refreshToday(): Promise<void> {
    await this.db.engine.refreshDay()
  }

  /** What is due from today through a day: the calendar's deadlines. */
  async getDue(throughDay: string): Promise<DayLine[]> {
    const open = await this.db.registry.commitments.open({ dueBy: throughDay })
    const { commitments } = await this.dayLines(open)
    return open.flatMap((record) => {
      const line = commitments.get(record.id)
      return line ? [line] : []
    })
  }

  /* ───────────────────────────────── projects ───────────────────────────────── */

  async listProjects(options: { includeHidden?: boolean } = {}): Promise<Project[]> {
    return (
      await this.db.registry.projects.list({
        includeHidden: options.includeHidden,
        includeClosed: options.includeHidden
      })
    ).map(projectOf)
  }

  async getProject(id: string): Promise<ProjectDetail | null> {
    const { registry } = this.db
    const summary = await registry.projects.summary(id)

    if (!summary) {
      return null
    }

    const threads = await registry.projects.threadsOf(id)
    const [items, notes, resources] = await Promise.all([
      registry.commitments.ofThreads(threads),
      registry.notes.ofThreads(threads),
      registry.projects.resources(id)
    ])
    const latest = new Map<string, NoteRecord>()

    for (const note of notes) {
      const key = `${note.accountId}\u0000${note.threadId}`
      const known = latest.get(key)

      if (!known || note.messageDate > known.messageDate) {
        latest.set(key, note)
      }
    }

    const own = new Set(
      (await this.options.mail.listAccounts()).map((account) => account.email.toLowerCase())
    )
    const messages: DayLine[] = []

    for (const note of [...latest.values()].sort((a, b) =>
      b.messageDate.localeCompare(a.messageDate)
    )) {
      const summary = (
        await this.options.mail.messageSummaries(note.accountId, [note.messageKey])
      ).get(note.messageKey)

      if (summary) {
        const sender = summary.from[0]
        messages.push({
          text: note.summary,
          priority: note.priority,
          due: note.due,
          commitment: null,
          ref: summary.ref,
          messageKey: note.messageKey,
          subject: summary.subject,
          from:
            sender && own.has(sender.address.toLowerCase())
              ? 'Tu'
              : sender?.name || sender?.address || '',
          date: summary.dateIso
        })
      }
    }

    return {
      ...projectOf(summary),
      resources: resources.map((resource) => ({
        kind: resource.kind,
        location: resource.location,
        label: resource.label
      })),
      commitments: items.map(commitmentOf),
      messages
    }
  }

  async refreshProject(id: string): Promise<void> {
    await this.db.engine.refreshProject(id)
  }

  async createProject(title: string): Promise<Project> {
    const { record } = await plainly(this.db.registry.createProject(title, USER))
    return projectOf((await this.db.registry.projects.summary(record.id))!)
  }

  async updateProject(
    id: string,
    change: { title?: string; hidden?: boolean; closed?: boolean }
  ): Promise<Project | null> {
    const { registry } = this.db

    if (change.title !== undefined) {
      await plainly(registry.renameProject(id, change.title, USER))
    }

    if (change.hidden !== undefined) {
      await registry.setProjectHidden(id, change.hidden, USER)
    }

    if (change.closed !== undefined) {
      await registry.setProjectClosed(id, change.closed, USER)
    }

    const summary = await registry.projects.summary(id)
    return summary ? projectOf(summary) : null
  }

  async mergeProjects(keepId: string, otherIds: string[]): Promise<Project | null> {
    await plainly(this.db.registry.mergeProjects(keepId, otherIds, USER))
    const summary = await this.db.registry.projects.summary(keepId)
    return summary ? projectOf(summary) : null
  }

  async setConversationProject(
    thread: { accountId: string; threadId: string },
    projectId: string,
    linked: boolean
  ): Promise<void> {
    await plainly(
      linked
        ? this.db.registry.linkThread(projectId, thread, USER)
        : this.db.registry.unlinkThread(projectId, thread, USER)
    )
  }

  async conversationProjects(
    threads: ReadonlyArray<{ accountId: string; threadId: string }>
  ): Promise<ProjectLabel[][]> {
    const { registry } = this.db
    const links = await registry.projects.linksOf(threads)
    const titles = new Map<string, string>()

    for (const id of new Set(links.map((link) => link.projectId))) {
      const project = await registry.projects.get(id)

      if (project && project.hiddenAt === null) {
        titles.set(id, project.title)
      }
    }

    return threads.map((thread) =>
      links
        .filter(
          (link) =>
            !link.rejected &&
            link.accountId === thread.accountId &&
            link.threadId === thread.threadId &&
            titles.has(link.projectId)
        )
        .map((link) => ({ id: link.projectId, title: titles.get(link.projectId)! }))
    )
  }

  /** The folder linked to a project, to open it. */
  async projectFolder(id: string): Promise<string> {
    const folder = (await this.db.registry.projects.resources(id)).find(
      (resource) => resource.kind === 'cartella'
    )

    if (!folder) {
      throw new Error('Questo progetto non ha una cartella collegata.')
    }

    return folder.location
  }

  /* ───────────────────────── writing, rereading, searching ───────────────────────── */

  /**
   * The message being written, written or rewritten as the user asks — by
   * the Segretario, which may look things up while the user waits. What
   * comes back is kept as its draft, so what the user changes is learnt from.
   */
  async assistWriting(request: WritingRequest): Promise<{ text: string }> {
    await this.requireKey()
    const data = await prepareWriting({ mail: this.options.mail }, request)
    const result = await startRun(this.starter(), {
      task: 'scrittura',
      background: false,
      visibility: 'nascosta',
      data,
      shown: request.instruction,
      editor: { draftId: request.draftId, selection: request.selectedText },
      signal: AbortSignal.timeout(INLINE_TIMEOUT_MS),
      missing: async (run) =>
        run.results.editorText
          ? null
          : 'Scrivi il testo nel messaggio con `scrivi_bozza` (il solo `testo`).'
    })
    const text = result.run.results.editorText

    if (!text) {
      throw new Error(result.error?.message ?? 'Non sono riuscito a scrivere il testo.')
    }

    if (!request.selectedText) {
      await this.db.store.recordDraft({
        draftId: request.draftId,
        activityId: result.activityId,
        accountId: request.accountId,
        text
      })
    }

    return { text }
  }

  /** Rereads a message about to be sent: what the user would want to correct first, a line each. */
  async reviewDraft(request: ReviewRequest): Promise<string[]> {
    await this.requireKey()
    const data = await prepareReview({ mail: this.options.mail }, request)
    const result = await startRun(this.starter(), {
      task: 'revisione',
      background: false,
      visibility: 'nascosta',
      data,
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
      missing: async (run) => (run.results.review ? null : 'Dai l’esito con `revisione`.')
    })
    return result.run.results.review ?? []
  }

  /**
   * A search asked in words: the Segretario finds the search that shows
   * what the user means, and its list is kept for the page to open.
   */
  async askMail(question: string): Promise<AskedMail> {
    await this.requireKey()
    const data = await prepareSearch({ mail: this.options.mail }, question)
    const result = await startRun(this.starter(), {
      task: 'ricerca',
      background: false,
      visibility: 'nascosta',
      data,
      shown: question,
      signal: AbortSignal.timeout(INLINE_TIMEOUT_MS),
      missing: async (run) =>
        run.results.search ? null : 'Mostra la ricerca con `mostra` (`ricerca`).'
    })
    const search = result.run.results.search

    if (!search) {
      throw new Error(result.error?.message ?? 'Non sono riuscito a capire cosa cercare.')
    }

    return this.keepSearch(search, question)
  }

  /** A search run over every account's mail as it is now, kept for this session. */
  private async keepSearch(search: AskedSearch, question: string): Promise<AskedMail> {
    const refs = await this.runSearch(search)
    const entry: AskedMail = {
      id: randomUUID(),
      question,
      summary: search.summary || question,
      how: [
        search.text ? `«${search.text}»` : null,
        search.folder ? `in ${folderQueryLabel(search.folder)}` : null,
        search.account ? `di ${search.account}` : null,
        search.period
          ? periodWords(search.period)
          : search.from && search.to
            ? `dal ${shortDate(search.from)} al ${shortDate(search.to)}`
            : search.from
              ? `dal ${shortDate(search.from)}`
              : search.to
                ? `fino al ${shortDate(search.to)}`
                : null,
        search.unreadOnly ? 'non letti' : null,
        search.withAttachments ? 'con allegati' : null
      ]
        .filter(Boolean)
        .join(' · '),
      count: refs.length
    }

    this.searches.set(entry.id, { asked: entry, search, refs })

    for (const id of [...this.searches.keys()].slice(0, -ASKED_SEARCHES_KEPT)) {
      this.searches.delete(id)
    }

    return entry
  }

  private async runSearch(search: AskedSearch): Promise<MessageRef[]> {
    const mail = this.options.mail
    const accounts = await mail.listAccounts()
    const folders = new Map(
      await Promise.all(
        accounts.map(async (account) => [account.id, await mail.listFolders(account.id)] as const)
      )
    )
    const scope = searchScope(accounts, folders, {
      accounts: search.account ? [search.account] : [],
      folder: search.folder ?? undefined
    })
    // A period from today is counted from today, each time it runs.
    const { from, to } = searchPeriod(search, new Date())
    const hits = await searchMail(await mail.searchClient(), scope, {
      text: search.text || undefined,
      from: from ?? undefined,
      to: to ?? undefined,
      unreadOnly: search.unreadOnly,
      withAttachments: search.withAttachments,
      limit: ASK_MAIL_LIMIT
    })
    return hits.map((hit) => hit.ref)
  }

  /** What a search's list holds: one kept as a folder, run again now; one asked this session, what it found. */
  async searchRefs(id: string): Promise<MessageRef[] | undefined> {
    const saved = (await this.db.store.listSavedSearches()).find((entry) => entry.id === id)

    if (saved) {
      return this.runSearch(JSON.parse(saved.search) as AskedSearch)
    }

    return this.searches.get(id)?.refs
  }

  async listSavedSearches(): Promise<SavedSearch[]> {
    return (await this.db.store.listSavedSearches()).map(({ id, question, summary, how }) => ({
      id,
      question,
      summary,
      how
    }))
  }

  async saveSearch(id: string): Promise<SavedSearch[]> {
    const asked = this.searches.get(id)

    if (!asked) {
      throw new Error('Questa ricerca non c’è più: chiedila di nuovo per tenerla.')
    }

    await this.db.store.saveSearch({
      id,
      question: asked.asked.question,
      summary: asked.asked.summary,
      how: asked.asked.how,
      search: JSON.stringify(asked.search)
    })
    return this.listSavedSearches()
  }

  async removeSavedSearch(id: string): Promise<SavedSearch[]> {
    await this.db.store.removeSavedSearch(id)
    return this.listSavedSearches()
  }

  /* ───────────────────────────────── the panel ───────────────────────────────── */

  async listActivities(options: { diary?: boolean } = {}): Promise<ActivitySummary[]> {
    const all = await this.db.store.listActivities()
    return all.filter(
      (activity) =>
        activity.visibility === 'pannello' || (options.diary && activity.visibility === 'diario')
    )
  }

  async getActivity(id: string): Promise<ActivityDetail | null> {
    const { store } = this.db
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
    const { store, notebook } = this.db
    await this.requireKey()
    const id = randomUUID()
    const summary = await store.createActivity({
      id,
      task: 'richiesta',
      title: firstLine(text),
      status: 'running',
      visibility: 'pannello'
    })

    this.emit({ type: 'summary', activity: summary })
    const block = await contextBlock({
      mail: this.options.mail,
      calendar: this.options.calendar,
      notebook
    })
    await store.appendEvent<ContextPayload>(id, 'context', {
      text: `${PROMPTS.tasks.richiesta}\n\n---\n\n${block}`
    })
    const request = await this.appendUserMessage(id, text, context)
    void this.nameActivity(id, request)
    void this.converse(id)
    return summary
  }

  async sendMessage(id: string, text: string, context: SegretarioContext): Promise<void> {
    const { store, runner } = this.db

    if (runner.isRunning(id)) {
      throw new Error('Sto ancora lavorando su questo: aspetta che finisca o fermami.')
    }

    const activity = await store.getActivity(id)

    if (!activity) {
      throw new Error('Questo lavoro non esiste più.')
    }

    await this.requireKey()
    await this.appendUserMessage(id, text, context)
    void this.converse(id, activity.task === 'richiesta' ? 'richiesta' : activity.task)
  }

  /** One turn of a conversation in the panel: the user is there, so it may ask and act. */
  private async converse(id: string, task: ActivitySummary['task'] = 'richiesta'): Promise<void> {
    try {
      await this.db.runner.run({
        activityId: id,
        task,
        background: task === 'conoscimi',
        conversation: true
      })
    } catch (error) {
      logMainError('A conversation with the Segretario failed', error, { activityId: id })
    }
  }

  async cancelActivity(id: string): Promise<void> {
    this.runner?.cancel(id)
  }

  async removeActivity(id: string): Promise<void> {
    this.runner?.cancel(id)
    this.runner?.forgetSeen(id)
    await this.db.store.deleteActivity(id)
    this.emit({ type: 'removed', activityId: id })
  }

  async markActivitySeen(id: string): Promise<void> {
    const summary = await this.db.store.updateActivity(id, { unseen: false })

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
    await this.db.runner.resolveApproval(activityId, approvalId, approved, outcome)
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

  private emit(event: ActivityEvent): void {
    this.options.send(SEGRETARIO_IPC.activityEvent, event)
  }

  /** The user's words, with the moment and what they are looking at, as the model reads them. */
  private async appendUserMessage(
    id: string,
    text: string,
    context: SegretarioContext
  ): Promise<string> {
    const { store } = this.db
    const handles = new HandleRegistry(handleRecords(await store.listEvents(id)))
    const added: HandleRecord[] = []
    const lines = [nowLine()]

    if (context.messages.length > 0) {
      const described = await this.describeMessages(context.messages, handles, added)
      lines.push(
        context.messages.length === 1
          ? `L'utente sta guardando: ${described[0] ?? 'un messaggio'}`
          : `L'utente ha selezionato ${context.messages.length} messaggi:\n${described.map((line) => `- ${line}`).join('\n')}`
      )
    } else if (context.eventKey) {
      const event = await this.options.calendar.event(context.eventKey)
      lines.push(
        event
          ? `L'utente ${context.folderLabel ? `è in ${context.folderLabel} e ` : ''}sta guardando l'evento:\n${eventLine(event, { handles, newHandles: added })}`
          : `L'utente è in: ${context.folderLabel ?? 'Calendario'}.`
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
    const entry = entryOf(event)

    if (entry) {
      this.emit({ type: 'entry', activityId: id, entry })
    }

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

  /** A short title for a conversation, from the request as the model reads it. */
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
        const summary = await this.db.store.updateActivity(id, { title })

        if (summary) {
          this.emit({ type: 'summary', activity: summary })
        }
      }
    } catch (error) {
      logMainError('Naming an activity failed', error)
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
}
