import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { calendarKey, seriesKey } from '@shared/calendar'
import type { HandleLink } from '@shared/segretario'

import { ensureAiSchema } from '../schema'
import type { Sql } from '../sql'
import { memorySql } from '../testing/memory-sql'
import { Registry } from './registry'
import type { Actor } from './types'

const CHAT: Actor = { by: 'segretario', runId: 'run-1' }
const WORK = calendarKey('c1', 'lavoro')
const LIFE = calendarKey('c1', 'life')
const VISIT = `${WORK}\u0000visita`
const MOVED = `${LIFE}\u0000visita`
/** Another event whose key begins as the one that moves: never taken for it. */
const VISIT_LATER = `${WORK}\u0000visita2`

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

describe('relocateEvents: what the registry keeps of an event follows it to another calendar', () => {
  let sql: ReturnType<typeof memorySql>
  let registry: Registry

  beforeEach(async () => {
    sql = memorySql()
    await mailTables(sql)
    await ensureAiSchema(sql)
    registry = new Registry(sql, { changed: () => undefined, lesson: () => undefined })
  })

  afterEach(() => sql.close())

  /**
   * The rows under a key, compared in SQL: Node's SQLite gives text back
   * only up to a NUL, and keys hold them — the app's driver gives them whole.
   */
  const keyed = (
    table: string,
    column: string,
    key: string,
    columns = '1 AS found'
  ): Promise<unknown[]> => sql.all(`SELECT ${columns} FROM ${table} WHERE ${column} = ?`, key)

  const link = (eventKey: string): HandleLink => ({
    handle: 'e1',
    kind: 'event',
    eventKey,
    title: 'Visita in cantiere'
  })

  it('moves every row kept by its key, and the words that name it, in place — revisions as they were', async () => {
    const { record: item } = await registry.openCommitment(
      { kind: 'evento', eventKey: VISIT },
      { kind: 'da_fare', text: 'Portare la planimetria' },
      CHAT
    )
    const { record: other } = await registry.openCommitment(
      { kind: 'evento', eventKey: VISIT_LATER },
      { kind: 'da_fare', text: 'Confermare l’orario' },
      CHAT
    )
    const prep = await registry.savePrep(
      VISIT,
      'Visita in cantiere',
      'Rivedere [la visita](evento:e1).',
      [link(VISIT)],
      CHAT,
      0
    )
    await registry.alerts.told({ kind: 'event', eventKey: VISIT }, 'Spostata alle 11', 'run-1')
    await registry.ownership.mark({
      eventKey: VISIT,
      seriesKey: null,
      yours: true,
      setBy: 'segretario',
      reason: 'Il suo nome nel titolo',
      runId: 'run-1'
    })
    const { record: project } = await registry.createProject('Casa al mare', CHAT)
    await registry.projects.addResource(
      project.id,
      { kind: 'evento', location: VISIT, label: 'Visita' },
      CHAT
    )
    const proposal = await registry.propose(
      { kind: 'evento', title: 'Modifica: Visita', payload: { eventKey: VISIT, title: 'Visita' } },
      CHAT
    )
    await registry.saveLetter('2026-11-12', 'Oggi [la visita](evento:e1).', [link(VISIT)], CHAT)
    await sql.run(
      "INSERT INTO ai_activities (id, kind, title, status, created_at, updated_at) VALUES ('run-1', 'richiesta', 'Chat', 'done', 1, 1)"
    )
    await sql.run(
      "INSERT INTO ai_events (activity_id, type, payload_json, created_at) VALUES ('run-1', 'changes', ?, 1)",
      JSON.stringify({
        changes: [
          {
            object: 'evento',
            id: VISIT,
            label: 'In calendario: Visita',
            undo: { kind: 'evento-creato', eventKey: VISIT }
          }
        ]
      })
    )
    await sql.run(
      "INSERT INTO ai_events (activity_id, type, payload_json, created_at) VALUES ('run-1', 'tool', ?, 1)",
      JSON.stringify({
        result: `e1 · Visita (la chiave non sta nel testo: ${VISIT})`,
        handles: [{ handle: 'e1', target: { kind: 'event', eventKey: VISIT, title: 'Visita' } }]
      })
    )
    await sql.run(
      "INSERT INTO ai_lessons (kind, payload_json, created_at) VALUES ('evento_di_chi', ?, 1)",
      JSON.stringify({ evento: VISIT, titolo: 'Visita' })
    )
    // What the history keeps, as the app's driver writes it — the key whole.
    await sql.run(
      "INSERT INTO ai_item_history (item_id, at, actor, action, before_json, after_json) VALUES (?, 2, 'segretario', 'aggiorna', NULL, ?)",
      item.id,
      JSON.stringify({ origin: { kind: 'evento', eventKey: VISIT } })
    )
    const seriesOf = vi.fn(async () => null)

    expect(
      await registry.relocateEvents([{ from: VISIT, to: MOVED }], seriesOf)
    ).toBeGreaterThanOrEqual(10)

    expect(await keyed('ai_items', 'event_key', MOVED, 'id, revision')).toEqual([
      { id: item.id, revision: item.revision }
    ])
    expect(await keyed('ai_items', 'event_key', VISIT_LATER, 'id')).toEqual([{ id: other.id }])
    // An undo of what it was puts it back where it is now.
    expect(
      (await registry.commitments.history(item.id)).map((entry) => entry.after.origin)
    ).toContainEqual({ kind: 'evento', eventKey: MOVED })
    expect(await keyed('ai_event_preps', 'event_key', VISIT)).toEqual([])
    expect(await keyed('ai_event_preps', 'event_key', MOVED, 'written_at, links_json')).toEqual([
      { written_at: prep.writtenAt, links_json: JSON.stringify([link(MOVED)]) }
    ])
    expect(await registry.alerts.of({ kind: 'event', eventKey: MOVED })).toHaveLength(1)
    expect(await registry.ownership.markOf(MOVED, null)).toMatchObject({ yours: true })
    expect(await keyed('ai_project_resources', 'location', MOVED, 'project_id, label')).toEqual([
      { project_id: project.id, label: 'Visita' }
    ])
    expect(await registry.proposals.get(proposal.id)).toMatchObject({
      payload: { eventKey: MOVED },
      revision: proposal.revision
    })
    expect((await registry.day.letter('2026-11-12'))?.links).toEqual([link(MOVED)])

    const events = await sql.all<{ payload_json: string }>(
      'SELECT payload_json FROM ai_events ORDER BY id'
    )
    const [changes, tool] = events.map((row) => JSON.parse(row.payload_json))
    expect(changes.changes[0]).toMatchObject({
      id: MOVED,
      undo: { kind: 'evento-creato', eventKey: MOVED }
    })
    expect(tool.handles[0].target.eventKey).toBe(MOVED)
    // Words that only mention it are what was read: left as they were.
    expect(tool.result).toContain(VISIT)
    const [lesson] = await sql.all<{ payload_json: string }>('SELECT payload_json FROM ai_lessons')
    expect(JSON.parse(lesson.payload_json).evento).toBe(MOVED)
    // No series of the calendar left is marked: nothing to ask of the calendar.
    expect(seriesOf).not.toHaveBeenCalled()
  })

  it('takes the mark of a series to its key there, when the series keeps its id', async () => {
    await registry.ownership.mark({
      eventKey: `${WORK}\u0000lezioni_20260901`,
      seriesKey: seriesKey('c1', 'lavoro', 'lezioni'),
      yours: true,
      setBy: 'utente',
      reason: null,
      runId: null
    })

    // The instance it was said on is no longer in the window: the series' own id says it.
    await registry.relocateEvents(
      [{ from: `${WORK}\u0000lezioni_20261116`, to: `${LIFE}\u0000lezioni_20261116` }],
      async () => seriesKey('c1', 'life', 'lezioni')
    )
    expect(
      await registry.ownership.markOf('altro', seriesKey('c1', 'life', 'lezioni'))
    ).toMatchObject({ yours: true, setBy: 'utente' })
  })

  it('takes it to the new id a copy to another connection gives, from the mark’s own event', async () => {
    const instance = `${WORK}\u0000lezioni_20261116`
    const there = `${calendarKey('c2', 'casa')}\u0000nuovo-1`
    await registry.ownership.mark({
      eventKey: instance,
      seriesKey: seriesKey('c1', 'lavoro', 'lezioni'),
      yours: true,
      setBy: 'utente',
      reason: null,
      runId: null
    })

    await registry.relocateEvents([{ from: instance, to: there }], async () =>
      seriesKey('c2', 'casa', 'nuovo')
    )
    expect(
      await keyed('ai_own_events', 'series_key', seriesKey('c2', 'casa', 'nuovo'), 'set_by')
    ).toEqual([{ set_by: 'utente' }])
    expect(await keyed('ai_own_events', 'event_key', there)).toHaveLength(1)
  })

  it('finds the words of a whole series moved, by the calendar it left', async () => {
    const instances = Array.from({ length: 12 }, (_, week) => `${WORK}\u0000lez_${week}`)
    await sql.run(
      "INSERT INTO ai_lessons (kind, payload_json, created_at) VALUES ('evento_di_chi', ?, 1)",
      JSON.stringify({ evento: instances[7], titolo: 'Lezione' })
    )

    await registry.relocateEvents(
      instances.map((from) => ({ from, to: from.replace(WORK, LIFE) })),
      async () => null
    )

    const [lesson] = await sql.all<{ payload_json: string }>('SELECT payload_json FROM ai_lessons')
    expect(JSON.parse(lesson.payload_json).evento).toBe(`${LIFE}\u0000lez_7`)
  })

  it('does nothing for no move, nor for a key that stays', async () => {
    const seriesOf = vi.fn(async () => null)
    expect(await registry.relocateEvents([], seriesOf)).toBe(0)
    expect(await registry.relocateEvents([{ from: VISIT, to: VISIT }], seriesOf)).toBe(0)
    expect(seriesOf).not.toHaveBeenCalled()
  })

  it('writes all of it, or none: the statements go as one transaction', async () => {
    await registry.alerts.told({ kind: 'event', eventKey: VISIT }, 'Spostata', 'run-1')

    await expect(
      sql.batch([
        { sql: 'UPDATE ai_alerts SET event_key = ? WHERE event_key = ?', params: [MOVED, VISIT] },
        { sql: 'UPDATE ai_no_such_table SET x = 1', params: [] }
      ])
    ).rejects.toThrow()
    expect(await registry.alerts.of({ kind: 'event', eventKey: VISIT })).toHaveLength(1)
  })
})
