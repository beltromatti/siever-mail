import { randomUUID } from 'node:crypto'

import type { ActivityEvent, ActivityStatus, SendOutcome } from '@shared/segretario'

import { logMainError } from '../../utils/error-utils'
import type { AiStore, StoredEvent } from '../ai-store'
import type { Notebook } from '../memory/notebook'
import {
  SegretarioError,
  type ChatResult,
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
  type ClearingPayload,
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
  type RunContext,
  type SegretarioCalendarPort,
  type SegretarioMailPort,
  type SegretarioPagePort,
  type SegretarioTool,
  type TaskKind,
  type ToolContext
} from './tool-types'

const MAX_STEPS_PER_TURN = 80
/** Tokens the model may write in one step: a long draft, its reasoning, several calls. */
const MAX_TOKENS_PER_TURN = 16_000
/** Past this many tokens of prompt, old tool results are cleared; past the next, the old part is summarised. */
const CLEAR_TOOL_RESULTS_AT = 60_000
const RECENT_TOOL_RESULTS_KEPT = 8
const COMPACT_AT = 140_000
/** How often a run that stops short of its task is told what is missing. */
const MAX_NUDGES = 2
const STREAM_FLUSH_MS = 60

export interface RunnerDeps {
  client: OpenRouterClient
  store: AiStore
  registry: Registry
  notebook: Notebook
  tools: ReadonlyArray<SegretarioTool>
  mail: SegretarioMailPort
  calendar: SegretarioCalendarPort
  page: SegretarioPagePort
  requireKey(): Promise<string>
  emit(event: ActivityEvent): void
  recordUsage(activityId: string | null, purpose: string, result: ChatResult): Promise<void>
}

export interface RunOptions {
  activityId: string
  task: TaskKind
  background: boolean
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
  /** The calls that failed in this run, by tool and arguments: one is not made again as it was. */
  failedCalls: Set<string>
}

