import { app, BrowserWindow, Notification } from 'electron'

import { logMainError } from '@main/utils/error-utils'
import { folderRole } from '@shared/folders'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type MailFolder,
  type MailMessageSummary,
  type MessageRef,
  type NotificationDelivery,
  type NotificationPreferences,
  type NotificationStatus
} from '@shared/models'

const NOTIFICATION_PREVIEW_MAX_LENGTH = 180
const NOTIFICATION_SUBJECT_MAX_LENGTH = 80
const NOTIFICATION_COALESCE_WINDOW_MS = 1500
const NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000
/** Senders a notification of several messages names before "e altri N". */
const NAMED_SENDERS = 2
/** How long a test notification is given to be shown or turned down. */
const TEST_SETTLE_MS = 4_000

/** The buttons of a single message's notification, in their order. */
const MESSAGE_ACTIONS = ['Segna come letta', 'Archivia'] as const

/** What a notification's buttons do, on the message it announces. */
export interface NotificationMessageActions {
  markRead: (ref: MessageRef) => Promise<unknown>
  archive: (ref: MessageRef) => Promise<unknown>
}

export interface NotificationAccount {
  id: string
  email: string
}

/**
 * Why the system turned a notification down, in the user's words where it
 * is one of the known reasons: macOS's UNErrorCodeNotificationsNotAllowed,
 * the settings Windows reports.
 */
function failureReason(error: string): string {
  if (/UNErrorDomain error 1\b/.test(error)) {
    return 'Le notifiche di SIEVER Mail non sono consentite in Impostazioni di Sistema › Notifiche.'
  }

  if (/Settings prevent the notification/i.test(error)) {
    return 'Le impostazioni di Windows non consentono le notifiche di SIEVER Mail.'
  }

  return error
}

function messageKey(ref: MessageRef): string {
  return `${ref.accountId}:${ref.folderPath}:${ref.uid}`
}

function trimText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function senderLabel(message: MailMessageSummary): string {
  return message.senderLabel || 'Mittente sconosciuto'
}

/** "Mario Rossi, Anna Bianchi e altri 3": the people a batch is from, each once. */
function senderList(messages: ReadonlyArray<MailMessageSummary>): string {
  const senders = [...new Set([...messages].reverse().map(senderLabel))]
  const named = senders.slice(0, NAMED_SENDERS).join(', ')
  const others = senders.length - NAMED_SENDERS

  return others <= 0 ? named : `${named} e ${others === 1 ? 'un altro' : `altri ${others}`}`
}

interface PendingBatch {
  timer: NodeJS.Timeout
  account: NotificationAccount
  messages: MailMessageSummary[]
}

interface ShownNotification {
  notification: Notification
  /** The messages it announces that are still unread where they arrived. */
  keys: Set<string>
}

/**
 * The desktop alerts for new mail, as Apple Mail and Outlook give them.
 *
 *   • Only Posta in arrivo, only unread messages, only accounts not muted —
 *     archived, sent, spam and the folders the user files into never alert,
 *     nor does a message read elsewhere before it arrived here.
 *   • One message: its sender, subject and first lines (or, with the
 *     preview off, only that mail arrived), and two buttons — "Segna come
 *     letta" and "Archivia". Several arriving together: one alert naming
 *     who they are from. A click opens the message.
 *   • An alert goes away by itself once its messages are read, moved or
 *     deleted — here or on another device.
 *
 * What became of the last one shown is kept (`status`): no system says
 * beforehand whether it will show the app's notifications, but macOS and
 * Windows report the one they turned down.
 */
export class NotificationManager {
  private preferences: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES
  private delivery: NotificationDelivery = { state: 'unknown' }
  private readonly emittedKeys = new Map<string, number>()
  private readonly pendingByAccount = new Map<string, PendingBatch>()
  /** Notifications on screen or in the notification centre, by id. */
  private readonly shown = new Map<string, ShownNotification>()
  /** The notification announcing each message, by message key. */
  private readonly shownIdByMessage = new Map<string, string>()
  /** Every notification still to be clicked or dismissed: held, or its handlers go with it. */
  private readonly live = new Set<Notification>()

  constructor(
    private readonly deps: {
      actions: NotificationMessageActions
      onStatusChange: (status: NotificationStatus) => void
    }
  ) {}

