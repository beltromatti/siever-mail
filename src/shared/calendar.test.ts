import { describe, expect, it } from 'vitest'

import { eventMoveLimit, type CalendarAttendee } from './calendar'

describe('eventMoveLimit', () => {
  const guest = (email: string, self = false): CalendarAttendee => ({
    email,
    name: null,
    response: 'accepted',
    self,
    organizer: false
  })
  const event = {
    connectionId: 'google',
    calendarId: 'primary',
    attendees: [guest('mattia@brenta.it', true)],
    managedBy: null,
    organizedByUser: true
  }
  const google = { writable: true, provider: 'google' as const }
  const to = (
    connectionId: string,
    calendarId: string,
    writable = true
  ): Parameters<typeof eventMoveLimit>[2] => ({ connectionId, calendarId, writable })

  it('lets an event of the user’s, without guests, go to any calendar they write in', () => {
    expect(eventMoveLimit(event, google, to('google', 'vita'))).toBeNull()
    expect(eventMoveLimit(event, google, to('icloud', 'casa'))).toBeNull()
    expect(
      eventMoveLimit(event, { writable: true, provider: 'microsoft' }, to('microsoft', 'altro'))
    ).toBeNull()
  })

  it('says why not: there already, a calendar not written in, another service’s, an invitation', () => {
    expect(eventMoveLimit(event, google, to('google', 'primary'))).toBe('same')
    expect(eventMoveLimit(event, google, to('google', 'festivi', false))).toBe('readonly')
    expect(eventMoveLimit(event, { ...google, writable: false }, to('google', 'vita'))).toBe(
      'readonly'
    )
    expect(eventMoveLimit({ ...event, managedBy: 'gmail' }, google, to('google', 'vita'))).toBe(
      'managed'
    )
    expect(eventMoveLimit({ ...event, organizedByUser: false }, google, to('google', 'vita'))).toBe(
      'invitation'
    )
  })

  it('moves a meeting with guests only where nobody would be invited again: the same account, not Microsoft', () => {
    const meeting = { ...event, attendees: [...event.attendees, guest('rossi@acme-srl.it')] }

    expect(eventMoveLimit(meeting, google, to('google', 'vita'))).toBeNull()
    expect(eventMoveLimit(meeting, google, to('icloud', 'casa'))).toBe('guests')
    expect(
      eventMoveLimit(
        { ...meeting, connectionId: 'microsoft' },
        { writable: true, provider: 'microsoft' },
        to('microsoft', 'altro')
      )
    ).toBe('guests')
  })
})
