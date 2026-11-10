import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The tool reaches Electron through what other tools read: not these tests.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: class {}, shell: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { HandleRegistry } from '../agent/handles'
import {
  seenKey,
  ToolConflict,
  type MessageLocation,
  type RunContext,
  type TaskKind,
  type ToolContext
} from '../agent/tool-types'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import type { Sql } from '../sql'
import { memorySql } from '../testing/memory-sql'
import { noteTool } from './note'

const REF = { accountId: 'acc', folderPath: 'INBOX', uid: 7 }
const KEY = seenKey('note', 'acc', 'm:ddt')
const LOCATION: MessageLocation = {
  ref: REF,
  threadId: 't-ddt',
  dateIso: '2026-11-10T15:02:00.000Z',
  subject: 'Re: consegna PDC',
  from: [{ name: 'Fabio Costa', address: 'fabio@termoidraulica.example' }],
  setAside: false,
  draft: false
}
const NOTE = {
  messaggio: 'm1',
  sintesi: 'Il DDT non corrisponde all’ordine',
  natura: 'da_fare',
  importanza: 'alta',
  motivo: 'La consegna è domattina',
  avvisa: 'Il DDT dice 12,4 kW invece di 45: da chiarire oggi.'
}

/** The mail tables the registry reads, cut to the columns it uses. */
async function mailTables(sql: Sql): Promise<void> {
  await sql.run('CREATE TABLE accounts (id TEXT PRIMARY KEY)')
  await sql.run(
    'CREATE TABLE folders (account_id TEXT, path TEXT, special_use TEXT, last_synced_at INTEGER)'
  )
  await sql.run(
    'CREATE TABLE messages (account_id TEXT, folder_path TEXT, uid INTEGER, message_key TEXT, thread_id TEXT)'
  )
}

describe('nota, on a message', () => {
  let sql: ReturnType<typeof memorySql>
  let registry: Registry

  beforeEach(async () => {
    sql = memorySql()
    await mailTables(sql)
    await ensureAiSchema(sql)
    registry = new Registry(sql, { changed: () => undefined, lesson: () => undefined })
  })

  afterEach(() => sql.close())

  /** A run of a task that knows the message as m1 — a reading given it, or another run. */
  const runOf = (
    task: TaskKind,
    options: { background: boolean; reads?: string[]; seen?: Array<[string, number]> }
  ): ToolContext => {
    const handles = new HandleRegistry()
    handles.name({ kind: 'message', ref: REF, messageKey: 'm:ddt' })
    const run = {
      activityId: `run-${task}`,
      task,
      startedAt: Date.now(),
      background: options.background,
      watched: !options.background,
      actor: { by: 'segretario', runId: `run-${task}`, background: options.background },
      seen: new Map(options.seen ?? []),
      reads: new Set(options.reads ?? []),
      changes: [],
      results: {},
      editor: null,
      fileSearches: new Map()
    } as RunContext

    return {
      run,
      handles,
      registry,
      mail: {
        locate: async () => new Map([['m:ddt', LOCATION]]),
        listAccounts: async () => [{ id: 'acc', email: 'mattia@studio.example' }]
      }
    } as unknown as ToolContext
  }

  it('leaves its first note to its reading: another run on its own may correct it, not write it', async () => {
    const neighbour = runOf('lettura', { background: true })
    const reading = runOf('lettura', { background: true, reads: [KEY], seen: [[KEY, 0]] })

    await expect(
      noteTool.execute({ ...NOTE, natura: 'informativo', avvisa: undefined }, neighbour)
    ).rejects.toThrow(/non ha ancora la sua nota: gliela scrive la lettura/)

    await noteTool.execute(NOTE, reading)
    expect(await registry.notes.get('acc', 'm:ddt')).toMatchObject({
      notify: true,
      alert: 'Il DDT dice 12,4 kW invece di 45: da chiarire oggi.'
    })

    // Once it has one, the neighbour may put it right; what the user was told stays as it was.
    const corrected = await noteTool.execute(
      { ...NOTE, sintesi: 'Il DDT 1288/B non corrisponde all’ordine 2026/1288', avvisa: undefined },
      neighbour
    )
    expect(corrected.content).toBe('Nota di m1 corretta.')
    expect(await registry.notes.get('acc', 'm:ddt')).toMatchObject({ notify: true, revision: 2 })
  })

  it('lets the user’s conversation write it, the user being there', async () => {
    const chat = runOf('richiesta', { background: false })

    await noteTool.execute({ ...NOTE, avvisa: undefined }, chat)

    expect(await registry.notes.get('acc', 'm:ddt')).toMatchObject({ notify: false })
  })

  it('tells a run that saw no note that one was written meanwhile, to look again', async () => {
    const reading = runOf('lettura', { background: true, reads: [KEY], seen: [[KEY, 0]] })
    await noteTool.execute(
      { ...NOTE, avvisa: undefined },
      runOf('richiesta', { background: false })
    )

    const conflict = noteTool.execute(NOTE, reading)
    await expect(conflict).rejects.toBeInstanceOf(ToolConflict)
    await expect(conflict).rejects.toThrow(
      /Da quando l’hai letto, questo messaggio ha avuto la sua nota/
    )

    // Looked at again, it may put it right: as a correction.
    expect((await noteTool.execute(NOTE, reading)).content).toContain('corretta')
  })
})
