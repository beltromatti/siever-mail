import { randomUUID } from 'node:crypto'

import type { DiagnosticFields } from '@shared/diagnostics'
import { defineMessages } from '@shared/i18n'
import type { ActivityEvent, ActivityStatus, SendOutcome } from '@shared/segretario'

import { diagnostics } from '@main/diagnostics/log'
import { messages } from '../../i18n'
import type { AiStore, StoredEvent } from '../ai-store'
import type { Reachability } from '../engine/reachability'
import type { Notebook } from '../memory/notebook'
import {
  SegretarioError,
  type ChatResult,
  type GenerationBill,
  type OpenRouterClient,
  type ToolCall
} from '../openrouter'
import { PROMPTS, systemPrompt } from '../prompts'
import type { Registry } from '../registry/registry'
import type { Actor, RegistryChange } from '../registry/types'
import { toolDefinitions } from '../tools'
import {
  buildConversation,
  handleRecords,
  type ApprovalPayload,
  type AssistantPayload,
  type ChangesPayload,
  type CompactionPayload,
  type ErrorPayload,
  type ToolPayload,
  type UserPayload
} from './conversation'
import { entryOf } from './entries'
import { HandleRegistry } from './handles'
import {
  ToolConflict,
  ToolInputError,
  UnknownHandle,
  type RunContext,
  type SegretarioCalendarPort,
  type SegretarioMailPort,
  type SegretarioPagePort,
  type SegretarioTool,
  type TaskKind,
  type ToolContext
} from './tool-types'

const log = diagnostics('segretario')

/** A step that failed: why, and whether that was said to the model alone, in its Italian. */
interface StepFailure {
  detail: string
  forModel: boolean
}

/** What the user sees of a run's steps and of its end, in the interface's language. */
const MESSAGES = defineMessages({
  alreadyWorking: {
    en: 'I’m already working on this.',
    it: 'Sto già lavorando su questo.',
    de: 'Ich arbeite bereits daran.'
  },
  somethingWrong: {
    en: 'Something went wrong while I was working.',
    it: 'Qualcosa è andato storto mentre lavoravo.',
    de: 'Bei der Arbeit ist etwas schiefgegangen.'
  },
  stopped: { en: 'Stopped', it: 'Interrotto', de: 'Unterbrochen' },
  stoppedError: { en: 'Stopped.', it: 'Interrotto.', de: 'Unterbrochen.' },
  invalidArguments: {
    en: 'Invalid arguments',
    it: 'Argomenti non validi',
    de: 'Ungültige Argumente'
  },
  unknownTool: {
    en: (name: string) => `Unknown tool: ${name}`,
    it: (name: string) => `Strumento sconosciuto: ${name}`,
    de: (name: string) => `Unbekanntes Werkzeug: ${name}`
  },
  triedAlready: {
    en: 'Already tried this way',
    it: 'Già provato così',
    de: 'Schon so versucht'
  },
  /**
   * A step that failed, with why — unless why was said to the model, in its
   * Italian (a `ToolInputError`): the Italian interface shows it, the others not.
   */
  failed: {
    en: ({ detail, forModel }: StepFailure) => (forModel ? 'Failed' : `Failed: ${detail}`),
    it: ({ detail }: StepFailure) => `Non riuscito: ${detail}`,
    de: ({ detail, forModel }: StepFailure) =>
      forModel ? 'Fehlgeschlagen' : `Fehlgeschlagen: ${detail}`
  },
  stuck: {
    en: (turns: number) => `I stopped: for ${turns} steps in a row I couldn’t move forward.`,
    it: (turns: number) =>
      `Mi sono fermato: da ${turns} passaggi di fila non riuscivo ad andare avanti.`,
    de: (turns: number) => `Ich habe angehalten: ${turns} Schritte in Folge kam ich nicht weiter.`
  }
})

/**
 * What a run's task still asks for, when the model stops short of it: told
 * to the model, and shown as the run's own line in the panel.
 */
export interface StillMissing {
  forModel: string
  /** In the interface's language. */
  shown: string
}

