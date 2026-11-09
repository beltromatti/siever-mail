import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shown: FakeNotification[] = []

class FakeNotification extends EventEmitter {
  closed = false
  constructor(readonly options: Record<string, unknown>) {
    super()
  }
  static isSupported(): boolean {
    return true
  }
  show(): void {
    shown.push(this)
    this.emit('show', {})
  }
  close(): void {
    this.closed = true
  }
}

vi.mock('electron', () => ({
  app: { focus: () => undefined },
  shell: { openExternal: async () => undefined },
  Notification: FakeNotification
}))

const { MailNotifications } = await import('./notifications')
const { NotificationCenter } = await import('@main/notifications/center')
import type { MailFolder, MailMessageSummary } from '@shared/models'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences
} from '@shared/notifications'
import type { MessageNote } from '@shared/segretario'

const INBOX: MailFolder = {
  accountId: 'a1',
  path: 'INBOX',
  name: 'INBOX',
  delimiter: '/',
  specialUse: '\\Inbox',
  messageCount: 0,
  unseenCount: 0
} as MailFolder
const ACCOUNT = { id: 'a1', email: 'anna@example.it' }
const OTHER = { id: 'a2', email: 'anna@brenta.it' }

function message(uid: number, overrides: Partial<MailMessageSummary> = {}): MailMessageSummary {
  return {
    accountId: 'a1',
    folderPath: 'INBOX',
    uid,
    subject: `Oggetto ${uid}`,
    preview: `Anteprima ${uid}`,
    messageKey: `k${uid}`,
    senderLabel: `Mittente ${uid}`,
    date: new Date(Date.now() + 60_000).toISOString(),
    isRead: false,
    ...overrides
  } as MailMessageSummary
}

function note(uid: number, notify: boolean, overrides: Partial<MessageNote> = {}): MessageNote {
  return {
    accountId: 'a1',
    messageKey: `k${uid}`,
    threadId: `t${uid}`,
    direction: 'in',
    summary: `Nota ${uid}`,
    nature: 'da_rispondere',
    priority: 'alta',
    reason: '',
    due: null,
    messageDate: '2026-10-28T08:00:00.000Z',
    twinAccountId: null,
    notify,
    alert: null,
    writtenBy: 'segretario',
    ...overrides
  }
}

