/**
 * OpenRouter, as the Segretario talks to it: chat completions streamed over
 * SSE, the key and its credit, and the errors said in the user's words.
 *
 * The model and the provider are SIEVER Mail's choice, not the user's (see
 * the benchmark of 2026-10-27 in the project notes):
 *   • the model is OpenRouter's alias for the newest DeepSeek Flash, so a
 *     new checkpoint is picked up the day it ships;
 *   • the provider is not named but described: among those that keep no
 *     data and train on none, the cheapest that is fast — at least 150
 *     tokens a second and an answer within a second and a half. It chose
 *     Wafer on the day it was measured, and follows the market after.
 * Every request of a conversation carries its `session_id`, which keeps it
 * on one provider and its cache warm: a long activity costs a tenth.
 */

export const SEGRETARIO_MODEL = '~deepseek/deepseek-flash-latest'

export const PROVIDER_POLICY = {
  zdr: true,
  data_collection: 'deny',
  sort: 'price',
  preferred_min_throughput: 150,
  preferred_max_latency: 1.5
} as const

const API_BASE = 'https://openrouter.ai/api/v1'

/** Who is calling, for OpenRouter's app attribution. */
const ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://github.com/beltromatti/siever-mail',
  'X-OpenRouter-Title': 'SIEVER Mail'
} as const

/** Attempts a request gets when the provider is busy or the network blinks, before a word arrives. */
const MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1_500
/** A stream that goes silent this long is dead: OpenRouter sends a comment every few seconds. */
const STREAM_IDLE_TIMEOUT_MS = 90_000

export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>

/* ──────────────────────────────── messages ──────────────────────────────── */

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: ToolCall[]
      /**
       * The model's reasoning, handed back as it came: DeepSeek refuses a
       * turn with tools whose reasoning was dropped.
       */
      reasoning_details?: unknown[]
    }
  | { role: 'tool'; tool_call_id: string; content: string | ContentPart[] }

export interface ToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  /** `none` keeps the tools in the prefix (for the cache) while the model answers in words. */
  toolChoice?: 'auto' | 'none'
  /** `none` turns the model's thinking off: fast for reading and sorting. */
  reasoningEffort: 'none' | 'low' | 'high'
  maxTokens?: number
  /** Keeps a conversation on one provider, its prefix in the cache. */
  sessionId?: string
  /** An answer in this JSON shape (`json_schema`, strict). */
  responseSchema?: { name: string; schema: Record<string, unknown> }
  temperature?: number
}

export interface ChatUsage {
  promptTokens: number
  cachedTokens: number
  completionTokens: number
  reasoningTokens: number
  /** Dollars, as OpenRouter charged them. */
  cost: number
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  reasoningDetails: unknown[]
  finishReason: string | null
  usage: ChatUsage
  /** The model that answered, concrete ("deepseek/deepseek-v4.1-flash-1017"). */
  model: string | null
  provider: string | null
}

/* ───────────────────────────────── errors ───────────────────────────────── */

export type SegretarioErrorCode =
  | 'no-key'
  | 'invalid-key'
  | 'no-credit'
  | 'blocked'
  | 'rate-limited'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'bad-request'
  | 'cancelled'

/** A failure of the Segretario's service, with what to tell the user. */
export class SegretarioError extends Error {
  constructor(
    readonly code: SegretarioErrorCode,
    message: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'SegretarioError'
  }

  get retryable(): boolean {
    return this.code === 'rate-limited' || this.code === 'unavailable' || this.code === 'network'
  }
}

