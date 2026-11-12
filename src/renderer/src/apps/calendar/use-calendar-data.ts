import { useCallback, useEffect, useState } from 'react'

import {
  calendarKey,
  type CalendarEvent,
  type CalendarListEntry,
  type CalendarRole
} from '@shared/calendar'
import type { DayLine, Proposal } from '@shared/segretario'

import { dayKey, dayOfKey } from '@renderer/features/calendar/calendar-dates'

/**
 * Every connected calendar, kept as the calendars change; and the ways to
 * show or hide one, and to say whose its events are (§7.4).
 */
export function useCalendarList(): {
  calendars: CalendarListEntry[] | null
  setHidden: (key: string, hidden: boolean) => void
  setRole: (key: string, role: CalendarRole | null) => Promise<void>
} {
  const [calendars, setCalendars] = useState<CalendarListEntry[] | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.calendarApi
        .calendars()
        .then((loaded) => current && setCalendars(loaded))
        .catch(() => undefined)

    load()
    const unsubscribe = window.calendarApi.onChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  const setHidden = useCallback((key: string, hidden: boolean): void => {
    setCalendars(
      (current) =>
        current?.map((entry) => (entry.key === key ? { ...entry, hidden } : entry)) ?? null
    )
    void window.calendarApi
      .setCalendarHidden(key, hidden)
      .then(setCalendars)
      .catch(() => undefined)
  }, [])

  const setRole = useCallback(async (key: string, role: CalendarRole | null): Promise<void> => {
    setCalendars(await window.calendarApi.setCalendarRole(key, role))
  }, [])

  return { calendars, setHidden, setRole }
}

/** The calendar an event is in, of those listed. */
export function calendarOf(
  event: Pick<CalendarEvent, 'connectionId' | 'calendarId'>,
  calendars: ReadonlyArray<CalendarListEntry> | null
): CalendarListEntry | undefined {
  const key = calendarKey(event.connectionId, event.calendarId)
  return calendars?.find((calendar) => calendar.key === key)
}

/** An event proposed by the Segretario, as the calendar places it. */
export interface ProposedEvent {
  proposal: Proposal
  title: string
  start: string
  end: string
  allDay: boolean
}

/** A proposal of an event, when it says when. */
export function proposedEvent(proposal: Proposal): ProposedEvent | null {
  const { title, start, end, allDay } = proposal.payload

  if (proposal.kind !== 'evento' || typeof start !== 'string' || typeof end !== 'string') {
    return null
  }

  return {
    proposal,
    title: typeof title === 'string' ? title : proposal.title,
    start,
    end,
    allDay: allDay === true
  }
}

/**
 * The Segretario's layers on the calendar, between two days: what is due
 * in the mail on each, and the events it proposes. Read again as the work
 * changes; nothing with the AI off.
 */
export function useSegretarioLayers(
  from: Date,
  to: Date,
  enabled: boolean
): { due: DayLine[]; proposals: ProposedEvent[] } {
  const [due, setDue] = useState<DayLine[]>([])
  const [proposals, setProposals] = useState<ProposedEvent[]>([])
  const fromKey = dayKey(from)
  const toKey = dayKey(to)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let current = true
    let timer: number | null = null
    const load = (): void => {
      // Due through the last day shown; what was due before the first is not on these days.
      const lastDay = dayKey(new Date(dayOfKey(toKey).getTime() - 1))
      void window.segretarioApi
        .getDue(lastDay)
        .then(
          (lines) =>
            current && setDue(lines.filter((line) => line.due !== null && line.due >= fromKey))
        )
        .catch(() => undefined)
      void window.segretarioApi
        .listProposals()
        .then(
          (open) =>
            current && setProposals(open.flatMap((proposal) => proposedEvent(proposal) ?? []))
        )
        .catch(() => undefined)
    }

    load()
    const unsubscribe = window.segretarioApi.onWorkChanged(() => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }

      timer = window.setTimeout(load, 1200)
    })

    return () => {
      current = false
      unsubscribe()

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [enabled, fromKey, toKey])

  return enabled ? { due, proposals } : { due: [], proposals: [] }
}