describe('the notifications of new mail', () => {
  let center: InstanceType<typeof NotificationCenter>
  let mail: InstanceType<typeof MailNotifications>
  const actions = { markRead: vi.fn(async () => undefined), archive: vi.fn(async () => undefined) }
  const prefer = (change: (current: NotificationPreferences) => NotificationPreferences): void =>
    center.setPreferences(change(center.preferences))

  beforeEach(() => {
    vi.useFakeTimers()
    shown.length = 0
    center = new NotificationCenter({
      // No window: the user is away from it.
      window: () => null,
      giveOnce: async () => true,
      onStatusChange: () => undefined
    })
    center.setPreferences(DEFAULT_NOTIFICATION_PREFERENCES)
    mail = new MailNotifications({ center, actions })
    // Without the Segretario, unless a test says otherwise.
    mail.setSegretarioReading(false)
  })

  afterEach(() => {
    mail.dispose()
    center.dispose()
    vi.useRealTimers()
  })

  it('tells unread mail in the inbox, one notification for what arrives together', () => {
    mail.enqueue(ACCOUNT, [message(1), message(2, { isRead: true })], INBOX, false)
    mail.enqueue(ACCOUNT, [message(3)], INBOX, false)
    vi.runAllTimers()

    expect(shown).toHaveLength(1)
    expect(shown[0].options.title).toBe('2 nuove email')
  })

  it('gives a single message its sender, subject and buttons', () => {
    mail.enqueue(ACCOUNT, [message(7)], INBOX, false)
    vi.runAllTimers()

    expect(shown[0].options).toMatchObject({
      title: 'Mittente 7',
      groupId: 'a1',
      actions: [
        { type: 'button', text: 'Segna come letta' },
        { type: 'button', text: 'Archivia' }
      ]
    })
    expect(`${shown[0].options.subtitle ?? ''}${shown[0].options.body}`).toContain('Oggetto 7')
  })

  it('stays quiet for a first sync, other folders, muted mailboxes and when off', () => {
    mail.enqueue(ACCOUNT, [message(1)], INBOX, true)
    mail.enqueue(
      ACCOUNT,
      [message(2, { folderPath: 'Archivio' })],
      { ...INBOX, path: 'Archivio', specialUse: '\\Archive' },
      false
    )
    prefer((current) => ({ ...current, mail: { ...current.mail, mutedAccountIds: ['a1'] } }))
    mail.enqueue(ACCOUNT, [message(3)], INBOX, false)
    prefer((current) => ({ ...current, mail: { ...current.mail, mutedAccountIds: [] } }))
    prefer((current) => ({ ...current, mail: { ...current.mail, enabled: false } }))
    mail.enqueue(ACCOUNT, [message(4)], INBOX, false)
    prefer((current) => ({ ...current, mail: { ...current.mail, enabled: true }, enabled: false }))
    mail.enqueue(ACCOUNT, [message(5)], INBOX, false)
    vi.runAllTimers()

    expect(shown).toHaveLength(0)
  })

  it('says only that mail arrived when the content is not to be shown', () => {
    prefer((current) => ({ ...current, showPreview: false, sound: false }))
    mail.enqueue(ACCOUNT, [message(5)], INBOX, false)
    vi.runAllTimers()

    expect(shown[0].options).toMatchObject({
      title: 'Nuova email',
      body: 'anna@example.it',
      silent: true
    })
  })

  it('takes a notification away once all its messages are read or gone', () => {
    mail.enqueue(ACCOUNT, [message(1), message(2)], INBOX, false)
    vi.runAllTimers()

    mail.withdraw([{ accountId: 'a1', folderPath: 'INBOX', uid: 1 }])
    expect(shown[0].closed).toBe(false)

    mail.withdraw([{ accountId: 'a1', folderPath: 'INBOX', uid: 2 }])
    expect(shown[0].closed).toBe(true)
  })

  it('runs the buttons on the message', async () => {
    mail.enqueue(ACCOUNT, [message(9)], INBOX, false)
    vi.runAllTimers()

    shown[0].emit('action', { actionIndex: 1 })
    await vi.runAllTimersAsync()

    expect(actions.archive).toHaveBeenCalledWith({ accountId: 'a1', folderPath: 'INBOX', uid: 9 })
  })

  it('tells what came while the app was closed once it has all arrived, one per mailbox', () => {
    const before = new Date(Date.now() - 3_600_000).toISOString()
    mail.enqueue(ACCOUNT, [message(1, { date: before })], INBOX, false)
    vi.advanceTimersByTime(10_000)
    mail.enqueue(
      ACCOUNT,
      [message(2, { date: before }), message(3, { date: before })],
      INBOX,
      false
    )
    vi.advanceTimersByTime(10_000)
    expect(shown).toHaveLength(0)

    vi.advanceTimersByTime(20_000)
    expect(shown).toHaveLength(1)
    expect(shown[0].options.title).toBe('3 nuove email')
  })

  it('tells a message once, whatever mailboxes it came to', () => {
    const copy = { messageId: '<m1@brenta.it>' }
    mail.enqueue(ACCOUNT, [message(1, copy)], INBOX, false)
    mail.enqueue(
      OTHER,
      [message(1, { ...copy, accountId: 'a2', messageKey: 'other' })],
      { ...INBOX, accountId: 'a2' },
      false
    )
    vi.runAllTimers()

    expect(shown).toHaveLength(1)
  })

  it('at launch, waits to know whether the Segretario reads before telling what it found', () => {
    const launched = new MailNotifications({ center, actions })
    const before = new Date(Date.now() - 3_600_000).toISOString()
    launched.enqueue(ACCOUNT, [message(11, { date: before })], INBOX, false)
    vi.advanceTimersByTime(60_000)
    expect(shown).toHaveLength(0)

    // It does not: what was found is told as it is, together, once it has all come.
    launched.setSegretarioReading(false)
    launched.enqueue(ACCOUNT, [message(12, { date: before })], INBOX, false)
    vi.advanceTimersByTime(20_000)
    expect(shown).toHaveLength(1)
    expect(shown[0].options.title).toBe('2 nuove email')
    launched.dispose()
  })

  describe('while the Segretario reads the mail', () => {
    beforeEach(() => mail.setSegretarioReading(true))

    it('tells only what it said to tell now, with its words', () => {
      mail.enqueue(ACCOUNT, [message(1), message(2), message(3)], INBOX, false)
      vi.advanceTimersByTime(5_000)
      expect(shown).toHaveLength(0)

      mail.noteWritten(note(1, true))
      mail.noteWritten(note(2, false))

      expect(shown).toHaveLength(1)
      expect(shown[0].options.title).toBe('Mittente 1')
      expect(`${shown[0].options.body}`).toContain('Nota 1')
    })

    it('tells a copy in another mailbox only where it was not told', () => {
      const copy = { messageId: '<m3@brenta.it>' }
      mail.enqueue(ACCOUNT, [message(3, copy)], INBOX, false)
      mail.noteWritten(note(3, true))
      mail.enqueue(
        OTHER,
        [message(3, { ...copy, accountId: 'a2', messageKey: 'twin' })],
        { ...INBOX, accountId: 'a2' },
        false
      )
      mail.noteWritten(note(3, true, { accountId: 'a2', messageKey: 'twin', twinAccountId: 'a1' }))
      expect(shown).toHaveLength(1)

      // Its first mailbox muted: the copy is told.
      prefer((current) => ({ ...current, mail: { ...current.mail, mutedAccountIds: ['a1'] } }))
      const muted = { messageId: '<m4@brenta.it>' }
      mail.enqueue(ACCOUNT, [message(4, muted)], INBOX, false)
      mail.enqueue(
        OTHER,
        [message(4, { ...muted, accountId: 'a2', messageKey: 'twin4' })],
        { ...INBOX, accountId: 'a2' },
        false
      )
      mail.noteWritten(note(4, true, { accountId: 'a2', messageKey: 'twin4', twinAccountId: 'a1' }))
      expect(shown).toHaveLength(2)
    })

    it('says why it cannot wait, with the line the Segretario wrote — or its summary, without one', () => {
      mail.enqueue(ACCOUNT, [message(1), message(2)], INBOX, false)
      mail.noteWritten(note(1, true, { alert: 'Rossi aspetta la conferma entro le 12.' }))
      mail.noteWritten(note(2, true))

      expect(shown.map((notification) => notification.options.body)).toEqual([
        'Rossi aspetta la conferma entro le 12.',
        'Nota 2'
      ])
    })

    it('tells as it is a message whose note does not come in time', () => {
      mail.enqueue(ACCOUNT, [message(4)], INBOX, false)
      vi.advanceTimersByTime(10 * 60 * 1000)

      expect(shown).toHaveLength(1)
      expect(`${shown[0].options.body}`).toContain('Anteprima 4')
    })

    it('lets go of what waited when it stops reading, and forgets what was read', () => {
      mail.enqueue(ACCOUNT, [message(5), message(6)], INBOX, false)
      mail.withdraw([{ accountId: 'a1', folderPath: 'INBOX', uid: 6 }])
      mail.setSegretarioReading(false)
      vi.advanceTimersByTime(2_000)

      expect(shown).toHaveLength(1)
      expect(shown[0].options.title).toBe('Mittente 5')
    })

    it('tells everything when the user wants every message', () => {
      prefer((current) => ({ ...current, mail: { ...current.mail, onlyFlagged: false } }))
      mail.enqueue(ACCOUNT, [message(7)], INBOX, false)
      vi.runAllTimers()

      expect(shown).toHaveLength(1)
    })

    it('tells what came while closed, and is worth it, once every note is in', () => {
      const before = new Date(Date.now() - 3_600_000).toISOString()
      mail.enqueue(
        ACCOUNT,
        [message(1, { date: before }), message(2, { date: before }), message(3, { date: before })],
        INBOX,
        false
      )

      mail.noteWritten(note(1, true))
      mail.noteWritten(note(2, false))
      expect(shown).toHaveLength(0)

      mail.noteWritten(note(3, true))
      expect(shown).toHaveLength(1)
      expect(shown[0].options).toMatchObject({ title: '2 email da guardare' })
      expect(`${shown[0].options.body}`).toContain('Nota 1')
    })

    it('tells nothing of what came while closed and went before it was told', () => {
      const before = new Date(Date.now() - 3_600_000).toISOString()
      mail.enqueue(
        ACCOUNT,
        [message(1, { date: before }), message(2, { date: before })],
        INBOX,
        false
      )
      mail.noteWritten(note(1, true))
      // Both read elsewhere at once: the last held settles the mailbox, with nothing left.
      mail.withdraw([
        { accountId: 'a1', folderPath: 'INBOX', uid: 1 },
        { accountId: 'a1', folderPath: 'INBOX', uid: 2 }
      ])
      vi.runAllTimers()

      expect(shown).toHaveLength(0)
    })
  })
})

describe('the notification centre', () => {
  it('keeps what answers the user for when they are away from the window', () => {
    shown.length = 0
    let focused = true
    const window = {
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => focused
    }
    const center = new NotificationCenter({
      window: () => window as never,
      giveOnce: async () => true,
      onStatusChange: () => undefined
    })
    center.setPreferences(DEFAULT_NOTIFICATION_PREFERENCES)
    const input = {
      family: 'segretario' as const,
      kind: 'segretario.finished',
      key: 'segretario:done:1',
      title: 'Il Segretario ha finito',
      body: 'Ho trovato tre offerte.',
      target: { kind: 'activity' as const, activityId: '1' },
      when: 'away' as const
    }

    expect(center.notify(input)).toBe(false)
    expect(center.notify({ ...input, key: 'calendar:reminder:e1', when: 'always' })).toBe(true)

    focused = false
    expect(center.notify(input)).toBe(true)
    expect(shown).toHaveLength(2)

    // Another with the same key takes its place; withdrawn, it goes.
    center.notify({ ...input, body: 'Ne ho trovate quattro.' })
    expect(shown[1].closed).toBe(true)
    center.withdraw(input.key)
    expect(shown[2].closed).toBe(true)
    center.dispose()
  })
})
