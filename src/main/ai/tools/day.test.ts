import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The tools reach Electron through what other tools read: not these tests.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: class {}, shell: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { HandleRegistry } from '../agent/handles'
import { ToolConflict, type RunContext, type TaskKind, type ToolContext } from '../agent/tool-types'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { localDay, todayTool } from './day'

describe('oggi', () => {
  let sql: ReturnType<typeof memorySql>
  let registry: Registry

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    registry = new Registry(sql, { changed: () => undefined, lesson: () => undefined })
  })

  afterEach(() => sql.close())

  const runOf = (task: TaskKind, runId = `run-${task}`): ToolContext =>
    ({
      run: {
        activityId: runId,
        task,
        startedAt: Date.now(),
        background: task !== 'richiesta',
        watched: task === 'richiesta',
        actor: { by: 'segretario', runId, background: task !== 'richiesta' },
        seen: new Map(),
        looking: new Set(),
        changes: [],
        results: {},
        editor: null,
        fileSearches: new Map()
      } as RunContext,
      handles: new HandleRegistry(),
      registry
    }) as unknown as ToolContext

  const write = (lettera: string, context: ToolContext): ReturnType<typeof todayTool.execute> =>
    todayTool.execute({ lettera }, context)

  it('lives a day: a new day starts from the state, not over yesterday’s', async () => {
    const yesterday = localDay(new Date(Date.now() - 24 * 60 * 60 * 1000))
    await registry.day.saveLetter(yesterday, 'Ieri: la consegna delle 7:30.', [])

    await write('Oggi conta il sopralluogo delle 10.', runOf('giornata'))
    expect((await registry.day.letter(localDay()))?.text).toBe(
      'Oggi conta il sopralluogo delle 10.'
    )
  })

  it('the same day, is written over the one the run read — shown it first, if it never did', async () => {
    await write('Oggi conta il sopralluogo delle 10.', runOf('giornata', 'mattina'))

    // A second look the same day that never read it is shown it, without another run's links.
    const again = runOf('giornata', 'pomeriggio')
    const conflict = write('Il sopralluogo è spostato alle 15.', again)
    await expect(conflict).rejects.toBeInstanceOf(ToolConflict)
    await expect(conflict).rejects.toThrow(
      /non l'hai ancora letta: dice «Oggi conta il sopralluogo/
    )
    // Seen as it is, it is rewritten knowingly.
    await write('Il sopralluogo è spostato alle 15.', again)

    // Read first, it goes at once; written meanwhile by the user's chat, it is shown again.
    const evening = runOf('giornata', 'sera')
    expect((await todayTool.execute({}, evening)).content).toContain('spostato alle 15')
    const chat = runOf('richiesta')
    await todayTool.execute({}, chat)
    await write('Il sopralluogo è alle 15, e Chiara ha confermato.', chat)
    await expect(write('Serata libera.', evening)).rejects.toThrow(/è stata riscritta alle/)
  })

  it('is read by any run, and written only by the day’s work or the user’s', async () => {
    const reading = runOf('lettura')
    expect(todayTool.readsOnly?.({})).toBe(true)
    expect((await todayTool.execute({}, reading)).content).toBe("Oggi non c'è ancora una lettera.")
    await expect(write('Da una conversazione.', reading)).rejects.toThrow(
      /la scrive il lavoro della giornata/
    )
  })
})
