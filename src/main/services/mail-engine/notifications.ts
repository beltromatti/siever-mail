import { Notification } from 'electron'

import type { NotificationCenter, NotificationInput } from '@main/notifications/center'
import { folderRole } from '@shared/folders'
import type { MailFolder, MailMessageSummary, MessageRef } from '@shared/models'

/** The longest a new message waits for its reading before it is told as it is. */
const READING_WAIT_MS = 10 * 60 * 1000
/** Messages arriving together are told together. */
const COALESCE_MS = 1_500
/** The mail come while the app was closed arrives in bursts: told together once it stops. */
const CATCH_UP_SETTLE_MS = 20_000
const PREVIEW_MAX_LENGTH = 180
const SUBJECT_MAX_LENGTH = 80
const DEDUPE_TTL_MS = 10 * 60 * 1000
/** A copy of a message told is not told again so long after: past any wait for its reading. */
const COPY_TTL_MS = 60 * 60 * 1000
/** Senders a notification of several messages names before "e altri N". */
const NAMED_SENDERS = 2

/** What a notification's buttons do, on the message it tells. */
export interface NotificationMessageActions {
  markRead: (ref: MessageRef) => Promise<unknown>
  archive: (ref: MessageRef) => Promise<unknown>
}

export interface NotificationAccount {
  id: string
  email: string
}

function refOf(message: Pick<MailMessageSummary, 'accountId' | 'folderPath' | 'uid'>): MessageRef {
  return { accountId: message.accountId, folderPath: message.folderPath, uid: message.uid }
}

function messageKey(ref: MessageRef): string {
  return `${ref.accountId}:${ref.folderPath}:${ref.uid}`
}

/** The notification telling one message alone: another for it takes its place. */
function singleKey(ref: MessageRef): string {
  return `mail:${messageKey(ref)}`
}

/**
 * What a message's copies in other mailboxes say the same — its
 * Message-ID, who sent it, what about, when (§6.1: two messages may share a
 * Message-ID) —: told in one, it is not told again.
 */
