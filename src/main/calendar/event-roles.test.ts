import { describe, expect, it } from 'vitest'

import type { CalendarAttendee } from '@shared/calendar'

import {
  invitationEvent,
  invitedAddresses,
  organizedByUser,
  ownAddresses,
  type InvitationCandidate
} from './event-roles'

const user = 'mattia@brenta.it'
const own = new Set([user])
/** The invitation came to the user's account, by its address. */
const addresses = { own, invited: own }
const HOUR = 60 * 60 * 1000

const person = (email: string, extra: Partial<CalendarAttendee> = {}): CalendarAttendee => ({
  email,
  name: null,
  response: 'needsAction',
  self: email === user,
  organizer: false,
  ...extra
})

/** An instance of the weekly meeting Rossi invites the user to, in a calendar. */
function candidate(
  calendarId: string,
  startsAt: number,
  extra: Partial<InvitationCandidate> & {
    myResponse?: InvitationCandidate['event']['myResponse']
  } = {}
): InvitationCandidate & { id: string } {
  const { myResponse = 'needsAction', ...rest } = extra
  return {
    id: `${calendarId}@${startsAt}`,
    event: {
      connectionId: 'google',
      calendarId,
      organizer: 'rossi@cliente.it',
      attendees: [person('rossi@cliente.it', { organizer: true }), person(user)],
      myResponse,
      startsAt,
      endsAt: startsAt + HOUR
    },
    answerable: true,
    primary: calendarId === 'primary',
    sameAccount: false,
    ...rest
  }
}

const NOW = Date.UTC(2026, 10, 5, 12)
const week = (n: number): number => Date.UTC(2026, 10, 2, 8) + n * 7 * 24 * HOUR

describe('invitationEvent', () => {
  const series = [0, 1, 2, 3].map((n) => candidate('primary', week(n)))

  it('finds, of a whole series, its next instance', () => {
    expect(invitationEvent(series, null, addresses, NOW)?.id).toBe(`primary@${week(1)}`)
  })

  it('finds the instance an invitation names — where it is now, or where the series put it', () => {
    // The third Monday moved to Tuesday afternoon: in the calendar already, or not yet.
    const moved = { start: week(2) + 30 * HOUR, original: week(2) }
    const updated = series.map((entry) =>
      entry.event.startsAt === week(2)
        ? { ...entry, id: 'moved', event: { ...entry.event, startsAt: moved.start } }
        : entry
    )

    expect(invitationEvent(updated, moved, addresses, NOW)?.id).toBe('moved')
    expect(invitationEvent(series, moved, addresses, NOW)?.id).toBe(`primary@${week(2)}`)
    expect(invitationEvent(series, { start: 1, original: 2 }, addresses, NOW)).toBeNull()
  })

  it('answers where the user is invited and the calendar tells the organizer: the account’s own first, its main calendar first', () => {
    const elsewhere = candidate('lavoro', week(1), { sameAccount: false })
    const ofAccount = candidate('primary', week(1), { sameAccount: true })
    const unscheduled = candidate('caldav', week(1), { answerable: false, sameAccount: true })

    expect(invitationEvent([elsewhere, unscheduled, ofAccount], null, addresses, NOW)?.id).toBe(
      ofAccount.id
    )
    expect(invitationEvent([unscheduled], null, addresses, NOW)).toBeNull()
  })

  it('answers only as the one the invitation came to: never from the user’s other account', () => {
    const personal = 'mattia.rossi@gmail.com'
    const bothInvited = [
      person('rossi@cliente.it', { organizer: true }),
      person(user, { self: false }),
      person(personal, { self: true })
    ]
    // The copy in the personal Google calendar; the work one is not synced yet, or is on a
    // CalDAV server that came with no mail account.
    const inPersonal = candidate('primary', week(1), {
      event: { ...series[1].event, connectionId: 'personale', attendees: bothInvited }
    })
    const inWork = candidate('lavoro', week(1), {
      event: { ...series[1].event, connectionId: 'caldav-lavoro' }
    })
    const fromWork = { own: new Set([user, personal]), invited: new Set([user]) }

    expect(invitationEvent([inPersonal], null, fromWork, NOW)).toBeNull()
    expect(invitationEvent([inPersonal, inWork], null, fromWork, NOW)?.id).toBe(inWork.id)
    expect(
      invitationEvent([inPersonal], null, { own: fromWork.own, invited: new Set([personal]) }, NOW)
        ?.id
    ).toBe(inPersonal.id)
  })

  it('answers in the calendar of the account it came to even where the user is not named there', () => {
    // Invited through a list: Outlook keeps the mailbox's own answer all the same.
    const throughList = candidate('primary', week(1), {
      sameAccount: true,
      event: {
        ...series[1].event,
        attendees: [person('rossi@cliente.it', { organizer: true }), person('tecnici@brenta.it')]
      }
    })

    expect(invitationEvent([throughList], null, addresses, NOW)?.id).toBe(throughList.id)
    expect(
      invitationEvent([{ ...throughList, sameAccount: false }], null, addresses, NOW)
    ).toBeNull()
  })

  it('shows the user’s own copy of an event they organise, and none they cannot answer', () => {
    const organised = candidate('primary', week(1), {
      myResponse: null,
      event: {
        connectionId: 'google',
        calendarId: 'primary',
        organizer: user,
        attendees: [person(user, { organizer: true }), person('rossi@cliente.it')],
        myResponse: null,
        startsAt: week(1),
        endsAt: week(1) + HOUR
      }
    })
    // Invited through a list: the user is not named, there is no answer to give here.
    const throughList = candidate('primary', week(1), {
      myResponse: null,
      event: {
        ...series[1].event,
        attendees: [person('rossi@cliente.it', { organizer: true }), person('tecnici@brenta.it')],
        myResponse: null
      }
    })

    expect(invitationEvent([organised], null, addresses, NOW)?.id).toBe(organised.id)
    expect(invitationEvent([throughList], null, addresses, NOW)).toBeNull()
  })
})

