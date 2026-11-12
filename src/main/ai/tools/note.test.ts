import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The tools reach Electron through what other tools read: not these tests.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: class {}, shell: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { calendarKey, seriesKey } from '@shared/calendar'

import { HandleRegistry } from '../agent/handles'
import {
  lookingKey,
  markSeenKey,
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
import { alertTool } from './alert'
import { noteTool } from './note'

const REF = { accountId: 'acc', folderPath: 'INBOX', uid: 7 }
const KEY = seenKey('note', 'acc', 'm:ddt')
const MESSAGE = lookingKey({ kind: 'message', accountId: 'acc', messageKey: 'm:ddt' })
const EVENT_KEY = 'c1:consegna'
const EVENT = lookingKey({ kind: 'event', eventKey: EVENT_KEY })
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
  motivo: 'La consegna è domattina'
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

describe('nota and avvisa', () => {
  let sql: ReturnType<typeof memorySql>
  let registry: Registry
  let mailAlerts: Array<[string, string]>
  let calendarAlerts: Array<[string, string]>
  let mailAnswer: 'told' | 'off' | 'not-new'

  beforeEach(async () => {
    sql = memorySql()
    await mailTables(sql)
    await ensureAiSchema(sql)
    registry = new Registry(sql, { changed: () => undefined, lesson: () => undefined })
    mailAlerts = []
    calendarAlerts = []
    mailAnswer = 'told'
  })

  afterEach(() => sql.close())

  /** A run of a task that knows the message as m1 and the event as e1, looking at what it is given. */
  const runOf = (
    task: TaskKind,
    options: { background: boolean; looking?: string[]; seen?: Array<[string, number]> },
    runId = `run-${task}`
  ): ToolContext => {
    const handles = new HandleRegistry()
    handles.name({ kind: 'message', ref: REF, messageKey: 'm:ddt' })
    handles.name({ kind: 'event', eventKey: EVENT_KEY, title: 'Consegna PDC' })
    const run = {
      activityId: runId,
      task,
      startedAt: Date.now(),
      background: options.background,
      watched: !options.background,
      actor: { by: 'segretario', runId, background: options.background },
      seen: new Map(options.seen ?? []),
      looking: new Set(options.looking ?? []),
      changes: [],
      results: {},
      fileSearches: new Map()
    } as RunContext

    return {
      run,
      handles,
      registry,
      mail: {
        locate: async () => new Map([['m:ddt', LOCATION]]),
        listAccounts: async () => [{ id: 'acc', email: 'mattia@studio.example' }],
        alert: async (message: { messageKey: string }, line: string) => {
          mailAlerts.push([message.messageKey, line])
          return mailAnswer
        }
      },
      calendar: {
        alert: async (eventKey: string, line: string) => {
          calendarAlerts.push([eventKey, line])
          return 'told'
        }
      }
    } as unknown as ToolContext
  }

  describe('a message’s note', () => {
    it('is written by whoever reads it; one come since, or never read, is shown before a write over it', async () => {
      const reading = runOf('lettura', { background: true, looking: [MESSAGE], seen: [[KEY, 0]] })
      const neighbour = runOf('lettura', { background: true, seen: [[KEY, 0]] })

      // The neighbour writes first: a note is data, anyone's — the reading is shown it, and decides.
      await noteTool.execute({ ...NOTE, natura: 'informativo', sintesi: 'DDT arrivato' }, neighbour)
      const conflict = noteTool.execute(NOTE, reading)
      await expect(conflict).rejects.toBeInstanceOf(ToolConflict)
      await expect(conflict).rejects.toThrow(/ha avuto la sua nota: dice «DDT arrivato»/)
      expect((await noteTool.execute(NOTE, reading)).content).toBe('Nota di m1 corretta.')

      // A run that never read it is shown it too.
      await expect(noteTool.execute(NOTE, runOf('giornata', { background: true }))).rejects.toThrow(
        /non l’hai ancora letta/
      )
    })

    it('says nothing to the user: that is avvisa', async () => {
      await expect(
        noteTool.execute(
          { ...NOTE, avvisa: 'Da chiarire oggi.' },
          runOf('lettura', { background: true })
        )
      ).rejects.toThrow(/Una nota non avvisa: .*`avvisa`/)
    })
  })

  describe('an event’s note', () => {
    it('writes a preparation over the one the run read, and shows it one it never read', async () => {
      const calendar = runOf('calendario', { background: true })
      await noteTool.execute(
        { evento: 'e1', preparazione: 'Il DDT dice 12,4 kW: da chiarire.' },
        calendar
      )

      const day = runOf('giornata', { background: true })
      const conflict = noteTool.execute(
        { evento: 'e1', preparazione: 'Apre Davide alle 7:15.' },
        day
      )
      await expect(conflict).rejects.toBeInstanceOf(ToolConflict)
      await expect(conflict).rejects.toThrow(/non l’hai ancora letta: dice «Il DDT dice 12,4 kW/)

      // Seen as it is, it is rewritten knowingly.
      await noteTool.execute(
        { evento: 'e1', preparazione: 'Apre Davide alle 7:15. Il DDT dice 12,4 kW: da chiarire.' },
        day
      )
      expect((await registry.day.prep(EVENT_KEY))?.text).toContain('Apre Davide')
    })

    it('says whose a series is instance after instance, the run seeing its own word', async () => {
      const look = runOf('calendario', { background: true })
      const second = look.handles.name({
        kind: 'event',
        eventKey: 'c1:riunione-2',
        title: 'Riunione'
      })
      const instance = (key: string): Record<string, unknown> => ({
        key,
        title: 'Riunione di cantiere',
        connectionId: 'c1',
        calendarId: 'studio',
        seriesId: 'riunione',
        yours: false
      })
      Object.assign(look.calendar, {
        event: async (key: string) => instance(key),
        calendars: async () => [
          { key: calendarKey('c1', 'studio'), name: 'Studio', role: 'propri' }
        ]
      })
      // Both read, neither said: the series is one thing, one mark.
      look.run.seen.set(
        markSeenKey({ eventKey: EVENT_KEY, seriesKey: seriesKey('c1', 'studio', 'riunione') }),
        0
      )

      await noteTool.execute({ evento: 'e1', tuo: true, motivo: 'La segue lui' }, look)
      await expect(
        noteTool.execute({ evento: second, tuo: true, motivo: 'La segue lui' }, look)
      ).resolves.toBeTruthy()
    })
  })

  describe('avvisa', () => {
    const alertsOfMessage = async (): Promise<string[]> =>
      (await registry.alerts.of({ kind: 'message', accountId: 'acc', messageKey: 'm:ddt' })).map(
        (alert) => alert.text
      )

    it('is the reading’s, for a message it reads, once — and stays with it', async () => {
      const reading = runOf('lettura', { background: true, looking: [MESSAGE] })

      const told = await alertTool.execute(
        { messaggio: 'm1', riga: '  Il DDT  non torna. ' },
        reading
      )
      expect(told.summary).toBe('Alerted you')
      expect(mailAlerts).toEqual([['m:ddt', 'Il DDT non torna.']])
      expect(await alertsOfMessage()).toEqual(['Il DDT non torna.'])

      await expect(
        alertTool.execute({ messaggio: 'm1', riga: 'Di nuovo.' }, reading)
      ).rejects.toThrow(/già saputo: «Il DDT non torna\.»/)
    })

    it('is not another run’s, and with the user there is said, not notified', async () => {
      await expect(
        alertTool.execute({ messaggio: 'm1', riga: 'x' }, runOf('lettura', { background: true }))
      ).rejects.toThrow(/non è tra quelli che leggi/)
      await expect(
        alertTool.execute({ messaggio: 'm1', riga: 'x' }, runOf('richiesta', { background: false }))
      ).rejects.toThrow(/diglielo e basta/)
      await expect(
        alertTool.execute({ evento: 'e1', riga: 'x' }, runOf('calendario', { background: true }))
      ).rejects.toThrow(/non è tra i cambiamenti che guardi/)
      expect([...mailAlerts, ...calendarAlerts]).toEqual([])
    })

    it('keeps what it said to tell where the user does not take its word, as not arrived', async () => {
      mailAnswer = 'off'
      const reading = runOf('lettura', { background: true, looking: [MESSAGE] })

      const result = await alertTool.execute(
        { messaggio: 'm1', riga: 'Il DDT non torna.' },
        reading
      )
      expect(result.content).toMatch(/non gli arrivano/)
      // Kept, for a copy come to a mailbox the user hears; and once.
      expect(
        await registry.alerts.of({ kind: 'message', accountId: 'acc', messageKey: 'm:ddt' })
      ).toMatchObject([{ text: 'Il DDT non torna.', delivered: false }])
      await expect(
        alertTool.execute({ messaggio: 'm1', riga: 'Di nuovo.' }, reading)
      ).rejects.toThrow(/già deciso l'avviso, che non gli è arrivato/)
    })

    it('is the look’s at an event’s change, once for that change', async () => {
      const look = runOf('calendario', { background: true, looking: [EVENT] })

      await alertTool.execute(
        { evento: 'e1', riga: 'Cancello est occupato: entra dal nord.' },
        look
      )
      await expect(alertTool.execute({ evento: 'e1', riga: 'Ancora.' }, look)).rejects.toThrow(
        /un cambiamento si avvisa una volta/
      )

      // Another change, another look: told again.
      await alertTool.execute(
        { evento: 'e1', riga: 'Spostata alle 9.' },
        runOf('calendario', { background: true, looking: [EVENT] }, 'run-2')
      )
      expect(calendarAlerts.map(([, line]) => line)).toEqual([
        'Cancello est occupato: entra dal nord.',
        'Spostata alle 9.'
      ])
    })
  })
})
