import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { focus: () => undefined, getSystemLocale: () => 'it-IT', getLocaleCountryCode: () => 'IT' },
  shell: {},
  Notification: class {}
}))

import type { NotificationCenter, NotificationInput } from '@main/notifications/center'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences
} from '@shared/notifications'

import { CalendarNotifications, type ChangeByOthers } from './calendar-notifications'
import { instantsOf, remindersOf, startWords, whenWords, type RemindedEvent } from './reminders'

const MINUTE = 60_000
const NOW = new Date(2026, 10, 9, 9, 0).getTime()

function event(overrides: Partial<RemindedEvent> = {}): RemindedEvent {
  return {
    key: 'e1',
    title: 'Sopralluogo in cantiere',
    calendarName: 'Lavoro',
    allDay: false,
    startsAt: NOW + 60 * MINUTE,
    endsAt: NOW + 120 * MINUTE,
    location: 'Via Roma 3',
    meetLink: null,
    reminders: null,
    ...overrides
  }
}

describe('the reminders of the events', () => {
  it('are the event’s own, or the chosen lead for one that says none — not for an all-day one', () => {
    const reminders = remindersOf(
      [
        event({ key: 'own', reminders: [30, 5, 30] }),
        event({ key: 'none', reminders: null }),
        event({ key: 'off', reminders: [] }),
        event({ key: 'birthday', reminders: null, allDay: true })
      ],
      10
    )

    expect(reminders.map((reminder) => [reminder.event.key, reminder.minutes])).toEqual([
      ['own', 30],
      ['none', 10],
      ['own', 5]
    ])
    expect(remindersOf([event()], null)).toEqual([])
    // Kept on disk to be given once: plain text, apart for each occurrence and lead.
    const keys = remindersOf(
      [event({ key: 'conn\u0000cal\u0000a', reminders: [5, 10] })],
      null
    ).map((reminder) => reminder.key)
    expect(new Set(keys).size).toBe(2)
    expect(keys.join('')).not.toContain('\u0000')
  })

  it('say when the event starts, in words', () => {
    expect(startWords(event(), NOW)).toBe('In 1 hour · 10:00')
    expect(startWords(event({ startsAt: NOW + 10 * MINUTE }), NOW)).toBe('In 10 minutes · 09:10')
    expect(startWords(event({ startsAt: NOW + 30_000 }), NOW)).toBe('Now · 09:00')
    expect(startWords(event({ startsAt: NOW + 24 * 60 * MINUTE }), NOW)).toBe('Tomorrow at 09:00')
    expect(startWords(event({ allDay: true }), NOW)).toBe('Today, all day')
    expect(whenWords(event(), NOW)).toBe('today, 10:00–11:00')
  })

  it('reckon an all-day event by local midnight', () => {
    expect(instantsOf({ start: '2026-11-09', end: '2026-11-10', allDay: true })).toEqual({
      startsAt: new Date(2026, 10, 9).getTime(),
      endsAt: new Date(2026, 10, 10).getTime()
    })
  })
})

