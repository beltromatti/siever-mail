import { logMainError } from '../../utils/error-utils'
import type { Reachability } from './reachability'
import type { WorkQueue, WorkUnit } from './work-queue'

/** Work at this priority or later is the backlog: it never takes the last free place. */
export const BACKLOG_PRIORITY = 50

/** How long the scheduler sleeps at most between two looks at the queue. */
const IDLE_MS = 60_000

/** How far down the waiting work one look goes, past what a key in use holds up. */
const MAX_SCANNED = 120

/** What runs the units of a task. */
export interface TaskExecutor {
  /**
   * What the unit works on: two units holding a key in common never run
   * together — what belongs together is read in turn.
   */
  lockKeys(unit: WorkUnit): Promise<string[]>
  /**
   * Where the unit's matter stands in time, when that orders it: of two
   * units sharing a lane, the earlier goes first — who reads after sees
   * what was opened before.
   */
  order?(unit: WorkUnit): number | null
  run(unit: WorkUnit, signal: AbortSignal): Promise<void>
}

/**
 * A unit did not do its work, and is left failed — not tried again by
 * itself: later it may no longer be of use. Where it shows, the user tries
 * it again, or goes on without the AI; new facts on the same matter are new
 * work (see `WorkQueue.complete`).
 */
export class WorkFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkFailure'
  }
}

/**
 * OpenRouter refused the key or the credit: the AI goes off (the
 * Segretario's service turns it off), and nothing more starts meanwhile.
 */
export class KeyRefused extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'KeyRefused'
  }
}

interface Running {
  unit: WorkUnit
  keys: string[]
  controller: AbortController
  /** Why it was stopped, when it was: the user cancelled it, or the computer went to sleep. */
  stoppedBy: 'user' | 'sleep' | null
  startedAt: number
  done: Promise<void>
}

/**
 * Runs the Segretario's work from the queue: the most urgent first, as many
 * at once as it is given, never two that hold the same key, and always one
 * place kept for what is not backlog — mail that just came never waits
 * behind a month being read. A unit that fails stays failed; while
 * OpenRouter does not answer, the runs wait for it and one unit at a time
 * starts (`Reachability`); a key or a credit refused stops everything — the
 * AI goes off — and so does the computer's sleep, until it wakes.
 */
