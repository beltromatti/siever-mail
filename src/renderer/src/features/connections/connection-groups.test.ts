import { describe, expect, it } from 'vitest'

import type { CalendarConnection } from '@shared/calendar'
import type { MailAccount } from '@shared/models'

import { canAddCalendar, canRenewConsent, connectionGroups } from './connection-groups'

const mail = (id: string, email: string, change: Partial<MailAccount> = {}): MailAccount => ({
  id,
  type: 'gmail',
  email,
  displayName: email,
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  username: email,
  authType: 'oauth',
  createdAt: 0,
  updatedAt: 0,
  pec: false,
  ...change
})

const calendar = (id: string, change: Partial<CalendarConnection>): CalendarConnection => ({
  id,
  provider: 'google',
  label: '',
  mailAccountId: null,
  serverUrl: null,
  lastSyncAt: null,
  problem: null,
  refused: null,
  renewConsent: false,
  calendars: [],
  ...change
})

describe('connectionGroups', () => {
  it('puts a calendar with the mail it came with, by consent or by address, and says a PEC is one', () => {
    const groups = connectionGroups(
      [
        mail('a', 'mattia.galli@gmail.com'),
        mail('b', 'mattia@me.com', {
          type: 'imap',
          authType: 'password',
          imapHost: 'imap.mail.me.com'
        }),
        mail('p', 'mattia@pec.studio.it', {
          type: 'imap',
          authType: 'password',
          imapHost: 'imaps.pec.aruba.it',
          pec: true
        })
      ],
      [
        calendar('a', { label: 'mattia.galli@gmail.com', mailAccountId: 'a' }),
        calendar('c', {
          provider: 'caldav',
          label: 'Mattia@me.com',
          serverUrl: 'https://caldav.icloud.com'
        })
      ]
    )

    expect(
      groups.map((group) => [group.title, group.kind, group.calendars.map((c) => c.id)])
    ).toEqual([
      ['mattia.galli@gmail.com', 'google', ['a']],
      ['mattia@me.com', 'icloud', ['c']],
      ['mattia@pec.studio.it', 'pec', []]
    ])
  })

  it('keeps a calendar alone when no mail is of it, and a link always apart', () => {
    const groups = connectionGroups(
      [mail('a', 'mattia.galli@gmail.com')],
      [
        calendar('w', { label: 'lavoro@studio.it' }),
        calendar('f', {
          provider: 'ics',
          label: 'mattia.galli@gmail.com',
          serverUrl: 'https://x/feed.ics'
        })
      ]
    )

    expect(groups.map((group) => [group.key, group.kind])).toEqual([
      ['mail:a', 'google'],
      ['calendar:w', 'google'],
      ['calendar:f', 'ics']
    ])
    expect(canAddCalendar(groups[0])).toBe(true)
    expect(canAddCalendar(groups[1])).toBe(false)
  })

  it('offers the calendar a Microsoft mailbox can give, as a Google one — not a server’s', () => {
    const groups = connectionGroups(
      [
        mail('m', 'anna@brenta.it', { type: 'imap', authType: 'oauth' }),
        mail('i', 'anna@studio.it', {
          type: 'imap',
          authType: 'password',
          imapHost: 'mail.studio.it'
        })
      ],
      []
    )

    expect(groups.map((group) => [group.kind, canAddCalendar(group)])).toEqual([
      ['microsoft', true],
      ['imap', false]
    ])
  })
})

describe('canRenewConsent', () => {
  it('signs in again a calendar whose consent lacks what writing needs, not one that only failed', () => {
    const problem = 'Il server non risponde.'

    expect(canRenewConsent(calendar('a', { provider: 'microsoft', renewConsent: true }))).toBe(true)
    expect(canRenewConsent(calendar('b', { provider: 'google', problem }))).toBe(false)
    expect(canRenewConsent(calendar('c', { renewConsent: true, refused: 'autorizzazione' }))).toBe(
      false
    )
  })
})
