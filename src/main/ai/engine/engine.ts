import {
  calendarLearningKey,
  READING_DAYS,
  setupTurnsAiOn,
  type ActivityEvent,
  type ConnectionReading,
  type EngineState,
  type OnboardingState,
  type OnboardingStep,
  type ReadingStatus,
  type TaskKind
} from '@shared/segretario'
import { CALENDAR_HELD_DAYS, type CalendarEvent } from '@shared/calendar'

import type { AgentRunner, RunResult } from '../agent/runner'
import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
import type { AiStore, StoredReading } from '../ai-store'
import type { Notebook } from '../memory/notebook'
import { SegretarioError } from '../openrouter'
import type { Registry } from '../registry/registry'
import {
  changeHeld,
  eventStart,
  firstLookDone,
  heldWindow,
  lookBlocks,
  lookItems,
  prepareCalendarChanges,
  prepareCalendarLook,
  unlooked,
  type LookBlock,
  type LookItem
} from '../tasks/calendar'
import { prepareDay, prepareProjectState } from '../tasks/day'
import { prepareKeepingUp, prepareReflection } from '../tasks/memory-work'
import {
  prepareReading,
  readingLockKeys,
  readingMissing,
  type ReadingScope
} from '../tasks/reading'
import { startRun, type RunStarter } from '../tasks/start-run'
import { localDay } from '../tools/day'
import { logMainError } from '../../utils/error-utils'
import type { Reachability } from './reachability'
import { KeyRefused, Scheduler, WorkFailure, type TaskExecutor } from './scheduler'
import { WorkQueue, type WorkUnit } from './work-queue'

/** Mail this recent is new mail, read before the backlog; older is the backlog. */
const NEW_MAIL_DAYS = 2
/** How long new mail of a conversation waits for the rest of its burst. */
const BURST_MS = 15_000
const PLAN_EVERY_MS = 20_000
/** Conversations queued at most in one planning. */
const READING_PLANNED = 300

/** Priorities: lower first; at `BACKLOG_PRIORITY` (50) and after, the backlog. */
const PRIORITY = {
  // What just changed in a source comes first, whichever source: mail arrived, events others
  // moved — at par.
  newMail: 10,
  calendar: 10,
  dayRefresh: 15,
  day: 20,
  project: 40,
  memory: 50,
  backlog: 60
} as const

/** Background runs at once, normally and while the first reading is prepared. */
const CONCURRENCY = 4
const PREPARING_CONCURRENCY = 8

/** The day's run waits for the morning: before this hour it is not yet the day. */
const DAY_STARTS_AT_HOUR = 6
/** The day whose morning look is done (AAAA-MM-GG). */
const MORNING_DONE = 'morning_done'
/** The letter is looked at again when it is this old and the day moved since. */
const LETTER_STALE_MS = 3 * 60 * 60 * 1000
/** Projects whose "Il punto" one planning queues at most. */
const PROJECT_STATES_PLANNED = 10
const REFLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000
const KEEP_UP_INTERVAL_MS = 20 * 60 * 60 * 1000
const KEEP_UP_MIN_NOTES = 12
/** How long changes to the calendar wait for the rest of theirs: a meeting moved, then its guests answering. */
const CALENDAR_SETTLE_MS = 2 * 60_000
/** Changes to the calendar one look takes at most. */
const CALENDAR_CHANGES_READ = 100
/** In `ai_meta`: how far the changes to the calendar have been handed to the Segretario. */
const CALENDAR_SEEN = 'calendar_seen'
/** The units of a calendar's first look, a block each. */
const LOOK_SCOPE = 'calendario-vista:'

/** The scope the blocks of a calendar connection's first look begin with: its work, which goes with it. */
export function calendarLookScope(connectionId: string): string {
  return `${LOOK_SCOPE}${connectionId}:`
}

/** What a block of a calendar's first look holds, as queued. */
interface LookScope extends LookBlock {
  look: string
  /** The window the look was planned in: where a series is placed, and where it ends. */
  window: { from: number; today: number; to: number }
}
/** In `ai_meta`: when keeping up last found too little new to be worth a run. */
const KEEP_UP_CHECKED = 'keep_up_checked'
const DAY_MS = 24 * 60 * 60 * 1000

/** The steps of the guided setup before its reading: until then, its connections are not read. */
const BEFORE_READING: ReadonlyArray<OnboardingStep> = [
  'connessioni',
  'segretario',
  'preparazione',
  'conoscimi'
]

/**
 * What the guided setup under way holds back until its reading: Conoscimi
 * comes first, so the reading starts informed. The setup that turns the AI
 * on holds every connection; one adding connections, those — its mailboxes
 * by id, its calendars as the ones not known yet. Conoscimi done again by
 * hand holds nothing back. Past Conoscimi — done, or gone on without —
 * nothing is held: a connection left unknown is read as far as the
 * horizon it has, mail and calendars alike.
 */
export interface SetupHold {
  holding: boolean
  all: boolean
  mail: ReadonlySet<string>
}

export function setupHold(setup: OnboardingState | null): SetupHold {
  const holding =
    setup !== null && setup.case !== 'conoscimi' && BEFORE_READING.includes(setup.step)
  return {
    holding,
    all: holding && setupTurnsAiOn(setup) && setup.accountIds.length === 0,
    mail: new Set(holding ? setup.accountIds : [])
  }
}

