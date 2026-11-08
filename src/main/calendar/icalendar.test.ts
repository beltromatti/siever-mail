import { describe, expect, it } from 'vitest'

import {
  calendarNameOf,
  canonicalUid,
  changeEventResource,
  invitationParties,
  invitationReply,
  newEventResource,
  occurrenceIn,
  occurrencesOf,
  removeOccurrence,
  withResponse
} from './icalendar'

const ROME = `BEGIN:VTIMEZONE
TZID:Europe/Rome
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//IT
X-WR-CALNAME:Studio
${ROME}
BEGIN:VEVENT
UID:sopralluogo@test
DTSTAMP:20261101T000000Z
DTSTART;TZID=Europe/Rome:20261105T083000
DTEND;TZID=Europe/Rome:20261105T100000
SUMMARY:Sopralluogo magazzino
LOCATION:Poggio Renatico
ORGANIZER;CN=Davide:mailto:davide@studio.it
ATTENDEE;CN=Mattia;PARTSTAT=TENTATIVE:mailto:Mattia@Studio.it
ATTENDEE;CN=Davide;PARTSTAT=ACCEPTED:mailto:davide@studio.it
DESCRIPTION:Call: https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:santi@test
DTSTAMP:20261101T000000Z
DTSTART;VALUE=DATE:20261101
SUMMARY:Tutti i Santi
END:VEVENT
BEGIN:VEVENT
UID:riunione@test
DTSTAMP:20261101T000000Z
DTSTART;TZID=Europe/Rome:20261019T090000
DTEND;TZID=Europe/Rome:20261019T093000
RRULE:FREQ=WEEKLY;COUNT=6
EXDATE;TZID=Europe/Rome:20261102T090000
SUMMARY:Riunione del lunedì
END:VEVENT
BEGIN:VEVENT
UID:riunione@test
DTSTAMP:20261101T000000Z
RECURRENCE-ID;TZID=Europe/Rome:20261109T090000
DTSTART;TZID=Europe/Rome:20261110T150000
DTEND;TZID=Europe/Rome:20261110T153000
SUMMARY:Riunione spostata
END:VEVENT
BEGIN:VEVENT
UID:annullato@test
DTSTAMP:20261101T000000Z
DTSTART:20261106T100000Z
DTEND:20261106T110000Z
STATUS:CANCELLED
SUMMARY:Annullato
END:VEVENT
END:VCALENDAR`

const range = { from: Date.UTC(2026, 9, 26), to: Date.UTC(2026, 10, 30) }

