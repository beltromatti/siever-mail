import type {
  CalendarConnection as CalendarConnectionRow,
  CalendarEvent as CalendarEventRow,
  Prisma,
  PrismaClient
} from '@prisma/client'
import { randomUUID } from 'node:crypto'

import type { BrowserWindow } from 'electron'

import type { GoogleOAuthService } from '@main/services/google-oauth'
import {
  MICROSOFT_CALENDAR_SCOPES,
  MICROSOFT_MAILBOX_SETTINGS_SCOPES,
  MicrosoftSignInNeeded,
  type MicrosoftOAuthService
} from '@main/services/microsoft-oauth'
import { decryptSecret, encryptSecret } from '@main/services/secure-storage'
import { diagnostics } from '@main/diagnostics/log'
import { messages } from '@main/i18n'
import type { DiagnosticActor, DiagnosticFields } from '@shared/diagnostics'
import { defineMessages } from '@shared/i18n'
import {
  CALENDAR_HELD_DAYS,
  CALENDAR_IPC,
  calendarKey,
  calendarRefusedNotice,
  calendarSearchWords,
  eventMoveLimit,
  type CalendarAttendee,
  type CalendarChange,
  type CalendarConnection,
  type CalendarListEntry,
  type CalendarEvent,
  type CalendarProviderKind,
  type CalendarResponse,
  type CalendarRole,
  type CalendarSearchQuery,
  type CalendarSearchResult,
  type EventChange,
  type EventMoveLimit,
  type EventOrigin,
  type EventRecurrence,
  type NewCalendarEvent
} from '@shared/calendar'
import type { ConnectionRefusal, ConnectionRefusedNotice, MailAccount } from '@shared/models'

import {
  changedEvent,
  changedFields,
  differingFields,
  eventInput,
  sameReminders,
  SyncTokenExpired,
  type CalendarProvider,
  type EventField,
  type MoveHow,
  type ProviderEvent,
  type ProviderEventInput
} from './calendar-provider'
import {
  CalDavCalendarProvider,
  type CalendarObjectStore,
  type StoredObject
} from './caldav-calendar'
import { refusalOfCalendar, type CalendarRefusalFound } from './calendar-refusal'
import {
  DEFAULT_SEARCH_LIMIT,
  eventSearchText,
  findEvents,
  type IndexedEvent
} from './event-search'
import {
  addressOrNull,
  invitationEvent,
  invitedAddresses,
  organizedByUser,
  ownAddresses
} from './event-roles'
import { GOOGLE_CALENDAR_SCOPE, GoogleCalendarProvider } from './google-calendar'
import { GraphCalendarProvider, mailboxZoneNotGranted } from './graph-calendar'
import type { ChangeByOthers } from './calendar-notifications'
import {
  calendarNameOf,
  canonicalUid,
  newEventResource,
  occurrencesOf,
  type InvitationInstance
} from './icalendar'
import {
  eventIsYours,
  handledBy,
  inOthersHands,
  invited,
  roleOf,
  yoursAmong,
  type Ownership,
  type SegretarioOwnership,
  type Whose
} from './ownership'
import { dayIn, knownZone, recurrenceProblem, shiftedRecurrence, shiftedSeries } from './recurrence'
import { instantsOf, type RemindedEvent } from './reminders'
import { calendarText, feedUrl, IcsCalendarProvider, type Fetch } from './ics-calendar'

const log = diagnostics('calendar')

/** How often the calendars are read again for what changed. */
const SYNC_EVERY_MS = 5 * 60 * 1000
/** How far back the events are kept, and how far ahead they are read (`CALENDAR_HELD_DAYS`). */
const WINDOW_BACK_MS = CALENDAR_HELD_DAYS.back * 24 * 60 * 60 * 1000
const WINDOW_AHEAD_MS = CALENDAR_HELD_DAYS.ahead * 24 * 60 * 60 * 1000
/**
 * The window slides with the days: read whole again once a day, so it always
 * holds a year ahead — what comes into it a day at a time, not half a year at
 * once.
 */
const WINDOW_SLIDES_EVERY_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/** How long what changed in the calendars is kept for the Segretario to look at. */
const CHANGES_KEPT_MS = 30 * 24 * 60 * 60 * 1000

/** An event that went to another calendar, as what the app keeps of it follows it (vision §7.5): its key before and after. */
export interface EventMove {
  from: string
  to: string
}

/** A calendar connection taken away, as it was: for the others to let go of it. */
export interface LeftCalendar {
  id: string
  label: string
  provider: CalendarProviderKind
  calendars: string[]
  /** When it was connected. */
  since: number
}

export interface CalendarServiceOptions {
  database: {
    storeClient(): Promise<PrismaClient>
    getAccounts(): Promise<MailAccount[]>
  }
  oauth: GoogleOAuthService
  microsoft: MicrosoftOAuthService
  /** The network, as the app reaches it (its proxy, its certificates). */
  fetch: Fetch
  /** Sends an event to the window. */
  send(channel: string, payload: unknown): void
  parentWindow(): BrowserWindow | null
  /** A connection is about to be taken away: the work that could still write about it stops (§11.4). */
  onDisconnecting?(connectionId: string): Promise<void>
  /**
   * A connection was taken away — or stayed, its removal cut short —, as it
   * was: what was kept about it goes too.
   */
  onDisconnected?(connection: LeftCalendar): Promise<void>
  /**
   * A connection was turned down for good and stopped: the user is to be
   * told, once. Not for one being added, signed in again or retried: who
   * did it is told by the answer.
   */
  onRefused?(notice: ConnectionRefusedNotice): void
  /** The events changed — a sync, a write, whose they are —: what reminds of them looks again (§13.3). */
  onEventsChanged?(): void
  /**
   * The novelties of the user's events that someone else has in hand, as a
   * sync found them — not those the mail tells too (§13.3). `through`: the
   * change noted last, which a look of the Segretario's at the calendar
   * reaching it has seen them.
   */
  onChangedByOthers?(calendar: string, changes: ChangeByOthers[], through: number): void
  /** What the Segretario found of whose things are (§7.4); null with the AI off. */
  ownership?(): Promise<SegretarioOwnership | null>
  /**
   * Events went to another calendar — moved here, or elsewhere and found by
   * a sync — and are the same events there under new keys (vision §7.5):
   * what the Segretario keeps of them follows. Before the page is told.
   */
  onEventsMoved?(moves: ReadonlyArray<EventMove>): Promise<void>
  /**
   * The same, for the calendar's notifications: the reminders given, put
   * off or on the screen follow the events they are of (§13.3).
   */
  notificationsMoved?(moves: ReadonlyArray<EventMove>): Promise<void>
}

/**
 * A change to note for the Segretario: found by a read, or made by the
 * user in the app — what it was, in which calendar, what it is now.
 */
interface FoundChange {
  kind: 'nuovo' | 'cambiato' | 'annullato'
  connectionId: string
  /** The event's key: now — or, gone, as it was. */
  key: string
  before: CalendarEventRow | null
  /** The calendar it was in: another one's, for one moved. */
  beforeName: string
  /**
   * As its provider gives it now — cancelled, for one taken away —; null
   * for one a read in full no longer found, which is not told: it may only
   * have left what the user sees.
   */
  after: ProviderEvent | null
  afterName: string
}

/** What a read of one connection, or of a few, found: settled together (`settle`). */
interface ReadPass {
  found: FoundChange[]
}

/**
 * A write of the app's own, as the read after it settles it: the changes
 * of the events it touched are its own (`owns`) — noted as the user's in
 * the app, or not at all for the Segretario, who knows them, and told to
 * nobody —; and its moves, each with the event as it was.
 */
interface OwnWrite {
  byUser: boolean
  owns(change: FoundChange): boolean
  moves?: ReadonlyArray<EventMove & { before: CalendarEventRow; beforeName: string }>
}

/** A calendar's event as a change notes it, from what its provider gave. */
function snapshotOf(connectionId: string, event: ProviderEvent, calendarName: string): string {
  return JSON.stringify({
    ...event,
    key: eventKey(connectionId, event.calendarId, event.eventId),
    connectionId,
    calendarName,
    startsAt: undefined,
    endsAt: undefined,
    cancelled: undefined
  })
}

/** An event kept, as its provider would give it: what a change made from the rows notes. */
function providerEventOfRow(row: CalendarEventRow): ProviderEvent {
  // Its key and names stay with it: a change's snapshot writes them over (`snapshotOf`).
  return {
    ...eventOfRow(row, ''),
    startsAt: Number(row.startsAt),
    endsAt: Number(row.endsAt),
    cancelled: false
  }
}

/**
 * Of what one read found, the events that left a calendar of a connection
 * and came into another of the same: moved there elsewhere — from the
 * phone, in Google Calendar —, the same event (vision §7.5), by its UID
 * (or Google's id), an instance of a series by its time too. Each is one
 * change under its new key, the old one its `before`.
 */
function movedElsewhere(found: ReadonlyArray<FoundChange>): {
  changes: FoundChange[]
  moves: EventMove[]
} {
  const left = found.filter((change) => change.kind === 'annullato' && change.before)
  const taken = new Set<FoundChange>()
  const merged = new Map<FoundChange, FoundChange>()
  const moves: EventMove[] = []

  for (const arrived of found) {
    const after = arrived.after

    if (arrived.kind !== 'nuovo' || !after) {
      continue
    }

    const gone = left.find((candidate) => {
      const before = candidate.before!
      const same =
        (before.iCalUid !== null &&
          after.iCalUid !== null &&
          before.iCalUid === canonicalUid(after.iCalUid)) ||
        before.eventId === after.eventId
      const instance = before.seriesId !== null || after.seriesId !== null

      return (
        !taken.has(candidate) &&
        candidate.connectionId === arrived.connectionId &&
        before.calendarId !== after.calendarId &&
        same &&
        (!instance || Number(before.startsAt) === after.startsAt)
      )
    })

    if (gone) {
      taken.add(gone)
      moves.push({ from: gone.key, to: arrived.key })
      merged.set(arrived, {
        ...arrived,
        kind: 'cambiato',
        before: gone.before,
        beforeName: gone.beforeName
      })
    }
  }

  return {
    changes: found
      .filter((change) => !taken.has(change))
      .map((change) => merged.get(change) ?? change),
    moves
  }
}

/** The guests of an event kept: whether anyone but the user is invited. */
function hasGuests(row: CalendarEventRow): boolean {
  return (JSON.parse(row.attendeesJson) as CalendarAttendee[]).some((attendee) => !attendee.self)
}

/** Old instances of a series and new ones, paired by when each begins: the same times. */
function pairedByStart(
  before: ReadonlyArray<CalendarEventRow>,
  after: ReadonlyArray<CalendarEventRow>,
  startOf: (row: CalendarEventRow) => number = (row) => Number(row.startsAt)
): Array<[CalendarEventRow, CalendarEventRow]> {
  const free = new Map<number, CalendarEventRow[]>()

  for (const row of after) {
    free.set(Number(row.startsAt), [...(free.get(Number(row.startsAt)) ?? []), row])
  }

  return before.flatMap((row): Array<[CalendarEventRow, CalendarEventRow]> => {
    const match = free.get(startOf(row))?.shift()
    return match ? [[row, match]] : []
  })
}

/** Of some events kept, the one beginning nearest an instant. */
function nearest(rows: ReadonlyArray<CalendarEventRow>, at: number): CalendarEventRow | undefined {
  return [...rows].sort(
    (a, b) => Math.abs(Number(a.startsAt) - at) - Math.abs(Number(b.startsAt) - at)
  )[0]
}

/** Why a connection turned down stopped, as a write refused for it says. */
const STOPPED_BECAUSE = defineMessages({
  accesso: {
    en: 'the server refused the sign-in',
    it: 'il server ha rifiutato l’accesso',
    de: 'der Server hat die Anmeldung abgelehnt'
  },
  autorizzazione: {
    en: 'the authorization is no longer valid',
    it: 'l’autorizzazione non vale più',
    de: 'die Berechtigung ist nicht mehr gültig'
  },
  certificato: {
    en: 'the server’s certificate isn’t valid',
    it: 'il certificato del server non è valido',
    de: 'das Zertifikat des Servers ist nicht gültig'
  },
  sparito: {
    en: 'it’s no longer where it was connected',
    it: 'non si trova più dove era collegato',
    de: 'er ist nicht mehr dort, wo er verbunden war'
  }
}) satisfies Record<ConnectionRefusal, unknown>

