import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureAiSchema } from '../schema'
import type { Sql } from '../sql'
import { memorySql } from '../testing/memory-sql'
import { Registry } from './registry'
import { RegistryRefusal, RevisionConflict, type Actor, type RegistryChange } from './types'

const ANNA = { accountId: 'acc', messageKey: 'm:anna', threadId: 't1' }
const BACKGROUND: Actor = { by: 'segretario', runId: 'run-1', background: true }
const CHAT: Actor = { by: 'segretario', runId: 'run-2' }
const USER: Actor = { by: 'utente' }

/** The mail tables the registry reads, as the app creates them, cut to the columns it uses. */
async function mailTables(sql: Sql): Promise<void> {
  await sql.run('CREATE TABLE accounts (id TEXT PRIMARY KEY)')
  await sql.run(
    'CREATE TABLE folders (account_id TEXT, path TEXT, special_use TEXT, last_synced_at INTEGER)'
  )
  await sql.run(
    'CREATE TABLE messages (account_id TEXT, folder_path TEXT, uid INTEGER, message_key TEXT, thread_id TEXT)'
  )
  await sql.run("INSERT INTO accounts (id) VALUES ('acc')")
  await sql.run("INSERT INTO folders VALUES ('acc', 'INBOX', NULL, 1)")
}

