import { createHash } from 'node:crypto'

import { app, Notification, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'

import { APP_ID } from '@main/app-identity'
import { diagnostics } from '@main/diagnostics/log'
import { messages } from '@main/i18n'
import { defineMessages } from '@shared/i18n'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATIONS_IPC,
  REMINDER_LEADS,
  type NotificationDelivery,
  type NotificationFamily,
  type NotificationPreferences,
  type NotificationStatus,
  type NotificationTarget
} from '@shared/notifications'

const log = diagnostics('app')

const MESSAGES = defineMessages({
  testTitle: {
    en: 'Notifications work',
    it: 'Le notifiche funzionano',
    de: 'Benachrichtigungen funktionieren'
  },
  testBody: {
    en: 'When something can’t wait, SIEVER Mail lets you know like this.',
    it: 'Quando qualcosa non può aspettare, SIEVER Mail ti avvisa così.',
    de: 'Wenn etwas nicht warten kann, meldet sich SIEVER Mail so bei Ihnen.'
  },
  desktopSettings: {
    en: 'On this system, notifications are set in the desktop’s settings.',
    it: 'Su questo sistema le notifiche si regolano dalle impostazioni del desktop.',
    de: 'Auf diesem System werden Benachrichtigungen in den Einstellungen der Desktopumgebung geregelt.'
  },
  macNotAllowed: {
    en: 'SIEVER Mail’s notifications aren’t allowed in System Settings › Notifications.',
    it: 'Le notifiche di SIEVER Mail non sono consentite in Impostazioni di Sistema › Notifiche.',
    de: 'Die Benachrichtigungen von SIEVER Mail sind in Systemeinstellungen › Mitteilungen nicht erlaubt.'
  },
  windowsNotAllowed: {
    en: 'Windows settings don’t allow SIEVER Mail’s notifications.',
    it: 'Le impostazioni di Windows non consentono le notifiche di SIEVER Mail.',
    de: 'Die Windows-Einstellungen erlauben die Benachrichtigungen von SIEVER Mail nicht.'
  }
})

/** The preferences as the page sends them: every field, well formed. */
export const notificationPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    showPreview: z.boolean(),
    sound: z.boolean(),
    badge: z.enum(['work', 'unread', 'none']),
    mail: z
      .object({
        enabled: z.boolean(),
        onlyFlagged: z.boolean(),
        mutedAccountIds: z.array(z.string().trim().min(1)).max(500)
      })
      .strict(),
    calendar: z
      .object({
        reminders: z.boolean(),
        defaultLead: z
          .number()
          .int()
          .nullable()
          .refine((lead) => REMINDER_LEADS.includes(lead)),
        changes: z.boolean(),
        onlyFlagged: z.boolean()
      })
      .strict(),
    segretario: z.object({ needsYou: z.boolean(), day: z.boolean() }).strict()
  })
  .strict()

/** How long a test notification is given to be shown or turned down. */
const TEST_SETTLE_MS = 4_000

