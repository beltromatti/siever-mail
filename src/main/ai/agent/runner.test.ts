import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The runner reaches Electron through what its tools read: not these tests.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
  shell: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { AiStore } from '../ai-store'
import { Reachability } from '../engine/reachability'
import { Notebook } from '../memory/notebook'
import {
  SegretarioError,
  type ChatRequest,
  type ChatResult,
  type OpenRouterClient,
  type ToolCall
} from '../openrouter'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import type { CompactionPayload, ToolPayload } from './conversation'
import { AgentRunner, TASK_EFFORT, type RunnerDeps } from './runner'
import { ToolInputError, type SegretarioTool } from './tool-types'

type Turn = {
  calls?: Array<{ name: string; args?: Record<string, unknown> }>
  promptTokens?: number
}

let callIds = 0
function answer(turn: Turn): ChatResult {
  const toolCalls: ToolCall[] = (turn.calls ?? []).map((call) => ({
    id: `c${++callIds}`,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
  }))
  return {
    content: toolCalls.length === 0 ? 'Fatto.' : '',
    toolCalls,
    reasoningDetails: [],
    finishReason: toolCalls.length === 0 ? 'stop' : 'tool_calls',
    usage: {
      promptTokens: turn.promptTokens ?? 100,
      cachedTokens: 0,
      completionTokens: 10,
      reasoningTokens: 0,
      cost: 0
    },
    model: null,
    provider: null,
    billed: true
  }
}

const tool = (
  name: string,
  execute: SegretarioTool['execute'] = async () => ({ content: 'ok', summary: 'ok' })
): SegretarioTool => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
  running: () => name,
  execute
})