describe('occurrencesOf', () => {
  const found = occurrencesOf(FEED, range, ['mattia@studio.it'])
  const byTitle = (title: string): typeof found =>
    found.filter((occurrence) => occurrence.title === title)

  it('reads a timed event in its time zone, with the user’s own answer and the call', () => {
    const [visit] = byTitle('Sopralluogo magazzino')

    expect(visit.start).toBe('2026-11-05T07:30:00.000Z')
    expect(visit.end).toBe('2026-11-05T09:00:00.000Z')
    expect(visit.allDay).toBe(false)
    expect(visit.myResponse).toBe('tentative')
    expect(visit.organizer).toBe('davide@studio.it')
    expect(visit.attendees.find((attendee) => attendee.self)?.name).toBe('Mattia')
    expect(visit.meetLink).toBe('https://meet.google.com/abc-defg-hij')
    expect(visit.recurrenceId).toBeNull()
  })

  it('reads an all-day event as its day, its end the day after', () => {
    const [saints] = byTitle('Tutti i Santi')

    expect([saints.start, saints.end, saints.allDay]).toEqual(['2026-11-01', '2026-11-02', true])
  })

  it('expands a series in the window, without the day taken out, with the instance moved', () => {
    expect(byTitle('Riunione del lunedì').map((occurrence) => occurrence.start)).toEqual([
      '2026-10-26T08:00:00.000Z',
      '2026-11-16T08:00:00.000Z',
      '2026-11-23T08:00:00.000Z'
    ])
    const [moved] = byTitle('Riunione spostata')
    expect(moved.start).toBe('2026-11-10T14:00:00.000Z')
    expect(moved.recurrenceId).toBe('2026-11-09T09:00:00')
  })

  it('says a cancelled event is cancelled, and finds the calendar’s name', () => {
    expect(byTitle('Annullato')[0].cancelled).toBe(true)
    expect(calendarNameOf(FEED)).toBe('Studio')
  })

  it('keeps each series to its own exceptions, and brings in an instance moved from after the window', () => {
    const text = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
DTSTAMP:20261101T000000Z
DTSTART:20261102T080000Z
DTEND:20261102T090000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:A
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTAMP:20261101T000000Z
DTSTART:20261102T100000Z
DTEND:20261102T110000Z
RRULE:FREQ=DAILY;COUNT=40
SUMMARY:B
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTAMP:20261101T000000Z
RECURRENCE-ID:20261103T100000Z
DTSTART:20261103T150000Z
DTEND:20261103T160000Z
SUMMARY:B spostato
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTAMP:20261101T000000Z
RECURRENCE-ID:20261210T100000Z
DTSTART:20261104T170000Z
DTEND:20261104T180000Z
SUMMARY:B anticipato
END:VEVENT
END:VCALENDAR`
    const found = occurrencesOf(text, { from: Date.UTC(2026, 10, 2), to: Date.UTC(2026, 10, 5) })
    const titles = found.map((occurrence) => occurrence.title).sort()

    expect(titles.filter((title) => title === 'A')).toHaveLength(3)
    expect(titles).toContain('B spostato')
    expect(titles).toContain('B anticipato')
    expect(found.find((occurrence) => occurrence.title === 'B anticipato')?.recurrenceId).toBe(
      '2026-12-10T10:00:00Z'
    )
  })

  it('reads a time zone named without its VTIMEZONE as that zone, not as local time', () => {
    const text = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tokyo@test
DTSTAMP:20261101T000000Z
DTSTART;TZID=Asia/Tokyo:20261105T090000
DTEND;TZID=Asia/Tokyo:20261105T100000
SUMMARY:Call con Tokyo
END:VEVENT
END:VCALENDAR`
    const [call] = occurrencesOf(text, range)

    expect(call.start).toBe('2026-11-05T00:00:00.000Z')
  })

  it('reads each calendar in its own definition of a time zone, though another named its zone the same', () => {
    const custom = (offset: string, hour: string): string => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:Customized Time Zone
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:${offset}
TZOFFSETTO:${offset}
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:custom-${hour}@test
DTSTAMP:20261101T000000Z
DTSTART;TZID=Customized Time Zone:20261105T${hour}0000
DTEND;TZID=Customized Time Zone:20261105T${hour}3000
SUMMARY:Riunione
END:VEVENT
END:VCALENDAR`

    expect(occurrencesOf(custom('+0100', '10'), range)[0].start).toBe('2026-11-05T09:00:00.000Z')
    expect(occurrencesOf(custom('-0500', '10'), range)[0].start).toBe('2026-11-05T15:00:00.000Z')
  })

  it('ends an all-day event at the midnight after its day, on the day the clocks go forward too', () => {
    const text = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:primavera@test
DTSTAMP:20261101T000000Z
DTSTART;VALUE=DATE:20270328
SUMMARY:Domenica dell'ora legale
END:VEVENT
END:VCALENDAR`
    const [day] = occurrencesOf(text, { from: Date.UTC(2027, 2, 1), to: Date.UTC(2027, 3, 1) })

    expect([day.start, day.end]).toEqual(['2027-03-28', '2027-03-29'])
    expect([day.startsAt, day.endsAt]).toEqual([
      new Date(2027, 2, 28).getTime(),
      new Date(2027, 2, 29).getTime()
    ])
  })
})

describe('canonicalUid', () => {
  it('leaves a UID that is no Exchange Global Object ID as it is', () => {
    expect(canonicalUid(' abc123@google.com ')).toBe('abc123@google.com')
    expect(canonicalUid('040000008200E00074C5B7101A82E008')).toBe(
      '040000008200E00074C5B7101A82E008'
    )
  })

  it('writes Exchange’s own as Exchange does in an invitation: upper case, without the instance’s date', () => {
    expect(
      canonicalUid(
        '040000008200e00074c5b7101a82e00807ea0b175025d461e473c801000000000000000010000000c8d3a9e2d1a84b4db0c2f7a6f2d4c1b3'
      )
    ).toBe(
      '040000008200E00074C5B7101A82E008000000005025D461E473C801000000000000000010000000C8D3A9E2D1A84B4DB0C2F7A6F2D4C1B3'
    )
  })
})

