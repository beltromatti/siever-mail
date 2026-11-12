import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

const shown: FakeNotification[] = []
const sent: unknown[] = []

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
  Notification: FakeNotification
}))

const { NotificationCenter } = await import('./center')

describe('NotificationCenter, a thing that moved', () => {
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    isFocused: () => false,
    focus: () => undefined,
    show: () => undefined,
    restore: () => undefined,
    webContents: {
      isLoadingMainFrame: () => false,
      send: (_channel: string, target: unknown) => void sent.push(target)
    }
  }

  it('keeps a notification on screen under the new key, and its click leads where the thing is now', async () => {
    const center = new NotificationCenter({
      window: () => window as never,
      giveOnce: async () => true,
      onStatusChange: () => undefined
    })

    center.notify({
      family: 'calendar',
      kind: 'calendar.reminder',
      key: 'calendar:reminder:lavoro/e1',
      title: 'Sopralluogo',
      body: 'Fra 10 minuti',
      target: { kind: 'event', eventKey: 'lavoro/e1' },
      when: 'always'
    })
    center.rekey('calendar:reminder:lavoro/e1', 'calendar:reminder:vita/e1', {
      kind: 'event',
      eventKey: 'vita/e1'
    })

    expect(center.isShown('calendar:reminder:lavoro/e1')).toBe(false)
    expect(center.isShown('calendar:reminder:vita/e1')).toBe(true)
    expect(shown[0].closed).toBe(false)

    shown[0].emit('click')
    expect(sent).toEqual([{ kind: 'event', eventKey: 'vita/e1' }])
    expect(center.isShown('calendar:reminder:vita/e1')).toBe(false)
  })

  it('counts what was given once under the old keys as given under the new', async () => {
    const moved: Array<[string, string]> = []
    const center = new NotificationCenter({
      window: () => null,
      giveOnce: async () => true,
      moveGiven: async (from, to) => void moved.push([from, to]),
      onStatusChange: () => undefined
    })

    await center.moveGiven('reminder:["a\u0000b",', 'reminder:["c\u0000d",')
    expect(moved).toEqual([['reminder:["a\\0b",', 'reminder:["c\\0d",']])
  })
})
