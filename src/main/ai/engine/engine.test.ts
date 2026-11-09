import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The engine reaches Electron through what its runs read (PDF pages, files): not these tests.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
  shell: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import type { CalendarEvent } from '@shared/calendar'
import type { OnboardingState } from '@shared/segretario'
import { AiStore } from '../ai-store'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import {
  calendarLookScope,
  connectionHeld,
  SegretarioEngine,
  setupHold,
  type EngineDeps
} from './engine'
import { Reachability } from './reachability'
import { KeyRefused, Scheduler, WorkFailure, type TaskExecutor } from './scheduler'
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

  it('puts back what was cut short, and leaves a failure failed until it is tried again', async () => {
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })

    await queue.claim(unit.id)
    expect(await queue.fail(unit.id, 'Interrotto.', { retry: true })).toBe('da_riprovare')
    expect((await queue.get(unit.id))?.attempts).toBe(0)

    await queue.claim(unit.id)
    expect(await queue.fail(unit.id, 'Mi sono fermato.', { retry: false })).toBe('fallito')
    // Not tried again by itself, however long it waits: only when the user says so.
    await sql.run('UPDATE ai_work SET updated_at = 0 WHERE id = ?', unit.id)
    await queue.prune(0)
    expect(await queue.busy('k')).toBe(true)
    expect([...(await queue.failedAt(['k'])).keys()]).toEqual(['k'])
    expect(await queue.ready(10)).toEqual([])

    expect((await queue.failed('lettura')).map(({ id }) => id)).toEqual([unit.id])
    await queue.retryFailed([unit.id])
    expect((await queue.get(unit.id))?.status).toBe('in_coda')
  })

  it('lets new work on the same matter settle an earlier failure when it is done', async () => {
    const failed = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    await queue.claim(failed.id)
    await queue.fail(failed.id, 'Mi sono fermato.', { retry: false })

    const next = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    await queue.claim(next.id)
    await queue.complete(next.id)

    expect((await queue.get(failed.id))?.status).toBe('annullato')
    expect(await queue.busy('k')).toBe(false)
  })

  it('takes away the failures of what goes away, and keeps them when the AI only goes off', async () => {
    const unit = await queue.enqueue({
      task: 'lettura',
      scopeKey: 'lettura:a1:t1',
      scope: {},
      priority: 10
    })
    await queue.claim(unit.id)
    await queue.fail(unit.id, 'Mi sono fermato.', { retry: false })

    await queue.cancelWaiting()
    expect((await queue.get(unit.id))?.status).toBe('fallito')

    await queue.cancelWaiting({ scopePrefix: 'lettura:a1:' })
    expect((await queue.get(unit.id))?.status).toBe('annullato')
  })

  it('lets the unit that waits take the place of one that failed for the same scope', async () => {
    const running = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    await queue.claim(running.id)
    const waiting = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })

    expect(await queue.fail(running.id, 'Interrotto.', { retry: true })).toBe('da_riprovare')
    expect((await queue.get(running.id))?.status).toBe('annullato')
    expect(await queue.get(waiting.id)).toMatchObject({
      status: 'in_coda',
      lastError: 'Interrotto.'
    })
  })

  it('tries again one unit for each scope, and leaves alone a scope that just failed', async () => {
    const fail = async (): Promise<string> => {
      const unit = await queue.enqueue({ task: 'punto', scopeKey: 'p', scope: {}, priority: 30 })
      await queue.claim(unit.id)
      await queue.fail(unit.id, 'no', { retry: false })
      return unit.id
    }
    const ids = [await fail(), await fail()]

    expect(await queue.busy('p')).toBe(true)
    expect(await queue.retryFailed(ids)).toBe(1)

    const statuses = (
      await sql.all<{ status: string }>("SELECT status FROM ai_work WHERE scope_key = 'p'")
    )
      .map((row) => row.status)
      .sort()
    expect(statuses).toEqual(['annullato', 'in_coda'])
  })

  it('puts back what a quit left running', async () => {
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    await queue.claim(unit.id)

    expect(await queue.recover()).toBe(1)
    expect(await queue.get(unit.id)).toMatchObject({ status: 'in_coda', attempts: 0 })
  })

  it('lets the unit that waits do the work a quit cut short for the same scope', async () => {
    const running = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })
    await queue.claim(running.id)
    const waiting = await queue.enqueue({ task: 'lettura', scopeKey: 'k', scope: {}, priority: 10 })

    await queue.recover()

    expect(await queue.get(running.id)).toBeNull()
    expect(await queue.get(waiting.id)).toMatchObject({ status: 'in_coda' })
  })
})

