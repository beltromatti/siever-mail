import type { ApprovalRequest, SegretarioContext } from '@shared/segretario'

import type { StoredEvent } from '../ai-store'
import type { RegistryChange } from '../registry/types'
import type { ChatMessage, ContentPart, ToolCall } from '../openrouter'
import type { HandleRecord } from './handles'

/** What each kind of event in an activity's log carries. */
export interface ContextPayload {
  /** The context block (date, accounts, memory) as the activity began. */
  text: string
}

export interface UserPayload {
  text: string
  context?: SegretarioContext
  /** What the model reads: the moment, what the user is looking at, their words. */
  forModel: string
  handles: HandleRecord[]
  /** Set when the Segretario began the work on its own: `text` says what it set out to do. */
  origin?: 'segretario'
}

export interface AssistantPayload {
  content: string
  toolCalls: ToolCall[]
  reasoningDetails: unknown[]
}

export interface ToolPayload {
  callId: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  summary: string
  result?: string | ContentPart[]
  messages?: Array<{ accountId: string; folderPath: string; uid: number }>
  files?: string[]
  handles: HandleRecord[]
}

export interface ApprovalPayload extends ApprovalRequest {
  callId: string
}

export interface CompactionPayload {
  summary: string
  /** The last event the summary stands for. */
  coveredUntil: number
}

export interface ClearingPayload {
  /** Tool results of events before this one are taken out of the conversation. */
  before: number
}

export interface ErrorPayload {
  message: string
  code: string
}

/** What a run changed in the user's work, recorded when it ends: its page in the diary. */
export interface ChangesPayload {
  /** `undoneAt`: the user undid it from the diary. */
  changes: Array<RegistryChange & { undoneAt?: number }>
}

/** A tool result taken out of the conversation for room: where to get it back. */
function clearedResult(payload: ToolPayload): string {
  return `[Risultato di ${payload.name} tolto per fare spazio: ${payload.summary}. Se ti serve ancora, ripeti la chiamata.]`
}

/**
 * The conversation the model reads, rebuilt from the activity's log at
 * every turn — the log is the truth, the context is a view of it:
 *   • the system prompt, the same for every activity, then the context
 *     block the activity began with, inside the first user message, so the
 *     prefix the provider caches is as long and as stable as it can be;
 *   • after a compaction, its summary in place of what it covers;
 *   • tool results older than the last clearing replaced by a line saying
 *     what they were — in one stroke, so the cache breaks once for it;
 *   • every tool call answered: one a quit interrupted reads as interrupted.
 */
export function buildConversation(
  system: string,
  events: ReadonlyArray<StoredEvent>
): ChatMessage[] {
  const context = events.find((event) => event.type === 'context')?.payload as
    ContextPayload | undefined
  const compaction = [...events].reverse().find((event) => event.type === 'compaction')?.payload as
    CompactionPayload | undefined
  const clearing = events
    .filter((event) => event.type === 'clearing')
    .reduce((boundary, event) => Math.max(boundary, (event.payload as ClearingPayload).before), 0)
  const messages: ChatMessage[] = [{ role: 'system', content: system }]
  let preamble = context?.text ?? ''

  if (compaction) {
    preamble = `${preamble}\n\n# Il lavoro fin qui\n\nLa parte più vecchia di questa conversazione è stata riassunta così:\n\n${compaction.summary}`
  }

  const answered = new Set(
    events
      .filter((event) => event.type === 'tool')
      .map((event) => (event.payload as ToolPayload).callId)
  )
  const toolEvents = new Map(
    events
      .filter((event) => event.type === 'tool')
      .map((event) => [(event.payload as ToolPayload).callId, event] as const)
  )

  for (const event of events) {
    if (compaction && event.id <= compaction.coveredUntil) {
      continue
    }

    switch (event.type) {
      case 'user': {
        const payload = event.payload as UserPayload
        const text = preamble ? `${preamble}\n\n---\n\n${payload.forModel}` : payload.forModel
        preamble = ''
        messages.push({ role: 'user', content: text })
        break
      }
      case 'assistant': {
        const payload = event.payload as AssistantPayload

        if (preamble) {
          // A conversation compacted between a user's words and the answer
          // still opens with its context.
          messages.push({ role: 'user', content: preamble })
          preamble = ''
        }

        messages.push({
          role: 'assistant',
          content: payload.content || null,
          ...(payload.toolCalls.length > 0 ? { tool_calls: payload.toolCalls } : {}),
          ...(payload.reasoningDetails.length > 0
            ? { reasoning_details: payload.reasoningDetails }
            : {})
        })

        for (const call of payload.toolCalls) {
          const toolEvent = toolEvents.get(call.id)
          const toolPayload = toolEvent?.payload as ToolPayload | undefined

          if (!answered.has(call.id) || !toolPayload?.result) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content:
                'Interrotto: lo strumento non ha finito (il programma è stato chiuso o il lavoro fermato).'
            })
            continue
          }

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content:
              toolEvent && toolEvent.id < clearing ? clearedResult(toolPayload) : toolPayload.result
          })
        }
        break
      }
    }
  }

  return messages
}

/** The names the activity has given so far, to rebuild its registry. */
export function handleRecords(events: ReadonlyArray<StoredEvent>): HandleRecord[] {
  return events.flatMap((event) => {
    if (event.type === 'tool') {
      return (event.payload as ToolPayload).handles ?? []
    }

    if (event.type === 'user') {
      return (event.payload as UserPayload).handles ?? []
    }

    return []
  })
}
