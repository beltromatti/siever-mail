import ICAL from 'ical.js'
import { tzlib_get_ical_block } from 'timezones-ical-library'

import { logMainError } from '@main/utils/error-utils'

import type { CalendarAttendee, CalendarResponse, EventOrigin } from '@shared/calendar'

import type { EventField, ProviderEvent, ProviderEventInput } from './calendar-provider'

/** The longest a series is walked looking for its occurrences in a window: a guard, not a limit anyone meets. */
const MAX_STEPS = 20_000
/**
 * The candidates a rule may turn down in a row before it is taken for one
 * that can never happen. ical.js counts them only for monthly and yearly
 * rules: a daily rule asking for the 30th of February walks the days for
 * ever, inside one call, and holds the whole app. A real rule finds its day
 * far sooner — a 29 February that is a Monday comes back within forty-odd
 * years — and a rule this guard stops costs a third of a second.
 */
const MAX_REJECTED_IN_A_ROW = 100_000

/** A series' occurrences, walked with that guard on each of its rules. */
function guardedIterator(event: ICAL.Event): ICAL.RecurExpansion {
  const expansion = event.iterator()
  // `ruleIterators` is private in ical.js's types, public in its code.
  const rules = (expansion as unknown as { ruleIterators?: ICAL.RecurIterator[] }).ruleIterators

  for (const rule of rules ?? []) {
    const check = rule.check_contracting_rules.bind(rule)
    let rejected = 0

    rule.check_contracting_rules = (): boolean => {
      const passes = check()
      rejected = passes ? 0 : rejected + 1

      if (rejected > MAX_REJECTED_IN_A_ROW) {
        throw new Error(`A recurrence rule that matches no day: ${rule.rule.toString()}`)
      }

      return passes
    }
  }

  return expansion
}

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

/** How a Global Object ID begins, written in hex [MS-OXOCAL 2.2.1.27]. */
const GLOBAL_OBJECT_ID = '040000008200E00074C5B7101A82E008'
/** What its data begins with when it wraps another calendar's UID: "vCal-Uid", then 1. */
const WRAPPED_UID = Buffer.from([0x76, 0x43, 0x61, 0x6c, 0x2d, 0x55, 0x69, 0x64, 1, 0, 0, 0])

/**
 * The UID an event goes by in invitations, from the one a calendar gives.
 * Exchange gives its Global Object ID in hex (Graph's `iCalUId`): an
 * instance's own date in it, and a UID that came from another calendar
 * wrapped as "vCal-Uid". It writes it in an invitation as that UID, or as
 * the hex with the instance's date cleared [MS-OXCICAL 2.1.3.1.1.20.26]:
 * so it is read here, for the two to meet. Any other UID is itself.
 */
export function canonicalUid(value: string): string {
  const uid = value.trim()

  if (
    uid.length < 82 ||
    uid.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(uid) ||
    uid.slice(0, GLOBAL_OBJECT_ID.length).toUpperCase() !== GLOBAL_OBJECT_ID
  ) {
    return uid
  }

  const bytes = Buffer.from(uid, 'hex')
  // The header: the id's 16 bytes, the instance's date (4), when it was made (8), 8 reserved, the data's size (4).
  const data = bytes.subarray(40, 40 + bytes.readUInt32LE(36))
  const wrapped = data.subarray(0, WRAPPED_UID.length).equals(WRAPPED_UID)
    ? data.subarray(WRAPPED_UID.length).toString('utf8').replace(/\0+$/, '').trim()
    : ''

  if (wrapped) {
    return wrapped
  }

  bytes.fill(0, 16, 20)
  return bytes.toString('hex').toUpperCase()
}

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
 *
 * ical.js keeps its zones in one registry, by TZID, and finds a time's
 * zone there as the time is read. Two calendars may define one TZID two
 * ways — Outlook's "Customized Time Zone" is each organizer's own — so a
 * calendar's own definitions are registered again each time it is read,
 * and win: every read here runs, start to end, without yielding.
 */
