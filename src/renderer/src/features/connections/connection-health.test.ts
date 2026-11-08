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
    expect(status).toMatchObject({ health: 'ok', title: 'Tutto sincronizzato', indexing: null })
    expect(status?.standings.map((standing) => standing.text)).toEqual([
      'Sincronizzata: la posta arriva appena c’è',
      '«Lavoro» · letto alle 10:29'
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
    expect(status?.title).toBe('Una connessione ha bisogno di te')
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
      title: 'Senza rete: tutto riprende da sé appena torna'
    })
    expect(offline?.standings[0].text).toBe(
      'Senza rete: riprende da sola · ultimo contatto il 7 nov, 18:05'
    )

    const calendarDown = connectionsStatus(
      [],
      {},
      [calendar('lavoro', { problem: 'Il server del calendario non risponde.' })],
      NOW
    )
    expect(calendarDown?.title).toBe('In attesa di un server: si sistema da sé')
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
      text: 'Si collega…'
    })
    expect(mailStanding(A, state('a', 'connected', { syncing: true }), NOW).text).toBe(
      'Scarica la posta…'
    )
    expect(mailStanding(A, state('a', 'error', { refused: 'certificato' }), NOW)).toMatchObject({
      health: 'attention',
      text: 'Ferma · Il certificato del server non è valido'
    })
  })

  it('says a calendar by its name when it is one, how many when more', () => {
    const two = [
      { connectionId: 'l', calendarId: 'c', name: 'Lavoro', primary: true },
      { connectionId: 'l', calendarId: 'd', name: 'Cantieri', primary: false }
    ]
    expect(calendarStanding(calendar('l', { calendars: two }), NOW).text).toBe(
      '2 calendari · letti alle 10:29'
    )
    expect(calendarStanding(calendar('l', { lastSyncAt: null }), NOW).text).toBe(
      '«Lavoro» · lo legge ora'
    )
    expect(
      calendarStanding(calendar('l', { calendars: [], lastSyncAt: NOW - 2 * 86_400_000 }), NOW).text
    ).toBe('Nessun calendario · controllato il 6 nov, 10:30')
  })

  it('says a calendar stopped, with a consent to renew, or not answering', () => {
    expect(calendarStanding(calendar('l', { refused: 'sparito' }), NOW)).toMatchObject({
      health: 'attention',
      text: 'Fermo · Non si trova più al suo indirizzo'
    })
    expect(
      calendarStanding(
        calendar('l', { renewConsent: true, problem: 'Ricollega il calendario.' }),
        NOW
      )
    ).toMatchObject({ health: 'attention', text: 'Ricollega il calendario.' })
    expect(calendarStanding(calendar('l', { problem: 'Non risponde.' }), NOW)).toMatchObject({
      health: 'waiting',
      text: 'Non risponde. Riprova da solo.'
    })
  })
})