describe('Registry', () => {
  let sql: ReturnType<typeof memorySql>
  let registry: Registry
  let changes: RegistryChange[]
  let lessons: Array<{ kind: string; payload: Record<string, unknown> }>

  beforeEach(async () => {
    sql = memorySql()
    await mailTables(sql)
    await ensureAiSchema(sql)
    changes = []
    lessons = []
    registry = new Registry(sql, {
      changed: (change) => changes.push(change),
      lesson: (kind, payload) => lessons.push({ kind, payload })
    })
  })

  afterEach(() => sql.close())

  describe('commitments', () => {
    it('opens things from an event or from the user’s word, each once from the same place', async () => {
      const visit = { kind: 'evento' as const, eventKey: 'g:cal:sopralluogo' }
      const first = await registry.openCommitment(
        visit,
        { kind: 'da_fare', text: 'Portare la planimetria' },
        BACKGROUND
      )
      const again = await registry.openCommitment(
        visit,
        { kind: 'da_fare', text: 'portare la planimetria.' },
        BACKGROUND
      )
      const said = await registry.openCommitment(
        { kind: 'utente' },
        { kind: 'da_fare', text: 'Chiamare il geometra', due: '2026-11-13' },
        CHAT
      )

      expect(first.created).toBe(true)
      expect(again).toMatchObject({ created: false, record: { id: first.record.id } })
      expect(said.record.origin).toEqual({ kind: 'utente' })
      expect((await registry.commitments.open()).map((item) => item.text).sort()).toEqual([
        'Chiamare il geometra',
        'Portare la planimetria'
      ])
    })

    it('does not open again from the background what the user closed, from the same event', async () => {
      const visit = { kind: 'evento' as const, eventKey: 'g:cal:sopralluogo' }
      const { record } = await registry.openCommitment(
        visit,
        { kind: 'da_fare', text: 'Portare la planimetria' },
        BACKGROUND
      )
      await registry.setCommitmentStatus(record.id, 'non_serve', USER)

      await expect(
        registry.openCommitment(
          visit,
          { kind: 'da_fare', text: 'Portare la planimetria' },
          BACKGROUND
        )
      ).rejects.toBeInstanceOf(RegistryRefusal)
    })

    it('counts in a project what is open from its events too', async () => {
      const { record: project } = await registry.createProject('Prat2470 · Hotel Lido', USER)
      await registry.projects.addResource(
        project.id,
        { kind: 'evento', location: 'g:cal:sopralluogo', label: 'Sopralluogo' },
        USER
      )
      await registry.openCommitment(
        { kind: 'evento', eventKey: 'g:cal:sopralluogo' },
        { kind: 'da_fare', text: 'Portare la planimetria' },
        BACKGROUND
      )

      expect((await registry.projects.summary(project.id))?.openCommitments).toBe(1)
      expect([...(await registry.projects.ofEvents(['g:cal:sopralluogo'])).keys()]).toEqual([
        'g:cal:sopralluogo'
      ])
      expect(
        (await registry.commitments.ofPlaces({ events: ['g:cal:sopralluogo'] })).map(
          (item) => item.text
        )
      ).toEqual(['Portare la planimetria'])
    })

    it('opens a thing once, however many times it is opened', async () => {
      const first = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Mandare il computo ad Anna' },
        BACKGROUND
      )
      const again = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'mandare il computo ad Anna.' },
        BACKGROUND
      )

      expect(first.created).toBe(true)
      expect(again.created).toBe(false)
      expect(again.record.id).toBe(first.record.id)
      expect(again.change).toBeNull()
    })

    it('does not open again from the background what the user closed, unless a newer message says so', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Mandare il computo ad Anna' },
        BACKGROUND
      )
      await registry.setCommitmentStatus(record.id, 'non_serve', USER)
      const before = new Date(Date.now() - 60_000).toISOString()

      await expect(
        registry.openCommitment(
          { kind: 'messaggio', ...ANNA, dateIso: before },
          { kind: 'ti_chiedono', text: 'Mandare il computo ad Anna' },
          BACKGROUND
        )
      ).rejects.toBeInstanceOf(RegistryRefusal)

      const newer = await registry.openCommitment(
        {
          kind: 'messaggio',
          ...ANNA,
          messageKey: 'm:anna-2',
          dateIso: new Date(Date.now() + 60_000).toISOString()
        },
        { kind: 'ti_chiedono', text: 'Mandare il computo ad Anna' },
        BACKGROUND
      )
      expect(newer.created).toBe(true)
    })

    it('keeps who closed a thing and why, and opens it again', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'hai_promesso', text: 'Le slide per stasera' },
        BACKGROUND
      )
      const done = await registry.setCommitmentStatus(record.id, 'fatta', USER, {
        reason: 'Fatto a voce'
      })
      const reopened = await registry.setCommitmentStatus(record.id, 'aperta', USER)

      expect(done.record).toMatchObject({
        status: 'fatta',
        setBy: 'utente',
        reason: 'Fatto a voce'
      })
      expect(done.record.closedAt).not.toBeNull()
      expect(reopened.record).toMatchObject({ status: 'aperta', closedAt: null })
      expect((await registry.commitments.history(record.id)).map((entry) => entry.action)).toEqual([
        'apri',
        'fatta',
        'riapri'
      ])
    })

    it('does not let a run in the background overturn the user without a newer message', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Il preventivo' },
        BACKGROUND
      )
      const closed = await registry.setCommitmentStatus(record.id, 'fatta', USER)

      await expect(
        registry.setCommitmentStatus(record.id, 'aperta', BACKGROUND, {
          evidence: {
            messageKey: 'm:old',
            dateIso: new Date(closed.record.updatedAt - 1000).toISOString()
          }
        })
      ).rejects.toBeInstanceOf(RegistryRefusal)

      const reopened = await registry.setCommitmentStatus(record.id, 'aperta', BACKGROUND, {
        evidence: {
          messageKey: 'm:new',
          dateIso: new Date(closed.record.updatedAt + 1000).toISOString()
        },
        reason: 'Anna scrive che non le è arrivato'
      })

      expect(reopened.record).toMatchObject({ status: 'aperta', evidenceKey: 'm:new' })
      // The chat works with the user watching: it may.
      await registry.setCommitmentStatus(record.id, 'fatta', USER)
      await expect(registry.setCommitmentStatus(record.id, 'aperta', CHAT)).resolves.toBeTruthy()
    })

    it('keeps what the user corrected from a run in the background', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Il preventivo' },
        BACKGROUND
      )
      await registry.commitments.edit(record.id, { due: '2026-11-20' }, USER)

      await expect(
        registry.commitments.edit(record.id, { due: '2026-11-10' }, BACKGROUND)
      ).rejects.toBeInstanceOf(RegistryRefusal)
      expect((await registry.commitments.get(record.id))?.due).toBe('2026-11-20')
    })

    it('refuses a write made on an old look at the thing', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'da_fare', text: 'Pagare la fattura' },
        BACKGROUND
      )
      await registry.setCommitmentStatus(record.id, 'fatta', USER)

      // A conflict says what the thing is now: the run has seen it, and may decide again.
      const refused = registry.editCommitment(record.id, { due: '2026-11-20' }, CHAT, {
        seenRevision: record.revision
      })
      await expect(refused).rejects.toBeInstanceOf(RevisionConflict)
      await expect(refused).rejects.toThrow(
        /ora è fatta, per mano dell’utente \(«Pagare la fattura»\)/
      )
    })

    it('puts off a thing until a day, and opens it again on that day', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'da_fare', text: 'Rinnovare il dominio' },
        BACKGROUND
      )

      await expect(registry.setCommitmentStatus(record.id, 'rinviata', USER)).rejects.toThrow(
        /fino_a/
      )
      await registry.setCommitmentStatus(record.id, 'rinviata', USER, { until: '2026-11-10' })
      expect(await registry.wakeDeferred('2026-11-09')).toHaveLength(0)
      const woken = await registry.wakeDeferred('2026-11-10')

      expect(woken.map((item) => item.status)).toEqual(['aperta'])
      expect(woken[0].setBy).toBe('sistema')
    })

    it('merges duplicates into the first, and learns when the user says one is not needed', async () => {
      const keep = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Integrazioni SCIA' },
        BACKGROUND
      )
      const dup = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA, threadId: 't2', messageKey: 'm:x' },
        { kind: 'ti_chiedono', text: 'Mandare le integrazioni all’architetto' },
        BACKGROUND
      )
      await registry.mergeCommitments(keep.record.id, [dup.record.id], BACKGROUND)
      const merged = await registry.commitments.get(dup.record.id)

      expect(merged).toMatchObject({ status: 'non_serve' })
      expect(merged?.reason).toContain(`#${keep.record.id}`)

      await registry.setCommitmentStatus(keep.record.id, 'non_serve', USER)
      expect(lessons.map((lesson) => lesson.kind)).toContain('impegno_non_serve')
    })

    it('undoes a change only while nothing changed it since', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'aspetti', text: 'Il DURC' },
        BACKGROUND
      )
      const closed = await registry.setCommitmentStatus(record.id, 'fatta', BACKGROUND)
      const undo = closed.change?.undo

      expect(undo?.kind).toBe('impegno')
      const restored = await registry.undoCommitment(
        (undo as { historyId: number }).historyId,
        USER
      )
      expect(restored?.status).toBe('aperta')
      await expect(
        registry.undoCommitment((undo as { historyId: number }).historyId, USER)
      ).rejects.toBeInstanceOf(RegistryRefusal)
    })
  })

  describe('projects', () => {
    it('refuses a write over a newer one, saying the project as it is now', async () => {
      const { record } = await registry.createProject('Prat2451 · Hotel Lido', BACKGROUND)
      await registry.setProjectState(
        record.id,
        'Si aspetta il collaudo.',
        [],
        Date.now(),
        CHAT,
        record.revision
      )

      const refused = registry.setProjectState(
        record.id,
        'Tutto fermo.',
        [],
        Date.now(),
        BACKGROUND,
        record.revision
      )
      await expect(refused).rejects.toBeInstanceOf(RevisionConflict)
      await expect(refused).rejects.toThrow(/«Il punto»: «Si aspetta il collaudo\.»/)
    })

    it('makes a project once, by name, and keeps the user’s name', async () => {
      const made = await registry.createProject('Prat2451 · Hotel Lido', BACKGROUND)
      const again = await registry.createProject('prat2451 – hotel lido', BACKGROUND)

      expect(again.created).toBe(false)
      expect(again.record.id).toBe(made.record.id)

      await registry.renameProject(made.record.id, 'Hotel Lido – ristrutturazione', USER)
      await expect(
        registry.renameProject(made.record.id, 'Hotel Lido', BACKGROUND)
      ).rejects.toBeInstanceOf(RegistryRefusal)
      expect(lessons.map((lesson) => lesson.kind)).toContain('progetto_rinominato')
    })

    it('never files again a conversation the user took out', async () => {
      const { record } = await registry.createProject('Partita del giovedì', BACKGROUND)
      await registry.linkThread(record.id, ANNA, BACKGROUND)
      await registry.unlinkThread(record.id, ANNA, USER)

      await expect(registry.linkThread(record.id, ANNA, BACKGROUND)).rejects.toBeInstanceOf(
        RegistryRefusal
      )
      expect(await registry.projects.threadsOf(record.id)).toHaveLength(0)
      await registry.linkThread(record.id, ANNA, USER)
      expect(await registry.projects.threadsOf(record.id)).toHaveLength(1)
    })

    it('holds a conversation in two projects, and merges projects with their conversations', async () => {
      const a = await registry.createProject('Offerta pompe', BACKGROUND)
      const b = await registry.createProject('Collaudo Ferri', BACKGROUND)
      await registry.linkThread(a.record.id, ANNA, BACKGROUND)
      await registry.linkThread(b.record.id, ANNA, BACKGROUND)

      expect(
        (await registry.projects.linksOf([ANNA])).map((link) => link.projectId).sort()
      ).toEqual([a.record.id, b.record.id].sort())

      await registry.mergeProjects(a.record.id, [b.record.id], USER)
      expect(await registry.projects.get(b.record.id)).toBeNull()
      expect(await registry.projects.threadsOf(a.record.id)).toEqual([
        { accountId: 'acc', threadId: 't1' }
      ])
    })

    it('takes away a project made by mistake, not one the user has worked on', async () => {
      const mistake = await registry.createProject('x', CHAT)
      await registry.linkThread(mistake.record.id, ANNA, CHAT)
      expect(changes.at(-2)?.undo).toEqual({
        kind: 'progetto-creato',
        projectId: mistake.record.id
      })

      await registry.removeProject(mistake.record.id, USER)
      expect(await registry.projects.get(mistake.record.id)).toBeNull()
      expect(await registry.projects.linksOf([ANNA])).toEqual([])

      const kept = await registry.createProject('Partita del giovedì', CHAT)
      await registry.linkThread(kept.record.id, ANNA, USER)
      await expect(registry.removeProject(kept.record.id, USER)).rejects.toBeInstanceOf(
        RegistryRefusal
      )
    })

    it('makes a project once when two readings make it together, and keeps names apart', async () => {
      const [first, second] = await Promise.all([
        registry.createProject('Prat2490 · Condominio Bologna', BACKGROUND),
        registry.createProject('prat2490 · condominio bologna', CHAT)
      ])
      expect(second.record.id).toBe(first.record.id)
      expect([first.created, second.created].sort()).toEqual([false, true])

      const other = await registry.createProject('Prat2491', BACKGROUND)
      await expect(
        registry.renameProject(other.record.id, 'PRAT2490 · Condominio Bologna', USER)
      ).rejects.toBeInstanceOf(RegistryRefusal)
    })

    it('says "Il punto" is behind once something moves in the project', async () => {
      const { record } = await registry.createProject('Prat2470', BACKGROUND)
      await registry.linkThread(record.id, ANNA, BACKGROUND)
      await registry.setProjectState(record.id, 'Si aspetta il Comune.', [], Date.now(), BACKGROUND)
      expect((await registry.projects.get(record.id))?.staleSince).toBeNull()

      await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'aspetti', text: 'Parere del Comune' },
        BACKGROUND
      )
      expect((await registry.projects.get(record.id))?.staleSince).not.toBeNull()
      expect((await registry.projects.summary(record.id))?.openCommitments).toBe(1)
    })

    it('keeps "Il punto" behind when the project moved after its writer began looking', async () => {
      const { record } = await registry.createProject('Prat2470', BACKGROUND)
      await registry.linkThread(record.id, ANNA, BACKGROUND)
      const begun = Date.now() - 1000
      await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'aspetti', text: 'Parere del Comune' },
        BACKGROUND
      )

      await registry.setProjectState(record.id, 'Si aspetta il Comune.', [], begun, BACKGROUND)
      expect((await registry.projects.get(record.id))?.staleSince).not.toBeNull()

      await registry.setProjectState(record.id, 'Si aspetta il Comune.', [], Date.now(), BACKGROUND)
      expect((await registry.projects.get(record.id))?.staleSince).toBeNull()
    })
  })

  describe('replies', () => {
    it('goes to be looked at again when the conversation moves on, and is not offered again once discarded', async () => {
      await registry.writeNote(
        { ...ANNA, direction: 'in', messageDate: '2026-11-02T09:00:00.000Z' },
        {
          summary: 'Anna chiede il computo',
          nature: 'da_rispondere',
          priority: 'alta',
          reason: 'cliente',
          due: null
        },
        BACKGROUND
      )
      // Prepared on the 2nd; Anna writes again on the 3rd.
      vi.useFakeTimers({ now: new Date('2026-11-02T10:00:00.000Z'), toFake: ['Date'] })
      await registry.saveReply(
        ANNA,
        { kind: 'risposta', text: 'Ciao Anna, …', doubts: '' },
        BACKGROUND
      )
      vi.useRealTimers()
      expect(await registry.viewKeys('bozze-pronte')).toEqual([
        { accountId: 'acc', messageKey: 'm:anna' }
      ])

      await registry.markRepliesStale(ANNA, '2026-11-03T09:00:00.000Z', 'Anna ha scritto di nuovo')
      expect(await registry.viewKeys('bozze-pronte')).toEqual([])
      expect((await registry.replies.get('acc', 'm:anna'))?.status).toBe('da_rivedere')

      // Confirmed after the newer message came, it is not sent back to be looked at again.
      await registry.setReplyStatus('acc', 'm:anna', 'pronta', BACKGROUND)
      await registry.markRepliesStale(ANNA, '2026-11-03T09:00:00.000Z', 'Anna ha scritto di nuovo')
      expect((await registry.replies.get('acc', 'm:anna'))?.status).toBe('pronta')

      await registry.setReplyStatus('acc', 'm:anna', 'scartata', USER)
      await expect(
        registry.saveReply(ANNA, { kind: 'risposta', text: 'Di nuovo', doubts: '' }, BACKGROUND)
      ).rejects.toBeInstanceOf(RegistryRefusal)
    })
  })

  describe('proposals', () => {
    it('keeps the answer the user gave while the same proposal was being made again', async () => {
      const first = await registry.propose(
        { kind: 'evento', title: 'Sopralluogo', payload: {}, ...ANNA, perMessage: false },
        BACKGROUND
      )
      // The user sets it aside right after a reading found it open, before it writes over it.
      const get = sql.get
      sql.get = async <T>(query: string, ...params: unknown[]): Promise<T | null> => {
        const row = await get<T>(query, ...params)

        if (row && query.includes("status = 'aperta'")) {
          sql.get = get
          await registry.decideProposal(first.id, 'scartata')
        }

        return row
      }

      const again = await registry.propose(
        { kind: 'evento', title: 'Sopralluogo alle 11', payload: {}, ...ANNA, replaces: first.id },
        BACKGROUND
      )

      expect(again.id).not.toBe(first.id)
      expect(again.status).toBe('aperta')
      expect(await registry.proposals.get(first.id)).toMatchObject({
        status: 'scartata',
        title: 'Sopralluogo'
      })
    })
  })

  describe('views', () => {
    it('holds what the user owes and what they wait for, whatever the note said', async () => {
      await registry.writeNote(
        { ...ANNA, direction: 'in', messageDate: '2026-11-02T09:00:00.000Z' },
        { summary: 'Info', nature: 'informativo', priority: 'bassa', reason: '', due: null },
        BACKGROUND
      )
      const owed = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Rispondere' },
        BACKGROUND
      )
      await registry.openCommitment(
        { kind: 'messaggio', ...ANNA, messageKey: 'm:sent', threadId: 't9' },
        { kind: 'aspetti', text: 'Il riscontro' },
        BACKGROUND
      )

      expect(await registry.viewKeys('da-gestire')).toEqual([
        { accountId: 'acc', messageKey: 'm:anna' }
      ])
      expect(await registry.viewKeys('in-attesa')).toEqual([
        { accountId: 'acc', messageKey: 'm:sent' }
      ])

      await registry.setCommitmentStatus(owed.record.id, 'fatta', USER)
      expect(await registry.viewKeys('da-gestire')).toEqual([])
      expect([...(await registry.activeKeys('acc', ['m:anna', 'm:sent']))]).toEqual(['m:sent'])
    })

    it('leaves out what is open from an event or the user’s word: no message to show', async () => {
      await registry.openCommitment(
        { kind: 'evento', eventKey: 'g:cal:sopralluogo' },
        { kind: 'da_fare', text: 'Portare la planimetria' },
        BACKGROUND
      )
      await registry.openCommitment(
        { kind: 'utente' },
        { kind: 'aspetti', text: 'Il bonifico di Rossi' },
        CHAT
      )

      expect(await registry.viewKeys('da-gestire')).toEqual([])
      expect(await registry.viewKeys('in-attesa')).toEqual([])
      expect(await registry.allActiveKeys()).toEqual([])
    })
  })

  describe('messages deleted for good', () => {
    it('settles what came from a message missing everywhere, only once the account is synced', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Firmare' },
        BACKGROUND
      )
      const start = Date.now()

      // Missing but not long enough: nothing happens.
      expect(await registry.settleDeleted(start)).toBe(0)
      // Still missing later, but a folder was never synced (a cache being rebuilt): nothing.
      await sql.run("UPDATE folders SET last_synced_at = NULL WHERE account_id = 'acc'")
      expect(await registry.settleDeleted(start + 31 * 60 * 1000)).toBe(0)
      // Read, but only before it went missing: it may have moved to a folder not read since.
      await sql.run("UPDATE folders SET last_synced_at = 1 WHERE account_id = 'acc'")
      expect(await registry.settleDeleted(start + 31 * 60 * 1000)).toBe(0)
      // Every folder read after it went missing, and it is in none: gone.
      await sql.run(
        "UPDATE folders SET last_synced_at = ? WHERE account_id = 'acc'",
        start + 60_000
      )

      expect(await registry.settleDeleted(start + 31 * 60 * 1000)).toBe(1)
      expect(await registry.commitments.get(record.id)).toMatchObject({
        status: 'non_serve',
        setBy: 'sistema'
      })
    })

    it('forgets a message that only moved', async () => {
      const { record } = await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text: 'Firmare' },
        BACKGROUND
      )
      const start = Date.now()
      await registry.settleDeleted(start)
      await sql.run("INSERT INTO messages VALUES ('acc', 'Archivio', 7, 'm:anna', 't1')")

      expect(await registry.settleDeleted(start + 31 * 60 * 1000)).toBe(0)
      expect((await registry.commitments.get(record.id))?.status).toBe('aperta')
    })
  })
})