function registerTimezones(root: ICAL.Component, text: string): void {
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    if (typeof zone.getFirstPropertyValue('tzid') === 'string') {
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
  // An all-day event ends at the midnight its last day ends at — 23 or 25 hours on the days
  // the clocks change — and lasts its day when it says no end after it.
  const lastDay = allDay && !(end.isDate && instantOf(end) > startsAt) ? dayAfter(start) : end
  const endsAt = allDay ? instantOf(lastDay) : Math.max(instantOf(end), startsAt)
  const status = String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase()

  return {
    recurrenceId,
    iCalUid: event.uid || null,
    title: event.summary?.trim() || '(senza titolo)',
    start: allDay ? dayOf(start) : new Date(startsAt).toISOString(),
    end: allDay ? dayOf(lastDay) : new Date(endsAt).toISOString(),
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

    calendar.getAllSubcomponents('vevent').forEach((component, index) => {
      // An event without a UID has no series to belong to: each is a group of its own.
      const uid = String(component.getFirstPropertyValue('uid') ?? '') || `\u0000${index}`
      const group = groups.get(uid) ?? { master: null, overrides: [] }

      if (component.hasProperty('recurrence-id')) {
        group.overrides.push(component)
      } else {
        group.master = component
      }

      groups.set(uid, group)
    })

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

        const iterator = guardedIterator(event)
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

/** Every field: what a new event is written with. */
const ALL_FIELDS: ReadonlySet<EventField> = new Set<EventField>([
  'title',
  'time',
  'location',
  'description',
  'attendees'
])

function writeFields(
  component: ICAL.Component,
  event: ProviderEventInput,
  organizer: string | null,
  fields: ReadonlySet<EventField> = ALL_FIELDS
): void {
  const target = new ICAL.Event(component, { exceptions: [] })
  const zone = target.startDate && !target.startDate.isDate ? target.startDate.zone : null

  if (fields.has('title')) {
    target.summary = event.title
  }

  if (fields.has('time')) {
    target.startDate = timeOf(event.start, event.allDay, zone)
    target.endDate = timeOf(event.end, event.allDay, zone)
    component.removeAllProperties('duration')
  }

  for (const [name, value] of [
    ['location', event.location],
    ['description', event.description]
  ] as const) {
    if (!fields.has(name)) {
      continue
    }

    if (value) {
      component.updatePropertyWithValue(name, value)
    } else {
      component.removeAllProperties(name)
    }
  }

  if (fields.has('attendees')) {
    setAttendees(component, event.attendees, organizer)
  }

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
  organizer: string | null,
  fields: ReadonlySet<EventField> = ALL_FIELDS
): string {
  const calendar = calendarOf(text)
  const component =
    recurrenceId === null
      ? objectEvents(calendar).find((candidate) => !candidate.hasProperty('recurrence-id'))
      : instanceComponent(calendar, recurrenceId)

  if (!component) {
    throw new Error('L’evento non si trova nel calendario.')
  }

  writeFields(component, event, organizer, fields)
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

/** An instance of a series, as an invitation about it alone says it: when it is, and when the series put it. */
export interface InvitationInstance {
  /** Its start now, as the invitation gives it (DTSTART). */
  start: number
  /** The start the series gave it, which names it (RECURRENCE-ID). */
  original: number
}

/**
 * The instance of a series an invitation is about — its event has a
 * RECURRENCE-ID — with its times as instants, an all-day one's by local
 * midnight, as the calendars here keep them; null when it is about a whole
 * event, or a whole series.
 */
export function invitationInstance(text: string): InvitationInstance | null {
  const invited = calendarOf(text).getFirstSubcomponent('vevent')

  if (!invited?.hasProperty('recurrence-id')) {
    return null
  }

  const event = new ICAL.Event(invited, { exceptions: [] })
  const original = instantOf(event.recurrenceId)
  return { start: event.startDate ? instantOf(event.startDate) : original, original }
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
