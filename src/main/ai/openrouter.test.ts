import { describe, expect, it, vi } from 'vitest'

import {
  creditSpent,
  creditWarning,
  OpenRouterClient,
  PROVIDER_POLICY,
  SEGRETARIO_MODEL,
  SegretarioError,
  errorFromResponse,
  readChatStream,
  sseData,
  type GenerationBill
} from './openrouter'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }

      controller.close()
    }
  })
}

const event = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

describe('sseData', () => {
  it('yields each payload, skipping comments, across chunk boundaries', async () => {
    const payloads: string[] = []

    for await (const data of sseData(
      streamOf(': OPENROUTER PROCESSING\n\n', 'data: {"a"', ':1}\r\n\r\ndata: [DONE]\n\n')
    )) {
      payloads.push(data)
    }

    expect(payloads).toEqual(['{"a":1}', '[DONE]'])
  })
})

describe('readChatStream', () => {
  it('gathers text, tool calls by index, reasoning and the bill', async () => {
    const heard: string[] = []
    const result = await readChatStream(
      streamOf(
        event({
          model: 'deepseek/deepseek-v4.1-flash-1017',
          provider: 'Wafer',
          choices: [
            { delta: { content: 'Cerco ', reasoning_details: [{ type: 'reasoning.text' }] } }
          ]
        }),
        event({
          choices: [
            {
              delta: {
                content: 'subito.',
                tool_calls: [
                  { index: 0, id: 'call_a', function: { name: 'cerca_posta', arguments: '{"que' } }
                ]
              }
            }
          ]
        }),
        event({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"Hera"}' } }] } },
            {
              delta: {
                tool_calls: [
                  { index: 1, id: 'call_b', function: { name: 'memoria', arguments: '{}' } }
                ]
              },
              finish_reason: 'tool_calls'
            }
          ]
        }),
        event({
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 40,
            cost: 0.0002,
            prompt_tokens_details: { cached_tokens: 1100 },
            completion_tokens_details: { reasoning_tokens: 0 }
          }
        }),
        'data: [DONE]\n\n'
      ),
      (text) => heard.push(text)
    )

    expect(heard.join('')).toBe('Cerco subito.')
    expect(result.content).toBe('Cerco subito.')
    expect(result.toolCalls).toEqual([
      {
        id: 'call_a',
        type: 'function',
        function: { name: 'cerca_posta', arguments: '{"query":"Hera"}' }
      },
      { id: 'call_b', type: 'function', function: { name: 'memoria', arguments: '{}' } }
    ])
    expect(result.reasoningDetails).toEqual([{ type: 'reasoning.text' }])
    expect(result.finishReason).toBe('tool_calls')
    expect(result.billed).toBe(true)
    expect(result.usage).toEqual({
      promptTokens: 1200,
      cachedTokens: 1100,
      completionTokens: 40,
      reasoningTokens: 0,
      cost: 0.0002
    })
    expect(result.provider).toBe('Wafer')
  })

  it('turns an error arriving mid-stream into the error it is', async () => {
    await expect(
      readChatStream(
        streamOf(
          event({ choices: [{ delta: { content: 'Ok' } }] }),
          event({ error: { code: 402, message: 'Insufficient credits' } })
        ),
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'no-credit' })
  })
})

describe('errorFromResponse', () => {
  it('says what each failure means and which are worth retrying', () => {
    expect(errorFromResponse(401, null, null).code).toBe('invalid-key')
    expect(errorFromResponse(402, null, null).code).toBe('no-credit')
    expect(errorFromResponse(429, null, '3')).toMatchObject({
      code: 'rate-limited',
      retryAfterMs: 3000,
      retryable: true
    })
    expect(errorFromResponse(503, null, null).retryable).toBe(true)
    expect(errorFromResponse(400, { error: { message: 'bad tools' } }, null).message).toContain(
      'bad tools'
    )
  })
})