/** A calendar object as CalDAV keeps it: one event, a series with its exception. */
const SERIES = `BEGIN:VCALENDAR
VERSION:2.0
${ROME}
BEGIN:VEVENT
UID:riunione@test
DTSTAMP:20261101T000000Z
DTSTART;TZID=Europe/Rome:20261019T090000
DTEND;TZID=Europe/Rome:20261019T093000
RRULE:FREQ=WEEKLY;COUNT=6
EXDATE;TZID=Europe/Rome:20261102T090000
SUMMARY:Riunione del lunedì
ATTENDEE;CN=Mattia;PARTSTAT=NEEDS-ACTION:mailto:mattia@studio.it
ORGANIZER:mailto:davide@studio.it
END:VEVENT
BEGIN:VEVENT
UID:riunione@test
DTSTAMP:20261101T000000Z
RECURRENCE-ID;TZID=Europe/Rome:20261109T090000
DTSTART;TZID=Europe/Rome:20261110T150000
DTEND;TZID=Europe/Rome:20261110T153000
SUMMARY:Riunione spostata
END:VEVENT
END:VCALENDAR`

describe('occurrencesOf, on calendars that are not well made', () => {
  const calendar = (...events: string[]): string =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//prova//prova', ...events, 'END:VCALENDAR'].join(
      '\r\n'
    )
  const event = (lines: string[]): string => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')

  it('leaves out a series that can never happen, without stopping on it', () => {
    const found = occurrencesOf(
      calendar(
        event([
          'UID:impossibile@prova',
          'DTSTAMP:20261101T000000Z',
          'DTSTART:20261101T090000Z',
          'DTEND:20261101T100000Z',
          'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
          'SUMMARY:Il 30 febbraio'
        ]),
        event([
          'UID:vero@prova',
          'DTSTAMP:20261101T000000Z',
          'DTSTART:20261110T090000Z',
          'DTEND:20261110T100000Z',
          'SUMMARY:Sopralluogo'
        ])
      ),
      range
    )

    expect(found.map((occurrence) => occurrence.title)).toEqual(['Sopralluogo'])
  })

  it('keeps every event without a UID, each on its own', () => {
    const found = occurrencesOf(
      calendar(
        event(['DTSTAMP:20261101T000000Z', 'DTSTART:20261103T090000Z', 'SUMMARY:Primo']),
        event(['DTSTAMP:20261101T000000Z', 'DTSTART:20261104T090000Z', 'SUMMARY:Secondo'])
      ),
      range
    )

    expect(found.map((occurrence) => occurrence.title).sort()).toEqual(['Primo', 'Secondo'])
  })
})