describe('organizedByUser', () => {
  it('lets the user change their own events, and those with nobody to tell; not an invitation', () => {
    expect(
      organizedByUser(
        { organizer: user, attendees: [person('rossi@cliente.it')], myResponse: null },
        own
      )
    ).toBe(true)
    expect(
      organizedByUser({ organizer: 'luca@brenta.it', attendees: [], myResponse: null }, own)
    ).toBe(true)
    expect(
      organizedByUser(
        {
          organizer: 'rossi@cliente.it',
          attendees: [person('rossi@cliente.it', { organizer: true }), person(user)],
          myResponse: 'accepted'
        },
        own
      )
    ).toBe(false)
    expect(
      organizedByUser(
        {
          organizer: 'rossi@cliente.it',
          attendees: [person('rossi@cliente.it', { organizer: true }), person('tecnici@brenta.it')],
          myResponse: null
        },
        own
      )
    ).toBe(false)
  })
})

describe('ownAddresses', () => {
  it('knows the user by their mail, their Google and Microsoft accounts and what their servers say; not by a name given to a connection', () => {
    expect(
      [
        ...ownAddresses(
          ['Mattia@Brenta.it'],
          [
            { provider: 'google', label: 'mattia.rossi@gmail.com', username: null },
            { provider: 'microsoft', label: 'mrossi@studio.onmicrosoft.com', username: null },
            { provider: 'caldav', label: 'luca@brenta.it', username: 'mattia@icloud.com' },
            { provider: 'caldav', label: 'Nextcloud', username: 'mattia' },
            { provider: 'ics', label: 'luca@brenta.it', username: null }
          ],
          [['mattia@me.com', 'mattia@icloud.com']]
        )
      ].sort()
    ).toEqual([
      'mattia.rossi@gmail.com',
      'mattia@brenta.it',
      'mattia@icloud.com',
      'mattia@me.com',
      'mrossi@studio.onmicrosoft.com'
    ])
  })
})

describe('invitedAddresses', () => {
  it('is the account’s address, and the others a server knows the same person by', () => {
    const servers = [
      ['mattia@icloud.com', 'mattia@me.com'],
      ['mattia@brenta.it', 'm.rossi@brenta.it']
    ]

    expect([...invitedAddresses('Mattia@Brenta.it', servers)]).toEqual([
      'mattia@brenta.it',
      'm.rossi@brenta.it'
    ])
    expect([...invitedAddresses('mattia@gmail.com', servers)]).toEqual(['mattia@gmail.com'])
    expect([...invitedAddresses(null, servers)]).toEqual([])
  })
})