describe('Scheduler', () => {
  let sql: ReturnType<typeof memorySql>
  let queue: WorkQueue
  let scheduler: Scheduler | null
  let reachability: Reachability

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    queue = new WorkQueue(sql)
    scheduler = null
    reachability = new Reachability()
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

  it('lets the sleep stop what runs, uncounted, and start nothing until the computer wakes', async () => {
    let runs = 0
    const executor: TaskExecutor = {
      lockKeys: async (unit) => [unit.scopeKey],
      run: async (_unit, signal) => {
        runs += 1
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Interrotto.')))
        )
      }
    }
    scheduler = new Scheduler(queue, { giornata: executor }, { reachability, concurrency: () => 2 })
    const unit = await queue.enqueue({ task: 'giornata', scopeKey: 'g', scope: {}, priority: 20 })
    await scheduler.start()
    await until(() => runs === 1)

    scheduler.setAsleep(true)
    await until(async () => (await queue.get(unit.id))?.status === 'da_riprovare')
    expect((await queue.get(unit.id))?.attempts).toBe(0)

    scheduler.wake()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runs).toBe(1)

    scheduler.setAsleep(false)
    await until(() => runs === 2)
  })

  it('goes past the units a key in use holds up, so one sender never holds every other', async () => {
    const started: string[] = []
    const executor: TaskExecutor = {
      lockKeys: async (unit) => [(unit.scope as { sender: string }).sender],
      run: async (unit, signal) => {
        started.push(unit.scopeKey)
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Interrotto.')))
        )
      }
    }
    scheduler = new Scheduler(queue, { lettura: executor }, { reachability, concurrency: () => 2 })

    for (let n = 0; n < 18; n += 1) {
      await queue.enqueue({
        task: 'lettura',
        scopeKey: `noreply-${n}`,
        scope: { sender: 'noreply' },
        priority: 10
      })
    }
    await queue.enqueue({
      task: 'lettura',
      scopeKey: 'anna',
      scope: { sender: 'anna' },
      priority: 10
    })
    await scheduler.start()

    await until(() => started.includes('anna'))
    expect(started.filter((key) => key.startsWith('noreply'))).toHaveLength(1)
  })

  it('never runs together two units that hold the same key', async () => {
    const executor = gatedExecutor((unit) => [(unit.scope as { project: string }).project])
    scheduler = new Scheduler(queue, { lettura: executor }, { reachability, concurrency: () => 4 })
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

  it('reads a lane from its oldest conversation, even when the newest came first', async () => {
    const executor = {
      ...gatedExecutor((unit) => [(unit.scope as { who: string }).who]),
      order: (unit: WorkUnit) => Date.parse((unit.scope as { newest: string }).newest)
    }
    scheduler = new Scheduler(queue, { lettura: executor }, { reachability, concurrency: () => 4 })
    // Queued newest first, as the planner does: Rossi's later conversation, then his earlier one.
    await queue.enqueue({
      task: 'lettura',
      scopeKey: 'rossi-ricevuto',
      scope: { who: 'rossi', newest: '2026-11-04T10:00:00Z' },
      priority: 60
    })
    await queue.enqueue({
      task: 'lettura',
      scopeKey: 'rossi-richiesta',
      scope: { who: 'rossi', newest: '2026-11-02T10:00:00Z' },
      priority: 60
    })
    await scheduler.start()

    await until(() => executor.started.length === 1)
    expect(executor.started).toEqual(['rossi-richiesta'])
    executor.release('rossi-richiesta')
    await until(() => executor.started.length === 2)
    expect(executor.started).toEqual(['rossi-richiesta', 'rossi-ricevuto'])
    executor.release('rossi-ricevuto')
  })

  it('starts one unit at a time while OpenRouter does not answer, and the rest once it does', async () => {
    const executor = gatedExecutor((unit) => [unit.scopeKey])
    scheduler = new Scheduler(queue, { lettura: executor }, { reachability, concurrency: () => 4 })

    for (const key of ['a', 'b', 'c']) {
      await queue.enqueue({ task: 'lettura', scopeKey: key, scope: {}, priority: 10 })
    }

    // A run found OpenRouter away: until the wait is over, nothing new starts.
    reachability.failed(Date.now())
    await scheduler.start()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(executor.started).toEqual([])
    expect(scheduler.waitingForNetwork).not.toBeNull()

    // The wait over, one tries.
    reachability.online()
    scheduler.wake()
    await until(() => executor.started.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(executor.started).toHaveLength(1)

    // It got through: the rest follow.
    reachability.answered()
    scheduler.wake()
    await until(() => executor.started.length === 3)
    expect(scheduler.waitingForNetwork).toBeNull()

    for (const key of ['a', 'b', 'c']) {
      executor.release(key)
    }
  })

  it('keeps a place for new mail while the backlog is read', async () => {
    const executor = gatedExecutor((unit) => [unit.scopeKey])
    scheduler = new Scheduler(queue, { lettura: executor }, { reachability, concurrency: () => 2 })

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

  it('starts nothing more once the key or the credit is refused, until the AI goes off or on again', async () => {
    let refuse = true
    let refused = 0
    const ran: string[] = []
    scheduler = new Scheduler(
      queue,
      {
        lettura: {
          lockKeys: async (unit) => [unit.scopeKey],
          run: async (unit) => {
            if (refuse) {
              refused += 1
              throw new KeyRefused('Il credito OpenRouter è finito.')
            }

            ran.push(unit.scopeKey)
          }
        }
      },
      { reachability, concurrency: () => 1 }
    )
    await queue.enqueue({ task: 'lettura', scopeKey: 'a', scope: {}, priority: 10 })
    await queue.enqueue({ task: 'lettura', scopeKey: 'b', scope: {}, priority: 10 })
    await scheduler.start()

    await until(() => refused === 1)
    await new Promise((done) => setTimeout(done, 100))
    expect(refused).toBe(1)
    refuse = false
    await sql.run('UPDATE ai_work SET not_before = 0')
    scheduler.reset()
    await until(() => ran.length === 2)
  })

  it('keeps a unit queued while it is held, whoever queued it, and starts it once let through', async () => {
    const executor = gatedExecutor((unit) => [unit.scopeKey])
    let holdingDay = true
    scheduler = new Scheduler(
      queue,
      { lettura: executor, giornata: executor },
      {
        reachability,
        concurrency: () => 4,
        holding: async () => (unit) => holdingDay && unit.task === 'giornata'
      }
    )
    await queue.enqueue({ task: 'giornata', scopeKey: 'day', scope: {}, priority: 5 })
    await queue.enqueue({ task: 'lettura', scopeKey: 'read', scope: {}, priority: 10 })
    await scheduler.start()

    await until(() => executor.started.length === 1)
    expect(executor.started).toEqual(['read'])
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(executor.started).toEqual(['read'])

    holdingDay = false
    scheduler.wake()
    await until(() => executor.started.length === 2)
    expect(executor.started).toEqual(['read', 'day'])
    executor.release('read')
    executor.release('day')
    await until(async () => (await queue.counts()).length === 0)
  })

  it('puts aside what runs, to wait again uncounted and start once it may', async () => {
    let runs = 0
    let held = false
    const executor: TaskExecutor = {
      lockKeys: async (unit) => [unit.scopeKey],
      run: async (_unit, signal) => {
        runs += 1

        if (runs === 1) {
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('Interrotto.')))
          )
        }
      }
    }
    scheduler = new Scheduler(
      queue,
      { lettura: executor },
      { reachability, concurrency: () => 2, holding: async () => () => held }
    )
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'read', scope: {}, priority: 10 })
    await scheduler.start()
    await until(() => runs === 1)

    held = true
    await scheduler.stopWhere(() => true, { again: true })
    expect((await queue.get(unit.id))?.status).toBe('da_riprovare')
    expect((await queue.get(unit.id))?.attempts).toBe(0)

    scheduler.wake()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(runs).toBe(1)

    held = false
    scheduler.wake()
    await until(() => runs === 2)
    await until(async () => (await queue.counts()).length === 0)
  })

  it('leaves a unit that failed failed, without trying it again by itself', async () => {
    let calls = 0
    scheduler = new Scheduler(
      queue,
      {
        lettura: {
          lockKeys: async () => [],
          run: async () => {
            calls += 1
            throw new WorkFailure(
              'Mi sono fermato: da 10 passaggi di fila non riuscivo ad andare avanti.'
            )
          }
        }
      },
      { reachability, concurrency: () => 1 }
    )
    const unit = await queue.enqueue({ task: 'lettura', scopeKey: 'a', scope: {}, priority: 10 })
    await scheduler.start()

    await until(async () => (await queue.get(unit.id))?.status === 'fallito')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls).toBe(1)
    expect((await queue.get(unit.id))?.lastError).toContain('Mi sono fermato')
  })
})

