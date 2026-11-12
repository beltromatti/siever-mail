import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { messagesNow } from '@renderer/lib/i18n'
import type { CalendarConnection, CalendarEvent, CalendarListEntry } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  eventsUnreadable: {
    en: 'The events cannot be read',
    it: 'Gli eventi non si leggono',
    de: 'Die Termine lassen sich nicht lesen'
  }
})

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

/**
 * Every calendar — its colour, whether it is shown, whose its events are
 * (§7.4) —, read again whenever the calendars change. None while unread,
 * or when they could not be read.
 */
export function useCalendarList(): {
  calendars: CalendarListEntry[] | null
  setCalendars: (calendars: CalendarListEntry[]) => void
} {
  const [calendars, setCalendars] = useState<CalendarListEntry[] | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.calendarApi.calendars().then(
        (loaded) => current && setCalendars(loaded),
        () => current && setCalendars((known) => known ?? [])
      )

    load()
    const unsubscribe = window.calendarApi.onChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  return { calendars, setCalendars }
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
        .catch(
          (error: unknown) =>
            current &&
            toast.error(messagesNow(MESSAGES).eventsUnreadable, {
              id: 'calendar-events',
              description: error instanceof Error ? error.message : undefined
            })
        )

    load()
    const unsubscribe = window.calendarApi.onChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [fromIso, range, toIso])

  return events?.range === range ? events.events : null
}
