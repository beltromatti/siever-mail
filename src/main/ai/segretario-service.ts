import { randomUUID } from 'node:crypto'

import type { PrismaClient } from '@prisma/client'

import extensionMain from '@app/extension/main'
import type { CalendarResponse, EventChange } from '@shared/calendar'
import type { MessageRef } from '@shared/models'
import {
  noticeWords,
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
  type EventWork,
  type MemoryNote,
  type MemoryVersion,
  type MessageNote,
  type MessageRowWork,
  type MessageWork,
  type OnboardingState,
  type Project,
  type ProjectDetail,
  type ProjectLabel,
  type SegretarioNotice,
  type LinkedText,
  type Proposal,
  type ReadingStatus,
  type ReviewRequest,
  type SavedSearch,
  type SegretarioContext,
  type SegretarioPreferences,
  type SegretarioSpending,
  type SegretarioStatus,
  type SendOutcome,
  type TaskKind,
  type TodayPage,
  type WorkChange,
  type WritingRequest,
  READING_DAYS,
  setupTurnsAiOn
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
import { canonicalPath } from '../services/network-volumes'
import { calendarLookScope, SegretarioEngine } from './engine/engine'
import { Reachability } from './engine/reachability'
import { WorkQueue } from './engine/work-queue'
import { folderQueryLabel, searchMail, searchScope } from './mail-search'
import { normalizeMemoryPath, Notebook } from './memory/notebook'
import {
  creditSpent,
  creditWarning,
  OpenRouterClient,
  SegretarioError,
  type CreditRefusal,
  type CreditWarned,
  type FetchFunction,
  type GenerationBill
} from './openrouter'
import { PROMPTS } from './prompts'
import { Registry, type RegistryView } from './registry/registry'
import {
  OWED_KINDS,
  RegistryRefusal,
  USER,
  type CommitmentOrigin,
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

/**
 * The credit spent, in words: OpenRouter refuses a request before the
 * credit reads zero, so what is left may be said and not be enough.
 */
function spentCredit(available: number | null): string {
  return available !== null && available > 0
    ? `Il credito OpenRouter che resta (${available.toLocaleString('it-IT', { style: 'currency', currency: 'USD' })}) non basta più per lavorare: ricaricalo su openrouter.ai per riaccendere le funzioni AI.`
    : 'Il credito OpenRouter è finito: ricaricalo su openrouter.ai per riaccendere le funzioni AI.'
}
/** The week whose spending tells how long the credit lasts. */
const CREDIT_PACE_DAYS = 7
/** Spent since the last check, the credit is asked for again: this part of what was left, at least the floor. */
const CREDIT_RECHECK_SHARE = 0.1
const CREDIT_RECHECK_FLOOR = 0.05
/** New mail wakes the engine at most this often. */
const MAIL_WAKE_MS = 2_000
/** How long a draft the Segretario wrote is remembered, to learn from what the user sends. */
const DRAFT_RECORD_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** How long the diary keeps the work done alone. */
const DIARY_KEPT_MS = 21 * 24 * 60 * 60 * 1000
const COMPOSE_TIMEOUT_MS = 30_000
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
  /**
   * The AI on or off as the page has it — the switch up and a key given:
   * what is offered outside the page (the menu) follows.
   */
  onEnabledChange(on: boolean): void
  /** A message's note, written as it was read: an alert waiting for it is let go. */
  onNoteWritten(note: MessageNote): void
  /** Says something to the user in the system's alerts, when the window is not in front. */
  notify(title: string, body: string): void
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
  const { origin } = record
  return {
    id: record.id,
    source:
      origin.kind === 'messaggio'
        ? {
            kind: 'message',
            accountId: origin.accountId,
            threadId: origin.threadId,
            messageKey: origin.messageKey
          }
        : origin.kind === 'evento'
          ? { kind: 'event', eventKey: origin.eventKey }
          : origin.projectId
            ? { kind: 'user', projectId: origin.projectId }
            : { kind: 'user' },
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
    stateLinks: summary.stateLinks,
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

/** The work that writes the memory: stopped before the memory is emptied. */
const MEMORY_TASKS: ReadonlyArray<TaskKind> = ['al_passo', 'riflessione', 'conoscimi']

/** A letter looked at in Oggi is written again when it is behind by more than this. */
const LETTER_LOOKED_AT_STALE_MS = 60 * 60 * 1000

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
  /**
   * The credit OpenRouter said was left when it refused a request for want
   * of credit — null when it did not say. A refusal comes before the credit
   * reads zero (a request needs more than the cents left), so until more is
   * left than then, or the user says they put it right, it is not enough.
   */
  private creditRefusal: CreditRefusal | null = null
  /** Spent since the credit was last asked for, in dollars. */
  private spentSinceCheck = 0
  /** A check of the key the work asked for, under way: whoever asks meanwhile shares it. */
  private checking: Promise<SegretarioStatus> | null = null
  /** The AI going off for the key or the credit, under way. */
  private turningOff: Promise<void> | null = null
  /** A refusal being followed: those that come meanwhile — the runs at once — are the same. */
  private refusing: Promise<void> | null = null
  /** The checks of the key, numbered: one overtaken by a later one does not set the status. */
  private statusSeq = 0
  /** How many tokens the model reads at once, as OpenRouter says: null until asked. */
  private modelContext: number | null = null
  /** The requests the user waits for, by name: theirs to stop (`stopAsking`). */
  private readonly asking = new Map<string, AbortController>()
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
  /** The AI on as the page shows it: the switch up and a key given. */
  private on: boolean | null = null
  private engineStateTimer: NodeJS.Timeout | null = null
  private mailWakeTimer: NodeJS.Timeout | null = null
  /** Proposals being answered now. */
  private readonly deciding = new Set<string>()
  /** The computer is asleep: the engine, made or yet to be made, waits for it to wake. */
  private asleep = false

  constructor(private readonly options: SegretarioServiceOptions) {
    this.client = new OpenRouterClient(options.fetch, (error) => this.refused(error))
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
    // OpenRouter back, or a wait over: the interface says it, and the queue goes on at once.
    const reachability = new Reachability(() => {
      this.engineChanged()
      this.engine?.wake()
    })
    const runner = new AgentRunner({
      client: this.client,
      reachability,
      contextLength: () => this.contextLength(),
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
      reachability,
      emit: (event) => this.emit(event),
      ready: () => this.ready(),
      onboarding: () => this.getOnboarding(),
      onStateChange: () => this.engineChanged()
    })
    this.engine.setAsleep(this.asleep)
    this.status = (await store.getStoredStatus()) ?? EMPTY_STATUS

    // Without credit when last open: still so, until more is left.
    if (this.status.keyState === 'exhausted') {
      this.creditRefusal = { available: this.status.credit?.available ?? null }
    }

    // A conversation a quit cut short cannot go on by itself: it says so, and
    // waits for the user. Work done alone starts over from the queue.
    for (const activity of await store.listUnfinished()) {
      if (activity.visibility === 'pannello') {
        await store.appendEvent(activity.id, 'error', {
          code: 'interrupted',
          message:
            'Interrotto: SIEVER Mail è stato chiuso mentre lavoravo. Scrivimi per riprendere.'
        })
        await store.updateActivity(activity.id, { status: 'failed', unseen: true })

        if (activity.task === 'conoscimi') {
          await store.endLearning(activity.id, false)
        }
      } else {
        await store.updateActivity(activity.id, { status: 'cancelled' })

        // The lessons a reflection cut short had taken go back to the next one.
        if (activity.task === 'riflessione') {
          await store.endReflection(activity.id, false)
        }
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
    const { enabled } = await this.db.store.getPreferences()
    const reading = this.status.keyState === 'ready' && enabled

    if (reading !== this.reading) {
      this.reading = reading
      this.options.onReadingChange(reading)
    }

    const on = enabled && this.status.keyState !== 'missing'

    if (on !== this.on) {
      this.on = on
      this.options.onEnabledChange(on)

      // On again: what a refused key or credit held back is gone with the switch.
      if (on) {
        this.engine?.reset()
        this.engine?.wake()
      }
    }
  }

  private async setStatus(status: SegretarioStatus): Promise<SegretarioStatus> {
    this.status = status
    await this.db.store.setStoredStatus(status)
    this.options.send(SEGRETARIO_IPC.statusChanged, status)
    await this.sayWhetherReading()
    this.engineChanged()
    await this.followCredit(status)
    return status
  }

  /**
   * What the key and its credit, as just checked, mean for the AI. Refused
   * or spent, the AI goes off — there is no AI that waits — and the user is
   * told why; running low, the user is told in time to top it up, once on
   * the way down at each warning (`creditWarning`), again after a top-up.
   */
  private async followCredit(status: SegretarioStatus): Promise<void> {
    const { enabled } = await this.db.store.getPreferences()

    if (!enabled) {
      return
    }

    if (status.keyState === 'exhausted' || status.keyState === 'invalid') {
      await this.turnOff(status.keyState === 'exhausted' ? 'credito-finito' : 'chiave-rifiutata')
      return
    }

    if (status.keyState !== 'ready' || !status.credit) {
      return
    }

    const { store } = this.db
    const available = status.credit.available
    const daily =
      (await store.spentSince(Date.now() - CREDIT_PACE_DAYS * DAY_MS)) / CREDIT_PACE_DAYS
    const kept = await store.meta('credit_warned')
    const before = kept ? (JSON.parse(kept) as CreditWarned) : null
    const { raise, days, warned } = creditWarning(available, daily, before)

    if (warned === null) {
      await store.deleteMeta('credit_warned')
    } else if (JSON.stringify(warned) !== kept) {
      await store.setMeta('credit_warned', JSON.stringify(warned))
    }

    // A warning never takes the place of the notice that the AI went off.
    const pending = await this.getNotice()

    if (raise && pending?.kind !== 'credito-finito' && pending?.kind !== 'chiave-rifiutata') {
      await this.raiseNotice({ kind: raise, at: Date.now(), available, days })
    }
  }

  /**
   * The key or the credit gave out: the AI goes off as the user would turn
   * it off — every run stops, nothing of the Segretario shows, what it
   * learnt is kept — and the user is told. It comes back the way it is
   * turned on, from the setup, once the key or the credit is put right.
   */
  private turnOff(
    kind: 'credito-finito' | 'chiave-rifiutata' | 'modello-non-disponibile'
  ): Promise<void> {
    this.turningOff ??= (async () => {
      if ((await this.db.store.getPreferences()).enabled) {
        await this.setPreferences({ enabled: false })
        await this.raiseNotice({ kind, at: Date.now() })
      }
    })().finally(() => {
      this.turningOff = null
    })

    return this.turningOff
  }

  /**
   * OpenRouter refused a request for its key or its credit
   * (`OpenRouterClient`): a check of its own says which, and the AI goes
   * off. A refused key the check finds working after all — a passing
   * refusal, or OpenRouter not answering — leaves the AI on, and the work
   * it held back goes on.
   */
  private refused(error: SegretarioError): void {
    // The model gone, or served by no provider as the routing asks: no check of the key says
    // otherwise, and nothing would go through.
    if (error.code === 'model-unavailable') {
      void this.turnOff('modello-non-disponibile').catch((failure: unknown) =>
        logMainError('The AI could not go off for a model unavailable', failure)
      )
      return
    }

    this.refusing ??= (async () => {
      const status =
        error.code === 'no-credit' ? await this.creditRefused() : await this.checkKeyNow(false)
      const { enabled } = await this.db.store.getPreferences()

      if (enabled && (status.keyState === 'ready' || status.keyState === 'unchecked')) {
        this.engine?.reset()
        this.engine?.wake()
      }
    })()
      .catch((failure: unknown) =>
        logMainError('A refused key or credit could not be followed', failure)
      )
      .finally(() => {
        this.refusing = null
      })
  }

  async getNotice(): Promise<SegretarioNotice | null> {
    await this.opened.promise
    const kept = await this.db.store.meta('notice')
    return kept ? (JSON.parse(kept) as SegretarioNotice) : null
  }

  async dismissNotice(): Promise<void> {
    await this.opened.promise
    await this.db.store.deleteMeta('notice')
    this.options.send(SEGRETARIO_IPC.notice, null)
  }

  /** Something the user must know about the AI: kept until seen, and said outside the window too. */
  private async raiseNotice(notice: SegretarioNotice): Promise<void> {
    await this.db.store.setMeta('notice', JSON.stringify(notice))
    this.options.send(SEGRETARIO_IPC.notice, notice)
    const { title, body } = noticeWords(notice)
    this.options.notify(title, body)
  }

  /** Checks a key and keeps it, encrypted, if OpenRouter knows it. */
  async saveKey(rawKey: string): Promise<SegretarioStatus> {
    const key = rawKey.trim()

    if (!/^sk-or-[\w-]{10,}$/.test(key)) {
      throw new Error('Questa non sembra una chiave OpenRouter: inizia con «sk-or-».')
    }

    let status: SegretarioStatus
    const seq = ++this.statusSeq

    try {
      // Another key has its own credit: no refusal of the one it replaces.
      status = (await this.statusFor(key, null)).status
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
    this.creditRefusal = null
    return seq === this.statusSeq ? this.setStatus(status) : this.status
  }

  async removeKey(): Promise<SegretarioStatus> {
    ++this.statusSeq
    this.creditRefusal = null
    this.runner?.cancelAll()
    this.engine?.cancelRunning()
    await this.db.store.setApiKey(null, EMPTY_STATUS)
    return this.setStatus(EMPTY_STATUS)
  }

  /**
   * Asks OpenRouter again about the key and its credit — `byUser`, now, not
   * sharing a check the work asked for, the user saying they put the credit
   * right. Credit refused stays spent until more is left than then
   * (`creditSpent`); where the balance cannot be read, the user's word lifts it.
   */
  async checkKey({ byUser = false }: { byUser?: boolean } = {}): Promise<SegretarioStatus> {
    if (byUser) {
      return this.checkKeyNow(true)
    }

    this.checking ??= this.checkKeyNow(false).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  /** A check of the key; overtaken by a later one meanwhile, it leaves the status to it. */
  private async checkKeyNow(byUser: boolean): Promise<SegretarioStatus> {
    this.spentSinceCheck = 0
    const seq = ++this.statusSeq
    const key = await this.db.store.getApiKey()

    if (!key) {
      return this.setStatus(EMPTY_STATUS)
    }

    let next: SegretarioStatus
    let refusal = this.creditRefusal

    try {
      const checked = await this.statusFor(key, this.creditRefusal, byUser)
      next = checked.status
      refusal = checked.refusal
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error)
      next =
        error instanceof SegretarioError && error.code === 'invalid-key'
          ? { ...this.status, keyState: 'invalid', problem, checkedAt: Date.now() }
          : { ...this.status, keyState: 'unchecked', problem }
    }

    if (seq !== this.statusSeq) {
      return this.status
    }

    this.creditRefusal = refusal
    return this.setStatus(next)
  }

  /**
   * A request was refused for want of credit: the credit as it stands now
   * is not enough until more is left (`creditSpent`), and the AI goes off
   * (`followCredit`) — turned on again only with more credit than this.
   */
  private async creditRefused(): Promise<SegretarioStatus> {
    const seq = ++this.statusSeq
    const key = await this.db.store.getApiKey()

    if (!key) {
      return this.status
    }

    const now = (await this.statusFor(key, null).catch(() => null))?.status ?? null

    if (seq !== this.statusSeq) {
      return this.status
    }

    this.creditRefusal = { available: now?.credit?.available ?? null }
    // The credit not read now is not known: an older figure would hold the work after a top-up.
    return this.setStatus({
      ...(now ?? { ...this.status, credit: null }),
      keyState: 'exhausted',
      problem: spentCredit(now?.credit?.available ?? null),
      checkedAt: Date.now()
    })
  }

  /** What OpenRouter says of a key and its credit, with a refusal for want of it (`creditSpent`). */
  private async statusFor(
    key: string,
    refused: CreditRefusal | null,
    toldTopUp = false
  ): Promise<{ status: SegretarioStatus; refusal: CreditRefusal | null }> {
    const [check, model] = await Promise.all([
      this.client.checkKey(key),
      this.client.modelInfo(key).catch(() => null)
    ])
    const modelName = model ? model.name : this.status.modelName
    this.modelContext = model?.contextLength ?? this.modelContext
    const limits = [check.balance, check.limitRemaining].filter(
      (value): value is number => value !== null
    )
    const available = limits.length > 0 ? Math.min(...limits) : null
    const { spent: exhausted, refusal } = creditSpent(
      { available, balanceKnown: check.balance !== null },
      refused,
      toldTopUp
    )

    const status: SegretarioStatus = {
      keyState: exhausted ? 'exhausted' : 'ready',
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
      problem: exhausted ? spentCredit(available) : null,
      modelName
    }

    return { status, refusal }
  }

  /** How many tokens the model reads at once: asked of OpenRouter the first time it is needed. */
  private async contextLength(): Promise<number> {
    if (this.modelContext === null) {
      const { contextLength } = await this.client.modelInfo(await this.requireKey())

      if (contextLength === null) {
        throw new Error('OpenRouter non dice quanti token legge il modello.')
      }

      this.modelContext = contextLength
    }

    return this.modelContext
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
    // On only with a key that works and credit to spend: else it would go off at its first step.
    if (preferences.enabled && this.status.keyState === 'exhausted') {
      throw new Error(
        'Il credito OpenRouter è finito: ricaricalo su openrouter.ai, poi riaccendi le funzioni AI.'
      )
    }

    if (preferences.enabled && this.status.keyState === 'invalid') {
      throw new Error('OpenRouter non accetta la chiave: inseriscine una valida, poi riaccendi.')
    }

    const stored = await this.db.store.setPreferences(preferences)

    // Turned on, what said why it had gone off is over.
    if (stored.enabled) {
      const notice = await this.getNotice()

      if (notice?.kind === 'credito-finito' || notice?.kind === 'chiave-rifiutata') {
        await this.dismissNotice()
      }
    }

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
    result: GenerationBill
  ): Promise<void> {
    await this.db.store.recordUsage({
      activityId,
      purpose,
      model: result.model,
      provider: result.provider,
      usage: result.usage
    })

    // Spent a good part of what was left since the last check: the credit is asked for again,
    // so a warning comes in time however fast it goes.
    this.spentSinceCheck += result.usage.cost
    const left = this.status.credit?.available

    if (
      left !== undefined &&
      this.spentSinceCheck >= Math.max(CREDIT_RECHECK_FLOOR, left * CREDIT_RECHECK_SHARE)
    ) {
      void this.checkKey()
    }
  }

  async getEngineState(): Promise<EngineState> {
    return this.db.engine.state()
  }

  /** The setup's "Riprova": the reading's failures, and only those (§13ter.2). */
  async retryReading(accountIds?: string[]): Promise<void> {
    await this.requireKey()
    await this.db.engine.retryReading(accountIds)
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

      // The setup that turned the AI on promised the day in Oggi: it is written now, even
      // before dawn. Any other leaves the morning to its hour.
      if (finished && setupTurnsAiOn(finished) && (await this.ready())) {
        await this.engine?.writeDayNow()
      }
    }

    // A step on may let work through that waited for it.
    this.engine?.wake()
  }

  /**
   * Whether each connection's recent mail is in and read by the index: what
   * Conoscimi starts from. The rest of a longer horizon the reading waits for.
   */
  async connectionReadiness(accountIds: ReadonlyArray<string>): Promise<ConnectionReadiness[]> {
    return Promise.all(
      accountIds.map(async (accountId) => ({
        accountId,
        recentMailIndexed: await this.options.mail.recentMailIndexed(
          accountId,
          READING_DAYS.default
        )
      }))
    )
  }

  /** Where the reading of each connection's horizon stands — of these accounts (a connection just added), or all. */
  getReadingStatus(accountIds?: ReadonlyArray<string>): Promise<ReadingStatus> {
    return this.db.engine.readingStatus(accountIds)
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

  /**
   * The user's own words in a note: a version like any other, and a lesson;
   * over a version the Segretario changed since they opened it, refused.
   */
  async writeMemory(path: string, content: string, seenRevision?: number): Promise<MemoryNote[]> {
    const normalized = normalizeMemoryPath(path)
    const before = await this.db.notebook.read(normalized)

    if (before && seenRevision !== undefined && before.revision !== seenRevision) {
      throw new Error(
        'Il Segretario ha cambiato questa nota mentre la scrivevi: riaprila, guarda com’è ora e rifai la tua modifica.'
      )
    }

    await plainly(this.db.notebook.write(normalized, content, USER, { seenRevision }))

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
    // What writes the memory stops first: it would write again into the memory just emptied.
    for (const row of await this.db.store.listLearning()) {
      if (row.activityId) {
        this.runner?.cancel(row.activityId)
      }
    }

    await this.db.engine.stopWhere((unit) => MEMORY_TASKS.includes(unit.task as TaskKind))
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

    await this.engine?.forgetAccount(accountId)
    await store.forgetAccount(accountId)
    await store.addLesson('account-rimosso', { email })
    this.workChanged({ accountIds: [accountId], threadIds: [], messageKeys: [], projectIds: [] })
  }

  /**
   * A calendar connection removed: what was kept about its events goes, and
   * the next reflection hears of it — the memory is the Segretario's to
   * correct wherever it wrote of those calendars.
   */
  async forgetCalendar(connectionId: string, calendarNames: ReadonlyArray<string>): Promise<void> {
    const projectIds = await this.db.store.forgetCalendar(
      connectionId,
      calendarLearningKey(connectionId)
    )
    // Its looks go with it — a failed one too, no longer to try again.
    await this.db.engine.queue.cancelWaiting({ scopePrefix: calendarLookScope(connectionId) })
    // "Il punto" of a project that lost its events no longer says the truth.
    await this.db.registry.projects.markStale(projectIds)
    await this.db.store.addLesson('calendario-rimosso', { calendari: calendarNames })
    this.workChanged({ accountIds: [], threadIds: [], messageKeys: [], projectIds })
  }

  /**
   * "Elimina tutti i dati": everything the Segretario kept goes, and — as
   * after "Dimentica tutto" — the AI turns off: on again, it starts from the
   * guided setup, Conoscimi first, instead of reading a month of mail
   * knowing nothing.
   */
  async clearData(): Promise<void> {
    // Off first, so nothing starts while what it kept goes; off again after, the switch being
    // among what goes.
    await this.setPreferences({ enabled: false })
    this.runner?.cancelAll()
    this.engine?.cancelRunning()
    await this.db.store.clearData()
    this.searches.clear()
    await this.setPreferences({ enabled: false })
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
    // The reply and the events proposed are the conversation's: whichever of its messages is
    // open shows them. What a proposal does to one message (archiving it) shows on that one.
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
      proposals: proposals
        .filter(
          (proposal) =>
            proposal.kind === 'evento' ||
            (proposal.accountId === accountId && proposal.messageKey === messageKey)
        )
        .map((proposal) => this.proposalOf(proposal))
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

  /**
   * "Annulla" after the user ticked, set aside or put off an open thing: it
   * is as it was — its question too — and what the tick taught is taken back.
   */
  async undoCommitmentStatus(id: number): Promise<Commitment> {
    const { registry, store } = this.db
    const last = (await registry.commitments.history(id))
      .filter((entry) => entry.actor === 'utente')
      .sort((a, b) => b.id - a.id)[0]

    if (!last) {
      throw new Error('Non c’è niente da annullare.')
    }

    const record = await plainly(registry.undoCommitment(last.id, USER))

    if (!record) {
      throw new Error('Non c’è niente da annullare.')
    }

    await store.retractLessons(id, last.at)
    return commitmentOf(record)
  }

  async editCommitment(
    id: number,
    changes: { text?: string; due?: string | null; kind?: CommitmentKind }
  ): Promise<Commitment> {
    const { record } = await plainly(this.db.registry.editCommitment(id, changes, USER))
    return commitmentOf(record)
  }

  /** The user adds an open thing: from a message, from an event, or of their own. */
  async openCommitment(
    from:
      | { kind: 'message'; accountId: string; messageKey: string }
      | { kind: 'event'; eventKey: string }
      | { kind: 'user' },
    input: { kind: CommitmentKind; text: string; due: string | null }
  ): Promise<Commitment> {
    const origin = await this.originOf(from)
    const { record } = await plainly(this.db.registry.openCommitment(origin, input, USER))
    return commitmentOf(record)
  }

  /** Where the user's new open thing comes from, as the registry keeps it. */
  private async originOf(
    from:
      | { kind: 'message'; accountId: string; messageKey: string }
      | { kind: 'event'; eventKey: string }
      | { kind: 'user' }
  ): Promise<CommitmentOrigin> {
    if (from.kind === 'message') {
      const location = (await this.options.mail.locate(from.accountId, [from.messageKey])).get(
        from.messageKey
      )

      if (!location) {
        throw new Error('Il messaggio non è più nella posta.')
      }

      return {
        kind: 'messaggio',
        accountId: from.accountId,
        threadId: location.threadId,
        messageKey: from.messageKey
      }
    }

    if (from.kind === 'event') {
      if (!(await this.options.calendar.event(from.eventKey))) {
        throw new Error('L’evento non è più nel calendario.')
      }

      return { kind: 'evento', eventKey: from.eventKey }
    }

    return { kind: 'utente' }
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
  async eventPrep(eventKey: string): Promise<(LinkedText & { writtenAt: number }) | null> {
    return this.db.registry.day.prep(eventKey)
  }

  /** What the work holds of an event: the things born from it, the projects that gather it. */
  async eventWork(eventKey: string): Promise<EventWork> {
    const { registry } = this.db
    const [items, projects] = await Promise.all([
      registry.commitments.ofPlaces({ events: [eventKey] }),
      registry.projects.ofEvents([eventKey])
    ])

    return {
      commitments: items.map(commitmentOf),
      projects: (projects.get(eventKey) ?? []).map((project) => ({
        id: project.id,
        title: project.title
      }))
    }
  }

  /**
   * Where an open thing comes from, to open it from a link: its message
   * where it is now, its event, the user's word; null when gone.
   */
  async commitmentSource(
    id: number
  ): Promise<
    | { kind: 'message'; ref: MessageRef }
    | { kind: 'event'; eventKey: string }
    | { kind: 'user'; projectId?: string }
    | null
  > {
    const origin = (await this.db.registry.commitments.get(id))?.origin

    if (!origin) {
      return null
    }

    if (origin.kind === 'messaggio') {
      const ref = await this.replySource(origin.accountId, origin.messageKey)
      return ref ? { kind: 'message', ref } : null
    }

    if (origin.kind === 'evento') {
      return (await this.options.calendar.event(origin.eventKey))
        ? { kind: 'event', eventKey: origin.eventKey }
        : null
    }

    // The project it is about, if it is still there.
    return origin.projectId && (await this.db.registry.projects.get(origin.projectId))
      ? { kind: 'user', projectId: origin.projectId }
      : { kind: 'user' }
  }

  async listProposals(): Promise<Proposal[]> {
    return (await this.db.registry.proposals.open()).map((proposal) => this.proposalOf(proposal))
  }

  /**
   * The user's answer to a proposal — to the version they saw (`revision`):
   * one a run wrote again since is refused, to be looked at again. One
   * answer at a time for each: a second click does not create twice. An
   * event accepted is put in the calendar as proposed — the user's own act,
   * invitations included; an extension's proposal, the extension did what
   * it proposes, and this records how.
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
        /** An answer to the event's invitation. */
        response?: Exclude<CalendarResponse, 'needsAction'>
        /** What changes in the event, and only that. */
        change?: EventChange
      }

      if (payload.eventKey && payload.response) {
        const answered = await this.options.calendar.respond(payload.eventKey, payload.response)
        await registry.decideProposal(id, 'accettata', { eventKey: answered.key, ...result })
        return
      }

      if (payload.eventKey) {
        // What the proposal changes, and nothing else: a proposal written before it kept only
        // the change carries the whole event, of which what it did not say is left as it is.
        const change: EventChange = payload.change ?? {
          title: payload.title,
          start: payload.start,
          end: payload.end,
          allDay: payload.allDay,
          ...(payload.location ? { location: payload.location } : {}),
          ...(payload.description ? { description: payload.description } : {}),
          ...(payload.attendees?.length ? { attendees: payload.attendees } : {})
        }
        const updated = await this.options.calendar.update(payload.eventKey, change)
        await registry.decideProposal(id, 'accettata', { eventKey: updated.key, ...result })
        return
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

  /**
   * Copies an extension saved outside the mail: facts on each message, and
   * where the user files. The record is what makes a copy saved, so only it
   * can fail the save; the proposals are answered after it — those the user
   * followed accepted with their choice, the rest set aside — and a proposal
   * left open by a failure there is answered by the next copy or the user.
   */
  async copiesSaved(
    entries: ReadonlyArray<{
      ref: MessageRef
      messageKey: string
      threadId: string
      fromAddress: string | null
      destination: string
      files: string[]
      proposals: ReadonlyArray<{ id: string; result: Record<string, unknown> }>
    }>
  ): Promise<void> {
    // Kept as the app keeps paths: under the mount point their share first had.
    await this.db.registry.saveCopies(
      await Promise.all(
        entries.map(async (entry) => ({
          accountId: entry.ref.accountId,
          messageKey: entry.messageKey,
          threadId: entry.threadId,
          source: extensionMain.id,
          destination: await canonicalPath(entry.destination),
          files: await Promise.all(entry.files.map((file) => canonicalPath(file))),
          fromAddress: entry.fromAddress
        }))
      ),
      USER
    )

    for (const proposal of entries.flatMap((entry) => entry.proposals)) {
      await this.decideProposal(proposal.id, true, proposal.result).catch((error: unknown) =>
        logMainError('A proposal followed by a saved copy could not be accepted', error)
      )
    }

    // Saved, the proposals to save them still open are answered: set aside.
    const answered = extensionMain.assistant?.savedCopyProposalKind

    if (answered) {
      for (const accountId of new Set(entries.map((entry) => entry.ref.accountId))) {
        await this.db.registry.proposals
          .supersedeFor(
            accountId,
            entries
              .filter((entry) => entry.ref.accountId === accountId)
              .map((entry) => entry.messageKey),
            answered
          )
          .catch((error: unknown) =>
            logMainError('Proposals answered by a saved copy could not be set aside', error)
          )
      }
    }
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
    const ofConversations = latest(await registry.copies.ofThreads(threads))
    const ofSenders =
      ofConversations === null && senders.length > 0
        ? latest(await registry.copies.fromSenders(senders, ''))
        : null

    const projectIds = [
      ...new Set(
        (await registry.projects.linksOf(threads))
          .filter((link) => !link.rejected)
          .map((link) => link.projectId)
      )
    ]
    const resources = await Promise.all(projectIds.map((id) => registry.projects.resources(id)))

    return {
      savedBefore: ofConversations
        ? { destination: ofConversations, from: 'conversazione' }
        : ofSenders
          ? { destination: ofSenders, from: 'mittente' }
          : null,
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

  /**
   * A folder moved to where it is now (both as the app keeps paths): what
   * the registry kept under it follows, and the Segretario learns of it —
   * its memory may name the old place. How many were kept anew.
   */
  async relocatePaths(from: string, to: string): Promise<number> {
    await this.whenReady()
    const moved = await this.db.registry.relocatePaths(from, to)
    await this.db.store.addLesson('percorso-spostato', { da: from, a: to })
    return moved
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

  /** Messages as a line of the day shows them: where they are, their subject, who wrote them ("Tu" for the user). */
  private async messageLines(
    wanted: ReadonlyArray<{ accountId: string; messageKey: string }>
  ): Promise<Map<string, { ref: MessageRef; subject: string; from: string; dateIso: string }>> {
    const own = new Set(
      (await this.options.mail.listAccounts()).map((account) => account.email.toLowerCase())
    )
    const lines = new Map<
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
        lines.set(`${accountId}\u0000${key}`, {
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

    return lines
  }

  /**
   * Lines of the day, from what is open and prepared, each with where it
   * comes from: its message — in the folder the user thinks of it in, never
   * one only in the Trash or Spam (what is open from those is set aside) —,
   * its event — while it is in the calendar —, or the user's word.
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
    const wanted = [
      ...records.flatMap(({ origin }) =>
        origin.kind === 'messaggio'
          ? [{ accountId: origin.accountId, messageKey: origin.messageKey }]
          : []
      ),
      ...replies
    ]
    const summaries = await this.messageLines(wanted)
    const notes = new Map(
      (await registry.notes.many(wanted)).map((note) => [
        `${note.accountId}\u0000${note.messageKey}`,
        note
      ])
    )
    const events = new Map(
      await Promise.all(
        [
          ...new Set(
            records.flatMap(({ origin }) => (origin.kind === 'evento' ? [origin.eventKey] : []))
          )
        ].map(async (key) => [key, await this.options.calendar.event(key)] as const)
      )
    )
    const lines = new Map<number, DayLine>()

    for (const record of records) {
      const { origin } = record
      const line = { text: record.text, due: record.due, commitment: commitmentOf(record) }

      if (origin.kind === 'messaggio') {
        const key = `${origin.accountId}\u0000${origin.messageKey}`
        const summary = summaries.get(key)

        if (summary) {
          lines.set(record.id, {
            ...line,
            priority: notes.get(key)?.priority ?? null,
            source: {
              kind: 'message',
              ref: summary.ref,
              messageKey: origin.messageKey,
              subject: summary.subject,
              from: summary.from,
              date: summary.dateIso
            }
          })
        }
      } else if (origin.kind === 'evento') {
        // An event no longer in the calendar — past the window kept, cancelled, its calendar
        // gone — leaves what is open from it open: the line stays, saying so.
        const event = events.get(origin.eventKey)

        lines.set(record.id, {
          ...line,
          priority: null,
          source: {
            kind: 'event',
            eventKey: origin.eventKey,
            title: event?.title ?? null,
            start: event?.start ?? null,
            allDay: event?.allDay ?? false
          }
        })
      } else {
        lines.set(record.id, {
          ...line,
          priority: null,
          source: { kind: 'user', date: new Date(record.createdAt).toISOString() }
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
          source: {
            kind: 'message',
            ref: summary.ref,
            messageKey: reply.messageKey,
            subject: summary.subject,
            from: summary.from,
            date: summary.dateIso
          }
        })
      }
    }

    return { commitments: lines, replies: replyLines }
  }

  async getToday(): Promise<TodayPage> {
    const { registry, engine } = this.db

    // Looked at, and behind by more than an hour: the letter is written again (vision §2.4).
    if ((await this.ready()) && (await engine.letterBehind(LETTER_LOOKED_AT_STALE_MS))) {
      if (!(await engine.dayBusy())) {
        await engine.refreshDay()
      }
    }

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
    const proposalSources = await this.messageLines(
      proposals.flatMap((proposal) =>
        proposal.accountId && proposal.messageKey
          ? [{ accountId: proposal.accountId, messageKey: proposal.messageKey }]
          : []
      )
    )
    const byPriority = (a: DayLine, b: DayLine): number =>
      (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
      PRIORITY_ORDER[a.priority ?? 'media'] - PRIORITY_ORDER[b.priority ?? 'media']
    // What the Segretario asks about stands once, under its question, until the user answers.
    const asked = open.filter((record) => record.question !== null)
    const settledOpen = open.filter((record) => record.question === null)
    const owed = settledOpen.filter((record) => OWED_KINDS.includes(record.kind))
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
      letterLinks: letter?.links ?? [],
      letterAt: letter?.writtenAt ?? null,
      letterRewriting: await engine.dayInProgress(),
      reading: Math.max(0, state.reading.total - state.reading.read),
      network: state.waiting,
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
      awaited: settledOpen
        .filter((record) => record.kind === 'aspetti')
        .sort((a, b) => a.createdAt - b.createdAt)
        .flatMap(lineOf),
      ready,
      questions: asked.flatMap(lineOf),
      // An event to decide on comes before the rest: it is part of the days ahead.
      proposals: [...proposals]
        .sort((a, b) => Number(b.kind === 'evento') - Number(a.kind === 'evento'))
        .map((proposal) => {
          const source =
            proposal.accountId && proposal.messageKey
              ? proposalSources.get(`${proposal.accountId}\u0000${proposal.messageKey}`)
              : undefined
          return {
            ...this.proposalOf(proposal),
            ...(source
              ? { source: { ref: source.ref, from: source.from, subject: source.subject } }
              : {})
          }
        }),
      preps: Object.fromEntries(
        [...(await registry.day.preps(events.map((event) => event.key)))].map(([key, prep]) => [
          key,
          { text: prep.text, links: prep.links }
        ])
      )
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
    const { registry } = this.db
    const projects = (
      await registry.projects.list({
        includeHidden: options.includeHidden,
        includeClosed: options.includeHidden
      })
    ).map(projectOf)
    // What is open from a message in the Trash or Spam is set aside: not counted, as not shown.
    const open = await registry.commitments.open()
    const aside = await this.setAsideOf(open)

    if (aside.size === 0) {
      return projects
    }

    const setAsideThreads = open.flatMap(({ id, origin }) =>
      aside.has(id) && origin.kind === 'messaggio' ? [origin] : []
    )
    const less = new Map<string, number>()

    for (const link of await registry.projects.linksOf(setAsideThreads)) {
      if (!link.rejected) {
        less.set(
          link.projectId,
          (less.get(link.projectId) ?? 0) +
            setAsideThreads.filter(
              (origin) => origin.accountId === link.accountId && origin.threadId === link.threadId
            ).length
        )
      }
    }

    return projects.map((project) => ({
      ...project,
      openCommitments: Math.max(0, project.openCommitments - (less.get(project.id) ?? 0))
    }))
  }

  /** Of these commitments, those whose message lies only in the Trash or Spam: set aside. */
  private async setAsideOf(records: ReadonlyArray<CommitmentRecord>): Promise<Set<number>> {
    const aside = new Set<number>()
    const fromMessages = records.flatMap(({ id, origin }) =>
      origin.kind === 'messaggio' ? [{ id, ...origin }] : []
    )

    for (const accountId of new Set(fromMessages.map((item) => item.accountId))) {
      const ofAccount = fromMessages.filter((item) => item.accountId === accountId)
      const located = await this.options.mail.locate(accountId, [
        ...new Set(ofAccount.map((item) => item.messageKey))
      ])

      for (const item of ofAccount) {
        if (located.get(item.messageKey)?.setAside) {
          aside.add(item.id)
        }
      }
    }

    return aside
  }

  async getProject(id: string): Promise<ProjectDetail | null> {
    const { registry } = this.db
    const summary = await registry.projects.summary(id)

    if (!summary) {
      return null
    }

    const [threads, resources] = await Promise.all([
      registry.projects.threadsOf(id),
      registry.projects.resources(id)
    ])
    const items = await registry.commitments.ofPlaces({
      threads,
      events: resources
        .filter((resource) => resource.kind === 'evento')
        .map((resource) => resource.location),
      projects: [id]
    })
    const aside = await this.setAsideOf(items)

    return {
      ...projectOf(summary),
      resources: resources.map((resource) => ({
        kind: resource.kind,
        location: resource.location,
        label: resource.label
      })),
      commitments: items.filter((item) => !aside.has(item.id)).map(commitmentOf),
      openCommitments: Math.max(
        0,
        summary.openCommitments -
          items.filter((item) => item.status === 'aperta' && aside.has(item.id)).length
      )
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
    const result = await this.asked(request.requestId, (signal) =>
      startRun(this.starter(), {
        task: 'scrittura',
        background: false,
        visibility: 'nascosta',
        data,
        shown: request.instruction,
        editor: { draftId: request.draftId, selection: request.selectedText },
        signal,
        missing: async (run) =>
          run.results.editorText
            ? null
            : 'Scrivi il testo nel messaggio con `scrivi_bozza` (il solo `testo`).'
      })
    )
    const text = result.run.results.editorText

    if (result.status === 'cancelled') {
      throw new SegretarioError('cancelled', 'Interrotto.')
    }

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
    // Stopped by the user — who sends at once — it has nothing to say.
    const result = await this.asked(request.requestId, (signal) =>
      startRun(this.starter(), {
        task: 'revisione',
        background: false,
        visibility: 'nascosta',
        data,
        signal,
        missing: async (run) => (run.results.review ? null : 'Dai l’esito con `revisione`.')
      })
    )
    return result.run.results.review ?? []
  }

  /**
   * A search asked in words: the Segretario finds the search that shows
   * what the user means, and its list is kept for the page to open.
   */
  async askMail(question: string, requestId: string): Promise<AskedMail> {
    await this.requireKey()
    const data = await prepareSearch({ mail: this.options.mail }, question)
    const result = await this.asked(requestId, (signal) =>
      startRun(this.starter(), {
        task: 'ricerca',
        background: false,
        visibility: 'nascosta',
        data,
        shown: question,
        signal,
        missing: async (run) =>
          run.results.search ? null : 'Mostra la ricerca con `mostra` (`ricerca`).'
      })
    )
    const search = result.run.results.search

    if (result.status === 'cancelled') {
      throw new SegretarioError('cancelled', 'Interrotto.')
    }

    if (!search) {
      throw new Error(result.error?.message ?? 'Non sono riuscito a capire cosa cercare.')
    }

    return this.keepSearch(search, question)
  }

  /** Stops a request the user waits for: they no longer want to. */
  async stopAsking(requestId: string): Promise<void> {
    this.asking.get(requestId)?.abort()
  }

  /** A request the user waits for, theirs to stop for as long as it goes on. */
  private async asked<T>(requestId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    this.asking.set(requestId, controller)

    try {
      return await work(controller.signal)
    } finally {
      this.asking.delete(requestId)
    }
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

  /**
   * A request of the user's that stopped short — it went nowhere for too
   * long, or a call of it was refused (§13ter.2) — taken up again from where
   * it was: what it did stays done, and it sees it.
   */
  async retryActivity(id: string): Promise<void> {
    const { store, runner } = this.db

    if (runner.isRunning(id)) {
      return
    }

    const activity = await store.getActivity(id)

    if (activity?.task !== 'richiesta' || activity.status !== 'failed') {
      throw new Error('Questo lavoro non è da riprovare.')
    }

    await this.requireKey()
    void this.converse(id)
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
      const result = await this.client.chat(
        key,
        {
          messages: [
            { role: 'system', content: PROMPTS.title },
            { role: 'user', content: request.slice(0, 4_000) }
          ],
          reasoningEffort: 'none',
          maxTokens: 40
        },
        { onLateBill: (bill) => this.recordUsage(id, 'titolo', bill) }
      )

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
