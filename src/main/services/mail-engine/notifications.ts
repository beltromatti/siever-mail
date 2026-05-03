import { app, BrowserWindow, Notification } from 'electron'

import { logMainError } from '@main/utils/error-utils'
import { IPC_CHANNELS } from '@shared/ipc'
import type { MailFolder, MailMessageSummary, MessageRef } from '@shared/models'

const NOTIFICATION_PREVIEW_MAX_LENGTH = 180
const NOTIFICATION_SUBJECT_MAX_LENGTH = 80
const NOTIFICATION_COALESCE_WINDOW_MS = 1500
const NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000

// Notifications are only emitted for the true INBOX of each account, mirroring
// Gmail / Outlook behaviour where archived, sent, drafts, trash, spam and
// custom labels never raise a desktop alert.
function isInboxFolder(folder: MailFolder | null): boolean {
  if (!folder) {
    return false
  }

  if (folder.specialUse?.trim().toLowerCase() === '\\inbox') {
    return true
  }

  return folder.path.trim().toLowerCase() === 'inbox'
}

function makeKey(accountId: string, folderPath: string, uid: number): string {
  return `${accountId}:${folderPath}:${uid}`
}

function trimText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function senderLabel(message: MailMessageSummary): string {
  const sender = message.from[0]

  if (!sender) {
    return 'Nuova email'
  }

  return sender.name || sender.address
}

interface PendingBatch {
  timer: NodeJS.Timeout
  messages: MailMessageSummary[]
}

export class NotificationManager {
  private readonly emittedKeys = new Map<string, number>()
  private readonly pendingByAccount = new Map<string, PendingBatch>()
  private readonly activeNotifications = new Set<Notification>()

  /**
   * Feed the manager with a batch of message-added events for a given folder.
   *
   * `bootstrap` must be true when these UIDs were produced by the first ever sync of
   * that folder (i.e. the account was just connected or its cache was cleared) — in
   * that case we silently record the UIDs as "already seen" so we never spam the user
   * with notifications for emails that pre-existed on the server. Only subsequent,
   * truly new arrivals (IDLE EXISTS or reconnect catch-up while the user was offline)
   * fire real notifications.
   */
  enqueue(
    accountId: string,
    messages: MailMessageSummary[],
    folder: MailFolder | null,
    bootstrap: boolean
  ): void {
    if (!Notification.isSupported() || messages.length === 0) {
      return
    }

    if (!isInboxFolder(folder)) {
      return
    }

    const now = Date.now()

    if (bootstrap) {
      // First-time cache population: mark every UID as seen and skip any toast.
      for (const message of messages) {
        this.emittedKeys.set(makeKey(accountId, message.folderPath, message.uid), now)
      }
      this.pruneEmittedKeys(now)
      return
    }

    const existing = this.pendingByAccount.get(accountId)
    const batch: MailMessageSummary[] = existing?.messages ?? []

    for (const message of messages) {
      const key = makeKey(accountId, message.folderPath, message.uid)
      const emittedAt = this.emittedKeys.get(key)

      if (emittedAt && now - emittedAt < NOTIFICATION_DEDUPE_TTL_MS) {
        continue
      }

      this.emittedKeys.set(key, now)
      batch.push(message)
    }

    if (batch.length === 0) {
      if (existing) {
        clearTimeout(existing.timer)
        this.pendingByAccount.delete(accountId)
      }
      return
    }

    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      this.pendingByAccount.delete(accountId)
      this.flushBatch(accountId, batch)
    }, NOTIFICATION_COALESCE_WINDOW_MS)

    this.pendingByAccount.set(accountId, { timer, messages: batch })
    this.pruneEmittedKeys(now)
  }

  private pruneEmittedKeys(now: number): void {
    if (this.emittedKeys.size < 4096) {
      return
    }

    const cutoff = now - NOTIFICATION_DEDUPE_TTL_MS

    for (const [key, ts] of this.emittedKeys) {
      if (ts < cutoff) {
        this.emittedKeys.delete(key)
      }
    }
  }

  private flushBatch(accountId: string, batch: MailMessageSummary[]): void {
    if (batch.length === 0) {
      return
    }

    const freshest = batch[batch.length - 1]

    if (!freshest) {
      return
    }

    const targetRef: MessageRef = {
      accountId: freshest.accountId,
      folderPath: freshest.folderPath,
      uid: freshest.uid
    }

    const title = batch.length === 1 ? senderLabel(freshest) : `${batch.length} nuove email`
    const subtitle = trimText(freshest.subject, NOTIFICATION_SUBJECT_MAX_LENGTH)
    const body =
      batch.length === 1
        ? trimText(
            freshest.preview || '(Nessuna anteprima disponibile)',
            NOTIFICATION_PREVIEW_MAX_LENGTH
          )
        : `${senderLabel(freshest)}: ${trimText(freshest.preview || '', NOTIFICATION_PREVIEW_MAX_LENGTH)}`

    const notification = new Notification({
      title,
      subtitle,
      body,
      silent: false
    })

    this.activeNotifications.add(notification)
    const release = (): void => {
      this.activeNotifications.delete(notification)
    }

    notification.once('close', release)
    notification.once('click', () => {
      release()
      this.restoreWindowWithMessage(targetRef)
    })

    try {
      notification.show()
    } catch (error) {
      release()
      logMainError('Desktop notification failed', error, {
        accountId,
        folderPath: targetRef.folderPath,
        uid: targetRef.uid
      })
    }
  }

  private restoreWindowWithMessage(ref: MessageRef): void {
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
