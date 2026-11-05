import type { CalendarChange, CalendarEvent } from '@shared/calendar'

import { HandleRegistry, type HandleRecord } from '../agent/handles'
import { eventLine } from '../tools/calendar'
import { formatDateTime } from '../tools/format'
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

/** What a look at the calendar starts from: what changed elsewhere, oldest first. */
export function prepareCalendarChanges(changes: ReadonlyArray<CalendarChange>): StartingData {
  const handles = new HandleRegistry()
  const added: HandleRecord[] = []
  const lines = changes.map((change) => {
    const line = eventLine(change.event, { handles, newHandles: added })
    const moved =
      change.kind === 'cambiato' && change.before ? whatChanged(change.before, change.event) : []
    return [
      `${KIND_WORDS[change.kind]} (${formatDateTime(new Date(change.at).toISOString())}): ${line}`,
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
