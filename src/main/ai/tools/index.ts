import extensionMain from '@app/extension/main'
import type { ExtensionAssistantTool, ExtensionMessage } from '@app/extension/types'

import { RegistryRefusal } from '../registry/types'
import { ToolInputError, type SegretarioTool, type ToolContext } from '../agent/tool-types'
import type { ToolDefinition } from '../openrouter'
import { calendarTool } from './calendar'
import { commitmentsTool, noteTool } from './commitments'
import { connectionsTool } from './connections'
import { journalTool, reviewTool, todayTool } from './day'
import { sendDraftTool, writeDraftTool } from './drafts'
import { searchFilesTool } from './files'
import { memoryTool } from './memory'
import { organizeTool } from './organize'
import { projectsTool } from './projects'
import { readTool } from './read'
import { replyTool } from './replies'
import { searchMailTool } from './search-mail'
import { showTool } from './show'

/** A message as an extension's tool is told of it. */
async function extensionMessage(
  context: ToolContext,
  handle: string
): Promise<ExtensionMessage | null> {
  const message = context.handles.message(handle)

  if (!message) {
    return null
  }

  const location = (await context.mail.locate(message.ref.accountId, [message.messageKey])).get(
    message.messageKey
  )

  return location
    ? {
        ref: location.ref,
        messageKey: message.messageKey,
        threadId: location.threadId,
        subject: location.subject,
        dateIso: location.dateIso,
        fromAddress: location.from[0]?.address.toLowerCase() ?? null
      }
    : null
}

/**
 * An extension's tool as the Segretario runs it: the short names it is
 * given resolved to messages, its confirmation asked on the card when the
 * user is there, its proposals left for them when not.
 */
function extensionTool(tool: ExtensionAssistantTool): SegretarioTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    running: (args) => tool.running(args),
    async execute(args, context) {
      const result = await tool.execute(args, {
        message: (handle) => extensionMessage(context, handle),
        background: context.run.background,
        confirm: async (request) =>
          context.run.watched
            ? (await context.requestApproval({ kind: 'action', ...request })).approved
            : false,
        propose: async ({ kind, title, payload, message }) => {
          try {
            await context.registry.propose(
              {
                kind,
                title,
                payload,
                accountId: message.ref.accountId,
                messageKey: message.messageKey,
                threadId: message.threadId
              },
              context.run.actor
            )
          } catch (error) {
            if (error instanceof RegistryRefusal) {
              throw new ToolInputError(error.message)
            }

            throw error
          }
        },
        recentCopies: async (limit) => {
          const copies = await context.registry.copies.recent(limit)
          const subjects = new Map<string, string>()

          for (const accountId of new Set(copies.map((copy) => copy.accountId))) {
            const summaries = await context.mail.messageSummaries(
              accountId,
              copies.filter((copy) => copy.accountId === accountId).map((copy) => copy.messageKey)
            )

            for (const [key, summary] of summaries) {
              subjects.set(`${accountId}\u0000${key}`, summary.subject)
            }
          }

          return copies.map((copy) => ({
            destination: copy.destination,
            subject: subjects.get(`${copy.accountId}\u0000${copy.messageKey}`) ?? '',
            fromAddress: copy.fromAddress,
            savedAt: copy.savedAt
          }))
        },
        signal: context.signal
      })

      return { content: result.content, summary: result.summary, failed: result.failed }
    }
  }
}

/**
 * The Segretario's tools — the same for every run, in a fixed order: the
 * host's, then the extension's. The list is part of every request's
 * prefix, and a prefix that stays the same byte for byte is one the
 * provider's cache keeps. What a run may do with them depends on its task
 * (see `RunContext.background`), never on which tools it is given.
 */
export const SEGRETARIO_TOOLS: ReadonlyArray<SegretarioTool> = [
  searchMailTool,
  searchFilesTool,
  readTool,
  noteTool,
  commitmentsTool,
  projectsTool,
  replyTool,
  writeDraftTool,
  sendDraftTool,
  organizeTool,
  calendarTool,
  memoryTool,
  todayTool,
  reviewTool,
  showTool,
  journalTool,
  connectionsTool,
  ...(extensionMain.assistant?.tools ?? []).map(extensionTool)
]

export function toolDefinitions(tools: ReadonlyArray<SegretarioTool>): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }))
}