describe('Engine', () => {
  let sql: ReturnType<typeof memorySql>
  let queue: WorkQueue

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    queue = new WorkQueue(sql)
  })

  afterEach(() => sql.close())

  const engineWith = (letter: { text: string } | null): SegretarioEngine =>
    new SegretarioEngine({
      queue,
      registry: { day: { letter: async () => letter } }
    } as unknown as EngineDeps)

  const queuedDays = async (): Promise<number> =>
    (await queue.counts())
      .filter((count) => count.task === 'giornata')
      .reduce((total, count) => total + count.count, 0)

  it('writes the day a setup promised at once, and once', async () => {
    const engine = engineWith(null)

    await engine.writeDayNow()
    await engine.writeDayNow()

    expect(await queuedDays()).toBe(1)
  })

  it('leaves the day alone when today has its letter', async () => {
    await engineWith({ text: 'La giornata.' }).writeDayNow()

    expect(await queuedDays()).toBe(0)
  })
})

describe('What the guided setup holds back', () => {
  const setup = (
    over: Partial<OnboardingState> & Pick<OnboardingState, 'case' | 'step'>
  ): OnboardingState => ({ accountIds: [], conoscimiId: null, startedAt: 0, ...over })
  // What Conoscimi knows: the mailbox a1 and the calendar c1.
  const known = new Set(['a1', 'calendario:c1'])

  it('holds every connection while the setup turning the AI on is before its reading', () => {
    const hold = setupHold(setup({ case: 'ai-prima-volta', step: 'conoscimi', turnsAiOn: true }))

    expect(hold.all).toBe(true)

    for (const key of ['a1', 'a2', 'calendario:c1', 'calendario:c2']) {
      expect(connectionHeld(hold, key, known)).toBe(true)
    }
  })

  it('holds what its Conoscimi has to know, mailbox or calendar, while it waits for it', () => {
    // a2 just added; a3 left unknown before, and known in this Conoscimi too.
    const hold = setupHold(
      setup({ case: 'nuova-connessione', step: 'conoscimi', accountIds: ['a2'] })
    )

    expect(hold.all).toBe(false)
    expect(connectionHeld(hold, 'a1', known)).toBe(false)
    expect(connectionHeld(hold, 'a2', known)).toBe(true)
    expect(connectionHeld(hold, 'a3', known)).toBe(true)
    expect(connectionHeld(hold, 'calendario:c1', known)).toBe(false)
    expect(connectionHeld(hold, 'calendario:c2', known)).toBe(true)
  })

  it('holds a mailbox from the instant it is added, before the setup lists it', () => {
    const hold = setupHold(setup({ case: 'nuova-connessione', step: 'connessioni' }))

    expect(connectionHeld(hold, 'a2', known)).toBe(true)
  })

  it('holds nothing past Conoscimi, even when the user went on without it', () => {
    const hold = setupHold(setup({ case: 'ai-prima-volta', step: 'lettura', turnsAiOn: true }))

    expect(hold.holding).toBe(false)
    expect(connectionHeld(hold, 'a2', known)).toBe(false)
    expect(connectionHeld(hold, 'calendario:c2', known)).toBe(false)
    expect(connectionHeld(setupHold(null), 'calendario:c2', known)).toBe(false)
  })

  it('holds nothing back for Conoscimi done again by hand', () => {
    const hold = setupHold(setup({ case: 'conoscimi', step: 'conoscimi' }))

    expect(hold.holding).toBe(false)
    expect(connectionHeld(hold, 'calendario:c2', known)).toBe(false)
  })
})

