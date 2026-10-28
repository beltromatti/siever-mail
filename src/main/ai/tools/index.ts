import extensionMain from '@app/extension/main'
import type { ExtensionAssistantTool } from '@app/extension/types'

import type { SegretarioTool } from '../agent/tool-types'
import type { ToolDefinition } from '../openrouter'
import { writeDraftTool, sendDraftTool } from './draft-tools'
import { readFileTool, searchFilesTool } from './file-tools'
import { organizeTool, readAttachmentTool, readMailTool, searchMailTool } from './mail-tools'
import { memoryTool } from './memory-tool'
import { overviewTool } from './overview-tool'
import { showTool } from './show-tool'
import { commitmentsTool, topicsTool } from './work-tools'

/**
 * An extension's tool as the Segretario runs it: the short names it is
 * given resolved to messages, and its confirmation asked on the card.
 */
function extensionTool(tool: ExtensionAssistantTool): SegretarioTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    running: (args) => tool.running(args),
    async execute(args, context) {
      const result = await tool.execute(args, {
        message: async (handle) => {
          const message = context.handles.message(handle)

          if (!message) {
            return null
          }

          const summary = (
            await context.mail.messageSummaries(message.ref.accountId, [message.messageKey])
          ).get(message.messageKey)
          return summary
            ? { ref: summary.ref, subject: summary.subject, dateIso: summary.dateIso }
            : null
        },
        confirm: async (request) =>
          (await context.requestApproval({ kind: 'action', ...request })).approved,
        signal: context.signal
      })

      return { content: result.content, summary: result.summary, failed: result.failed }
    }
  }
}

/**
 * The Segretario's tools, in a fixed order — the host's, then the
 * extension's: the list is part of every request's prefix, and a prefix
 * that stays the same byte for byte is one the provider's cache keeps.
 */
export const SEGRETARIO_TOOLS: ReadonlyArray<SegretarioTool> = [
  searchMailTool,
  overviewTool,
  readMailTool,
  readAttachmentTool,
  searchFilesTool,
  readFileTool,
  writeDraftTool,
  sendDraftTool,
  organizeTool,
  memoryTool,
  topicsTool,
  commitmentsTool,
  showTool,
  ...(extensionMain.assistant?.tools ?? []).map(extensionTool)
]

export function toolDefinitions(tools: ReadonlyArray<SegretarioTool>): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }))
}
