import { describe, expect, it } from 'vitest'

import { calendarKey, seriesKey, type CalendarAttendee, type CalendarRole } from '@shared/calendar'

import {
  eventIsYours,
  handledBy,
  inOthersHands,
  roleOf,
  yoursAmong,
  type Ownership,
  type SegretarioOwnership,
  type Whose
} from './ownership'

const ME = 'anna@brenta.it'
const AT = Date.UTC(2026, 10, 12, 9)

function ownership(
  calendars: Record<string, { role: CalendarRole; primary?: boolean; writable?: boolean }>,
  segretario: SegretarioOwnership | null = null
): Ownership {
  return {
    calendars: new Map(
      Object.entries(calendars).map(([id, calendar]) => [
        calendarKey('c1', id),
        {
          role: calendar.role,
          primary: calendar.primary ?? false,
          writable: calendar.writable ?? true
        }
      ])
    ),
    own: new Set([ME]),
    segretario
  }
}

function event(calendarId: string, key: string, overrides: Partial<Whose> = {}): Whose {
  return {
    key,
    connectionId: 'c1',
    calendarId,
    seriesId: null,
    iCalUid: null,
    organizer: null,
    creator: null,
    attendees: [],
    myResponse: null,
    startsAt: AT,
    ...overrides
  }
}

const guest = (email: string, overrides: Partial<CalendarAttendee> = {}): CalendarAttendee => ({
  email,
  name: null,
  response: 'accepted',
  self: email === ME,
  organizer: false,
  ...overrides
})

