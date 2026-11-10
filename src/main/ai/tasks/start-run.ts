import { randomUUID } from 'node:crypto'

import type { ActivityEvent, ActivityVisibility } from '@shared/segretario'

import type { AgentRunner, RunResult } from '../agent/runner'
import type { ContextPayload, UserPayload } from '../agent/conversation'
import { entryOf } from '../agent/entries'
import type { RunContext, TaskKind } from '../agent/tool-types'
import type { AiStore } from '../ai-store'
import { PROMPTS } from '../prompts'
import { contextBlock, type ContextSources } from './context'
import type { StartingData } from './day'

export interface RunStarter {
  store: AiStore
  runner: AgentRunner
  sources: ContextSources
  emit(event: ActivityEvent): void
}

/**
 * Begins a run of the Segretario on a task: an activity whose log opens
 * with the task and the context — the same for every run of the task, so
 * the provider's cache keeps them — then the data it starts from, and runs
 * it to the end.
 */
export async function startRun(
  starter: RunStarter,
  spec: {
    task: TaskKind
    background: boolean
    visibility: ActivityVisibility
    data: StartingData
    /** What the user sees as the run's first line: what it set out to do, or what they asked. */
    shown?: string
    origin?: 'segretario'
    workId?: string | null
    scope?: unknown
    editor?: RunContext['editor']
    missing?: (run: RunContext) => Promise<string | null>
    signal?: AbortSignal
    /** Called with the activity as soon as it exists, before it runs. */
    onCreated?: (activityId: string) => void | Promise<void>
  }
): Promise<RunResult & { activityId: string }> {
  const { store } = starter
  const id = randomUUID()
  const summary = await store.createActivity({
    id,
    task: spec.task,
    title: spec.data.title,
    status: 'running',
    visibility: spec.visibility,
    workId: spec.workId ?? null,
    scope: spec.scope
  })

  starter.emit({ type: 'summary', activity: summary })
  await spec.onCreated?.(id)
  const context = await contextBlock(starter.sources)
  await store.appendEvent<ContextPayload>(id, 'context', {
    text: `${PROMPTS.tasks[spec.task]}\n\n---\n\n${context}`
  })
  const user = await store.appendEvent<UserPayload>(id, 'user', {
    text: spec.shown ?? spec.data.title,
    forModel: spec.data.data,
    handles: spec.data.handles,
    ...(spec.origin ? { origin: spec.origin } : {})
  })
  const entry = entryOf(user)

  if (entry) {
    starter.emit({ type: 'entry', activityId: id, entry })
  }

  const result = await starter.runner.run({
    activityId: id,
    task: spec.task,
    background: spec.background,
    // Only a conversation in the panel shows what it asks to confirm.
    watched: !spec.background && spec.visibility === 'pannello',
    editor: spec.editor,
    missing: spec.missing,
    signal: spec.signal,
    seen: new Map(spec.data.seen ?? []),
    reads: spec.data.reads,
    // Work shown in the panel may go on as a conversation: what it read is kept for that.
    conversation: spec.visibility === 'pannello'
  })

  return { ...result, activityId: id }
}
