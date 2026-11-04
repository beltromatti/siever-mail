import { logMainError } from '../../utils/error-utils'
import type { WorkQueue, WorkUnit } from './work-queue'

/** Work at this priority or later is the backlog: it never takes the last free place. */
export const BACKLOG_PRIORITY = 50

/** How long the scheduler sleeps at most between two looks at the queue. */
const IDLE_MS = 60_000

/** How many times a unit is tried before it is left failed. */
const MAX_ATTEMPTS = 3

/** What runs the units of a task. */
export interface TaskExecutor {
  /**
   * What the unit works on: two units holding a key in common never run
   * together — what belongs together is read in turn.
   */
  lockKeys(unit: WorkUnit): Promise<string[]>
  run(unit: WorkUnit, signal: AbortSignal): Promise<void>
}

/** A unit did not do its work. */
export class WorkFailure extends Error {
  constructor(
    message: string,
    /** Worth trying again later. */
    readonly retry: boolean,
    /** Its own fault — counted against it — or the world's (network, provider). */
    readonly counts: boolean
  ) {
    super(message)
    this.name = 'WorkFailure'
  }
}

/** Nothing can run until the user acts: the key was refused, the credit ran out. */
export class EnginePause extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'EnginePause'
  }
}

interface Running {
  unit: WorkUnit
  keys: string[]
  controller: AbortController
  done: Promise<void>
}

/**
 * Runs the Segretario's work from the queue: the most urgent first, as many
 * at once as it is given, never two that hold the same key, and always one
 * place kept for what is not backlog — mail that just came never waits
 * behind a month being read. A failure is tried again later; a pause (the
 * key, the credit) stops everything until it is lifted.
 */
export class Scheduler {
  private readonly running = new Map<string, Running>()
  private readonly held = new Set<string>()
  private loop: Promise<void> | null = null
  private stopped = true
  private pausedFor: string | null = null
  private wakeUp: (() => void) | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly queue: WorkQueue,
    private readonly executors: Readonly<Record<string, TaskExecutor>>,
    private readonly options: {
      /** How many units may run at once now. */
      concurrency: () => number
      /** Something started, finished or failed. */
      onChange?: () => void
      /** The engine paused, or resumed (null). */
      onPause?: (reason: string | null) => void
    }
  ) {}

  /** Starts working; what a quit left running waits again first. */
  async start(): Promise<void> {
    if (!this.stopped) {
      return
    }

    this.stopped = false
    await this.queue.recover()
    this.loop = this.work()
  }

  /** Stops: what runs is interrupted, and waits again for the next start. */
  async stop(): Promise<void> {
    this.stopped = true
    this.nudge()

    for (const running of this.running.values()) {
      running.controller.abort()
    }

    await Promise.allSettled([...this.running.values()].map((running) => running.done))
    await this.loop
    this.loop = null
  }

  /** Something to do may have come: look at the queue now. */
  wake(): void {
    this.nudge()
  }

  get paused(): string | null {
    return this.pausedFor
  }

  /** The user fixed what paused the engine: work goes on. */
  resume(): void {
    if (this.pausedFor !== null) {
      this.pausedFor = null
      this.options.onPause?.(null)
      this.nudge()
    }
  }

  /** The units running now. */
  runningUnits(): WorkUnit[] {
    return [...this.running.values()].map((running) => running.unit)
  }

  /** Stops one unit: its activity was cancelled by the user. */
  cancel(unitId: string): void {
    this.running.get(unitId)?.controller.abort()
  }

  private nudge(): void {
    this.wakeUp?.()
  }

  private async work(): Promise<void> {
    while (!this.stopped) {
      try {
        if (this.pausedFor === null) {
          await this.startWhatCan()
        }
      } catch (error) {
        logMainError('Segretario scheduler failed to look at the queue', error)
      }

      await this.sleep()
    }
  }

  private async startWhatCan(): Promise<void> {
    const capacity = this.options.concurrency()
    let free = capacity - this.running.size

    if (free <= 0) {
      return
    }

    for (const unit of await this.queue.ready(Math.max(free * 6, 12))) {
      if (free <= 0 || this.stopped || this.pausedFor !== null) {
        return
      }

      const executor = this.executors[unit.task]

      if (!executor) {
        await this.queue.cancel(unit.id)
        continue
      }

      if (unit.priority >= BACKLOG_PRIORITY) {
        const backlogRunning = [...this.running.values()].filter(
          (running) => running.unit.priority >= BACKLOG_PRIORITY
        ).length

        if (backlogRunning >= Math.max(capacity - 1, 1)) {
          continue
        }
      }

      let keys: string[]

      try {
        keys = await executor.lockKeys(unit)
      } catch (error) {
        logMainError('Segretario work could not say what it holds', error, { task: unit.task })
        keys = [unit.scopeKey]
      }

      if (keys.some((key) => this.held.has(key)) || !(await this.queue.claim(unit.id))) {
        continue
      }

      free -= 1
      this.begin(unit, executor, keys)
    }
  }

  private begin(unit: WorkUnit, executor: TaskExecutor, keys: string[]): void {
    const controller = new AbortController()

    for (const key of keys) {
      this.held.add(key)
    }

    const done = (async () => {
      try {
        await executor.run(unit, controller.signal)
        await this.queue.complete(unit.id)
      } catch (error) {
        await this.failed(unit, error, controller.signal.aborted)
      } finally {
        for (const key of keys) {
          this.held.delete(key)
        }

        this.running.delete(unit.id)
        this.options.onChange?.()
        this.nudge()
      }
    })()

    this.running.set(unit.id, { unit, keys, controller, done })
    this.options.onChange?.()
  }

  private async failed(unit: WorkUnit, error: unknown, aborted: boolean): Promise<void> {
    if (aborted) {
      // Stopped by a quit or by the user: a quit leaves it to the next start, the user cancels it.
      if (this.stopped) {
        await this.queue.fail(unit.id, 'Interrotto.', {
          retry: true,
          counts: false,
          maxAttempts: MAX_ATTEMPTS
        })
      } else {
        await this.queue.cancel(unit.id)
      }

      return
    }

    if (error instanceof EnginePause) {
      await this.queue.fail(unit.id, error.reason, {
        retry: true,
        counts: false,
        maxAttempts: MAX_ATTEMPTS
      })

      if (this.pausedFor === null) {
        this.pausedFor = error.reason
        this.options.onPause?.(error.reason)
      }

      return
    }

    const failure =
      error instanceof WorkFailure
        ? error
        : new WorkFailure(error instanceof Error ? error.message : String(error), true, true)

    if (!(error instanceof WorkFailure)) {
      logMainError('Segretario work failed', error, { task: unit.task, scope: unit.scopeKey })
    }

    await this.queue.fail(unit.id, failure.message, {
      retry: failure.retry,
      counts: failure.counts,
      maxAttempts: MAX_ATTEMPTS
    })
  }

  /** Sleeps until woken, or until the next unit waiting may start. */
  private async sleep(): Promise<void> {
    if (this.stopped) {
      return
    }

    const next = await this.queue.nextStart().catch(() => null)
    const delay = next === null ? IDLE_MS : Math.min(Math.max(next - Date.now(), 50), IDLE_MS)

    await new Promise<void>((resolve) => {
      this.wakeUp = () => {
        this.wakeUp = null

        if (this.timer) {
          clearTimeout(this.timer)
          this.timer = null
        }

        resolve()
      }
      this.timer = setTimeout(() => this.wakeUp?.(), delay)
    })
  }
}