describe('writing events', () => {
  const meeting = {
    title: 'Revisione tavole',
    start: '2026-11-07T10:00:00.000Z',
    end: '2026-11-07T11:00:00.000Z',
    allDay: false,
    location: 'Studio',
    description: null,
    attendees: ['davide@studio.it']
  }

  it('writes a new event in UTC, with its end, its organizer and who made it', () => {
    const text = newEventResource('uid-1', meeting, 'mattia@studio.it', {
      by: 'segretario',
      accountId: 'a',
      messageKey: 'k'
    })
    const occurrence = occurrenceIn(text, null, ['mattia@studio.it'])

    expect(text).toContain('DTEND:20261107T110000Z')
    expect(text).toContain('ORGANIZER:mailto:mattia@studio.it')
    expect(occurrence).toMatchObject({
      title: 'Revisione tavole',
      start: '2026-11-07T10:00:00.000Z',
      location: 'Studio',
      origin: { by: 'segretario', accountId: 'a', messageKey: 'k' }
    })
    expect(occurrence?.attendees.map((attendee) => [attendee.email, attendee.response])).toEqual([
      ['davide@studio.it', 'needsAction']
    ])
  })

  it('changes only what was changed: a place added meanwhile elsewhere stays', () => {
    const asKept = {
      title: 'Sopralluogo',
      start: '2026-11-10T08:00:00.000Z',
      end: '2026-11-10T09:00:00.000Z',
      allDay: false,
      location: null,
      description: null,
      attendees: []
    }
    // Written here, then given a place by another client.
    const onServer = newEventResource('luogo@test', asKept, null, null).replace(
      'SUMMARY:Sopralluogo',
      'SUMMARY:Sopralluogo\r\nLOCATION:Magazzino nord'
    )
    const moved = changeEventResource(
      onServer,
      null,
      { ...asKept, start: '2026-11-10T10:00:00.000Z', end: '2026-11-10T11:00:00.000Z' },
      null,
      new Set(['time'])
    )
    const [event] = occurrencesOf(moved, range)

    expect(event.start).toBe('2026-11-10T10:00:00.000Z')
    expect(event.location).toBe('Magazzino nord')
  })

  it('moves one instance of a series, keeping the series in its time zone', () => {
    const moved = changeEventResource(
      SERIES,
      '2026-11-16T09:00:00',
      {
        title: 'Riunione del lunedì',
        start: '2026-11-17T13:00:00.000Z',
        end: '2026-11-17T13:30:00.000Z',
        allDay: false,
        location: null,
        description: null,
        attendees: []
      },
      null
    )
    const week = occurrencesOf(moved, {
      from: Date.UTC(2026, 10, 15),
      to: Date.UTC(2026, 10, 22)
    }).filter((occurrence) => occurrence.iCalUid === 'riunione@test')

    expect(week.map((occurrence) => [occurrence.start, occurrence.recurrenceId])).toEqual([
      ['2026-11-17T13:00:00.000Z', '2026-11-16T09:00:00']
    ])
    expect(moved).toContain('DTSTART;TZID=Europe/Rome:20261117T140000')
  })

  it('takes one instance out of a series, and answers an invitation as the user', () => {
    const without = removeOccurrence(SERIES, '2026-11-23T09:00:00')
    const answered = withResponse(SERIES, null, ['mattia@studio.it'], 'accepted')

    expect(
      occurrencesOf(without, range).filter(
        (occurrence) => occurrence.title === 'Riunione del lunedì'
      )
    ).toHaveLength(2)
    expect(
      occurrencesOf(answered, range, ['mattia@studio.it']).find(
        (o) => o.title === 'Riunione del lunedì'
      )?.myResponse
    ).toBe('accepted')
    expect(() => withResponse(SERIES, null, ['qualcun.altro@x.it'], 'accepted')).toThrow()
  })
})

describe('answering an invitation by mail', () => {
  const INVITATION = `BEGIN:VCALENDAR
VERSION:2.0
METHOD:REQUEST
BEGIN:VEVENT
UID:collaudo@padana.it
SEQUENCE:2
DTSTAMP:20261101T000000Z
DTSTART:20261112T083000Z
DTEND:20261112T100000Z
SUMMARY:Collaudo sprinkler
ORGANIZER;CN=Giorgio Sala:mailto:giorgio.sala@padana.it
ATTENDEE;CN=Mattia;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:Mattia@Brenta.it
ATTENDEE;PARTSTAT=ACCEPTED:mailto:davide@brenta.it
END:VEVENT
END:VCALENDAR`

  it('says who invites, and answers as the address invited, with the event’s UID and SEQUENCE', () => {
    expect(invitationParties(INVITATION)).toEqual({
      organizer: 'giorgio.sala@padana.it',
      attendees: ['mattia@brenta.it', 'davide@brenta.it']
    })

    const reply = invitationReply(
      INVITATION,
      {
        addresses: ['mattia@brenta.it', 'mattia.galli@gmail.com'],
        address: 'mattia.galli@gmail.com',
        name: 'Mattia Galli'
      },
      'accepted'
    )

    expect(reply.organizer).toBe('giorgio.sala@padana.it')
    expect(reply.summary).toBe('Collaudo sprinkler')
    expect(reply.ics).toContain('METHOD:REPLY')
    expect(reply.ics).toContain('UID:collaudo@padana.it')
    expect(reply.ics).toContain('SEQUENCE:2')
    expect(reply.ics).toMatch(/ATTENDEE;PARTSTAT=ACCEPTED;CN=Mattia Galli:mailto:mattia@brenta.it/)
    expect(reply.ics).not.toContain('davide@brenta.it')
  })
})
