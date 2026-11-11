import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiStore } from './ai-store'
import { Registry } from './registry/registry'
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

    expect(await store.forgetCalendar('cal-1', 'calendario:cal-1')).toEqual({
      projects: ['p1'],
      activities: []
    })
    expect(await sql.all('SELECT text FROM ai_items')).toEqual([{ text: 'Prenotare il campo' }])
    expect(await sql.all('SELECT item_id FROM ai_item_history')).toEqual([])
    expect(await sql.all('SELECT project_id FROM ai_project_resources')).toEqual([
      { project_id: 'p2' }
    ])
  })
})

describe('AiStore forgetting a connection', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => sql.close())

  const run = (id: string, task: string, scope?: unknown): Promise<unknown> =>
    store.createActivity({
      id,
      task,
      title: id,
      status: 'done',
      visibility: 'diario',
      scope
    } as never)

  const note = (accountId: string, messageKey: string, runId: string | null): Promise<unknown> =>
    sql.run(
      `INSERT INTO ai_notes (account_id, message_key, thread_id, direction, summary, state, priority,
         reason, message_date, created_at, run_id)
       VALUES (?, ?, 't1', 'in', 'Una nota', 'informativo', 'bassa', '', '2026-11-01', 1, ?)`,
      accountId,
      messageKey,
      runId
    )

  it('takes from the diary what was about the mailbox alone, and keeps what mixes the sources', async () => {
    await run('read-a1', 'lettura', { accountId: 'a1', threadId: 't1' })
    // A reading from before the scope was kept: its notes say whose it was.
    await run('read-old', 'lettura')
    await note('a1', 'm-old', 'read-old')
    await run('read-a2', 'lettura', { accountId: 'a2', threadId: 't9' })
    await run('know-a1', 'conoscimi')
    await run('know-both', 'conoscimi')
    await run('chat', 'richiesta')
    await sql.run(
      `INSERT INTO ai_learning (account_id, activity_id, started_at, finished_at) VALUES
         ('a1', 'know-a1', 1, 2), ('calendario:c1', 'know-both', 1, 2)`
    )
    await sql.run(
      `INSERT INTO ai_project_threads (project_id, account_id, thread_id, linked_by, created_at)
       VALUES ('p1', 'a1', 't1', 'segretario', 1), ('p2', 'a2', 't9', 'segretario', 1)`
    )

    const forgotten = await store.forgetAccount('a1')

    expect(forgotten.projects).toEqual(['p1'])
    expect([...forgotten.activities].sort()).toEqual(['know-a1', 'read-a1', 'read-old'])
    expect(
      (await sql.all<{ id: string }>('SELECT id FROM ai_activities ORDER BY id')).map(
        (row) => row.id
      )
    ).toEqual(['chat', 'know-both', 'read-a2'])
  })

  it('takes its read marks and alerts, and those of the copies read through it elsewhere', async () => {
    const registry = new Registry(sql, { changed: () => undefined, lesson: () => undefined })
    await registry.markRead('a1', ['m1'], 'read-a1')
    await registry.alerts.told(
      { kind: 'message', accountId: 'a1', messageKey: 'm1' },
      'Da sapere.',
      null
    )
    // Its copy in a2, read through a1; another message of a2, read there.
    await registry.markRead('a2', ['m1'], null, 'a1')
    await registry.markRead('a2', ['m2'], 'read-a2')

    await store.forgetAccount('a1')

    expect(await sql.all('SELECT account_id, message_key FROM ai_read')).toEqual([
      { account_id: 'a2', message_key: 'm2' }
    ])
    expect(await sql.all('SELECT id FROM ai_alerts')).toEqual([])
  })

  it('takes from the diary the looks at a calendar, and keeps the look at its changes', async () => {
    await run('look-c1', 'calendario', { look: 'c1' })
    await run('look-c2', 'calendario', { look: 'c2' })
    await run('changes', 'calendario', { after: 1, through: 2 })

    const forgotten = await store.forgetCalendar('c1', 'calendario:c1')

    expect(forgotten.activities).toEqual(['look-c1'])
    expect(
      (await sql.all<{ id: string }>('SELECT id FROM ai_activities ORDER BY id')).map(
        (row) => row.id
      )
    ).toEqual(['changes', 'look-c2'])
  })

  it('says which connections it keeps something of, and which Conoscimi knew', async () => {
    await note('a1', 'm1', null)
    await sql.run(
      `INSERT INTO ai_items (account_id, thread_id, message_key, kind, text, status, created_at)
       VALUES ('a2', 't', 'm', 'da_fare', 'Chiamare', 'aperta', 1)`
    )
    await sql.run(
      `INSERT INTO ai_items (event_key, kind, text, status, created_at)
       VALUES ('c1' || char(0) || 'work' || char(0) || 'e1', 'da_fare', 'Portare', 'aperta', 1)`
    )
    await sql.run(
      `INSERT INTO ai_learning (account_id, activity_id, started_at, finished_at) VALUES
         ('a1', NULL, 1, 2), ('calendario:c2', NULL, 1, 2)`
    )
    // A proposal decided long ago is history, not something kept of its mailbox.
    await sql.run(
      `INSERT INTO ai_proposals (id, kind, account_id, message_key, thread_id, title, payload_json,
         status, created_at)
       VALUES ('x', 'evento', 'a3', 'm', 't', 'Riunione', '{}', 'accettata', 1)`
    )

    const kept = await store.keptConnections()

    expect([...kept.mail].sort()).toEqual(['a1', 'a2'])
    expect([...kept.calendars].sort()).toEqual(['c1', 'c2'])
    expect([...kept.known].sort()).toEqual(['a1', 'calendario:c2'])
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

describe('AiStore.keepsAnything', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => sql.close())

  it('says whether «Dimentica tutto» has anything to take: a row of its own, or the key', async () => {
    expect(await store.keepsAnything()).toBe(false)

    await sql.run(
      "INSERT INTO ai_memory (path, content, created_at, updated_at, read_at) VALUES ('tu.md', 'Lucia', 1, 1, 1)"
    )
    expect(await store.keepsAnything()).toBe(true)

    await store.clearData()
    expect(await store.keepsAnything()).toBe(false)

    await sql.run(
      "INSERT INTO ai_settings (id, encrypted_api_key, key_status_json, preferences_json, updated_at) VALUES (1, 'cifrata', '{}', '{}', 1)"
    )
    expect(await store.keepsAnything()).toBe(true)
  })
})
