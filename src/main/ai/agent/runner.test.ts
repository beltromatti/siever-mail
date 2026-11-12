import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The runner reaches Electron through what its tools read: not these tests.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
  shell: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

// What the runs write in the diagnostics, to read how they ended.
const logged = vi.hoisted(() => [] as Array<{ ev: string; fields: Record<string, unknown> }>)
vi.mock('@main/diagnostics/log', async (importOriginal) => {
  const original = await importOriginal<typeof import('@main/diagnostics/log')>()
  return {
    ...original,
    diagnostics: (area: Parameters<typeof original.diagnostics>[0]) => {
      const scope = original.diagnostics(area)
      const kept =
        (level: 'info' | 'warn') =>
        (ev: string, fields: Record<string, unknown> = {}): void => {
          logged.push({ ev, fields })
          scope[level](ev, fields)
        }
      return { ...scope, info: kept('info'), warn: kept('warn') }
    }
  }
})

import { AiStore } from '../ai-store'
import { Reachability } from '../engine/reachability'
import { Notebook } from '../memory/notebook'
import {
  SegretarioError,
  type ChatRequest,
  type ChatResult,
  type OpenRouterClient,
  type StreamListener,
  type ToolCall
} from '../openrouter'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import type { AssistantPayload, CompactionPayload, ToolPayload } from './conversation'
import { AgentRunner, TASK_EFFORT, type RunnerDeps } from './runner'
import { ToolInputError, type SegretarioTool } from './tool-types'
import type { ActivityEvent } from '@shared/segretario'

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
    billed: true,
    thinking: null
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
  let emitted: ActivityEvent[]
  let reachability: Reachability

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
    requests = []
    emitted = []
    logged.length = 0
    reachability = new Reachability()
  })

  afterEach(() => sql.close())

  /** A runner whose model answers `next` for each request, with these tools. */
  function runnerWith(
    next: (
      request: ChatRequest,
      index: number,
      stream: StreamListener
    ) => Promise<ChatResult> | ChatResult,
    tools: SegretarioTool[],
    contextLength = 1_000_000
  ): AgentRunner {
    const client = {
      chat: async (_key: string, request: ChatRequest, stream: StreamListener = {}) => {
        requests.push(request)
        return next(request, requests.length - 1, stream)
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
      emit: (event) => emitted.push(event),
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

  it('runs a turn’s reads together and its writes one after another, in the order asked', async () => {
    const log: string[] = []
    let open = 0
    const timed = (name: string, readsOnly?: SegretarioTool['readsOnly']): SegretarioTool => ({
      ...tool(name, async (args) => {
        open += 1
        log.push(`${args.n} parte (${open} insieme)`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        open -= 1
        log.push(`${args.n} finisce`)
        return { content: 'ok', summary: 'ok' }
      }),
      readsOnly
    })
    const runner = runnerWith(
      (_request, index) =>
        answer(
          index === 0
            ? {
                calls: [
                  { name: 'leggi', args: { n: 'a' } },
                  { name: 'leggi', args: { n: 'b' } },
                  { name: 'scrivi', args: { n: 'c' } },
                  { name: 'progetto', args: { n: 'd', azione: 'punto' } },
                  { name: 'progetto', args: { n: 'e', azione: 'elenco' } },
                  { name: 'leggi', args: { n: 'f' } }
                ]
              }
            : {}
        ),
      [
        timed('leggi', () => true),
        timed('scrivi'),
        timed('progetto', (args) => args.azione === 'elenco')
      ]
    )

    const result = await runner.run({
      activityId: await start(),
      task: 'lettura',
      background: true
    })

    expect(result.status).toBe('done')
    expect(log).toEqual([
      'a parte (1 insieme)',
      'b parte (2 insieme)',
      'a finisce',
      'b finisce',
      'c parte (1 insieme)',
      'c finisce',
      'd parte (1 insieme)',
      'd finisce',
      'e parte (1 insieme)',
      'f parte (2 insieme)',
      'e finisce',
      'f finisce'
    ])
    // The model reads the results in the order it asked them.
    const { messages } = requests[1]
    expect(
      messages.flatMap((message) => (message.role === 'tool' ? [message.tool_call_id] : []))
    ).toEqual(
      messages.flatMap((message) =>
        message.role === 'assistant' ? (message.tool_calls ?? []).map((call) => call.id) : []
      )
    )
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
      missing: async () =>
        written ? null : { forModel: 'Scrivi la nota.', shown: 'Writing the note.' }
    })

    expect(result.status).toBe('done')
    expect(requests).toHaveLength(5)

    requests = []
    const never = runnerWith(() => answer({}), [])
    const stopped = await never.run({
      activityId: await start('b'),
      task: 'richiesta',
      background: true,
      missing: async () => ({ forModel: 'Scrivi la nota.', shown: 'Writing the note.' })
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

  it('fails a conversation’s turn that ends with neither words nor calls, asked again by «Riprova»', async () => {
    const runner = runnerWith(
      (_request, index) =>
        index === 0
          ? { ...answer({}), content: '  ', thinking: { ms: 540_000, tokens: 90_000 } }
          : answer({}),
      []
    )
    const id = await start()
    const failed = await runner.run({ activityId: id, task: 'richiesta', background: false })

    expect(failed.status).toBe('failed')
    expect((failed.error as SegretarioError).code).toBe('no-answer')
    expect((await store.listEvents(id)).at(-1)).toMatchObject({
      type: 'error',
      payload: { code: 'no-answer', message: 'The Segretario stopped without answering you.' }
    })
    expect((await store.getActivity(id))?.status).toBe('failed')
    expect(logged.find((line) => line.ev === 'run.end')?.fields).toMatchObject({
      status: 'failed',
      reason: 'no-answer'
    })

    // Asked again, the request is the same: the turn that said nothing is not in it.
    const again = await runner.run({ activityId: id, task: 'richiesta', background: false })
    expect(again.status).toBe('done')
    expect(requests[1].messages).toEqual(requests[0].messages)
    expect(requests[1].messages.at(-1)).toMatchObject({ role: 'user' })
  })

  it('fails one cut at its length with no words, lets the user go on, and leaves other tasks be', async () => {
    const runner = runnerWith(
      (_request, index) =>
        index === 0 ? { ...answer({}), content: '', finishReason: 'length' } : answer({}),
      []
    )
    const id = await start()
    const cut = await runner.run({ activityId: id, task: 'richiesta', background: false })
    expect(cut.error).toMatchObject({ code: 'no-answer' })

    // The user writes again in the same conversation: it goes on from all it holds.
    await store.appendEvent(id, 'user', { text: 'Allora?', forModel: 'Allora?', handles: [] })
    expect(
      (await runner.run({ activityId: id, task: 'richiesta', background: false })).status
    ).toBe('done')
    expect(requests[1].messages.slice(1).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user'
    ])

    // A task that leaves its work through its tools may end without a word.
    requests = []
    const quiet = runnerWith(() => ({ ...answer({}), content: '' }), [])
    expect(
      (await quiet.run({ activityId: await start('b'), task: 'lettura', background: true })).status
    ).toBe('done')
  })

  it('shows the thinking live, a few times a second, and keeps how long it lasted with the turn', async () => {
    const runner = runnerWith(
      async (_request, index, stream) => {
        if (index > 0) {
          // Not billed with its reasoning: the count of the stream stands for it.
          return { ...answer({}), thinking: { ms: 500, tokens: 12 } }
        }

        for (let tokens = 1; tokens <= 40; tokens++) {
          stream.onReasoning?.(tokens)
        }

        await new Promise((resolve) => setTimeout(resolve, 300))
        stream.onReasoning?.(41)
        stream.onOutput?.(23_000)
        const turn = answer({ calls: [{ name: 'leggi' }] })
        return {
          ...turn,
          usage: { ...turn.usage, reasoningTokens: 1_240 },
          thinking: { ms: 23_000, tokens: 41 }
        }
      },
      [tool('leggi')]
    )
    const id = await start()
    expect(
      (await runner.run({ activityId: id, task: 'richiesta', background: false })).status
    ).toBe('done')

    // As the turn begins; once in its first quarter of a second, whatever the count; how long,
    // once the answer begins; nothing, once the turn is written — and again for the next turn.
    expect(emitted.flatMap((event) => (event.type === 'thinking' ? [event.thinking] : []))).toEqual(
      [
        { tokens: 0, ms: null },
        { tokens: 40, ms: null },
        { tokens: 41, ms: 23_000 },
        null,
        { tokens: 0, ms: null },
        null
      ]
    )

    const turns = (await store.listEvents(id))
      .filter((event) => event.type === 'assistant')
      .map((event) => event.payload as AssistantPayload)
    expect(turns[0]).toMatchObject({ thinkingMs: 23_000, reasoningTokens: 1_240 })
    expect(turns[1]).toMatchObject({ thinkingMs: 500, reasoningTokens: 12 })

    // A turn of calls alone shows for how it thought; the turn written comes before the live line goes.
    const shown = emitted.findIndex(
      (event) => event.type === 'entry' && event.entry.kind === 'assistant'
    )
    expect(emitted[shown]).toMatchObject({
      entry: { kind: 'assistant', text: '', thought: { ms: 23_000, tokens: 1_240 } }
    })
    expect(emitted[shown + 1]).toMatchObject({ type: 'thinking', thinking: null })
  })
})
