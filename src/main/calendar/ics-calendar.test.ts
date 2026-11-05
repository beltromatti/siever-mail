import { describe, expect, it } from 'vitest'

import { SyncTokenExpired } from './calendar-provider'
import { FEED_CALENDAR_ID, feedUrl, IcsCalendarProvider, type Fetch } from './ics-calendar'

const feed = (summary: string): string => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:partita@fubles
DTSTAMP:20261101T000000Z
DTSTART:20261106T191500Z
DTEND:20261106T203000Z
SUMMARY:${summary}
END:VEVENT
END:VCALENDAR`

/** A server that answers with the calendar it holds now, and 304 to the ETag it last gave. */
function server(): { fetch: Fetch; calls: string[]; holds: (text: string) => void } {
  let text = feed('Partita')
  let etag = '"1"'
  const calls: string[] = []

  return {
    calls,
    holds: (next) => {
      text = next
      etag = `"${Number(etag.slice(1, -1)) + 1}"`
    },
    fetch: async (_input, init) => {
      const asked = (init?.headers as Record<string, string> | undefined)?.['If-None-Match']
      calls.push(asked ?? 'full')
      return asked === etag
        ? new Response(null, { status: 304 })
        : new Response(text, { status: 200, headers: { etag } })
    }
  }
}

const window = { fromIso: '2026-11-01T00:00:00.000Z', toIso: '2026-12-01T00:00:00.000Z' }

describe('IcsCalendarProvider', () => {
  it('reads the calendar whole, then asks only whether it changed', async () => {
    const remote = server()
    const provider = new IcsCalendarProvider('https://x/feed.ics', 'Calcetto', remote.fetch)

    const first = await provider.changes(FEED_CALENDAR_ID, window)
    expect(first.events.map((event) => [event.title, event.eventId])).toEqual([
      ['Partita', 'partita@fubles']
    ])
    expect(first.syncToken).toBe('etag:"1"')

    const again = await provider.changes(FEED_CALENDAR_ID, { syncToken: first.syncToken! })
    expect(again.events).toEqual([])
    expect(remote.calls).toEqual(['full', '"1"'])
  })

  it('reads a changed calendar again in full, without downloading it twice', async () => {
    const remote = server()
    const provider = new IcsCalendarProvider('https://x/feed.ics', 'Calcetto', remote.fetch)
    const { syncToken } = await provider.changes(FEED_CALENDAR_ID, window)

    remote.holds(feed('Partita spostata'))
    await expect(
      provider.changes(FEED_CALENDAR_ID, { syncToken: syncToken! })
    ).rejects.toBeInstanceOf(SyncTokenExpired)
    const reread = await provider.changes(FEED_CALENDAR_ID, window)

    expect(reread.events[0].title).toBe('Partita spostata')
    expect(reread.syncToken).toBe('etag:"2"')
    expect(remote.calls).toEqual(['full', '"1"'])
  })

  it('takes a webcal link as https, and nothing that is not a web link', () => {
    expect(feedUrl(' webcal://example.com/cal.ics ')).toBe('https://example.com/cal.ics')
    expect(() => feedUrl('file:///etc/passwd')).toThrow()
  })
})