/** A turn's answer, counted into how the run went. */
function countTurn(stats: RunStats, result: ChatResult): void {
  stats.turns += 1
  stats.promptTokens += result.usage.promptTokens
  stats.cachedTokens += result.usage.cachedTokens
  stats.completionTokens += result.usage.completionTokens
  stats.reasoningTokens += result.usage.reasoningTokens
  stats.cost += result.usage.cost
  stats.model = result.model ?? stats.model
  stats.provider = result.provider ?? stats.provider
}

/**
 * How a run's end is written: done or stopped as information, failed as a
 * warning with why — the Segretario's own error, not the program's (§14.2).
 */
function endedLog(
  status: ActivityStatus,
  failure: Error | null
): (ev: string, fields: DiagnosticFields) => void {
  return status === 'failed'
    ? (ev, fields) => log.warn(ev, { ...fields, err: failure ?? undefined })
    : (ev, fields) => log.info(ev, fields)
}

/**
 * The share of the model's context past which the older part of a run is
 * summarised: near the edge, so a run keeps everything it read for as long
 * as the model can hold it — cached, what stays costs little — with room
 * left for the summary and the turns after it.
 */
const COMPACT_AT_SHARE = 0.85
/**
 * Turns in a row that get nowhere — every call failing or refused, or the
 * task's result asked for and not left — after which a run stops as stuck.
 * Not a limit on how much a run works or reads: only on turning in place.
 */
const TURNS_WITHOUT_PROGRESS = 10

/**
 * How much the Segretario thinks, by task — always, never off. `max` where
 * the work is deep and nobody hurries it: getting to know the user, keeping
 * the memory, learning from corrections, the day's letter, a conversation
 * the user opened. `low` where the work is many small readings, or the user
 * waits on it as on a button: each message, the calendar's changes, "Il
 * punto" of a project opened, the writing in the editor, the reread before
 * sending, the search in words. How long it thinks within that is the model's.
 */
export const TASK_EFFORT: Readonly<Record<TaskKind, 'low' | 'max'>> = {
  richiesta: 'max',
  conoscimi: 'max',
  al_passo: 'max',
  riflessione: 'max',
  giornata: 'max',
  lettura: 'low',
  calendario: 'low',
  punto: 'low',
  revisione: 'low',
  ricerca: 'low'
}
const STREAM_FLUSH_MS = 60

export interface RunnerDeps {
  client: OpenRouterClient
  /** Whether OpenRouter answers: a run that cannot reach it waits there, and goes on. */
  reachability: Reachability
  /** How many tokens the model reads at once. */
  contextLength(): Promise<number>
  store: AiStore
  registry: Registry
  notebook: Notebook
  tools: ReadonlyArray<SegretarioTool>
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  page: SegretarioPagePort
  requireKey(): Promise<string>
  emit(event: ActivityEvent): void
  recordUsage(activityId: string | null, purpose: string, result: GenerationBill): Promise<void>
}

export interface RunOptions {
  activityId: string
  task: TaskKind
  background: boolean
  /** The user sees the run and can confirm; by default, any run that is not on its own. */
  watched?: boolean
  /**
   * What the task must leave and has not, when the model stops: a line to
   * tell it, or null when the work is complete.
   */
  missing?: (run: RunContext) => Promise<StillMissing | null>
  /** Stops the run from outside: the scheduler, the user. */
  signal?: AbortSignal
  /** The revisions of what the run's starting data showed it. */
  seen?: ReadonlyMap<string, number>
  /** What it looks at as its source changed (see `RunContext.looking`). */
  looking?: ReadonlyArray<string>
  /**
   * A turn of a conversation: what the earlier turns read is still read, so a
   * write over what changed since is refused in this turn too.
   */
  conversation?: boolean
}

export interface RunResult {
  status: ActivityStatus
  run: RunContext
  /** What stopped it, for a run that did not finish. */
  error: SegretarioError | Error | null
}

interface LiveRun {
  context: RunContext
  controller: AbortController
  /** Settled once the run is over and has written all it will: what waits for it to stop. */
  ended: PromiseWithResolvers<void>
  approvals: Map<
    string,
    {
      eventId: number
      payload: ApprovalPayload
      resolve: (answer: { approved: boolean; outcome?: SendOutcome }) => void
      reject: (error: Error) => void
    }
  >
  /**
   * The calls that failed in this run, as made — one is not made again as it
   * was — with whether the failure was a name the run lacked.
   */
  failedCalls: Map<string, 'name' | 'other'>
  /** How the run went, for the diagnostics (§14.4): its turns, its calls, what they cost. */
  stats: RunStats
}