describe('ensureAiSchema', () => {
  it('brings the first 2.0 tables to the registry: topics to projects, what was open to its new words', async () => {
    const sql = memorySql()
    await sql.run('CREATE TABLE ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    await sql.run(`CREATE TABLE ai_items (
      id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_key TEXT NOT NULL,
      kind TEXT NOT NULL, text TEXT NOT NULL, due TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL,
      closed_at INTEGER, closed_by TEXT)`)
    await sql.run(
      "INSERT INTO ai_items (account_id, thread_id, message_key, kind, text, status, created_at) VALUES ('a', 't', 'k', 'aspetti', 'x', 'aperto', 1), ('a', 't', 'k', 'aspetti', 'y', 'chiuso', 1)"
    )
    await sql.run(`CREATE TABLE ai_topics (
      id TEXT PRIMARY KEY, external_key TEXT UNIQUE, title TEXT NOT NULL, description TEXT, folder_path TEXT,
      aliases TEXT, rank INTEGER, active_at INTEGER, gist TEXT, gist_conversations INTEGER, origin TEXT NOT NULL,
      state TEXT, state_at INTEGER, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    await sql.run(`CREATE TABLE ai_topic_threads (
      account_id TEXT NOT NULL, thread_id TEXT NOT NULL, topic_id TEXT NOT NULL, linked_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY (account_id, thread_id))`)
    await sql.run(
      "INSERT INTO ai_topics VALUES ('p1', 'pratica:2451', 'Prat2451 · Lido', NULL, '/archivio/Prat2451-LIDO', NULL, 1, 1, 'Ristrutturazione', NULL, 'extension', NULL, NULL, NULL, 1, 1)"
    )
    await sql.run(
      "INSERT INTO ai_topics VALUES ('p2', 'pratica:2452', 'Prat2452 · Mai vista', NULL, NULL, NULL, 2, NULL, NULL, NULL, 'extension', NULL, NULL, NULL, 1, 1)"
    )
    await sql.run("INSERT INTO ai_topic_threads VALUES ('a', 't', 'p1', 'utente', 1)")
    await sql.run(`CREATE TABLE ai_archived (
      account_id TEXT NOT NULL, message_key TEXT NOT NULL, thread_id TEXT NOT NULL, folder TEXT NOT NULL,
      from_address TEXT, archived_at INTEGER NOT NULL, PRIMARY KEY (account_id, message_key))`)
    await sql.run(
      "INSERT INTO ai_archived VALUES ('a', 'k', 't', '/archivio/Prat2451-LIDO/261102x', 'x@y.it', 5)"
    )

    await ensureAiSchema(sql)
    await ensureAiSchema(sql)

    expect(await sql.all('SELECT status FROM ai_items ORDER BY id')).toEqual([
      { status: 'aperta' },
      { status: 'fatta' }
    ])
    expect(await sql.all('SELECT id, title, description, origin FROM ai_projects')).toEqual([
      { id: 'p1', title: 'Prat2451 · Lido', description: 'Ristrutturazione', origin: 'segretario' }
    ])
    expect(await sql.all('SELECT project_id, linked_by, rejected FROM ai_project_threads')).toEqual(
      [{ project_id: 'p1', linked_by: 'utente', rejected: 0 }]
    )
    expect(await sql.all('SELECT location FROM ai_project_resources')).toEqual([
      { location: '/archivio/Prat2451-LIDO' }
    ])
    expect(await sql.all('SELECT source, destination FROM ai_saved_copies')).toEqual([
      { source: 'siever', destination: '/archivio/Prat2451-LIDO/261102x' }
    ])
    expect(
      await sql.all(
        "SELECT name FROM sqlite_master WHERE name IN ('ai_topics', 'ai_topic_threads', 'ai_archived')"
      )
    ).toEqual([])
    sql.close()
  })
})