describe('the kinds of error', () => {
  it('waits for what passes, turns the AI off for the service refused, fails one request alone', () => {
    // Passing: the call waits and is made again.
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(errorFromResponse(status, null, null).unreachable).toBe(true)
    }
    // Too much in flight on the key, with a time to come back: a wait, not the credit spent.
    expect(errorFromResponse(402, null, '5')).toMatchObject({
      code: 'rate-limited',
      retryAfterMs: 5000
    })
    expect(
      errorFromResponse(
        402,
        { error: { metadata: { limit_source: 'openrouter_in_flight_budget' } } },
        null
      ).unreachable
    ).toBe(true)

    // The whole service refused: the AI goes off.
    expect(errorFromResponse(401, null, null).refusesService).toBe(true)
    expect(errorFromResponse(402, null, null)).toMatchObject({
      code: 'no-credit',
      refusesService: true
    })
    expect(
      errorFromResponse(
        403,
        { error: { metadata: { limit_source: 'openrouter_key_limit' } } },
        null
      ).code
    ).toBe('no-credit')
    expect(errorFromResponse(404, null, null)).toMatchObject({
      code: 'model-unavailable',
      refusesService: true
    })

    // One request refused: that run's failure only.
    const flagged = errorFromResponse(403, { error: { message: 'Input flagged' } }, null)
    expect(flagged).toMatchObject({ code: 'blocked', refusesService: false, unreachable: false })
    expect(errorFromResponse(400, null, null)).toMatchObject({
      code: 'bad-request',
      refusesService: false,
      unreachable: false
    })
    expect(
      errorFromResponse(
        404,
        { error: { message: 'No endpoints found that support image input' } },
        null
      )
    ).toMatchObject({ code: 'bad-request', refusesService: false })
  })
})

