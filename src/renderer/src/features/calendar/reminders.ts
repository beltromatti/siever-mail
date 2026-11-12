import type { CalendarProviderKind } from '@shared/calendar'

/**
 * The reminders the Calendario offers (vision §7.5), in minutes before an
 * event starts: for one with a time, from its start to a week before; for
 * one all day — which starts at its midnight — an hour of the day before,
 * two days or a week before.
 */
export const TIMED_REMINDERS: ReadonlyArray<number> = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]

/** The day before at 18:00, at 12:00, at 9:00; two days before and a week before at 9:00. */
export const ALL_DAY_REMINDERS: ReadonlyArray<number> = [360, 720, 900, 2340, 9540]

/** How many reminders an event keeps where it is: Microsoft one, Google five — and so the others here. */
export function reminderLimit(provider: CalendarProviderKind | undefined): number {
  return provider === 'microsoft' ? 1 : 5
}
