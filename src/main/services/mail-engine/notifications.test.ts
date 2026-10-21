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
  BrowserWindow: { getAllWindows: () => [] },
  Notification: FakeNotification
}))

const { NotificationManager } = await import('./notifications')
import type { MailFolder, MailMessageSummary } from '@shared/models'

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

function message(uid: number, overrides: Partial<MailMessageSummary> = {}): MailMessageSummary {
  return {
    accountId: 'a1',
    folderPath: 'INBOX',
    uid,
    subject: `Oggetto ${uid}`,
    preview: `Anteprima ${uid}`,
    senderLabel: `Mittente ${uid}`,
    isRead: false,
    ...overrides
  } as MailMessageSummary
}

describe('NotificationManager', () => {
  let manager: InstanceType<typeof NotificationManager>
  const actions = { markRead: vi.fn(async () => undefined), archive: vi.fn(async () => undefined) }

  beforeEach(() => {
    vi.useFakeTimers()
    shown.length = 0
    manager = new NotificationManager({ actions, onStatusChange: () => undefined })
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  it('announces unread mail in the inbox, one alert for what arrives together', () => {
    manager.enqueue(ACCOUNT, [message(1), message(2, { isRead: true })], INBOX, false)
    manager.enqueue(ACCOUNT, [message(3)], INBOX, false)
    vi.runAllTimers()

    expect(shown).toHaveLength(1)
    expect(shown[0].options.title).toBe('2 nuove email')
  })

  it('gives a single message its sender, subject and buttons', () => {
    manager.enqueue(ACCOUNT, [message(7)], INBOX, false)
    vi.runAllTimers()

    expect(shown[0].options).toMatchObject({
      title: 'Mittente 7',
      id: 'a1:INBOX:7',
      groupId: 'a1',
      actions: [
        { type: 'button', text: 'Segna come letta' },
        { type: 'button', text: 'Archivia' }
      ]
    })
    expect(`${shown[0].options.subtitle ?? ''}${shown[0].options.body}`).toContain('Oggetto 7')
  })

  it('stays quiet for a first sync, other folders, muted accounts and when off', () => {
    manager.enqueue(ACCOUNT, [message(1)], INBOX, true)
    manager.enqueue(
      ACCOUNT,
      [message(2, { folderPath: 'Archivio' })],
      {
        ...INBOX,
        path: 'Archivio',
        specialUse: '\\Archive'
      },
      false
    )
    manager.setPreferences({
      enabled: true,
      mutedAccountIds: ['a1'],
      showPreview: true,
      sound: true,
      badge: true
    })
    manager.enqueue(ACCOUNT, [message(3)], INBOX, false)
    manager.setPreferences({
      enabled: false,
      mutedAccountIds: [],
      showPreview: true,
      sound: true,
      badge: true
    })
    manager.enqueue(ACCOUNT, [message(4)], INBOX, false)
    vi.runAllTimers()

    expect(shown).toHaveLength(0)
  })

  it('says only that mail arrived when the preview is off', () => {
    manager.setPreferences({
      enabled: true,
      mutedAccountIds: [],
      showPreview: false,
      sound: false,
      badge: true
    })
    manager.enqueue(ACCOUNT, [message(5)], INBOX, false)
    vi.runAllTimers()

    expect(shown[0].options).toMatchObject({
      title: 'Nuova email',
      body: 'anna@example.it',
      silent: true
    })
  })

  it('takes an alert away once all its messages are read or gone', () => {
    manager.enqueue(ACCOUNT, [message(1), message(2)], INBOX, false)
    vi.runAllTimers()

    manager.withdraw([{ accountId: 'a1', folderPath: 'INBOX', uid: 1 }])
    expect(shown[0].closed).toBe(false)

    manager.withdraw([{ accountId: 'a1', folderPath: 'INBOX', uid: 2 }])
    expect(shown[0].closed).toBe(true)
  })

  it('runs the buttons on the message', async () => {
    manager.enqueue(ACCOUNT, [message(9)], INBOX, false)
    vi.runAllTimers()

    shown[0].emit('action', { actionIndex: 1 })
    await vi.runAllTimersAsync()

    expect(actions.archive).toHaveBeenCalledWith({ accountId: 'a1', folderPath: 'INBOX', uid: 9 })
  })
})
