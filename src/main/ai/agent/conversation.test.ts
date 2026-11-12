import { describe, expect, it } from 'vitest'

import type { StoredEvent } from '../ai-store'
import type { ToolCall } from '../openrouter'
import { buildConversation, handleRecords, type UserPayload } from './conversation'
import { entryOf } from './entries'

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

  it('puts a compaction’s summary in place of what it covers', () => {
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

  it('rebuilds a request with what it carried, after its words, as the model first read it', () => {
    id = 0
    const parts = [
      { type: 'text' as const, text: '# Allegati alla richiesta (1)' },
      { type: 'text' as const, text: '## Allegato f1 · pianta.png' },
      { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } }
    ]
    const request: UserPayload = {
      text: 'Che ne dici?',
      forModel: '[ora] Che ne dici?',
      handles: [
        {
          handle: 'f1',
          target: {
            kind: 'file',
            file: { kind: 'path', path: '/Casa al mare/pianta.png', fileName: 'pianta.png' }
          }
        }
      ],
      attachments: [
        {
          name: 'pianta.png',
          kind: 'image',
          size: 2048,
          pages: null,
          path: '/Casa al mare/pianta.png',
          thumbnail: 'data:image/png;base64,BB',
          handle: 'f1',
          shortfall: null
        }
      ],
      attachmentParts: parts
    }
    const events = [event('context', { text: 'C' }), event('user', request)]

    expect(buildConversation('S', events)[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'C\n\n---\n\n[ora] Che ne dici?' }, ...parts]
    })
    // Its file's name stays the run's, for `leggi f1` and its links later.
    expect(handleRecords(events).map((record) => record.handle)).toEqual(['f1'])
    // The page shows the words and what went with them.
    expect(entryOf(events[1])).toMatchObject({
      kind: 'user',
      text: 'Che ne dici?',
      attachments: [{ name: 'pianta.png', handle: 'f1', shortfall: null }],
      handles: [{ handle: 'f1', kind: 'file', path: '/Casa al mare/pianta.png' }]
    })
  })

  it('keeps a turn that answered nothing only where the user wrote after it', () => {
    id = 0
    const silent = { content: '', toolCalls: [], reasoningDetails: [{ r: 1 }], thinkingMs: 9_000 }
    const ended = [
      event('context', { text: 'C' }),
      event('user', { text: 'x', forModel: 'x', handles: [] }),
      event('assistant', silent),
      event('error', { code: 'no-answer', message: 'Stopped.' }),
      event('assistant', silent),
      event('error', { code: 'no-answer', message: 'Stopped.' })
    ]

    expect(buildConversation('S', ended).map((message) => message.role)).toEqual(['system', 'user'])
    expect(
      buildConversation('S', [
        ...ended,
        event('user', { text: 'y', forModel: 'y', handles: [] })
      ]).map((message) => message.role)
    ).toEqual(['system', 'user', 'assistant', 'user'])
    // The page still shows how long it thought before saying nothing.
    expect(entryOf(ended[2])).toMatchObject({ kind: 'assistant', text: '', thought: { ms: 9_000 } })
  })
})