interface RunStats {
  turns: number
  tools: number
  /** Calls that did not get through: failed, refused, made again as they had failed. */
  toolErrors: number
  /** Of those, calls whose arguments came broken or unreadable (§2.3). */
  argsInvalid: number
  promptTokens: number
  cachedTokens: number
  completionTokens: number
  reasoningTokens: number
  cost: number
  model: string | null
  provider: string | null
}

/**
 * The loop every run of the Segretario turns — the chat and the work it
 * does on its own alike: the model writes, calls its tools, reads what
 * they found, and goes on until the work is done. How many turns, how long,
 * how much it writes: the model's; how deep it thinks, by the task
 * (`TASK_EFFORT`), within which the model decides. The harness is plain
 * on purpose; what it keeps is what cannot be left to the model: the user's
 * confirmation before anything leaves, the log every run is rebuilt from,
 * the model's own context (compacted near its edge), the wait for a model
 * that does not answer, what its task must leave behind, and a stop for a
 * run that only turns in place.
 */
export class AgentRunner {
  private readonly live = new Map<string, LiveRun>()
  /** What each conversation in the panel has read, by revision: kept from one turn to the next. */
  private readonly seenByConversation = new Map<string, Map<string, number>>()

  constructor(private readonly deps: RunnerDeps) {}

  forgetSeen(activityId: string): void {
    this.seenByConversation.delete(activityId)
  }

  /** A change to the user's work, by a run: it goes on that run's page of the diary. */
  recordChange(change: RegistryChange, actor: Actor): void {
    if (actor.runId) {
      this.live.get(actor.runId)?.context.changes.push(change)
    }
  }

  isRunning(activityId: string): boolean {
    return this.live.has(activityId)
  }

  runningIds(): string[] {
    return [...this.live.keys()]
  }

  cancel(activityId: string): void {
    this.live.get(activityId)?.controller.abort()
  }

  /** Stops a run, and waits until it has written all it will. */
  async stop(activityId: string): Promise<void> {
    const live = this.live.get(activityId)

    if (live) {
      live.controller.abort()
      await live.ended.promise
    }
  }

  cancelAll(): void {
    for (const run of this.live.values()) {
      run.controller.abort()
    }
  }

  /** Stops every run, and waits until each has written all it will. */
  async stopAll(): Promise<void> {
    const runs = [...this.live.values()]
    this.cancelAll()
    await Promise.all(runs.map((run) => run.ended.promise))
  }

  /** The user's answer to a confirmation a run asked for. */
  async resolveApproval(
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: SendOutcome
  ): Promise<void> {
    this.live.get(activityId)?.approvals.get(approvalId)?.resolve({ approved, outcome })
  }

