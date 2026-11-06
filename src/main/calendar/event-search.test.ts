import { describe, expect, it } from 'vitest'

import { calendarSearchWords } from '@shared/calendar'

import { eventSearchText, findEvents, type IndexedEvent } from './event-search'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 10, 6, 12)

const WORK = 'conn\u0000lavoro'
const HOME = 'conn\u0000casa'
const NAMES = new Map([
  [WORK, 'Lavoro'],
  [HOME, 'Casa e famiglia']
])

function indexed(
  key: string,
  startsAt: number,
  fields: {
    title?: string
    location?: string | null
    description?: string | null
    attendees?: Array<{ name: string | null; email: string }>
    organizer?: string | null
    calendarKey?: string
    hours?: number
  } = {}
): IndexedEvent {
  const title = fields.title ?? key

  return {
    key,
    calendarKey: fields.calendarKey ?? WORK,
    startsAt,
    endsAt: startsAt + (fields.hours ?? 1) * HOUR,
    title,
    text: eventSearchText({
      title,
      location: fields.location ?? null,
      description: fields.description ?? null,
      attendees: fields.attendees ?? [],
      organizer: fields.organizer ?? null
    })
  }
}

function keysOf(found: ReturnType<typeof findEvents>): { upcoming: string[]; past: string[] } {
  return {
    upcoming: found.upcoming.map((event) => event.key),
    past: found.past.map((event) => event.key)
  }
}

function search(
  index: IndexedEvent[],
  text: string,
  options: { from?: number; to?: number; calendarKeys?: string[]; limit?: number } = {}
): ReturnType<typeof findEvents> {
  return findEvents(
    index,
    NAMES,
    {
      words: calendarSearchWords(text),
      from: options.from,
      to: options.to,
      calendarKeys: options.calendarKeys ? new Set(options.calendarKeys) : undefined,
      limit: options.limit ?? 50
    },
    NOW
  )
}

describe('calendarSearchWords', () => {
  it('folds case and accents, splits on space, drops quotes and repeats', () => {
    expect(calendarSearchWords('  Città  "Sopralluogo Copparo" città ')).toEqual([
      'citta',
      'sopralluogo',
      'copparo'
    ])
    expect(calendarSearchWords(' " ')).toEqual([])
  })
})

describe('eventSearchText', () => {
  it('reads the title, place, description and people, folded, not the JSON they are kept as', () => {
    const text = eventSearchText({
      title: 'Riunione ÉQUIPE',
      location: 'Città di Ferrara',
      description: 'Ordine del giorno',
      attendees: [{ name: 'Mario Rossi', email: 'm.rossi@idro.it' }],
      organizer: 'capo@studio.it'
    })

    expect(text).toContain('riunione equipe')
    expect(text).toContain('citta di ferrara')
    expect(text).toContain('ordine del giorno')
    expect(text).toContain('mario rossi m.rossi@idro.it')
    expect(text).toContain('capo@studio.it')
    expect(text).not.toContain('"email"')
  })
})

describe('findEvents', () => {
  const index = [
    indexed('sopralluogo-futuro', NOW + 6 * DAY, {
      title: 'Sopralluogo cantiere',
      location: 'Via Roma 3, Copparo'
    }),
    indexed('sopralluogo-passato', NOW - 20 * DAY, {
      title: 'Sopralluogo',
      description: 'Rilievi a Copparo con il geometra'
    }),
    indexed('rossi', NOW + 2 * DAY, {
      title: 'Preventivo',
      attendees: [{ name: 'Mario Rossi', email: 'mario@idro.it' }]
    }),
    indexed('cena', NOW + 1 * DAY, { title: 'Cena', calendarKey: HOME })
  ]

  it('wants every word, in any field, case and accents aside, a piece of a word enough', () => {
    expect(keysOf(search(index, 'SOPRALLUOGO coppar'))).toEqual({
      upcoming: ['sopralluogo-futuro'],
      past: ['sopralluogo-passato']
    })
    expect(keysOf(search(index, 'sopralluogo geometra'))).toEqual({
      upcoming: [],
      past: ['sopralluogo-passato']
    })
    expect(keysOf(search(index, 'rossi'))).toEqual({ upcoming: ['rossi'], past: [] })
    expect(keysOf(search(index, 'idro.it preventivo'))).toEqual({ upcoming: ['rossi'], past: [] })
    expect(search(index, 'rossi copparo').upcoming).toEqual([])
  })

  it("finds a word in the calendar's name as in the event's own words", () => {
    expect(keysOf(search(index, 'famiglia'))).toEqual({ upcoming: ['cena'], past: [] })
    expect(keysOf(search(index, 'cena casa'))).toEqual({ upcoming: ['cena'], past: [] })
    expect(search(index, 'lavoro cena').upcoming).toEqual([])
  })

  it('finds nothing without words', () => {
    expect(search(index, '  ')).toEqual({ upcoming: [], past: [], more: 0 })
  })

  it('lists the one under way and the soonest first, then the latest past', () => {
    const meetings = [
      indexed('fra-una-settimana', NOW + 7 * DAY, { title: 'Riunione' }),
      indexed('ieri', NOW - DAY, { title: 'Riunione' }),
      indexed('in-corso', NOW - HOUR / 2, { title: 'Riunione' }),
      indexed('domani', NOW + DAY, { title: 'Riunione' }),
      indexed('un-mese-fa', NOW - 30 * DAY, { title: 'Riunione' }),
      indexed('appena-finita', NOW - 2 * HOUR, { title: 'Riunione' })
    ]

    expect(keysOf(search(meetings, 'riunione'))).toEqual({
      upcoming: ['in-corso', 'domani', 'fra-una-settimana'],
      past: ['appena-finita', 'ieri', 'un-mese-fa']
    })
  })

  it('keeps those nearest to now, on either side, past the limit', () => {
    // A weekly meeting: a year of times to come does not push out the last one.
    const weekly = Array.from({ length: 60 }, (_, week) =>
      indexed(`settimana-${week - 8}`, NOW + (week - 8) * 7 * DAY + DAY, { title: 'Punto Rossi' })
    )
    const found = search(weekly, 'rossi', { limit: 5 })

    expect(keysOf(found)).toEqual({
      upcoming: ['settimana-0', 'settimana-1', 'settimana-2'],
      past: ['settimana--1', 'settimana--2']
    })
    expect(found.more).toBe(55)
  })

  it('keeps to the period and the calendars asked', () => {
    expect(keysOf(search(index, 'sopralluogo', { from: NOW - 30 * DAY, to: NOW })).past).toEqual([
      'sopralluogo-passato'
    ])
    expect(keysOf(search(index, 'sopralluogo', { from: NOW })).upcoming).toEqual([
      'sopralluogo-futuro'
    ])
    // An event touching the period's edge from inside is in it; one ending as it starts is not.
    const edge = [indexed('a-cavallo', NOW - HOUR / 2, { title: 'Turno', hours: 1 })]
    expect(search(edge, 'turno', { from: NOW }).upcoming).toHaveLength(1)
    expect(search(edge, 'turno', { from: NOW + HOUR / 2 }).upcoming).toHaveLength(0)
    expect(search(index, 'cena', { calendarKeys: [WORK] }).upcoming).toEqual([])
    expect(keysOf(search(index, 'cena', { calendarKeys: [HOME] })).upcoming).toEqual(['cena'])
  })
})