export class Scheduler {
  private readonly running = new Map<string, Running>()
  private readonly held = new Set<string>()
  private loop: Promise<void> | null = null
  private stopped = true
  /** A run met a refused key or credit: nothing starts until the AI is turned off, or on again. */
  private refused = false
  private asleep = false
  private wakeUp: (() => void) | null = null
  /** Woken while awake: the next sleep does not happen. */
  private nudged = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly queue: WorkQueue,
    private readonly executors: Readonly<Record<string, TaskExecutor>>,
    private readonly options: {
      /** Whether OpenRouter answers: while it does not, one unit at a time starts. */
      reachability: Reachability
      /** How many units may run at once now. */
      concurrency: () => number
      /** Whether anything may start now at all: the AI on, with a key. */
      canStart?: () => Promise<boolean>
      /**
       * What may not start yet, asked once a look at the queue: a unit it
       * names stays queued, whoever queued it, and starts once let through.
       */
      holding?: () => Promise<((unit: WorkUnit) => boolean) | null>
      /** Something started, finished or failed. */
      onChange?: () => void
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

  /** Since when, and until when, the work waits for OpenRouter to answer. */
  get waitingForNetwork(): { since: number; until: number } | null {
    return this.options.reachability.waiting
  }

  /** The AI was turned off, or on again: a refusal holds nothing back any more. */
  reset(): void {
    if (this.refused) {
      this.refused = false
      this.nudge()
    }
  }

  /**
   * The computer goes to sleep, or wakes. Asleep, nothing starts — the few seconds macOS wakes
   * for now and then are no time for a run — and what runs stops and waits again, not counted
   * against it: cut off by the sleep, it would only time out at the next wake.
   */
  setAsleep(asleep: boolean): void {
    if (asleep === this.asleep) {
      return
    }

    this.asleep = asleep

    if (asleep) {
      for (const running of this.running.values()) {
        running.stoppedBy = 'sleep'
        running.controller.abort()
      }
    } else {
      // Awake, the connection is likely back too: what waited for it tries at once.
      this.options.reachability.online()
      this.nudge()
    }
  }

  /** The units running now. */
  runningUnits(): WorkUnit[] {
    return [...this.running.values()].map((running) => running.unit)
  }

  /** Stops the units running on what is going away (a removed account), and waits for them to stop. */
  async stopWhere(going: (unit: WorkUnit) => boolean): Promise<void> {
    const stopping = [...this.running.values()].filter((running) => going(running.unit))

    for (const running of stopping) {
      running.stoppedBy = 'user'
      running.controller.abort()
    }

    await Promise.allSettled(stopping.map((running) => running.done))
  }

  /** Stops one unit: its activity was cancelled by the user. */
  cancel(unitId: string): void {
    const running = this.running.get(unitId)

    if (running) {
      running.stoppedBy = 'user'
      running.controller.abort()
    }
  }

  private nudge(): void {
    if (this.wakeUp) {
      this.wakeUp()
    } else {
      // The loop is looking at the queue: what changed meanwhile is looked at again at once.
      this.nudged = true
    }
  }

  private async work(): Promise<void> {
    while (!this.stopped) {
      try {
        if (
          !this.refused &&
          !this.asleep &&
          (await (this.options.canStart?.() ?? Promise.resolve(true)))
        ) {
          await this.startWhatCan()
        }
      } catch (error) {
        logMainError('Segretario scheduler failed to look at the queue', error)
      }

      await this.sleep()
    }
  }

  private async startWhatCan(): Promise<void> {
    const { reachability } = this.options

    if (!reachability.open) {
      return
    }

    // Waiting for OpenRouter, one unit tries; the rest follow once it answers.
    const capacity = reachability.waiting ? 1 : this.options.concurrency()
    let free = capacity - this.running.size

    if (free <= 0) {
      return
    }

    const held = (await this.options.holding?.()) ?? null
    // The most urgent first; past those held up by a key in use — a sender's twenty notices
    // read one by one — to the rest, so one lane never holds every other.
    const page = Math.max(free * 6, 12)
    const lanes = new Map<string, string[]>()
    const claimed = new Set<string>()
    const keysOf = async (unit: WorkUnit): Promise<string[]> => {
      const known = lanes.get(unit.id)

      if (known) {
        return known
      }

      let keys: string[]

      try {
        keys = await this.executors[unit.task].lockKeys(unit)
      } catch (error) {
        logMainError('Segretario work could not say what it holds', error, { task: unit.task })
        keys = [unit.scopeKey]
      }

      lanes.set(unit.id, keys)
      return keys
    }
    // A unit gives way to an earlier one of its lane waiting in the same page — one at least as
    // urgent: new mail does not wait for the backlog.
    let looked: WorkUnit[] = []
    const earlierInLane = async (unit: WorkUnit, keys: ReadonlyArray<string>): Promise<boolean> => {
      const order = this.executors[unit.task].order?.(unit) ?? null

      if (order === null) {
        return false
      }

      for (const other of looked) {
        // One held back is not waited for: it would hold its lane until let through.
        const otherOrder =
          other.id === unit.id ||
          claimed.has(other.id) ||
          other.priority > unit.priority ||
          held?.(other)
            ? null
            : (this.executors[other.task]?.order?.(other) ?? null)

        if (
          otherOrder !== null &&
          otherOrder < order &&
          (await keysOf(other)).some((key) => keys.includes(key))
        ) {
          return true
        }
      }

      return false
    }

    for (let offset = 0; free > 0 && offset < MAX_SCANNED; offset += page) {
      const units = await this.queue.ready(page, Date.now(), offset)

      if (units.length === 0) {
        return
      }

      looked = units

      for (const unit of units) {
        if (free <= 0 || this.stopped || this.refused || this.asleep) {
          return
        }

        const executor = this.executors[unit.task]

        if (!executor) {
          await this.queue.cancel(unit.id)
          continue
        }

        if (held?.(unit)) {
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

        const keys = await keysOf(unit)

        if (keys.some((key) => this.held.has(key)) || (await earlierInLane(unit, keys))) {
          continue
        }

        if (!(await this.queue.claim(unit.id))) {
          continue
        }

        claimed.add(unit.id)

        free -= 1
        this.begin(unit, executor, keys)
      }
    }
  }

  private begin(unit: WorkUnit, executor: TaskExecutor, keys: string[]): void {
    const controller = new AbortController()
    const running: Running = {
      unit,
      keys,
      controller,
      stoppedBy: null,
      startedAt: Date.now(),
      done: Promise.resolve()
    }

    for (const key of keys) {
      this.held.add(key)
    }

    running.done = (async () => {
      try {
        await executor.run(unit, controller.signal)
        await this.queue.complete(unit.id)
      } catch (error) {
        await this.failed(running, error)
      } finally {
        for (const key of keys) {
          this.held.delete(key)
        }

        this.running.delete(unit.id)
        this.options.onChange?.()
        this.nudge()
      }
    })()

    this.running.set(unit.id, running)
    this.options.onChange?.()
  }

  private async failed(running: Running, error: unknown): Promise<void> {
    const { unit } = running

    if (running.controller.signal.aborted) {
      // Stopped by a quit, the sleep or the user: a quit or the sleep leaves it to wait again,
      // the user cancels it.
      if (this.stopped || running.stoppedBy === 'sleep') {
        await this.queue.fail(unit.id, 'Interrotto.', { retry: true })
      } else {
        await this.queue.cancel(unit.id)
      }

      return
    }

    if (error instanceof KeyRefused) {
      await this.queue.fail(unit.id, error.reason, { retry: true })
      this.refused = true
      return
    }

    if (!(error instanceof WorkFailure)) {
      logMainError('Segretario work failed', error, { task: unit.task, scope: unit.scopeKey })
    }

    await this.queue.fail(unit.id, error instanceof Error ? error.message : String(error), {
      retry: false
    })
  }

  /** Sleeps until woken, or until the next unit waiting may start. */
  private async sleep(): Promise<void> {
    if (this.stopped || this.nudged) {
      this.nudged = false
      return
    }

    // Until the next unit whose time comes — one ready already but held (no room, its lane
    // taken) starts when what holds it ends, which wakes the loop — or the network wait ends.
    const now = Date.now()
    const next = await this.queue.nextStart().catch(() => null)
    const due = [
      next !== null && next > now ? next : null,
      this.options.reachability.waiting?.until ?? null
    ].filter((at): at is number => at !== null && at > now)
    const delay =
      due.length === 0 ? IDLE_MS : Math.min(Math.max(Math.min(...due) - now, 50), IDLE_MS)

    // Woken while the queue was asked when next: awake.
    if (this.nudged) {
      this.nudged = false
      return
    }

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