  async run(options: RunOptions): Promise<RunResult> {
    const { store } = this.deps
    const id = options.activityId

    // One run at a time writes an activity's log: a second — "Riprova" pressed twice, a message
    // on top of it — would write into the same conversation.
    if (this.live.has(id)) {
      throw new SegretarioError('cancelled', messages(MESSAGES).alreadyWorking)
    }

    const controller = new AbortController()
    const context: RunContext = {
      activityId: id,
      task: options.task,
      startedAt: Date.now(),
      background: options.background,
      watched: options.watched ?? !options.background,
      actor: { by: 'segretario', runId: id, background: options.background },
      seen: new Map([...(this.seenByConversation.get(id) ?? []), ...(options.seen ?? [])]),
      looking: new Set(options.looking ?? []),
      changes: [],
      results: {},
      fileSearches: new Map()
    }
    const live: LiveRun = {
      context,
      controller,
      ended: Promise.withResolvers<void>(),
      approvals: new Map(),
      failedCalls: new Map(),
      stats: {
        turns: 0,
        tools: 0,
        toolErrors: 0,
        argsInvalid: 0,
        promptTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        model: null,
        provider: null
      }
    }
    const { signal } = controller
    let ended: ActivityStatus = 'failed'
    let failure: SegretarioError | Error | null = null
    /** Turns in a row that got nowhere. */
    let stalled = 0

    // Stopped before it began (the AI switched off, the computer asleep): it does not run.
    if (options.signal?.aborted) {
      controller.abort()
    }

    options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    this.live.set(id, live)
    log.info('run.start', {
      run: id,
      task: options.task,
      background: options.background,
      by: options.background ? 'system' : 'user'
    })
    await store.updateActivity(id, { status: 'running' })
    await this.emitSummary(id)

    try {
      const key = await this.deps.requireKey()
      const system = await systemPrompt()
      const tools = toolDefinitions(this.deps.tools)

      for (;;) {
        signal.throwIfAborted()
        const events = await store.listEvents(id)
        const handles = new HandleRegistry(handleRecords(events))
        let streamed = ''
        let flushTimer: ReturnType<typeof setTimeout> | null = null
        const stopStream = (): void => {
          if (flushTimer) {
            clearTimeout(flushTimer)
            flushTimer = null
          }
        }

        const result = await this.reach(
          signal,
          () =>
            this.deps.client.chat(
              key,
              {
                messages: buildConversation(system, events),
                tools,
                reasoningEffort: TASK_EFFORT[options.task],
                sessionId: id
              },
              {
                signal,
                onLateBill: (bill) => this.deps.recordUsage(id, options.task, bill),
                onText: (text) => {
                  streamed += text
                  flushTimer ??= setTimeout(() => {
                    flushTimer = null
                    this.deps.emit({ type: 'stream', activityId: id, text: streamed })
                  }, STREAM_FLUSH_MS)
                }
              }
            ),
          // Cut off mid-answer: what was shown of it goes, the turn is written again.
          () => {
            stopStream()
            streamed = ''
            this.deps.emit({ type: 'stream', activityId: id, text: '' })
          }
        )

        stopStream()
        countTurn(live.stats, result)

        await this.deps.recordUsage(id, options.task, result)
        const assistant = await store.appendEvent<AssistantPayload>(id, 'assistant', {
          content: result.content,
          toolCalls: result.toolCalls,
          reasoningDetails: result.reasoningDetails
        })

        this.deps.emit({ type: 'stream', activityId: id, text: '' })
        this.emitEntry(id, assistant)

        if (result.toolCalls.length === 0) {
          const missing = options.missing ? await options.missing(context) : null

          if (!missing) {
            break
          }

          // Stopped short of what its task must leave: told what is missing, for as long as it
          // gets somewhere.
          stalled += 1
          this.stopIfStuck(stalled)
          const nudge = await store.appendEvent<UserPayload>(id, 'user', {
            text: missing.shown,
            forModel: missing.forModel,
            handles: [],
            origin: 'segretario'
          })
          this.emitEntry(id, nudge)
          continue
        }

        // Written past the length the provider gives one answer, the calls' arguments are cut:
        // said as such.
        const truncated = result.finishReason === 'length'
        const outcomes = await this.runTurn(live, result.toolCalls, handles, truncated)
        stalled = outcomes.some((progressed) => progressed) ? 0 : stalled + 1
        this.stopIfStuck(stalled)
        await this.manageContext(id, key, system, options.task, result.usage.promptTokens, signal)
      }

      await store.updateActivity(id, { status: 'done', unseen: !options.background })
      ended = 'done'
    } catch (raw) {
      const error = raw instanceof SegretarioError ? raw : null
      failure = raw instanceof Error ? raw : new Error(String(raw))

      if (signal.aborted || error?.code === 'cancelled') {
        await store.updateActivity(id, { status: 'cancelled' })
        ended = 'cancelled'
      } else {
        const message =
          error?.message ?? (raw instanceof Error ? raw.message : messages(MESSAGES).somethingWrong)

        if (!error) {
          log.failed('run.failed', raw, { run: id, task: options.task })
        }

        const event = await store.appendEvent<ErrorPayload>(id, 'error', {
          code: error?.code ?? 'internal',
          message
        })
        this.emitEntry(id, event)
        await store.updateActivity(id, { status: 'failed', unseen: !options.background })
      }
    } finally {
      for (const approval of live.approvals.values()) {
        approval.reject(new SegretarioError('cancelled', messages(MESSAGES).stoppedError))
      }

      if (options.conversation) {
        this.seenByConversation.set(id, context.seen)
      }

      if (context.changes.length > 0) {
        const event = await store.appendEvent<ChangesPayload>(id, 'changes', {
          changes: context.changes
        })
        this.emitEntry(id, event)
      }

      this.live.delete(id)
      live.ended.resolve()
      endedLog(ended, failure)('run.end', {
        run: id,
        task: options.task,
        background: options.background,
        status: ended,
        ms: Date.now() - context.startedAt,
        changes: context.changes.length,
        ...live.stats,
        cost: Math.round(live.stats.cost * 1_000_000) / 1_000_000
      })
      await this.emitSummary(id)
    }

    return { status: ended, run: context, error: ended === 'done' ? null : failure }
  }

