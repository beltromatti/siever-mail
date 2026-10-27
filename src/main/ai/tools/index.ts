import type { SegretarioTool } from '../agent/tool-types'
import type { ToolDefinition } from '../openrouter'
import { writeDraftTool, sendDraftTool } from './draft-tools'
import { readFileTool, searchFilesTool } from './file-tools'
import { organizeTool, readAttachmentTool, readMailTool, searchMailTool } from './mail-tools'
import { memoryTool } from './memory-tool'
import { showTool } from './show-tool'

/**
 * The Segretario's tools, in a fixed order: the list is part of every
 * request's prefix, and a prefix that stays the same byte for byte is one
 * the provider's cache keeps.
 */
export const SEGRETARIO_TOOLS: ReadonlyArray<SegretarioTool> = [
  searchMailTool,
  readMailTool,
  readAttachmentTool,
  searchFilesTool,
  readFileTool,
  writeDraftTool,
  sendDraftTool,
  organizeTool,
  memoryTool,
  showTool
]

export function toolDefinitions(tools: ReadonlyArray<SegretarioTool>): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters }
  }))
}
