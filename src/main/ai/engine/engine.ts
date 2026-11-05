import type {
  ActivityEvent,
  EngineState,
  OnboardingState,
  OnboardingStep,
  ReadingStatus,
  TaskKind
} from '@shared/segretario'

import type { AgentRunner, RunResult } from '../agent/runner'
import type { SegretarioCalendarPort, SegretarioMailPort } from '../agent/tool-types'
import type { AiStore } from '../ai-store'
import type { Notebook } from '../memory/notebook'
import { SegretarioError } from '../openrouter'
import type { Registry } from '../registry/registry'
import { changeMatters, prepareCalendarChanges } from '../tasks/calendar'
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
import { EnginePause, Scheduler, WorkFailure, type TaskExecutor } from './scheduler'
import { WorkQueue, type WorkUnit } from './work-queue'

/** How far back the Segretario reads every message: what is older it reads when it needs to. */
export const READING_HORIZON_DAYS = 30
/** Mail this recent is new mail, read before the backlog; older is the backlog. */
const NEW_MAIL_DAYS = 2
/** How long new mail of a conversation waits for the rest of its burst. */
const BURST_MS = 15_000
const PLAN_EVERY_MS = 20_000
/** Conversations queued at most in one planning. */
const READING_PLANNED = 300

/** Priorities: lower first; at `BACKLOG_PRIORITY` (50) and after, the backlog. */
const PRIORITY = {
  newMail: 10,
  dayRefresh: 15,
  day: 20,
  calendar: 30,
  project: 40,
  memory: 50,
  backlog: 60
} as const

/** Background runs at once, normally and while the first reading is prepared. */
const CONCURRENCY = 4
const PREPARING_CONCURRENCY = 8

/** The day's run waits for the morning: before this hour it is not yet the day. */
const DAY_STARTS_AT_HOUR = 6
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

/** The changes to the calendar a look covers: after one point, through another. */
interface CalendarScope {
  after: number
  through: number
}

export interface EngineDeps {
  store: AiStore
  registry: Registry
  notebook: Notebook
  runner: AgentRunner
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  queue: WorkQueue
  emit(event: ActivityEvent): void
  /** Whether the AI is on and has a key: the engine plans and runs only then. */
  ready(): Promise<boolean>
  /** The guided setup under way, which holds some of the work back (see `plan`). */
  onboarding(): Promise<OnboardingState | null>
  /** What the engine is doing changed. */
  onStateChange(): void
  /** The key was refused or the credit ran out (a reason), or that passed (null). */
  onPause(reason: string | null): void
}

