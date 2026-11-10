import { CALENDAR_HELD_DAYS, type CalendarChange, type CalendarEvent } from '@shared/calendar'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import { eventLine } from '../tools/calendar'
import { eventWhen, formatDateTime } from '../tools/format'
import { nowLine } from './context'
import type { StartingData } from './day'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'long' })
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const DAY_OF_YEAR = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const DAY_AND_YEAR = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

/** Two days in words, the year said when they are not in the same one: "9 nov – 16 mar 2027" reads as a year. */
function spanWords(from: number, to: number, joint: [string, string] = ['', ' – ']): string {
  const year = (at: number): number => new Date(at).getFullYear()
  const day = year(from) === year(to) ? DAY_OF_YEAR : DAY_AND_YEAR
  return `${joint[0]}${day.format(new Date(from))}${joint[1]}${day.format(new Date(to))}`
}

const KIND_WORDS: Readonly<Record<CalendarChange['kind'], string>> = {
  nuovo: 'Nuovo',
  cambiato: 'Cambiato',
  annullato: 'Annullato'
}

function startsAt(event: CalendarEvent): number {
  return event.allDay ? new Date(`${event.start}T00:00`).getTime() : Date.parse(event.start)
}

/**
 * The days a calendar holds, and the Segretario attends to — by when events
 * start: from two months back to a year ahead (`CALENDAR_HELD_DAYS`), sliding
 * with the days. Not a choice of anyone's: what the calendar keeps.
 */
export function heldWindow(now = Date.now()): { from: number; today: number; to: number } {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const at = (offset: number): number =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).getTime()

  return {
    from: at(-CALENDAR_HELD_DAYS.back),
    today: today.getTime(),
    to: at(CALENDAR_HELD_DAYS.ahead + 1)
  }
}

/** Whether a change touches what the calendar holds: an event in its window, or moved out of it. */
export function changeHeld(change: CalendarChange, now = Date.now()): boolean {
  const window = heldWindow(now)
  return [change.event, change.before].some(
    (event) => event !== null && startsAt(event) >= window.from && startsAt(event) < window.to
  )
}

/** What moved in an event, in words: its time, title, place, who answered what. */
function whatChanged(before: CalendarEvent, after: CalendarEvent): string[] {
  const lines: string[] = []

  if (before.start !== after.start || before.end !== after.end || before.allDay !== after.allDay) {
    lines.push(`   prima: ${eventWhen(before.start, before.end, before.allDay)}`)
  }

  if (before.title !== after.title) {
    lines.push(`   titolo prima: ${before.title}`)
  }

  if (before.location !== after.location) {
    lines.push(`   luogo prima: ${before.location ?? 'nessuno'}`)
  }

  const answers = new Map(before.attendees.map((attendee) => [attendee.email, attendee.response]))

  for (const attendee of after.attendees) {
    const was = answers.get(attendee.email)

    if (was === undefined && !attendee.self) {
      lines.push(`   invitato ora: ${attendee.name ?? attendee.email}`)
    } else if (was !== undefined && was !== attendee.response) {
      lines.push(
        `   ${attendee.self ? "l'utente" : (attendee.name ?? attendee.email)} ha risposto: ${attendee.response}`
      )
    }
  }

  return lines
}

/**
 * What a look at the calendar starts from: what changed not by its hand —
 * elsewhere, or by the user in the app — oldest first; the same change to
 * the instances of one series (a series added, moved, cancelled), once.
 */
export function prepareCalendarChanges(changes: ReadonlyArray<CalendarChange>): StartingData {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const groups: CalendarChange[][] = []

  for (const change of changes) {
    const series = change.event.seriesId ?? null
    const group = series
      ? groups.find(
          (candidate) =>
            candidate[0].kind === change.kind &&
            candidate[0].inApp === change.inApp &&
            candidate[0].event.seriesId === series
        )
      : undefined

    if (group) {
      group.push(change)
    } else {
      groups.push([change])
    }
  }

  const lines = groups.map((group) => {
    const [change] = group
    const line = eventLine(change.event, { handles, newHandles: added })
    const moved =
      change.kind === 'cambiato' && change.before ? whatChanged(change.before, change.event) : []
    return [
      `${KIND_WORDS[change.kind]} ${change.inApp ? "dall'utente, qui nell'app" : "fuori dall'app"} (${formatDateTime(new Date(change.at).toISOString())}): ${line}`,
      ...(group.length > 1
        ? [`   ${seriesWords(group.map((each) => each.event))}: lo stesso per tutte`]
        : []),
      ...moved
    ].join('\n')
  })

  return {
    title: `Calendario · ${groups.length === 1 ? changes[0].event.title : `${groups.length} cambiamenti`}`,
    data: `${nowLine()}\n\n## Cambiati nel calendario, non da te\n\n${lines.join('\n\n')}`,
    handles: added,
    seen: new Map()
  }
}

/** What one look takes at most — an event, or a series once: what a run reads well at once. */
export const CALENDAR_LOOK_CHUNK = 50

/** When an event starts, as a moment: an all-day one at its day's midnight, here. */
export function eventStart(event: CalendarEvent): number {
  return startsAt(event)
}

/**
 * One thing of a calendar to look at: an event, or a recurring series once —
 * placed at its next instance from today, or its last if all are past — with
 * the instances the window holds.
 */
export interface LookItem {
  event: CalendarEvent
  instances: CalendarEvent[]
  /** When it stands in the calendar: the start of `event`. */
  at: number
}

