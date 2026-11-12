import { MapPin, Video } from 'lucide-react'

import { hourStyle, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarResponse } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { LinkedText } from '@shared/segretario'

import { LinkedWords } from '@renderer/features/segretario/segretario-text'

import { dateFormat } from './calendar-dates'
import { RepeatMark } from './repeat-mark'

const MESSAGES = defineMessages({
  allDay: { en: 'All day', it: 'Tutto il giorno', de: 'Ganztägig' },
  from: {
    en: (time: string) => `from ${time}`,
    it: (time: string) => `dalle ${time}`,
    de: (time: string) => `ab ${time}`
  },
  until: {
    en: (time: string) => `until ${time}`,
    it: (time: string) => `fino alle ${time}`,
    de: (time: string) => `bis ${time}`
  },
  joinCall: { en: 'Join the call', it: 'Entra nella call', de: 'Dem Anruf beitreten' }
})

/** The user's answer to an invitation, as a list and the panel say it. */
export const RESPONSE_LABELS = defineMessages({
  accepted: { en: 'Going', it: 'Partecipi', de: 'Zugesagt' },
  tentative: { en: 'Maybe', it: 'Forse', de: 'Vielleicht' },
  declined: { en: 'Not going', it: 'Non partecipi', de: 'Abgesagt' },
  needsAction: { en: 'No reply yet', it: 'Da rispondere', de: 'Noch nicht beantwortet' }
}) satisfies Record<CalendarResponse, unknown>

/** Made when used: the hour is written as the region writes it now. */
const TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

/** "9:00–10:30", "from 18:00", or "All day": when an event is, on the day it is listed. */
export function eventTimeLabel(event: CalendarEvent, day: Date): string {
  const m = messagesNow(MESSAGES)

  if (event.allDay) {
    return m.allDay
  }

  const time = dateFormat(TIME())
  const start = new Date(event.start)
  const end = new Date(event.end)
  const startsToday = start.toDateString() === day.toDateString()
  const endsToday = end.toDateString() === day.toDateString()

  if (startsToday && endsToday) {
    return `${time.format(start)}–${time.format(end)}`
  }

  return startsToday ? m.from(time.format(start)) : endsToday ? m.until(time.format(end)) : m.allDay
}

/**
 * An event in a list: when, what, where — the call one click away — and
 * the user's answer when it is still to give.
 */
export function EventLine({
  event,
  day,
  now,
  prep
}: {
  event: CalendarEvent
  /** The day it is listed under. */
  day: Date
  now: number
  /** How to prepare for it, as the Segretario wrote it. */
  prep?: LinkedText
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const responses = useMessages(RESPONSE_LABELS)
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
          <RepeatMark event={event} className="ml-1.5" />
          {event.myResponse && event.myResponse !== 'accepted' && (
            <span
              className={cn(
                'ml-2 text-[11.5px] font-semibold',
                event.myResponse === 'needsAction' ? 'text-urgent' : 'text-muted-foreground'
              )}
            >
              {responses[event.myResponse]}
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
                {m.joinCall}
              </button>
            )}
          </span>
        )}
        {prep && (
          <LinkedWords
            text={prep.text}
            links={prep.links}
            className="text-muted-foreground border-ai-line mt-1 border-l-2 pl-2.5 text-[13.5px] leading-[1.45]"
          />
        )}
      </span>
    </li>
  )
}
