import { randomUUID } from 'node:crypto'

import type { ActivityEvent, ActivityStatus, SendOutcome } from '@shared/segretario'

import { logMainError } from '../../utils/error-utils'
import type { AiStore, StoredEvent } from '../ai-store'
import type { Reachability } from '../engine/reachability'
import type { Notebook } from '../memory/notebook'
import {
  SegretarioError,
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
  editor?: RunContext['editor']
  /**
   * What the task must leave and has not, when the model stops: a line to
   * tell it, or null when the work is complete.
   */
  missing?: (run: RunContext) => Promise<string | null>
  /** Stops the run from outside: the scheduler, the user. */
  signal?: AbortSignal
  /** The revisions of what the run's starting data showed it. */
  seen?: ReadonlyMap<string, number>
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
}

/**
 * The loop every run of the Segretario turns — the chat and the work it
 * does on its own alike: the model writes, calls its tools, reads what
 * they found, and goes on until the work is done. How many turns, how long,
 * how deep it thinks, how much it writes: the model's. The harness is plain
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

  cancelAll(): void {
    for (const run of this.live.values()) {
      run.controller.abort()
    }
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
    const controller = new AbortController()
    const context: RunContext = {
      activityId: id,
      task: options.task,
      startedAt: Date.now(),
      background: options.background,
      watched: options.watched ?? !options.background,
      actor: { by: 'segretario', runId: id, background: options.background },
      seen: new Map([...(this.seenByConversation.get(id) ?? []), ...(options.seen ?? [])]),
      changes: [],
      results: {},
      editor: options.editor ?? null,
      fileSearches: new Map()
    }
    const live: LiveRun = { context, controller, approvals: new Map(), failedCalls: new Map() }
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
              { messages: buildConversation(system, events), tools, sessionId: id },
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
            text: missing,
            forModel: missing,
            handles: [],
            origin: 'segretario'
          })
          this.emitEntry(id, nudge)
          continue
        }

        // Written past the length the provider gives one answer, the calls' arguments are cut:
        // said as such.
        const truncated = result.finishReason === 'length'
        const outcomes = await Promise.all(
          result.toolCalls.map((call) => this.runTool(live, call, handles, truncated))
        )
        stalled = outcomes.some((progressed) => progressed) ? 0 : stalled + 1
        this.stopIfStuck(stalled)
        await this.manageContext(id, key, system, result.usage.promptTokens, signal)
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
          error?.message ??
          (raw instanceof Error ? raw.message : 'Qualcosa è andato storto mentre lavoravo.')

        if (!error) {
          logMainError('Segretario run failed', raw, { activityId: id, task: options.task })
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
        approval.reject(new SegretarioError('cancelled', 'Interrotto.'))
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
      await this.emitSummary(id)
    }

    return { status: ended, run: context, error: ended === 'done' ? null : failure }
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
      const again = live.failedCalls.has(signature)
      live.failedCalls.set(signature, 'other')
      await finish({
        status: 'error',
        summary: tool ? 'Argomenti non validi' : `Strumento sconosciuto: ${call.function.name}`,
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
        summary: 'Già provato così',
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
        await finish({ status: 'error', summary: 'Interrotto', result: 'Interrotto.' })
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)

      // What changed under the call is now seen: the same call may be made again, knowingly.
      if (!(error instanceof ToolConflict)) {
        live.failedCalls.set(signature, error instanceof UnknownHandle ? 'name' : 'other')
      }

      if (!(error instanceof ToolInputError)) {
        logMainError(`Segretario tool ${tool.name} failed`, error, { activityId })
      }

      await finish({
        status: 'error',
        summary: `Non riuscito: ${message.slice(0, 120)}`,
        result: `Errore: ${message}`,
        handles: context.newHandles
      })
      return error instanceof ToolConflict
    }
  }

  /** A run that got nowhere for too many turns in a row stops: it fails, and says so. */
  private stopIfStuck(stalled: number): void {
    if (stalled >= TURNS_WITHOUT_PROGRESS) {
      throw new SegretarioError(
        'stuck',
        `Mi sono fermato: da ${TURNS_WITHOUT_PROGRESS} passaggi di fila non riuscivo ad andare avanti.`
      )
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

        reachability.failed(startedAt)
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
            () => reject(new SegretarioError('cancelled', 'Interrotto.')),
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
