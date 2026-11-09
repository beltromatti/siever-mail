import type { MessageRef } from './models'

/**
 * The notifications (vision §13.3): what interrupts the user on the
 * desktop, from every app at par and from the Segretario — only when
 * knowing it now, rather than at the next look, changes what they would
 * do. Everything else waits where they find it.
 */

/** Who a notification comes from: an app, the Segretario, SIEVER Mail itself, an extension. */
export type NotificationFamily = 'mail' | 'calendar' | 'segretario' | 'app' | `ext:${string}`

/** Where a notification takes the user when clicked: the same places a link of the Segretario does. */
export type NotificationTarget =
  | { kind: 'message'; ref: MessageRef }
  | { kind: 'event'; eventKey: string }
  /** The calendar on a day: an event that is gone. */
  | { kind: 'day'; day: string }
  | { kind: 'today' }
  /** A conversation or a run of the Segretario, in its panel. */
  | { kind: 'activity'; activityId: string }
  | { kind: 'draft'; draftId: string }
  | { kind: 'connections' }
  /** The window, as it is: what is to be seen is already there (a notice on it, the setup). */
  | { kind: 'window' }

/** What the number on the app's icon counts. */
export type BadgeCount =
  /** With the AI, what waits for the user today; without, the unread mail of Posta in arrivo. */
  'work' | 'unread' | 'none'

export interface NotificationPreferences {
  /** Notifications on the desktop at all. */
  enabled: boolean
  /** What they say of their content — who writes, the subject, an event's title, the Segretario's words; without, only what kind of thing came. */
  showPreview: boolean
  sound: boolean
  badge: BadgeCount
  mail: {
    /** New mail in Posta in arrivo. */
    enabled: boolean
    /** While the Segretario reads the mail as it comes, only what it says to tell now. */
    onlyFlagged: boolean
    /** Mailboxes whose new mail is not told. */
    mutedAccountIds: string[]
  }
  calendar: {
    /** Before the user's events (§7.4): at the times each sets, and for one that sets none, `defaultLead`. */
    reminders: boolean
    /** Minutes before an event that sets no reminder of its own; null for none. */
    defaultLead: number | null
    /** The novelties of the user's events that someone else has in hand, that do not come by mail. */
    changes: boolean
    /** While the Segretario looks at the calendar as it changes, only what it says to tell now. */
    onlyFlagged: boolean
  }
  segretario: {
    /** It waits for the user — a confirmation — or finished what they asked while they were away. */
    needsYou: boolean
    /** The day's letter, the first time it is ready each morning. */
    day: boolean
  }
}

/** The leads a reminder of SIEVER Mail offers, in minutes; null is none. */
export const REMINDER_LEADS: ReadonlyArray<number | null> = [null, 0, 5, 10, 15, 30, 60]

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  showPreview: true,
  sound: true,
  badge: 'work',
  mail: { enabled: true, onlyFlagged: true, mutedAccountIds: [] },
  calendar: { reminders: true, defaultLead: 10, changes: true, onlyFlagged: true },
  segretario: { needsYou: true, day: true }
}

/**
 * The preferences as stored, whatever release wrote them: what is not
 * there, or not well formed, takes its default. The flat record of the
 * versions before 2.0 — the mail's alone — is carried over as what the
 * user chose then: its switch, the only one, was the mail's, so it turns
 * off the mail's, not the reminders and the Segretario they never had; the
 * icon's count was on or off.
 */
export function notificationPreferencesOf(stored: unknown): NotificationPreferences {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const root = record(stored)
  const flag = (from: Record<string, unknown>, key: string, fallback: boolean): boolean =>
    typeof from[key] === 'boolean' ? (from[key] as boolean) : fallback
  const defaults = DEFAULT_NOTIFICATION_PREFERENCES
  const flat = !('mail' in root)
  const mail = flat ? root : record(root.mail)
  const calendar = record(root.calendar)
  const segretario = record(root.segretario)
  const lead = calendar.defaultLead

  return {
    enabled: flat ? defaults.enabled : flag(root, 'enabled', defaults.enabled),
    showPreview: flag(root, 'showPreview', defaults.showPreview),
    sound: flag(root, 'sound', defaults.sound),
    badge:
      root.badge === 'work' || root.badge === 'unread' || root.badge === 'none'
        ? root.badge
        : root.badge === false
          ? 'none'
          : defaults.badge,
    mail: {
      enabled: flag(mail, 'enabled', defaults.mail.enabled),
      onlyFlagged: flag(mail, flat ? 'onlyImportant' : 'onlyFlagged', defaults.mail.onlyFlagged),
      mutedAccountIds: Array.isArray(mail.mutedAccountIds)
        ? [
            ...new Set(
              mail.mutedAccountIds.filter(
                (id): id is string => typeof id === 'string' && id.length > 0
              )
            )
          ]
        : []
    },
    calendar: {
      reminders: flag(calendar, 'reminders', defaults.calendar.reminders),
      defaultLead:
        lead === null || (typeof lead === 'number' && REMINDER_LEADS.includes(lead))
          ? (lead as number | null)
          : defaults.calendar.defaultLead,
      changes: flag(calendar, 'changes', defaults.calendar.changes),
      onlyFlagged: flag(calendar, 'onlyFlagged', defaults.calendar.onlyFlagged)
    },
    segretario: {
      needsYou: flag(segretario, 'needsYou', defaults.segretario.needsYou),
      day: flag(segretario, 'day', defaults.segretario.day)
    }
  }
}

/**
 * Whether the system shows the app's notifications, as far as the app can
 * tell: no system says beforehand, so it is what became of the last one.
 */
export type NotificationDelivery =
  | { state: 'unknown' }
  | { state: 'shown'; at: number }
  | { state: 'failed'; at: number; reason: string }

export interface NotificationStatus {
  supported: boolean
  delivery: NotificationDelivery
  /** Whether the system has a page where the user allows the app's notifications. */
  canOpenSystemSettings: boolean
}

export const NOTIFICATIONS_IPC = {
  getPreferences: 'notifications:get-preferences',
  setPreferences: 'notifications:set-preferences',
  getStatus: 'notifications:get-status',
  statusChanged: 'notifications:status-changed',
  showTest: 'notifications:show-test',
  openSystemSettings: 'notifications:open-system-settings',
  /** A notification was clicked: the page opens where it leads. */
  open: 'notifications:open',
  /** The number on the icon changed: on Windows the page draws it (`setBadgeImage`). */
  badgeChanged: 'notifications:badge-changed',
  setBadgeImage: 'notifications:set-badge-image'
} as const

/** The number on the app's icon, and what it counts in words — for who cannot see it. */
export interface BadgeShown {
  count: number
  description: string
}

/** The page's side: `window.notificationsApi`. */
export interface NotificationsApi {
  getPreferences: () => Promise<NotificationPreferences>
  setPreferences: (preferences: NotificationPreferences) => Promise<NotificationPreferences>
  getStatus: () => Promise<NotificationStatus>
  onStatusChanged: (listener: (status: NotificationStatus) => void) => () => void
  /** A notification that says notifications work — or lets the system say they do not. */
  showTest: () => Promise<NotificationStatus>
  openSystemSettings: () => Promise<void>
  onOpen: (listener: (target: NotificationTarget) => void) => () => void
  /**
   * Windows draws no number on a taskbar button: the page draws the badge
   * it is told, and hands the picture back (null: no badge).
   */
  onBadgeChanged: (listener: (badge: BadgeShown) => void) => () => void
  setBadgeImage: (dataUrl: string | null, description: string) => Promise<void>
}
