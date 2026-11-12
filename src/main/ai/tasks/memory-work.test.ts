import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SegretarioMailPort } from '../agent/tool-types'
import { AiStore } from '../ai-store'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { localDay } from '../tools/day'
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
        store,
        registry: new Registry(sql, { changed: () => undefined, lesson: () => undefined })
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

describe('What the reflection hears of the user’s words', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore
  let registry: Registry

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
    // The lessons the registry teaches, kept as the app keeps them.
    registry = new Registry(sql, {
      changed: () => undefined,
      lesson: (kind, payload) => void store.addLesson(kind, payload)
    })
  })

  afterEach(() => sql.close())

  const mail = {
    listAccounts: async () => [{ id: 'acc', email: 'lavoro@brenta.it' }],
    messageSummaries: async (_accountId: string, keys: string[]) =>
      new Map(
        keys.map((key) => [
          key,
          {
            ref: { accountId: 'acc', folderPath: 'INBOX', uid: 7 },
            dateIso: '2026-11-10T09:00:00.000Z',
            from: [{ name: 'Anna Rossi', address: 'anna@brenta.it' }],
            subject: 'Preventivo'
          }
        ])
      )
  } as unknown as SegretarioMailPort

  const reflect = (): ReturnType<typeof prepareReflection> =>
    prepareReflection({ mail, calendar: { event: async () => null }, store, registry })

  it('gives the words first, each with the thing as it is, a name for it, and its revision seen', async () => {
    await store.addLesson('impegno_non_serve', { impegno: 9, testo: 'Altro' })
    const { record } = await registry.openCommitment(
      { kind: 'messaggio', accountId: 'acc', threadId: 't1', messageKey: 'm:anna' },
      { kind: 'ti_chiedono', text: 'Mandare il preventivo', question: 'È ancora aperta?' },
      { by: 'segretario', runId: 'lettura-1', background: true }
    )
    await registry.giveWords({ kind: 'impegno', id: record.id }, 'risposta', 'Sì, aspetto Bianchi.')

    const data = await reflect()

    expect(data?.data.indexOf("## Le parole dell'utente")).toBeLessThan(
      data?.data.indexOf('## impegno non serve') ?? 0
    )
    expect(data?.data).toContain(`### Risposta alla tua domanda · la cosa aperta #${record.id}`)
    expect(data?.data).toContain(`Com'è ora: #${record.id} ti chiedono · «Mandare il preventivo»`)
    expect(data?.data).toContain('Il messaggio: m1 · ')
    expect(data?.data).toContain('Avevi chiesto: «È ancora aperta?»')
    expect(data?.data).toContain('> Sì, aspetto Bianchi.')
    expect(data?.seen?.get(`item:${record.id}`)).toBe(record.revision)
    expect(data?.handles.map((named) => named.handle)).toEqual(['m1'])
    expect(data?.words).toEqual([{ kind: 'impegno', id: record.id }])
  })

  it('names the links of the words that stay for the run, and tells what the user rewrote', async () => {
    const day = localDay()
    await registry.day.saveLetter(day, 'Oggi conta [Casa al mare](progetto:p4).', [
      { handle: 'p4', kind: 'project', projectId: 'casa', title: 'Casa al mare' }
    ])
    await registry.giveWords({ kind: 'lettera', day }, 'correzione', 'Casa al mare è chiusa.')
    await registry.rewrite({ kind: 'lettera', day }, 'Oggi niente di urgente.')
    // The lessons the registry teaches are kept as they come.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const data = await reflect()

    expect(data?.data).toContain('### Da correggere · la lettera di Oggi')
    expect(data?.data).toContain("La lettera di oggi com'è ora, riscritta dall'utente:")
    expect(data?.data).toContain('## Riscritta a mano · la lettera di Oggi')
    expect(data?.data).toContain('> Oggi conta Casa al mare.')
    expect(data?.data).toContain('> Oggi niente di urgente.')
    expect(data?.seen?.get(`letter:${day}`)).toBe((await registry.day.letter(day))?.writtenAt)
  })

  it('names again for its run the links of the words it may write back', async () => {
    await registry.savePrep(
      'cal:visita',
      'Visita',
      'Portare [la planimetria](file:f7) per [Casa al mare](progetto:p4), e [il vecchio](m9).',
      [
        {
          handle: 'f7',
          kind: 'file',
          fileName: 'planimetria.pdf',
          path: '/Lavori/planimetria.pdf'
        },
        { handle: 'p4', kind: 'project', projectId: 'casa', title: 'Casa al mare' }
      ],
      { by: 'segretario', runId: 'giornata-1', background: true }
    )
    await registry.giveWords(
      { kind: 'preparazione', eventKey: 'cal:visita' },
      'correzione',
      'Serve anche il contratto.'
    )

    const data = await reflect()

    expect(data?.data).toContain(
      '> Portare [la planimetria](file:f1) per [Casa al mare](progetto:p1), e il vecchio.'
    )
    expect(data?.handles).toEqual([
      {
        handle: 'f1',
        target: {
          kind: 'file',
          file: { kind: 'path', path: '/Lavori/planimetria.pdf', fileName: 'planimetria.pdf' }
        }
      },
      { handle: 'p1', target: { kind: 'project', projectId: 'casa', title: 'Casa al mare' } }
    ])
    expect(data?.seen?.get('prep:cal:visita')).toBe(
      (await registry.day.prep('cal:visita'))?.writtenAt
    )
  })

  it('says a thing is gone, with what it said when the user wrote', async () => {
    await registry.createProject('Casa al mare', { by: 'segretario', runId: 'r', background: true })
    const project = (await registry.projects.list({}))[0]
    await registry.setProjectState(project.id, 'Si aspetta [la firma](m3).', [], Date.now(), {
      by: 'segretario',
      runId: 'r',
      background: true
    })
    await registry.giveWords({ kind: 'punto', projectId: project.id }, 'correzione', 'Firmato.')
    await sql.run('DELETE FROM ai_projects')

    expect((await reflect())?.data).toContain(
      "Non c'è più. Quando l'utente ha scritto diceva: «Si aspetta la firma.»."
    )
  })
})