describe('whose an event is (§7.4)', () => {
  it('each with their own calendar: the user’s, and a meeting shown in a colleague’s too, once', () => {
    const known = ownership({
      mine: { role: 'tutti', primary: true },
      luca: { role: 'propri', writable: false }
    })
    const meeting = {
      iCalUid: 'riunione@brenta.it',
      organizer: 'luca@brenta.it',
      attendees: [guest('luca@brenta.it', { organizer: true }), guest(ME)]
    }
    const events = [
      event('mine', 'm1', { ...meeting, myResponse: 'accepted' }),
      event('luca', 'l1', meeting),
      event('luca', 'l2', { organizer: 'luca@brenta.it', creator: 'luca@brenta.it' })
    ]

    expect([...yoursAmong(events, known)]).toEqual(['m1'])
  })

  it('a calendar per person in one account: the user’s is theirs once said so', () => {
    const written = event('marco', 'e1', {
      organizer: 'studio@brenta.it',
      creator: 'paola@brenta.it'
    })

    expect(eventIsYours(written, ownership({ marco: { role: 'propri' } }))).toBe(false)
    expect(eventIsYours(written, ownership({ marco: { role: 'tutti' } }))).toBe(true)
  })

  it('a calendar common to all: what the user made, or the Segretario found theirs — the whole series', () => {
    const decided: SegretarioOwnership = {
      roles: new Map(),
      events: new Set(['found']),
      series: new Set([seriesKey('c1', 'studio', 'weekly')])
    }
    const known = ownership({ studio: { role: 'propri' } }, decided)
    const other = { organizer: 'studio@group.calendar.google.com' }

    expect(eventIsYours(event('studio', 'mine', { ...other, creator: ME }), known)).toBe(true)
    expect(
      eventIsYours(event('studio', 'theirs', { ...other, creator: 'luca@brenta.it' }), known)
    ).toBe(false)
    expect(
      eventIsYours(event('studio', 'found', { ...other, creator: 'paola@brenta.it' }), known)
    ).toBe(true)
    expect(
      eventIsYours(
        event('studio', 'instance', { ...other, creator: 'paola@brenta.it', seriesId: 'weekly' }),
        known
      )
    ).toBe(true)
    // Without the AI, what the Segretario found does not count.
    expect(
      eventIsYours(
        event('studio', 'found', { ...other, creator: 'paola@brenta.it' }),
        ownership({ studio: { role: 'propri' } })
      )
    ).toBe(false)
  })

  it('a subscription: none, nor what the Segretario found in it; in a calendar shared, nothing that says nothing of who', () => {
    const found: SegretarioOwnership = {
      roles: new Map(),
      events: new Set(['match']),
      series: new Set()
    }

    expect(
      eventIsYours(event('ics', 'match'), ownership({ ics: { role: 'propri', writable: false } }))
    ).toBe(false)
    expect(
      eventIsYours(event('ics', 'match'), ownership({ ics: { role: 'nessuno' } }, found))
    ).toBe(false)
    // «Only the user's» is what the calendar says: an event without guests, of nobody known, is not.
    expect(
      eventIsYours(event('famiglia', 'cena'), ownership({ famiglia: { role: 'propri' } }))
    ).toBe(false)
  })

  it('knows the user among the guests by an address of theirs, where the server does not mark them', () => {
    const known = ownership({ studio: { role: 'propri' } })
    const meeting = event('studio', 'r', {
      organizer: 'luca@brenta.it',
      attendees: [guest('luca@brenta.it', { organizer: true }), { ...guest(ME), self: false }]
    })

    expect(eventIsYours(meeting, known)).toBe(true)
    expect(handledBy(meeting, known.own)).toBe('luca@brenta.it')
  })

  it('never one the user declined, wherever it is', () => {
    const known = ownership({ mine: { role: 'tutti', primary: true }, luca: { role: 'propri' } })

    expect(eventIsYours(event('mine', 'a', { myResponse: 'declined' }), known)).toBe(false)
    expect(
      eventIsYours(
        event('luca', 'b', {
          organizer: 'luca@brenta.it',
          attendees: [guest(ME, { response: 'declined' })]
        }),
        known
      )
    ).toBe(false)
  })

  it('takes the user’s word over the Segretario’s, and that over the default', () => {
    const decided: SegretarioOwnership = {
      roles: new Map([
        [calendarKey('c1', 'marco'), { role: 'tutti', reason: 'È il calendario di Marco' }]
      ]),
      events: new Set(),
      series: new Set()
    }
    const row = {
      connectionId: 'c1',
      calendarId: 'marco',
      primary: false,
      writable: true,
      provider: 'google' as const
    }

    expect(roleOf({ ...row, role: null }, null)).toEqual({ role: 'propri', by: null, reason: null })
    expect(roleOf({ ...row, role: null }, decided)).toMatchObject({
      role: 'tutti',
      by: 'segretario'
    })
    expect(roleOf({ ...row, role: 'nessuno' }, decided)).toMatchObject({
      role: 'nessuno',
      by: 'utente'
    })
    expect(roleOf({ ...row, primary: true, role: null }, null).role).toBe('tutti')
    // Where events do not say who made them, every calendar the user writes in is theirs; a link is not.
    expect(roleOf({ ...row, provider: 'caldav', role: null }, null).role).toBe('tutti')
    expect(roleOf({ ...row, provider: 'caldav', writable: false, role: null }, null).role).toBe(
      'propri'
    )
    expect(roleOf({ ...row, provider: 'ics', writable: false, role: null }, null).role).toBe(
      'propri'
    )
  })
})

describe('who has an event in hand (§13.3)', () => {
  it('whoever invites the user, or whoever put it in their calendar — not the user, nor nobody known', () => {
    const own = new Set([ME])
    const invitation = event('mine', 'i', {
      organizer: 'luca@brenta.it',
      myResponse: 'needsAction'
    })
    const putThere = event('marco', 'p', { organizer: ME, creator: 'paola@brenta.it' })

    expect(inOthersHands(invitation, own)).toBe(true)
    expect(handledBy(invitation, own)).toBe('luca@brenta.it')
    expect(inOthersHands(event('mine', 'o', { organizer: ME, creator: ME }), own)).toBe(false)
    expect(inOthersHands(event('casa', 'n'), own)).toBe(false)
    expect(
      inOthersHands(
        event('studio', 's', {
          organizer: 'studio@group.calendar.google.com',
          creator: 'paola@brenta.it'
        }),
        own
      )
    ).toBe(true)
    // Put in the user's own calendar by the office, for them: news.
    expect(inOthersHands(putThere, own)).toBe(true)
    expect(handledBy(putThere, own)).toBe('paola@brenta.it')
  })
})
