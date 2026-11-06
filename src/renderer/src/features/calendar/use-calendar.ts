import { useCallback, useEffect, useState } from 'react'

import type { CalendarConnection, CalendarEvent } from '@shared/calendar'

/**
 * The accounts' calendars and how each stands, kept as they change. Calendars
 * that could not be read are none — or, read before, those last known — so
 * nothing waits on them for ever.
 */
export function useCalendarConnections(): {
  connections: CalendarConnection[] | null
  reload: () => Promise<void>
  setConnections: (connections: CalendarConnection[]) => void
} {
  const [connections, setConnections] = useState<CalendarConnection[] | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setConnections(await window.calendarApi.listConnections())
  }, [])

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.calendarApi.listConnections().then(
        (loaded) => current && setConnections(loaded),
        () => current && setConnections((known) => known ?? [])
      )

    load()
    const unsubscribe = window.calendarApi.onChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  return { connections, reload, setConnections }
}

/** The events between two instants, read again whenever the calendars change. */
export function useCalendarEvents(fromIso: string, toIso: string): CalendarEvent[] | null {
  const [events, setEvents] = useState<{ range: string; events: CalendarEvent[] } | null>(null)
  const range = `${fromIso}/${toIso}`

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.calendarApi
        .events(fromIso, toIso)
        .then((loaded) => current && setEvents({ range, events: loaded }))

    load()
    const unsubscribe = window.calendarApi.onChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [fromIso, range, toIso])

  return events?.range === range ? events.events : null
}
