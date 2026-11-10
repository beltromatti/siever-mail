import { diagnostics } from '@main/diagnostics/log'
import type { NotificationCenter } from '@main/notifications/center'
import type { CalendarEvent } from '@shared/calendar'
import type { NotificationTarget } from '@shared/notifications'

import { remindersOf, startWords, whenWords, type RemindedEvent, type Reminder } from './reminders'

const log = diagnostics('calendar')

/** How far ahead the events are read to find their reminders: the furthest a calendar sets one, four weeks. */
const LOOK_AHEAD_MS = 29 * 24 * 3_600_000
/** A reminder missed while the app was closed or the computer asleep is given late, this late at most. */
const LATE_MS = 12 * 3_600_000
/** Reminders are planned again at least this often: the clock, a calendar, anything may have moved. */
const REPLAN_MS = 60 * 60_000
/** Changes to the events come in bursts, as a sync goes: planned again once they stop. */
const SETTLE_MS = 2_000
/** «Fra 5 minuti»: the reminder again, so much later. */
const SNOOZE_MS = 5 * 60_000
/** A reminder due as its event starts is still given just after: the timer is never to the millisecond. */
const STARTED_GRACE_MS = 2 * 60_000
/** A plan that failed — the database busy — is tried again so much later: the reminders never stop. */
const RETRY_MS = 5 * 60_000
/** Changes by others told one by one; more at once are told together. */
const CHANGES_ONE_BY_ONE = 2
/** A novelty waits for the Segretario's look at the calendar so long at most, then is told as it is. */
const LOOK_WAIT_MS = 10 * 60_000

const REMINDER_PREFIX = 'calendar:reminder:'

/** A novelty of an event of the user's that someone else has in hand, as the sync found it (`CalendarService`). */
export interface ChangeByOthers {
  kind: 'nuovo' | 'cambiato' | 'annullato'
  /** The event now — as it was, when it is gone. */
  event: CalendarEvent & { startsAt: number; endsAt: number }
  before: (CalendarEvent & { startsAt: number; endsAt: number }) | null
  /** Who has it in hand, by address: whoever invites the user, or whoever put it there. */
  by: string | null
  /** The times of a series it stands for — its own the first —; 1 for an event alone. */
  instances: number
}

/**
 * The calendar's notifications (vision §13.3): the reminders before the
 * user's events (§7.4); the novelties of those that someone else has in
 * hand and that do not come by mail — with the Segretario looking at the
 * calendar, what it says to tell, and what it has not looked at in ten
 * minutes as it is —; and what the Segretario says of an event that cannot
 * wait. All through the app's notification centre.
 */
export class CalendarNotifications {
  private timer: NodeJS.Timeout | null = null
  private settleTimer: NodeJS.Timeout | null = null
  private planning: Promise<void> | null = null
  private planAgain = false
  /** Reminders put off with «Fra 5 minuti», by event key: when they are due. */
  private readonly snoozed = new Map<string, number>()
  /** The reminders on screen, by notification key: their event as it was reminded of. */
  private readonly shown = new Map<string, { eventKey: string; startsAt: number; endsAt: number }>()
  /** Novelties waiting for the Segretario's look at the calendar. */
  private readonly waiting = new Set<NodeJS.Timeout>()
  private unsubscribe: (() => void) | null = null
  private stopped = false

  constructor(
    private readonly deps: {
      center: NotificationCenter
      /** The events that may remind: in a calendar the user shows, not declined, from `from` to `to`. */
      events: (from: number, to: number) => Promise<RemindedEvent[]>
      /** The Segretario's preparation for an event, in a line; null with none, or the AI off. */
      preparation: (eventKey: string) => Promise<string | null>
      /** Whether the Segretario looks at the calendar as it changes: then it says what to tell. */
      segretarioLooking: () => boolean
      /** The last change of the calendar the Segretario's looks have seen; null when none is known. */
      segretarioSeen: () => Promise<number | null>
      openExternal: (url: string) => void
    }
  ) {}

  start(): void {
    this.stopped = false
    this.unsubscribe = this.deps.center.onPreferences(() => this.plan())
    this.plan()
  }

  stop(): void {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null

    for (const timer of [this.timer, this.settleTimer, ...this.waiting]) {
      if (timer) {
        clearTimeout(timer)
      }
    }

    this.waiting.clear()
    this.timer = null
    this.settleTimer = null
  }

