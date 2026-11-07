/** While OpenRouter does not answer, the waits between tries, growing. */
const WAITS_MS = [30_000, 60_000, 120_000, 300_000]

/**
 * Whether OpenRouter answers, as every run and the scheduler see it. A run
 * that cannot reach the model does not fail: it waits here and takes up the
 * same step again — the work goes on from where it was, however long the
 * network or the provider stay away. While they do, the waits grow, the
 * scheduler starts one unit at a time, and the interface says until when;
 * the first call that gets through ends the wait for everyone.
 */
export class Reachability {
  private state: { since: number; tries: number; until: number } | null = null
  private readonly sleepers = new Set<() => void>()

  constructor(private readonly onChange: () => void = () => undefined) {}

  /** Since when, and until when, the work waits for OpenRouter to answer. */
  get waiting(): { since: number; until: number } | null {
    return this.state ? { since: this.state.since, until: this.state.until } : null
  }

  /** Whether a new unit may start now: always, but while waiting, only once the wait is over. */
  get open(): boolean {
    return this.state === null || Date.now() >= this.state.until
  }

  /**
   * A call did not reach the model: the wait grows — once for the calls that
   * fail together, those made before the wait began failing with it.
   */
  failed(startedAt: number): void {
    if (this.state && startedAt < this.state.since) {
      return
    }

    const tries = (this.state?.tries ?? 0) + 1
    this.state = {
      since: this.state?.since ?? Date.now(),
      tries,
      until: Date.now() + WAITS_MS[Math.min(tries, WAITS_MS.length) - 1]
    }
    this.onChange()
  }

  /** A call got through: nobody waits any more. */
  answered(): void {
    if (this.state) {
      this.state = null
      this.wakeAll()
      this.onChange()
    }
  }

  /** The computer is back online, or awake: the next try is now. */
  online(): void {
    if (this.state) {
      this.state.until = Date.now()
      this.wakeAll()
      this.onChange()
    }
  }

  /** Until the next try — or the end of the wait — or the signal stops the run. */
  async wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const delay = this.state ? this.state.until - Date.now() : 0

    if (delay <= 0) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const settle = (): void => {
        clearTimeout(timer)
        this.sleepers.delete(wake)
        signal.removeEventListener('abort', aborted)
      }
      const wake = (): void => {
        settle()
        resolve()
      }
      const aborted = (): void => {
        settle()
        reject(signal.reason)
      }
      const timer = setTimeout(wake, delay)
      this.sleepers.add(wake)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }

  private wakeAll(): void {
    for (const wake of [...this.sleepers]) {
      wake()
    }
  }
}