/** The error OpenRouter answered with, in the user's words. */
export function errorFromResponse(
  status: number,
  body: { error?: { message?: string; code?: number | string; metadata?: unknown } } | null,
  retryAfter: string | null
): SegretarioError {
  const detail = body?.error?.message?.trim()
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : null

  switch (status) {
    case 401:
      return new SegretarioError(
        'invalid-key',
        'OpenRouter non riconosce la chiave: è sbagliata o è stata revocata. Inseriscine una valida in Impostazioni → Segretario.'
      )
    case 402:
      return new SegretarioError(
        'no-credit',
        'Il credito OpenRouter è finito, o la chiave ha raggiunto il suo limite di spesa. Ricarica il credito su openrouter.ai.'
      )
    case 403:
      return new SegretarioError(
        'blocked',
        detail
          ? `OpenRouter ha bloccato la richiesta: ${detail}`
          : 'OpenRouter ha bloccato la richiesta.'
      )
    case 408:
      return new SegretarioError('timeout', 'Il modello ha impiegato troppo a rispondere.')
    case 429:
      return new SegretarioError(
        'rate-limited',
        'OpenRouter sta ricevendo troppe richieste: riprovo tra poco.',
        retryAfterMs
      )
    case 502:
    case 503:
      return new SegretarioError(
        'unavailable',
        'Il servizio del modello non è disponibile in questo momento.',
        retryAfterMs
      )
    default:
      return status >= 500
        ? new SegretarioError('unavailable', 'OpenRouter non risponde come dovrebbe.', retryAfterMs)
        : new SegretarioError(
            'bad-request',
            detail
              ? `Richiesta non accettata da OpenRouter: ${detail}`
              : `Errore ${status} da OpenRouter.`
          )
  }
}

function networkError(error: unknown): SegretarioError {
  if (error instanceof SegretarioError) {
    return error
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new SegretarioError('cancelled', 'Interrotto.')
  }

  return new SegretarioError(
    'network',
    'Non riesco a raggiungere OpenRouter: controlla la connessione a internet.'
  )
}

async function readErrorBody(
  response: Response
): Promise<{ error?: { message?: string; code?: number | string } } | null> {
  try {
    return (await response.json()) as { error?: { message?: string } }
  } catch {
    return null
  }
}

/* ─────────────────────────────── the client ─────────────────────────────── */

export interface KeyCheck {
  /** OpenRouter's label for the key: "sk-or-v1-9b6…138". */
  label: string | null
  limit: number | null
  limitRemaining: number | null
  limitReset: string | null
  /** Credits bought less credits used; null when OpenRouter did not say. */
  balance: number | null
}

export class OpenRouterClient {
  constructor(private readonly fetchImpl: FetchFunction) {}

  /**
   * What OpenRouter says about a key: its label, its own spending limit,
   * and the account's balance. Throws `invalid-key` for a key it does not
   * know.
   */
  async checkKey(key: string, signal?: AbortSignal): Promise<KeyCheck> {
    const [keyInfo, credits] = await Promise.all([
      this.getJson<{
        data?: {
          label?: string
          limit?: number | null
          limit_remaining?: number | null
          limit_reset?: string | null
        }
      }>('/key', key, signal),
      // The balance is the account's; some keys may not read it. Its
      // absence is not a fault of the key.
      this.getJson<{ data?: { total_credits?: number; total_usage?: number } }>(
        '/credits',
        key,
        signal
      ).catch((error: unknown) => {
        if (error instanceof SegretarioError && error.code === 'invalid-key') {
          throw error
        }

        return null
      })
    ])

    const data = keyInfo.data ?? {}
    const totals = credits?.data

    return {
      label: data.label ?? null,
      limit: typeof data.limit === 'number' ? data.limit : null,
      limitRemaining: typeof data.limit_remaining === 'number' ? data.limit_remaining : null,
      limitReset: data.limit_reset ?? null,
      balance:
        typeof totals?.total_credits === 'number' && typeof totals.total_usage === 'number'
          ? totals.total_credits - totals.total_usage
          : null
    }
  }

  /** The concrete model the alias points to, by name ("DeepSeek: DeepSeek V4.1 Flash 1017"). */
  async modelName(key: string, signal?: AbortSignal): Promise<string | null> {
    const models = await this.getJson<{
      data?: Array<{ id: string; alias_target?: { name?: string } }>
    }>('/models', key, signal)

    return models.data?.find((model) => model.id === SEGRETARIO_MODEL)?.alias_target?.name ?? null
  }

