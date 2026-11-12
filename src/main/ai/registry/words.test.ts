import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { HandleLink, WorkTarget } from '@shared/segretario'

import { AiStore } from '../ai-store'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { Registry } from './registry'
import { RegistryRefusal, type Actor, type RegistryChange } from './types'

const ANNA = { accountId: 'acc', messageKey: 'm:anna', threadId: 't1' }
const USER: Actor = { by: 'utente' }
const READING: Actor = { by: 'segretario', runId: 'lettura-1', background: true }

/** A message's link, as the words that stay keep it. */
const LINK: HandleLink = {
  handle: 'm4',
  kind: 'message',
  ref: { accountId: 'acc', folderPath: 'INBOX', uid: 4 },
  messageKey: 'm:rossi'
}
const PROJECT_LINK: HandleLink = {
  handle: 'p1',
  kind: 'project',
  projectId: 'casa',
  title: 'Casa al mare'
}

describe('The user’s words on what the Segretario wrote', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore
  let registry: Registry
  let changes: RegistryChange[]
  let lessons: Array<{ kind: string; payload: Record<string, unknown> }>

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
    changes = []
    lessons = []
    registry = new Registry(sql, {
      changed: (change) => changes.push(change),
      lesson: (kind, payload) => lessons.push({ kind, payload })
    })
  })

  afterEach(() => sql.close())

  const openThing = async (text = 'Mandare il preventivo a Rossi'): Promise<number> =>
    (
      await registry.openCommitment(
        { kind: 'messaggio', ...ANNA },
        { kind: 'ti_chiedono', text, question: 'È ancora aperta?' },
        READING
      )
    ).record.id

  const noteAnna = async (): Promise<void> => {
    await registry.writeNote(
      { ...ANNA, direction: 'in', messageDate: '2026-11-10T09:00:00.000Z' },
      {
        summary: 'Chiede il preventivo',
        nature: 'da_rispondere',
        priority: 'media',
        reason: '',
        due: null
      },
      READING
    )
  }

  describe('Correggi and Rispondi', () => {
    it('keeps a correction as a lesson with the thing as it reads, and shows it waiting', async () => {
      const id = await openThing()
      const target: WorkTarget = { kind: 'impegno', id }

      await registry.giveWords(target, 'correzione', '  Non è per Rossi: è per Bianchi.  ')

      const [lesson] = await store.pendingLessons()
      expect(lesson).toMatchObject({
        kind: 'da_correggere',
        payload: {
          oggetto: target,
          parole: 'Non è per Rossi: è per Bianchi.',
          com_era: 'Mandare il preventivo a Rossi',
          messaggio: { accountId: 'acc', messageKey: 'm:anna' }
        }
      })
      expect((await registry.words.pending([target])).get(`impegno:${id}`)).toMatchObject({
        kind: 'correzione',
        words: 'Non è per Rossi: è per Bianchi.'
      })
      // The views showing it follow: its conversation's.
      expect(changes.at(-1)).toMatchObject({
        object: 'impegno',
        accountId: 'acc',
        threadIds: ['t1'],
        messageKeys: ['m:anna']
      })
    })

    it('keeps an answer with its question; a correction shows over it, each the latest', async () => {
      const id = await openThing()
      const target: WorkTarget = { kind: 'impegno', id }

      await registry.giveWords(target, 'risposta', 'Sì, aspetto la firma.')
      expect((await store.pendingLessons())[0]).toMatchObject({
        kind: 'risposta',
        payload: { domanda: 'È ancora aperta?', parole: 'Sì, aspetto la firma.' }
      })
      expect((await registry.words.pending([target])).get(`impegno:${id}`)?.kind).toBe('risposta')

      await registry.giveWords(target, 'correzione', 'Il testo è sbagliato.')
      await registry.giveWords(target, 'risposta', 'Anzi, la firma è arrivata.')
      expect((await registry.words.pending([target])).get(`impegno:${id}`)).toMatchObject({
        kind: 'correzione',
        words: 'Il testo è sbagliato.'
      })
    })

    it('waits on every kind of thing, and refuses words on what is no longer there', async () => {
      await noteAnna()
      await registry.day.saveLetter('2026-11-12', 'Oggi conta il sopralluogo.', [])
      const note: WorkTarget = { kind: 'nota', accountId: 'acc', messageKey: 'm:anna' }
      const letter: WorkTarget = { kind: 'lettera', day: '2026-11-12' }

      await registry.giveWords(note, 'correzione', 'Non chiede niente.')
      await registry.giveWords(letter, 'correzione', 'Il sopralluogo è domani.')

      expect([...(await registry.words.pending([note, letter])).keys()].sort()).toEqual([
        'lettera:2026-11-12',
        'nota:acc:m:anna'
      ])
      await expect(
        registry.giveWords({ kind: 'punto', projectId: 'nessuno' }, 'correzione', 'No.')
      ).rejects.toBeInstanceOf(RegistryRefusal)
      await expect(
        registry.giveWords({ kind: 'impegno', id: 999 }, 'correzione', 'No.')
      ).rejects.toBeInstanceOf(RegistryRefusal)
    })

    it('is taken back while waiting, teaching nothing; taken back while taken in, a lesson', async () => {
      const id = await openThing()
      const target: WorkTarget = { kind: 'impegno', id }

      await registry.giveWords(target, 'correzione', 'Non serve più.')
      await registry.withdrawWords(target)
      expect(await store.pendingLessons()).toEqual([])
      expect(lessons).toEqual([])

      await registry.giveWords(target, 'correzione', 'Non serve più.')
      await store.claimLessons(
        (await store.pendingLessons()).map((lesson) => lesson.id),
        'riflessione-1'
      )
      await registry.withdrawWords(target)

      expect((await registry.words.pending([target])).size).toBe(0)
      expect(lessons).toEqual([
        { kind: 'parole_ritirate', payload: { oggetto: target, parole: ['Non serve più.'] } }
      ])
    })

    it('goes once the reflection that took it in is done, and stays when it fails', async () => {
      const id = await openThing()
      const target: WorkTarget = { kind: 'impegno', id }
      await registry.giveWords(target, 'correzione', 'È per Bianchi.')
      const ids = (await store.pendingLessons()).map((lesson) => lesson.id)

      await store.claimLessons(ids, 'riflessione-1')
      // Still waiting while it is being taken in.
      expect((await registry.words.pending([target])).size).toBe(1)
      await store.endReflection('riflessione-1', false)
      expect((await registry.words.pending([target])).size).toBe(1)

      await store.claimLessons(ids, 'riflessione-2')
      await store.endReflection('riflessione-2', true)
      expect((await registry.words.pending([target])).size).toBe(0)

      await registry.wordsTaken([target, target])
      expect(changes.filter((change) => change.action === 'parole')).toHaveLength(1)
    })

    it('lets the reflection carrying the user’s words change what the user decided, and only that', async () => {
      const id = await openThing()
      const other = await openThing('Chiamare il geometra')
      await registry.setCommitmentStatus(id, 'rinviata', USER, { until: '2026-12-01' })
      await registry.setCommitmentStatus(other, 'rinviata', USER, { until: '2026-12-01' })
      const reflection: Actor = { by: 'segretario', runId: 'riflessione-1', background: true }

      await registry.giveWords({ kind: 'impegno', id }, 'correzione', 'È già fatta.')
      await store.claimLessons(
        (await store.pendingLessons()).map((lesson) => lesson.id),
        'riflessione-1'
      )

      // Another run in the background does not carry them.
      await expect(registry.editCommitment(id, { text: 'Altro' }, READING)).rejects.toBeInstanceOf(
        RegistryRefusal
      )
      await expect(registry.setCommitmentStatus(id, 'fatta', reflection)).resolves.toMatchObject({
        record: { status: 'fatta' }
      })
      await expect(registry.setCommitmentStatus(other, 'fatta', reflection)).rejects.toBeInstanceOf(
        RegistryRefusal
      )
    })
  })

  it('lets the reflection put right a note the user had rewritten, when they ask in words', async () => {
    const note: WorkTarget = { kind: 'nota', accountId: 'acc', messageKey: 'm:anna' }
    await noteAnna()
    await registry.rewrite(note, 'Chiede il preventivo per venerdì')
    await registry.giveWords(note, 'correzione', 'Non venerdì: lunedì.')
    await store.claimLessons(
      (await store.pendingLessons()).map((lesson) => lesson.id),
      'riflessione-1'
    )

    await registry.writeNote(
      { ...ANNA, direction: 'in', messageDate: '2026-11-10T09:00:00.000Z' },
      {
        summary: 'Chiede il preventivo per lunedì',
        nature: 'da_rispondere',
        priority: 'media',
        reason: '',
        due: null
      },
      { by: 'segretario', runId: 'riflessione-1', background: true }
    )
    expect((await registry.notes.get('acc', 'm:anna'))?.summary).toBe(
      'Chiede il preventivo per lunedì'
    )
  })

  describe('Riscrivi', () => {
    it('rewrites an open thing as the user’s, its revision moving on, with the before and the after', async () => {
      const id = await openThing()
      const before = await registry.commitments.get(id)

      await registry.rewrite({ kind: 'impegno', id }, 'Mandare il preventivo a Bianchi')

      const after = await registry.commitments.get(id)
      expect(after).toMatchObject({ text: 'Mandare il preventivo a Bianchi', setBy: 'utente' })
      expect(after!.revision).toBeGreaterThan(before!.revision)
      expect(lessons).toEqual([
        {
          kind: 'riscritta',
          payload: {
            oggetto: { kind: 'impegno', id },
            messaggio: { accountId: 'acc', messageKey: 'm:anna' },
            impegno: id,
            prima: 'Mandare il preventivo a Rossi',
            dopo: 'Mandare il preventivo a Bianchi'
          }
        }
      ])
    })

    it('rewrites a note as the user’s, which a reading in the background leaves as it is', async () => {
      await noteAnna()

      await registry.rewrite(
        { kind: 'nota', accountId: 'acc', messageKey: 'm:anna' },
        'Chiede il preventivo entro venerdì'
      )

      expect(await registry.notes.get('acc', 'm:anna')).toMatchObject({
        summary: 'Chiede il preventivo entro venerdì',
        writtenBy: 'utente'
      })
      expect(lessons.map((lesson) => lesson.kind)).toEqual(['riscritta'])
      await expect(noteAnna()).rejects.toBeInstanceOf(RegistryRefusal)
    })

    it('keeps the links of the letter whose words survive, and lets go of the others', async () => {
      const day = '2026-11-12'
      await registry.day.saveLetter(
        day,
        'Oggi conta [il preventivo di Rossi](mail:m4) per [Casa al mare](progetto:p1).',
        [LINK, PROJECT_LINK]
      )

      await registry.rewrite(
        { kind: 'lettera', day },
        'Prima di tutto Casa al mare: il sopralluogo è alle 10.'
      )

      expect(await registry.day.letter(day)).toMatchObject({
        text: 'Prima di tutto [Casa al mare](progetto:p1): il sopralluogo è alle 10.',
        links: [PROJECT_LINK],
        writtenBy: 'utente'
      })
      expect(lessons[0]).toMatchObject({
        kind: 'riscritta',
        payload: {
          giorno: day,
          prima: 'Oggi conta il preventivo di Rossi per Casa al mare.',
          dopo: 'Prima di tutto Casa al mare: il sopralluogo è alle 10.'
        }
      })
    })

    it('rewrites «Il punto», a preparation and a reply as the user’s', async () => {
      const { record: project } = await registry.createProject('Casa al mare', READING)
      await registry.setProjectState(
        project.id,
        'Aspettiamo [il preventivo](m4).',
        [LINK],
        Date.now(),
        READING
      )
      await registry.savePrep('cal:visita', 'Visita', 'Portare la planimetria.', [], READING)
      await registry.saveReply(
        ANNA,
        { kind: 'risposta', text: 'Gentile Anna, …', doubts: 'Lo sconto?' },
        READING
      )

      await registry.rewrite(
        { kind: 'punto', projectId: project.id },
        'Il preventivo è arrivato: manca la firma.'
      )
      await registry.rewrite(
        { kind: 'preparazione', eventKey: 'cal:visita' },
        'Portare la planimetria e le chiavi.',
        { eventTitle: 'Visita' }
      )
      await registry.rewrite(
        { kind: 'risposta', accountId: 'acc', messageKey: 'm:anna' },
        'Cara Anna, ecco il preventivo.'
      )

      expect(await registry.projects.get(project.id)).toMatchObject({
        state: '[Il preventivo](m4) è arrivato: manca la firma.',
        stateLinks: [LINK],
        stateBy: 'utente',
        staleSince: null
      })
      expect(await registry.day.prep('cal:visita')).toMatchObject({
        text: 'Portare la planimetria e le chiavi.',
        writtenBy: 'utente'
      })
      expect(await registry.replies.get('acc', 'm:anna')).toMatchObject({
        text: 'Cara Anna, ecco il preventivo.',
        doubts: '',
        status: 'pronta',
        writtenBy: 'utente'
      })
      expect(lessons.map((lesson) => (lesson.payload.oggetto as WorkTarget).kind)).toEqual([
        'punto',
        'preparazione',
        'risposta'
      ])
    })

    it('teaches nothing when the words are the same, and refuses what is gone', async () => {
      const id = await openThing()

      await registry.rewrite({ kind: 'impegno', id }, 'Mandare il preventivo a Rossi')
      expect(lessons).toEqual([])
      await expect(
        registry.rewrite({ kind: 'lettera', day: '2026-01-01' }, 'Nuova')
      ).rejects.toBeInstanceOf(RegistryRefusal)
    })
  })
})
