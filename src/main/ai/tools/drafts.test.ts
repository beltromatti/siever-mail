import { describe, expect, it, vi } from 'vitest'

// The tools reach Electron through what other tools read: not these tests.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: class {}, shell: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import type { ComposeSpec } from '@shared/segretario'

import { HandleRegistry } from '../agent/handles'
import { ToolInputError, type RunContext, type ToolContext } from '../agent/tool-types'
import { writeDraftTool } from './drafts'

const DRAFT = {
  accountId: 'acc',
  to: ['anna@brenta.example'],
  cc: [],
  bcc: [],
  subject: 'Sopralluogo',
  text: 'Gentile Anna,',
  attachments: []
}

/** The chat, with the draft the user is writing named `b1`, as the screen hands it over. */
function chatContext(): {
  context: ToolContext
  compose: ReturnType<typeof vi.fn>
  recorded: ReturnType<typeof vi.fn>
} {
  const handles = new HandleRegistry()
  handles.name({ kind: 'draft', draftId: 'd1' })
  const compose = vi.fn(async (spec: ComposeSpec) => spec.draftId ?? 'nuova')
  const recorded = vi.fn(async () => undefined)
  const context = {
    run: {
      activityId: 'run',
      task: 'richiesta',
      startedAt: Date.now(),
      background: false,
      watched: true,
      actor: { by: 'segretario', runId: 'run', background: false },
      seen: new Map(),
      looking: new Set(),
      changes: [],
      results: {},
      fileSearches: new Map()
    } as RunContext,
    handles,
    newHandles: [],
    store: { takeDraft: vi.fn(async () => undefined), recordDraft: recorded },
    mail: {
      getDraft: async () => DRAFT,
      listAccounts: async () => [{ id: 'acc', email: 'lucia@studio.example' }]
    },
    page: { compose, show: vi.fn() }
  } as unknown as ToolContext

  return { context, compose, recorded }
}

describe('scrivi_bozza', () => {
  it('writes in the message the user is writing, in place, without a kind to say', async () => {
    const { context, compose, recorded } = chatContext()

    const result = await writeDraftTool.execute(
      { bozza: 'b1', testo: 'Gentile Anna,\n\nconfermo il sopralluogo.' },
      context
    )

    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'd1', selection: false, kind: undefined }),
      undefined
    )
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'd1' }))
    expect(result.summary).toBe('Scritto nel messaggio')
  })

  it('rewrites the passage selected alone, and learns nothing from a passage', async () => {
    const { context, compose, recorded } = chatContext()

    const result = await writeDraftTool.execute(
      { bozza: 'b1', selezione: true, testo: 'più cordiale' },
      context
    )

    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: 'd1', selection: true }),
      undefined
    )
    expect(recorded).not.toHaveBeenCalled()
    expect(result.content).toContain('passaggio selezionato')
  })

  it('wants the message for a selection', async () => {
    const { context } = chatContext()

    await expect(
      writeDraftTool.execute({ selezione: true, testo: 'più cordiale' }, context)
    ).rejects.toBeInstanceOf(ToolInputError)
  })

  it('still writes a new message, with a kind and a recipient', async () => {
    const { context, compose } = chatContext()

    await writeDraftTool.execute(
      { tipo: 'nuovo', a: ['anna@brenta.example'], oggetto: 'Sopralluogo', testo: 'Buongiorno' },
      context
    )

    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'new', accountId: 'acc', to: ['anna@brenta.example'] }),
      undefined
    )
  })
})