  /**
   * One turn of the model, streamed: `onText` hears the answer as it is
   * written. Retries a busy provider or a dropped network before the first
   * word; after it, a broken stream is an error the caller decides on.
   */
  async chat(
    key: string,
    request: ChatRequest,
    options: { signal?: AbortSignal; onText?: (text: string) => void } = {}
  ): Promise<ChatResult> {
    let attempt = 0

    for (;;) {
      attempt += 1
      let started = false

      try {
        return await this.chatOnce(key, request, options.signal, (text) => {
          started = true
          options.onText?.(text)
        })
      } catch (raw) {
        const error = networkError(raw)

        if (!error.retryable || started || attempt >= MAX_ATTEMPTS || options.signal?.aborted) {
          throw error
        }

        await delay(error.retryAfterMs ?? RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), options.signal)
      }
    }
  }

  private async chatOnce(
    key: string,
    request: ChatRequest,
    signal: AbortSignal | undefined,
    onText: (text: string) => void
  ): Promise<ChatResult> {
    const body = {
      model: SEGRETARIO_MODEL,
      messages: request.messages,
      stream: true,
      provider: PROVIDER_POLICY,
      reasoning: { effort: request.reasoningEffort },
      ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.sessionId ? { session_id: request.sessionId } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.responseSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.responseSchema.name,
                strict: true,
                schema: request.responseSchema.schema
              }
            }
          }
        : {})
    }

    const response = await this.fetchImpl(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...ATTRIBUTION_HEADERS
      },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok || !response.body) {
      throw errorFromResponse(
        response.status,
        await readErrorBody(response),
        response.headers.get('retry-after')
      )
    }

    return readChatStream(response.body, onText, signal)
  }

  private async getJson<T>(path: string, key: string, signal?: AbortSignal): Promise<T> {
    let response: Response

    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${key}`, ...ATTRIBUTION_HEADERS },
        signal
      })
    } catch (error) {
      throw networkError(error)
    }

    if (!response.ok) {
      throw errorFromResponse(
        response.status,
        await readErrorBody(response),
        response.headers.get('retry-after')
      )
    }

    return (await response.json()) as T
  }
}

/* ──────────────────────────────── streaming ──────────────────────────────── */

interface StreamChunk {
  model?: string
  provider?: string
  error?: { message?: string; code?: number | string }
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_details?: unknown[]
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

/**
 * The events of an SSE stream, one `data` payload at a time. Comments
 * (`: OPENROUTER PROCESSING`) keep the line open and carry nothing; a
 * payload may span several `data:` lines.
 */
export async function* sseData(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []

  const nextChunk = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new SegretarioError('timeout', 'Il modello ha smesso di rispondere.')),
        STREAM_IDLE_TIMEOUT_MS
      )

      reader.read().then(
        (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new SegretarioError('cancelled', 'Interrotto.')
      }

      const { done, value } = await nextChunk()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      let newline: number

      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)

        if (line === '') {
          if (data.length > 0) {
            yield data.join('\n')
            data = []
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
    }

    if (data.length > 0) {
      yield data.join('\n')
    }
  } finally {
    reader.releaseLock()
    void stream.cancel().catch(() => undefined)
  }
}

/** Gathers a streamed completion: the text, the tool calls by index, the reasoning, the bill. */
export async function readChatStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  signal?: AbortSignal
): Promise<ChatResult> {
  const result: ChatResult = {
    content: '',
    toolCalls: [],
    reasoningDetails: [],
    finishReason: null,
    usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0 },
    model: null,
    provider: null
  }
  const calls = new Map<number, ToolCall>()

  for await (const payload of sseData(stream, signal)) {
    if (payload === '[DONE]') {
      break
    }

    let chunk: StreamChunk

    try {
      chunk = JSON.parse(payload) as StreamChunk
    } catch {
      continue
    }

    // An error after the stream began comes as a chunk of its own, with
    // the HTTP status long since sent as 200.
    if (chunk.error) {
      const code = Number(chunk.error.code)
      throw errorFromResponse(Number.isFinite(code) ? code : 502, { error: chunk.error }, null)
    }

    result.model ??= chunk.model ?? null
    result.provider ??= chunk.provider ?? null

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta

      if (delta?.content) {
        result.content += delta.content
        onText(delta.content)
      }

      if (delta?.reasoning_details) {
        result.reasoningDetails.push(...delta.reasoning_details)
      }

      for (const call of delta?.tool_calls ?? []) {
        const known = calls.get(call.index)

        if (known) {
          known.function.arguments += call.function?.arguments ?? ''
          known.function.name ||= call.function?.name ?? ''
        } else {
          calls.set(call.index, {
            id: call.id ?? `call_${call.index}`,
            type: 'function',
            function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' }
          })
        }
      }

      if (choice.finish_reason) {
        result.finishReason = choice.finish_reason
      }
    }

    if (chunk.usage) {
      result.usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cost: chunk.usage.cost ?? 0
      }
    }
  }

  result.toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
  return result
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new SegretarioError('cancelled', 'Interrotto.'))
      },
      { once: true }
    )
  })
}
