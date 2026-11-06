import type { CalendarAttendee } from '@shared/calendar'
import { foldSearchText } from '@shared/search'

/** How many events a search gives when it does not say. */
export const DEFAULT_SEARCH_LIMIT = 50

/**
 * An event as searches read it: when it is, which calendar it is in, and
 * its words folded once (`eventSearchText`), so a search is a pass over
 * strings already made.
 */
export interface IndexedEvent {
  key: string
  /** `calendarKey(connectionId, calendarId)`. */
  calendarKey: string
  startsAt: number
  endsAt: number
  title: string
  text: string
}

/**
 * What a search compares an event by, folded as the words searched for
 * are: its title, place and description, and its people — each guest by
 * name and address, and whoever organises it.
 */
export function eventSearchText(event: {
  title: string
  location: string | null
  description: string | null
  attendees: ReadonlyArray<Pick<CalendarAttendee, 'name' | 'email'>>
  organizer: string | null
}): string {
  return foldSearchText(
    [
      event.title,
      event.location ?? '',
      event.description ?? '',
      ...event.attendees.map((attendee) => `${attendee.name ?? ''} ${attendee.email}`),
      event.organizer ?? ''
    ].join('\n')
  )
}

/**
 * The events that have every word — in their own text, or in the name of
 * their calendar — within the period and calendars asked, in the order one
 * asks a calendar: first those not over yet, the one under way and then
 * the soonest, as "the next meeting with Rossi" wants; then those past,
 * the latest first, as "the last site visit at Copparo" does. Beyond the
 * limit, those nearest to now stay, on either side: a weekly meeting does
 * not push its last time out with a year of times to come.
 */
export function findEvents(
  index: ReadonlyArray<IndexedEvent>,
  calendarNames: ReadonlyMap<string, string>,
  query: {
    words: ReadonlyArray<string>
    from?: number
    to?: number
    calendarKeys?: ReadonlySet<string>
    limit: number
  },
  now: number
): { upcoming: IndexedEvent[]; past: IndexedEvent[]; more: number } {
  if (query.words.length === 0) {
    return { upcoming: [], past: [], more: 0 }
  }

  // Each word's calendars, by name: a word found there is found in all their events.
  const named = query.words.map(
    (word) =>
      new Set(
        [...calendarNames]
          .filter(([, name]) => foldSearchText(name).includes(word))
          .map(([key]) => key)
      )
  )
  const found = index.filter(
    (event) =>
      (query.from === undefined || event.endsAt > query.from) &&
      (query.to === undefined || event.startsAt < query.to) &&
      (!query.calendarKeys || query.calendarKeys.has(event.calendarKey)) &&
      query.words.every((word, at) => event.text.includes(word) || named[at].has(event.calendarKey))
  )
  const byTitle = (a: IndexedEvent, b: IndexedEvent): number =>
    a.title.localeCompare(b.title, 'it') || a.key.localeCompare(b.key)
  const upcoming = found
    .filter((event) => event.endsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt || byTitle(a, b))
  const past = found
    .filter((event) => event.endsAt <= now)
    .sort((a, b) => b.startsAt - a.startsAt || byTitle(a, b))

  // The two lists taken from their heads, the nearer to now first, until the limit.
  let ahead = 0
  let behind = 0

  while (ahead + behind < query.limit && (ahead < upcoming.length || behind < past.length)) {
    const nextAhead = upcoming[ahead]
    const nextBehind = past[behind]

    if (
      nextAhead &&
      (!nextBehind || Math.max(0, nextAhead.startsAt - now) <= now - nextBehind.endsAt)
    ) {
      ahead += 1
    } else {
      behind += 1
    }
  }

  return {
    upcoming: upcoming.slice(0, ahead),
    past: past.slice(0, behind),
    more: found.length - ahead - behind
  }
}