  setPreferences(preferences: NotificationPreferences): void {
    this.preferences = preferences

    // Turned off, or an account muted: what it announced goes too.
    for (const [accountId, batch] of this.pendingByAccount) {
      if (!this.announces(accountId)) {
        clearTimeout(batch.timer)
        this.pendingByAccount.delete(accountId)
      }
    }
  }

  status(): NotificationStatus {
    return {
      supported: Notification.isSupported(),
      delivery: this.delivery,
      canOpenSystemSettings: process.platform === 'darwin' || process.platform === 'win32'
    }
  }

  private announces(accountId: string): boolean {
    return this.preferences.enabled && !this.preferences.mutedAccountIds.includes(accountId)
  }

  /**
   * Messages that came into a folder. `bootstrap` is true for a folder's
   * first sync — the account just connected, or its cache cleared — whose
   * messages were already there, and are only remembered as seen.
   */
  enqueue(
    account: NotificationAccount,
    messages: ReadonlyArray<MailMessageSummary>,
    folder: MailFolder | null,
    bootstrap: boolean
  ): void {
    if (!Notification.isSupported() || !folder || folderRole(folder) !== '\\Inbox') {
      return
    }

    const now = Date.now()
    const existing = this.pendingByAccount.get(account.id)
    const batch = existing?.messages ?? []

    for (const message of messages) {
      const key = messageKey(message)
      const emittedAt = this.emittedKeys.get(key)

      if (emittedAt !== undefined && now - emittedAt < NOTIFICATION_DEDUPE_TTL_MS) {
        continue
      }

      this.emittedKeys.set(key, now)

      if (!bootstrap && !message.isRead && this.announces(account.id)) {
        batch.push(message)
      }
    }

    this.pruneEmittedKeys(now)

    if (batch.length === 0) {
      return
    }

    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      this.pendingByAccount.delete(account.id)
      this.announce(account, batch)
    }, NOTIFICATION_COALESCE_WINDOW_MS)

    this.pendingByAccount.set(account.id, { timer, account, messages: batch })
  }

  /**
   * Messages read, moved or deleted, here or elsewhere: an alert that
   * announced only such messages is taken away.
   */
  withdraw(refs: ReadonlyArray<MessageRef>): void {
    for (const ref of refs) {
      const key = messageKey(ref)
      const pending = this.pendingByAccount.get(ref.accountId)

      if (pending) {
        pending.messages = pending.messages.filter((message) => messageKey(message) !== key)
      }

      const id = this.shownIdByMessage.get(key)
      const shown = id === undefined ? undefined : this.shown.get(id)
      this.shownIdByMessage.delete(key)

      if (shown && id !== undefined) {
        shown.keys.delete(key)

        if (shown.keys.size === 0) {
          this.shown.delete(id)
          shown.notification.close()
        }
      }
    }
  }

  /** A notification that says notifications work — or lets the system say they do not. */
  async showTest(): Promise<NotificationStatus> {
    if (!Notification.isSupported()) {
      return this.status()
    }

    await this.present(
      new Notification({
        title: 'Le notifiche funzionano',
        body: 'I nuovi messaggi in Posta in arrivo compariranno così.',
        silent: !this.preferences.sound
      }),
      { onClick: () => this.restoreWindow() },
      TEST_SETTLE_MS
    )

    return this.status()
  }

  /** A word from the app — the first account connected — asked for in its own right. */
  showNotice(title: string, body: string): void {
    if (Notification.isSupported() && this.preferences.enabled) {
      void this.present(new Notification({ title, body, silent: true }), {
        onClick: () => this.restoreWindow()
      })
    }
  }

  private announce(account: NotificationAccount, batch: MailMessageSummary[]): void {
    const messages = batch.filter((message) => !message.isRead)
    const latest = messages.at(-1)

    if (!latest || !this.announces(account.id)) {
      return
    }

    const single = messages.length === 1
    const { showPreview, sound } = this.preferences
    const subject = trimText(latest.subject || '(nessun oggetto)', NOTIFICATION_SUBJECT_MAX_LENGTH)
    const preview = trimText(latest.preview, NOTIFICATION_PREVIEW_MAX_LENGTH)
    // Only macOS shows a subtitle: elsewhere the subject opens the body.
    const hasSubtitle = process.platform === 'darwin'
    const id = single ? messageKey(latest) : `${account.id}:batch:${Date.now()}`

    const content = showPreview
      ? single
        ? {
            title: senderLabel(latest),
            subtitle: hasSubtitle ? subject : undefined,
            body: hasSubtitle ? preview : [subject, preview].filter(Boolean).join('\n')
          }
        : {
            title: `${messages.length} nuove email`,
            subtitle: hasSubtitle ? account.email : undefined,
            body: hasSubtitle
              ? `Da ${senderList(messages)}`
              : `${account.email}\nDa ${senderList(messages)}`
          }
      : {
          title: single ? 'Nuova email' : `${messages.length} nuove email`,
          body: account.email
        }

    const notification = new Notification({
      id,
      groupId: account.id,
      groupTitle: account.email,
      ...content,
      silent: !sound,
      actions: single
        ? MESSAGE_ACTIONS.map((text) => ({ type: 'button' as const, text }))
        : undefined
    })

    const keys = new Set(messages.map(messageKey))
    this.shown.set(id, { notification, keys })

    for (const key of keys) {
      this.shownIdByMessage.set(key, id)
    }

    void this.present(notification, {
      onClick: () => this.restoreWindow(latest),
      onAction: (index) => void this.runAction(index, latest),
      onGone: () => {
        if (this.shown.get(id)?.notification === notification) {
          this.shown.delete(id)

          for (const key of keys) {
            if (this.shownIdByMessage.get(key) === id) {
              this.shownIdByMessage.delete(key)
            }
          }
        }
      }
    })
  }

  /**
   * Shows `notification` and wires it: a click, a button, its going away.
   * Resolves once the system has shown it or turned it down — or after
   * `settleMs`, when it says neither.
   */
  private present(
    notification: Notification,
    handlers: {
      onClick: () => void
      onAction?: (index: number) => void
      onGone?: () => void
    },
    settleMs = 0
  ): Promise<void> {
    return new Promise((resolve) => {
      const settle = setTimeout(resolve, settleMs)
      const done = (): void => {
        clearTimeout(settle)
        resolve()
      }
      const gone = (): void => {
        this.live.delete(notification)
        handlers.onGone?.()
      }
      const failed = (error: string): void => {
        this.setDelivery({ state: 'failed', at: Date.now(), reason: failureReason(error) })
        logMainError('Desktop notification failed', new Error(error))
        gone()
        done()
      }

      this.live.add(notification)
      notification.once('show', () => {
        this.setDelivery({ state: 'shown', at: Date.now() })
        done()
      })
      notification.once('failed', (_event, error) => failed(error))
      notification.once('click', () => {
        gone()
        handlers.onClick()
      })
      notification.once('action', (details) => {
        gone()
        handlers.onAction?.(details.actionIndex)
      })
      notification.once('close', gone)

      try {
        notification.show()
      } catch (error) {
        failed(error instanceof Error ? error.message : String(error))
      }
    })
  }

  private async runAction(index: number, message: MailMessageSummary): Promise<void> {
    const ref: MessageRef = {
      accountId: message.accountId,
      folderPath: message.folderPath,
      uid: message.uid
    }

    try {
      await (index === 0 ? this.deps.actions.markRead(ref) : this.deps.actions.archive(ref))
    } catch (error) {
      logMainError('Notification action failed', error, { action: MESSAGE_ACTIONS[index] })
    }
  }

  private setDelivery(delivery: NotificationDelivery): void {
    this.delivery = delivery
    this.deps.onStatusChange(this.status())
  }

  private pruneEmittedKeys(now: number): void {
    if (this.emittedKeys.size < 4096) {
      return
    }

    const cutoff = now - NOTIFICATION_DEDUPE_TTL_MS

    for (const [key, at] of this.emittedKeys) {
      if (at < cutoff) {
        this.emittedKeys.delete(key)
      }
    }
  }

  /** Brings the window forward — on `message`, when the alert announced one. */
  private restoreWindow(message?: MailMessageSummary): void {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())

    if (!window) {
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

    if (!message) {
      return
    }

    const ref: MessageRef = {
      accountId: message.accountId,
      folderPath: message.folderPath,
      uid: message.uid
    }
    const dispatch = (): void => {
      window.webContents.send(IPC_CHANNELS.openMessageFromNotification, ref)
    }

    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', dispatch)
      return
    }

    dispatch()
  }

  dispose(): void {
    for (const batch of this.pendingByAccount.values()) {
      clearTimeout(batch.timer)
    }

    this.pendingByAccount.clear()
  }
}
