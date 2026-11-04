import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { EnginePause, Scheduler, WorkFailure, type TaskExecutor } from './scheduler'
import { WorkQueue, type WorkUnit } from './work-queue'

type Scope = { threads: string[] }

describe('WorkQueue', () => {
  let sql: ReturnType<typeof memorySql>
  let queue: WorkQueue

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    queue = new WorkQueue(sql)
  })

  afterEach(() => sql.close())

  it('gathers what comes for the same scope into the unit that waits', async () => {
    const merge = (a: Scope, b: Scope): Scope => ({
      threads: [...new Set([...a.threads, ...b.threads])]
    })
    const first = await queue.enqueue<Scope>({
      task: 'lettura',
      scopeKey: 'k',
      scope: { threads: ['t1'] },
      priority: 60,
      merge
    })
    const second = await queue.enqueue<Scope>({
      task: 'lettura',
      scopeKey: 'k',
      scope: { threads: ['t2'] },
      priority: 10,
      delayMs: 5_000,
      merge
    })

    expect(second.id).toBe(first.id)
    expect(second.scope.threads).toEqual(['t1', 't2'])
    expect(second.priority).toBe(10)
    expect(second.notBefore).toBeGreaterThan(first.notBefore)
  })

  it('queues anew what comes for a scope already running', async () => {
    const first = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    expect(await queue.claim(first.id)).toBe(true)
    expect(await queue.claim(first.id)).toBe(false)

    const second = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    expect(second.id).not.toBe(first.id)
  })

  it('tries a failure again, does not count the network, and leaves it failed after three', async () => {
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })

    await queue.claim(unit.id)
    expect(await queue.fail(unit.id, 'rete', { retry: true, counts: false, maxAttempts: 3 })).toBe(
      'da_riprovare'
    )
    expect((await queue.get(unit.id))?.attempts).toBe(0)

    for (const expected of ['da_riprovare', 'da_riprovare', 'fallito']) {
      await sql.run('UPDATE ai_work SET not_before = 0 WHERE id = ?', unit.id)
      await queue.claim(unit.id)
      expect(
        await queue.fail(unit.id, 'nota mancante', { retry: true, counts: true, maxAttempts: 3 })
      ).toBe(expected)
    }

    expect(await queue.failedSince(['k'], 0)).toEqual(new Set(['k']))
    await queue.retryFailed()
    expect((await queue.get(unit.id))?.status).toBe('in_coda')
  })

  it('puts back what a quit left running', async () => {
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    await queue.claim(unit.id)

    expect(await queue.recover()).toBe(1)
    expect(await queue.get(unit.id)).toMatchObject({ status: 'in_coda', attempts: 0 })
  })
})

describe('Scheduler', () => {
  let sql: ReturnType<typeof memorySql>
  let queue: WorkQueue
  let scheduler: Scheduler | null

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    queue = new WorkQueue(sql)
    scheduler = null
  })

  afterEach(async () => {
    await scheduler?.stop()
    sql.close()
  })

  /** An executor whose runs wait until released, recording what ran together. */
  function gatedExecutor(keysOf: (unit: WorkUnit) => string[]): TaskExecutor & {
    started: string[]
    release(scopeKey: string): void
    maxTogether: number
  } {
    const gates = new Map<string, () => void>()
    let current = 0
    const executor = {
      started: [] as string[],
      maxTogether: 0,
      release(scopeKey: string) {
        gates.get(scopeKey)?.()
      },
      lockKeys: async (unit: WorkUnit) => keysOf(unit),
      run: async (unit: WorkUnit) => {
        executor.started.push(unit.scopeKey)
        current += 1
        executor.maxTogether = Math.max(executor.maxTogether, current)
        await new Promise<void>((resolve) => gates.set(unit.scopeKey, resolve))
        current -= 1
      }
    }
    return executor
  }

  async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      if (await condition()) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    throw new Error('Timed out')
  }

  it('never runs together two units that hold the same key', async () => {
    const executor = gatedExecutor((unit) => [(unit.scope as { project: string }).project])
    scheduler = new Scheduler(queue, { lettura: executor }, { concurrency: () => 4 })
    await queue.enqueue({ task: 'lettura', scopeKey: 'a', scope: { project: 'p1' }, priority: 10 })
    await queue.enqueue({ task: 'lettura', scopeKey: 'b', scope: { project: 'p1' }, priority: 10 })
    await queue.enqueue({ task: 'lettura', scopeKey: 'c', scope: { project: 'p2' }, priority: 10 })
    await scheduler.start()

    await until(() => executor.started.length === 2)
    expect(executor.started.sort()).toEqual(['a', 'c'])
    executor.release('a')
    await until(() => executor.started.length === 3)
    expect(executor.started).toContain('b')
    executor.release('b')
    executor.release('c')
    await until(async () => (await queue.counts()).length === 0)
  })

  it('keeps a place for new mail while the backlog is read', async () => {
    const executor = gatedExecutor((unit) => [unit.scopeKey])
    scheduler = new Scheduler(queue, { lettura: executor }, { concurrency: () => 2 })

    for (const key of ['old1', 'old2', 'old3']) {
      await queue.enqueue({ task: 'lettura', scopeKey: key, scope: {}, priority: 60 })
    }

    await scheduler.start()
    await until(() => executor.started.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(executor.started).toEqual(['old1'])

    await queue.enqueue({ task: 'lettura', scopeKey: 'new', scope: {}, priority: 10 })
    scheduler.wake()
    await until(() => executor.started.includes('new'))

    for (const key of ['old1', 'new', 'old2', 'old3']) {
      executor.release(key)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })

  it('pauses everything when the key is refused, and goes on once resumed', async () => {
    let refuse = true
    const ran: string[] = []
    let paused: string | null = null
    scheduler = new Scheduler(
      queue,
      {
        lettura: {
          lockKeys: async (unit) => [unit.scopeKey],
          run: async (unit) => {
            if (refuse) {
              throw new EnginePause('Chiave non valida')
            }

            ran.push(unit.scopeKey)
          }
        }
      },
      { concurrency: () => 1, onPause: (reason) => (paused = reason) }
    )
    await queue.enqueue({ task: 'lettura', scopeKey: 'a', scope: {}, priority: 10 })
    await scheduler.start()

    await until(() => paused !== null)
    expect(paused).toBe('Chiave non valida')
    refuse = false
    await sql.run('UPDATE ai_work SET not_before = 0')
    scheduler.resume()
    await until(() => ran.length === 1)
  })

  it('records a failure and tries again', async () => {
    let calls = 0
    scheduler = new Scheduler(
      queue,
      {
        lettura: {
          lockKeys: async () => [],
          run: async () => {
            calls += 1
            throw new WorkFailure('Manca la nota di m2', true, true)
          }
        }
      },
      { concurrency: () => 1 }
    )
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'a', scope: {}, priority: 10 })
    await scheduler.start()

    await until(async () => (await queue.get(unit.id))?.status === 'da_riprovare')
    expect(calls).toBe(1)
    expect((await queue.get(unit.id))?.lastError).toBe('Manca la nota di m2')
  })
})
