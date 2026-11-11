import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The tools reach Electron through what other tools read: not these tests.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: class {}, shell: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { HandleRegistry } from '../agent/handles'
import {
  seenKey,
  type MessageLocation,
  type RunContext,
  type ToolContext
} from '../agent/tool-types'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { replyTool } from './replies'

const REF = { accountId: 'acc', folderPath: 'INBOX', uid: 3 }
const LOCATION: MessageLocation = {
  ref: REF,
  threadId: 't-offerta',
  dateIso: '2026-11-10T09:00:00.000Z',
  subject: 'Offerta impianto',
  from: [{ name: 'Chiara Gallo', address: 'chiara@brenta.example' }],
  setAside: false,
  draft: false
}

describe('risposta', () => {
  let sql: ReturnType<typeof memorySql>
  let context: ToolContext

  beforeEach(async () => {
    sql = memorySql()
    await sql.run('CREATE TABLE accounts (id TEXT PRIMARY KEY)')
    await sql.run(
      'CREATE TABLE folders (account_id TEXT, path TEXT, special_use TEXT, last_synced_at INTEGER)'
    )
    await sql.run(
      'CREATE TABLE messages (account_id TEXT, folder_path TEXT, uid INTEGER, message_key TEXT, thread_id TEXT)'
    )
    await ensureAiSchema(sql)
    const handles = new HandleRegistry()
    handles.name({ kind: 'message', ref: REF, messageKey: 'm:offerta' })
    context = {
      run: {
        activityId: 'run',
        task: 'lettura',
        startedAt: Date.now(),
        background: true,
        watched: false,
        actor: { by: 'segretario', runId: 'run', background: true },
        // Read with its conversation: no reply prepared yet.
        seen: new Map([[seenKey('reply', 'acc', 'm:offerta'), 0]]),
        looking: new Set(),
        changes: [],
        results: {},
        fileSearches: new Map()
      } as RunContext,
      handles,
      registry: new Registry(sql, { changed: () => undefined, lesson: () => undefined }),
      mail: {
        locate: async () => new Map([['m:offerta', LOCATION]]),
        listAccounts: async () => [{ id: 'acc', email: 'mattia@studio.example' }]
      }
    } as unknown as ToolContext
  })

  afterEach(() => sql.close())

  it('writes over what the run itself wrote: prepared, set aside, prepared again', async () => {
    const prepare = (testo: string): ReturnType<typeof replyTool.execute> =>
      replyTool.execute({ azione: 'prepara', messaggio: 'm1', testo }, context)

    await prepare('Gentile Chiara, confermo l’offerta.')
    await replyTool.execute({ azione: 'scarta', messaggio: 'm1', motivo: 'Superata' }, context)
    await expect(prepare('Gentile Chiara, le mando l’offerta rivista.')).resolves.toMatchObject({
      summary: expect.any(String)
    })
  })
})