describe('What the guided setup keeps from starting', () => {
  const holdingDuring = async (
    setup: OnboardingState | null
  ): Promise<((unit: WorkUnit) => boolean) | null> =>
    (
      new SegretarioEngine({
        onboarding: async () => setup,
        store: {
          listLearning: async () => [
            { accountId: 'a1', activityId: null, finishedAt: 1 },
            { accountId: 'calendario:c1', activityId: null, finishedAt: 1 }
          ]
        }
      } as unknown as EngineDeps) as unknown as {
        setupHolding(): Promise<((unit: WorkUnit) => boolean) | null>
      }
    ).setupHolding()
  const unit = (task: string, scope: object = {}): WorkUnit => ({ task, scope }) as WorkUnit
  const setup = (
    over: Partial<OnboardingState> & Pick<OnboardingState, 'case' | 'step'>
  ): OnboardingState => ({ accountIds: [], conoscimiId: null, startedAt: 0, ...over })

  it('lets through only its own work while the setup turns the AI on, until it is over', async () => {
    const held = await holdingDuring(
      setup({ case: 'ai-prima-volta', step: 'lettura', turnsAiOn: true })
    )

    expect(held?.(unit('lettura', { accountId: 'a2', threadId: 't' }))).toBe(false)
    expect(held?.(unit('calendario', { look: 'c2' }))).toBe(false)
    // Oggi asking for the day again, a project opened, the memory, the calendar's changes: after.
    expect(held?.(unit('giornata', { refresh: true }))).toBe(true)
    expect(held?.(unit('punto', { projectId: 'p1' }))).toBe(true)
    expect(held?.(unit('riflessione'))).toBe(true)
    expect(held?.(unit('calendario'))).toBe(true)
  })

  it('holds before Conoscimi even the reading queued before the setup', async () => {
    const held = await holdingDuring(
      setup({ case: 'ai-riaccesa', step: 'conoscimi', turnsAiOn: true })
    )

    expect(held?.(unit('lettura', { accountId: 'a1', threadId: 't' }))).toBe(true)
    expect(held?.(unit('calendario', { look: 'c1' }))).toBe(true)
  })

  it('holds only the connections a setup adds while the AI is on, and lets the rest go on', async () => {
    const held = await holdingDuring(
      setup({ case: 'nuova-connessione', step: 'conoscimi', accountIds: ['a2'] })
    )

    expect(held?.(unit('lettura', { accountId: 'a1', threadId: 't' }))).toBe(false)
    expect(held?.(unit('lettura', { accountId: 'a2', threadId: 't' }))).toBe(true)
    expect(held?.(unit('calendario', { look: 'c2' }))).toBe(true)
    expect(held?.(unit('calendario'))).toBe(false)
    expect(held?.(unit('giornata', { refresh: true }))).toBe(false)
  })

  it('holds nothing without a setup, or for Conoscimi done again by hand', async () => {
    expect(await holdingDuring(null)).toBeNull()
    expect(await holdingDuring(setup({ case: 'conoscimi', step: 'conoscimi' }))).toBeNull()
  })
})