/** A run that did not finish, as the scheduler takes it: a pause, a failure to try again, or not. */
function settle(result: RunResult): void {
  if (result.status === 'done') {
    return
  }

  if (result.status === 'cancelled') {
    throw new WorkFailure('Interrotto.', false, false)
  }

  const error = result.error

  if (error instanceof SegretarioError) {
    // The key or the credit stops everything until the user acts; a request blocked for what it
    // carries (`blocked`) is that work's failure, not every work's.
    if (['no-key', 'invalid-key', 'no-credit'].includes(error.code)) {
      throw new EnginePause(error.message)
    }

    if (['network', 'unavailable', 'rate-limited', 'timeout'].includes(error.code)) {
      throw new WorkFailure(error.message, true, false)
    }
  }

  throw new WorkFailure(error?.message ?? 'Il lavoro non è finito.', true, true)
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
      concurrency: () => (this.preparing ? PREPARING_CONCURRENCY : CONCURRENCY),
      // Work queued before the AI was switched off — or before a restart with it off — waits.
      canStart: () => deps.ready(),
      onChange: () => deps.onStateChange(),
      onPause: (reason) => deps.onPause(reason)
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

  /** The user fixed the key or the credit. */
  resume(): void {
    this.scheduler.resume()
  }

  /** Why the engine is paused (the key, the credit), or null. */
  get paused(): string | null {
    return this.scheduler.paused
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

  /**
   * The AI switched off: what runs stops, and what waits is let go — switched on
   * again, the planning finds from the state what is still to do.
   */
  async switchedOff(): Promise<void> {
    this.cancelRunning()
    await this.deps.queue.cancelWaiting()
    this.deps.onStateChange()
  }

  async state(): Promise<EngineState> {
    const counts = await this.deps.queue.counts()
    const queued: Partial<Record<TaskKind, number>> = {}
    const running: Partial<Record<TaskKind, number>> = {}
    let failed = 0

    for (const count of counts) {
      const task = count.task as TaskKind

      if (count.status === 'al_lavoro') {
        running[task] = (running[task] ?? 0) + count.count
      } else if (count.status === 'fallito') {
        failed += count.count
      } else {
        queued[task] = (queued[task] ?? 0) + count.count
      }
    }

    return {
      paused: this.scheduler.paused,
      reading: await this.deps.mail.readingProgress(this.horizonIso()),
      queued,
      running,
      failed
    }
  }

  /**
   * Where the reading of the last thirty days stands: what is read, what
   * waits, what failed after its attempts — and whether anything but that
   * is left, which the planner would have queued.
   */
  async readingStatus(): Promise<ReadingStatus> {
    const { queue, mail, store } = this.deps
    const counts = (await queue.counts()).filter((count) => count.task === 'lettura')
    const sum = (statuses: ReadonlyArray<string>): number =>
      counts
        .filter((count) => statuses.includes(count.status))
        .reduce((total, count) => total + count.count, 0)
    const failedUnits = (await queue.failed(200)).filter((unit) => unit.task === 'lettura')
    const failedKeys = new Set(failedUnits.map((unit) => unit.scopeKey))
    const unread = await mail.unreadConversations(this.horizonIso(), READING_PLANNED)
    const left = unread.filter(
      (conversation) =>
        !failedKeys.has(`lettura:${conversation.accountId}:${conversation.threadId}`)
    )
    const waiting = sum(['in_coda', 'da_riprovare'])
    const running = sum(['al_lavoro'])
    const failed = await Promise.all(
      failedUnits.map(async (unit) => ({
        title:
          (unit.activityId ? (await store.getActivity(unit.activityId))?.title : null) ??
          'Una conversazione',
        error: unit.lastError
      }))
    )

    return {
      ...(await mail.readingProgress(this.horizonIso())),
      waiting,
      running,
      failed,
      done: waiting === 0 && running === 0 && left.length === 0
    }
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

  /** The user asked to look at the day again now. */
  async refreshDay(): Promise<void> {
    await this.deps.queue.enqueue({
      task: 'giornata',
      scopeKey: `giornata-agg:${localDay()}`,
      scope: { refresh: true },
      priority: PRIORITY.dayRefresh
    })
    this.scheduler.wake()
  }

  /** The user opened a project whose "Il punto" is behind: it is written again, first. */
  async refreshProject(projectId: string): Promise<void> {
    await this.deps.queue.enqueue({
      task: 'punto',
      scopeKey: `punto:${projectId}`,
      scope: { projectId },
      priority: PRIORITY.dayRefresh
    })
    this.scheduler.wake()
  }

  private horizonIso(): string {
    return new Date(Date.now() - READING_HORIZON_DAYS * DAY_MS).toISOString()
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

    // The guided setup under way: Conoscimi comes first, so the reading of its connections
    // waits for it — the reading starts informed.
    // Conoscimi done again by hand holds nothing back: the mail that comes is read meanwhile.
    const setup = await this.deps.onboarding()
    const holding =
      setup !== null && setup.case !== 'conoscimi' && BEFORE_READING.includes(setup.step)
    // A setup for no connection in particular — the AI turned on — is for all of them.
    const held = new Set(holding ? setup.accountIds : [])
    const holdsAll = holding && setup.accountIds.length === 0

    // Messages not read yet, conversation by conversation; what came now before the backlog.
    const conversations = holdsAll
      ? []
      : (await mail.unreadConversations(this.horizonIso(), READING_PLANNED)).filter(
          (conversation) => !held.has(conversation.accountId)
        )
    const failed = await queue.failedSince(
      conversations.map(
        (conversation) => `lettura:${conversation.accountId}:${conversation.threadId}`
      ),
      now.getTime() - DAY_MS
    )

    for (const conversation of conversations) {
      const scopeKey = `lettura:${conversation.accountId}:${conversation.threadId}`

      if (failed.has(scopeKey) || conversation.messages.length === 0) {
        continue
      }

      const newest = Date.parse(conversation.messages[conversation.messages.length - 1].dateIso)
      const oldest = conversation.messages[0].dateIso
      const recent = newest > now.getTime() - NEW_MAIL_DAYS * DAY_MS
      // A burst is gathered from its newest message on, not from this planning: planning again
      // while the unit waits does not push its start further (a clock ahead waits no longer).
      const burstLeft = Math.min(BURST_MS, Math.max(0, newest + BURST_MS - now.getTime()))

      // A reply prepared before these messages no longer knows them: it is to be looked at again.
      await registry.markRepliesStale(conversation, oldest, 'la conversazione è andata avanti')
      await queue.enqueue<ReadingScope>({
        task: 'lettura',
        scopeKey,
        scope: { accountId: conversation.accountId, threadId: conversation.threadId },
        priority: recent ? PRIORITY.newMail : PRIORITY.backlog,
        delayMs: recent ? burstLeft : 0
      })
    }

    // Turning the AI on, the rest — the day, the projects, the memory — waits for the setup to
    // be over: it is written from what the reading found.
    if (setup && setup.case !== 'nuova-connessione' && setup.case !== 'conoscimi') {
      await queue.prune(7 * DAY_MS)
      this.deps.onStateChange()
      return
    }

    // The morning: once a day, once the day has begun.
    if (now.getHours() >= DAY_STARTS_AT_HOUR) {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const lastDay = await store.lastActivityAt('giornata', 'done')

      if (lastDay === null || lastDay < startOfDay) {
        // Asked once: while it starts, before its run is written down, it is not asked again.
        if (!(await queue.busy(`giornata:${today}`))) {
          await queue.enqueue({
            task: 'giornata',
            scopeKey: `giornata:${today}`,
            scope: { refresh: false },
            priority: PRIORITY.day
          })
        }
      } else {
        const letter = await registry.day.letter(today)
        const changed = await registry.commitments.open({ includeDeferred: false })

        if (
          letter &&
          now.getTime() - letter.writtenAt > LETTER_STALE_MS &&
          changed.some((item) => item.updatedAt > letter.writtenAt) &&
          !(await queue.busy(`giornata-agg:${today}`))
        ) {
          await queue.enqueue({
            task: 'giornata',
            scopeKey: `giornata-agg:${today}`,
            scope: { refresh: true },
            priority: PRIORITY.dayRefresh
          })
        }
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

    const learnt = await store.listLearning()
    const accounts = await mail.listAccounts()
    const allKnown =
      accounts.length > 0 &&
      accounts.every((account) =>
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
      allKnown &&
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
   * Hands what changed in the calendar to a look of the Segretario's. The
   * point reached moves as soon as the work is queued — the unit keeps its
   * range, through its retries — so nothing is looked at twice. Changes far
   * from now are passed over; the first time, the past is.
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

    const through = changes[changes.length - 1].id

    if (changes.some((change) => changeMatters(change))) {
      await queue.enqueue<CalendarScope>({
        task: 'calendario',
        scopeKey: 'calendario',
        scope: { after: Number(seen), through },
        priority: PRIORITY.calendar,
        delayMs: CALENDAR_SETTLE_MS,
        merge: (waiting, incoming) => ({
          after: Math.min(waiting.after, incoming.after),
          through: Math.max(waiting.through, incoming.through)
        })
      })
    }

    await store.setMeta(CALENDAR_SEEN, String(through))
  }

  /** How each task's units run. */
  private executors(): Record<string, TaskExecutor> {
    const deps = this.deps
    const starter = this.starter

    return {
      lettura: {
        lockKeys: (unit) => readingLockKeys(deps, unit.scope as ReadingScope),
        run: async (unit, signal) => {
          const scope = unit.scope as ReadingScope
          const plan = await prepareReading(deps, scope, this.horizonIso())

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

          settle(
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
            })
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
        lockKeys: async () => ['calendario'],
        run: async (unit, signal) => {
          const scope = unit.scope as CalendarScope
          const changes = (
            await deps.calendar.changesSince(scope.after, CALENDAR_CHANGES_READ * 3)
          ).filter((change) => change.id <= scope.through && changeMatters(change))

          if (changes.length === 0) {
            return
          }

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
              scope,
              signal,
              onCreated: (activityId) => deps.queue.attachActivity(unit.id, activityId)
            })
          )
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
