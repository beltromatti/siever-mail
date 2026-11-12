import { describe, expect, it } from 'vitest'

import {
  calendarKey,
  type CalendarEvent,
  type CalendarListEntry,
  type CalendarProviderKind
} from '@shared/calendar'
import type { ContextMenuItem } from '@shared/context-menu'

import {
  calendarMenuItems,
  canReschedule,
  eventMenuChoice,
  eventMenuItems,
  moveMenuItems,
  type EventMenuContext
} from './calendar-menus'

const calendar = (
  connectionId: string,
  calendarId: string,
  name: string,
  provider: CalendarProviderKind,
  extra: Partial<CalendarListEntry> = {}
): CalendarListEntry => ({
  key: calendarKey(connectionId, calendarId),
  connectionId,
  connection: connectionId === 'g1' ? 'rossi@brenta.it' : 'rossi@acme-srl.it',
  name,
  primary: false,
  writable: true,
  color: null,
  hidden: false,
  provider,
  role: 'tutti',
  roleBy: null,
  roleReason: null,
  ...extra
})

const CALENDARS: CalendarListEntry[] = [
  calendar('g1', 'personale', 'Personale', 'google', { primary: true }),
  calendar('g1', 'lavoro', 'Lavoro', 'google'),
  calendar('g1', 'festivita', 'Festività', 'google', { writable: false }),
  calendar('m1', 'calendario', 'Calendario', 'microsoft', { primary: true })
]

const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: 'g1:personale:ev1',
  connectionId: 'g1',
  calendarId: 'personale',
  calendarName: 'Personale',
  eventId: 'ev1',
  iCalUid: 'ev1@google.com',
  seriesId: null,
  title: 'Sopralluogo Casa al mare',
  start: '2026-11-12T09:00:00.000Z',
  end: '2026-11-12T10:00:00.000Z',
  allDay: false,
  location: null,
  description: null,
  attendees: [],
  organizer: 'rossi@brenta.it',
  myResponse: null,
  meetLink: null,
  htmlLink: 'https://calendar.google.com/event?eid=ev1',
  origin: null,
  reminders: null,
  organizedByUser: true,
  recurrence: null,
  managedBy: null,
  ...extra
})

const CONTEXT: EventMenuContext = {
  calendars: CALENDARS,
  aiOn: false,
  whose: null,
  canWriteMail: true,
  canAsk: false,
  chords: { edit: 'KeyE', duplicate: 'Mod+KeyD', delete: 'Backspace' }
}

type Item = Extract<ContextMenuItem, { id: string }>

const items = (list: ContextMenuItem[]): Item[] =>
  list.filter((item): item is Item => !('type' in item))
const find = (list: ContextMenuItem[], id: string): Item | undefined =>
  items(list).find((item) => item.id === id)
const ids = (list: ContextMenuItem[]): string[] => items(list).map((item) => item.id)

const GUEST = {
  email: 'bianchi@brenta.it',
  name: 'Bianchi',
  response: 'accepted' as const,
  self: false,
  organizer: false
}
const ME = {
  email: 'rossi@brenta.it',
  name: null,
  response: 'accepted' as const,
  self: true,
  organizer: true
}

describe('an event’s right-click menu (vision §7.3)', () => {
  it('gives an event of the user’s every command, with the chords of the Calendario', () => {
    const menu = eventMenuItems(event(), CONTEXT)

    expect(ids(menu)).toEqual(['open', 'edit', 'duplicate', 'move', 'copy', 'provider', 'delete'])
    expect(find(menu, 'edit')).toMatchObject({ enabled: true, chord: 'KeyE' })
    expect(find(menu, 'duplicate')?.chord).toBe('Mod+KeyD')
    expect(find(menu, 'delete')).toMatchObject({
      label: 'Delete',
      enabled: true,
      chord: 'Backspace'
    })
    expect(find(menu, 'provider')?.label).toBe('Open in Google Calendar')
    expect(ids(find(menu, 'copy')!.submenu!)).toEqual(['copy:summary'])
  })

  it('answers an invitation, and neither changes nor moves nor deletes it', () => {
    const menu = eventMenuItems(
      event({
        organizedByUser: false,
        myResponse: 'tentative',
        attendees: [{ ...ME, organizer: false }]
      }),
      CONTEXT
    )
    const answers = find(menu, 'answer')!.submenu!

    expect(ids(answers)).toEqual(['respond:accepted', 'respond:tentative', 'respond:declined'])
    expect(items(answers).map((item) => item.checked)).toEqual([false, true, false])
    expect(find(menu, 'edit')?.enabled).toBe(false)
    expect(find(menu, 'delete')?.enabled).toBe(false)
    expect(find(menu, 'move')!.submenu).toEqual([
      {
        id: 'move-blocked',
        label: 'Someone else organizes it: an invitation is answered, not moved.',
        enabled: false
      }
    ])
  })

  it('lets an event Gmail keeps change its reminders, and says why it does not move', () => {
    const menu = eventMenuItems(event({ managedBy: 'gmail' }), CONTEXT)

    expect(find(menu, 'edit')?.enabled).toBe(true)
    expect(find(menu, 'delete')?.enabled).toBe(true)
    expect(find(menu, 'move')!.submenu).toEqual([
      { id: 'move-blocked', label: 'Gmail keeps it: Google won’t let it move.', enabled: false }
    ])
    expect(canReschedule(event({ managedBy: 'gmail' }), CALENDARS)).toBe(false)
    expect(canReschedule(event(), CALENDARS)).toBe(true)
  })

  it('asks, deleting an instance, whether alone or with its series', () => {
    const menu = eventMenuItems(
      event({ seriesId: 'lezioni', recurrence: { frequency: 'weekly', interval: 1 } }),
      CONTEXT
    )

    expect(find(menu, 'delete')?.label).toBe('Delete…')
  })

  it('offers the call, the guests, what to copy, and the AI’s part only where they apply', () => {
    const withAll = event({
      meetLink: 'https://meet.google.com/abc-defg-hij',
      location: 'Via Roma 1, Brenta',
      attendees: [ME, GUEST]
    })

    expect(ids(eventMenuItems(withAll, CONTEXT))).toEqual([
      'open',
      'edit',
      'duplicate',
      'move',
      'join',
      'write',
      'copy',
      'provider',
      'delete'
    ])
    expect(ids(find(eventMenuItems(withAll, CONTEXT), 'copy')!.submenu!)).toEqual([
      'copy:summary',
      'copy:call',
      'copy:place'
    ])
    // No mailbox, no message to write.
    expect(ids(eventMenuItems(withAll, { ...CONTEXT, canWriteMail: false }))).not.toContain('write')

    const ai = { ...CONTEXT, aiOn: true, canAsk: true }
    expect(
      ids(
        eventMenuItems(event(), { ...ai, whose: { yours: true, by: 'segretario', reason: null } })
      )
    ).toEqual(expect.arrayContaining(['not-mine', 'ask']))
    expect(
      ids(eventMenuItems(event(), { ...ai, whose: { yours: false, by: null, reason: null } }))
    ).toContain('mine')
    // Where the calendar says whose it is, there is nothing to say.
    expect(ids(eventMenuItems(event(), ai)).filter((id) => /mine/.test(id))).toEqual([])
  })

  it('reads back what was chosen', () => {
    expect(eventMenuChoice(`move:${calendarKey('g1', 'lavoro')}`)).toEqual({
      kind: 'move',
      calendarKey: calendarKey('g1', 'lavoro')
    })
    expect(eventMenuChoice('respond:declined')).toEqual({ kind: 'respond', response: 'declined' })
    expect(eventMenuChoice('respond:needsAction')).toBeNull()
    expect(eventMenuChoice('copy:place')).toEqual({ kind: 'copy', what: 'place' })
    expect(eventMenuChoice('delete')).toEqual({ kind: 'delete' })
    expect(eventMenuChoice('move-blocked')).toBeNull()
  })
})