/**
 * The loop every run of the Segretario turns — the chat and the work it
 * does on its own alike: the model writes, calls its tools, reads what
 * they found, and goes on until the work is done. The harness is plain on
 * purpose; what it keeps is what cannot be left to the model: the user's
 * confirmation before anything leaves, the log every run is rebuilt from,
 * the size of what the model reads, and what its task must leave behind.
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
      background: options.background,
      actor: { by: 'segretario', runId: id, background: options.background },
      seen: new Map([...(this.seenByConversation.get(id) ?? []), ...(options.seen ?? [])]),
      changes: [],
      results: {},
      editor: options.editor ?? null
    }
    const live: LiveRun = { context, controller, approvals: new Map(), failedCalls: new Set() }
    const { signal } = controller
    let ended: ActivityStatus = 'failed'
    let failure: SegretarioError | Error | null = null
    let nudges = 0

    options.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    this.live.set(id, live)
    await store.updateActivity(id, { status: 'running' })
    await this.emitSummary(id)

    try {
      const key = await this.deps.requireKey()
      const system = await systemPrompt()
      const tools = toolDefinitions(this.deps.tools)

      for (let step = 0; step < MAX_STEPS_PER_TURN; step += 1) {
        signal.throwIfAborted()
        const events = await store.listEvents(id)
        const handles = new HandleRegistry(handleRecords(events))
        let streamed = ''
        let flushTimer: ReturnType<typeof setTimeout> | null = null

        const result = await this.deps.client.chat(
          key,
          {
            messages: buildConversation(system, events),
            tools,
            reasoningEffort: 'low',
            maxTokens: MAX_TOKENS_PER_TURN,
            sessionId: id
          },
          {
            signal,
            onText: (text) => {
              streamed += text
              flushTimer ??= setTimeout(() => {
                flushTimer = null
                this.deps.emit({ type: 'stream', activityId: id, text: streamed })
              }, STREAM_FLUSH_MS)
            }
          }
        )

        if (flushTimer) {
          clearTimeout(flushTimer)
        }

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

          if (missing && nudges < MAX_NUDGES) {
            nudges += 1
            const nudge = await store.appendEvent<UserPayload>(id, 'user', {
              text: missing,
              forModel: missing,
              handles: [],
              origin: 'segretario'
            })
            this.emitEntry(id, nudge)
            continue
          }

          if (missing) {
            throw new SegretarioError('incomplete', missing)
          }

          break
        }

        await Promise.all(result.toolCalls.map((call) => this.runTool(live, call, handles)))
        await this.manageContext(id, key, system, result.usage.promptTokens, signal)

        if (step === MAX_STEPS_PER_TURN - 1) {
          throw new SegretarioError(
            'too-long',
            'Mi sono fermato: il lavoro stava richiedendo troppi passaggi.'
          )
        }
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

  private async runTool(live: LiveRun, call: ToolCall, handles: HandleRegistry): Promise<void> {
    const { store } = this.deps
    const activityId = live.context.activityId
    const tool = this.deps.tools.find((candidate) => candidate.name === call.function.name)
    let args: Record<string, unknown> = {}
    let argsProblem: string | null = null

    try {
      const parsed = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {}
      args = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      argsProblem = 'Gli argomenti non sono JSON valido: riprova.'
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

    if (!tool || argsProblem) {
      await finish({
        status: 'error',
        summary: tool ? 'Argomenti non validi' : `Strumento sconosciuto: ${call.function.name}`,
        result: argsProblem ?? `Non esiste lo strumento «${call.function.name}».`
      })
      return
    }

    // A call that failed, made again as it was, fails again: said so instead of tried.
    const signature = `${tool.name}\u0000${JSON.stringify(
      Object.keys(args)
        .sort()
        .map((name) => [name, args[name]])
    )}`

    if (live.failedCalls.has(signature)) {
      await finish({
        status: 'error',
        summary: 'Già provato così',
        result:
          "Hai già fatto esattamente questa chiamata e non è riuscita: non ripeterla uguale. Rileggi l'errore e rifalla diversa, o lascia stare."
      })
      return
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
        live.failedCalls.add(signature)
      } else if (context.newHandles.length > 0) {
        // New names: a call that failed on a name it did not have yet may be right now.
        live.failedCalls.clear()
      }

      await finish({
        status: outcome.failed ? 'error' : 'done',
        summary: outcome.summary,
        result: outcome.content,
        messages: outcome.messages,
        files: outcome.files,
        handles: context.newHandles
      })
    } catch (error) {
      if (error instanceof SegretarioError && error.code === 'cancelled') {
        await finish({ status: 'error', summary: 'Interrotto', result: 'Interrotto.' })
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)

      // What changed under the call is now seen: the same call may be made again, knowingly.
      if (!(error instanceof ToolConflict)) {
        live.failedCalls.add(signature)
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
    }
  }

  private async requestApproval(
    live: LiveRun,
    callId: string,
    request: Omit<ApprovalPayload, 'approvalId' | 'status' | 'callId'>
  ): Promise<{ approved: boolean; outcome?: SendOutcome }> {
    if (live.context.background) {
      throw new ToolInputError(
        'Nessuno è davanti allo schermo per confermare: proponilo invece di farlo.'
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
   * Keeps what the model reads within reach: past a size, old tool results
   * are cleared in one stroke; past a larger one, the older part of the run
   * is summarised (`compattazione.md`) and the summary takes its place. The
   * log keeps everything.
   */
  private async manageContext(
    id: string,
    key: string,
    system: string,
    promptTokens: number,
    signal: AbortSignal
  ): Promise<void> {
    const { store } = this.deps

    if (promptTokens >= COMPACT_AT) {
      const events = await store.listEvents(id)
      const result = await this.deps.client.chat(
        key,
        {
          messages: [
            ...buildConversation(system, events),
            { role: 'user', content: PROMPTS.compaction }
          ],
          tools: toolDefinitions(this.deps.tools),
          toolChoice: 'none',
          reasoningEffort: 'low',
          maxTokens: 8_000,
          sessionId: id
        },
        { signal }
      )

      await this.deps.recordUsage(id, 'compattazione', result)
      const event = await store.appendEvent<CompactionPayload>(id, 'compaction', {
        summary: result.content.trim(),
        coveredUntil: events[events.length - 1]?.id ?? 0
      })
      this.emitEntry(id, event)
      return
    }

    if (promptTokens >= CLEAR_TOOL_RESULTS_AT) {
      const events = await store.listEvents(id)
      const cleared = events
        .filter((event) => event.type === 'clearing')
        .reduce(
          (boundary, event) => Math.max(boundary, (event.payload as ClearingPayload).before),
          0
        )
      const tools = events.filter((event) => event.type === 'tool' && event.id >= cleared)

      if (tools.length > RECENT_TOOL_RESULTS_KEPT) {
        await store.appendEvent<ClearingPayload>(id, 'clearing', {
          before: tools[tools.length - RECENT_TOOL_RESULTS_KEPT].id
        })
      }
    }
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