describe('the calendar’s notifications', () => {
  let shown: NotificationInput[]
  let given: Set<string>
  let events: RemindedEvent[]
  let notifications: CalendarNotifications
  let looking: boolean
  let seen: number | null
  let preferences: NotificationPreferences

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    shown = []
    given = new Set()
    events = []
    looking = false
    seen = null
    preferences = DEFAULT_NOTIFICATION_PREFERENCES
    const center = {
      get preferences() {
        return preferences
      },
      onPreferences: () => () => undefined,
      notify: (input: NotificationInput) => {
        shown.push(input)
        return true
      },
      withdraw: vi.fn(),
      withdrawWhere: vi.fn(),
      giveOnce: async (key: string) => {
        const first = !given.has(key)
        given.add(key)
        return first
      }
    } as unknown as NotificationCenter
    notifications = new CalendarNotifications({
      center,
      events: async () => events,
      preparation: async () => 'Porta il preventivo rev2.',
      segretarioLooking: () => looking,
      segretarioSeen: async () => seen,
      openExternal: () => undefined
    })
  })

  afterEach(() => {
    notifications.stop()
    vi.useRealTimers()
  })

  it('reminds at its time, once, with the preparation', async () => {
    events = [event({ reminders: [10], meetLink: 'https://meet.example.it/abc' })]
    notifications.start()
    await vi.advanceTimersByTimeAsync(49 * MINUTE)
    expect(shown).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      kind: 'calendar.reminder',
      title: 'Sopralluogo in cantiere',
      subtitle: 'In 10 minutes · 10:00',
      body: 'Porta il preventivo rev2. · Via Roma 3',
      target: { kind: 'event', eventKey: 'e1' }
    })
    expect(shown[0].actions?.map((action) => action.label)).toEqual(['Join', 'In 5 minutes'])

    // Planned again — a sync, a wake —: not given a second time.
    notifications.woke()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(shown).toHaveLength(1)
  })

  it('gives late what came due while away, if the event is still to come — not one begun', async () => {
    events = [
      event({ key: 'late', reminders: [120] }),
      event({
        key: 'begun',
        startsAt: NOW - 5 * MINUTE,
        endsAt: NOW + 30 * MINUTE,
        reminders: [10]
      }),
      // Due as it starts, and the timer a moment late: still given.
      event({ key: 'starting', startsAt: NOW - 30_000, endsAt: NOW + 30 * MINUTE, reminders: [0] })
    ]
    notifications.start()
    await vi.advanceTimersByTimeAsync(MINUTE)

    expect(shown.map((input) => input.key)).toEqual([
      'calendar:reminder:late',
      'calendar:reminder:starting'
    ])
    // Too close to its start to be put off.
    expect(shown[1].actions).toEqual([])
  })

  it('reminds again five minutes later, when asked — in its turn with the others', async () => {
    events = [
      event({ key: 'first', reminders: [60] }),
      event({
        key: 'second',
        startsAt: NOW + 67 * MINUTE,
        endsAt: NOW + 90 * MINUTE,
        reminders: [60]
      })
    ]
    notifications.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(shown.map((input) => input.key)).toEqual(['calendar:reminder:first'])

    shown[0].actions?.find((action) => action.label === 'In 5 minutes')?.run()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(shown.map((input) => input.key)).toEqual([
      'calendar:reminder:first',
      'calendar:reminder:first'
    ])

    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(shown.at(-1)?.key).toBe('calendar:reminder:second')
  })

  it('tells a change by others, one by one, and several at once together', () => {
    const changed = (key: string): ChangeByOthers => ({
      kind: 'annullato' as const,
      event: {
        key,
        title: `Riunione ${key}`,
        startsAt: NOW + 60 * MINUTE,
        endsAt: NOW + 90 * MINUTE,
        organizer: 'luca@brenta.it',
        location: null,
        myResponse: 'accepted'
      } as never,
      before: null,
      by: 'luca@brenta.it',
      instances: 1
    })

    notifications.changedByOthers('Ufficio', [changed('a')], 1)
    // Gone: it opens on its day.
    expect(shown[0]).toMatchObject({
      title: 'Cancelled: Riunione a',
      kind: 'calendar.change',
      target: { kind: 'day' }
    })

    notifications.changedByOthers('Ufficio', [changed('b'), changed('c'), changed('d')], 2)
    expect(shown[1]).toMatchObject({ title: '3 events changed', subtitle: 'Ufficio' })

    // A series cancelled whole: one change, that says so.
    notifications.changedByOthers('Ufficio', [{ ...changed('e'), instances: 52 }], 3)
    expect(shown[2].body).toContain('and 51 more times in the series')
  })

  it('lets the Segretario look first, and tells as it is what it has not looked at in ten minutes', async () => {
    looking = true
    const change = (key: string): ChangeByOthers => ({
      kind: 'nuovo',
      event: {
        key,
        title: `Sopralluogo ${key}`,
        startsAt: NOW + 120 * MINUTE,
        endsAt: NOW + 180 * MINUTE,
        location: null,
        myResponse: null
      } as never,
      before: null,
      by: 'segreteria@brenta.it',
      instances: 1
    })

    // Looked at in time: what it said stands, here nothing.
    notifications.changedByOthers('Studio', [change('a')], 7)
    seen = 7
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(shown).toHaveLength(0)

    // Not looked at — the look failed, or never came —: told as it is, by whom.
    notifications.changedByOthers('Studio', [change('b')], 9)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: 'New event: Sopralluogo b' })
    expect(shown[0].body).toContain('From segreteria@brenta.it')

    // What the Segretario says takes the place of what was told as it is.
    notifications.segretarioAlert(
      { ...change('b').event, title: 'Sopralluogo b' },
      'Spostato alle 8: parti prima.'
    )
    expect(shown[1].key).toBe(shown[0].key)

    // The user wanting every novelty as it is: told at once, as without AI, and its word unsaid.
    preferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      calendar: { ...DEFAULT_NOTIFICATION_PREFERENCES.calendar, onlyFlagged: false }
    }
    notifications.changedByOthers('Studio', [change('c')], 11)
    expect(shown[2]).toMatchObject({ title: 'New event: Sopralluogo c' })
    expect(
      notifications.segretarioAlert({ ...change('c').event, title: 'Sopralluogo c' }, 'Conta.')
    ).toBe(false)
    expect(shown).toHaveLength(3)
  })
})