describe('the calendars an event can move to (vision §7.5)', () => {
  it('lists those written in, by connection, the one it is in marked', () => {
    const menu = moveMenuItems(event(), CALENDARS)

    expect(menu.map((item) => ('label' in item ? item.label : '—'))).toEqual([
      'rossi@brenta.it',
      'rossi@acme-srl.it'
    ])
    expect(find(menu, 'connection:g1')!.submenu).toEqual([
      {
        id: `move:${calendarKey('g1', 'personale')}`,
        label: 'Personale',
        enabled: false,
        checked: true
      },
      { id: `move:${calendarKey('g1', 'lavoro')}`, label: 'Lavoro', enabled: true }
    ])
    expect(find(menu, 'connection:m1')!.submenu).toEqual([
      { id: `move:${calendarKey('m1', 'calendario')}`, label: 'Calendario', enabled: true }
    ])
  })

  it('keeps one with guests in its account, and says why not elsewhere', () => {
    const menu = moveMenuItems(event({ attendees: [ME, GUEST] }), CALENDARS)

    expect(
      find(find(menu, 'connection:g1')!.submenu!, `move:${calendarKey('g1', 'lavoro')}`)?.enabled
    ).toBe(true)
    expect(find(menu, 'connection:m1')!.submenu).toEqual([
      { id: `move:${calendarKey('m1', 'calendario')}`, label: 'Calendario', enabled: false },
      { type: 'separator' },
      {
        id: 'move-guests',
        label: 'Moving it would cancel the invitation for the guests and invite them again.',
        enabled: false
      }
    ])
  })

  it('lists one connection’s calendars flat, hidden ones aside', () => {
    const one = CALENDARS.filter((entry) => entry.connectionId === 'g1')

    expect(ids(moveMenuItems(event(), one))).toEqual([
      `move:${calendarKey('g1', 'personale')}`,
      `move:${calendarKey('g1', 'lavoro')}`
    ])
    expect(
      ids(
        moveMenuItems(
          event(),
          one.map((entry) => (entry.name === 'Lavoro' ? { ...entry, hidden: true } : entry))
        )
      )
    ).toEqual([`move:${calendarKey('g1', 'personale')}`])
  })
})

describe('a calendar’s menu in the sidebar', () => {
  it('chooses whose its events are, as Settings does, and gives the choice back', () => {
    const lavoro = { ...CALENDARS[1], role: 'propri' as const, roleBy: 'utente' as const }
    const menu = calendarMenuItems(lavoro, CALENDARS, true)
    const roles = find(menu, 'role')!.submenu!

    expect(items(roles).map((item) => [item.id, item.checked])).toEqual([
      ['role:tutti', false],
      ['role:propri', true],
      ['role:nessuno', false],
      ['role:default', undefined]
    ])
    expect(find(roles, 'role:default')?.label).toBe('Let the Segretario decide')
    expect(
      ids(find(calendarMenuItems(CALENDARS[0], CALENDARS, true), 'role')!.submenu!)
    ).not.toContain('role:default')
  })

  it('shows only it, all, or hides it; a new event only where one can be written', () => {
    const menu = calendarMenuItems(CALENDARS[2], CALENDARS, false)

    expect(find(menu, 'show-only')?.enabled).toBe(true)
    expect(find(menu, 'show-all')?.enabled).toBe(false)
    expect(find(menu, 'toggle')?.label).toBe('Hide')
    expect(find(menu, 'new')?.enabled).toBe(false)
    expect(ids(menu)).toEqual(expect.arrayContaining(['sync', 'settings']))
  })
})