  /**
   * A turn's calls: those that only read go together; one that may write
   * waits for what comes before it and goes alone — so it sees, as written,
   * what the turn wrote before it, and a run never conflicts with itself
   * (§4.6). In the order the model asked them.
   */
  private async runTurn(
    live: LiveRun,
    calls: ReadonlyArray<ToolCall>,
    handles: HandleRegistry,
    truncated: boolean
  ): Promise<boolean[]> {
    const outcomes: boolean[] = []
    let reading: Array<Promise<boolean>> = []

    for (const call of calls) {
      if (this.readsOnly(call)) {
        reading.push(this.runTool(live, call, handles, truncated))
        continue
      }

      outcomes.push(...(await Promise.all(reading)))
      reading = []
      outcomes.push(await this.runTool(live, call, handles, truncated))
    }

    outcomes.push(...(await Promise.all(reading)))
    return outcomes
  }

  /** Whether a call only reads, as its tool says; one it cannot tell of, it takes as writing. */
  private readsOnly(call: ToolCall): boolean {
    const tool = this.deps.tools.find((candidate) => candidate.name === call.function.name)

    try {
      const args: unknown = call.function.arguments.trim()
        ? JSON.parse(call.function.arguments)
        : {}
      return Boolean(
        tool?.readsOnly &&
        args &&
        typeof args === 'object' &&
        tool.readsOnly(args as Record<string, unknown>)
      )
    } catch {
      return false
    }
  }

