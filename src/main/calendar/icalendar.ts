import ICAL from 'ical.js'
import { tzlib_get_ical_block } from 'timezones-ical-library'

import { logMainError } from '@main/utils/error-utils'

import type { CalendarAttendee, CalendarResponse, EventOrigin } from '@shared/calendar'

import type { ProviderEvent, ProviderEventInput } from './calendar-provider'

/** The longest a series is walked looking for its occurrences in a window: a guard, not a limit anyone meets. */
const MAX_STEPS = 20_000

/** The property our app marks its events with, for the Segretario's origin. */
export const ORIGIN_PROPERTY = 'x-siever-origin'

/**
 * An occurrence of an event as the iCalendar text says it — a single event,
 * or one instance of a series with its exceptions applied — ready for a
 * provider to name it.
 */
export type Occurrence = Omit<ProviderEvent, 'calendarId' | 'eventId'> & {
  /** The instance's RECURRENCE-ID, as iCalendar writes it; null for an event that does not repeat. */
  recurrenceId: string | null
}

const RESPONSES: Readonly<Record<string, CalendarResponse>> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needsAction'
}

/** A call's address, where a provider puts one. */
const CONFERENCE_PROPERTIES = [
  'conference',
  'x-google-conference',
  'x-microsoft-onlinemeetingurl',
  'x-microsoft-skypeteamsmeetingurl'
]
const MEETING_LINK =
  /https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com|[\w.-]*webex\.com)\/[^\s"<>)]+/i

function addressOf(value: unknown): string {
  return String(value ?? '')
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase()
}

/** A day of an all-day event, AAAA-MM-GG. */
function dayOf(time: ICAL.Time): string {
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

/** The day after a day: an all-day event with no end lasts its day. */
function dayAfter(time: ICAL.Time): ICAL.Time {
  const next = time.clone()
  next.adjust(1, 0, 0, 0)
  return next
}

function instantOf(time: ICAL.Time): number {
  return time.isDate
    ? new Date(time.year, time.month - 1, time.day).getTime()
    : time.toJSDate().getTime()
}

/**
 * The time zones a calendar's times are in, known before they are read:
 * the VTIMEZONEs it carries, and — for a TZID it names without one — the
 * IANA zone of that name. A zone left unknown would read as local time.
 */
function registerTimezones(root: ICAL.Component, text: string): void {
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const tzid = zone.getFirstPropertyValue('tzid')

    if (typeof tzid === 'string' && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(zone)
    }
  }

  for (const [, quoted, bare] of text.matchAll(/;TZID=(?:"([^"]+)"|([^;:\r\n]+))/gi)) {
    const tzid = (quoted ?? bare).trim()

    if (tzid && !ICAL.TimezoneService.has(tzid)) {
      const block = tzlib_get_ical_block(tzid)
      const vtimezone = Array.isArray(block) ? block[0] : null

      if (vtimezone?.includes('BEGIN:VTIMEZONE')) {
        ICAL.TimezoneService.register(new ICAL.Component(ICAL.parse(vtimezone)))
      }
    }
  }
}

function originOf(component: ICAL.Component): EventOrigin | null {
  const raw = component.getFirstPropertyValue(ORIGIN_PROPERTY)

  if (typeof raw !== 'string' || !raw) {
    return null
  }

  try {
    const origin = JSON.parse(decodeURIComponent(raw)) as EventOrigin
    return origin.by === 'segretario' ? origin : null
  } catch {
    return null
  }
}

/** The origin, written so no character of it needs iCalendar's escapes. */
export function originValue(origin: EventOrigin): string {
  return encodeURIComponent(JSON.stringify(origin))
}

function meetLinkOf(event: ICAL.Event): string | null {
  for (const name of CONFERENCE_PROPERTIES) {
    const value = event.component.getFirstPropertyValue(name)

    if (typeof value === 'string' && /^https:\/\//i.test(value)) {
      return value
    }
  }

  return (
    MEETING_LINK.exec(event.location ?? '')?.[0] ??
    MEETING_LINK.exec(event.description ?? '')?.[0] ??
    null
  )
}

/**
 * What an occurrence says, from the event that holds it — the series, or
 * the exception for that instance — the user's own answer among the
 * attendees found by their addresses.
 */
function occurrenceOf(
  event: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  recurrenceId: string | null,
  self: ReadonlySet<string>
): Occurrence {
  const organizer = event.organizer ? addressOf(event.organizer) : null
  const attendees: CalendarAttendee[] = event.attendees.map((property) => {
    const email = addressOf(property.getFirstValue())
    const name = property.getParameter('cn')
    const partstat = String(property.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase()

    return {
      email,
      name: typeof name === 'string' && name.trim() ? name.trim() : null,
      response: RESPONSES[partstat] ?? 'needsAction',
      self: self.has(email),
      organizer: email === organizer
    }
  })
  const own = attendees.find((attendee) => attendee.self)
  const allDay = start.isDate
  const startsAt = instantOf(start)
  const endsAt = Math.max(instantOf(end), startsAt + (allDay ? 24 * 60 * 60 * 1000 : 0))
  const status = String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase()

  return {
    recurrenceId,
    iCalUid: event.uid || null,
    title: event.summary?.trim() || '(senza titolo)',
    start: allDay ? dayOf(start) : new Date(startsAt).toISOString(),
    end: allDay
      ? dayOf(end.isDate && instantOf(end) > startsAt ? end : dayAfter(start))
      : new Date(endsAt).toISOString(),
    allDay,
    startsAt,
    endsAt,
    location: event.location?.trim() || null,
    description: event.description?.trim() || null,
    attendees,
    organizer,
    // The user's answer when invited by someone else; none for their own event.
    myResponse: own && !(organizer && self.has(organizer)) ? own.response : null,
    meetLink: meetLinkOf(event),
    htmlLink: null,
    origin: originOf(event.component),
    cancelled: status === 'CANCELLED'
  }
}

/**
 * Every occurrence an iCalendar text has between two instants: single
 * events, and the instances of each series — its RRULE, RDATE and EXDATE,
 * its exceptions (RECURRENCE-ID) in place of the instances they change.
 * `self` are the user's addresses, to read their own answer.
 */
export function occurrencesOf(
  text: string,
  range: { from: number; to: number },
  self: ReadonlyArray<string> = []
): Occurrence[] {
  const root = new ICAL.Component(ICAL.parse(text))
  const calendars = root.name === 'vcalendar' ? [root] : root.getAllSubcomponents('vcalendar')
  const own = new Set(self.map(addressOf))
  const occurrences: Occurrence[] = []

  registerTimezones(root, text)

  const keep = (occurrence: Occurrence): void => {
    if (occurrence.startsAt < range.to && occurrence.endsAt > range.from) {
      occurrences.push(occurrence)
    }
  }

  for (const calendar of calendars) {
    // A series and its exceptions, by UID: ical.js would otherwise take every exception of the calendar as its own.
    const groups = new Map<string, { master: ICAL.Component | null; overrides: ICAL.Component[] }>()

    for (const component of calendar.getAllSubcomponents('vevent')) {
      const uid = String(component.getFirstPropertyValue('uid') ?? '')
      const group = groups.get(uid) ?? { master: null, overrides: [] }

      if (component.hasProperty('recurrence-id')) {
        group.overrides.push(component)
      } else {
        group.master = component
      }

      groups.set(uid, group)
    }

    for (const { master, overrides } of groups.values()) {
      try {
        // An exception whose series is not here stands alone.
        if (!master) {
          for (const override of overrides) {
            const event = new ICAL.Event(override, { exceptions: [] })
            keep(
              occurrenceOf(
                event,
                event.startDate,
                event.endDate,
                event.recurrenceId.toString(),
                own
              )
            )
          }

          continue
        }

        const event = new ICAL.Event(master, { strictExceptions: true, exceptions: overrides })

        if (!event.startDate) {
          continue
        }

        if (!event.isRecurring()) {
          keep(occurrenceOf(event, event.startDate, event.endDate, null, own))
          continue
        }

        const iterator = event.iterator()
        const length = Math.max(instantOf(event.endDate) - instantOf(event.startDate), 0)
        const walked = new Set<string>()

        for (
          let step = 0, next = iterator.next();
          next && step < MAX_STEPS;
          step++, next = iterator.next()
        ) {
          if (instantOf(next) >= range.to) {
            break
          }

          const id = next.toString()
          walked.add(id)

          // Instances that ended before the window are walked past, not read — unless one was moved.
          if (instantOf(next) + length <= range.from && !event.exceptions[id]) {
            continue
          }

          const details = event.getOccurrenceDetails(next)
          keep(occurrenceOf(details.item, details.startDate, details.endDate, id, own))
        }

        // An instance from after the window, moved into it.
        for (const exception of Object.values(event.exceptions)) {
          const id = exception.recurrenceId.toString()

          if (!walked.has(id) && instantOf(exception.recurrenceId) >= range.to) {
            keep(occurrenceOf(exception, exception.startDate, exception.endDate, id, own))
          }
        }
      } catch (error) {
        // A series ical.js cannot walk (an impossible rule) is left out, not the calendar with it.
        logMainError('An event of a calendar could not be read', error)
      }
    }
  }

  return occurrences
}

/** The calendar's own name, when the text gives one (X-WR-CALNAME). */
export function calendarNameOf(text: string): string | null {
  const root = new ICAL.Component(ICAL.parse(text))
  const calendar = root.name === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar')
  const name = calendar?.getFirstPropertyValue('x-wr-calname')
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/* ───────────────────────────── writing ───────────────────────────── */

const PRODID = '-//SIEVER//SIEVER Mail//IT'
const PARTSTATS: Readonly<Record<Exclude<CalendarResponse, 'needsAction'>, string>> = {
  accepted: 'ACCEPTED',
  tentative: 'TENTATIVE',
  declined: 'DECLINED'
}

const now = (): ICAL.Time => ICAL.Time.fromJSDate(new Date(), true)

/**
 * A time as an event's: a day for an all-day one; an instant otherwise,
 * in `zone` when the event keeps one (a series keeps its local hour across
 * summer time), in UTC when not.
 */
function timeOf(value: string, allDay: boolean, zone: ICAL.Timezone | null): ICAL.Time {
  if (allDay) {
    return ICAL.Time.fromDateString(value.slice(0, 10))
  }

  const utc = ICAL.Time.fromJSDate(new Date(value), true)
  return zone && zone !== ICAL.Timezone.utcTimezone && zone !== ICAL.Timezone.localTimezone
    ? utc.convertToZone(zone)
    : utc
}

/**
 * The VEVENTs of a calendar object: one event — a series and its
 * exceptions — by its UID, as CalDAV keeps them one to an object.
 */
function objectEvents(calendar: ICAL.Component): ICAL.Component[] {
  const events = calendar.getAllSubcomponents('vevent')
  const uid = events[0]?.getFirstPropertyValue('uid')
  return events.filter((component) => component.getFirstPropertyValue('uid') === uid)
}

/** The VEVENT an instance is: its exception, or — none yet — one made from the series. */
function instanceComponent(calendar: ICAL.Component, recurrenceId: string): ICAL.Component {
  const events = objectEvents(calendar)
  const master = events.find((component) => !component.hasProperty('recurrence-id'))
  const existing = events.find(
    (component) =>
      component.hasProperty('recurrence-id') &&
      String(component.getFirstPropertyValue('recurrence-id')) === recurrenceId
  )

  if (existing) {
    return existing
  }

  if (!master) {
    throw new Error('L’evento ripetuto non si trova nel calendario.')
  }

  const instance = new ICAL.Component(ICAL.parse(master.toString()))

  for (const name of ['rrule', 'rdate', 'exdate', 'recurrence-id']) {
    instance.removeAllProperties(name)
  }

  const masterStart = new ICAL.Event(master, { exceptions: [] }).startDate
  const original = recurrenceTime(recurrenceId, masterStart)
  const event = new ICAL.Event(instance, { exceptions: [] })
  const length = master.hasProperty('dtend')
    ? new ICAL.Event(master, { exceptions: [] }).duration
    : null
  event.recurrenceId = original
  event.startDate = original.clone()

  if (length) {
    const end = original.clone()
    end.addDuration(length)
    event.endDate = end
  }

  calendar.addSubcomponent(instance)
  return instance
}

/** An instance's RECURRENCE-ID as a time of the series: its zone, or a day. */
function recurrenceTime(recurrenceId: string, masterStart: ICAL.Time): ICAL.Time {
  if (masterStart.isDate || /^\d{4}-\d{2}-\d{2}$/.test(recurrenceId)) {
    return ICAL.Time.fromDateString(recurrenceId.slice(0, 10))
  }

  const time = ICAL.Time.fromDateTimeString(recurrenceId)

  if (!recurrenceId.endsWith('Z') && masterStart.zone) {
    time.zone = masterStart.zone
  }

  return time
}

function setAttendees(
  component: ICAL.Component,
  attendees: ReadonlyArray<string>,
  organizer: string | null
): void {
  const kept = new Map(
    component
      .getAllProperties('attendee')
      .map((property) => [addressOf(property.getFirstValue()), property] as const)
  )
  const wanted = new Set(attendees.map(addressOf))

  for (const [address, property] of kept) {
    // The organizer stays among the attendees, as the providers keep them.
    if (!wanted.has(address) && address !== organizer) {
      component.removeProperty(property)
    }
  }

  for (const address of wanted) {
    if (!kept.has(address)) {
      const property = component.addPropertyWithValue('attendee', `mailto:${address}`)
      property.setParameter('partstat', 'NEEDS-ACTION')
      property.setParameter('rsvp', 'TRUE')
      property.setParameter('role', 'REQ-PARTICIPANT')
    }
  }

  if (wanted.size > 0 && organizer && !component.hasProperty('organizer')) {
    component.addPropertyWithValue('organizer', `mailto:${organizer}`)
  }
}

function writeFields(
  component: ICAL.Component,
  event: ProviderEventInput,
  organizer: string | null
): void {
  const target = new ICAL.Event(component, { exceptions: [] })
  const zone = target.startDate && !target.startDate.isDate ? target.startDate.zone : null

  target.summary = event.title
  target.startDate = timeOf(event.start, event.allDay, zone)
  target.endDate = timeOf(event.end, event.allDay, zone)
  component.removeAllProperties('duration')

  for (const [name, value] of [
    ['location', event.location],
    ['description', event.description]
  ] as const) {
    if (value) {
      component.updatePropertyWithValue(name, value)
    } else {
      component.removeAllProperties(name)
    }
  }

  setAttendees(component, event.attendees, organizer)
  component.updatePropertyWithValue(
    'sequence',
    Number(component.getFirstPropertyValue('sequence') ?? 0) + 1
  )
  component.updatePropertyWithValue('dtstamp', now())
}

/**
 * A new event as a calendar object: always with an end (some servers want
 * one), in UTC, the organizer the user when there are guests — a CalDAV
 * server that schedules sends them the invitation itself.
 */
export function newEventResource(
  uid: string,
  event: ProviderEventInput,
  organizer: string | null,
  origin: EventOrigin | null
): string {
  const calendar = new ICAL.Component(['vcalendar', [], []])
  calendar.updatePropertyWithValue('prodid', PRODID)
  calendar.updatePropertyWithValue('version', '2.0')
  const component = new ICAL.Component('vevent')
  component.updatePropertyWithValue('uid', uid)
  component.updatePropertyWithValue('dtstamp', now())
  component.updatePropertyWithValue('sequence', -1)

  if (origin) {
    component.updatePropertyWithValue(ORIGIN_PROPERTY, originValue(origin))
  }

  writeFields(component, event, organizer)
  calendar.addSubcomponent(component)
  return calendar.toString()
}

function calendarOf(text: string): ICAL.Component {
  const root = new ICAL.Component(ICAL.parse(text))
  registerTimezones(root, text)
  return root.name === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar')!
}

/** An event object changed: the series (no `recurrenceId`), or one instance of it. */
export function changeEventResource(
  text: string,
  recurrenceId: string | null,
  event: ProviderEventInput,
  organizer: string | null
): string {
  const calendar = calendarOf(text)
  const component =
    recurrenceId === null
      ? objectEvents(calendar).find((candidate) => !candidate.hasProperty('recurrence-id'))
      : instanceComponent(calendar, recurrenceId)

  if (!component) {
    throw new Error('L’evento non si trova nel calendario.')
  }

  writeFields(component, event, organizer)
  return calendar.toString()
}

/** One instance of a series taken out: an EXDATE on the series, its exception gone. */
export function removeOccurrence(text: string, recurrenceId: string): string {
  const calendar = calendarOf(text)
  const events = objectEvents(calendar)
  const master = events.find((component) => !component.hasProperty('recurrence-id'))

  for (const exception of events.filter(
    (component) =>
      component.hasProperty('recurrence-id') &&
      String(component.getFirstPropertyValue('recurrence-id')) === recurrenceId
  )) {
    calendar.removeSubcomponent(exception)
  }

  if (master) {
    const time = recurrenceTime(recurrenceId, new ICAL.Event(master, { exceptions: [] }).startDate)
    const exdate = new ICAL.Property('exdate')

    if (!time.isDate && time.zone && time.zone !== ICAL.Timezone.utcTimezone) {
      exdate.setParameter('tzid', time.zone.tzid)
    }

    exdate.setValue(time)
    master.addProperty(exdate)
    master.updatePropertyWithValue('dtstamp', now())
  }

  return calendar.toString()
}

/** The user's answer to an invitation: their own PARTSTAT, on the series or on one instance. */
export function withResponse(
  text: string,
  recurrenceId: string | null,
  self: ReadonlyArray<string>,
  response: Exclude<CalendarResponse, 'needsAction'>
): string {
  const calendar = calendarOf(text)
  const own = new Set(self.map(addressOf))
  const targets =
    recurrenceId === null ? objectEvents(calendar) : [instanceComponent(calendar, recurrenceId)]
  let answered = false

  for (const component of targets) {
    for (const attendee of component.getAllProperties('attendee')) {
      if (own.has(addressOf(attendee.getFirstValue()))) {
        attendee.setParameter('partstat', PARTSTATS[response])
        attendee.removeParameter('rsvp')
        answered = true
      }
    }

    component.updatePropertyWithValue('dtstamp', now())
  }

  if (!answered) {
    throw new Error('In questo evento non sei tra gli invitati.')
  }

  return calendar.toString()
}

/** The occurrence a resource says for an instance — or the event, for one that does not repeat. */
export function occurrenceIn(
  text: string,
  recurrenceId: string | null,
  self: ReadonlyArray<string>
): Occurrence | null {
  const all = occurrencesOf(text, { from: -8.64e15, to: 8.64e15 }, self)
  return (
    all.find((occurrence) => occurrence.recurrenceId === recurrenceId) ??
    (recurrenceId === null ? (all[0] ?? null) : null)
  )
}

const REPLY_PARTSTATS: Readonly<Record<Exclude<CalendarResponse, 'needsAction'>, string>> =
  PARTSTATS

/** What an invitation says of who invites, and whether the user is among the guests. */
export function invitationParties(text: string): { organizer: string | null; attendees: string[] } {
  const calendar = calendarOf(text)
  const event = calendar.getFirstSubcomponent('vevent')
  const organizer = event?.getFirstPropertyValue('organizer')

  return {
    organizer: organizer ? addressOf(organizer) || null : null,
    attendees: (event?.getAllProperties('attendee') ?? []).map((property) =>
      addressOf(property.getFirstValue())
    )
  }
}

/**
 * An answer to an invitation as iMIP sends it (RFC 6047): a METHOD:REPLY
 * calendar with the event's UID, its SEQUENCE and the instance it is
 * about, and the user — by the address they were invited at — with their
 * PARTSTAT. For an invitation not in any calendar SIEVER Mail reaches.
 */
export function invitationReply(
  text: string,
  user: { addresses: ReadonlyArray<string>; address: string; name: string },
  response: Exclude<CalendarResponse, 'needsAction'>
): { ics: string; organizer: string; summary: string } {
  const invited = calendarOf(text).getFirstSubcomponent('vevent')
  const organizer = invited?.getFirstPropertyValue('organizer')

  if (!invited || !organizer) {
    throw new Error('Questo invito non dice a chi rispondere.')
  }

  const own = new Set(user.addresses.map(addressOf))
  const attendee = invited
    .getAllProperties('attendee')
    .find((property) => own.has(addressOf(property.getFirstValue())))
  const reply = new ICAL.Component(['vcalendar', [], []])
  reply.updatePropertyWithValue('prodid', PRODID)
  reply.updatePropertyWithValue('version', '2.0')
  reply.updatePropertyWithValue('method', 'REPLY')
  const event = new ICAL.Component('vevent')

  for (const name of ['uid', 'sequence', 'recurrence-id', 'dtstart', 'dtend', 'summary']) {
    const property = invited.getFirstProperty(name)

    if (property) {
      event.addProperty(ICAL.Property.fromString(property.toICALString()))
    }
  }

  event.updatePropertyWithValue('dtstamp', now())
  event.addProperty(ICAL.Property.fromString(invited.getFirstProperty('organizer')!.toICALString()))
  const answer = event.addPropertyWithValue(
    'attendee',
    `mailto:${attendee ? addressOf(attendee.getFirstValue()) : user.address}`
  )
  answer.setParameter('partstat', REPLY_PARTSTATS[response])
  answer.setParameter('cn', user.name)
  reply.addSubcomponent(event)

  return {
    ics: reply.toString(),
    organizer: addressOf(organizer),
    summary: String(invited.getFirstPropertyValue('summary') ?? 'Invito').trim()
  }
}
