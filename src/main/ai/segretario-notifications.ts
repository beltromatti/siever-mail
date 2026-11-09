import type { NotificationCenter } from '@main/notifications/center'
import {
  setupReadingAccountIds,
  type ActivityStatus,
  type ActivitySummary,
  type OnboardingState
} from '@shared/segretario'

import { localDay } from './tools/day'

/** How long the line taken from the Segretario's words may be. */
const LINE_MAX = 180

/**
 * The first sentence of what the Segretario wrote, as plain text: its links
 * as their words, without the marks of Markdown — for a notification.
 */
export function plainLine(markdown: string, max = LINE_MAX): string {
  const text = markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`
}

/**
 * The Segretario's notifications (vision §13.3), through the app's centre:
 * when it waits for the user — a confirmation — or finished what they
 * asked while they were away; Conoscimi and the setup's reading done with
 * nobody at the window; the day's letter, the first time it is ready each
 * day. What answers the user is said in the app when they are there: a
 * notification only when they are away.
 */
export class SegretarioNotifications {
  /** Each run's status as last told, to see it change. */
  private readonly statuses = new Map<string, ActivityStatus>()

  constructor(
    private readonly deps: {
      center: NotificationCenter
      /** The day's letter, as written. */
      letter: (day: string) => Promise<string | null>
      /** The last words the Segretario wrote in a run. */
      lastAnswer: (activityId: string) => Promise<string | null>
      /** The guided setup under way, if any. */
      setup: () => Promise<OnboardingState | null>
      /** Whether the setup's reading is done — of these mailboxes, or of all (undefined). */
      readingDone: (accountIds: string[] | undefined) => Promise<boolean>
    }
  ) {}

  /** A run as it is now: what changed in it may be worth telling. */
  activity(activity: ActivitySummary): void {
    const before = this.statuses.get(activity.id)
    const now = activity.status
    const ended = now === 'done' || now === 'failed' || now === 'cancelled'

    if (ended) {
      this.statuses.delete(activity.id)
    } else {
      this.statuses.set(activity.id, now)
    }

    if (before === now) {
      return
    }

    if (now === 'waiting') {
      this.waiting(activity)
    } else if (before === 'waiting') {
      this.deps.center.withdraw(`segretario:waiting:${activity.id}`)
    }

    // Only an end seen to happen: a run listed once more after a launch says nothing new.
    if (!ended || (before !== 'running' && before !== 'waiting') || now === 'cancelled') {
      return
    }

    void this.ended(activity).catch(() => undefined)
  }

  /** A run the user opened: what told them it was done is over. */
  seen(activityId: string): void {
    this.deps.center.withdraw(`segretario:done:${activityId}`)
  }

  private needsYou(): boolean {
    return this.deps.center.preferences.segretario.needsYou
  }

  private waiting(activity: ActivitySummary): void {
    if (!this.needsYou()) {
      return
    }

    this.deps.center.notify({
      family: 'segretario',
      kind: 'segretario.waiting',
      key: `segretario:waiting:${activity.id}`,
      title: 'Il Segretario aspetta la tua conferma',
      body: activity.title,
      concealed: {
        title: 'Il Segretario aspetta la tua conferma',
        body: 'La trovi nel suo pannello.'
      },
      target: { kind: 'activity', activityId: activity.id },
      when: 'away'
    })
  }

  private async ended(activity: ActivitySummary): Promise<void> {
    switch (activity.task) {
      case 'richiesta':
        return this.answered(activity)
      case 'conoscimi':
        return this.knew(activity)
      case 'giornata':
        return this.dayReady(activity)
      case 'lettura':
      case 'calendario':
        return this.setupRead(activity)
    }
  }

  /** What the user asked in the panel, done or not, while they were away. */
  private async answered(activity: ActivitySummary): Promise<void> {
    if (!this.needsYou() || !this.deps.center.wouldShow('away')) {
      return
    }

    const done = activity.status === 'done'
    const answer = done ? await this.deps.lastAnswer(activity.id) : null

    this.deps.center.notify({
      family: 'segretario',
      kind: 'segretario.finished',
      key: `segretario:done:${activity.id}`,
      title: done ? 'Il Segretario ha finito' : 'Il Segretario non è riuscito',
      subtitle: activity.title,
      body: answer
        ? plainLine(answer)
        : done
          ? 'La risposta è nel suo pannello.'
          : 'Puoi riprovare dal suo pannello.',
      concealed: {
        title: done ? 'Il Segretario ha finito' : 'Il Segretario non è riuscito',
        body: 'Nel suo pannello.'
      },
      target: { kind: 'activity', activityId: activity.id },
      when: 'away'
    })
  }

  /** Conoscimi ended with nobody at the window: the setup goes on when the user is back. */
  private async knew(activity: ActivitySummary): Promise<void> {
    if (!this.needsYou() || !(await this.deps.setup())) {
      return
    }

    const done = activity.status === 'done'
    this.deps.center.notify({
      family: 'segretario',
      kind: 'segretario.conoscimi',
      key: `segretario:conoscimi:${activity.id}`,
      title: done ? 'Il Segretario ti ha conosciuto' : 'Conoscimi si è fermato',
      body: done
        ? 'Torna a SIEVER Mail per continuare la preparazione.'
        : 'Torna a SIEVER Mail: puoi riprovare, o continuare senza AI.',
      target: { kind: 'window' },
      when: 'away'
    })
  }

  /** The setup's reading is all done, with nobody at the window: SIEVER Mail is ready. */
  private async setupRead(activity: ActivitySummary): Promise<void> {
    if (activity.status !== 'done' || !this.needsYou() || !this.deps.center.wouldShow('away')) {
      return
    }

    const setup = await this.deps.setup()

    if (
      setup?.step !== 'lettura' ||
      !(await this.deps.readingDone(setupReadingAccountIds(setup))) ||
      !(await this.deps.center.giveOnce(`setup-ready:${setup.startedAt}`))
    ) {
      return
    }

    this.deps.center.notify({
      family: 'segretario',
      kind: 'segretario.setup-ready',
      key: `segretario:setup:${setup.startedAt}`,
      title: 'SIEVER Mail è pronta',
      body: 'Il Segretario è al passo con la tua posta e il tuo calendario: entra.',
      target: { kind: 'window' },
      when: 'away'
    })
  }

  /**
   * The day's letter, the first time it is ready each day: the user knows
   * their day without opening the app. At the window, Oggi says it.
   */
  private async dayReady(activity: ActivitySummary): Promise<void> {
    const day = localDay()

    if (activity.status !== 'done' || !this.deps.center.preferences.segretario.day) {
      return
    }

    const letter = await this.deps.letter(day)

    if (!letter || !(await this.deps.center.giveOnce(`day:${day}`))) {
      return
    }

    this.deps.center.notify({
      family: 'segretario',
      kind: 'segretario.day',
      key: `segretario:day:${day}`,
      title: 'La tua giornata',
      body: plainLine(letter, 240),
      concealed: { title: 'La tua giornata', body: 'È pronta in Oggi.' },
      target: { kind: 'today' },
      when: 'away'
    })
  }
}