const MESSAGES = defineMessages({
  googleForGoogle: {
    en: 'A Google calendar connects through a Google account.',
    it: 'Il calendario di Google si collega per un account Google.',
    de: 'Ein Google-Kalender wird über ein Google-Konto verbunden.'
  },
  connectCalendarOf: {
    en: (address: string) => `Connect the calendar of ${address}`,
    it: (address: string) => `Collega il calendario di ${address}`,
    de: (address: string) => `Kalender von ${address} verbinden`
  },
  connectGoogleCalendar: {
    en: 'Connect a Google calendar',
    it: 'Collega un calendario Google',
    de: 'Einen Google-Kalender verbinden'
  },
  wrongGoogleAccount: {
    en: (chosen: string, wanted: string) =>
      `You chose ${chosen} in Google: this calendar needs ${wanted}.`,
    it: (chosen: string, wanted: string) =>
      `Hai scelto ${chosen} in Google: per questo calendario serve ${wanted}.`,
    de: (chosen: string, wanted: string) =>
      `Sie haben bei Google ${chosen} gewählt: Für diesen Kalender wird ${wanted} benötigt.`
  },
  wrongMicrosoftAccount: {
    en: (chosen: string, wanted: string) =>
      `You chose ${chosen} in Microsoft: this calendar needs ${wanted}.`,
    it: (chosen: string, wanted: string) =>
      `Hai scelto ${chosen} in Microsoft: per questo calendario serve ${wanted}.`,
    de: (chosen: string, wanted: string) =>
      `Sie haben bei Microsoft ${chosen} gewählt: Für diesen Kalender wird ${wanted} benötigt.`
  },
  googleNoCalendar: {
    en: 'Google didn’t give access to the calendar: do it again, leaving the calendar checkbox selected.',
    it: "Google non ha dato l'accesso al calendario: rifallo lasciando selezionata la casella del calendario.",
    de: 'Google hat keinen Zugriff auf den Kalender gewährt: Wiederholen Sie den Vorgang und lassen Sie das Kästchen für den Kalender aktiviert.'
  },
  httpsOnly: {
    en: 'The server’s address starts with https://.',
    it: 'L’indirizzo del server comincia con https://.',
    de: 'Die Adresse des Servers beginnt mit https://.'
  },
  addressMissing: {
    en: 'This calendar’s address is missing: disconnect it and connect it again.',
    it: 'Manca l’indirizzo di questo calendario: scollegalo e collegalo di nuovo.',
    de: 'Die Adresse dieses Kalenders fehlt: Trennen Sie ihn und verbinden Sie ihn erneut.'
  },
  noEventCalendars: {
    en: 'There are no event calendars on this server.',
    it: 'Su questo server non ci sono calendari di eventi.',
    de: 'Auf diesem Server gibt es keine Terminkalender.'
  },
  calendarGone: {
    en: 'This calendar is no longer connected.',
    it: 'Questo calendario non è più collegato.',
    de: 'Dieser Kalender ist nicht mehr verbunden.'
  },
  alreadyConnected: {
    en: 'This calendar is already connected.',
    it: 'Questo calendario è già collegato.',
    de: 'Dieser Kalender ist bereits verbunden.'
  },
  linkNotAnswering: {
    en: (status: number) => `The calendar’s link isn’t answering (${status}).`,
    it: (status: number) => `Il link del calendario non risponde (${status}).`,
    de: (status: number) => `Der Link des Kalenders antwortet nicht (${status}).`
  },
  noIcsAtLink: {
    en: 'There’s no calendar (.ics) at that link.',
    it: 'A quel link non c’è un calendario (.ics).',
    de: 'Unter diesem Link gibt es keinen Kalender (.ics).'
  },
  notAdded: {
    en: (problem: string) => `${problem} SIEVER Mail didn’t add it.`,
    it: (problem: string) => `${problem} SIEVER Mail non l’ha aggiunto.`,
    de: (problem: string) => `${problem} SIEVER Mail hat ihn nicht hinzugefügt.`
  },
  stopped: {
    en: (label: string, because: string) =>
      `The calendar ${label} is stopped: ${because}. Reconnect it from Settings › Connections.`,
    it: (label: string, because: string) =>
      `Il calendario ${label} è fermo: ${because}. Ricollegalo da Impostazioni › Connessioni.`,
    de: (label: string, because: string) =>
      `Der Kalender ${label} ist angehalten: ${because}. Verbinden Sie ihn unter Einstellungen › Verbindungen erneut.`
  },
  accessMissing: {
    en: 'Access to this calendar is missing: disconnect it and connect it again.',
    it: 'Manca l’accesso a questo calendario: scollegalo e collegalo di nuovo.',
    de: 'Der Zugriff auf diesen Kalender fehlt: Trennen Sie ihn und verbinden Sie ihn erneut.'
  },
  unreadable: {
    en: (name: string, reason: string) => `“${name}” can’t be read: ${reason}`,
    it: (name: string, reason: string) => `«${name}» non si legge: ${reason}`,
    de: (name: string, reason: string) => `„${name}“ kann nicht gelesen werden: ${reason}`
  },
  eventGone: {
    en: 'The event is no longer in the calendar.',
    it: 'L’evento non c’è più nel calendario.',
    de: 'Der Termin ist nicht mehr im Kalender.'
  },
  readOnly: {
    en: (name: string) => `Events can’t be added to the calendar “${name}”.`,
    it: (name: string) => `Nel calendario «${name}» non si possono aggiungere eventi.`,
    de: (name: string) => `Zum Kalender „${name}“ können keine Termine hinzugefügt werden.`
  },
  organizedByOthers: {
    en: (title: string, organizer: string | null) =>
      `“${title}” is organized by ${organizer ?? 'someone else'}: you answer the invitation, you don’t change it.`,
    it: (title: string, organizer: string | null) =>
      `«${title}» lo organizza ${organizer ?? 'un’altra persona'}: all’invito si risponde, non si cambia.`,
    de: (title: string, organizer: string | null) =>
      `„${title}“ wird von ${organizer ?? 'einer anderen Person'} organisiert: Auf die Einladung wird geantwortet, sie wird nicht geändert.`
  },
  gmailKeepsIt: {
    en: 'Gmail keeps it: only its reminders can change.',
    it: 'Lo tiene Gmail: si cambiano solo i promemoria.',
    de: 'Gmail verwaltet ihn: Nur die Erinnerungen lassen sich ändern.'
  },
  birthdayKeepsIt: {
    en: 'It’s a birthday from your contacts: only its reminders can change.',
    it: 'È un compleanno dei contatti: si cambiano solo i promemoria.',
    de: 'Es ist ein Geburtstag aus Ihren Kontakten: Nur die Erinnerungen lassen sich ändern.'
  },
  otherRuleDay: {
    en: 'This series repeats by a rule made elsewhere: here its time can change, not its day.',
    it: 'Questa serie si ripete con una regola fatta altrove: qui se ne cambia l’ora, non il giorno.',
    de: 'Diese Serie wiederholt sich nach einer anderswo erstellten Regel: Hier lässt sich die Uhrzeit ändern, nicht der Tag.'
  },
  otherRuleCopy: {
    en: 'This series repeats by a rule made elsewhere, which can’t be written again in another account’s calendar: move it where it was made.',
    it: 'Questa serie si ripete con una regola fatta altrove, che nel calendario di un altro account non si può riscrivere: spostala da dove è nata.',
    de: 'Diese Serie wiederholt sich nach einer anderswo erstellten Regel, die sich im Kalender eines anderen Kontos nicht neu schreiben lässt: Verschieben Sie sie dort, wo sie erstellt wurde.'
  },
  exceptionsCopy: {
    en: 'Some times of this series were changed or deleted one by one: copying it to the other calendar would lose that.',
    it: 'Alcune volte di questa serie sono state cambiate o tolte una per una: copiandola nell’altro calendario si perderebbe.',
    de: 'Einige Termine dieser Serie wurden einzeln geändert oder gelöscht: Beim Kopieren in den anderen Kalender ginge das verloren.'
  }
})

/** Why an event cannot go to another calendar (`eventMoveLimit`), in the user's words. */
const MOVE_LIMITS = defineMessages({
  same: {
    en: 'The event is already in that calendar.',
    it: 'L’evento è già in quel calendario.',
    de: 'Der Termin ist bereits in diesem Kalender.'
  },
  readonly: {
    en: 'One of the two calendars can’t be written in: the event can’t move there.',
    it: 'In uno dei due calendari non si può scrivere: l’evento non si sposta lì.',
    de: 'In einen der beiden Kalender kann nicht geschrieben werden: Der Termin lässt sich dorthin nicht verschieben.'
  },
  gmail: {
    en: 'Gmail keeps it: Google doesn’t let it move to another calendar.',
    it: 'Lo tiene Gmail: Google non lo lascia spostare in un altro calendario.',
    de: 'Gmail verwaltet ihn: Google lässt ihn nicht in einen anderen Kalender verschieben.'
  },
  birthdays: {
    en: 'It’s a birthday from your contacts: Google doesn’t let it move to another calendar.',
    it: 'È un compleanno dei contatti: Google non lo lascia spostare in un altro calendario.',
    de: 'Es ist ein Geburtstag aus Ihren Kontakten: Google lässt ihn nicht in einen anderen Kalender verschieben.'
  },
  invitation: {
    en: 'It’s someone else’s invitation: you answer it, you don’t move it.',
    it: 'È un invito di altri: si risponde, non si sposta.',
    de: 'Es ist die Einladung einer anderen Person: Sie wird beantwortet, nicht verschoben.'
  },
  guests: {
    en: 'Moving it would cancel the invitation for the invitees and invite them again.',
    it: 'Spostarlo annullerebbe l’invito per gli invitati e li inviterebbe di nuovo.',
    de: 'Durch das Verschieben würde die Einladung für die Eingeladenen abgesagt und erneut verschickt.'
  }
})

/**
 * A rule a write gives, checked as the user is told (`recurrenceProblem`):
 * from the event's first day, on the clock it is kept on.
 */
function checkRule(
  event: Pick<ProviderEventInput, 'start' | 'allDay' | 'recurrence' | 'zone'>
): void {
  if (event.recurrence && event.recurrence !== 'other') {
    const problem = recurrenceProblem(
      event.recurrence,
      dayIn(event.start, event.allDay, knownZone(event.zone))
    )

    if (problem) {
      throw new Error(problem)
    }
  }
}

/**
 * An event written but not kept — a series that begins beyond what the
 * calendar holds —, as the write resolves with it: as its provider gave it.
 */
function unkept(event: ProviderEvent, connectionId: string, calendarName: string): CalendarEvent {
  const written: CalendarEvent & Partial<Pick<ProviderEvent, 'startsAt' | 'endsAt' | 'cancelled'>> =
    {
      ...event,
      key: eventKey(connectionId, event.calendarId, event.eventId),
      connectionId,
      calendarName
    }

  delete written.startsAt
  delete written.endsAt
  delete written.cancelled
  return written
}

/** Why an event cannot move, as the user is told: of one another service keeps, which one. */
function moveLimitWords(limit: EventMoveLimit, managedBy: string | null): string {
  const m = messages(MOVE_LIMITS)
  return limit === 'managed' ? (managedBy === 'birthdays' ? m.birthdays : m.gmail) : m[limit]
}

/** Whether two addresses are the same mailbox: the case of an address does not matter. */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function eventKey(connectionId: string, calendarId: string, eventId: string): string {
  return `${connectionId}\u0000${calendarId}\u0000${eventId}`
}

/** The connection an event's key, or a calendar's (`calendarKey`), begins with. */
function connectionOfKey(key: string): string {
  const end = key.indexOf('\u0000')
  return end < 0 ? key : key.slice(0, end)
}

/** Whether what the user sees of an event is different: its time, words, place, people and answers. */
function differs(row: CalendarEventRow, event: ProviderEvent): boolean {
  return (
    row.title !== event.title ||
    row.start !== event.start ||
    row.end !== event.end ||
    (row.allDay === 1) !== event.allDay ||
    row.location !== event.location ||
    row.description !== event.description ||
    row.attendeesJson !== JSON.stringify(event.attendees) ||
    row.myResponse !== event.myResponse
  )
}

/**
 * An event as kept. With the user's addresses, it says too whether the
 * user organises it; what is kept of an event as it was, for the
 * Segretario, does not.
 */
function eventOfRow(
  row: CalendarEventRow,
  calendarName: string,
  addresses?: ReadonlySet<string>
): CalendarEvent {
  const event: CalendarEvent = {
    key: row.key,
    connectionId: row.connectionId,
    calendarId: row.calendarId,
    calendarName,
    eventId: row.eventId,
    iCalUid: row.iCalUid,
    seriesId: row.seriesId,
    title: row.title,
    start: row.start,
    end: row.end,
    allDay: row.allDay === 1,
    location: row.location,
    description: row.description,
    attendees: JSON.parse(row.attendeesJson) as CalendarAttendee[],
    organizer: row.organizer,
    creator: row.creator,
    myResponse: (row.myResponse as CalendarResponse | null) ?? null,
    meetLink: row.meetLink,
    htmlLink: row.htmlLink,
    origin: row.originJson ? (JSON.parse(row.originJson) as EventOrigin) : null,
    reminders: row.remindersJson ? (JSON.parse(row.remindersJson) as number[]) : null,
    recurrence: row.recurrenceJson
      ? (JSON.parse(row.recurrenceJson) as EventRecurrence | 'other')
      : null,
    managedBy: (row.managedBy as CalendarEvent['managedBy']) ?? null
  }

  return addresses ? { ...event, organizedByUser: organizedByUser(event, addresses) } : event
}

/** A kept calendar, as whose its events are is reckoned (`roleOf`): with its connection's provider. */
function calendarFacts(
  row: {
    connectionId: string
    calendarId: string
    isPrimary: number
    writable: number
    role: string | null
  },
  providers: ReadonlyMap<string, string>
): Parameters<typeof roleOf>[0] {
  return {
    connectionId: row.connectionId,
    calendarId: row.calendarId,
    primary: row.isPrimary === 1,
    writable: row.writable === 1,
    provider: (providers.get(row.connectionId) ?? 'ics') as CalendarProviderKind,
    role: row.role
  }
}

/**
 * The calendar connections, each on its own — a Google account, and the
 * providers to come — their calendars kept here in step with the provider:
 * read again every few minutes for what changed, and read by the
 * Calendario, Oggi, the reader and the Segretario from here. A connection
 * has its own access: the mail never depends on it, nor it on the mail.
 */
export class CalendarService {
  private prisma: PrismaClient | null = null
  private timer: NodeJS.Timeout | null = null
  /** The sync of each connection asked for, under way or waiting its turn: one each. */
  private readonly syncing = new Map<string, Promise<void>>()
  /** What each connection is doing, last in line: syncs and writes take their turn. */
  private readonly turns = new Map<string, Promise<unknown>>()
  /** Connections being taken away: their sync stops, and none starts. */
  private readonly leaving = new Set<string>()
  /**
   * Connections turned down for good, why, and what the user is told: no
   * sync tries them again, nor does a write, until the user puts them
   * right. Not kept: at the next start each is tried once more.
   */
  private readonly refused = new Map<string, CalendarRefusalFound>()
  /** The connections whose consent lacks what writing needs, as their last sync found. */
  private readonly consentShort = new Set<string>()
  /** The connections whose certificate was refused once: the next sync confirms it. */
  private readonly certificateToConfirm = new Set<string>()
  /** Connections being added or signed in again: a refusal of theirs is told to whoever does it. */
  private readonly adding = new Set<string>()
  /**
   * Whether each CalDAV connection's server schedules — sends invitations
   * and answers itself — as its last sync found: a calendar there takes an
   * answer only when it does.
   */
  private readonly scheduling = new Map<string, boolean>()
  /** The user's addresses on each CalDAV server, as its last sync found them. */
  private readonly davAddresses = new Map<string, ReadonlyArray<string>>()
  /**
   * Every event kept, as searches read it: made at the first search after
   * the events change, and dropped as soon as they do (`eventsChanged`).
   */
  private searchIndex: Promise<IndexedEvent[]> | null = null

  constructor(private readonly options: CalendarServiceOptions) {}

  private readonly opened = (() => {
    const opened = Promise.withResolvers<void>()
    // Rejected when the app could not start: whoever waits is told, nobody else must listen.
    opened.promise.catch(() => undefined)
    return opened
  })()

  async open(): Promise<void> {
    try {
      this.prisma = await this.options.database.storeClient()
    } catch (error) {
      this.abandon(error)
      throw error
    }

    this.timer = setInterval(() => void this.syncAll(), SYNC_EVERY_MS)
    this.opened.resolve()
    void this.syncAll()
  }

  /** The app could not start: what waits for the calendar is told so, rather than left waiting. */
  abandon(error: unknown): void {
    this.opened.reject(error instanceof Error ? error : new Error(String(error)))
  }

  /** Resolves once the calendars are open: what asks for them waits until then. */
  whenOpen(): Promise<void> {
    return this.opened.promise
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Runs `work` on a connection when what it is doing is done — a sync, a
   * write — and holds the next until it is: a sync never reads an event
   * while it is written, nor a write lands after the connection is gone.
   */
  private inTurn<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.turns.get(connectionId) ?? Promise.resolve()).then(work)
    const done = run.then(
      () => undefined,
      () => undefined
    )