/** Whether a calendar (by its learning key) waits for the setup: every one, or one not known yet. */
export function calendarHeld(hold: SetupHold, key: string, known: ReadonlySet<string>): boolean {
  return hold.all || (hold.holding && !known.has(key))
}

export interface EngineDeps {
  store: AiStore
  registry: Registry
  notebook: Notebook
  runner: AgentRunner
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  queue: WorkQueue
  /** Whether OpenRouter answers: the runs wait for it, the scheduler starts one at a time meanwhile. */
  reachability: Reachability
  emit(event: ActivityEvent): void
  /** Whether the AI is on and has a key: the engine plans and runs only then. */
  ready(): Promise<boolean>
  /** The guided setup under way, which holds some of the work back (see `plan`). */
  onboarding(): Promise<OnboardingState | null>
  /** What the engine is doing changed. */
  onStateChange(): void
}

/** A run settled, then — done — what follows from its being done. */
async function settled(result: RunResult, done: () => Promise<void>): Promise<void> {
  settle(result)
  await done()
}

/**
 * A run that did not finish, as the scheduler takes it: the key or the
 * credit refused — the AI goes off — or the unit's failure. Waiting for
 * OpenRouter is no failure: the run waits, inside, and goes on.
 */
function settle(result: RunResult): void {
  if (result.status === 'done') {
    return
  }

  if (result.status === 'cancelled') {
    throw new WorkFailure('Interrotto.')
  }

  const error = result.error

  // The key or the credit refused stops everything — the AI goes off; a request blocked for what
  // it carries (`blocked`) is that work's failure, not every work's.
  if (error instanceof SegretarioError && error.refusesService) {
    throw new KeyRefused(error.message)
  }

  throw new WorkFailure(error?.message ?? 'Il lavoro non è finito.')
}

/** Whether a unit of work reads a conversation of these accounts — a connection just added — or of any. */
function readingOf(accountIds: ReadonlyArray<string> | undefined): (scopeKey: string) => boolean {
  return (scopeKey) => !accountIds || accountIds.some((id) => scopeKey.startsWith(`lettura:${id}:`))
}

/**
 * The engine that wakes the Segretario: it asks the state what work there
 * is — messages not read yet, the morning, a project behind on "Il punto",
 * lessons to take in — queues it, and runs it with the scheduler. It is
 * not a second mind: what a message means, the Segretario decides; when
 * and in what order it is read, and that nothing is lost or done twice,
 * the engine does.
 */
export class SegretarioEngine {
  private readonly scheduler: Scheduler
  private readonly starter: RunStarter
  private planTimer: NodeJS.Timeout | null = null
  private planning: Promise<void> | null = null
  private replan = false
  private preparing = false
  private running = false

  constructor(private readonly deps: EngineDeps) {
    this.starter = {
      store: deps.store,
      runner: deps.runner,
      sources: { mail: deps.mail, calendar: deps.calendar, notebook: deps.notebook },
      emit: deps.emit
    }
    this.scheduler = new Scheduler(deps.queue, this.executors(), {
      reachability: deps.reachability,
      concurrency: () => (this.preparing ? PREPARING_CONCURRENCY : CONCURRENCY),
      // Work queued before the AI was switched off — or before a restart with it off — waits.
      canStart: () => deps.ready(),
      onChange: () => deps.onStateChange()
    })
  }