describe('the reminders each calendar keeps', () => {
  it('are read from an iCalendar event’s alarms — not one that sends mail', async () => {
    const { default: ICAL } = await import('ical.js')
    const { remindersOf: alarmsOf } = await import('./icalendar')
    const component = new ICAL.Component(
      ICAL.parse(
        [
          'BEGIN:VEVENT',
          'UID:x',
          'DTSTART:20261109T100000Z',
          'DTEND:20261109T110000Z',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER:-PT15M',
          'END:VALARM',
          'BEGIN:VALARM',
          'ACTION:AUDIO',
          'TRIGGER;RELATED=END:-PT90M',
          'END:VALARM',
          'BEGIN:VALARM',
          'ACTION:EMAIL',
          'TRIGGER:-P1D',
          'END:VALARM',
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'TRIGGER;VALUE=DATE-TIME:20261109T080000Z',
          'END:VALARM',
          'END:VEVENT'
        ].join('\r\n')
      )
    )
    const startsAt = Date.UTC(2026, 10, 9, 10)

    expect(alarmsOf(component, startsAt, startsAt + 60 * MINUTE)).toEqual([15, 30, 120])
    expect(
      alarmsOf(
        new ICAL.Component(ICAL.parse('BEGIN:VEVENT\r\nUID:y\r\nEND:VEVENT')),
        startsAt,
        startsAt
      )
    ).toBeNull()
  })

  it('are Google’s own, or its calendar’s — those on the screen, not by email', async () => {
    const { googleRemindersOf } = await import('./google-calendar')

    expect(
      googleRemindersOf(
        {
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 30 },
              { method: 'email', minutes: 1440 }
            ]
          }
        },
        [10]
      )
    ).toEqual([30])
    expect(googleRemindersOf({ reminders: { useDefault: true } }, [10])).toEqual([10])
    expect(googleRemindersOf({}, undefined)).toBeUndefined()
    expect(googleRemindersOf({ reminders: { useDefault: false } }, [10])).toEqual([])
    // An all-day event: the calendar's defaults are for events with an hour.
    expect(
      googleRemindersOf({ start: { date: '2026-11-09' }, reminders: { useDefault: true } }, [10])
    ).toBeNull()
  })
})
