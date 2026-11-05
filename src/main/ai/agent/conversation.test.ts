import { describe, expect, it } from 'vitest'

import type { StoredEvent } from '../ai-store'
import type { ToolCall } from '../openrouter'
import { buildConversation, handleRecords } from './conversation'

let id = 0
const event = (type: string, payload: unknown): StoredEvent => ({
  id: ++id,
  type,
  payload,
  createdAt: 0
})

describe('buildConversation', () => {
  it('opens with the system prompt and the context inside the first user message', () => {
    id = 0
    const messages = buildConversation('SYSTEM', [
      event('context', { text: 'CONTESTO' }),
      event('user', { text: 'ciao', forModel: '[ora] ciao', handles: [] }),
      event('assistant', { content: 'Buongiorno.', toolCalls: [], reasoningDetails: [] })
    ])

    expect(messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'CONTESTO\n\n---\n\n[ora] ciao' },
      { role: 'assistant', content: 'Buongiorno.' }
    ])
  })

  it('answers every tool call, and says when one was interrupted', () => {
    id = 0
    const call = (callId: string): ToolCall => ({
      id: callId,
      type: 'function' as const,
      function: { name: 'cerca_posta', arguments: '{}' }
    })
    const messages = buildConversation('S', [
      event('context', { text: 'C' }),
      event('user', { text: 'x', forModel: 'x', handles: [] }),
      event('assistant', {
        content: '',
        toolCalls: [call('a'), call('b')],
        reasoningDetails: [{ r: 1 }]
      }),
      event('tool', {
        callId: 'a',
        name: 'cerca_posta',
        status: 'done',
        summary: 's',
        result: 'R',
        handles: []
      })
    ])

    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [call('a'), call('b')],
      reasoning_details: [{ r: 1 }]
    })
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'R' })
    expect(messages[4]).toMatchObject({ role: 'tool', tool_call_id: 'b' })
    expect((messages[4] as { content: string }).content).toContain('Interrotto')
  })

  it('replaces old tool results after a clearing, and what a compaction covers by its summary', () => {
    id = 0
    const call = {
      id: 'a',
      type: 'function' as const,
      function: { name: 'leggi', arguments: '{}' }
    }
    const events = [
      event('context', { text: 'C' }),
      event('user', { text: 'u1', forModel: 'u1', handles: [] }),
      event('assistant', { content: '', toolCalls: [call], reasoningDetails: [] }),
      event('tool', {
        callId: 'a',
        name: 'leggi',
        status: 'done',
        summary: 'Letto X',
        result: 'LUNGO',
        handles: []
      })
    ]
    const cleared = buildConversation('S', [...events, event('clearing', { before: 5 })])
    expect((cleared[3] as { content: string }).content).toContain('Letto X')

    const compacted = buildConversation('S', [
      ...events,
      event('compaction', { summary: 'RIASSUNTO', coveredUntil: 4 }),
      event('user', { text: 'u2', forModel: 'u2', handles: [] })
    ])
    expect(compacted).toHaveLength(2)
    expect((compacted[1] as { content: string }).content).toContain('RIASSUNTO')
    expect((compacted[1] as { content: string }).content).toContain('u2')

    // Compacted in the middle of a run, nothing after: it goes on from its context and the summary.
    const midRun = buildConversation('S', [
      ...events,
      event('compaction', { summary: 'RIASSUNTO', coveredUntil: 4 })
    ])
    expect(midRun).toHaveLength(2)
    expect(midRun[1]).toMatchObject({ role: 'user' })
    expect((midRun[1] as { content: string }).content).toContain('C')
    expect((midRun[1] as { content: string }).content).toContain('RIASSUNTO')
  })

  it('gathers the names given along the way', () => {
    const records = handleRecords([
      event('user', {
        text: '',
        forModel: '',
        handles: [{ handle: 'm1', target: { kind: 'draft', draftId: 'd' } }]
      }),
      event('tool', {
        callId: 'x',
        handles: [{ handle: 'm2', target: { kind: 'draft', draftId: 'e' } }]
      })
    ])
    expect(records.map((record) => record.handle)).toEqual(['m1', 'm2'])
  })
})
