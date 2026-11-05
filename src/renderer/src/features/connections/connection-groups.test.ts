import { describe, expect, it } from 'vitest'

import type { CalendarConnection } from '@shared/calendar'
import type { MailAccount } from '@shared/models'

import { canAddCalendar, canReconnect, connectionGroups } from './connection-groups'

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
  calendars: [],
  ...change
})

describe('connectionGroups', () => {
  it('puts a calendar with the mail it came with, by consent or by address', () => {
    const groups = connectionGroups(
      [
        mail('a', 'beltromatti@gmail.com'),
        mail('b', 'mattia@me.com', {
          type: 'imap',
          authType: 'password',
          imapHost: 'imap.mail.me.com'
        })
      ],
      [
        calendar('a', { label: 'beltromatti@gmail.com', mailAccountId: 'a' }),
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
      ['beltromatti@gmail.com', 'google', ['a']],
      ['mattia@me.com', 'icloud', ['c']]
    ])
  })

  it('keeps a calendar alone when no mail is of it, and a link always apart', () => {
    const groups = connectionGroups(
      [mail('a', 'beltromatti@gmail.com')],
      [
        calendar('w', { label: 'lavoro@studio.it' }),
        calendar('f', {
          provider: 'ics',
          label: 'beltromatti@gmail.com',
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
})

describe('canReconnect', () => {
  it('signs in again a Google or Microsoft calendar that could not be read, not a server or a link', () => {
    const problem = 'Microsoft non accetta più l’accesso a questo calendario: ricollegalo.'

    expect(canReconnect(calendar('a', { provider: 'microsoft', problem }))).toBe(true)
    expect(canReconnect(calendar('b', { provider: 'google', problem }))).toBe(true)
    expect(canReconnect(calendar('c', { provider: 'google' }))).toBe(false)
    expect(canReconnect(calendar('d', { provider: 'caldav', problem }))).toBe(false)
    expect(canReconnect(calendar('e', { provider: 'ics', problem }))).toBe(false)
  })
})
