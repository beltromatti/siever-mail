import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The tools reach Electron through what other tools read: not these tests.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getSystemLocale: () => 'it-IT', getLocaleCountryCode: () => 'IT' },
  BrowserWindow: class {},
  shell: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import {
  calendarKey,
  type CalendarEvent,
  type EventChange,
  type NewCalendarEvent
} from '@shared/calendar'

import { HandleRegistry } from '../agent/handles'
import {
  ToolInputError,
  type CalendarWriteOptions,
  type RunContext,
  type SegretarioCalendarPort,
  type ToolContext,
  type ToolOutcome
} from '../agent/tool-types'
import { Registry } from '../registry/registry'
import { ensureAiSchema } from '../schema'
import { memorySql } from '../testing/memory-sql'
import { calendarTool } from './calendar'

type CalendarEntry = Awaited<ReturnType<SegretarioCalendarPort['calendars']>>[number]

const WORK = calendarKey('c1', 'lavoro')
const LIFE = calendarKey('c1', 'life')
const HOLIDAYS = calendarKey('c1', 'festivita')
const HOME = calendarKey('c2', 'casa')

const entry = (key: string, name: string, more: Partial<CalendarEntry> = {}): CalendarEntry => ({
  key,
  connectionId: key.split('\u0000')[0],
  name,
  connection: key.startsWith('c1') ? 'mario@brenta.it' : 'mario@acme-srl.it',
  primary: false,
  writable: true,
  hidden: false,
  provider: 'google',
  role: 'tutti',
  roleBy: null,
  roleReason: null,
  ...more
})

const CALENDARS: CalendarEntry[] = [
  entry(WORK, 'Lavoro', { primary: true }),
  entry(LIFE, 'LIFE'),
  entry(HOLIDAYS, 'Festività', { writable: false }),
  entry(HOME, 'Casa', { provider: 'microsoft', primary: true })
]

/** An event of the user's in «Lavoro», on Monday 16 November at 9, as the calendars give it. */
function event(id: string, more: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    key: `${WORK}\u0000${id}`,
    connectionId: 'c1',
    calendarId: 'lavoro',
    calendarName: 'Lavoro',
    eventId: id,
    iCalUid: null,
    seriesId: null,
    title: 'Lezione di diritto',
    start: '2026-11-16T08:00:00.000Z',
    end: '2026-11-16T10:00:00.000Z',
    allDay: false,
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    myResponse: null,
    meetLink: null,
    htmlLink: null,
    origin: null,
    reminders: null,
    organizedByUser: true,
    yours: true,
    recurrence: null,
    managedBy: null,
    ...more
  }
}

const GUESTS = {
  attendees: [
    {
      email: 'rossi@brenta.it',
      name: 'Rossi',
      response: 'accepted' as const,
      self: false,
      organizer: false
    }
  ]
}

