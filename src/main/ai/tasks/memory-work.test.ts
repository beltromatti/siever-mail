import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SegretarioMailPort } from '../agent/tool-types'
import { AiStore } from '../ai-store'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { prepareReflection } from './memory-work'

describe('What the reflection hears of a connection taken away', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => sql.close())

  const reflect = async (): Promise<string> =>
    (
      await prepareReflection({
        mail: { listAccounts: async () => [] } as unknown as SegretarioMailPort,
        calendar: { event: async () => null },
        store
      })
    )?.data ?? ''

  it('names the mailbox, since when, the projects it leaves, and the same address still there', async () => {
    await store.addLesson('account-rimosso', {
      email: 'lavoro@brenta.it',
      pec: false,
      dal: '2026-03-02T09:00:00.000Z',
      progetti: ['Casa al mare'],
      ancora: true
    })

    const data = await reflect()

    expect(data).toContain('## Connessione tolta · posta')
    expect(data).toContain('La casella lavoro@brenta.it, collegata dal')
    expect(data).toContain('Aveva conversazioni in «Casa al mare»')
    expect(data).toContain('cambia solo come ci si arriva')
  })

  it('names the calendar connection with its calendars', async () => {
    await store.addLesson('calendario-rimosso', {
      connessione: 'mario@acme.it',
      fornitore: 'caldav',
      calendari: ['Lavoro', 'Casa'],
      dal: '2026-03-02T09:00:00.000Z',
      progetti: [],
      ancora: false
    })

    const data = await reflect()

    expect(data).toContain('## Connessione tolta · calendario')
    expect(data).toContain('La connessione di calendario mario@acme.it (CalDAV) — «Lavoro», «Casa»')
    expect(data).not.toContain('cambia solo come ci si arriva')
  })

  it('tells one found gone after a removal cut short, and reads the lessons of before', async () => {
    await store.addLesson('account-rimosso', {})
    await store.addLesson('account-rimosso', { email: 'vecchia@brenta.it' })
    await store.addLesson('calendario-rimosso', { calendari: ['Lavoro'] })

    const data = await reflect()

    expect(data).toContain("Una casella di posta non c'è più")
    expect(data).toContain('La casella vecchia@brenta.it è stata tolta')
    expect(data).toContain('«Lavoro» non è più collegato')
  })
})
