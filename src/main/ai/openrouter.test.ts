import { describe, expect, it, vi } from 'vitest'

import {
  OpenRouterClient,
  PROVIDER_POLICY,
  SEGRETARIO_MODEL,
  SegretarioError,
  errorFromResponse,
  readChatStream,
  sseData
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
    expect(body.session_id).toBe('activity-1')
    expect(body.reasoning).toEqual({ effort: 'none' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
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