function copyKey(message: MailMessageSummary): string {
  return [message.messageId ?? '', message.senderKey, message.subject, message.date].join('\u0000')
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

/** A message told, with what the Segretario wrote of it when it said to tell it. */
interface Told {
  message: MailMessageSummary
  summary?: string
}

interface Batch {
  timer: NodeJS.Timeout
  account: NotificationAccount
  told: Told[]
}

interface Held {
  timer: NodeJS.Timeout
  account: NotificationAccount
  message: MailMessageSummary
  /** Come while the app was closed: told as it is, it goes with the others of its mailbox. */
  catchUp: boolean
}

/**
 * The notifications of new mail (vision §13.3), given through the app's
 * notification centre.
 *
 *   • Only Posta in arrivo, only unread messages, only mailboxes not
 *     muted — archived, sent, spam and the folders the user files into
 *     never alert, nor does a message read elsewhere before it arrived.
 *   • While the Segretario reads the mail as it comes, and the user asked
 *     for it, a new message waits for its reading and is told only if the
 *     Segretario said to tell it now (`avvisa`), with its words — one by
 *     one, at launch too: they are few, and each is told for its line.
 *     One its reading has not reached in ten minutes is told as it is, and
 *     takes the Segretario's line in its place if it comes after.
 *     Without the Segretario, or the user wanting every message, every
 *     message is told, as mail apps tell it.
 *   • One message: its sender, subject and first lines, and two buttons —
 *     "Segna come letta" and "Archivia". Several together: one
 *     notification naming who they are from. What came while the app was
 *     closed and is told as it is: one notification per mailbox, once it
 *     has all arrived — not a hundred.
 *   • A notification goes away by itself once its messages are read, moved
 *     or deleted — here or on another device.
 */
export class MailNotifications {
  private readonly launchedAt = Date.now()
  private readonly emittedKeys = new Map<string, number>()
  /** The messages told lately, by what their copies share (`copyKey`): when. */
  private readonly toldCopies = new Map<string, number>()
  private readonly batches = new Map<string, Batch>()
  /** The notification telling each message, by message key. */
  private readonly keyByMessage = new Map<string, string>()
  /** The messages each notification tells that are still unread, by notification key. */
  private readonly messagesByKey = new Map<string, Set<string>>()
  /**
   * Whether the Segretario reads new mail as it comes (see
   * `setSegretarioReading`); null until it says, at launch: what a launch
   * finds waits to know, rather than be told unsifted.
   */
  private segretarioReading: boolean | null = null
  /** New messages waiting for their reading, by account and message key. */
  private readonly held = new Map<string, Held>()
  /**
   * Told as they were, their reading late, by account and message key: the
   * Segretario's line, if it comes, takes their place — until they are read.
   */
  private readonly late = new Map<
    string,
    { account: NotificationAccount; message: MailMessageSummary }
  >()
  private readonly unsubscribe: () => void

  constructor(
    private readonly deps: {
      center: NotificationCenter
      actions: NotificationMessageActions
    }
  ) {
    // Turned off, or a mailbox muted: what waits for it goes too.
    this.unsubscribe = deps.center.onPreferences(() => {
      for (const [accountId, batch] of this.batches) {
        if (!this.tells(accountId)) {
          clearTimeout(batch.timer)
          this.batches.delete(accountId)
        }
      }

      if (!this.waitsForReading()) {
        this.releaseHeld()
      }
    })
  }

  /**
   * Whether the Segretario reads new mail as it comes: while it does, a new
   * message waits for its reading. When it stops — the key fails, the AI goes
   * off — what was waiting is told as it is.
   */
  setSegretarioReading(reading: boolean): void {
    this.segretarioReading = reading

    if (!this.waitsForReading()) {
      this.releaseHeld()
    }
  }

  /**
   * Messages read (§4.1) — their reading over, or a copy of one read in
   * another mailbox —: a new one still waiting is not told; what the
   * Segretario said to tell was told already (`alert`).
   */
  read(accountId: string, messageKeys: ReadonlyArray<string>): void {
    for (const messageKey of messageKeys) {
      const key = `${accountId}\u0000${messageKey}`
      const held = this.held.get(key)
      // Told late as it was: no line comes now in its place.
      this.late.delete(key)

      if (held) {
        clearTimeout(held.timer)
        this.held.delete(key)
      }
    }
  }

  /**
   * What the Segretario says of a message that came (`avvisa`, §13.3): told
   * now, on its own, with its line — in place of the notification told as it
   * was, if its reading came late. `off` when the user does not take its
   * word — the mail's notifications off, this mailbox muted, every message
   * wanted as it is —; `not-new` for one that waits for no notification:
   * opened already, come to another folder, or long ago.
   */
  alert(accountId: string, keyOfMessage: string, line: string): 'told' | 'off' | 'not-new' {
    if (!this.tells(accountId) || !this.waitsForReading()) {
      return 'off'
    }

    const key = `${accountId}\u0000${keyOfMessage}`
    const held = this.held.get(key)

    if (held) {
      clearTimeout(held.timer)
      this.held.delete(key)

      if (!held.message.isRead) {
        this.tell(held.account, [{ message: held.message, summary: line }])
      }

      return 'told'
    }

    const late = this.late.get(key)

    if (late) {
      this.late.delete(key)

      if (!late.message.isRead) {
        // In place of its own notification; one of several keeps the others. Not shown — its copy
        // told elsewhere —, told as anything new, so the copy keeps it from being told twice.
        const shown = this.keyByMessage.get(messageKey(late.message))

        if (shown !== undefined && shown !== singleKey(late.message)) {
          this.untell(shown, messageKey(late.message))
        }

        this.tell(late.account, [{ message: late.message, summary: line }], shown !== undefined)
      }

      return 'told'
    }

    return 'not-new'
  }

  /**
   * Messages that came into a folder. `bootstrap` is true for a folder's
   * first sync — the mailbox just connected, or its cache cleared — whose
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

    for (const message of messages) {
      const key = messageKey(message)
      const emittedAt = this.emittedKeys.get(key)

      if (emittedAt !== undefined && now - emittedAt < DEDUPE_TTL_MS) {
        continue
      }

      this.emittedKeys.set(key, now)

      if (bootstrap || message.isRead || !this.tells(account.id)) {
        continue
      }

      // Come while the app was closed: what a launch finds, told with the rest of its mailbox.
      const catchUp = Date.parse(message.date) < this.launchedAt

      if (this.waitsForReading()) {
        this.hold(account, message, catchUp)
      } else {
        this.addToBatch(account, { message }, catchUp ? CATCH_UP_SETTLE_MS : COALESCE_MS)
      }
    }

    this.pruneEmittedKeys(now)
  }

  /**
   * Messages read, moved or deleted, here or elsewhere: a notification that
   * told only such messages is taken away, and one waiting is not given.
   */
  withdraw(refs: ReadonlyArray<MessageRef>): void {
    const gone = new Set(refs.map(messageKey))

    for (const batch of this.batches.values()) {
      batch.told = batch.told.filter((told) => !gone.has(messageKey(told.message)))
    }

    for (const [key, held] of this.held) {
      if (gone.has(messageKey(held.message))) {
        clearTimeout(held.timer)
        this.held.delete(key)
      }
    }

    for (const [key, late] of this.late) {
      if (gone.has(messageKey(late.message))) {
        this.late.delete(key)
      }
    }

    for (const key of gone) {
      const notificationKey = this.keyByMessage.get(key)

      if (notificationKey !== undefined) {
        this.untell(notificationKey, key)
      }
    }
  }

  dispose(): void {
    this.unsubscribe()

    for (const batch of this.batches.values()) {
      clearTimeout(batch.timer)
    }

    this.batches.clear()

    for (const held of this.held.values()) {
      clearTimeout(held.timer)
    }

    this.held.clear()
    this.late.clear()
  }

  /** A message no longer told by a notification: taken away once it tells none. */
  private untell(notificationKey: string, message: string): void {
    this.keyByMessage.delete(message)
    const remaining = this.messagesByKey.get(notificationKey)
    remaining?.delete(message)

    if (!remaining || remaining.size === 0) {
      this.messagesByKey.delete(notificationKey)
      this.deps.center.withdraw(notificationKey)
    }
  }

  private tells(accountId: string): boolean {
    const { enabled, mail } = this.deps.center.preferences
    return enabled && mail.enabled && !mail.mutedAccountIds.includes(accountId)
  }

  private waitsForReading(): boolean {
    return this.deps.center.preferences.mail.onlyFlagged && this.segretarioReading !== false
  }

  /** A new message waits for its reading — at most `READING_WAIT_MS`, then it is told as it is. */
  private hold(account: NotificationAccount, message: MailMessageSummary, catchUp: boolean): void {
    const key = `${account.id}\u0000${message.messageKey}`

    if (this.held.has(key)) {
      return
    }

    const timer = setTimeout(() => {
      const held = this.held.get(key)
      this.held.delete(key)

      if (held && !held.message.isRead) {
        this.late.set(key, { account: held.account, message: held.message })
        this.tellAsItIs(held)
      }
    }, READING_WAIT_MS)

    this.held.set(key, { timer, account, message, catchUp })
  }

  /**
   * A new message its reading did not reach in time is told as it is — come
   * while the app was closed, with the rest of its mailbox.
   */
  private tellAsItIs(held: Held): void {
    if (!this.tells(held.account.id)) {
      return
    }

    if (held.catchUp) {
      this.addToBatch(held.account, { message: held.message }, CATCH_UP_SETTLE_MS)
      return
    }

    this.tell(held.account, [{ message: held.message }])
  }

  /**
   * What waited for its reading is told as it is, as if nothing had been
   * waited for: together by mailbox, what came while the app was closed once
   * the rest of it has come too.
   */
  private releaseHeld(): void {
    const held = [...this.held.values()]
    this.held.clear()

    for (const { timer, account, message, catchUp } of held) {
      clearTimeout(timer)

      if (this.tells(account.id)) {
        this.addToBatch(account, { message }, catchUp ? CATCH_UP_SETTLE_MS : COALESCE_MS)
      }
    }
  }

  private addToBatch(account: NotificationAccount, told: Told, settleMs: number): void {
    const existing = this.batches.get(account.id)

    if (existing) {
      clearTimeout(existing.timer)
    }

    const batch: Batch = {
      account,
      told: [...(existing?.told ?? []), told],
      timer: setTimeout(() => {
        this.batches.delete(account.id)
        this.tell(account, batch.told)
      }, settleMs)
    }
    this.batches.set(account.id, batch)
  }

  /**
   * One notification for what came: a single message by its sender and
   * subject, with its first lines — or, when the Segretario said to tell
   * it, its words. `again`: the same message told before, now with them.
   */
  private tell(account: NotificationAccount, all: ReadonlyArray<Told>, again = false): void {
    const now = Date.now()
    // A copy of a message come to another mailbox too was told there.
    const told = all.filter(({ message }) => {
      const at = this.toldCopies.get(copyKey(message))
      return !message.isRead && (again || at === undefined || now - at >= COPY_TTL_MS)
    })
    const latest = told.at(-1)

    if (!latest) {
      return
    }

    const messages = told.map(({ message }) => message)
    const single = told.length === 1
    const flagged = told.some(({ summary }) => summary !== undefined)
    const key = single ? singleKey(latest.message) : `mail:${account.id}:batch:${now}`
    const subject = trimText(latest.message.subject || '(nessun oggetto)', SUBJECT_MAX_LENGTH)
    const input: NotificationInput = single
      ? {
          family: 'mail',
          kind: flagged ? 'mail.flagged' : 'mail.new',
          key,
          title: senderLabel(latest.message),
          subtitle: subject,
          body: trimText(latest.summary ?? latest.message.preview, PREVIEW_MAX_LENGTH),
          concealed: { title: 'Nuova email', body: account.email },
          target: { kind: 'message', ref: refOf(latest.message) },
          actions: [
            {
              label: 'Segna come letta',
              run: () => this.deps.actions.markRead(refOf(latest.message))
            },
            { label: 'Archivia', run: () => this.deps.actions.archive(refOf(latest.message)) }
          ],
          when: 'always',
          group: { id: account.id, title: account.email }
        }
      : // Several, told as they are: what the Segretario says to tell goes one by one (`settle`).
        {
          family: 'mail',
          kind: 'mail.batch',
          key,
          title: `${told.length} nuove email`,
          subtitle: account.email,
          body: `Da ${senderList(messages)}`,
          concealed: { title: `${told.length} nuove email`, body: account.email },
          target: { kind: 'message', ref: refOf(latest.message) },
          when: 'always',
          group: { id: account.id, title: account.email }
        }

    if (!this.deps.center.notify(input)) {
      return
    }

    for (const message of messages) {
      this.toldCopies.set(copyKey(message), now)
    }

    const keys = new Set(messages.map(messageKey))
    this.messagesByKey.set(key, keys)

    for (const message of keys) {
      this.keyByMessage.set(message, key)
    }
  }

  private pruneEmittedKeys(now: number): void {
    for (const [seen, ttl] of [
      [this.emittedKeys, DEDUPE_TTL_MS],
      [this.toldCopies, COPY_TTL_MS]
    ] as const) {
      if (seen.size < 4096) {
        continue
      }

      for (const [key, at] of seen) {
        if (at < now - ttl) {
          seen.delete(key)
        }
      }
    }
  }
}
