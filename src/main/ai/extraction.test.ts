import { describe, expect, it, vi } from 'vitest'

import { extractContent } from './extraction'

// PDF pages are drawn in a window of Electron's: not needed to read text.
vi.mock('./pdf-pages', () => ({ renderPdfPages: vi.fn() }))

describe('extractContent', () => {
  it('reads an invitation as its event, unfolded and without its time zone definitions', async () => {
    const invitation = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Rome',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'DTSTART;TZID=Europe/Rome:20261110T150000',
      'SUMMARY:Sopralluogo Prat2470 – centrale termica dell’Hotel Lido Est',
      ' ense',
      'END:VEVENT',
      'END:VCALENDAR',
      ''
    ].join('\r\n')

    const read = await extractContent('invite.ics', 'application/ics', Buffer.from(invitation))

    expect(read).toEqual({
      kind: 'text',
      text: [
        'BEGIN:VCALENDAR',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'DTSTART;TZID=Europe/Rome:20261110T150000',
        'SUMMARY:Sopralluogo Prat2470 – centrale termica dell’Hotel Lido Estense',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\n'),
      totalChars: expect.any(Number),
      nextOffset: null
    })
  })
})