describe('A connection that goes', () => {
  let sql: ReturnType<typeof memorySql>
  let queue: WorkQueue

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    queue = new WorkQueue(sql)
  })

  afterEach(() => sql.close())

  const engineWith = (letterAt: number | null): SegretarioEngine =>
    new SegretarioEngine({
      queue,
      store: new AiStore(sql),
      onboarding: async () => null,
      registry: {
        day: {
          letter: async () =>
            letterAt === null ? null : { text: 'La giornata.', writtenAt: letterAt }
        },
        commitments: { changedSince: async () => false }
      }
    } as unknown as EngineDeps)
  const holding = (engine: SegretarioEngine): Promise<((unit: WorkUnit) => boolean) | null> =>
    (
      engine as unknown as { setupHolding(): Promise<((unit: WorkUnit) => boolean) | null> }
    ).setupHolding()
  const unit = (task: string, scope: object = {}): WorkUnit => ({ task, scope }) as WorkUnit

  it('holds all the work while it goes, the setup’s own too, and lets it through once gone', async () => {
    const engine = engineWith(null)

    await engine.connectionLeaving()
    const held = await holding(engine)
    expect(held?.(unit('lettura', { accountId: 'a9', threadId: 't' }))).toBe(true)
    expect(held?.(unit('giornata'))).toBe(true)
    expect(held?.(unit('calendario', { look: 'c1' }))).toBe(true)

    engine.connectionLeft()
    expect(await holding(engine)).toBeNull()
  })

  it('holds until the last of two going together is gone', async () => {
    const engine = engineWith(null)

    await engine.connectionLeaving()
    await engine.connectionLeaving()
    engine.connectionLeft()
    expect((await holding(engine))?.(unit('giornata'))).toBe(true)
    engine.connectionLeft()
    expect(await holding(engine)).toBeNull()
  })

  it('makes behind the letter written before it, and not one written after', async () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    const hour = 60 * 60 * 1000
    const before = engineWith(twoHoursAgo)

    expect(await before.letterBehind(hour)).toBe(false)
    await before.connectionGone()
    expect(await before.letterBehind(hour)).toBe(true)

    const after = engineWith(Date.now() + 60_000)
    expect(await after.letterBehind(-Infinity)).toBe(false)
  })
})