describe('AgentRunner', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore
  let requests: ChatRequest[]
  let reachability: Reachability

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
    requests = []
    reachability = new Reachability()
  })

  afterEach(() => sql.close())

  /** A runner whose model answers `next` for each request, with these tools. */
  function runnerWith(
    next: (request: ChatRequest, index: number) => Promise<ChatResult> | ChatResult,
    tools: SegretarioTool[],
    contextLength = 1_000_000
  ): AgentRunner {
    const client = {
      chat: async (_key: string, request: ChatRequest) => {
        requests.push(request)
        return next(request, requests.length - 1)
      }
    } as unknown as OpenRouterClient
    return new AgentRunner({
      client,
      reachability,
      contextLength: async () => contextLength,
      store,
      registry: new Registry(sql, { changed: () => undefined, lesson: () => undefined }),
      notebook: new Notebook(sql),
      tools,
      mail: {} as RunnerDeps['mail'],
      calendar: {} as RunnerDeps['calendar'],
      page: {} as RunnerDeps['page'],
      requireKey: async () => 'sk-test',
      emit: () => undefined,
      recordUsage: async () => undefined
    })
  }

  async function start(id = 'run'): Promise<string> {
    await store.createActivity({
      id,
      task: 'richiesta',
      title: 'Prova',
      status: 'running',
      visibility: 'nascosta'
    })
    await store.appendEvent(id, 'user', { text: 'Lavora', forModel: 'Lavora', handles: [] })
    return id
  }

  it('goes on for as many turns as the work takes, thinking as its task asks, its length the model’s', async () => {
    const runner = runnerWith(
      (_request, index) =>
        answer(index < 120 ? { calls: [{ name: 'fai', args: { n: index } }] } : {}),
      [tool('fai')]
    )

    const result = await runner.run({
      activityId: await start(),
      task: 'richiesta',
      background: true
    })

    expect(result.status).toBe('done')
    expect(requests).toHaveLength(121)
    expect(requests.every((request) => request.reasoningEffort === TASK_EFFORT.richiesta)).toBe(
      true
    )
    expect(TASK_EFFORT.richiesta).toBe('max')
    expect(TASK_EFFORT.lettura).toBe('low')
    expect(requests.every((request) => request.maxTokens === undefined)).toBe(true)
  })

  it('stops a run that gets nowhere for ten turns in a row, and only then', async () => {
    const failing = tool('sbaglia', async () => {
      throw new ToolInputError('No.')
    })
    // Nine turns that fail, one that gets somewhere, nine more, then the end: never ten in a row.
    const pattern = [...Array(9).fill('sbaglia'), 'fai', ...Array(9).fill('sbaglia')]
    const ok = runnerWith(
      (_request, index) =>
        answer(
          index < pattern.length ? { calls: [{ name: pattern[index], args: { n: index } }] } : {}
        ),
      [tool('fai'), failing]
    )
    expect(
      (await ok.run({ activityId: await start('a'), task: 'richiesta', background: true })).status
    ).toBe('done')

    requests = []
    const stuck = runnerWith(
      (_request, index) => answer({ calls: [{ name: 'sbaglia', args: { n: index } }] }),
      [failing]
    )
    const result = await stuck.run({
      activityId: await start('b'),
      task: 'richiesta',
      background: true
    })

    expect(result.status).toBe('failed')
    expect((result.error as SegretarioError).code).toBe('stuck')
    expect(requests).toHaveLength(10)
  })

  it('tells a run what its task still asks for, for as long as it gets somewhere', async () => {
    let written = false
    const runner = runnerWith(
      (_request, index) => answer(index === 3 ? { calls: [{ name: 'nota' }] } : {}),
      [
        tool('nota', async () => {
          written = true
          return { content: 'Nota scritta.', summary: 'Nota' }
        })
      ]
    )

    const result = await runner.run({
      activityId: await start(),
      task: 'richiesta',
      background: true,
      missing: async () => (written ? null : 'Scrivi la nota.')
    })

    expect(result.status).toBe('done')
    expect(requests).toHaveLength(5)

    requests = []
    const never = runnerWith(() => answer({}), [])
    const stopped = await never.run({
      activityId: await start('b'),
      task: 'richiesta',
      background: true,
      missing: async () => 'Scrivi la nota.'
    })

    expect((stopped.error as SegretarioError).code).toBe('stuck')
    expect(requests).toHaveLength(10)
  })

  it('waits for OpenRouter when it does not answer, and takes up the same step again', async () => {
    let failures = 0
    const runner = runnerWith((_request, index) => {
      if (index < 2) {
        failures += 1
        throw new SegretarioError('network', 'Non riesco a raggiungere OpenRouter.')
      }

      return answer({})
    }, [])
    // The computer back online at once, as it were, every time the run waits.
    const timer = setInterval(() => reachability.waiting && reachability.online(), 5)

    try {
      const result = await runner.run({
        activityId: await start(),
        task: 'richiesta',
        background: true
      })

      expect(result.status).toBe('done')
      expect(failures).toBe(2)
      expect(requests[2].messages).toEqual(requests[0].messages)
      expect(reachability.waiting).toBeNull()
    } finally {
      clearInterval(timer)
    }
  })

  it('stops waiting, cancelled, when the run is stopped', async () => {
    const runner = runnerWith(() => {
      throw new SegretarioError('unavailable', 'Il servizio del modello non è disponibile.')
    }, [])
    const controller = new AbortController()
    const running = runner.run({
      activityId: await start(),
      task: 'richiesta',
      background: true,
      signal: controller.signal
    })

    await vi.waitFor(() => expect(reachability.waiting).not.toBeNull())
    controller.abort()

    expect((await running).status).toBe('cancelled')
  })

  it('compacts near the edge of the model’s context, keeping the step under way word for word', async () => {
    const runner = runnerWith(
      (request, index) => {
        if (request.toolChoice === 'none') {
          return { ...answer({}), content: 'RIASSUNTO' }
        }

        // The second step fills the context past its share: compacted after it.
        return answer(
          index === 0
            ? { calls: [{ name: 'leggi', args: { n: 1 } }] }
            : index === 1
              ? { calls: [{ name: 'leggi', args: { n: 2 } }], promptTokens: 900 }
              : {}
        )
      },
      [tool('leggi', async (args) => ({ content: `LETTO ${args.n}`, summary: 'Letto' }))],
      1_000
    )

    const id = await start()
    expect((await runner.run({ activityId: id, task: 'richiesta', background: true })).status).toBe(
      'done'
    )

    const compaction = requests.find((request) => request.toolChoice === 'none')
    expect(compaction?.reasoningEffort).toBe(TASK_EFFORT.richiesta)
    expect(compaction?.maxTokens).toBeUndefined()

    const events = await store.listEvents(id)
    const summary = events.find((event) => event.type === 'compaction')
      ?.payload as CompactionPayload
    const lastStep = events.filter((event) => event.type === 'assistant')[1]
    expect(summary.coveredUntil).toBeLessThan(lastStep.id)

    const after = JSON.stringify(requests[requests.length - 1].messages)
    expect(after).toContain('RIASSUNTO')
    expect(after).toContain('LETTO 2')
    expect(after).not.toContain('LETTO 1')
    expect(
      events
        .filter((event) => event.type === 'tool')
        .map((event) => (event.payload as ToolPayload).result)
    ).toEqual(['LETTO 1', 'LETTO 2'])
  })
})
