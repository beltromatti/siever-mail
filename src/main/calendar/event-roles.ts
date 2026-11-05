import type { CalendarEvent } from '@shared/calendar'

import type { InvitationInstance } from './icalendar'

/** What says who an event is the user's: who organises it, who is invited, the user's answer. */
type Roles = Pick<CalendarEvent, 'organizer' | 'attendees' | 'myResponse'>

/** An address, as the app compares them; null for what is not one. */
export function addressOrNull(value: string | null | undefined): string | null {
  const address = value?.trim().toLowerCase() ?? ''
  return /^[^@\s]+@[^@\s]+$/.test(address) ? address : null
}

/**
 * The user's own addresses: their mail accounts', the Google and Microsoft
 * accounts their calendars are connected with, a CalDAV server's user name
 * when it is an address, and those the servers know them by. What the user
 * named a connection, or a calendar's link, says nothing of who they are:
 * a colleague's calendar subscribed under their address is not the user's.
 */
export function ownAddresses(
  mail: ReadonlyArray<string>,
  connections: ReadonlyArray<{ provider: string; label: string; username: string | null }>,
  servers: ReadonlyArray<ReadonlyArray<string>>
): Set<string> {
  return new Set(
    [
      ...mail,
      ...connections.map((connection) =>
        connection.provider === 'google' || connection.provider === 'microsoft'
          ? connection.label
          : connection.provider === 'caldav'
            ? connection.username
            : null
      ),
      ...servers.flat()
    ].flatMap((value) => addressOrNull(value) ?? [])
  )
}

/**
 * The addresses an invitation that came to a mail account was sent to: the
 * account's, and those a CalDAV server knows the same person by
 * (calendar-user-address-set) where it knows them by the account's too.
 * None without the account.
 */
export function invitedAddresses(
  account: string | null,
  servers: ReadonlyArray<ReadonlyArray<string>>
): Set<string> {
  const address = addressOrNull(account)

  if (!address) {
    return new Set()
  }

  return new Set([
    address,
    ...servers
      .map((known) => known.flatMap((value) => addressOrNull(value) ?? []))
      .filter((known) => known.includes(address))
      .flat()
  ])
}

/** Whether the user — by one of `addresses`, or as the provider marks them — organises the event. */
export function organizerIsUser(event: Roles, addresses: ReadonlySet<string>): boolean {
  return (
    event.attendees.some((attendee) => attendee.self && attendee.organizer) ||
    (event.organizer !== null && addresses.has(event.organizer.trim().toLowerCase()))
  )
}

/**
 * Whether the user may change the event, its guests told: they organise it
 * — `addresses` are theirs, and the calendars they write in — or it has no
 * one to tell. An invitation is answered, not changed: changed, it would
 * change the user's copy alone, and its organizer would never know.
 */
export function organizedByUser(event: Roles, addresses: ReadonlySet<string>): boolean {
  return (
    event.myResponse === null &&
    (event.attendees.every((attendee) => attendee.self) ||
      event.organizer === null ||
      organizerIsUser(event, addresses))
  )
}

/** An event an invitation may be for, in one of the calendars connected. */
export interface InvitationCandidate {
  event: Roles &
    Pick<CalendarEvent, 'connectionId' | 'calendarId'> & {
      startsAt: number
      endsAt: number
    }
  /** Its calendar takes the answer and tells the organizer: written in, it schedules. */
  answerable: boolean
  primary: boolean
  /** Its connection came with the account the invitation came to: the same mailbox's calendar. */
  sameAccount: boolean
}

/**
 * The event an invitation is for, of those with its UID: in each calendar,
 * the instance it names (where the invitation puts it, or — not moved there
 * yet — where the series did), or, for a whole series, its next instance;
 * then, of the calendars, one where the user answers it as the one the
 * invitation came to — a calendar of that account, or one whose entry for
 * the user is an address the invitation was sent to (`addresses.invited`),
 * the account's own first, its main calendar first — or else the user's own
 * copy of an event they organise (`addresses.own`). None where the user can
 * only read it, or is there as someone else — their other account, invited
 * too — or is not named (invited through a list): that one is answered by
 * mail, from the account it came to.
 */
export function invitationEvent<T extends InvitationCandidate>(
  candidates: ReadonlyArray<T>,
  instance: InvitationInstance | null,
  addresses: { own: ReadonlySet<string>; invited: ReadonlySet<string> },
  now: number
): T | null {
  const byCalendar = new Map<string, T[]>()

  for (const candidate of [...candidates].sort((a, b) => a.event.startsAt - b.event.startsAt)) {
    const key = `${candidate.event.connectionId}\u0000${candidate.event.calendarId}`
    byCalendar.set(key, [...(byCalendar.get(key) ?? []), candidate])
  }

  const ranked: Array<{ candidate: T; rank: number }> = []

  for (const instances of byCalendar.values()) {
    const candidate = instance
      ? (instances.find((entry) => entry.event.startsAt === instance.start) ??
        instances.find((entry) => entry.event.startsAt === instance.original))
      : (instances.find((entry) => entry.event.endsAt > now) ?? instances.at(-1))

    if (!candidate) {
      continue
    }

    const invitedHere =
      candidate.sameAccount ||
      candidate.event.attendees.some(
        (attendee) => attendee.self && addresses.invited.has(attendee.email.trim().toLowerCase())
      )
    const role =
      candidate.answerable && candidate.event.myResponse !== null && invitedHere
        ? 0
        : candidate.event.myResponse === null && organizerIsUser(candidate.event, addresses.own)
          ? 1
          : null

    if (role !== null) {
      ranked.push({
        candidate,
        rank: role * 4 + (candidate.sameAccount ? 0 : 2) + (candidate.primary ? 0 : 1)
      })
    }
  }

  return ranked.sort((a, b) => a.rank - b.rank)[0]?.candidate ?? null
}
