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
      'SUMMARY;LANGUAGE=it:Sopralluogo Caseificio Valli\\, celle 1-3 e verifica ',
      ' gruppi frigo',
      'DTSTART:20261104T090000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    expect(parseInvitation(ics)).toEqual({
      method: 'REQUEST',
      uid: 'abc123@google.com',
      summary: 'Sopralluogo Caseificio Valli, celle 1-3 e verifica gruppi frigo'
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
