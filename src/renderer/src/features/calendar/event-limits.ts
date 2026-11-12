import { messagesNow } from '@renderer/lib/i18n'
import {
  calendarKey,
  eventMoveLimit,
  type CalendarEvent,
  type CalendarListEntry,
  type CalendarProviderKind,
  type EventMoveLimit
} from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  readonly: {
    en: 'It’s in a calendar that can’t be written in.',
    it: 'È in un calendario in cui non si scrive.',
    de: 'Er steht in einem Kalender, in den nicht geschrieben werden kann.'
  },
  managedGmail: {
    en: 'Gmail keeps it: Google won’t let it move.',
    it: 'Lo tiene Gmail: Google non lo lascia spostare.',
    de: 'Gmail verwaltet ihn: Google lässt ihn nicht verschieben.'
  },
  managedBirthdays: {
    en: 'It’s a contact’s birthday: Google won’t let it move.',
    it: 'È il compleanno di un contatto: Google non lo lascia spostare.',
    de: 'Es ist der Geburtstag eines Kontakts: Google lässt ihn nicht verschieben.'
  },
  invitation: {
    en: 'Someone else organizes it: an invitation is answered, not moved.',
    it: 'Lo organizza un’altra persona: all’invito si risponde, non lo si sposta.',
    de: 'Eine andere Person organisiert ihn: Auf eine Einladung antwortet man, man verschiebt sie nicht.'
  },
  guests: {
    en: 'Moving it would cancel the invitation for the guests and invite them again.',
    it: 'Spostarlo annullerebbe l’invito per gli invitati e li inviterebbe di nuovo.',
    de: 'Das Verschieben würde die Einladung für die Gäste absagen und sie erneut einladen.'
  },
  keptByGmail: {
    en: 'Gmail put it here, from a booking or a ticket, and keeps it: only its reminders can change.',
    it: 'L’ha messo Gmail, da una prenotazione o da un biglietto, e lo tiene lui: si cambiano solo i promemoria.',
    de: 'Gmail hat ihn aus einer Buchung oder einem Ticket eingetragen und verwaltet ihn: Nur die Erinnerungen lassen sich ändern.'
  },
  keptByBirthdays: {
    en: 'It’s a contact’s birthday, kept by Google: only its reminders can change.',
    it: 'È il compleanno di un contatto, che tiene Google: si cambiano solo i promemoria.',
    de: 'Es ist der Geburtstag eines Kontakts, den Google verwaltet: Nur die Erinnerungen lassen sich ändern.'
  },
  openInGoogle: {
    en: 'Open in Google Calendar',
    it: 'Apri in Google Calendar',
    de: 'In Google Calendar öffnen'
  },
  openInOutlook: { en: 'Open in Outlook', it: 'Apri in Outlook', de: 'In Outlook öffnen' },
  openInProvider: {
    en: 'Open in the provider’s calendar',
    it: 'Apri nel calendario del fornitore',
    de: 'Im Kalender des Anbieters öffnen'
  }
})

/** Why an event cannot move to a calendar, in the user's words (vision §7.5). */
export function moveLimitWords(
  limit: Exclude<EventMoveLimit, 'same'>,
  event: Pick<CalendarEvent, 'managedBy'>
): string {
  const m = messagesNow(MESSAGES)

  switch (limit) {
    case 'readonly':
      return m.readonly
    case 'managed':
      return event.managedBy === 'birthdays' ? m.managedBirthdays : m.managedGmail
    case 'invitation':
      return m.invitation
    case 'guests':
      return m.guests
  }
}

/** Who keeps an event put there by another service, and what can still change of it. */
export function keptByWords(managedBy: NonNullable<CalendarEvent['managedBy']>): string {
  const m = messagesNow(MESSAGES)
  return managedBy === 'birthdays' ? m.keptByBirthdays : m.keptByGmail
}

/** «Apri in Google Calendar», «Apri in Outlook»: where an event's own link leads. */
export function openInProviderWords(provider: CalendarProviderKind | undefined): string {
  const m = messagesNow(MESSAGES)
  return provider === 'google'
    ? m.openInGoogle
    : provider === 'microsoft'
      ? m.openInOutlook
      : m.openInProvider
}

/** A calendar an event could move to, and what stops it there; null when nothing does. */
export interface MoveTarget {
  calendar: CalendarListEntry
  limit: EventMoveLimit | null
}

/**
 * The calendars an event could move to — those written in, the one it is
 * in first among them — each with what stops it there; none when its own
 * calendar is not among those listed.
 */
export function moveTargets(
  event: Pick<
    CalendarEvent,
    'connectionId' | 'calendarId' | 'attendees' | 'managedBy' | 'organizedByUser'
  >,
  calendars: ReadonlyArray<CalendarListEntry>
): MoveTarget[] {
  const ownKey = calendarKey(event.connectionId, event.calendarId)
  const own = calendars.find((calendar) => calendar.key === ownKey)

  if (!own) {
    return []
  }

  return calendars
    .filter((calendar) => calendar.writable || calendar.key === ownKey)
    .map((calendar) => ({
      calendar,
      // A calendar's key is its connection's id and its own (`calendarKey`).
      limit: eventMoveLimit(event, own, {
        ...calendar,
        calendarId: calendar.key.slice(calendar.connectionId.length + 1)
      })
    }))
}

/**
 * What stops an event from moving anywhere at all — the same for every
 * calendar: another service keeps it, someone else organises it, its
 * calendar is read only —; null when it can move to some, or some only
 * stop it for their own reason (the guests, in another account).
 */
export function moveBlocked(
  targets: ReadonlyArray<MoveTarget>
): Exclude<EventMoveLimit, 'same' | 'guests'> | null {
  const others = targets.filter((target) => target.limit !== 'same')
  const first = others[0]?.limit

  return first &&
    first !== 'same' &&
    first !== 'guests' &&
    others.every((target) => target.limit === first)
    ? first
    : null
}
