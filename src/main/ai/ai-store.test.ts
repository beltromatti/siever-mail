import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiStore } from './ai-store'
import { ensureAiSchema } from './schema'
import { memorySql } from './testing/memory-sql'

describe('AiStore.recentWork', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => {
    vi.useRealTimers()
    sql.close()
  })

  it('finds what is searched for deep in the diary, page after page, none twice or left out', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-06T09:00:00Z'), toFake: ['Date'] })

    // Many runs within the same millisecond: the pages must not lose or repeat one between them.
    for (let index = 0; index < 700; index += 1) {
      await store.createActivity({
        id: `run-${String(index).padStart(4, '0')}`,
        task: 'lettura',
        title: index % 250 === 0 ? 'Letta la mail di Perché Srl' : `Letta la mail ${index}`,
        status: 'done',
        visibility: 'diario'
      })
    }

    const found = await store.recentWork(0, 10, (entry) =>
      entry.title.toLowerCase().includes('perché')
    )

    expect(found.map((entry) => entry.activityId)).toEqual(['run-0500', 'run-0250', 'run-0000'])
    expect(await store.recentWork(0, 5)).toHaveLength(5)
  })
})

describe('AiStore.forgetCalendar', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => sql.close())

  it('lets go of what was open from its events and of their place in projects, as a mailbox’s', async () => {
    const ofIt = 'cal-1\u0000work\u0000e1'
    const other = 'cal-2\u0000home\u0000e9'

    for (const [eventKey, text] of [
      [ofIt, 'Portare la planimetria'],
      [other, 'Prenotare il campo']
    ]) {
      await sql.run(
        `INSERT INTO ai_items (event_key, kind, text, status, created_at) VALUES (?, 'da_fare', ?, 'aperta', 1)`,
        eventKey,
        text
      )
    }
    await sql.run(
      `INSERT INTO ai_item_history (item_id, at, actor, action, after_json) VALUES (1, 1, 'segretario', 'apri', '{}')`
    )
    for (const [project, location] of [
      ['p1', ofIt],
      ['p2', other]
    ]) {
      await sql.run(
        `INSERT INTO ai_project_resources (project_id, kind, location, label, added_by, created_at)
         VALUES (?, 'evento', ?, 'Sopralluogo', 'segretario', 1)`,
        project,
        location
      )
    }

    expect(await store.forgetCalendar('cal-1', 'calendario:cal-1')).toEqual(['p1'])
    expect(await sql.all('SELECT text FROM ai_items')).toEqual([{ text: 'Prenotare il campo' }])
    expect(await sql.all('SELECT item_id FROM ai_item_history')).toEqual([])
    expect(await sql.all('SELECT project_id FROM ai_project_resources')).toEqual([
      { project_id: 'p2' }
    ])
  })
})

describe('AiStore learning', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => {
    sql.close()
  })

  it('keeps a connection known while Conoscimi is done again, and after a run that did not finish', async () => {
    await store.startLearning(['work'], 'first')
    await store.endLearning('first', true)
    const known = (await store.listLearning())[0].finishedAt

    // Done again with a mailbox added, and stopped halfway — the credit gave out.
    await store.startLearning(['work', 'pec'], 'again')
    expect((await store.listLearning()).find((row) => row.accountId === 'work')?.finishedAt).toBe(
      known
    )
    await store.endLearning('again', false)

    expect(await store.listLearning()).toEqual([
      { accountId: 'work', activityId: 'again', finishedAt: known }
    ])
  })
})