  /**
   * Runs one call, and says whether it got the work anywhere: done — even in
   * part — or refused for a change made meanwhile, which shows the run how
   * things are now. A call that failed, or was refused as made before, did not.
   */
  private async runTool(
    live: LiveRun,
    call: ToolCall,
    handles: HandleRegistry,
    truncated = false
  ): Promise<boolean> {
    const { store } = this.deps
    const activityId = live.context.activityId
    const tool = this.deps.tools.find((candidate) => candidate.name === call.function.name)
    let args: Record<string, unknown> = {}
    let argsProblem: string | null = null
    live.stats.tools += 1

    try {
      const parsed = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {}
      args = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      argsProblem = truncated
        ? 'La chiamata si è interrotta: era più lunga di quanto un passo possa scrivere. Rifalla più breve, o dividila in più chiamate.'
        : 'Gli argomenti non sono JSON valido: riprova.'
    }

    const payload: ToolPayload = {
      callId: call.id,
      name: call.function.name,
      args,
      status: 'running',
      summary: tool ? tool.running(args) : call.function.name,
      handles: []
    }
    const event = await store.appendEvent(activityId, 'tool', payload)
    this.emitEntry(activityId, event)

    const finish = async (changes: Partial<ToolPayload>): Promise<void> => {
      if (changes.status === 'error') {
        live.stats.toolErrors += 1
      }

      Object.assign(payload, changes)
      await store.updateEvent(event.id, payload)
      this.emitEntry(activityId, { ...event, payload })
    }

    // A call that failed, made again as it was, fails again: said so instead of tried.
    const signature = `${call.function.name}\u0000${
      argsProblem
        ? call.function.arguments
        : JSON.stringify(
            Object.keys(args)
              .sort()
              .map((name) => [name, args[name]])
          )
    }`

    if (!tool || argsProblem) {
      live.stats.argsInvalid += argsProblem ? 1 : 0
      const again = live.failedCalls.has(signature)
      live.failedCalls.set(signature, 'other')
      await finish({
        status: 'error',
        summary: tool
          ? messages(MESSAGES).invalidArguments
          : messages(MESSAGES).unknownTool(call.function.name),
        result: again
          ? 'Hai già fatto esattamente questa chiamata e non è riuscita: non ripeterla uguale.'
          : (argsProblem ??
            `Non esiste lo strumento «${call.function.name}»: usa uno di ${this.deps.tools.map((candidate) => candidate.name).join(', ')}.`)
      })
      return false
    }

    if (live.failedCalls.has(signature)) {
      await finish({
        status: 'error',
        summary: messages(MESSAGES).triedAlready,
        result:
          "Hai già fatto esattamente questa chiamata e non è riuscita: non ripeterla uguale. Rileggi l'errore e rifalla diversa, o lascia stare."
      })
      return false
    }

    const context: ToolContext = {
      run: live.context,
      signal: live.controller.signal,
      handles,
      newHandles: [],
      mail: this.deps.mail,
      calendar: this.deps.calendar,
      page: this.deps.page,
      registry: this.deps.registry,
      notebook: this.deps.notebook,
      store,
      requestApproval: (request) => this.requestApproval(live, call.id, request)
    }

    try {
      const outcome = await tool.execute(args, context)

      if (outcome.failed) {
        live.failedCalls.set(signature, 'other')
      } else if (context.newHandles.length > 0) {
        // New names: a call that failed on a name it did not have yet may be right now.
        for (const [failed, why] of live.failedCalls) {
          if (why === 'name') {
            live.failedCalls.delete(failed)
          }
        }
      }

      await finish({
        status: outcome.failed ? 'error' : 'done',
        summary: outcome.summary,
        result: outcome.content,
        messages: outcome.messages,
        files: outcome.files,
        handles: context.newHandles
      })
      return !outcome.failed
    } catch (error) {
      if (error instanceof SegretarioError && error.code === 'cancelled') {
        await finish({
          status: 'error',
          summary: messages(MESSAGES).stopped,
          result: 'Interrotto.'
        })
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)

      // What changed under the call is now seen: the same call may be made again, knowingly.
      if (!(error instanceof ToolConflict)) {
        live.failedCalls.set(signature, error instanceof UnknownHandle ? 'name' : 'other')
      }

      if (error instanceof ToolInputError) {
        // Arguments missing or wrong: the model's, and how often a provider breaks them (§2.3).
        live.stats.argsInvalid += 1
      } else {
        log.failed('tool.failed', error, { run: activityId, tool: tool.name })
      }

      await finish({
        status: 'error',
        summary: messages(MESSAGES).failed({
          detail: message.slice(0, 120),
          forModel: error instanceof ToolInputError
        }),
        result: `Errore: ${message}`,
        handles: context.newHandles
      })
      return error instanceof ToolConflict
    }
  }

  /** A run that got nowhere for too many turns in a row stops: it fails, and says so. */
  private stopIfStuck(stalled: number): void {
    if (stalled >= TURNS_WITHOUT_PROGRESS) {
      throw new SegretarioError('stuck', messages(MESSAGES).stuck(TURNS_WITHOUT_PROGRESS))
    }
  }

  /**
   * A call to the model that waits for it: with OpenRouter or the network
   * away, the run does not fail — it waits (`Reachability`) and makes the
   * same call again, from the same log, for as long as it takes. A call cut
   * off midway is said (`onRetry`) before it is made again.
   */
  private async reach<T>(
    signal: AbortSignal,
    call: () => Promise<T>,
    onRetry?: () => void
  ): Promise<T> {
    const { reachability } = this.deps

    for (;;) {
      await reachability.wait(signal)
      const startedAt = Date.now()

      try {
        const result = await call()
        reachability.answered()
        return result
      } catch (error) {
        if (!(error instanceof SegretarioError) || !error.unreachable || signal.aborted) {
          throw error
        }

        reachability.failed(startedAt, error)
        onRetry?.()
      }
    }
  }

