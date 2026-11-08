import { describe, expect, it } from 'vitest'

import { isIcsAttachment } from '@shared/calendar'

import { parseInvitation } from './ics'

describe('parseInvitation', () => {
  it('reads the method and the event, long lines unfolded and escapes undone', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:abc123@google.com',
      'SUMMARY;LANGUAGE=it:Riunione di condominio\\, punti 1-3 e verifica ',
      ' del bilancio',
      'DTSTART:20261104T090000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    expect(parseInvitation(ics)).toEqual({
      method: 'REQUEST',
      uid: 'abc123@google.com',
      summary: 'Riunione di condominio, punti 1-3 e verifica del bilancio',
      series: false,
      instance: null
    })
  })

  it('knows an invitation to a whole series from one to an instance of it', () => {
    const invitation = (lines: string[]): string =>
      [
        'BEGIN:VCALENDAR',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:serie@prova',
        ...lines,
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n')

    expect(parseInvitation(invitation(['RRULE:FREQ=WEEKLY;BYDAY=MO']))?.series).toBe(true)
    expect(
      parseInvitation(invitation(['RRULE:FREQ=WEEKLY;BYDAY=MO', 'RECURRENCE-ID:20261116T080000Z']))
        ?.series
    ).toBe(false)
  })

  it('says which instance an invitation is about: when it is now, and when the series put it', () => {
    const update = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VTIMEZONE',
      'TZID:W. Europe Standard Time',
      'BEGIN:STANDARD',
      'DTSTART:16010101T030000',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010101T020000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:serie@prova',
      'RECURRENCE-ID;TZID=W. Europe Standard Time:20261116T090000',
      'DTSTART;TZID=W. Europe Standard Time:20261117T150000',
      'DTEND;TZID=W. Europe Standard Time:20261117T160000',
      'SUMMARY:Riunione spostata',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    expect(parseInvitation(update)?.instance).toEqual({
      start: Date.UTC(2026, 10, 17, 14),
      original: Date.UTC(2026, 10, 16, 8)
    })
  })

  it('finds nothing in a file without an event', () => {
    expect(parseInvitation('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBeNull()
  })

  it('knows an invitation file by its type or its name', () => {
    expect(
      isIcsAttachment({ fileName: 'invite.ics', contentType: 'application/octet-stream' })
    ).toBe(true)
    expect(isIcsAttachment({ fileName: 'x', contentType: 'text/calendar; method=REQUEST' })).toBe(
      true
    )
    expect(isIcsAttachment({ fileName: 'offerta.pdf', contentType: 'application/pdf' })).toBe(false)
  })
})