describe('OpenRouterClient', () => {
  it('asks for the newest DeepSeek Flash on a private, fast and cheap provider', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          streamOf(event({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })),
          {
            status: 200
          }
        )
    )
    const client = new OpenRouterClient(fetchImpl)

    await client.chat('sk-test', {
      messages: [{ role: 'user', content: 'ciao' }],
      reasoningEffort: 'none',
      sessionId: 'activity-1'
    })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(body.model).toBe(SEGRETARIO_MODEL)
    expect(body.provider).toEqual(PROVIDER_POLICY)
    // The cheapest of those that keep no data and are fast: a rule, no provider named.
    expect(body.provider).toEqual({
      zdr: true,
      data_collection: 'deny',
      sort: 'price',
      preferred_min_throughput: 150,
      preferred_max_latency: 1.5
    })
    expect(body.session_id).toBe('activity-1')
    expect(body.reasoning).toEqual({ effort: 'none' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('fetches the bill of a turn that broke before saying it, once OpenRouter keeps it', async () => {
    vi.useFakeTimers()

    try {
      const lookups: string[] = []
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.includes('/generation')) {
          lookups.push(url)

          return lookups.length === 1
            ? new Response('{}', { status: 404 })
            : Response.json({
                data: {
                  total_cost: 0.0031,
                  tokens_prompt: 900,
                  tokens_completion: 120,
                  native_tokens_reasoning: 30,
                  native_tokens_cached: 512,
                  model: 'deepseek/deepseek-v4.1-flash-1017',
                  provider_name: 'Wafer'
                }
              })
        }

        return new Response(
          streamOf(
            event({ choices: [{ delta: { content: 'Ok' } }] }),
            event({ error: { code: 502, message: 'Provider disconnected' } })
          ),
          { status: 200, headers: { 'x-generation-id': 'gen-7' } }
        )
      })
      const bills: GenerationBill[] = []

      await expect(
        new OpenRouterClient(fetchImpl).chat(
          'sk',
          { messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'none' },
          { onLateBill: async (bill) => void bills.push(bill) }
        )
      ).rejects.toMatchObject({ code: 'unavailable' })
      await vi.advanceTimersByTimeAsync(15_000)

      expect(lookups).toEqual([
        'https://openrouter.ai/api/v1/generation?id=gen-7',
        'https://openrouter.ai/api/v1/generation?id=gen-7'
      ])
      expect(bills).toEqual([
        {
          usage: {
            promptTokens: 900,
            cachedTokens: 512,
            completionTokens: 120,
            reasoningTokens: 30,
            cost: 0.0031
          },
          model: 'deepseek/deepseek-v4.1-flash-1017',
          provider: 'Wafer'
        }
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a busy provider before the first word, then gives up', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 503, headers: { 'retry-after': '0' } })
    )
    const client = new OpenRouterClient(fetchImpl)

    await expect(
      client.chat('sk', { messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'none' })
    ).rejects.toBeInstanceOf(SegretarioError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('reads the key and the balance', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/key')
        ? Response.json({
            data: {
              label: 'sk-or-v1-9b6...138',
              limit: 50,
              limit_remaining: 31.5,
              limit_reset: 'monthly'
            }
          })
        : Response.json({ data: { total_credits: 30, total_usage: 22.75 } })
    )
    const check = await new OpenRouterClient(fetchImpl).checkKey('sk')

    expect(check).toEqual({
      label: 'sk-or-v1-9b6...138',
      limit: 50,
      limitRemaining: 31.5,
      limitReset: 'monthly',
      balance: 7.25
    })
  })
})

describe('creditSpent', () => {
  const read = (available: number | null): { available: number | null; balanceKnown: boolean } => ({
    available,
    balanceKnown: available !== null
  })

  it('holds a refusal for want of credit until more is left than when it came', () => {
    // Refused with a few cents left: the cents are not enough, however often asked.
    const refusal = creditSpent(read(0.004), { available: 0.004 })
    expect(refusal).toEqual({ spent: true, refusal: { available: 0.004 } })
    expect(creditSpent(read(0.003), refusal.refusal, true)).toEqual({
      spent: true,
      refusal: { available: 0.004 }
    })
    // Topped up, or the key's limit raised: enough again.
    expect(creditSpent(read(10), refusal.refusal)).toEqual({ spent: false, refusal: null })
    expect(creditSpent(read(2), { available: null })).toEqual({ spent: false, refusal: null })
  })

  it('lets the user lift a refusal where the account’s balance cannot be read', () => {
    // The key's own limit only, or nothing: a top-up of the account would not show.
    const limitOnly = { available: 4, balanceKnown: false }
    expect(creditSpent(limitOnly, { available: 4 }).spent).toBe(true)
    expect(creditSpent(limitOnly, { available: 4 }, true)).toEqual({ spent: false, refusal: null })
    expect(creditSpent(read(null), { available: null }).spent).toBe(true)
    expect(creditSpent(read(null), { available: null }, true).spent).toBe(false)
  })

  it('reads the credit alone when nothing was refused', () => {
    expect(creditSpent(read(0), null)).toEqual({ spent: true, refusal: null })
    expect(creditSpent(read(1.5), null)).toEqual({ spent: false, refusal: null })
    expect(creditSpent(read(null), null)).toEqual({ spent: false, refusal: null })
  })
})

describe('creditWarning', () => {
  it('says the credit runs low once on the way down, graver after, again after a top-up', () => {
    // 0,40 $ a day: low under a week's worth, nearly out under two days'.
    expect(creditWarning(10, 0.4, null)).toEqual({ raise: null, days: null, warned: null })
    const low = creditWarning(2.5, 0.4, null)
    expect(low).toEqual({
      raise: 'credito-basso',
      days: 6,
      warned: { kind: 'credito-basso', available: 2.5 }
    })
    expect(creditWarning(2.1, 0.4, low.warned).raise).toBeNull()
    const out = creditWarning(0.7, 0.4, low.warned)
    expect(out).toMatchObject({ raise: 'credito-quasi-finito', days: 1 })
    expect(creditWarning(0.5, 0.4, out.warned).raise).toBeNull()
    // The pace slowing is no top-up: nothing said again.
    expect(creditWarning(0.5, 0, out.warned)).toEqual({
      raise: null,
      days: null,
      warned: out.warned
    })
    // Topped up: the next way down warns again.
    expect(creditWarning(20, 0.4, out.warned)).toEqual({ raise: null, days: null, warned: null })
    expect(creditWarning(2.5, 0.4, { kind: 'credito-basso', available: 2 }).raise).toBe(
      'credito-basso'
    )
  })

  it('warns by what is left when little was spent, without saying how long it lasts', () => {
    expect(creditWarning(0.9, 0, null)).toMatchObject({ raise: 'credito-basso', days: null })
    expect(creditWarning(0.25, 0.01, null)).toMatchObject({
      raise: 'credito-quasi-finito',
      days: null
    })
    expect(creditWarning(1.5, 0, null).raise).toBeNull()
  })
})
