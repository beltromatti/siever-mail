import { MapPin, Video } from 'lucide-react'

import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarResponse } from '@shared/calendar'

const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

export const RESPONSE_LABELS: Readonly<Record<CalendarResponse, string>> = {
  accepted: 'Partecipi',
  tentative: 'Forse',
  declined: 'Non partecipi',
  needsAction: 'Da rispondere'
}

/** "9:00–10:30", "dalle 18:00", or "Tutto il giorno": when an event is, on the day it is listed. */
export function eventTimeLabel(event: CalendarEvent, day: Date): string {
  if (event.allDay) {
    return 'Tutto il giorno'
  }

  const start = new Date(event.start)
  const end = new Date(event.end)
  const startsToday = start.toDateString() === day.toDateString()
  const endsToday = end.toDateString() === day.toDateString()

  if (startsToday && endsToday) {
    return `${TIME.format(start)}–${TIME.format(end)}`
  }

  return startsToday
    ? `dalle ${TIME.format(start)}`
    : endsToday
      ? `fino alle ${TIME.format(end)}`
      : 'Tutto il giorno'
}

/**
 * An event in a list: when, what, where — the call one click away — and
 * the user's answer when it is still to give.
 */
export function EventLine({
  event,
  day,
  now
}: {
  event: CalendarEvent
  /** The day it is listed under. */
  day: Date
  now: number
}): React.JSX.Element {
  const over = !event.allDay && Date.parse(event.end) < now

  return (
    <li
      className={cn(
        'grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 py-1.5',
        over && 'opacity-55'
      )}
    >
      <span className="text-muted-foreground text-[12px] tabular-nums">
        {eventTimeLabel(event, day)}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground text-[14px] leading-[1.35] font-medium">
          {event.title}
          {event.myResponse && event.myResponse !== 'accepted' && (
            <span
              className={cn(
                'ml-2 text-[11.5px] font-semibold',
                event.myResponse === 'needsAction' ? 'text-urgent' : 'text-muted-foreground'
              )}
            >
              {RESPONSE_LABELS[event.myResponse]}
            </span>
          )}
        </span>
        {(event.location || event.meetLink) && (
          <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-[12px]">
            {event.location && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
            {event.meetLink && (
              <button
                type="button"
                onClick={() =>
                  event.meetLink && void window.mailApi.openExternalUrl(event.meetLink)
                }
                className="text-primary-text hover:text-foreground focus-visible:ring-ring/60 flex shrink-0 items-center gap-1 rounded-sm font-semibold outline-none focus-visible:ring-2"
              >
                <Video className="size-3" />
                Entra nella call
              </button>
            )}
          </span>
        )}
      </span>
    </li>
  )
}
