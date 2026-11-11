import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MessageLocation, SegretarioMailPort } from '../agent/tool-types'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import type { Sql } from '../sql'
import { memorySql } from '../testing/memory-sql'
import { prepareReading } from './reading'

const KEY = 'm:ordine'
const THERE = { kind: 'message', accountId: 'ufficio', messageKey: KEY } as const
const HERE = { kind: 'message', accountId: 'personale', messageKey: KEY } as const
const LOCATION: MessageLocation = {
  ref: { accountId: 'personale', folderPath: 'INBOX', uid: 4 },
  threadId: 't-personale',
  dateIso: '2026-11-11T08:00:00.000Z',
  subject: 'Ordine 2463',
  from: [{ name: 'Marco Gallo', address: 'marco@brenta.example' }],
  setAside: false,
  draft: false
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

describe('a copy of a message read in another account', () => {
  let sql: ReturnType<typeof memorySql>
  let registry: Registry
  let told: Array<[string, string]>
  let answer: 'told' | 'off' | 'not-new'

  const mail = {
    listAccounts: async () => [
      { id: 'ufficio', email: 'mattia@studio.example' },
      { id: 'personale', email: 'mattia@casa.example' }
    ],
    threadKeys: async () => [KEY],
    locate: async () => new Map([[KEY, LOCATION]]),
    sameMessageElsewhere: async () => [
      { accountId: 'ufficio', messageKey: KEY, threadId: 't-ufficio' }
    ],
    alert: async (message: { accountId: string }, line: string) => {
      told.push([message.accountId, line])
      return answer
    }
  } as unknown as SegretarioMailPort

  /** The office copy read, and the line the Segretario said to tell of it: arrived there or not. */
  async function readThere(delivered: boolean): Promise<void> {
    await registry.writeNote(
      {
        accountId: 'ufficio',
        messageKey: KEY,
        threadId: 't-ufficio',
        direction: 'in',
        messageDate: LOCATION.dateIso
      },
      {
        summary: 'Gallo chiede la conferma dell’ordine',
        nature: 'da_rispondere',
        priority: 'alta',
        reason: 'la merce parte domani',
        due: '2026-11-11'
      },
      { by: 'segretario', runId: 'run-ufficio', background: true }
    )
    await registry.markRead('ufficio', [KEY], 'run-ufficio')
    await registry.alerts.told(
      THERE,
      'Gallo aspetta la conferma entro le 12.',
      'run-ufficio',
      delivered
    )
  }

  const readHere = (): ReturnType<typeof prepareReading> =>
    prepareReading(
      { mail, registry },
      { accountId: 'personale', threadId: 't-personale' },
      '2026-10-01T00:00:00.000Z'
    )

  beforeEach(async () => {
    sql = memorySql()
    await mailTables(sql)
    await ensureAiSchema(sql)
    registry = new Registry(sql, { changed: () => undefined, lesson: () => undefined })
    told = []
    answer = 'told'
  })

  afterEach(() => sql.close())

  it('is not read again: its note and its mark are copied, and what the user knows is not told twice', async () => {
    await readThere(true)

    expect(await readHere()).toBeNull()
    expect((await registry.notes.get('personale', KEY))?.twinAccountId).toBe('ufficio')
    expect((await registry.readMarks.read('personale', [KEY])).has(KEY)).toBe(true)
    expect(told).toEqual([])
    expect(await registry.alerts.of(HERE)).toMatchObject([
      { text: 'Gallo aspetta la conferma entro le 12.', delivered: true }
    ])
  })

  it('tells here, once, what did not arrive there — that mailbox muted', async () => {
    await readThere(false)

    expect(await readHere()).toBeNull()
    expect(told).toEqual([['personale', 'Gallo aspetta la conferma entro le 12.']])
    expect(await registry.alerts.of(HERE)).toMatchObject([{ delivered: true }])

    // Prepared again before its mark (a launch stopped halfway): nothing told or kept twice.
    await sql.run('DELETE FROM ai_read WHERE account_id = ?', 'personale')
    expect(await readHere()).toBeNull()
    expect(told).toHaveLength(1)
    expect(await registry.alerts.of(HERE)).toHaveLength(1)
  })

  it('keeps it as not arrived where neither copy reaches the user', async () => {
    await readThere(false)
    answer = 'off'

    await readHere()
    expect(await registry.alerts.of(HERE)).toMatchObject([{ delivered: false }])
  })
})