/** The things to look at among a calendar's events, in order: a series as one. */
export function lookItems(events: ReadonlyArray<CalendarEvent>, today: number): LookItem[] {
  const single: LookItem[] = []
  const series = new Map<string, CalendarEvent[]>()

  for (const event of events) {
    const id = event.seriesId ?? null

    if (id === null) {
      single.push({ event, instances: [event], at: startsAt(event) })
    } else {
      series.set(`${event.calendarId}\u0000${id}`, [
        ...(series.get(`${event.calendarId}\u0000${id}`) ?? []),
        event
      ])
    }
  }

  const repeated = [...series.values()].map((instances): LookItem => {
    const ordered = [...instances].sort((left, right) => startsAt(left) - startsAt(right))
    const event =
      ordered.find((instance) => startsAt(instance) >= today) ?? ordered[ordered.length - 1]
    return { event, instances: ordered, at: startsAt(event) }
  })

  return [...single, ...repeated].sort((left, right) => left.at - right.at)
}

/** A block of a calendar's first look: the things that stand from one moment to another. */
export interface LookBlock {
  from: number
  to: number
  /** What is coming, rather than what is past. */
  ahead: boolean
}

/**
 * The blocks a range of the window is looked at in: at most a chunk of
 * things each — never splitting a moment — what is past apart from what is
 * coming. Together they cover the range; each is looked at on its own, in
 * parallel with the others.
 */
export function lookBlocks(
  items: ReadonlyArray<LookItem>,
  range: { from: number; to: number },
  today: number
): LookBlock[] {
  const blocks: LookBlock[] = []
  const halves = [
    { from: range.from, to: Math.min(range.to, today), ahead: false },
    { from: Math.max(range.from, today), to: range.to, ahead: true }
  ].filter((half) => half.from < half.to)

  for (const half of halves) {
    const within = items.filter((item) => item.at >= half.from && item.at < half.to)

    if (within.length === 0) {
      continue
    }

    let start = half.from
    let index = 0

    while (index < within.length) {
      let end = Math.min(index + CALENDAR_LOOK_CHUNK, within.length)

      // Things at the same moment stay together: a block's edge is a moment.
      while (end < within.length && within[end].at === within[end - 1].at) {
        end += 1
      }

      const to = end < within.length ? within[end].at : half.to
      blocks.push({ from: start, to, ahead: half.ahead })
      start = to
      index = end
    }
  }

  return blocks
}

/** A series in words: how many times the window holds it, from when to when, and when it falls. */
function seriesWords(instances: ReadonlyArray<CalendarEvent>): string {
  const ordered = [...instances].sort((left, right) => startsAt(left) - startsAt(right))
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const weekdays = new Set(ordered.map((event) => WEEKDAY.format(new Date(startsAt(event)))))
  const times = new Set(
    ordered.map((event) => (event.allDay ? 'tutto il giorno' : TIME.format(new Date(event.start))))
  )
  const when =
    weekdays.size === 1 && times.size === 1
      ? `, ogni ${[...weekdays][0]} ${[...times][0] === 'tutto il giorno' ? 'tutto il giorno' : `alle ${[...times][0]}`}`
      : times.size === 1 && [...times][0] !== 'tutto il giorno'
        ? `, alle ${[...times][0]}`
        : ''
  return `si ripete ${ordered.length} volte nel calendario, ${spanWords(startsAt(first), startsAt(last), ['dal ', ' al '])}${when}`
}

/**
 * What a block of a calendar's first look starts from: its things in order
 * — a series once, with how it repeats — the days coming, or those just gone.
 */
export function prepareCalendarLook(
  items: ReadonlyArray<LookItem>,
  calendar: string,
  ahead: boolean
): StartingData {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const lines = items.map((item) =>
    [
      eventLine(item.event, { handles, newHandles: added }),
      ...(item.instances.length > 1 ? [`   ${seriesWords(item.instances)}`] : [])
    ].join('\n')
  )
  const first = items[0]
  const last = items[items.length - 1]

  return {
    title: `Calendario · ${calendar}`,
    data: `${nowLine()}\n\n## ${
      ahead
        ? `Gli impegni in arrivo di «${calendar}» che non hai ancora guardato`
        : `Gli incontri già passati di «${calendar}», che non hai ancora guardato`
    } (${spanWords(first.at, last.at)})\n\n${lines.join('\n')}`,
    handles: added,
    seen: new Map()
  }
}

/** How far the first look at a calendar has come (`ai_reading`): from one start to another. */
export interface LookedSpan {
  lookedFrom: number | null
  lookedUntil: number | null
}

/**
 * Whether a calendar's first look is done: what it looked at spans a whole
 * window. After it, the calendar is looked at by what changes in it.
 */
export function firstLookDone(span: LookedSpan | undefined | null): boolean {
  return (
    span?.lookedFrom != null &&
    span.lookedUntil != null &&
    span.lookedUntil - span.lookedFrom >=
      (CALENDAR_HELD_DAYS.back + CALENDAR_HELD_DAYS.ahead) * DAY_MS
  )
}

/**
 * What of the window a calendar's first look has still to see: all of it,
 * or — looked at before up to a nearer day — what is beyond.
 */
export function unlooked(
  span: LookedSpan | undefined | null,
  window: { from: number; to: number }
): Array<{ from: number; to: number }> {
  if (span?.lookedFrom == null || span.lookedUntil == null) {
    return [{ from: window.from, to: window.to }]
  }

  return [
    { from: window.from, to: Math.min(span.lookedFrom, window.to) },
    { from: Math.max(span.lookedUntil, window.from), to: window.to }
  ].filter((range) => range.from < range.to)
}