    this.turns.set(connectionId, done)
    void done.then(() => {
      if (this.turns.get(connectionId) === done) {
        this.turns.delete(connectionId)
      }
    })
    return run
  }

  /**
   * Runs `work` in the turns of several connections at once — a move from
   * one to another —, taken always in the same order, so two works asking
   * for the same ones never wait for each other.
   */
  private inTurns<T>(connectionIds: ReadonlyArray<string>, work: () => Promise<T>): Promise<T> {
    return [...new Set(connectionIds)]
      .sort()
      .reduceRight<() => Promise<T>>((inner, id) => () => this.inTurn(id, inner), work)()
  }

  private requirePrisma(): PrismaClient {
    if (!this.prisma) {
      throw new Error('The calendars are not open yet.')
    }

    return this.prisma
  }

  /**
   * The calendars as the diagnostics tell them (vision §14.4): each
   * connection — its provider, when it was last read and how, what went
   * wrong — with its calendars and how many events it holds. Never a secret.
   */
  async diagnosticState(): Promise<Record<string, unknown>> {
    if (!this.prisma) {
      return { open: false }
    }

    const prisma = this.prisma
    const [connections, calendars, events, changes, segretario] = await Promise.all([
      prisma.calendarConnection.findMany({ orderBy: { connectedAt: 'asc' } }),
      prisma.calendarCalendar.findMany(),
      prisma.calendarEvent.groupBy({ by: ['connectionId'], _count: { _all: true } }),
      prisma.calendarChange.count(),
      this.segretarioOwnership()
    ])

    return {
      changesKept: changes,
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        mailAccountId: connection.mailAccountId,
        server: connection.serverUrl,
        connectedAt: new Date(Number(connection.connectedAt)).toISOString(),
        lastSyncAt:
          connection.lastSyncAt === null
            ? null
            : new Date(Number(connection.lastSyncAt)).toISOString(),
        problem: connection.problem,
        refused: this.refused.get(connection.id) ?? null,
        calendars: calendars
          .filter((calendar) => calendar.connectionId === connection.id)
          .map((calendar) => {
            // Whose its events are (§7.4), and who said so: what reminds and what Oggi shows.
            const role = roleOf(
              calendarFacts(calendar, new Map([[connection.id, connection.provider]])),
              segretario
            )

            return {
              name: calendar.name,
              primary: calendar.isPrimary === 1,
              writable: calendar.writable === 1,
              hidden: calendar.hidden === 1,
              role: role.role,
              roleBy: role.by
            }
          }),
        events: events.find((group) => group.connectionId === connection.id)?._count._all ?? 0
      }))
    }
  }

  /** The calendar connections, and how each stands. */
  async listConnections(): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const [connections, calendars] = await Promise.all([
      prisma.calendarConnection.findMany({ orderBy: { connectedAt: 'asc' } }),
      prisma.calendarCalendar.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] })
    ])

    return connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider as CalendarProviderKind,
      label: connection.label,
      mailAccountId: connection.mailAccountId,
      serverUrl: connection.serverUrl,
      lastSyncAt: connection.lastSyncAt ? Number(connection.lastSyncAt) : null,
      problem: connection.problem,
      refused: this.refused.get(connection.id)?.refusal ?? null,
      renewConsent: this.consentShort.has(connection.id),
      calendars: calendars
        .filter((calendar) => calendar.connectionId === connection.id)
        .map((calendar) => ({
          connectionId: connection.id,
          calendarId: calendar.calendarId,
          name: calendar.name,
          primary: calendar.isPrimary === 1
        }))
    }))
  }

  /**
   * Asks Google for a calendar, in Google's window: the calendar of a
   * Google mail connection — that account already chosen — or, with none,
   * of the account the user picks, the calendar alone. With `connectionId`,
   * a calendar connection signed in again — turned down, or its access to
   * renew — its account suggested and required. Resolves once its events
   * are in.
   */
  async connectGoogle(
    mailAccountId: string | null,
    connectionId: string | null = null
  ): Promise<CalendarConnection[]> {
    const account = mailAccountId
      ? (await this.options.database.getAccounts()).find(
          (candidate) => candidate.id === mailAccountId
        )
      : undefined

    if (mailAccountId && account?.type !== 'gmail') {
      throw new Error(messages(MESSAGES).googleForGoogle)
    }

    const address =
      account?.email ??
      (connectionId ? (await this.connectionOf(connectionId, 'google')).label : null)
    const granted = await this.options.oauth.authorize(this.options.parentWindow() ?? undefined, {
      scopes: [GOOGLE_CALENDAR_SCOPE],
      loginHint: address ?? undefined,
      title: address
        ? messages(MESSAGES).connectCalendarOf(address)
        : messages(MESSAGES).connectGoogleCalendar
    })

    if (address && !sameAddress(granted.email, address)) {
      throw new Error(messages(MESSAGES).wrongGoogleAccount(granted.email, address))
    }

    await this.addGoogle(granted.email, granted.refreshToken, granted.scopes)
    return this.listConnections()
  }

  /**
   * Keeps the calendar of a Google account the user granted — on its own,
   * or with the account's mail in one consent — and reads its events in.
   * The account's mail connection, when there is one, goes with it.
   */
  async addGoogle(
    email: string,
    refreshToken: string,
    scopes: ReadonlyArray<string>
  ): Promise<void> {
    if (!scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
      throw new Error(messages(MESSAGES).googleNoCalendar)
    }

    const prisma = this.requirePrisma()
    const mail = (await this.options.database.getAccounts()).find(
      (candidate) => candidate.type === 'gmail' && sameAddress(candidate.email, email)
    )
    const existing = (
      await prisma.calendarConnection.findMany({ where: { provider: 'google' } })
    ).find((connection) => sameAddress(connection.label, email))
    // A calendar connected before keeps its id, and so its events their keys.
    const id = existing?.id ?? mail?.id ?? randomUUID()
    const now = BigInt(Date.now())
    const fields = {
      label: email,
      mailAccountId: mail?.id ?? null,
      encryptedSecret: encryptSecret(refreshToken),
      connectedAt: now,
      problem: null
    }

    await prisma.calendarConnection.upsert({
      where: { id },
      create: { id, provider: 'google', ...fields },
      update: fields
    })
    await this.firstRead(id, existing !== undefined)
  }

  /**
   * Asks Microsoft for a calendar, in the browser: of a mail connection
   * signed in with Microsoft — that account suggested — or of any Microsoft
   * account, the calendar alone. With `connectionId`, a calendar connection
   * signed in again, its account suggested and required. Resolves once its
   * events are in.
   */
  async connectMicrosoft(
    mailAccountId: string | null,
    connectionId: string | null = null
  ): Promise<CalendarConnection[]> {
    const account = mailAccountId
      ? (await this.options.database.getAccounts()).find(
          (candidate) => candidate.id === mailAccountId
        )
      : undefined
    const address =
      account?.email ??
      (connectionId ? (await this.connectionOf(connectionId, 'microsoft')).label : null)
    const granted = await this.options.microsoft.authorize(address ?? undefined, {
      mail: false,
      calendar: true
    })

    if (address && !sameAddress(granted.email, address)) {
      throw new Error(messages(MESSAGES).wrongMicrosoftAccount(granted.email, address))
    }

    await this.addMicrosoft(granted.email, granted.secret)
    return this.listConnections()
  }

  /**
   * Keeps the calendar of a Microsoft account the user granted — alone, or
   * with its mail in the same consent — and reads its events in.
   */
  async addMicrosoft(email: string, secret: string): Promise<void> {
    const prisma = this.requirePrisma()
    const mail = (await this.options.database.getAccounts()).find(
      (candidate) =>
        candidate.type === 'imap' &&
        candidate.authType === 'oauth' &&
        sameAddress(candidate.email, email)
    )
    const existing = (
      await prisma.calendarConnection.findMany({ where: { provider: 'microsoft' } })
    ).find((connection) => sameAddress(connection.label, email))
    const id = existing?.id ?? randomUUID()
    const fields = {
      label: email,
      mailAccountId: mail?.id ?? null,
      encryptedSecret: encryptSecret(secret),
      connectedAt: BigInt(Date.now()),
      problem: null
    }

    await prisma.calendarConnection.upsert({
      where: { id },
      create: { id, provider: 'microsoft', ...fields },
      update: fields
    })
    await this.firstRead(id, existing !== undefined)
  }

  /**
   * A calendar on a CalDAV server — iCloud, Fastmail, Nextcloud — signed in
   * with a user name and an (app) password, once the server took them and
   * showed its calendars. Resolves once its events are in.
   */
  async addCalDav(input: {
    serverUrl: string
    username: string
    password: string
    label: string
  }): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const url = new URL(input.serverUrl.trim())
    const serverUrl = url.toString()

    // The password goes in every request: in the clear only to a server on this computer.
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new Error(messages(MESSAGES).httpsOnly)
    }

    const known = (
      await prisma.calendarConnection.findMany({ where: { provider: 'caldav' } })
    ).find(
      (connection) =>
        connection.serverUrl === serverUrl && sameAddress(connection.username ?? '', input.username)
    )
    const id = known?.id ?? randomUUID()
    await this.verifyCalDav(id, serverUrl, input.username.trim(), input.password)

    const fields = {
      label: input.label.trim() || input.username.trim(),
      mailAccountId: null,
      serverUrl,
      username: input.username.trim(),
      encryptedSecret: encryptSecret(input.password),
      connectedAt: BigInt(Date.now()),
      problem: null
    }

    await prisma.calendarConnection.upsert({
      where: { id },
      create: { id, provider: 'caldav', ...fields },
      update: fields
    })
    await this.firstRead(id, known !== undefined)
    return this.listConnections()
  }

  /**
   * A CalDAV connection whose password the server no longer takes, signed
   * in again with a new one: kept only once the server took it and showed
   * its calendars, then read at once.
   */
  async reconnectCalDav(connectionId: string, password: string): Promise<CalendarConnection[]> {
    const connection = await this.connectionOf(connectionId, 'caldav')

    if (!connection.serverUrl || !connection.username) {
      throw new Error(messages(MESSAGES).addressMissing)
    }

    await this.verifyCalDav(connectionId, connection.serverUrl, connection.username, password)
    await this.requirePrisma().calendarConnection.update({
      where: { id: connectionId },
      data: { encryptedSecret: encryptSecret(password) }
    })
    await this.firstRead(connectionId, true)
    return this.listConnections()
  }

  /**
   * A connection put right by the user, as its kind asks: a CalDAV server
   * with its new password (`reconnectCalDav`); a certificate, a source the
   * user believes back, a link or a server without a new password, tried
   * again as it is (`retryConnection`); else the provider's sign-in done
   * again on the same account.
   */
  async reconnect(connectionId: string, password?: string): Promise<CalendarConnection[]> {
    const connection = await this.connectionOf(connectionId)
    const refusal = this.refused.get(connectionId)?.refusal

    switch (connection.provider as CalendarProviderKind) {
      case 'caldav':
        return password === undefined
          ? this.retryConnection(connectionId)
          : this.reconnectCalDav(connectionId, password)
      case 'ics':
        return this.retryConnection(connectionId)
      case 'google':
        return refusal === 'certificato' || refusal === 'sparito'
          ? this.retryConnection(connectionId)
          : this.connectGoogle(null, connectionId)
      case 'microsoft':
        return refusal === 'certificato' || refusal === 'sparito'
          ? this.retryConnection(connectionId)
          : this.connectMicrosoft(null, connectionId)
    }
  }

  /**
   * Tries a connection again at once — one turned down whose server, or
   * link, the user believes put right: turned down again, it stays stopped,
   * and the user, who asked, is told why here.
   */
  async retryConnection(connectionId: string): Promise<CalendarConnection[]> {
    await this.connectionOf(connectionId)
    await this.firstRead(connectionId, true)
    return this.listConnections()
  }

  /** Signs in to a CalDAV server, and finds calendars of events there; or says why not. */
  private async verifyCalDav(
    connectionId: string,
    serverUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    const probe = new CalDavCalendarProvider({
      serverUrl,
      username,
      password,
      fetch: this.options.fetch,
      store: this.objectStore(connectionId)
    })

    if ((await probe.listCalendars()).length === 0) {
      throw new Error(messages(MESSAGES).noEventCalendars)
    }
  }

  /** A connection by its id — of that provider, when one is said — or why it cannot be had. */
  private async connectionOf(
    connectionId: string,
    provider?: CalendarProviderKind
  ): Promise<CalendarConnectionRow> {
    const connection = await this.requirePrisma().calendarConnection.findUnique({
      where: { id: connectionId }
    })

    if (!connection || (provider && connection.provider !== provider)) {
      throw new Error(messages(MESSAGES).calendarGone)
    }

    return connection
  }

  /** A connection's CalDAV objects, kept in `calendar_objects`. */
  private objectStore(connectionId: string): CalendarObjectStore {
    const prisma = this.requirePrisma()
    const rowOf = (object: { url: string; etag: string | null; data: string }): StoredObject => ({
      url: object.url,
      etag: object.etag,
      data: object.data
    })

    return {
      list: async (calendarId) =>
        (await prisma.calendarObject.findMany({ where: { connectionId, calendarId } })).map(rowOf),
      get: async (url) => {
        const row = await prisma.calendarObject.findUnique({
          where: { connectionId_url: { connectionId, url } }
        })
        return row ? rowOf(row) : null
      },
      put: async (calendarId, objects) => {
        await prisma.$transaction(
          objects.map((object) =>
            prisma.calendarObject.upsert({
              where: { connectionId_url: { connectionId, url: object.url } },
              create: { connectionId, calendarId, ...object },
              update: { calendarId, etag: object.etag, data: object.data }
            })
          )
        )
      },
      remove: async (urls) => {
        for (let at = 0; at < urls.length; at += 500) {
          await prisma.calendarObject.deleteMany({
            where: { connectionId, url: { in: urls.slice(at, at + 500) } }
          })
        }
      },
      replace: async (calendarId, objects) => {
        await prisma.$transaction([
          prisma.calendarObject.deleteMany({ where: { connectionId, calendarId } }),
          ...objects.map((object) =>
            prisma.calendarObject.create({ data: { connectionId, calendarId, ...object } })
          )
        ])
      }
    }
  }

  /**
   * Subscribes to a calendar published at a link — read only — once the
   * link proved to be a calendar. The link often carries a secret: it is
   * kept encrypted, and shown by its server only.
   */
  async addIcs(link: string, name: string | null): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const url = feedUrl(link)
    const subscribed = await prisma.calendarConnection.findMany({ where: { provider: 'ics' } })

    if (
      subscribed.some(
        (connection) =>
          connection.encryptedSecret && decryptSecret(connection.encryptedSecret) === url
      )
    ) {
      throw new Error(messages(MESSAGES).alreadyConnected)
    }

    const response = await this.options.fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000)
    })

    if (!response.ok) {
      throw new Error(messages(MESSAGES).linkNotAnswering(response.status))
    }

    const text = await calendarText(response)

    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error(messages(MESSAGES).noIcsAtLink)
    }

    const id = randomUUID()
    await prisma.calendarConnection.create({
      data: {
        id,
        provider: 'ics',
        label: name?.trim() || calendarNameOf(text) || new URL(url).hostname,
        serverUrl: new URL(url).origin,
        encryptedSecret: encryptSecret(url),
        connectedAt: BigInt(Date.now())
      }
    })
    await this.firstRead(id, false)
    return this.listConnections()
  }

  /**
   * Forgets a calendar connection here — its calendars and events; the
   * provider keeps them. What the other apps kept of it goes after, even
   * when the removal is cut short, so nothing stays held (§11.4).
   */
  async disconnect(connectionId: string): Promise<CalendarConnection[]> {
    const prisma = this.requirePrisma()
    const [connection, calendars] = await Promise.all([
      prisma.calendarConnection.findUnique({ where: { id: connectionId } }),
      prisma.calendarCalendar.findMany({ where: { connectionId }, select: { name: true } })
    ])

    if (!connection) {
      return this.listConnections()
    }

    try {
      log.info('connection.removing', {
        conn: connectionId,
        provider: connection.provider,
        by: 'user'
      })
      await this.options.onDisconnecting?.(connectionId)
      await this.forget(connectionId)
      log.info('connection.removed', { conn: connectionId })
    } finally {
      await this.options.onDisconnected?.({
        id: connectionId,
        label: connection.label,
        provider: connection.provider as CalendarProviderKind,
        calendars: calendars.map((calendar) => calendar.name),
        since: Number(connection.connectedAt)
      })
    }

    return this.listConnections()
  }

  /** Forgets a connection here: it, its calendars, its events and what was kept to sync them. */
  private async forget(connectionId: string): Promise<void> {
    const prisma = this.requirePrisma()
    // A sync under way stops at its next calendar; it, and a write under way, end before
    // anything is forgotten, and what waits after finds the connection gone.
    this.leaving.add(connectionId)

    try {
      await this.inTurn(connectionId, () =>
        prisma.$transaction([
          prisma.calendarChange.deleteMany({ where: { connectionId } }),
          prisma.calendarEvent.deleteMany({ where: { connectionId } }),
          prisma.calendarObject.deleteMany({ where: { connectionId } }),
          prisma.calendarCalendar.deleteMany({ where: { connectionId } }),
          prisma.calendarConnection.deleteMany({ where: { id: connectionId } })
        ])
      )
      this.eventsChanged()
      this.refused.delete(connectionId)
      this.consentShort.delete(connectionId)
    } finally {
      this.leaving.delete(connectionId)
      this.scheduling.delete(connectionId)
      this.davAddresses.delete(connectionId)
    }

    this.options.send(CALENDAR_IPC.changed, null)
  }

  /**
   * A mail connection removed: a calendar that came with it stays — it has
   * its own access — and stands alone from now on.
   */
  async mailAccountRemoved(accountId: string): Promise<void> {
    await this.requirePrisma().calendarConnection.updateMany({
      where: { mailAccountId: accountId },
      data: { mailAccountId: null }
    })
  }

  /**
   * "Elimina tutti i dati": the events go, the connections stay and read them
   * anew. The calendars stay too, with what the user chose of each — hidden,
   * whose its events are —: only how far they were read goes, so the next
   * read is a first one, which is no change and tells nothing (§7.2).
   */
  async clearData(): Promise<void> {
    const prisma = this.requirePrisma()
    const connections = await prisma.calendarConnection.findMany({ select: { id: true } })
    const clear = async (): Promise<void> => {
      await prisma.$transaction([
        prisma.calendarChange.deleteMany(),
        prisma.calendarEvent.deleteMany(),
        prisma.calendarObject.deleteMany(),
        prisma.calendarCalendar.updateMany({ data: { syncToken: null, windowEnd: null } })
      ])
    }

    // In every connection's turn: a read under way would write what it had read over the empty tables.
    await this.inTurns(
      connections.map(({ id }) => id),
      clear
    )
    this.eventsChanged()
    void this.syncAll()
  }

  async syncAll(): Promise<void> {
    if (!this.prisma) {
      return
    }

    const connected = await this.prisma.calendarConnection.findMany({ select: { id: true } })
    await this.prisma.calendarChange.deleteMany({
      where: { at: { lt: BigInt(Date.now() - CHANGES_KEPT_MS) } }
    })
    // One turned down waits for the user: tried again, it would only be turned down again.
    await Promise.all(
      connected.filter((row) => !this.refused.has(row.id)).map((row) => this.sync(row.id))
    )
  }

  /**
   * Reads a connection's calendars for what changed, in its turn: one sync
   * asked for at a time, which those asking meanwhile wait for.
   */
  sync(connectionId: string): Promise<void> {
    const asked = this.syncing.get(connectionId)

    if (asked) {
      return asked
    }

    if (this.leaving.has(connectionId)) {
      return Promise.resolve()
    }

    const sync = this.inTurn(connectionId, () => this.syncConnection(connectionId)).finally(() =>
      this.syncing.delete(connectionId)
    )
    this.syncing.set(connectionId, sync)
    return sync
  }

  /**
   * Reads a connection again at once, put right — signed in again, its
   * password given, its server or link back: no longer turned down, by a
   * read that begins now — one under way began before, and is waited for.
   */
  private async reread(connectionId: string): Promise<void> {
    await this.syncing.get(connectionId)?.catch(() => undefined)
    this.refused.delete(connectionId)
    await this.sync(connectionId)
  }

  /**
   * The read the user waits for: of a connection just added, signed in
   * again by adding it anew, or put right (`retryConnection`,
   * `reconnectCalDav`). One the provider turns down for good is not added:
   * whoever asked is told why, here rather than by `onRefused`; one new goes
   * again, one known stays turned down, with what it kept. One that cannot
   * be read for now stays: it is read again by itself.
   */
  private async firstRead(connectionId: string, known: boolean): Promise<void> {
    const startedAt = Date.now()
    this.adding.add(connectionId)

    try {
      await this.reread(connectionId)
    } finally {
      this.adding.delete(connectionId)
    }

    const refused = this.refused.get(connectionId)
    // A connection added — or signed in again — as its first read went (§14.4).
    const read = {
      conn: connectionId,
      again: known,
      ms: Date.now() - startedAt,
      by: 'user' as const
    }

    if (!refused) {
      log.info('connection.added', read)
      return
    }

    log.warn('connection.not-added', { ...read, err: { message: refused.problem } })

    if (!known) {
      await this.forget(connectionId)
    }

    throw new Error(known ? refused.problem : messages(MESSAGES).notAdded(refused.problem))
  }

  /**
   * A connection turned down for good stops: no sync tries it again, and a
   * write is refused at once, until the user puts it right. They are told
   * once — unless they were adding it, and are told by that.
   */
  private async refuse(connectionId: string, found: CalendarRefusalFound): Promise<void> {
    const connection = await this.requirePrisma().calendarConnection.findUnique({
      where: { id: connectionId }
    })

    if (!connection || this.leaving.has(connectionId)) {
      return
    }

    this.refused.set(connectionId, found)

    if (!this.adding.has(connectionId)) {
      this.options.onRefused?.(
        calendarRefusedNotice(
          { ...connection, provider: connection.provider as CalendarProviderKind },
          found.refusal,
          found.detail
        )
      )
    }
  }

  /** A write on a connection turned down is refused at once: it would only be turned down too. */
  private async notRefused(connectionId: string): Promise<void> {
    const refused = this.refused.get(connectionId)

    if (refused) {
      const { label } = await this.connectionOf(connectionId)
      throw new Error(messages(MESSAGES).stopped(label, messages(STOPPED_BECAUSE)[refused.refusal]))
    }
  }

  /**
   * A sync: only in the connection's turn. What it finds is settled once
   * every calendar is read — an event gone from one and come into another
   * is a move (`settle`) —, and then the page is told.
   */
  private async syncConnection(connectionId: string): Promise<void> {
    const pass: ReadPass = { found: [] }
    await this.readConnection(connectionId, pass)

    // The events are kept as read already: what could not be noted is said, and the sync stands.
    await this.settle(pass).catch((error: unknown) =>
      log.failed('changes.not-noted', error, { conn: connectionId, changes: pass.found.length })
    )
    this.options.send(CALENDAR_IPC.changed, null)
  }

  /**
   * Reads, in their turns — which the caller holds —, the connections a
   * write touched: what they found to settle as that write's own.
   */
  private async readFor(connectionIds: ReadonlyArray<string>): Promise<ReadPass> {
    const pass: ReadPass = { found: [] }

    for (const connectionId of new Set(connectionIds)) {
      await this.readConnection(connectionId, pass)
    }

    return pass
  }

  /**
   * Reads a connection's calendars — in its turn —, what changed kept and
   * what it was found in `pass`. However it ends, the connection says so —
   * read now, or why not — so nothing waits on it unanswered. A calendar
   * that cannot be read says so, and the others are read all the same; an
   * error that turns the whole connection down — its access, its
   * authorization, its certificate, its source — wherever it comes, stops it
   * (`refuse`).
   */
  private async readConnection(connectionId: string, pass: ReadPass): Promise<void> {
    const prisma = this.requirePrisma()

    try {
      const provider = await this.providerFor(connectionId)

      if (!provider) {
        throw new Error(messages(MESSAGES).accessMissing)
      }

      const calendars = await provider.listCalendars()
      const listed = new Set(calendars.map((calendar) => calendar.calendarId))
      const known = await prisma.calendarCalendar.findMany({ where: { connectionId } })

      // A calendar the user no longer shows takes its events with it, and what was kept to sync it.
      for (const gone of known.filter((calendar) => !listed.has(calendar.calendarId))) {
        await prisma.$transaction([
          prisma.calendarEvent.deleteMany({ where: { connectionId, calendarId: gone.calendarId } }),
          prisma.calendarObject.deleteMany({
            where: { connectionId, calendarId: gone.calendarId }
          }),
          prisma.calendarCalendar.delete({
            where: { connectionId_calendarId: { connectionId, calendarId: gone.calendarId } }
          })
        ])
        this.eventsChanged()
      }

      // What the connection says is wrong, while it syncs all it can: a calendar that cannot be
      // read says so, and the others are read all the same.
      const problems: string[] = []

      // What the server is, for answering there and for knowing the user among the guests. A
      // server that could not say whether it schedules is asked again at the next sync; until
      // then it stands as it last said.
      if (provider instanceof CalDavCalendarProvider && calendars[0]) {
        this.davAddresses.set(connectionId, await provider.addresses())

        try {
          this.scheduling.set(connectionId, await provider.schedules(calendars[0].calendarId))
        } catch (error) {
          if (refusalOfCalendar(error)) {
            throw error
          }

          log.warn('caldav.scheduling-unknown', { conn: connectionId, err: error })
          problems.push(error instanceof Error ? error.message : String(error))
        }
      }

      // Connected before the mailbox's time zone was asked for: it syncs, and asks to be
      // connected again before its all-day events can be written.
      if (provider instanceof GraphCalendarProvider && !(await provider.mailboxZoneGranted())) {
        this.consentShort.add(connectionId)
        problems.push(mailboxZoneNotGranted())
      } else {
        this.consentShort.delete(connectionId)
      }

      // A CalDAV server does not say which calendar is the main one: the first it lists is taken,
      // and kept while it is there — a server listing them in another order does not move it.
      const keptMain =
        provider instanceof CalDavCalendarProvider
          ? known.find(
              (stored) =>
                stored.isPrimary === 1 &&
                calendars.some(
                  (listed) => listed.calendarId === stored.calendarId && listed.writable
                )
            )
          : undefined
      const ours = keptMain
        ? calendars.map((calendar) => ({
            ...calendar,
            primary: calendar.calendarId === keptMain.calendarId
          }))
        : calendars

      for (const calendar of ours) {
        if (this.leaving.has(connectionId)) {
          return
        }

        const stored = known.find((candidate) => candidate.calendarId === calendar.calendarId)
        await prisma.calendarCalendar.upsert({
          where: { connectionId_calendarId: { connectionId, calendarId: calendar.calendarId } },
          create: {
            connectionId,
            calendarId: calendar.calendarId,
            name: calendar.name,
            isPrimary: calendar.primary ? 1 : 0,
            writable: calendar.writable ? 1 : 0,
            color: calendar.color
          },
          update: {
            name: calendar.name,
            isPrimary: calendar.primary ? 1 : 0,
            writable: calendar.writable ? 1 : 0,
            color: calendar.color
          }
        })
        try {
          pass.found.push(
            ...(await this.syncCalendar(
              provider,
              connectionId,
              calendar.calendarId,
              stored ?? null
            ))
          )
        } catch (error) {
          if (refusalOfCalendar(error)) {
            throw error
          }

          log.warn('calendar.unreadable', {
            conn: connectionId,
            calendarId: calendar.calendarId,
            err: error
          })
          problems.push(
            messages(MESSAGES).unreadable(
              calendar.name,
              error instanceof Error ? error.message : String(error)
            )
          )
        }
      }

      await prisma.calendarConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: BigInt(Date.now()),
          problem: problems.length > 0 ? problems.join(' ') : null
        }
      })
      this.certificateToConfirm.delete(connectionId)
    } catch (error) {
      // The server's or the network's (§14.1): a refusal for good is said as such where it stops.
      log.warn('sync.failed', { conn: connectionId, err: error })
      const refused = refusalOfCalendar(error)
      await prisma.calendarConnection.updateMany({
        where: { id: connectionId },
        data: {
          problem: refused?.problem ?? (error instanceof Error ? error.message : String(error))
        }
      })

      // A certificate refused may be a hotel Wi-Fi's sign-in page answering in the server's
      // place: the next sync confirms it before the connection stops — but not while it is added.
      const confirming =
        refused?.refusal === 'certificato' &&
        !this.adding.has(connectionId) &&
        !this.certificateToConfirm.has(connectionId)

      if (confirming) {
        this.certificateToConfirm.add(connectionId)
      } else {
        this.certificateToConfirm.delete(connectionId)

        if (refused) {
          await this.refuse(connectionId, refused)
        }
      }
    }
  }

  /**
   * Settles what a read found: the events moved elsewhere from one
   * calendar to another of a connection recognised as such; what a write
   * of the app's own did (`own`) noted as the user's, or not at all for the
   * Segretario; what follows an event moved told first (`eventsMoved`);
   * then the rest noted, and told (§13.3).
   */
  private async settle(pass: ReadPass, own?: OwnWrite): Promise<void> {
    const ours = own ? pass.found.filter((change) => own.owns(change)) : []
    const { changes, moves } = movedElsewhere(
      own ? pass.found.filter((change) => !own.owns(change)) : pass.found
    )
    const ownMoves = own?.moves?.filter((move) => move.from !== move.to) ?? []

    await this.eventsMoved([...ownMoves, ...moves])
    await this.note(changes, false)

    if (!own?.byUser) {
      return
    }

    // A move by the user here is one change, under the key it has now, the event as it was before.
    const prisma = this.requirePrisma()
    const movedHere = new Set(ownMoves.flatMap((move) => [move.from, move.to]))
    const names = new Map(
      (await prisma.calendarCalendar.findMany()).map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar.name
      ])
    )
    const moved = await prisma.calendarEvent.findMany({
      where: { key: { in: ownMoves.map((move) => move.to) } }
    })
    const movedNotes = ownMoves.flatMap((move): FoundChange[] => {
      const row = moved.find((candidate) => candidate.key === move.to)
      return row
        ? [
            {
              kind: 'cambiato',
              connectionId: row.connectionId,
              key: row.key,
              before: move.before,
              beforeName: move.beforeName,
              after: providerEventOfRow(row),
              afterName: names.get(calendarKey(row.connectionId, row.calendarId)) ?? ''
            }
          ]
        : []
    })

    await this.note([...movedNotes, ...ours.filter((change) => !movedHere.has(change.key))], true)
  }

  /**
   * Events moved to another calendar, the same events there under new keys
   * (vision §7.5): what the Segretario keeps of them follows, and so do the
   * reminders given and on the screen. A part that fails to follow is said
   * in the diagnostics; the move stands.
   */
  private async eventsMoved(moves: ReadonlyArray<EventMove>): Promise<void> {
    if (moves.length === 0) {
      return
    }

    // Only the keys: what was kept of the event as it was stays here.
    const followed = moves.map(({ from, to }) => ({ from, to }))
    await Promise.all([
      this.options
        .onEventsMoved?.(followed)
        .catch((error: unknown) =>
          log.failed('moves.not-followed', error, { events: moves.length })
        ),
      this.options
        .notificationsMoved?.(followed)
        .catch((error: unknown) =>
          log.failed('moves.reminders-not-followed', error, { events: moves.length })
        )
    ])
  }

  /**
   * Notes changes in `calendar_changes`, in order, for the Segretario: the
   * user's own in the app (`inApp`), or found by a read — and those, of the
   * user's events someone else has in hand, told (§13.3).
   */
  private async note(found: ReadonlyArray<FoundChange>, inApp: boolean): Promise<void> {
    if (found.length === 0) {
      return
    }

    const prisma = this.requirePrisma()
    const at = BigInt(Date.now())

    for (let start = 0; start < found.length; start += 500) {
      await prisma.calendarChange.createMany({
        data: found.slice(start, start + 500).map((change) => ({
          connectionId: change.connectionId,
          eventKey: change.key,
          kind: change.kind,
          beforeJson: change.before
            ? JSON.stringify(eventOfRow(change.before, change.beforeName))
            : null,
          afterJson:
            change.after && !change.after.cancelled
              ? snapshotOf(change.connectionId, change.after, change.afterName)
              : null,
          inApp: inApp ? 1 : 0,
          at
        }))
      })
    }

    if (inApp) {
      return
    }

    // What a read in full no longer found is not told: it may only have left what the user sees.
    const byConnection = new Map<string, FoundChange[]>()

    for (const change of found) {
      if (change.after) {
        byConnection.set(change.connectionId, [
          ...(byConnection.get(change.connectionId) ?? []),
          change
        ])
      }
    }

    for (const [connectionId, changes] of byConnection) {
      void this.tellChangesByOthers(connectionId, changes).catch((error: unknown) =>
        log.failed('changes.not-told', error, { conn: connectionId })
      )
    }
  }

  /**
   * A calendar's events: what changed since the last read, or — the first
   * time, when the token expired, and once a day as the window slides —
   * every one from two months back to a year ahead. Resolves with what it
   * found changed, to settle with the rest of the read.
   */
  private async syncCalendar(
    provider: CalendarProvider,
    connectionId: string,
    calendarId: string,
    stored: { syncToken: string | null; windowEnd: bigint | null } | null
  ): Promise<FoundChange[]> {
    const prisma = this.requirePrisma()
    const now = Date.now()
    const fresh =
      stored?.syncToken &&
      stored.windowEnd !== null &&
      Number(stored.windowEnd) > now + WINDOW_AHEAD_MS - WINDOW_SLIDES_EVERY_MS

    if (fresh && stored.syncToken) {
      try {
        const { events, syncToken, commit } = await provider.changes(calendarId, {
          syncToken: stored.syncToken
        })
        // What changed since the last read was done elsewhere — or here, and then it is no change.
        const found = await this.applyChanges(connectionId, events, { logChanges: true })
        await commit?.()
        await prisma.calendarCalendar.update({
          where: { connectionId_calendarId: { connectionId, calendarId } },
          data: { syncToken }
        })
        return found
      } catch (error) {
        if (!(error instanceof SyncTokenExpired)) {
          throw error
        }
      }
    }

    const windowEnd = now + WINDOW_AHEAD_MS
    const { events, syncToken, commit } = await provider.changes(calendarId, {
      fromIso: new Date(now - WINDOW_BACK_MS).toISOString(),
      toIso: new Date(windowEnd).toISOString()
    })

    // Kept as read, then what is no longer there goes: an event the Segretario put
    // there keeps saying so, where the provider does not give it back. A calendar read
    // before is compared with what it was — a link is read whole each time it changes, an
    // expired token starts over — so what changed elsewhere is noted all the same; the
    // first read of a calendar is no change.
    const readBefore = stored !== null && stored.windowEnd !== null
    const found = await this.applyChanges(connectionId, events, {
      logChanges: readBefore,
      slidFrom: readBefore ? Number(stored.windowEnd) : undefined
    })
    const read = new Set(
      events
        .filter((event) => !event.cancelled)
        .map((event) => eventKey(connectionId, event.calendarId, event.eventId))
    )
    const windowStart = now - WINDOW_BACK_MS
    const gone = (
      await prisma.calendarEvent.findMany({ where: { connectionId, calendarId } })
    ).filter((row) => !read.has(row.key))

    if (readBefore) {
      const name =
        (
          await prisma.calendarCalendar.findUnique({
            where: { connectionId_calendarId: { connectionId, calendarId } },
            select: { name: true }
          })
        )?.name ?? ''
      // Only an event that should still be read is gone: one that ended before the window
      // merely left it, and one beyond it — moved there, or changed there, and so kept —
      // was not read.
      found.push(
        ...gone
          .filter((row) => Number(row.endsAt) > windowStart && Number(row.startsAt) < windowEnd)
          .map((row): FoundChange => ({
            kind: 'annullato',
            connectionId,
            key: row.key,
            before: row,
            beforeName: name,
            after: null,
            afterName: name
          }))
      )
    }

    const goneKeys = gone.map((row) => row.key)

    for (let at = 0; at < goneKeys.length; at += 500) {
      await prisma.calendarEvent.deleteMany({
        where: { key: { in: goneKeys.slice(at, at + 500) } }
      })
    }

    if (goneKeys.length > 0) {
      this.eventsChanged()
    }

    await commit?.()

    await prisma.calendarCalendar.update({
      where: { connectionId_calendarId: { connectionId, calendarId } },
      data: { syncToken, windowEnd: BigInt(windowEnd) }
    })
    return found
  }

  /**
   * Keeps events as the provider gives them. With `logChanges`, resolves
   * with what is new, different or cancelled compared with what was kept —
   * to note for the Segretario (`note`): the sync's finds, and the user's
   * own writes in the app. Not, after `slidFrom` — where the window ended
   * before it slid —, an instance of a series the window already held: the
   * time passing is no change; a series, or an event, new there is one. The
   * rule of a series read is every instance's, those not read again too.
   */
  private async applyChanges(
    connectionId: string,
    events: ReadonlyArray<ProviderEvent>,
    options: { logChanges?: boolean; slidFrom?: number } = {}
  ): Promise<FoundChange[]> {
    const prisma = this.requirePrisma()
    const keyOf = (event: ProviderEvent): string =>
      eventKey(connectionId, event.calendarId, event.eventId)
    const kept = options.logChanges
      ? new Map(
          (
            await prisma.calendarEvent.findMany({
              where: { key: { in: events.map(keyOf) } }
            })
          ).map((row) => [row.key, row])
        )
      : new Map<string, CalendarEventRow>()
    const names = options.logChanges
      ? new Map(
          (await prisma.calendarCalendar.findMany({ where: { connectionId } })).map((calendar) => [
            calendar.calendarId,
            calendar.name
          ])
        )
      : new Map<string, string>()
    const writes: Prisma.PrismaPromise<unknown>[] = []
    // The series the window held before it slid: those of the instances read that start before.
    const { slidFrom } = options
    const heldSeries =
      slidFrom === undefined
        ? new Set<string>()
        : new Set(
            events
              .filter((event) => event.seriesId !== null && event.startsAt < slidFrom)
              .map((event) => `${event.calendarId}\u0000${event.seriesId}`)
          )
    const cameInto = (event: ProviderEvent): boolean =>
      slidFrom !== undefined &&
      event.startsAt >= slidFrom &&
      event.seriesId !== null &&
      heldSeries.has(`${event.calendarId}\u0000${event.seriesId}`)
    const found: FoundChange[] = []
    const rules = new Map<string, { calendarId: string; seriesId: string; json: string | null }>()

    for (const event of events) {
      const key = keyOf(event)
      const before = kept.get(key)

      if (options.logChanges) {
        const kind = event.cancelled
          ? before
            ? 'annullato'
            : null
          : !before
            ? cameInto(event)
              ? null
              : 'nuovo'
            : differs(before, event)
              ? 'cambiato'
              : null

        if (kind) {
          found.push({
            kind,
            connectionId,
            key,
            before: before ?? null,
            beforeName: before ? (names.get(before.calendarId) ?? '') : '',
            after: event,
            afterName: names.get(event.calendarId) ?? ''
          })
        }
      }

      if (event.cancelled) {
        writes.push(prisma.calendarEvent.deleteMany({ where: { key } }))
        continue
      }

      if (event.seriesId !== null && event.recurrence !== undefined) {
        rules.set(`${event.calendarId}\u0000${event.seriesId}`, {
          calendarId: event.calendarId,
          seriesId: event.seriesId,
          json: event.recurrence === null ? null : JSON.stringify(event.recurrence)
        })
      }

      const data = {
        connectionId,
        calendarId: event.calendarId,
        eventId: event.eventId,
        iCalUid: event.iCalUid ? canonicalUid(event.iCalUid) : null,
        seriesId: event.seriesId,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay ? 1 : 0,
        startsAt: BigInt(event.startsAt),
        endsAt: BigInt(event.endsAt),
        location: event.location,
        description: event.description,
        attendeesJson: JSON.stringify(event.attendees),
        organizer: event.organizer,
        creator: event.creator ?? null,
        myResponse: event.myResponse,
        meetLink: event.meetLink,
        htmlLink: event.htmlLink,
        originJson: event.origin ? JSON.stringify(event.origin) : null,
        // Absent: the provider could not tell them now — what was kept of them stays.
        remindersJson:
          event.reminders === undefined
            ? undefined
            : event.reminders === null
              ? null
              : JSON.stringify(event.reminders),
        recurrenceJson:
          event.recurrence === undefined
            ? undefined
            : event.recurrence === null
              ? null
              : JSON.stringify(event.recurrence),
        managedBy: event.managedBy ?? null
      }

      writes.push(
        prisma.calendarEvent.upsert({
          where: { key },
          create: {
            key,
            ...data,
            remindersJson: data.remindersJson ?? null,
            recurrenceJson: data.recurrenceJson ?? null
          },
          // A provider that does not give the origin back (Graph, as it syncs) leaves it as kept.
          update: { ...data, originJson: data.originJson ?? undefined }
        })
      )
    }

    // A series' rule, as read now, is all its instances' — those this read did not bring too.
    for (const rule of rules.values()) {
      writes.push(
        prisma.calendarEvent.updateMany({
          where: { connectionId, calendarId: rule.calendarId, seriesId: rule.seriesId },
          data: { recurrenceJson: rule.json }
        })
      )
    }

    await prisma.$transaction(writes)

    if (events.length > 0) {
      this.eventsChanged()
    }

    return found
  }

  /**
   * What changed in the calendars elsewhere after a point, the oldest first;
   * each event saying whether it is the user's (§7.4), as things are now.
   */
  async changesSince(afterId: number, limit: number): Promise<CalendarChange[]> {
    const rows = await this.requirePrisma().calendarChange.findMany({
      where: { id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: limit
    })
    const changes = rows.flatMap((row): CalendarChange[] => {
      const before = row.beforeJson ? (JSON.parse(row.beforeJson) as CalendarEvent) : null
      const after = row.afterJson ? (JSON.parse(row.afterJson) as CalendarEvent) : null
      const event = after ?? before
      return event
        ? [
            {
              id: row.id,
              kind: row.kind as CalendarChange['kind'],
              inApp: row.inApp === 1,
              event,
              before,
              at: Number(row.at)
            }
          ]
        : []
    })
    const yours = await this.yoursKeys(
      changes.map((change) => ({ ...change.event, ...instantsOf(change.event) })),
      await this.ownership(),
      false
    )

    return changes.map((change) => ({
      ...change,
      event: { ...change.event, yours: yours.has(change.event.key) }
    }))
  }

  /** The point the changes noted so far reach. */
  async latestChangeId(): Promise<number> {
    const row = await this.requirePrisma().calendarChange.findFirst({ orderBy: { id: 'desc' } })
    return row?.id ?? 0
  }

  /** The provider a connection speaks through, with its access; null when it is gone. */
  private async providerFor(connectionId: string): Promise<CalendarProvider | null> {
    const connection = await this.requirePrisma().calendarConnection.findUnique({
      where: { id: connectionId }
    })

    if (!connection) {
      return null
    }

    switch (connection.provider as CalendarProviderKind) {
      case 'google':
        return connection.encryptedSecret
          ? new GoogleCalendarProvider(
              this.options.oauth.client(decryptSecret(connection.encryptedSecret)),
              connection.label
            )
          : null
      case 'microsoft': {
        const secret = connection.encryptedSecret

        if (!secret) {
          return null
        }

        const token = (scopes: ReadonlyArray<string>): Promise<string> =>
          this.options.microsoft.accessToken(decryptSecret(secret), scopes, async (renewed) => {
            await this.requirePrisma().calendarConnection.updateMany({
              where: { id: connectionId },
              data: { encryptedSecret: encryptSecret(renewed) }
            })
          })

        return new GraphCalendarProvider(
          {
            calendar: () => token(MICROSOFT_CALENDAR_SCOPES),
            // A calendar connected before the time zone was asked for has no consent to it.
            mailboxSettings: () =>
              token(MICROSOFT_MAILBOX_SETTINGS_SCOPES).catch((error: unknown) => {
                if (error instanceof MicrosoftSignInNeeded) {
                  return null
                }

                throw error
              })
          },
          connection.label,
          this.options.fetch
        )
      }
      case 'caldav':
        return connection.encryptedSecret && connection.serverUrl && connection.username
          ? new CalDavCalendarProvider({
              serverUrl: connection.serverUrl,
              username: connection.username,
              password: decryptSecret(connection.encryptedSecret),
              fetch: this.options.fetch,
              store: this.objectStore(connectionId)
            })
          : null
      case 'ics':
        return connection.encryptedSecret
          ? new IcsCalendarProvider(
              decryptSecret(connection.encryptedSecret),
              connection.label,
              this.options.fetch
            )
          : null
      default:
        return null
    }
  }

  /**
   * The user's addresses (`ownAddresses`); and with them the calendars they
   * write in that go by an address — a colleague's shared with them, a
   * Google secondary calendar — whose events they may change as the
   * calendar (`writing`).
   */
  private async userAddresses(): Promise<{ own: Set<string>; writing: Set<string> }> {
    const prisma = this.requirePrisma()
    const [accounts, connections, writable] = await Promise.all([
      this.options.database.getAccounts(),
      prisma.calendarConnection.findMany({
        select: { provider: true, label: true, username: true }
      }),
      prisma.calendarCalendar.findMany({ where: { writable: 1 }, select: { calendarId: true } })
    ])
    const own = ownAddresses(
      accounts.map((account) => account.email),
      connections,
      [...this.davAddresses.values()]
    )

    return {
      own,
      writing: new Set([
        ...own,
        ...writable.flatMap((calendar) => addressOrNull(calendar.calendarId) ?? [])
      ])
    }
  }

  /** What the Segretario found of whose things are (§7.4): null with the AI off, or not to be read. */
  private async segretarioOwnership(): Promise<SegretarioOwnership | null> {
    return this.options.ownership
      ? this.options.ownership().catch((error: unknown) => {
          log.failed('ownership.unknown', error)
          return null
        })
      : null
  }

  /**
   * Whose things are, now (§7.4): every calendar with its role, the user's
   * own addresses, and what the Segretario found.
   */
  private async ownership(): Promise<Ownership> {
    const prisma = this.requirePrisma()
    const [calendars, connections, { own }, segretario] = await Promise.all([
      prisma.calendarCalendar.findMany(),
      prisma.calendarConnection.findMany({ select: { id: true, provider: true } }),
      this.userAddresses(),
      this.segretarioOwnership()
    ])
    const providers = new Map(connections.map((connection) => [connection.id, connection.provider]))

    return {
      calendars: new Map(
        calendars.map((calendar) => [
          calendarKey(calendar.connectionId, calendar.calendarId),
          {
            role: roleOf(calendarFacts(calendar, providers), segretario).role,
            primary: calendar.isPrimary === 1,
            writable: calendar.writable === 1
          }
        ])
      ),
      own,
      segretario
    }
  }

  /**
   * The keys of the events that are the user's (§7.4), each once among its
   * copies: the copies kept in other calendars are looked for too, unless
   * `whole` — a span read whole brings them all.
   */
  private async yoursKeys(
    events: ReadonlyArray<Whose>,
    ownership: Ownership,
    whole: boolean
  ): Promise<Set<string>> {
    const uids = [...new Set(events.flatMap((event) => (event.iCalUid ? [event.iCalUid] : [])))]

    if (whole || uids.length === 0) {
      return yoursAmong(events, ownership)
    }

    const keys = new Set(events.map((event) => event.key))
    const copies = await this.requirePrisma().calendarEvent.findMany({
      where: { iCalUid: { in: uids } }
    })

    return yoursAmong(
      events,
      ownership,
      copies
        .filter((row) => !keys.has(row.key))
        .map((row) => ({ ...eventOfRow(row, ''), startsAt: Number(row.startsAt) }))
    )
  }

  /** The events, each saying whether it is the user's (§7.4) — see `yoursKeys`. */
  private async withYours(
    events: ReadonlyArray<CalendarEvent>,
    whole: boolean
  ): Promise<CalendarEvent[]> {
    if (events.length === 0) {
      return []
    }

    const yours = await this.yoursKeys(
      events.map((event) => ({ ...event, ...instantsOf(event) })),
      await this.ownership(),
      whole
    )

    return events.map((event) => ({ ...event, yours: yours.has(event.key) }))
  }

  /**
   * Whose things are changed — the user chose a calendar's role, the
   * Segretario found something theirs, the AI went on or off —: what
   * reminds and what shows them looks again.
   */
  ownershipChanged(): void {
    this.eventsChanged()
    this.options.send(CALENDAR_IPC.changed, null)
  }

  /**
   * Whether a connection's calendars tell the organizer of an answer, and
   * the guests of a change: Google and Microsoft do; a CalDAV server when
   * it says it schedules; a link is only read.
   */
  private schedules(provider: string, connectionId: string): boolean {
    switch (provider as CalendarProviderKind) {
      case 'google':
      case 'microsoft':
        return true
      case 'caldav':
        return this.scheduling.get(connectionId) === true
      default:
        return false
    }
  }

  /** The events between two instants, every connected calendar's, in order. */
  async events(fromIso: string, toIso: string): Promise<CalendarEvent[]> {
    const prisma = this.requirePrisma()
    const [rows, calendars, addresses] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          startsAt: { lt: BigInt(Date.parse(toIso)) },
          endsAt: { gt: BigInt(Date.parse(fromIso)) }
        },
        orderBy: [{ startsAt: 'asc' }, { title: 'asc' }]
      }),
      prisma.calendarCalendar.findMany(),
      this.userAddresses()
    ])
    const names = new Map(
      calendars.map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar.name
      ])
    )

    return this.withYours(
      rows.map((row) =>
        eventOfRow(
          row,
          names.get(calendarKey(row.connectionId, row.calendarId)) ?? '',
          addresses.writing
        )
      ),
      true
    )
  }

  /**
   * The events kept — the past the calendars still hold and the year ahead
   * — that have every word searched for, case and accents aside: the ones
   * to come first, the soonest first, then the past, the latest first
   * (`findEvents`). For the Calendario's search and the Segretario's.
   */
  async search(query: CalendarSearchQuery): Promise<CalendarSearchResult> {
    const prisma = this.requirePrisma()
    const words = calendarSearchWords(query.text)

    if (words.length === 0) {
      return { upcoming: [], past: [], more: 0 }
    }

    const [index, calendars] = await Promise.all([
      this.indexed(),
      prisma.calendarCalendar.findMany()
    ])
    const names = new Map(
      calendars.map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar.name
      ])
    )
    const found = findEvents(
      index,
      names,
      {
        words,
        from: query.fromIso === undefined ? undefined : Date.parse(query.fromIso),
        to: query.toIso === undefined ? undefined : Date.parse(query.toIso),
        calendarKeys: query.calendarKeys ? new Set(query.calendarKeys) : undefined,
        limit: query.limit ?? DEFAULT_SEARCH_LIMIT
      },
      Date.now()
    )
    const [rows, addresses] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { key: { in: [...found.upcoming, ...found.past].map((event) => event.key) } }
      }),
      this.userAddresses()
    ])
    const rowsByKey = new Map(rows.map((row) => [row.key, row]))
    // Read as they are now: one taken away since the index was made is left out.
    const kept = (events: ReadonlyArray<IndexedEvent>): CalendarEvent[] =>
      events.flatMap((event) => {
        const row = rowsByKey.get(event.key)
        return row ? [eventOfRow(row, names.get(event.calendarKey) ?? '', addresses.writing)] : []
      })

    const upcoming = kept(found.upcoming)
    const marked = await this.withYours([...upcoming, ...kept(found.past)], false)

    return {
      upcoming: marked.slice(0, upcoming.length),
      past: marked.slice(upcoming.length),
      more: found.more
    }
  }

  /** Every event kept, as searches read it: made once, until the events change. */
  private indexed(): Promise<IndexedEvent[]> {
    if (this.searchIndex) {
      return this.searchIndex
    }

    const made = this.requirePrisma()
      .calendarEvent.findMany({
        select: {
          key: true,
          connectionId: true,
          calendarId: true,
          startsAt: true,
          endsAt: true,
          title: true,
          location: true,
          description: true,
          attendeesJson: true,
          organizer: true
        }
      })
      .then((rows) =>
        rows.map((row) => ({
          key: row.key,
          calendarKey: calendarKey(row.connectionId, row.calendarId),
          startsAt: Number(row.startsAt),
          endsAt: Number(row.endsAt),
          title: row.title,
          text: eventSearchText({
            ...row,
            attendees: JSON.parse(row.attendeesJson) as CalendarAttendee[]
          })
        }))
      )

    this.searchIndex = made
    // A read that failed is not kept: the next search reads again.
    made.catch(() => {
      if (this.searchIndex === made) {
        this.searchIndex = null
      }
    })
    return made
  }

  /**
   * The events kept changed: what searches read of them is made again at
   * the next one. A read under way when they change is not kept either.
   */
  private eventsChanged(): void {
    this.searchIndex = null
    this.options.onEventsChanged?.()
  }

  /**
   * An event as it is — or, gone, as its last change kept it: what the
   * Segretario tells the user of an event cancelled (§13.3).
   */
  async eventAsKept(key: string): Promise<{ event: CalendarEvent; gone: boolean } | null> {
    const current = await this.event(key)

    if (current) {
      return { event: current, gone: false }
    }

    const change = await this.requirePrisma().calendarChange.findFirst({
      where: { eventKey: key },
      orderBy: { id: 'desc' }
    })
    const kept = change?.afterJson ?? change?.beforeJson
    return kept ? { event: JSON.parse(kept) as CalendarEvent, gone: true } : null
  }

  /**
   * The events that remind (§13.3): the user's (§7.4), from `from` to `to`,
   * in a calendar they show — each once among its copies —, with their own
   * reminders and their calendar's name. In a calendar that is not theirs
   * the alarms are whoever keeps it's: one of the user's there with none
   * of its own takes the user's lead.
   */
  async remindable(from: number, to: number): Promise<RemindedEvent[]> {
    const prisma = this.requirePrisma()
    const [rows, calendars, ownership] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { endsAt: { gt: BigInt(from) }, startsAt: { lt: BigInt(to) } }
      }),
      prisma.calendarCalendar.findMany(),
      this.ownership()
    ])
    const shown = new Map(
      calendars
        .filter((calendar) => calendar.hidden !== 1)
        .map((calendar) => [calendarKey(calendar.connectionId, calendar.calendarId), calendar.name])
    )
    const events = rows.flatMap((row) => {
      const calendarName = shown.get(calendarKey(row.connectionId, row.calendarId))
      return calendarName === undefined
        ? []
        : [{ ...eventOfRow(row, calendarName), startsAt: Number(row.startsAt), row }]
    })
    const yours = yoursAmong(events, ownership)

    return events.flatMap(({ row, ...event }): RemindedEvent[] => {
      if (!yours.has(event.key)) {
        return []
      }

      const theirs =
        ownership.calendars.get(calendarKey(event.connectionId, event.calendarId))?.role === 'tutti'
      const own = event.reminders ?? null

      return [
        {
          key: event.key,
          title: event.title,
          calendarName: event.calendarName,
          allDay: event.allDay,
          startsAt: event.startsAt,
          endsAt: Number(row.endsAt),
          location: event.location,
          meetLink: event.meetLink,
          reminders: theirs || (own !== null && own.length > 0) ? own : null
        }
      ]
    })
  }

  /**
   * What a sync found changed, worth telling the user (§13.3): a novelty of
   * an event of theirs (§7.4) that someone else has in hand — an invitation,
   * an event moved, put elsewhere or cancelled by whoever organises it, one
   * someone else put in their calendar —, still to come. Not one of their
   * own that changed: they changed it themselves, elsewhere. Only where and
   * when it is; a series changed whole is one change; an invitation of a
   * calendar that came with a mailbox connected, the organiser's mail tells.
   */
  private async tellChangesByOthers(
    connectionId: string,
    found: ReadonlyArray<FoundChange>
  ): Promise<void> {
    const prisma = this.requirePrisma()
    const [connection, accounts, ownership, through] = await Promise.all([
      prisma.calendarConnection.findUnique({ where: { id: connectionId } }),
      this.options.database.getAccounts(),
      this.ownership(),
      this.latestChangeId()
    ])

    if (!connection) {
      return
    }

    const mailTells =
      connection.mailAccountId !== null &&
      accounts.some((account) => account.id === connection.mailAccountId)
    const now = Date.now()
    const timed = (
      event: CalendarEvent,
      startsAt: number,
      endsAt: number
    ): ChangeByOthers['event'] => ({
      ...event,
      startsAt,
      endsAt
    })
    const changes = found.flatMap((change): ChangeByOthers[] => {
      const before = change.before
        ? timed(
            eventOfRow(change.before, change.beforeName),
            Number(change.before.startsAt),
            Number(change.before.endsAt)
          )
        : null
      const after =
        change.kind === 'annullato' || !change.after
          ? before
          : timed(
              {
                ...change.after,
                key: change.key,
                connectionId,
                calendarName: change.afterName
              },
              change.after.startsAt,
              change.after.endsAt
            )

      if (!after || after.endsAt <= now) {
        return []
      }

      // Only where and when it is: who answered, or a word of its description, is no news.
      if (
        change.kind === 'cambiato' &&
        before &&
        before.startsAt === after.startsAt &&
        before.endsAt === after.endsAt &&
        before.location === after.location
      ) {
        return []
      }

      return [{ kind: change.kind, event: after, before, by: null, instances: 1 }]
    })
    // The user's, once among its copies — those this sync brings, and those kept elsewhere.
    const yours = await this.yoursKeys(
      changes.map((change) => change.event),
      ownership,
      false
    )
    const told = changes.flatMap((change): ChangeByOthers[] =>
      yours.has(change.event.key) &&
      inOthersHands(change.event, ownership.own) &&
      !(mailTells && invited(change.event, ownership.own))
        ? [{ ...change, by: handledBy(change.event, ownership.own) }]
        : []
    )
    // A series moved or cancelled whole: one change, its next time standing for the rest.
    const bySeries = new Map<string, ChangeByOthers>()

    for (const change of told.sort((a, b) => a.event.startsAt - b.event.startsAt)) {
      const { seriesId, calendarId } = change.event
      const key = seriesId
        ? `${change.kind}\u0000${calendarId}\u0000${seriesId}`
        : `\u0001${change.event.key}`
      const first = bySeries.get(key)

      if (first) {
        first.instances += 1
      } else {
        bySeries.set(key, change)
      }
    }

    if (bySeries.size > 0) {
      this.options.onChangedByOthers?.(connection.label, [...bySeries.values()], through)
    }
  }

  /**
   * A write to a calendar, written down once done (§14.4), with who made it:
   * the user here, or the Segretario — whose run has it in full.
   */
  private async written<T>(
    ev: string,
    conn: string,
    options: { byUser?: boolean; actor?: DiagnosticActor },
    work: Promise<T>,
    fields: DiagnosticFields = {}
  ): Promise<T> {
    const result = await work
    log.info(ev, {
      ...fields,
      conn,
      by: options.actor ?? (options.byUser ? 'user' : 'segretario')
    })
    return result
  }

  /**
   * The event an invitation that came to a mail account is for, in any
   * calendar connected — of a whole series its next instance, of one
   * instance (`instance`) that one — where the user answers it as the one
   * it was sent to: a calendar of theirs they write in, which tells the
   * organizer; the one that came with the mail's account first, its main
   * calendar first. Else the user's own copy of an event they organise.
   * Else none: the answer goes to the organizer by mail.
   */
  async eventByUid(
    iCalUid: string,
    mailAccountId: string | null,
    instance: InvitationInstance | null = null
  ): Promise<CalendarEvent | null> {
    const prisma = this.requirePrisma()
    const [rows, connections, calendars, addresses, accounts] = await Promise.all([
      prisma.calendarEvent.findMany({ where: { iCalUid: canonicalUid(iCalUid) } }),
      prisma.calendarConnection.findMany({
        select: { id: true, provider: true, mailAccountId: true }
      }),
      prisma.calendarCalendar.findMany(),
      this.userAddresses(),
      this.options.database.getAccounts()
    ])
    const invited = invitedAddresses(
      accounts.find((account) => account.id === mailAccountId)?.email ?? null,
      [...this.davAddresses.values()]
    )
    const connectionsById = new Map(connections.map((connection) => [connection.id, connection]))
    const calendarsByKey = new Map(
      calendars.map((calendar) => [
        calendarKey(calendar.connectionId, calendar.calendarId),
        calendar
      ])
    )
    const chosen = invitationEvent(
      rows.flatMap((row) => {
        const connection = connectionsById.get(row.connectionId)
        const calendar = calendarsByKey.get(calendarKey(row.connectionId, row.calendarId))
        const event = calendar ? eventOfRow(row, calendar.name, addresses.writing) : null

        return connection && calendar && event
          ? [
              {
                found: event,
                event: { ...event, startsAt: Number(row.startsAt), endsAt: Number(row.endsAt) },
                answerable:
                  calendar.writable === 1 && this.schedules(connection.provider, connection.id),
                primary: calendar.isPrimary === 1,
                sameAccount: mailAccountId !== null && connection.mailAccountId === mailAccountId
              }
            ]
          : []
      }),
      instance,
      { own: addresses.own, invited },
      Date.now()
    )

    return chosen?.found ?? null
  }

  async respond(
    key: string,
    response: Exclude<CalendarResponse, 'needsAction'>,
    options: { series?: boolean; byUser?: boolean; actor?: DiagnosticActor } = {}
  ): Promise<CalendarEvent> {
    return this.written(
      'event.responded',
      connectionOfKey(key),
      options,
      this.inTurn(connectionOfKey(key), async () => {
        await this.notRefused(connectionOfKey(key))
        const row = await this.requirePrisma().calendarEvent.findUnique({ where: { key } })
        const provider = row ? await this.providerFor(row.connectionId) : null

        if (!row || !provider) {
          throw new Error(messages(MESSAGES).eventGone)
        }

        const series = options.series === true
        const answered = await provider.respond(row.calendarId, row.eventId, response, series)

        if (series) {
          // The series answered: its instances, kept one by one, are read again as they are
          // now — by a read that begins after the answer, not by one that began before it.
          const pass = await this.readFor([row.connectionId])
          await this.settle(pass, {
            byUser: options.byUser === true,
            owns: this.seriesOwns(row.connectionId, row.calendarId, row.seriesId ?? row.eventId)
          })
          this.options.send(CALENDAR_IPC.changed, null)
          return this.eventOrThrow(key)
        }

        await this.note(
          await this.applyChanges(row.connectionId, [answered], { logChanges: options.byUser }),
          true
        )
        this.options.send(CALENDAR_IPC.changed, null)
        return this.eventOrThrow(eventKey(row.connectionId, row.calendarId, answered.eventId))
      }),
      { response }
    )
  }

  /** Every connected calendar, the main ones first: for the Calendario app and the Segretario. */
  async calendars(): Promise<CalendarListEntry[]> {
    const prisma = this.requirePrisma()
    const [rows, connections, segretario] = await Promise.all([
      prisma.calendarCalendar.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] }),
      prisma.calendarConnection.findMany({ select: { id: true, label: true, provider: true } }),
      this.segretarioOwnership()
    ])
    const labels = new Map(connections.map((connection) => [connection.id, connection.label]))
    const providers = new Map(connections.map((connection) => [connection.id, connection.provider]))

    return rows.map((row) => {
      const role = roleOf(calendarFacts(row, providers), segretario)

      return {
        key: calendarKey(row.connectionId, row.calendarId),
        connectionId: row.connectionId,
        connection: labels.get(row.connectionId) ?? '',
        name: row.name,
        primary: row.isPrimary === 1,
        writable: row.writable === 1,
        color: row.color,
        hidden: row.hidden === 1,
        provider: (providers.get(row.connectionId) ?? 'ics') as CalendarProviderKind,
        role: role.role,
        roleBy: role.by,
        roleReason: role.reason
      }
    })
  }

  /** Shows or hides a calendar's events in the Calendario app: a choice of this computer's. */
  async setCalendarHidden(key: string, hidden: boolean): Promise<CalendarListEntry[]> {
    const prisma = this.requirePrisma()
    const calendar = (await prisma.calendarCalendar.findMany()).find(
      (candidate) => calendarKey(candidate.connectionId, candidate.calendarId) === key
    )

    if (!calendar) {
      throw new Error(messages(MESSAGES).calendarGone)
    }

    await prisma.calendarCalendar.update({
      where: {
        connectionId_calendarId: {
          connectionId: calendar.connectionId,
          calendarId: calendar.calendarId
        }
      },
      data: { hidden: hidden ? 1 : 0 }
    })
    this.options.send(CALENDAR_IPC.changed, null)
    return this.calendars()
  }

  /**
   * Whose a calendar's events are, as the user says (§7.4) — from Settings,
   * or to the Segretario in chat —: their word stands over the
   * Segretario's. Null gives it back to the Segretario, or to the default.
   */
  async setCalendarRole(key: string, role: CalendarRole | null): Promise<CalendarListEntry[]> {
    const prisma = this.requirePrisma()
    const calendar = (await prisma.calendarCalendar.findMany()).find(
      (candidate) => calendarKey(candidate.connectionId, candidate.calendarId) === key
    )

    if (!calendar) {
      throw new Error(messages(MESSAGES).calendarGone)
    }

    await prisma.calendarCalendar.update({
      where: {
        connectionId_calendarId: {
          connectionId: calendar.connectionId,
          calendarId: calendar.calendarId
        }
      },
      data: { role }
    })
    log.info('calendar.role', { conn: calendar.connectionId, role: role ?? 'default', by: 'user' })
    this.ownershipChanged()
    return this.calendars()
  }

  /**
   * Whose an event is as its calendar alone says it (§7.4) — its calendar's
   * role, and whether the calendar makes it the user's —, what the Segretario
   * found left out: where the user may put the Segretario right. Null when
   * the event is gone.
   */
  async calendarSays(key: string): Promise<{ role: CalendarRole; yours: boolean } | null> {
    const row = await this.requirePrisma().calendarEvent.findUnique({ where: { key } })

    if (!row) {
      return null
    }

    const ownership = await this.ownership()
    const calendar = ownership.calendars.get(calendarKey(row.connectionId, row.calendarId))

    return {
      role: calendar?.role ?? 'propri',
      yours: eventIsYours(
        { ...eventOfRow(row, ''), startsAt: Number(row.startsAt) },
        { ...ownership, segretario: null }
      )
    }
  }

  /** An event by its key, as it is now — saying whether it is the user's —; null when it is gone. */
  async event(key: string): Promise<CalendarEvent | null> {
    const event = await this.eventOrThrow(key).catch(() => null)
    return event ? ((await this.withYours([event], false))[0] ?? null) : null
  }

  /**
   * Adds an event to a calendar; whoever is invited gets the provider's
   * invitation. A series is read in once written: its instances, as its
   * calendar makes them, resolving with the first. `byUser`: the user added
   * it in the app — noted for the Segretario, as a change done elsewhere is
   * (`note`).
   */
  async create(
    event: NewCalendarEvent,
    options: { byUser?: boolean; actor?: DiagnosticActor } = {}
  ): Promise<CalendarEvent> {
    return this.written(
      'event.created',
      connectionOfKey(event.calendarKey),
      options,
      this.inTurn(connectionOfKey(event.calendarKey), async () => {
        await this.notRefused(connectionOfKey(event.calendarKey))
        const prisma = this.requirePrisma()
        const calendar = (await prisma.calendarCalendar.findMany()).find(
          (candidate) =>
            calendarKey(candidate.connectionId, candidate.calendarId) === event.calendarKey
        )
        const provider = calendar ? await this.providerFor(calendar.connectionId) : null

        if (!provider || !calendar) {
          throw new Error(messages(MESSAGES).calendarGone)
        }

        if (calendar.writable !== 1) {
          throw new Error(messages(MESSAGES).readOnly(calendar.name))
        }

        const input: ProviderEventInput = {
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          location: event.location,
          description: event.description,
          attendees: event.attendees,
          recurrence: event.recurrence ?? null,
          reminders: event.reminders ?? null
        }

        checkRule(input)
        const created = await provider.create(calendar.calendarId, input, event.origin ?? null)

        if (!input.recurrence) {
          await this.note(
            await this.applyChanges(calendar.connectionId, [created], {
              logChanges: options.byUser
            }),
            true
          )
          this.options.send(CALENDAR_IPC.changed, null)
          return this.eventOrThrow(
            eventKey(calendar.connectionId, calendar.calendarId, created.eventId)
          )
        }

        // A series: its instances, as its calendar makes them, are read in — the first is the event.
        const seriesId = created.seriesId ?? created.eventId
        const pass = await this.readFor([calendar.connectionId])
        await this.settle(pass, {
          byUser: options.byUser === true,
          owns: this.seriesOwns(calendar.connectionId, calendar.calendarId, seriesId)
        })
        this.options.send(CALENDAR_IPC.changed, null)
        const [first] = (
          await this.seriesRows(calendar.connectionId, calendar.calendarId, seriesId)
        ).sort((a, b) => Number(a.startsAt) - Number(b.startsAt))

        return first
          ? this.eventOrThrow(first.key)
          : unkept(created, calendar.connectionId, calendar.name)
      }),
      {
        recurrence: event.recurrence?.frequency ?? null,
        reminders:
          event.reminders === undefined || event.reminders === null
            ? 'calendar'
            : event.reminders.length
      }
    )
  }

  /**
   * Changes an event as given — only what really changes, the rest left as
   * the provider has it — and whoever is invited, before or now, is told.
   * With `series`, an instance's whole series; how an event repeats is
   * always its series' (`recurrence`: a rule makes one event a series, null
   * makes a series the one event the instance is). A new calendar
   * (`calendarKey`) moves it there, a series whole, and the rest of the
   * change is made there. Resolves with the event as it is now, under its
   * key now.
   */
  async update(
    key: string,
    change: EventChange,
    options: { series?: boolean; byUser?: boolean; actor?: DiagnosticActor } = {}
  ): Promise<CalendarEvent> {
    const connections = [
      connectionOfKey(key),
      ...(change.calendarKey ? [connectionOfKey(change.calendarKey)] : [])
    ]

    return this.written(
      'event.updated',
      connectionOfKey(key),
      options,
      this.inTurns(connections, () => this.updateNow(key, change, options)),
      {
        fields: [...changedFields(change)],
        moved: change.calendarKey !== undefined,
        series: options.series === true,
        ...(change.recurrence !== undefined
          ? { recurrence: change.recurrence?.frequency ?? 'none' }
          : {}),
        ...(change.reminders !== undefined
          ? { reminders: change.reminders === null ? 'calendar' : change.reminders.length }
          : {})
      }
    )
  }

  /** `update`, in the turns of the connections it touches, which the caller holds. */
  private async updateNow(
    key: string,
    change: EventChange,
    options: { series?: boolean; byUser?: boolean }
  ): Promise<CalendarEvent> {
    await this.notRefused(connectionOfKey(key))
    const { row, provider } = await this.changeable(key)
    const { calendarKey: to, ...rest } = change

    if (to !== undefined && to !== calendarKey(row.connectionId, row.calendarId)) {
      const moved = await this.moveEvent(row, provider, to, options)
      const before = row.remindersJson ? (JSON.parse(row.remindersJson) as number[]) : null

      // The same event there, with the reminders it had: a calendar that reminds with its own
      // defaults (Google's) would give a moved event the defaults of where it went.
      if (rest.reminders === undefined && before !== null) {
        const there = await this.eventOrThrow(moved)

        if (!sameReminders(before, there.reminders ?? null)) {
          await this.updateNow(moved, { reminders: before }, { ...options, series: true })
        }
      }

      return Object.values(rest).some((value) => value !== undefined)
        ? this.updateNow(moved, rest, options)
        : this.eventOrThrow(moved)
    }

    // Another service keeps it: its provider lets only its reminders change (§7.5).
    if (row.managedBy && [...changedFields(rest)].some((field) => field !== 'reminders')) {
      throw new Error(
        row.managedBy === 'birthdays'
          ? messages(MESSAGES).birthdayKeepsIt
          : messages(MESSAGES).gmailKeepsIt
      )
    }

    const current = {
      ...(await this.eventOrThrow(key)),
      startsAt: Number(row.startsAt),
      endsAt: Number(row.endsAt)
    }

    return row.seriesId !== null && (options.series === true || rest.recurrence !== undefined)
      ? this.updateSeries(row, provider, current, rest, options)
      : this.updateEvent(row, provider, current, rest, options)
  }

  /**
   * Changes one event — or one instance, an exception of its series. Made
   * to repeat, it is the first of its series, read in: what the app keeps of
   * it follows it there.
   */
  private async updateEvent(
    row: CalendarEventRow,
    provider: CalendarProvider,
    current: CalendarEvent & { startsAt: number; endsAt: number },
    change: EventChange,
    options: { byUser?: boolean }
  ): Promise<CalendarEvent> {
    // An instance carries its series' rule, which is not its own to write (`updateSeries`).
    const next = {
      ...changedEvent(current, change),
      ...(row.seriesId !== null ? { recurrence: null } : {})
    }
    const fields = differingFields(eventInput(current), next, changedFields(change))

    if (fields.size === 0) {
      return this.eventOrThrow(row.key)
    }

    if (fields.has('recurrence')) {
      checkRule(next)
    }

    const notify = next.attendees.length > 0 || current.attendees.some((attendee) => !attendee.self)
    const updated = await provider.update(row.calendarId, row.eventId, next, notify, fields)

    if (!fields.has('recurrence')) {
      await this.note(
        await this.applyChanges(row.connectionId, [updated], { logChanges: options.byUser }),
        true
      )
      this.options.send(CALENDAR_IPC.changed, null)
      return this.eventOrThrow(row.key)
    }

    // It repeats now, its own id its series': its instances are read in, the first is it.
    const prisma = this.requirePrisma()
    await prisma.calendarEvent.deleteMany({ where: { key: row.key } })
    const pass = await this.readFor([row.connectionId])
    const first = nearest(
      await this.seriesRows(row.connectionId, row.calendarId, row.eventId),
      Number(row.startsAt)
    )
    await this.settle(pass, {
      byUser: options.byUser === true,
      owns: this.seriesOwns(row.connectionId, row.calendarId, row.eventId),
      moves: first
        ? [{ from: row.key, to: first.key, before: row, beforeName: current.calendarName }]
        : []
    })
    this.options.send(CALENDAR_IPC.changed, null)
    return first
      ? this.eventOrThrow(first.key)
      : unkept(updated, row.connectionId, current.calendarName)
  }

  /**
   * Changes an instance's whole series, as its provider keeps it: moved by
   * what the instance moved (`shiftedSeries`) — its rule with it —, its
   * words, guests and reminders as given, how it repeats. A rule made
   * elsewhere keeps its days: only its hour changes here. One event again,
   * it stays where the instance is. Its instances are read again, and what
   * the app keeps of each follows it to its key now.
   */
  private async updateSeries(
    row: CalendarEventRow,
    provider: CalendarProvider,
    current: CalendarEvent & { startsAt: number; endsAt: number },
    change: EventChange,
    options: { byUser?: boolean }
  ): Promise<CalendarEvent> {
    const seriesId = row.seriesId!
    const first = await provider.series(row.calendarId, seriesId)
    const zone = knownZone(first.zone)
    const instance = changedEvent(current, change)
    const single = change.recurrence === null
    const timed =
      change.start !== undefined || change.end !== undefined || change.allDay !== undefined
    const shift =
      timed && !single ? shiftedSeries(first, eventInput(current), instance, zone) : null

    if (
      shift &&
      shift.days !== 0 &&
      first.recurrence === 'other' &&
      change.recurrence === undefined
    ) {
      throw new Error(messages(MESSAGES).otherRuleDay)
    }

    const next: ProviderEventInput = {
      ...first,
      title: change.title ?? first.title,
      location: change.location !== undefined ? change.location : first.location,
      description: change.description !== undefined ? change.description : first.description,
      attendees: change.attendees ?? first.attendees,
      reminders: change.reminders !== undefined ? change.reminders : first.reminders,
      ...(shift ? { start: shift.start, end: shift.end, allDay: shift.allDay } : {}),
      ...(single ? { start: instance.start, end: instance.end, allDay: instance.allDay } : {}),
      recurrence:
        change.recurrence !== undefined
          ? change.recurrence
          : shift && first.recurrence && first.recurrence !== 'other'
            ? shiftedRecurrence(first.recurrence, shift.days)
            : first.recurrence
    }
    const asked = new Set<EventField>(changedFields(change))

    if (single) {
      asked.add('time')
    }

    const fields = differingFields(first, next, asked)

    if (fields.size === 0) {
      return this.eventOrThrow(row.key)
    }

    checkRule(next)
    const before = await this.seriesRows(row.connectionId, row.calendarId, seriesId)
    const notify = next.attendees.length > 0 || before.some(hasGuests)

    await provider.update(row.calendarId, seriesId, next, notify, fields)
    const pass = await this.readFor([row.connectionId])
    // Its instances under their keys now: a series moved names them by their new times, one
    // event again goes by its series' own id.
    const prisma = this.requirePrisma()
    const after = await this.seriesRows(row.connectionId, row.calendarId, seriesId)
    const alone = single
      ? await prisma.calendarEvent.findUnique({
          where: { key: eventKey(row.connectionId, row.calendarId, seriesId) }
        })
      : null
    // Each instance where the series' move put it — an all-day one at its local midnight, as kept.
    const pairs: Array<[CalendarEventRow, CalendarEventRow]> = alone
      ? [[row, alone]]
      : shift
        ? pairedByStart(
            before,
            after,
            (old) =>
              instantsOf(
                shiftedSeries(eventInput(eventOfRow(old, '')), eventInput(current), instance, zone)
              ).startsAt
          )
        : []

    await this.settle(pass, {
      byUser: options.byUser === true,
      owns: this.seriesOwns(row.connectionId, row.calendarId, seriesId),
      moves: pairs.map(([old, now]) => ({
        from: old.key,
        to: now.key,
        before: old,
        beforeName: current.calendarName
      }))
    })
    this.options.send(CALENDAR_IPC.changed, null)

    const edited =
      pairs.find(([old]) => old.key === row.key)?.[1] ??
      after.find((candidate) => candidate.key === row.key) ??
      nearest(after, Date.parse(instance.start))

    return edited ? this.eventOrThrow(edited.key) : this.eventOrThrow(row.key)
  }

  /**
   * Moves an event to another calendar — an instance with its series —,
   * the same event there (vision §7.5), where `eventMoveLimit` lets it go:
   * by its provider's own move in the same connection; else copied there
   * — every field, how it repeats, its reminders — and taken away here,
   * only without guests, and of a series only one its rule says whole. The
   * calendars are read again, and what the app keeps of the event — of each
   * instance — follows it. Resolves with its key there.
   */
  private async moveEvent(
    row: CalendarEventRow,
    provider: CalendarProvider,
    toKey: string,
    options: { byUser?: boolean }
  ): Promise<string> {
    const prisma = this.requirePrisma()
    const [calendars, connections, addresses] = await Promise.all([
      prisma.calendarCalendar.findMany(),
      prisma.calendarConnection.findMany({ select: { id: true, provider: true } }),
      this.userAddresses()
    ])
    const kinds = new Map(
      connections.map((connection) => [connection.id, connection.provider as CalendarProviderKind])
    )
    const keyOf = (calendar: { connectionId: string; calendarId: string }): string =>
      calendarKey(calendar.connectionId, calendar.calendarId)
    const from = calendars.find((calendar) => keyOf(calendar) === keyOf(row))
    const to = calendars.find((calendar) => keyOf(calendar) === toKey)

    if (!from || !to) {
      throw new Error(messages(MESSAGES).calendarGone)
    }

    const fromKind = kinds.get(row.connectionId) ?? 'ics'
    const limit = eventMoveLimit(
      eventOfRow(row, from.name, addresses.writing),
      { writable: from.writable === 1, provider: fromKind },
      { connectionId: to.connectionId, calendarId: to.calendarId, writable: to.writable === 1 }
    )

    if (limit === 'same') {
      return row.key
    }

    if (limit) {
      throw new Error(moveLimitWords(limit, row.managedBy))
    }

    await this.notRefused(to.connectionId)
    const seriesId = row.seriesId
    const moving = seriesId ?? row.eventId
    const kept = seriesId
      ? await this.seriesRows(row.connectionId, row.calendarId, seriesId)
      : [row]
    const sameConnection = to.connectionId === row.connectionId
    let movedId: string
    let how: MoveHow

    if (sameConnection && provider.move) {
      ;({ eventId: movedId, how } = await provider.move(row.calendarId, moving, to.calendarId, {
        guests: kept.some(hasGuests)
      }))
    } else {
      const target = sameConnection ? provider : await this.providerFor(to.connectionId)

      if (!target) {
        throw new Error(messages(MESSAGES).calendarGone)
      }

      const input = seriesId
        ? await provider.series(row.calendarId, seriesId)
        : eventInput(eventOfRow(row, from.name))

      if (input.recurrence === 'other') {
        throw new Error(messages(MESSAGES).otherRuleCopy)
      }

      if (seriesId && this.changedOneByOne(input, kept, from.windowEnd)) {
        throw new Error(messages(MESSAGES).exceptionsCopy)
      }

      const created = await target.create(
        to.calendarId,
        input,
        row.originJson ? (JSON.parse(row.originJson) as EventOrigin) : null
      )
      movedId = input.recurrence ? (created.seriesId ?? created.eventId) : created.eventId

      try {
        await provider.remove(row.calendarId, moving, false)
      } catch (error) {
        // Still here: the copy goes, so the event is not there twice.
        await target
          .remove(to.calendarId, movedId, false)
          .catch((failed: unknown) =>
            log.failed('event.copy-left', failed, { conn: to.connectionId })
          )
        throw error
      }

      how = 'copy'

      if (!input.recurrence) {
        await this.applyChanges(to.connectionId, [created])
      }
    }

    // Gone from here: what it is there is read in, and what the app keeps of it follows.
    await prisma.calendarEvent.deleteMany({ where: { key: { in: kept.map((old) => old.key) } } })
    this.eventsChanged()
    const pass = await this.readFor([to.connectionId, row.connectionId])
    const movedKey = eventKey(to.connectionId, to.calendarId, movedId)
    const pairs: Array<[CalendarEventRow, string]> = seriesId
      ? pairedByStart(kept, await this.seriesRows(to.connectionId, to.calendarId, movedId)).map(
          ([old, now]): [CalendarEventRow, string] => [old, now.key]
        )
      : [[row, movedKey]]
    const keptKeys = new Set(kept.map((old) => old.key))
    const there = this.seriesOwns(to.connectionId, to.calendarId, movedId)

    await this.settle(pass, {
      byUser: options.byUser === true,
      owns: (change) => keptKeys.has(change.key) || there(change),
      moves: pairs.map(([old, now]) => ({
        from: old.key,
        to: now,
        before: old,
        beforeName: from.name
      }))
    })
    this.options.send(CALENDAR_IPC.changed, null)
    log.info('event.moved', {
      conn: row.connectionId,
      to: to.connectionId,
      provider: fromKind,
      toProvider: kinds.get(to.connectionId) ?? 'ics',
      how,
      series: seriesId !== null,
      instances: kept.length,
      by: options.byUser ? 'user' : 'segretario'
    })

    return pairs.find(([old]) => old.key === row.key)?.[1] ?? pairs[0]?.[1] ?? movedKey
  }

  /**
   * Whether some times of a series were changed or taken out one by one, as
   * its calendar holds it: those it has, against those its rule makes in
   * the same days. A copy written from the rule would lose them.
   */
  private changedOneByOne(
    first: ProviderEventInput,
    kept: ReadonlyArray<CalendarEventRow>,
    windowEnd: bigint | null
  ): boolean {
    const now = Date.now()
    // A day inside what the calendar holds on either side: its edges move with the days.
    const range = {
      from: now - WINDOW_BACK_MS + DAY_MS,
      to:
        Math.min(windowEnd === null ? Infinity : Number(windowEnd), now + WINDOW_AHEAD_MS) - DAY_MS
    }
    const inside = (startsAt: number): boolean => startsAt >= range.from && startsAt < range.to
    const made = occurrencesOf(newEventResource('series', first, null, null), range).filter(
      (occurrence) => inside(occurrence.startsAt)
    )
    const held = kept.filter((row) => inside(Number(row.startsAt)))
    const byStart = new Map(made.map((occurrence) => [occurrence.startsAt, occurrence]))

    return (
      made.length !== held.length ||
      held.some((row) => {
        const own = byStart.get(Number(row.startsAt))
        return (
          !own ||
          Number(row.endsAt) !== own.endsAt ||
          row.title !== first.title ||
          (row.location ?? null) !== (first.location ?? null) ||
          (row.description ?? null) !== (first.description ?? null)
        )
      })
    )
  }

  /**
   * Takes an event away — with `series`, an instance's whole series —;
   * whoever is invited is told. `byUser`: noted for the Segretario, as
   * `create`.
   */
  async remove(
    key: string,
    options: { series?: boolean; byUser?: boolean; actor?: DiagnosticActor } = {}
  ): Promise<void> {
    return this.written(
      'event.removed',
      connectionOfKey(key),
      options,
      this.inTurn(connectionOfKey(key), async () => {
        await this.notRefused(connectionOfKey(key))
        const { row, provider } = await this.changeable(key)
        const seriesId = options.series === true ? row.seriesId : null
        const rows = seriesId
          ? await this.seriesRows(row.connectionId, row.calendarId, seriesId)
          : [row]

        await provider.remove(row.calendarId, seriesId ?? row.eventId, rows.some(hasGuests))
        const prisma = this.requirePrisma()

        if (options.byUser) {
          const calendar = await prisma.calendarCalendar.findUnique({
            where: {
              connectionId_calendarId: {
                connectionId: row.connectionId,
                calendarId: row.calendarId
              }
            }
          })
          await this.note(
            rows.map((gone): FoundChange => ({
              kind: 'annullato',
              connectionId: gone.connectionId,
              key: gone.key,
              before: gone,
              beforeName: calendar?.name ?? '',
              after: null,
              afterName: calendar?.name ?? ''
            })),
            true
          )
        }

        await prisma.calendarEvent.deleteMany({
          where: { key: { in: rows.map((gone) => gone.key) } }
        })
        this.eventsChanged()
        this.options.send(CALENDAR_IPC.changed, null)
      }),
      { series: options.series === true }
    )
  }

  /** The instances of a series kept, in its calendar. */
  private seriesRows(
    connectionId: string,
    calendarId: string,
    seriesId: string
  ): Promise<CalendarEventRow[]> {
    return this.requirePrisma().calendarEvent.findMany({
      where: { connectionId, calendarId, seriesId }
    })
  }

  /**
   * Whether a change a read found is of a series — its instances, or the
   * one event it is, or was, under its own id —: what a write to the whole
   * series did.
   */
  private seriesOwns(
    connectionId: string,
    calendarId: string,
    seriesId: string
  ): (change: FoundChange) => boolean {
    return (change) =>
      change.connectionId === connectionId &&
      [change.after, change.before].some(
        (event) =>
          event !== null &&
          event.calendarId === calendarId &&
          (event.seriesId === seriesId || event.eventId === seriesId)
      )
  }

  /**
   * An event the user may change, with the provider to write it through:
   * one they are invited to is answered, not changed — changed, it would be
   * their copy alone, and the organizer would never know.
   */
  private async changeable(
    key: string
  ): Promise<{ row: CalendarEventRow; provider: CalendarProvider }> {
    const row = await this.requirePrisma().calendarEvent.findUnique({ where: { key } })
    const provider = row ? await this.providerFor(row.connectionId) : null

    if (!row || !provider) {
      throw new Error(messages(MESSAGES).eventGone)
    }

    const event = eventOfRow(row, '')

    if (!organizedByUser(event, (await this.userAddresses()).writing)) {
      throw new Error(messages(MESSAGES).organizedByOthers(row.title, event.organizer))
    }

    return { row, provider }
  }

  private async eventOrThrow(key: string): Promise<CalendarEvent> {
    const prisma = this.requirePrisma()
    const row = await prisma.calendarEvent.findUnique({ where: { key } })

    if (!row) {
      throw new Error(messages(MESSAGES).eventGone)
    }

    const [calendar, addresses] = await Promise.all([
      prisma.calendarCalendar.findUnique({
        where: {
          connectionId_calendarId: { connectionId: row.connectionId, calendarId: row.calendarId }
        }
      }),
      this.userAddresses()
    ])
    return eventOfRow(row, calendar?.name ?? '', addresses.writing)
  }
}