  private async requestApproval(
    live: LiveRun,
    callId: string,
    request: Omit<ApprovalPayload, 'approvalId' | 'status' | 'callId'>
  ): Promise<{ approved: boolean; outcome?: SendOutcome }> {
    if (!live.context.watched) {
      throw new ToolInputError(
        live.context.background
          ? 'In questo lavoro non puoi chiedere conferma all’utente: proponilo invece di farlo.'
          : "L'utente non ha davanti questa conversazione e non può confermare: non farlo da qui."
      )
    }

    const { store } = this.deps
    const activityId = live.context.activityId
    const payload: ApprovalPayload = {
      ...request,
      approvalId: randomUUID(),
      status: 'pending',
      callId
    }
    const event = await store.appendEvent(activityId, 'approval', payload)
    this.emitEntry(activityId, event)
    await store.updateActivity(activityId, { status: 'waiting', unseen: true })
    await this.emitSummary(activityId)

    try {
      const answer = await new Promise<{ approved: boolean; outcome?: SendOutcome }>(
        (resolve, reject) => {
          live.approvals.set(payload.approvalId, { eventId: event.id, payload, resolve, reject })
          live.controller.signal.addEventListener(
            'abort',
            () => reject(new SegretarioError('cancelled', messages(MESSAGES).stoppedError)),
            { once: true }
          )
        }
      )

      payload.status = answer.approved ? 'approved' : 'rejected'
      return answer
    } catch (error) {
      payload.status = 'rejected'
      throw error
    } finally {
      live.approvals.delete(payload.approvalId)
      await store.updateEvent(event.id, payload)
      this.emitEntry(activityId, { ...event, payload })
      await store.updateActivity(activityId, { status: 'running' })
      await this.emitSummary(activityId)
    }
  }

  /**
   * Keeps the run within what the model reads at once: near the edge of its
   * context, the older part of the run is summarised (`compattazione.md`)
   * and the summary takes its place; the step under way — its calls and what
   * they found — stays word for word. The log keeps everything, and every
   * reference still reads again.
   */
  private async manageContext(
    id: string,
    key: string,
    system: string,
    task: TaskKind,
    promptTokens: number,
    signal: AbortSignal
  ): Promise<void> {
    const { store } = this.deps
    const contextLength = await this.reach(signal, () => this.deps.contextLength())

    if (promptTokens < contextLength * COMPACT_AT_SHARE) {
      return
    }

    const events = await store.listEvents(id)
    const lastStep = events.findLast((event) => event.type === 'assistant')
    const coveredUntil = events.findLast((event) => lastStep && event.id < lastStep.id)?.id ?? 0
    const compacted = events.findLast((event) => event.type === 'compaction')?.payload as
      CompactionPayload | undefined

    // Nothing older than the step under way left to summarise.
    if (coveredUntil <= (compacted?.coveredUntil ?? 0)) {
      return
    }

    const result = await this.reach(signal, () =>
      this.deps.client.chat(
        key,
        {
          messages: [
            ...buildConversation(system, events),
            { role: 'user', content: PROMPTS.compaction }
          ],
          tools: toolDefinitions(this.deps.tools),
          toolChoice: 'none',
          // Summarised as deeply as the work it stands for is done.
          reasoningEffort: TASK_EFFORT[task],
          sessionId: id
        },
        { signal, onLateBill: (bill) => this.deps.recordUsage(id, 'compattazione', bill) }
      )
    )

    await this.deps.recordUsage(id, 'compattazione', result)
    const event = await store.appendEvent<CompactionPayload>(id, 'compaction', {
      summary: result.content.trim(),
      coveredUntil
    })
    this.emitEntry(id, event)
  }

  private async emitSummary(id: string): Promise<void> {
    const summary = await this.deps.store.getActivity(id)

    if (summary) {
      this.deps.emit({ type: 'summary', activity: summary })
    }
  }

  private emitEntry(activityId: string, event: StoredEvent): void {
    const entry = entryOf(event)

    if (entry) {
      this.deps.emit({ type: 'entry', activityId, entry })
    }
  }
}