  /** The events changed — a sync, a write —: the reminders are planned again once it settles. */
  eventsChanged(): void {
    if (this.stopped) {
      return
    }

    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
    }

    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.plan()
    }, SETTLE_MS)
  }

  /** Awake again: what came due while asleep is given, if its event is still to come. */
  woke(): void {
    this.plan()
  }

  /**
   * Novelties of the user's events that someone else has in hand: each
   * told — several at once, together. With the Segretario looking at the
   * calendar, and the user asking only for what it says, it looks first:
   * what it says to tell, it tells (`segretarioAlert`); what its looks have
   * not reached in ten minutes — `through`, the change noted last — is told
   * as it is.
   */
  changedByOthers(calendar: string, changes: ReadonlyArray<ChangeByOthers>, through: number): void {
    const { enabled, calendar: preferences } = this.deps.center.preferences

    if (!enabled || !preferences.changes || changes.length === 0) {
      return
    }

    if (!preferences.onlyFlagged || !this.deps.segretarioLooking()) {
      this.tellChanges(calendar, changes)
      return
    }

    const timer = setTimeout(() => {
      this.waiting.delete(timer)
      void this.deps
        .segretarioSeen()
        .catch(() => null)
        .then((seen) => {
          if (!this.stopped && (seen === null || seen < through)) {
            log.info('changes.unlooked', { changes: changes.length })
            this.tellChanges(
              calendar,
              changes.filter((change) => change.event.endsAt > Date.now())
            )
          }
        })
    }, LOOK_WAIT_MS)
    this.waiting.add(timer)
  }

  private tellChanges(calendar: string, changes: ReadonlyArray<ChangeByOthers>): void {
    const { enabled, calendar: preferences } = this.deps.center.preferences

    if (!enabled || !preferences.changes || changes.length === 0) {
      return
    }

    const now = Date.now()
    // Where a change opens: the event, or — gone — its day.
    const targetOf = (change: ChangeByOthers): NotificationTarget =>
      change.kind === 'annullato'
        ? { kind: 'day', day: new Date(change.event.startsAt).toISOString() }
        : { kind: 'event', eventKey: change.event.key }

    if (changes.length > CHANGES_ONE_BY_ONE) {
      this.deps.center.notify({
        family: 'calendar',
        kind: 'calendar.changes',
        key: `calendar:changes:${calendar}:${now}`,
        title: `${changes.length} eventi cambiati`,
        subtitle: calendar,
        body: changes
          .slice(0, 3)
          .map((change) => change.event.title)
          .join(', '),
        concealed: { title: `${changes.length} eventi cambiati`, body: calendar },
        target: targetOf(changes[0]),
        when: 'always'
      })
      return
    }

    for (const change of changes) {
      const { event, before } = change
      const moved =
        before !== null && (before.startsAt !== event.startsAt || before.endsAt !== event.endsAt)
      const title =
        change.kind === 'annullato'
          ? `Annullato: ${event.title}`
          : change.kind === 'nuovo'
            ? `${event.myResponse === 'needsAction' ? 'Invito' : 'Nuovo evento'}: ${event.title}`
            : moved
              ? `Spostato: ${event.title}`
              : `Cambiato il luogo: ${event.title}`
      const body = [
        change.kind === 'cambiato' && before
          ? moved
            ? `Era ${whenWords(before, now)}`
            : `Era ${before.location ?? 'senza luogo'}, ora ${event.location ?? 'senza luogo'}`
          : [change.by ? `Da ${change.by}` : null, event.location].filter(Boolean).join(' · '),
        change.instances > 1 ? `e altre ${change.instances - 1} volte della serie` : null
      ]
        .filter(Boolean)
        .join(' · ')

      this.deps.center.notify({
        family: 'calendar',
        kind: 'calendar.change',
        key: `calendar:change:${event.key}`,
        title,
        subtitle: whenWords(event, now),
        body,
        concealed: { title: 'Calendario', body: 'Un evento è cambiato' },
        target: targetOf(change),
        when: 'always'
      })
    }
  }

  /**
   * What the Segretario said of an event cannot wait for the user's next
   * look — a meeting moved to this morning, one cancelled today —, with its
   * words: in place of the novelty told as it is, if that came first. Only
   * while the user takes its word (`onlyFlagged`): otherwise they have the
   * novelties as they are, as without AI.
   */
  segretarioAlert(
    event: CalendarEvent & { startsAt: number; endsAt: number },
    text: string,
    gone = false
  ): boolean {
    const { enabled, calendar } = this.deps.center.preferences

    if (!enabled || !calendar.changes || !calendar.onlyFlagged) {
      return false
    }

    return this.deps.center.notify({
      family: 'calendar',
      kind: 'calendar.alert',
      key: `calendar:change:${event.key}`,
      title: event.title,
      subtitle: whenWords(event, Date.now()),
      body: text,
      concealed: { title: 'Calendario', body: 'Il Segretario ha qualcosa da dirti su un evento' },
      // An event gone opens on its day: there is nothing else left to open.
      target: gone
        ? { kind: 'day', day: new Date(event.startsAt).toISOString() }
        : { kind: 'event', eventKey: event.key },
      when: 'always'
    })
  }

  /** Plans the reminders again — one plan at a time, the latest asked for always run. */
  private plan(): void {
    if (this.stopped) {
      return
    }

    if (this.planning) {
      this.planAgain = true
      return
    }

    this.planning = this.planNow()
      .catch((error: unknown) => {
        log.failed('reminders.plan-failed', error)

        if (!this.stopped && !this.timer) {
          this.timer = setTimeout(() => this.plan(), RETRY_MS)
        }
      })
      .finally(() => {
        this.planning = null

        if (this.planAgain) {
          this.planAgain = false
          this.plan()
        }
      })
  }

  /**
   * What is due is given — late, if its event is still to come —, what
   * reminded of an event moved, gone or over is taken away, and the next
   * reminder waits on a timer.
   */
  private async planNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const { enabled, calendar } = this.deps.center.preferences

    if (!enabled || !calendar.reminders) {
      this.deps.center.withdrawWhere((key) => key.startsWith(REMINDER_PREFIX))
      this.shown.clear()
      return
    }

    const now = Date.now()
    const events = await this.deps.events(now, now + LOOK_AHEAD_MS)
    const byKey = new Map(events.map((event) => [event.key, event]))

    // A reminder whose event moved, went or is over is no longer true.
    for (const [key, shown] of this.shown) {
      const event = byKey.get(shown.eventKey)

      if (!event || event.startsAt !== shown.startsAt || event.endsAt <= now) {
        this.shown.delete(key)
        this.deps.center.withdraw(key)
      }
    }

    // A reminder put off for an event gone, or begun, has nothing left to remind of.
    for (const [eventKey] of this.snoozed) {
      const event = byKey.get(eventKey)

      if (!event || event.startsAt <= now - STARTED_GRACE_MS) {
        this.snoozed.delete(eventKey)
      }
    }

    const reminders = [
      ...remindersOf(events, calendar.defaultLead),
      ...[...this.snoozed].flatMap(([eventKey, at]): Reminder[] => {
        const event = byKey.get(eventKey)
        return event ? [{ event, at, minutes: 0, key: `snooze:${at}` }] : []
      })
    ].sort((a, b) => a.at - b.at)

    for (const reminder of reminders) {
      if (
        reminder.at > now ||
        reminder.at < now - LATE_MS ||
        reminder.event.startsAt <= now - STARTED_GRACE_MS
      ) {
        continue
      }

      if (reminder.key.startsWith('snooze:')) {
        this.snoozed.delete(reminder.event.key)
      } else if (!(await this.deps.center.giveOnce(`reminder:${reminder.key}`))) {
        continue
      }

      await this.remind(reminder.event)
    }

    const next = reminders.find((reminder) => reminder.at > now)
    const wait = Math.min(REPLAN_MS, next ? next.at - now : REPLAN_MS)

    if (!this.stopped) {
      this.timer = setTimeout(() => this.plan(), Math.max(1_000, wait))
    }
  }

  private async remind(event: RemindedEvent): Promise<void> {
    const now = Date.now()
    const key = `${REMINDER_PREFIX}${event.key}`
    const preparation = await this.deps.preparation(event.key).catch(() => null)
    const when = startWords(event, now)
    const meetLink = event.meetLink
    const shown = this.deps.center.notify({
      family: 'calendar',
      kind: 'calendar.reminder',
      key,
      title: event.title,
      subtitle: when,
      body: [preparation, event.location].filter(Boolean).join(' · ') || event.calendarName,
      concealed: { title: 'Promemoria', body: when },
      target: { kind: 'event', eventKey: event.key },
      actions: [
        ...(meetLink ? [{ label: 'Partecipa', run: () => this.deps.openExternal(meetLink) }] : []),
        ...(event.startsAt - now > SNOOZE_MS
          ? [
              {
                label: 'Fra 5 minuti',
                run: () => {
                  this.snoozed.set(event.key, Date.now() + SNOOZE_MS)
                  this.plan()
                }
              }
            ]
          : [])
      ],
      when: 'always'
    })

    if (shown) {
      this.shown.set(key, { eventKey: event.key, startsAt: event.startsAt, endsAt: event.endsAt })
    }
  }
}
