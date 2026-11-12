import { describe, expect, it } from 'vitest'

import type { CalendarConnection } from '@shared/calendar'
import type { AccountConnectionState, MailAccount } from '@shared/models'

import { calendarStanding, connectionsStatus, mailStanding } from './connection-health'

const NOW = new Date(2026, 10, 8, 10, 30).getTime()

function account(id: string): MailAccount {
  return {
    id,
    type: 'imap',
    email: `${id}@example.com`,
    displayName: id,
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    username: id,
    authType: 'password',
    createdAt: 0,
    updatedAt: 0,
    pec: false
  }
}

function state(
  accountId: string,
  status: AccountConnectionState['status'],
  extra: Partial<AccountConnectionState> = {}
): AccountConnectionState {
  return { accountId, status, syncing: false, ...extra }
}

function calendar(id: string, extra: Partial<CalendarConnection> = {}): CalendarConnection {
  return {
    id,
    provider: 'caldav',
    label: id,
    mailAccountId: null,
    serverUrl: null,
    lastSyncAt: NOW - 60_000,
    problem: null,
    refused: null,
    renewConsent: false,
    calendars: [{ connectionId: id, calendarId: 'c', name: 'Lavoro', primary: true }],
    ...extra
  }
}

const A = account('a')
const B = account('b')

describe('connectionsStatus', () => {
  it('says nothing without connections, and all in step when every one is', () => {
    expect(connectionsStatus([], {}, [], NOW)).toBeNull()

    const status = connectionsStatus([A], { a: state('a', 'connected') }, [calendar('lavoro')], NOW)
    expect(status).toMatchObject({ health: 'ok', title: 'All in sync', indexing: null })
    expect(status?.standings.map((standing) => standing.text)).toEqual([
      'In sync: mail arrives as soon as it’s there',
      '“Lavoro” · read at 10:29 AM'
    ])
  })

  it('puts first what wants the user, then what waits on what passes, then what is at work', () => {
    const status = connectionsStatus(
      [A, B],
      { a: state('a', 'error'), b: state('b', 'error', { refused: 'accesso' }) },
      [calendar('lavoro', { lastSyncAt: null })],
      NOW
    )

    expect(status?.health).toBe('attention')
    expect(status?.title).toBe('A connection needs you')
    expect(status?.standings.map((standing) => [standing.key, standing.health])).toEqual([
      ['posta:b', 'attention'],
      ['posta:a', 'waiting'],
      ['calendario:lavoro', 'working']
    ])
  })

  it('says calmly what passes by itself: the network, a server that does not answer', () => {
    const lastContactAt = new Date(2026, 10, 7, 18, 5).getTime()
    const offline = connectionsStatus([A], { a: state('a', 'offline', { lastContactAt }) }, [], NOW)
    expect(offline).toMatchObject({
      health: 'waiting',
      title: 'No network: everything resumes on its own when it’s back'
    })
    expect(offline?.standings[0].text).toBe(
      'No network: it resumes on its own · last contact on Nov 7, 6:05 PM'
    )

    const calendarDown = connectionsStatus(
      [],
      {},
      [calendar('lavoro', { problem: 'The calendar server is not answering.' })],
      NOW
    )
    expect(calendarDown?.title).toBe('Waiting for a server: it sorts itself out')
  })

  it('tells how far the search has read the mail, only while it still reads', () => {
    const reading = connectionsStatus(
      [A, B],
      {
        a: state('a', 'connected', { index: { total: 100, indexed: 40 } }),
        b: state('b', 'connected', { index: { total: 50, indexed: 50 } })
      },
      [],
      NOW
    )

    expect(reading?.indexing).toEqual({ indexed: 90, total: 150 })
  })
})

describe('the lines of the connections', () => {
  it('says a mailbox at work, and stopped', () => {
    expect(mailStanding(A, undefined, NOW)).toMatchObject({
      health: 'working',
      text: 'Connecting…'
    })
    expect(mailStanding(A, state('a', 'connected', { syncing: true }), NOW).text).toBe(
      'Downloading the mail…'
    )
    expect(mailStanding(A, state('a', 'error', { refused: 'certificato' }), NOW)).toMatchObject({
      health: 'attention',
      text: 'Stopped · The server’s certificate isn’t valid'
    })
  })

  it('says a calendar by its name when it is one, how many when more', () => {
    const two = [
      { connectionId: 'l', calendarId: 'c', name: 'Lavoro', primary: true },
      { connectionId: 'l', calendarId: 'd', name: 'Cantieri', primary: false }
    ]
    expect(calendarStanding(calendar('l', { calendars: two }), NOW).text).toBe(
      '2 calendars · read at 10:29 AM'
    )
    expect(calendarStanding(calendar('l', { lastSyncAt: null }), NOW).text).toBe(
      '“Lavoro” · reading it now'
    )
    expect(
      calendarStanding(calendar('l', { calendars: [], lastSyncAt: NOW - 2 * 86_400_000 }), NOW).text
    ).toBe('No calendars · checked on Nov 6, 10:30 AM')
  })

  it('says a calendar stopped, with a consent to renew, or not answering', () => {
    expect(calendarStanding(calendar('l', { refused: 'sparito' }), NOW)).toMatchObject({
      health: 'attention',
      text: 'Stopped · It’s no longer at its address'
    })
    expect(
      calendarStanding(
        calendar('l', { renewConsent: true, problem: 'Reconnect the calendar.' }),
        NOW
      )
    ).toMatchObject({ health: 'attention', text: 'Reconnect the calendar.' })
    expect(calendarStanding(calendar('l', { problem: 'Not answering.' }), NOW)).toMatchObject({
      health: 'waiting',
      text: 'Not answering. It tries again on its own.'
    })
  })
})