describe('calendario', () => {
  let sql: ReturnType<typeof memorySql>
  let events: Map<string, CalendarEvent>
  let updates: Array<{ key: string; change: EventChange; options?: CalendarWriteOptions }>
  let removed: Array<{ key: string; options?: CalendarWriteOptions }>
  let created: NewCalendarEvent[]
  let answered: Array<{ key: string; options?: CalendarWriteOptions }>
  let approvals: Array<{ title: string; details?: string[]; confirmLabel?: string }>
  let approve: boolean

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
    events = new Map()
    updates = []
    removed = []
    created = []
    answered = []
    approvals = []
    approve = true
  })

  afterEach(() => sql.close())

  /** The calendars as the tool reaches them: a move takes the event to the calendar's key, same id. */
  const calendar = (): Partial<SegretarioCalendarPort> => ({
    calendars: async () => CALENDARS,
    event: async (key) => events.get(key) ?? null,
    events: async () => [...events.values()],
    create: async (input) => {
      created.push(input)
      const made = event('nuovo', {
        key: `${input.calendarKey}\u0000nuovo`,
        title: input.title,
        start: input.start,
        end: input.end,
        recurrence: input.recurrence ?? null,
        seriesId: input.recurrence ? 'nuovo' : null
      })
      events.set(made.key, made)
      return made
    },
    update: async (key, change, options) => {
      updates.push({ key, change, options })
      const before = events.get(key)!
      const to = change.calendarKey
      const moved: CalendarEvent = {
        ...before,
        ...(change.title ? { title: change.title } : {}),
        ...(change.reminders !== undefined ? { reminders: change.reminders } : {}),
        ...(change.recurrence !== undefined ? { recurrence: change.recurrence } : {}),
        ...(to
          ? {
              key: `${to}\u0000${before.eventId}`,
              connectionId: to.split('\u0000')[0],
              calendarId: to.split('\u0000')[1],
              calendarName: CALENDARS.find((each) => each.key === to)!.name
            }
          : {})
      }
      events.delete(key)
      events.set(moved.key, moved)
      return moved
    },
    remove: async (key, options) => {
      removed.push({ key, options })
      events.delete(key)
    },
    respond: async (key, response, options) => {
      answered.push({ key, options })
      return { ...events.get(key)!, myResponse: response }
    }
  })

  /** A run that knows each event given as e1, e2…: in the chat, or on its own. */
  function runOf(known: CalendarEvent[], background = false): ToolContext {
    const handles = new HandleRegistry()

    for (const each of known) {
      events.set(each.key, each)
      handles.name({ kind: 'event', eventKey: each.key, title: each.title })
    }

    return {
      run: {
        activityId: 'run',
        task: background ? 'calendario' : 'richiesta',
        startedAt: Date.now(),
        background,
        watched: !background,
        actor: { by: 'segretario', runId: 'run', background },
        seen: new Map(),
        looking: new Set(),
        changes: [],
        results: {},
        fileSearches: new Map()
      } as RunContext,
      handles,
      newHandles: [],
      registry: new Registry(sql, { changed: () => undefined, lesson: () => undefined }),
      calendar: calendar() as SegretarioCalendarPort,
      requestApproval: async (request: {
        title: string
        details?: string[]
        confirmLabel?: string
      }) => {
        approvals.push(request)
        return { approved: approve }
      }
    } as unknown as ToolContext
  }

  const call = (args: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> =>
    calendarTool.execute(args, context)

  describe('modifica never pretends', () => {
    it('refuses a change that says nothing, and writes nothing in the diary', async () => {
      const context = runOf([event('a')])

      await expect(call({ azione: 'modifica', evento: 'e1' }, context)).rejects.toThrow(
        /Indica cosa cambia: .*`calendario`.*`ripeti`, `promemoria`/
      )
      await expect(
        call({ azione: 'modifica', evento: 'e1', titolo: 'Lezione di diritto' }, context)
      ).rejects.toThrow('È già così')
      expect(updates).toEqual([])
      expect(context.run.changes).toEqual([])
    })
  })

  describe('a move to another calendar', () => {
    it('is the same event there: its name, the diary and the undo follow it', async () => {
      const lesson = event('a')
      const context = runOf([lesson])
      context.run.seen.set('prep:' + lesson.key, 5)

      const outcome = await call({ azione: 'modifica', evento: 'e1', calendario: 'life' }, context)

      expect(updates).toEqual([
        { key: lesson.key, change: { calendarKey: LIFE }, options: { series: false } }
      ])
      expect(outcome.content).toMatch(/^Spostato in «LIFE»: e1 · /)
      expect(outcome.summary).toBe('Moved to LIFE: Lezione di diritto')
      expect(context.handles.event('e1')?.eventKey).toBe(`${LIFE}\u0000a`)
      expect(context.run.seen.get(`prep:${LIFE}\u0000a`)).toBe(5)
      expect(context.run.changes).toEqual([
        expect.objectContaining({
          label: 'Moved to LIFE: Lezione di diritto',
          undo: {
            kind: 'evento-modificato',
            eventKey: `${LIFE}\u0000a`,
            before: { calendarKey: WORK },
            series: false
          }
        })
      ])
      expect(approvals).toEqual([])
    })

    it('takes an instance with its series, and says so', async () => {
      const context = runOf([
        event('lez_1', { seriesId: 'lez', recurrence: { frequency: 'weekly', interval: 1 } })
      ])

      const outcome = await call({ azione: 'modifica', evento: 'e1', calendario: 'LIFE' }, context)

      expect(outcome.content).toContain('con tutta la serie')
    })

    it.each([
      [{ managedBy: 'gmail' as const }, 'LIFE', 'Gmail'],
      [
        { organizedByUser: false, organizer: 'bianchi@acme-srl.it' },
        'LIFE',
        "all'invito si risponde"
      ],
      [GUESTS, 'Casa', 'ha invitati'],
      [{}, 'Festività', 'non si scrive'],
      [{}, 'Lavoro', 'è già in «Lavoro»']
    ])(
      'is refused where the calendars do not let it, with why: %j to %s',
      async (more, to, why) => {
        const context = runOf([event('a', more)])

        await expect(
          call({ azione: 'modifica', evento: 'e1', calendario: to }, context)
        ).rejects.toThrow(why)
        expect(updates).toEqual([])
      }
    )

    it('is done on its own for the user’s events without guests; the rest is proposed', async () => {
      const context = runOf(
        [event('mio'), event('riunione', GUESTS), event('collega', { yours: false })],
        true
      )

      await call({ azione: 'modifica', evento: 'e1', calendario: 'LIFE' }, context)
      await expect(
        call({ azione: 'modifica', evento: 'e2', calendario: 'LIFE' }, context)
      ).rejects.toThrow('proponilo')
      await expect(
        call({ azione: 'modifica', evento: 'e3', calendario: 'LIFE' }, context)
      ).rejects.toThrow("Non è dell'utente")
      expect(updates.map((update) => update.key)).toEqual([`${WORK}\u0000mio`])
    })
  })

  describe('a list in one call: the same change to each', () => {
    it('asks the user once for those that reach others, and writes one line with one undo', async () => {
      const context = runOf([event('a', GUESTS), event('b', GUESTS), event('c')])

      const outcome = await call(
        { azione: 'modifica', evento: ['e1', 'e2', 'e3'], calendario: 'LIFE' },
        context
      )

      expect(approvals).toHaveLength(1)
      expect(approvals[0]).toMatchObject({
        title: 'Change 2 events',
        confirmLabel: 'Move',
        details: expect.arrayContaining([
          'Calendar: LIFE',
          'Guests aren’t told: it’s the same event, in another calendar.'
        ])
      })
      expect(updates).toHaveLength(3)
      expect(outcome.summary).toBe('Moved 3 events to LIFE')
      expect(outcome.content).toMatch(/^3 di 3 spostati in «LIFE»:/)
      expect(context.run.changes).toHaveLength(1)
      expect(context.run.changes[0].undo).toMatchObject({
        kind: 'eventi',
        each: [
          { eventKey: `${LIFE}\u0000a`, before: { calendarKey: WORK } },
          { eventKey: `${LIFE}\u0000b` },
          { eventKey: `${LIFE}\u0000c` }
        ]
      })
    })

    it('checks each on its own and says what was left, and why', async () => {
      const context = runOf([event('a'), event('volo', { managedBy: 'gmail' })])

      const outcome = await call(
        { azione: 'modifica', evento: ['e1', 'e2'], calendario: 'LIFE' },
        context
      )

      expect(outcome.content).toContain('1 di 2 spostati in «LIFE»')
      expect(outcome.content).toMatch(/Lasciati com'erano:\n- e2 «Lezione di diritto»: .*Gmail/)
      expect(outcome.summary).toBe('Moved to LIFE: Lezione di diritto · 1 left as it was')
    })

    it('never gives several events the same time', async () => {
      const context = runOf([event('a'), event('b')])

      await expect(
        call({ azione: 'modifica', evento: ['e1', 'e2'], inizio: '2026-11-17T09:00' }, context)
      ).rejects.toThrow('Lo stesso orario per più eventi')
    })

    it('acts once on a series named by several of its instances', async () => {
      const series = { seriesId: 'lez', recurrence: { frequency: 'weekly' as const, interval: 1 } }
      const context = runOf([event('lez_1', series), event('lez_2', series)])

      const outcome = await call(
        { azione: 'modifica', evento: ['e1', 'e2'], promemoria: [30], serie: true },
        context
      )

      expect(updates).toEqual([
        { key: `${WORK}\u0000lez_1`, change: { reminders: [30] }, options: { series: true } }
      ])
      expect(outcome.content).toContain('della stessa serie di e1')
    })

    it('takes several events away with one confirmation, each put back by the one undo', async () => {
      const context = runOf([event('a'), event('b')])

      const outcome = await call({ azione: 'elimina', evento: ['e1', 'e2'] }, context)

      expect(approvals).toEqual([expect.objectContaining({ title: 'Delete 2 events' })])
      expect(removed.map((each) => each.key)).toEqual([`${WORK}\u0000a`, `${WORK}\u0000b`])
      expect(outcome.summary).toBe('Removed 2 events from the calendar')
      expect(context.run.changes[0].undo).toMatchObject({
        kind: 'eventi',
        each: [
          { kind: 'evento-eliminato', event: { calendarKey: WORK, title: 'Lezione di diritto' } },
          { kind: 'evento-eliminato' }
        ]
      })
    })

    it('answers several invitations with one confirmation, and says which is none', async () => {
      const invitation = { myResponse: 'needsAction' as const, organizer: 'bianchi@acme-srl.it' }
      const context = runOf([event('a', invitation), event('b', invitation), event('mio')])

      const outcome = await call(
        { azione: 'rispondi', evento: ['e1', 'e2', 'e3'], risposta: 'accepted' },
        context
      )

      expect(approvals).toEqual([expect.objectContaining({ title: 'Attend 2 invitations' })])
      expect(answered).toHaveLength(2)
      expect(outcome.content).toContain('non è un invito')
    })
  })

  describe('repeating and reminding', () => {
    it('makes a timetable one event that repeats, its undo the whole series', async () => {
      const context = runOf([])

      await call(
        {
          azione: 'crea',
          titolo: 'Lezione di diritto',
          calendario: 'LIFE',
          inizio: '2026-11-16T09:00',
          fine: '2026-11-16T11:00',
          ripeti: { ogni: 'settimana', giorni: ['lun', 'gio'], fino_al: '2026-12-22' },
          promemoria: [15]
        },
        context
      )

      expect(created[0]).toMatchObject({
        calendarKey: LIFE,
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          weekdays: ['MO', 'TH'],
          until: '2026-12-22'
        },
        reminders: [15]
      })
      expect(context.run.changes[0].undo).toMatchObject({ kind: 'evento-creato', series: true })
    })

    it('says, of one already there, the calendar it is in', async () => {
      const context = runOf([event('a', { calendarName: 'LIFE' })])

      const outcome = await call(
        {
          azione: 'crea',
          titolo: 'Lezione di diritto',
          calendario: 'Lavoro',
          inizio: '2026-11-16T09:00',
          fine: '2026-11-16T11:00'
        },
        context
      )

      expect(outcome.content).toMatch(/^C'è già, in «LIFE»: .*spostalo/s)
      expect(created).toEqual([])
    })

    it('keeps to the reminders a calendar takes', async () => {
      const context = runOf([
        event('casa', { key: `${HOME}\u0000casa`, connectionId: 'c2', calendarId: 'casa' })
      ])

      await expect(
        call({ azione: 'modifica', evento: 'e1', promemoria: [10, 60] }, context)
      ).rejects.toThrow('un promemoria solo')
    })

    it('does not change a rule made elsewhere', async () => {
      const context = runOf([event('a', { seriesId: 'x', recurrence: 'other' })])

      await expect(
        call({ azione: 'modifica', evento: 'e1', ripeti: { ogni: 'giorno' } }, context)
      ).rejects.toThrow('regola fatta altrove')
    })

    it('ends a series from any of its times, the rule always the series’', async () => {
      const series = { seriesId: 'lez', recurrence: { frequency: 'weekly' as const, interval: 1 } }
      // A Thursday of a series that started on a Monday: its first time is not this one.
      const context = runOf([event('lez_9', { ...series, start: '2026-12-10T08:00:00.000Z' })])

      const outcome = await call(
        {
          azione: 'modifica',
          evento: 'e1',
          ripeti: { ogni: 'settimana', giorni: ['lun'], fino_al: '2026-12-07' }
        },
        context
      )

      expect(updates[0].change).toEqual({
        recurrence: { frequency: 'weekly', interval: 1, weekdays: ['MO'], until: '2026-12-07' }
      })
      expect(outcome.content).toContain('come si ripete è della serie')
    })

    it('lets a series stop repeating, and puts its rule back on undo', async () => {
      const rule = { frequency: 'weekly' as const, interval: 1 }
      const context = runOf([event('a', { seriesId: 'a', recurrence: rule })])

      await call({ azione: 'modifica', evento: 'e1', ripeti: { ogni: 'mai' } }, context)

      expect(updates[0].change).toEqual({ recurrence: null })
      expect(context.run.changes[0].undo).toMatchObject({ before: { recurrence: rule } })
    })
  })

  it('proposes a move the user decides, with the series and what changes in their words', async () => {
    const context = runOf([event('a', { ...GUESTS, seriesId: 'a' })], true)

    await call(
      { azione: 'proponi', evento: 'e1', calendario: 'LIFE', serie: true, promemoria: [1440] },
      context
    )

    const [proposal] = await context.registry.proposals.open({ kind: 'evento' })
    expect(proposal.payload).toMatchObject({
      series: true,
      change: { calendarKey: LIFE, reminders: [1440] },
      changes: ['Calendar: LIFE (was Lavoro)', 'Reminders: 1 day before', 'The whole series']
    })
  })

  it('follows, in the run’s own diary, an event it made and then moved', async () => {
    const context = runOf([])
    await call(
      {
        azione: 'crea',
        titolo: 'Visita',
        calendario: 'Lavoro',
        inizio: '2026-11-18T15:00',
        fine: '2026-11-18T16:00'
      },
      context
    )

    await call({ azione: 'modifica', evento: 'e1', calendario: 'LIFE' }, context)

    expect(context.run.changes[0]).toMatchObject({
      id: `${LIFE}\u0000nuovo`,
      undo: { kind: 'evento-creato', eventKey: `${LIFE}\u0000nuovo` }
    })
  })

  it('reads a user who declines as an answer, not a failure', async () => {
    approve = false
    const context = runOf([event('a', GUESTS)])

    const outcome = await call({ azione: 'modifica', evento: 'e1', calendario: 'LIFE' }, context)

    expect(outcome.content).toBe("L'utente non l'ha confermato.")
    expect(updates).toEqual([])
    expect(outcome.failed).toBeUndefined()
  })

  it('says a refusal as a mistake the model can act on', async () => {
    const context = runOf([event('a')])

    await expect(
      call({ azione: 'modifica', evento: 'e1', calendario: 'Nessuno' }, context)
    ).rejects.toThrow(ToolInputError)
  })
})