  get queue(): WorkQueue {
    return this.deps.queue
  }

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    await this.scheduler.start()
    this.planTimer = setInterval(() => this.wake(), PLAN_EVERY_MS)
    this.wake()
  }

  async stop(): Promise<void> {
    this.running = false

    if (this.planTimer) {
      clearInterval(this.planTimer)
      this.planTimer = null
    }

    await this.planning
    await this.scheduler.stop()
  }

  /** Something may have come: plan now (once, however many times it is asked meanwhile). */
  wake(): void {
    if (!this.running) {
      return
    }

    if (this.planning) {
      this.replan = true
      return
    }

    this.planning = this.plan()
      .catch((error: unknown) => logMainError('Segretario planning failed', error))
      .finally(() => {
        this.planning = null
        this.scheduler.wake()

        if (this.replan) {
          this.replan = false
          this.wake()
        }
      })
  }

  /** The first reading is being prepared, the user waiting: more runs at once. */
  setPreparing(preparing: boolean): void {
    this.preparing = preparing
    this.scheduler.wake()
  }

  /** The AI was turned off, or on again: a key or a credit refused holds nothing back. */
  reset(): void {
    this.scheduler.reset()
  }

  /** The computer sleeps: the work in the background waits for it to wake (see `Scheduler`). */
  setAsleep(asleep: boolean): void {
    this.scheduler.setAsleep(asleep)

    if (!asleep) {
      // Awake, the world may have moved on while it slept: plan before the queue goes on.
      this.wake()
    }
  }

  /** Stops every run of a task now — the AI switched off. */
  cancelRunning(): void {
    for (const unit of this.scheduler.runningUnits()) {
      this.scheduler.cancel(unit.id)
    }
  }

  /** An account is removed: the work on it stops before what it wrote is taken away. */
  async forgetAccount(accountId: string): Promise<void> {
    await this.stopWhere((unit) => unit.scopeKey.includes(`:${accountId}:`))
  }

  /** Stops the running units that match, and waits for them to stop. */
  async stopWhere(going: (unit: WorkUnit) => boolean): Promise<void> {
    await this.scheduler.stopWhere(going)
  }

  /**
   * The AI switched off: what runs stops, and what waits is let go — switched on
   * again, the planning finds from the state what is still to do.
   */
  async switchedOff(): Promise<void> {
    this.scheduler.reset()
    this.cancelRunning()
    await this.deps.queue.cancelWaiting()
    this.deps.onStateChange()
  }

  /**
   * The AI switched on again: while it was off nobody followed the
   * calendars. Each is looked at whole again, as the first time — in the
   * setup's reading, once Conoscimi is done — and that look covers what
   * changed meanwhile: the changes start again from now (§7.2, §12.2). The
   * mail needs nothing of the kind: what came meanwhile has no note yet.
   */
  async switchedOn(): Promise<void> {
    const { store, calendar, queue } = this.deps

    for (const connection of await calendar.connections().catch(() => [])) {
      await store.forgetLooked(calendarLearningKey(connection.id))
      await queue.forgetWithin(calendarLookScope(connection.id))
    }

    await store.setMeta(CALENDAR_SEEN, String(await calendar.latestChangeId()))
  }

  async state(): Promise<EngineState> {
    const counts = await this.deps.queue.counts()
    const queued: Partial<Record<TaskKind, number>> = {}
    const running: Partial<Record<TaskKind, number>> = {}

    // A failure is not shown: in the background it ends there (§14.2).
    for (const count of counts) {
      const task = count.task as TaskKind

      if (count.status === 'al_lavoro') {
        running[task] = (running[task] ?? 0) + count.count
      } else if (count.status !== 'fallito') {
        queued[task] = (queued[task] ?? 0) + count.count
      }
    }

    const network = this.scheduler.waitingForNetwork

    return {
      waiting: network
        ? `La connessione con OpenRouter non risponde: riprovo alle ${new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' }).format(network.until)}.`
        : null,
      reading: await this.deps.mail.readingProgress((await this.horizons()).sinceOf),
      queued,
      running
    }
  }

  /**
   * Where the reading of each connection's horizon stands: what is read,
   * what waits, what failed after its attempts — and whether anything but
   * that is left, which the planner would have queued; the calendars'
   * events looked at; how far back each connection is read, and why.
   */
  async readingStatus(accountIds?: ReadonlyArray<string>): Promise<ReadingStatus> {
    const { queue, mail, store } = this.deps
    const { sinceOf, daysOf, readings } = await this.horizons()
    const ours = readingOf(accountIds)
    const units = (await queue.units('lettura')).filter((unit) => ours(unit.scopeKey))
    const waiting = units.filter(
      (unit) => unit.status === 'in_coda' || unit.status === 'da_riprovare'
    ).length
    const running = units.filter((unit) => unit.status === 'al_lavoro').length
    const failedUnits = (await queue.failed('lettura')).filter((unit) => ours(unit.scopeKey))
    const failedKeys = new Set(failedUnits.map((unit) => unit.scopeKey))
    const unread = await mail.unreadConversations(sinceOf, READING_PLANNED)
    const left = unread.filter(
      (conversation) =>
        ours(`lettura:${conversation.accountId}:`) &&
        !failedKeys.has(`lettura:${conversation.accountId}:${conversation.threadId}`)
    )
    const titleOf = async (
      unit: { activityId: string | null },
      otherwise: string
    ): Promise<string> =>
      (unit.activityId ? (await store.getActivity(unit.activityId))?.title : null) ?? otherwise
    const failed = await Promise.all(
      failedUnits.map(async (unit) => ({
        title: await titleOf(unit, 'Una conversazione'),
        error: unit.lastError
      }))
    )

    const accounts = (await mail.listAccounts()).filter(
      (account) => !accountIds || accountIds.includes(account.id)
    )
    const calendars = await this.readingCalendars(accountIds)
    const looks = await Promise.all(
      calendars.map((connection) =>
        this.lookProgress(connection.id, readings.get(calendarLearningKey(connection.id)))
      )
    )
    const lookUnits = looks.flatMap((look) => look.units)
    const pendingLooks = lookUnits.filter((unit) => unit.status !== 'fatto')
    const failedLooks = lookUnits.filter((unit) => unit.status === 'fallito')
    const eventsLeft = looks.some((look) => look.left)
    const downloading = (
      await Promise.all(
        accounts.map(
          async (account) => !(await mail.recentMailIndexed(account.id, daysOf(account.id)))
        )
      )
    ).some(Boolean)
    const horizons: ConnectionReading[] = [
      ...accounts.map((account) => this.horizonOf(account.id, 'posta', account.email, readings)),
      // A calendar has no horizon of its own: what it holds is looked at (§7.2).
      ...calendars.map((connection): ConnectionReading => ({
        key: calendarLearningKey(connection.id),
        kind: 'calendario',
        label: connection.label,
        days: CALENDAR_HELD_DAYS.back,
        reason: null
      }))
    ]

    return {
      ...(await mail.readingProgress(sinceOf, accountIds)),
      waiting:
        waiting +
        pendingLooks.filter((unit) => unit.status === 'in_coda' || unit.status === 'da_riprovare')
          .length,
      running: running + pendingLooks.filter((unit) => unit.status === 'al_lavoro').length,
      failed: [
        ...failed,
        ...(await Promise.all(
          failedLooks.map(async (unit) => ({
            title: await titleOf(unit, 'Un calendario'),
            error: unit.lastError
          }))
        ))
      ],
      events: {
        looked: looks.reduce((sum, look) => sum + look.looked, 0),
        total: looks.reduce((sum, look) => sum + look.total, 0)
      },
      horizons,
      downloading,
      done: waiting === 0 && running === 0 && left.length === 0 && !eventsLeft && !downloading
    }
  }

  /**
   * Where a calendar's first look stands: the things of its window — a
   * series once — how many are looked at, the blocks of the look, and
   * whether any is still to be looked at by itself (not failed).
   */
  private async lookProgress(
    connectionId: string,
    span: StoredReading | undefined
  ): Promise<{ total: number; looked: number; units: WorkUnit[]; left: boolean }> {
    const window = heldWindow()
    const items = lookItems(await this.eventsOf(connectionId, window.from, window.to), window.today)

    if (firstLookDone(span)) {
      return { total: items.length, looked: items.length, units: [], left: false }
    }

    const units = await this.deps.queue.within(calendarLookScope(connectionId))
    // Before it is planned, what an earlier look reached; then all but what its blocks still hold.
    const notLooked =
      units.length === 0
        ? items.filter((item) =>
            unlooked(span, window).some((range) => item.at >= range.from && item.at < range.to)
          )
        : items.filter((item) =>
            units.some((unit) => {
              const block = unit.scope as LookScope
              return unit.status !== 'fatto' && item.at >= block.from && item.at < block.to
            })
          )

    return {
      total: items.length,
      looked: items.length - notLooked.length,
      units,
      left:
        units.length === 0 ||
        units.some((unit) => unit.status !== 'fatto' && unit.status !== 'fallito')
    }
  }

  /** How far back a connection is read, in the words the setup shows. */
  private horizonOf(
    key: string,
    kind: ConnectionReading['kind'],
    label: string,
    readings: ReadonlyMap<string, StoredReading>
  ): ConnectionReading {
    const reading = readings.get(key)
    return {
      key,
      kind,
      label,
      days: reading?.days ?? READING_DAYS.default,
      reason: reading?.days != null ? reading.reason : null
    }
  }

  /**
   * The setup's "Riprova", at the end of its reading: what failed of it —
   * the conversations of these accounts, or of all, and the looks at their
   * calendars — tried again now, and only that: what failed in the
   * background ended there (§14.2).
   */
  async retryReading(accountIds?: ReadonlyArray<string>): Promise<void> {
    const { queue } = this.deps
    const ours = readingOf(accountIds)
    const calendars = await this.readingCalendars(accountIds)
    const failed = [
      ...(await queue.failed('lettura')).filter((unit) => ours(unit.scopeKey)),
      ...(await queue.failed('calendario')).filter((unit) =>
        calendars.some((connection) => unit.scopeKey.startsWith(calendarLookScope(connection.id)))
      )
    ]

    if (failed.length > 0) {
      await queue.retryFailed(failed.map((unit) => unit.id))
      this.wake()
    }
  }

  /** The calendars a reading looks at: those of these accounts — a connection just added — or all. */
  private async readingCalendars(
    accountIds: ReadonlyArray<string> | undefined
  ): Promise<Awaited<ReturnType<SegretarioCalendarPort['connections']>>> {
    return (await this.lookedCalendars(setupHold(await this.deps.onboarding()))).filter(
      (connection) =>
        !accountIds ||
        (connection.mailAccountId !== null && accountIds.includes(connection.mailAccountId))
    )
  }

  /**
   * How far back each connection is read: its days, decided — by Conoscimi,
   * or the user in chat — or the default; for mail, as the moment its
   * reading starts from.
   */
  private async horizons(): Promise<{
    readings: Map<string, StoredReading>
    daysOf: (key: string) => number
    sinceOf: (accountId: string) => string
  }> {
    const readings = new Map((await this.deps.store.readings()).map((row) => [row.key, row]))
    const daysOf = (key: string): number => readings.get(key)?.days ?? READING_DAYS.default
    const now = Date.now()

    return {
      readings,
      daysOf,
      sinceOf: (accountId) => new Date(now - daysOf(accountId) * DAY_MS).toISOString()
    }
  }

  /**
   * The calendar connections whose events are looked at one by one: all of
   * them, but those the setup under way holds back for Conoscimi (§4.1).
   */
  private async lookedCalendars(
    hold: SetupHold
  ): Promise<Awaited<ReturnType<SegretarioCalendarPort['connections']>>> {
    const [connections, learnt] = await Promise.all([
      this.deps.calendar.connections().catch(() => []),
      this.deps.store.listLearning()
    ])
    const known = new Set(
      learnt.filter((row) => row.finishedAt !== null).map((row) => row.accountId)
    )
    return connections.filter(
      (connection) => !calendarHeld(hold, calendarLearningKey(connection.id), known)
    )
  }

  /** A connection's events starting in a span, of the calendars the user keeps shown. */
  private async eventsOf(connectionId: string, from: number, to: number): Promise<CalendarEvent[]> {
    const { calendar } = this.deps
    const [events, calendars] = await Promise.all([
      calendar.events(new Date(from).toISOString(), new Date(to).toISOString()),
      calendar.calendars()
    ])
    const hidden = new Set(calendars.filter((entry) => entry.hidden).map((entry) => entry.key))

    return events.filter((event) => {
      const start = eventStart(event)
      return (
        event.connectionId === connectionId &&
        !hidden.has(`${event.connectionId}\u0000${event.calendarId}`) &&
        start >= from &&
        start < to
      )
    })
  }

  /**
   * A setup that turned the AI on is over: the day it promised is written now, whatever the
   * hour, unless today has its letter already. It is the day's letter: the morning has no other.
   */
  async writeDayNow(): Promise<void> {
    const today = localDay()

    if (
      (await this.deps.registry.day.letter(today)) ||
      (await this.deps.queue.busy(`giornata:${today}`))
    ) {
      return
    }

    await this.deps.queue.enqueue({
      task: 'giornata',
      scopeKey: `giornata:${today}`,
      scope: { refresh: false },
      priority: PRIORITY.day
    })
    this.scheduler.wake()
  }

  /**
   * Whether today's letter is behind: written more than `olderThan` ago, and
   * something open changed since — not by the day's run itself.
   */
  async letterBehind(olderThan: number): Promise<boolean> {
    const letter = await this.deps.registry.day.letter(localDay())
    return (
      letter !== null &&
      Date.now() - letter.writtenAt > olderThan &&
      (await this.deps.registry.commitments.changedSince(letter.writtenAt))
    )
  }

  /** Whether the day is being looked at, or about to be. */
  async dayInProgress(): Promise<boolean> {
    const today = localDay()
    return (
      (await this.deps.queue.inProgress(`giornata:${today}`)) ||
      (await this.deps.queue.inProgress(`giornata-agg:${today}`))
    )
  }

  /** Whether the day is being looked at, about to be, or a look at it failed for good lately: not asked for again. */
  async dayBusy(): Promise<boolean> {
    const today = localDay()
    return (
      (await this.deps.queue.busy(`giornata:${today}`)) ||
      (await this.deps.queue.busy(`giornata-agg:${today}`))
    )
  }

  /** The user asked to look at the day again now. */
  async refreshDay(): Promise<void> {
    // Being looked at again already: once is enough.
    if (await this.deps.queue.inProgress(`giornata-agg:${localDay()}`)) {
      this.scheduler.wake()
      return
    }

    await this.deps.queue.enqueue({
      task: 'giornata',
      scopeKey: `giornata-agg:${localDay()}`,
      scope: { refresh: true },
      priority: PRIORITY.dayRefresh,
      now: true
    })
    this.scheduler.wake()
  }

  /** The user opened a project whose "Il punto" is behind: it is written again, first. */
  async refreshProject(projectId: string): Promise<void> {
    const scopeKey = `punto:${projectId}`

    // Being written already: what the user opens shows it when it lands.
    if (this.scheduler.runningUnits().some((unit) => unit.scopeKey === scopeKey)) {
      return
    }

    await this.deps.queue.enqueue({
      task: 'punto',
      scopeKey,
      scope: { projectId },
      priority: PRIORITY.dayRefresh,
      now: true
    })
    this.scheduler.wake()
  }

  /**
   * The questions the state answers, each one idempotent: asked again, it
   * queues nothing twice.
   */
  private async plan(): Promise<void> {
    if (!(await this.deps.ready())) {
      return
    }

    const { registry, store, queue, mail } = this.deps
    const now = new Date()
    const today = localDay(now)

    // What was put off until today is open again; what came from mail deleted for good is settled.
    await registry.wakeDeferred(today)
    await registry.settleDeleted()

    const setup = await this.deps.onboarding()
    const hold = setupHold(setup)

    // Messages not read yet, conversation by conversation, each account as far back as it is
    // read; what came now before the backlog.
    const { sinceOf } = await this.horizons()
    const conversations = hold.all
      ? []
      : (await mail.unreadConversations(sinceOf, READING_PLANNED)).filter(
          (conversation) => !hold.mail.has(conversation.accountId)
        )
    const failed = await queue.failedAt(
      conversations.map(
        (conversation) => `lettura:${conversation.accountId}:${conversation.threadId}`
      )
    )

    for (const conversation of conversations) {
      const scopeKey = `lettura:${conversation.accountId}:${conversation.threadId}`

      if (conversation.messages.length === 0) {
        continue
      }

      const newest = Date.parse(conversation.messages[conversation.messages.length - 1].dateIso)
      const oldest = conversation.messages[0].dateIso
      const failedAt = failed.get(scopeKey)

      // A reply prepared before these messages no longer knows them: it is to be looked at again.
      await registry.markRepliesStale(conversation, oldest, 'la conversazione è andata avanti')

      // A conversation whose reading failed waits for "Riprova" — or for what comes after.
      if (failedAt !== undefined && newest <= failedAt) {
        continue
      }

      const recent = newest > now.getTime() - NEW_MAIL_DAYS * DAY_MS
      // A burst is gathered from its newest message on, not from this planning: planning again
      // while the unit waits does not push its start further (a clock ahead waits no longer).
      const burstLeft = Math.min(BURST_MS, Math.max(0, newest + BURST_MS - now.getTime()))

      await queue.enqueue<ReadingScope>({
        task: 'lettura',
        scopeKey,
        scope: {
          accountId: conversation.accountId,
          threadId: conversation.threadId,
          newest: new Date(newest).toISOString()
        },
        priority: recent ? PRIORITY.newMail : PRIORITY.backlog,
        delayMs: recent ? burstLeft : 0
      })
    }

    // The calendars not held back: what of their days it has not looked at yet, as part of the
    // reading.
    await this.planCalendarLooks(hold)

    // Turning the AI on, the rest — the day, the projects, the memory — waits for the setup to
    // be over: it is written from what the reading found.
    if (setup && setupTurnsAiOn(setup)) {
      await queue.prune(7 * DAY_MS)
      this.deps.onStateChange()
      return
    }

    // The morning: once a day, once the day has begun.
    if (now.getHours() >= DAY_STARTS_AT_HOUR) {
      const dayBegan = new Date(now).setHours(DAY_STARTS_AT_HOUR, 0, 0, 0)

      // A build before this one kept no mark: a day's run done since the morning began counts.
      if ((await store.meta(MORNING_DONE)) === null) {
        const last = await store.lastActivityAt('giornata', 'done')

        if (last !== null && last >= dayBegan) {
          await store.setMeta(MORNING_DONE, today)
        }
      }

      if ((await store.meta(MORNING_DONE)) !== today) {
        // Asked once: while it starts, before its run is written down, it is not asked again.
        if (!(await queue.busy(`giornata:${today}`))) {
          await queue.enqueue({
            task: 'giornata',
            scopeKey: `giornata:${today}`,
            scope: { refresh: false },
            priority: PRIORITY.day
          })
        }
      } else if (
        (await this.letterBehind(LETTER_STALE_MS)) &&
        !(await queue.busy(`giornata-agg:${today}`))
      ) {
        await this.refreshDay()
      }
    }

    // The calendar changed elsewhere: once the changes settle, the Segretario looks at those that matter now.
    await this.planCalendar()

    // "Il punto" of a project moved since it was written: at once for one that has none, else
    // once a day, from the morning, those moved lately first. A project the user opens behind
    // has it written then (`refreshProject`): no project is rewritten every time it moves.
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const stale = (await registry.projects.stale())
      .filter(
        (project) =>
          project.stateAt === null ||
          (now.getHours() >= DAY_STARTS_AT_HOUR && project.stateAt < today0)
      )
      .slice(0, PROJECT_STATES_PLANNED)

    for (const project of stale) {
      if (await queue.busy(`punto:${project.id}`)) {
        continue
      }

      await queue.enqueue({
        task: 'punto',
        scopeKey: `punto:${project.id}`,
        scope: { projectId: project.id },
        priority: PRIORITY.project,
        delayMs: 3 * 60_000
      })
    }

    // What the user taught, to take in; the memory, to keep up with the mail.
    const lastReflection = await store.lastActivityAt('riflessione', 'done')

    if (
      (lastReflection === null || now.getTime() - lastReflection > REFLECTION_INTERVAL_MS) &&
      (await store.pendingLessons()).some((lesson) => lesson.kind !== 'confermata') &&
      !(await queue.busy('riflessione'))
    ) {
      await queue.enqueue({
        task: 'riflessione',
        scopeKey: 'riflessione',
        scope: {},
        priority: PRIORITY.memory
      })
    }

    // Keeping the memory in order needs a memory: some connection known through Conoscimi. One
    // left unknown (Conoscimi failed, the user went on without) does not stop it for the rest.
    const learnt = await store.listLearning()
    const accounts = await mail.listAccounts()
    const someKnown = accounts.some((account) =>
      learnt.some((row) => row.accountId === account.id && row.finishedAt !== null)
    )
    const lastKeptUp = Math.max(
      (await store.lastActivityAt('al_passo', 'done')) ?? 0,
      Number((await store.meta(KEEP_UP_CHECKED)) ?? 0)
    )
    // Keeping up waits for the reading to be done: it takes in what the notes say.
    const reading = (await queue.counts()).some(
      (count) => count.task === 'lettura' && count.status !== 'fallito'
    )

    if (
      someKnown &&
      !reading &&
      now.getTime() - lastKeptUp > KEEP_UP_INTERVAL_MS &&
      !(await queue.busy('al_passo'))
    ) {
      await queue.enqueue({
        task: 'al_passo',
        scopeKey: 'al_passo',
        scope: {},
        priority: PRIORITY.memory
      })
    }

    await queue.prune(7 * DAY_MS)
    this.deps.onStateChange()
  }

  /**
   * Hands what changed in the calendar to a look of the Segretario's, once
   * at a time. The point reached moves when a look is done, so what a look
   * that failed did not see is seen by the next; a look that failed waits
   * for "Riprova", or for the calendar to change after it. Changes outside
   * what the calendar holds are passed over; the first time, the past is.
   */
  private async planCalendar(): Promise<void> {
    const { store, calendar, queue } = this.deps
    const seen = await store.meta(CALENDAR_SEEN)

    if (seen === null) {
      await store.setMeta(CALENDAR_SEEN, String(await calendar.latestChangeId()))
      return
    }

    const changes = await calendar.changesSince(Number(seen), CALENDAR_CHANGES_READ)

    if (changes.length === 0) {
      return
    }

    // Nothing among them for the Segretario: seen. Otherwise its look is asked once, and the
    // mark moves when that look is done — one that fails leaves them to the next.
    if (!changes.some((change) => changeHeld(change))) {
      await store.setMeta(CALENDAR_SEEN, String(changes[changes.length - 1].id))
      return
    }

    const failedAt = (await queue.failedAt(['calendario'])).get('calendario')

    if (failedAt !== undefined && !changes.some((change) => change.at > failedAt)) {
      return
    }

    if (!(await queue.inProgress('calendario'))) {
      await queue.enqueue({
        task: 'calendario',
        scopeKey: 'calendario',
        scope: {},
        priority: PRIORITY.calendar,
        delayMs: CALENDAR_SETTLE_MS
      })
    }
  }

  /**
   * Each calendar not held back, the first time, looked at whole — once it
   * has been read: all its window holds — a series once — in blocks, queued
   * together and looked at in parallel, as conversations are. Once every block is done the first
   * look is, and from then on the calendar is looked at by what changes in
   * it. A block that failed stays so, until "Riprova".
   */
  private async planCalendarLooks(hold: SetupHold): Promise<void> {
    const { queue, store } = this.deps
    const { readings } = await this.horizons()

    for (const connection of await this.lookedCalendars(hold)) {
      const key = calendarLearningKey(connection.id)
      const span = readings.get(key)

      // Not read yet — just added, or read anew after an update: nothing to look at until it is.
      if (firstLookDone(span) || connection.lastSyncAt === null) {
        continue
      }

      const units = await queue.within(calendarLookScope(connection.id))

      if (units.some((unit) => unit.status !== 'fatto')) {
        continue
      }

      // Every block done: the first look is, over the window it was planned in.
      if (units.length > 0) {
        const { window } = units[0].scope as LookScope
        await store.setLooked(
          key,
          Math.min(span?.lookedFrom ?? window.from, window.from),
          window.to
        )
        continue
      }

      const window = heldWindow()
      const items = lookItems(
        await this.eventsOf(connection.id, window.from, window.to),
        window.today
      )
      const blocks = unlooked(span, window).flatMap((range) =>
        lookBlocks(items, range, window.today)
      )

      // Nothing in it to look at: looked at as it is, without a run.
      if (blocks.length === 0) {
        await store.setLooked(
          key,
          Math.min(span?.lookedFrom ?? window.from, window.from),
          window.to
        )
        continue
      }

      for (const block of blocks) {
        await queue.enqueue({
          task: 'calendario',
          scopeKey: `${calendarLookScope(connection.id)}${block.from}`,
          scope: { ...block, look: connection.id, window } satisfies LookScope,
          priority: PRIORITY.backlog
        })
      }
    }
  }

  /**
   * A block of a calendar's first look: the things of the window that stand
   * in it — a series once, placed as the look was planned — handed to the
   * calendar's task.
   */
  private async lookAtCalendar(
    block: LookScope,
    workId: string,
    signal: AbortSignal
  ): Promise<void> {
    const connection = (await this.deps.calendar.connections().catch(() => [])).find(
      (candidate) => candidate.id === block.look
    )

    if (!connection) {
      return
    }

    const { window } = block
    const items: LookItem[] = lookItems(
      await this.eventsOf(block.look, window.from, window.to),
      window.today
    ).filter((item) => item.at >= block.from && item.at < block.to)

    if (items.length === 0) {
      return
    }

    const data = prepareCalendarLook(items, connection.label, block.ahead)
    settle(
      await startRun(this.starter, {
        task: 'calendario',
        background: true,
        visibility: 'diario',
        data,
        origin: 'segretario',
        shown: data.title,
        workId,
        scope: { look: block.look },
        signal,
        onCreated: (activityId) => this.deps.queue.attachActivity(workId, activityId)
      })
    )
  }

  /** How each task's units run. */
  private executors(): Record<string, TaskExecutor> {
    const deps = this.deps
    const starter = this.starter

    return {
      lettura: {
        lockKeys: (unit) => readingLockKeys(deps, unit.scope as ReadingScope),
        order: (unit) => {
          const newest = (unit.scope as ReadingScope).newest
          return newest ? Date.parse(newest) : null
        },
        run: async (unit, signal) => {
          const scope = unit.scope as ReadingScope
          const plan = await prepareReading(
            deps,
            scope,
            (await this.horizons()).sinceOf(scope.accountId)
          )

          if (!plan) {
            return
          }

          settle(
            await startRun(starter, {
              task: 'lettura',
              background: true,
              visibility: 'diario',
              data: plan,
              origin: 'segretario',
              shown: plan.title,
              workId: unit.id,
              scope,
              signal,
              missing: () => readingMissing(deps.registry, scope, plan.targets),
              onCreated: (activityId) => deps.queue.attachActivity(unit.id, activityId)
            })
          )
        }
      },
      giornata: {
        lockKeys: async () => ['giornata'],
        run: async (unit, signal) => {
          const refresh = Boolean((unit.scope as { refresh?: boolean }).refresh)
          const today = localDay()
          const begun = Date.now()
          const letter = await deps.registry.day.letter(today)
          const data = prepareDay({ refresh, lastLetterAt: letter?.writtenAt ?? null })
          const startOfDay = new Date()
          startOfDay.setHours(DAY_STARTS_AT_HOUR, 0, 0, 0)

          await settled(
            await startRun(starter, {
              task: 'giornata',
              background: true,
              visibility: 'diario',
              data,
              origin: 'segretario',
              workId: unit.id,
              signal,
              missing: async () => {
                const written = await deps.registry.day.letter(today)
                return written && written.writtenAt >= begun
                  ? null
                  : 'Manca ancora la lettera di oggi: scrivila con `oggi` (`lettera`).'
              },
              onCreated: (activityId) => deps.queue.attachActivity(unit.id, activityId)
            }),
            // The morning's look, done once the day has begun: a refresh, or the day written
            // before dawn at the end of a setup, leaves the morning to come.
            async () => {
              if (!refresh && begun >= startOfDay.getTime()) {
                await deps.store.setMeta(MORNING_DONE, today)
              }
            }
          )
        }
      },
      punto: {
        lockKeys: async (unit) => [`proj:${(unit.scope as { projectId: string }).projectId}`],
        run: async (unit, signal) => {
          const { projectId } = unit.scope as { projectId: string }
          const begun = Date.now()
          const data = await prepareProjectState(deps, projectId)

          if (!data) {
            return
          }

          settle(
            await startRun(starter, {
              task: 'punto',
              background: true,
              visibility: 'diario',
              data,
              origin: 'segretario',
              workId: unit.id,
              signal,
              missing: async () => {
                const project = await deps.registry.projects.get(projectId)
                return !project || (project.stateAt ?? 0) >= begun
                  ? null
                  : 'Manca ancora «Il punto» aggiornato: scrivilo con `progetti` (azione `punto`).'
              },
              onCreated: (activityId) => deps.queue.attachActivity(unit.id, activityId)
            })
          )
        }
      },
      calendario: {
        // The blocks of a first look go in parallel, as conversations do; what changed, one look
        // at a time: changes are few, and they touch one another.
        lockKeys: async (unit) =>
          (unit.scope as Partial<LookScope>).look ? [unit.scopeKey] : ['calendario'],
        run: async (unit, signal) => {
          const block = unit.scope as Partial<LookScope>

          if (block.look) {
            await this.lookAtCalendar(block as LookScope, unit.id, signal)
            return
          }

          // From where the last look that was done left off, as far as one look takes.
          const seen = Number((await deps.store.meta(CALENDAR_SEEN)) ?? 0)
          const all = await deps.calendar.changesSince(seen, CALENDAR_CHANGES_READ)

          if (all.length === 0) {
            return
          }

          const through = all[all.length - 1].id
          const changes = all.filter((change) => changeHeld(change))

          if (changes.length > 0) {
            const data = prepareCalendarChanges(changes)
            settle(
              await startRun(starter, {
                task: 'calendario',
                background: true,
                visibility: 'diario',
                data,
                origin: 'segretario',
                shown: data.title,
                workId: unit.id,
                scope: { after: seen, through },
                signal,
                onCreated: (activityId) => deps.queue.attachActivity(unit.id, activityId)
              })
            )
          }

          await deps.store.setMeta(CALENDAR_SEEN, String(through))
        }
      },
      riflessione: {
        lockKeys: async () => ['memoria'],
        run: async (unit, signal) => {
          const data = await prepareReflection(deps)

          if (!data) {
            return
          }

          const result = await startRun(starter, {
            task: 'riflessione',
            background: true,
            visibility: 'diario',
            data,
            origin: 'segretario',
            workId: unit.id,
            signal,
            onCreated: async (activityId) => {
              await deps.store.claimLessons(data.lessonIds, activityId)
              await deps.queue.attachActivity(unit.id, activityId)
            }
          })

          await deps.store.endReflection(result.activityId, result.status === 'done')
          settle(result)
        }
      },
      al_passo: {
        lockKeys: async () => ['memoria'],
        run: async (unit, signal) => {
          const learnt = await deps.store.listLearning()
          const since =
            (await deps.store.lastActivityAt('al_passo', 'done')) ??
            Math.max(0, ...learnt.map((row) => row.finishedAt ?? 0))
          const data = await prepareKeepingUp(deps, since, KEEP_UP_MIN_NOTES)

          if (!data) {
            // Too little new: looked at again after a while, not at the next planning.
            await deps.store.setMeta(KEEP_UP_CHECKED, String(Date.now()))
            return
          }

          settle(
            await startRun(starter, {
              task: 'al_passo',
              background: true,
              visibility: 'diario',
              data,
              origin: 'segretario',
              workId: unit.id,
              signal,
              onCreated: (activityId) => deps.queue.attachActivity(unit.id, activityId)
            })
          )
        }
      }
    }
  }
}

export type { WorkUnit }