describe("A calendar's first look", () => {
  let sql: ReturnType<typeof memorySql>
  let queue: WorkQueue
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    queue = new WorkQueue(sql)
    store = new AiStore(sql)
  })

  afterEach(() => sql.close())

  const DAY = 86_400_000
  /** A busy calendar: two meetings a day for 120 days, and a weekly one all year. */
  const events: CalendarEvent[] = [
    ...Array.from({ length: 240 }, (_, index) => ({
      key: `e${index}`,
      eventId: `e${index}`,
      seriesId: null,
      start: new Date(
        Date.now() + (Math.floor(index / 2) + 1) * DAY + (index % 2) * 3_600_000
      ).toISOString()
    })),
    ...Array.from({ length: 52 }, (_, week) => ({
      key: `w${week}`,
      eventId: `w${week}`,
      seriesId: 'riunione',
      start: new Date(Date.now() + (week * 7 + 2) * DAY + 7_200_000).toISOString()
    }))
  ].map((event) => ({
    connectionId: 'c1',
    calendarId: 'lavoro',
    calendarName: 'Lavoro',
    iCalUid: null,
    title: event.key,
    end: event.start,
    allDay: false,
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    myResponse: null,
    meetLink: null,
    htmlLink: null,
    origin: null,
    ...event
  }))

  const engine = (lastSyncAt: number | null = Date.now()): SegretarioEngine =>
    new SegretarioEngine({
      queue,
      store,
      calendar: {
        connections: async () => [{ id: 'c1', label: 'Lavoro', calendars: [], lastSyncAt }],
        calendars: async () => [],
        events: async () => events,
        latestChangeId: async () => 41
      }
    } as unknown as EngineDeps)

  const plan = (on: SegretarioEngine): Promise<void> =>
    (on as unknown as { planCalendarLooks(hold: unknown): Promise<void> }).planCalendarLooks(
      setupHold(null)
    )

  it('queues the whole window at once, in blocks that go in parallel, a series once', async () => {
    const looking = engine()
    await plan(looking)
    const blocks = await queue.within(calendarLookScope('c1'))

    // 240 events and one series: 241 things, in blocks of fifty.
    expect(blocks).toHaveLength(5)
    expect(new Set(blocks.map((block) => block.scopeKey)).size).toBe(5)

    // Planned again while they wait, nothing more is queued.
    await plan(looking)
    expect(await queue.within(calendarLookScope('c1'))).toHaveLength(5)
  })

  it('waits for a calendar to be read before looking at it, rather than finding it empty', async () => {
    await plan(engine(null))

    expect(await queue.within(calendarLookScope('c1'))).toEqual([])
    expect(await store.readings()).toEqual([])
  })

  it('is done once every block is, and is not planned again as the days pass', async () => {
    const looking = engine()
    await plan(looking)

    for (const block of await queue.within(calendarLookScope('c1'))) {
      await queue.claim(block.id)
      await queue.complete(block.id)
    }

    await plan(looking)
    const [reading] = await store.readings()
    expect(reading.lookedUntil! - reading.lookedFrom!).toBeGreaterThanOrEqual(425 * DAY)

    await plan(looking)
    expect(
      (await queue.within(calendarLookScope('c1'))).every((unit) => unit.status === 'fatto')
    ).toBe(true)
  })

  it('looks at a calendar whole again when the AI is switched on again', async () => {
    const looking = engine()
    await plan(looking)

    for (const block of await queue.within(calendarLookScope('c1'))) {
      await queue.claim(block.id)
      await queue.complete(block.id)
    }

    await plan(looking)
    await looking.switchedOn()

    expect((await store.readings())[0]).toMatchObject({ lookedFrom: null, lookedUntil: null })
    expect(await queue.within(calendarLookScope('c1'))).toEqual([])
    expect(await store.meta('calendar_seen')).toBe('41')

    await plan(looking)
    expect(await queue.within(calendarLookScope('c1'))).toHaveLength(5)
  })
})
