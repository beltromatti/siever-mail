import { CALENDAR_HELD_DAYS, type CalendarChange, type CalendarEvent } from '@shared/calendar'
import { CALENDAR_LOOK_AHEAD_DAYS } from '@shared/segretario'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import { eventLine } from '../tools/calendar'
import { formatDateTime, shortDate } from '../tools/format'
import { nowLine } from './context'
import type { StartingData } from './day'

/** How far around today a change to the calendar is worth the Segretario's look. */
export const CALENDAR_LOOK_BACK_MS = 24 * 60 * 60 * 1000
export const CALENDAR_LOOK_AHEAD_MS = 60 * 24 * 60 * 60 * 1000

const KIND_WORDS: Readonly<Record<CalendarChange['kind'], string>> = {
  nuovo: 'Nuovo',
  cambiato: 'Cambiato',
  annullato: 'Annullato'
}

function startsAt(event: CalendarEvent): number {
  return event.allDay ? new Date(`${event.start}T00:00`).getTime() : Date.parse(event.start)
}

/** Whether a change touches the days that matter now: from yesterday to two months ahead. */
export function changeMatters(change: CalendarChange, now = Date.now()): boolean {
  return [change.event, change.before].some((event) => {
    if (!event) {
      return false
    }

    const start = startsAt(event)
    return start >= now - CALENDAR_LOOK_BACK_MS && start <= now + CALENDAR_LOOK_AHEAD_MS
  })
}

/** What moved in an event, in words: its time, title, place, who answered what. */
function whatChanged(before: CalendarEvent, after: CalendarEvent): string[] {
  const lines: string[] = []

  if (before.start !== after.start || before.end !== after.end || before.allDay !== after.allDay) {
    lines.push(
      `   prima: ${before.allDay ? `${before.start}, tutto il giorno` : `${formatDateTime(before.start)}–${formatDateTime(before.end)}`}`
    )
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

/** What a look at the calendar starts from: what changed not by its hand — elsewhere, or by the user in the app — oldest first. */
export function prepareCalendarChanges(changes: ReadonlyArray<CalendarChange>): StartingData {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const lines = changes.map((change) => {
    const line = eventLine(change.event, { handles, newHandles: added })
    const moved =
      change.kind === 'cambiato' && change.before ? whatChanged(change.before, change.event) : []
    return [
      `${KIND_WORDS[change.kind]} ${change.inApp ? "dall'utente, qui nell'app" : "fuori dall'app"} (${formatDateTime(new Date(change.at).toISOString())}): ${line}`,
      ...moved
    ].join('\n')
  })

  return {
    title: `Calendario · ${changes.length === 1 ? changes[0].event.title : `${changes.length} cambiamenti`}`,
    data: `${nowLine()}\n\n## Cambiati nel calendario, non da te\n\n${lines.join('\n\n')}`,
    handles: added,
    seen: new Map()
  }
}

/** Events one look takes at most: what a run reads well at once. */
export const CALENDAR_LOOK_CHUNK = 50

/** How far a calendar's events have been looked at: from one start to another, the first in, the last out. */
export interface LookedSpan {
  lookedFrom: number | null
  lookedUntil: number | null
}

/**
 * The days of a calendar the Segretario looks at one by one, by when its
 * events start: back as far as its horizon (and the calendar keeps), ahead
 * the days that are coming.
 */
export function lookWindow(
  days: number,
  now = Date.now()
): { from: number; today: number; to: number } {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const at = (offset: number): number =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).getTime()

  return {
    from: at(-Math.min(days, CALENDAR_HELD_DAYS.back)),
    today: today.getTime(),
    to: at(CALENDAR_LOOK_AHEAD_DAYS + 1)
  }
}

/**
 * What of the window is not looked at yet: the days ahead first — what is
 * coming, and the day that came into the window since — then the past, as
 * far back as the horizon. Null when it is all looked at.
 */
export function nextLook(
  span: LookedSpan,
  window: { from: number; today: number; to: number }
): { from: number; to: number; ahead: boolean } | null {
  const aheadFrom = span.lookedUntil ?? window.today

  if (aheadFrom < window.to) {
    return { from: aheadFrom, to: window.to, ahead: true }
  }

  const backTo = span.lookedFrom ?? window.today
  return window.from < backTo ? { from: window.from, to: backTo, ahead: false } : null
}

/** When an event starts, as a moment: an all-day one at its day's midnight, here. */
export function eventStart(event: CalendarEvent): number {
  return startsAt(event)
}

/**
 * The events of a look, from those of the range: ahead the earliest first,
 * back the latest first — at most a chunk, never splitting a moment in two
 * — and the span looked at once they are.
 */
export function lookChunk(
  events: ReadonlyArray<CalendarEvent>,
  range: { from: number; to: number; ahead: boolean },
  span: LookedSpan,
  today: number
): { events: CalendarEvent[]; span: { lookedFrom: number; lookedUntil: number } } {
  const ordered = [...events]
    .filter((event) => {
      const start = startsAt(event)
      return start >= range.from && start < range.to
    })
    .sort((left, right) =>
      range.ahead ? startsAt(left) - startsAt(right) : startsAt(right) - startsAt(left)
    )
  let taken = Math.min(ordered.length, CALENDAR_LOOK_CHUNK)

  // Events at the same moment stay together: the span's edge is a moment, and all of it is looked at.
  while (taken < ordered.length && startsAt(ordered[taken]) === startsAt(ordered[taken - 1])) {
    taken += 1
  }

  const chunk = ordered.slice(0, taken)
  const rest = ordered[taken]
  const lookedFrom = span.lookedFrom ?? today
  const lookedUntil = span.lookedUntil ?? today

  return {
    events: chunk,
    span: range.ahead
      ? { lookedFrom, lookedUntil: rest ? startsAt(rest) : range.to }
      : { lookedFrom: rest ? startsAt(chunk[chunk.length - 1]) : range.from, lookedUntil }
  }
}

/**
 * What a first look at a calendar starts from: its events the Segretario
 * has not looked at yet — the days coming, or those just gone — in order.
 */
export function prepareCalendarLook(
  events: ReadonlyArray<CalendarEvent>,
  calendar: string,
  ahead: boolean
): StartingData {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const lines = events.map((event) => eventLine(event, { handles, newHandles: added }))
  const first = events[0]
  const last = events[events.length - 1]
  const days = (event: CalendarEvent): string => shortDate(new Date(startsAt(event)).toISOString())

  return {
    title: `Calendario · ${calendar}`,
    data: `${nowLine()}\n\n## ${
      ahead
        ? `Gli impegni in arrivo di «${calendar}» che non hai ancora guardato`
        : `Gli incontri già passati di «${calendar}», che non hai ancora guardato`
    } (${days(ahead ? first : last)} – ${days(ahead ? last : first)})\n\n${lines.join('\n')}`,
    handles: added,
    seen: new Map()
  }
}