/** The system pages where the user allows an app's notifications. */
const SYSTEM_SETTINGS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${APP_ID}`,
  win32: 'ms-settings:notifications'
}

/** A notification, as any part of the app asks for one. */
export interface NotificationInput {
  family: NotificationFamily
  /** What it is, for the diagnostics: `mail.new`, `calendar.reminder`, `segretario.day`. */
  kind: string
  /** One notification per key: another with the same key takes its place, `withdraw` takes it away. */
  key: string
  title: string
  /** A second line under the title where the system has one (macOS); elsewhere the body's first. */
  subtitle?: string
  body: string
  /** What it says with its content hidden (`showPreview` off): only what kind of thing came. */
  concealed?: { title: string; body: string }
  target: NotificationTarget
  /** Its buttons, in their order. */
  actions?: ReadonlyArray<{ label: string; run: () => unknown }>
  /**
   * `always`: whenever it comes — what is tied to its time. `away`: only
   * when the user is not at the window; there, the app says it itself.
   */
  when: 'always' | 'away'
  /** Gathered under a name with the others of the same thing (Windows: a mailbox). */
  group?: { id: string; title: string }
}

/**
 * The system's identifier of a notification, from its key: the same thing
 * is the same notification in the system's centre too. Short, as Windows
 * keeps a toast's tag to 64 characters.
 */
function systemId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

interface Shown {
  notification: Notification
  input: NotificationInput
}

/**
 * The notifications of SIEVER Mail (vision §13.3): one place for every app,
 * the Segretario, the app itself and an extension. Each part says what it
 * has to say and decides, by its own preferences, whether it is worth an
 * interruption; here the rest is kept the same for all — the switch of
 * them all, whether their content shows, their sound, whether the user is
 * at the window, one notification per thing, the click that leads to it,
 * what the system did with the last one.
 */
export class NotificationCenter {
  private current: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES
  private delivery: NotificationDelivery = { state: 'unknown' }
  private readonly shown = new Map<string, Shown>()
  /** Every notification still to be clicked or dismissed: held, or its handlers go with it. */
  private readonly live = new Set<Notification>()
  /** Those taken away by the app, not by the user: their closing is not a dismissal. */
  private readonly withdrawn = new WeakSet<Notification>()
  private readonly listeners = new Set<(preferences: NotificationPreferences) => void>()

  constructor(
    private readonly deps: {
      window: () => BrowserWindow | null
      /** True the first time a key is given; never again (kept on disk). */
      giveOnce: (key: string) => Promise<boolean>
      onStatusChange: (status: NotificationStatus) => void
    }
  ) {}

  get preferences(): NotificationPreferences {
    return this.current
  }

  setPreferences(preferences: NotificationPreferences): void {
    this.current = preferences

    // Turned off: what is on screen goes too.
    if (!preferences.enabled) {
      for (const key of [...this.shown.keys()]) {
        this.withdraw(key)
      }
    }

    for (const listener of this.listeners) {
      listener(preferences)
    }
  }

  /** Told each time the preferences change; returns how to stop. */
  onPreferences(listener: (preferences: NotificationPreferences) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Whether the user is not at the window: hidden, minimised, or another app in front. */
  userAway(): boolean {
    const window = this.deps.window()
    return !window || !window.isVisible() || window.isMinimized() || !window.isFocused()
  }

  /** Whether a notification `when: 'away'` would be shown now, by every rule but its own part's. */
  wouldShow(when: NotificationInput['when']): boolean {
    return (
      Notification.isSupported() && this.current.enabled && (when === 'always' || this.userAway())
    )
  }

  /**
   * Shows it, in place of one with the same key — or not, when notifications
   * are off, the system has none, or it waits for the user to be away and
   * they are at the window.
   */
  notify(input: NotificationInput): boolean {
    if (!this.wouldShow(input.when)) {
      return false
    }

    const hidden = !this.current.showPreview && input.concealed
    const title = hidden ? input.concealed!.title : input.title
    const body = hidden ? input.concealed!.body : input.body
    // Only macOS shows a subtitle: elsewhere it opens the body.
    const subtitle = hidden ? undefined : input.subtitle
    const hasSubtitle = process.platform === 'darwin'
    const notification = new Notification({
      id: systemId(input.key),
      title,
      subtitle: hasSubtitle ? subtitle : undefined,
      body: hasSubtitle || !subtitle ? body : [subtitle, body].filter(Boolean).join('\n'),
      silent: !this.current.sound,
      actions: input.actions?.map((action) => ({ type: 'button' as const, text: action.label })),
      ...(input.group ? { groupId: input.group.id, groupTitle: input.group.title } : {})
    })

    this.withdraw(input.key)
    this.shown.set(input.key, { notification, input })
    void this.present(notification, input)
    return true
  }

  /** Takes a notification away — what it said is over: read, answered, gone. */
  withdraw(key: string): void {
    const shown = this.shown.get(key)

    if (shown) {
      this.shown.delete(key)
      this.withdrawn.add(shown.notification)
      shown.notification.close()
    }
  }

  /** Takes away every notification whose key says so. */
  withdrawWhere(test: (key: string) => boolean): void {
    for (const key of [...this.shown.keys()]) {
      if (test(key)) {
        this.withdraw(key)
      }
    }
  }

  /** Whether a notification with this key is on screen, or in the notification centre. */
  isShown(key: string): boolean {
    return this.shown.has(key)
  }

  /** True the first time only: for what is given once — a reminder, the day's letter. */
  giveOnce(key: string): Promise<boolean> {
    // Kept as text on disk, where a NUL would cut it short: two keys would be one.
    return this.deps.giveOnce(key.replaceAll('\u0000', '\\0')).catch((error: unknown) => {
      log.warn('notification.once-unknown', { err: error })
      return false
    })
  }

  status(): NotificationStatus {
    return {
      supported: Notification.isSupported(),
      delivery: this.delivery,
      canOpenSystemSettings: SYSTEM_SETTINGS[process.platform] !== undefined
    }
  }

  /** A notification that says notifications work — or lets the system say they do not. */
  async showTest(): Promise<NotificationStatus> {
    if (!Notification.isSupported()) {
      return this.status()
    }

    const m = messages(MESSAGES)
    const notification = new Notification({
      title: m.testTitle,
      body: m.testBody,
      silent: !this.current.sound
    })
    await this.present(
      notification,
      {
        family: 'app',
        kind: 'app.test',
        key: 'app:test',
        title: '',
        body: '',
        target: { kind: 'window' },
        when: 'always'
      },
      TEST_SETTLE_MS
    )
    return this.status()
  }

  async openSystemSettings(): Promise<void> {
    const page = SYSTEM_SETTINGS[process.platform]

    if (!page) {
      throw new Error(messages(MESSAGES).desktopSettings)
    }

    await shell.openExternal(page)
  }

  /**
   * The app is closing: what is in the system's centre stays there — the
   * mail still unread, the reminder of a meeting — and only lets go here.
   */
  dispose(): void {
    this.shown.clear()
    this.live.clear()
    this.listeners.clear()
  }

  /**
   * Shows `notification` and wires it: a click, a button, its going away.
   * Resolves once the system has shown it or turned it down — or after
   * `settleMs`, when it says neither.
   */
  private present(
    notification: Notification,
    input: NotificationInput,
    settleMs = 0
  ): Promise<void> {
    const said = { family: input.family, kind: input.kind }

    return new Promise((resolve) => {
      const settle = setTimeout(resolve, settleMs)
      const done = (): void => {
        clearTimeout(settle)
        resolve()
      }
      const gone = (): void => {
        this.live.delete(notification)

        if (this.shown.get(input.key)?.notification === notification) {
          this.shown.delete(input.key)
        }
      }

      this.live.add(notification)
      notification.once('show', () => {
        this.setDelivery({ state: 'shown', at: Date.now() })
        log.info('notification.shown', said)
        done()
      })
      notification.once('failed', (_event, error) => {
        this.setDelivery({ state: 'failed', at: Date.now(), reason: failureReason(error) })
        log.warn('notification.failed', { ...said, err: { message: error } })
        gone()
        done()
      })
      notification.once('click', () => {
        gone()
        log.info('notification.clicked', said)
        this.open(input.target)
      })
      notification.once('action', (details) => {
        gone()
        const action = input.actions?.[details.actionIndex]
        log.info('notification.action', { ...said, action: action?.label })

        Promise.resolve()
          .then(() => action?.run())
          .catch((error: unknown) => log.failed('notification.action-failed', error, said))
      })
      notification.on('close', (details) => {
        // On Windows a toast closes on screen after a few seconds and goes on in the Action
        // Centre: it is still there — to click, to withdraw when it is no longer true —, and
        // nobody dismissed it.
        if (process.platform === 'win32' && details.reason === 'timedOut') {
          return
        }

        // Closed by the user, unread: what it said was not worth it (§14.4).
        if (this.live.has(notification) && !this.withdrawn.has(notification)) {
          log.info('notification.dismissed', said)
        }

        gone()
      })

      try {
        notification.show()
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.setDelivery({ state: 'failed', at: Date.now(), reason: failureReason(reason) })
        log.warn('notification.failed', { ...said, err: error })
        gone()
        done()
      }
    })
  }

  /** Brings the window forward, and the page opens where the notification leads. */
  private open(target: NotificationTarget): void {
    const window = this.deps.window()

    if (!window || window.isDestroyed()) {
      return
    }

    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    } else {
      app.focus()
    }

    if (window.isMinimized()) {
      window.restore()
    }

    if (!window.isVisible()) {
      window.show()
    }

    window.focus()

    if (target.kind === 'window') {
      return
    }

    const send = (): void => window.webContents.send(NOTIFICATIONS_IPC.open, target)

    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', send)
    } else {
      send()
    }
  }

  private setDelivery(delivery: NotificationDelivery): void {
    this.delivery = delivery
    this.deps.onStatusChange(this.status())
  }
}

/**
 * Why the system turned a notification down, in the user's words where it
 * is one of the known reasons: macOS's UNErrorCodeNotificationsNotAllowed,
 * the settings Windows reports.
 */
function failureReason(error: string): string {
  if (/UNErrorDomain error 1\b/.test(error)) {
    return messages(MESSAGES).macNotAllowed
  }

  if (/Settings prevent the notification/i.test(error)) {
    return messages(MESSAGES).windowsNotAllowed
  }

  return error
}
