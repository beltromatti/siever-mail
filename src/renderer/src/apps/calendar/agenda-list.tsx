import { MapPin } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { eventTimeLabel, RESPONSE_LABELS } from '@renderer/features/calendar/event-line'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry } from '@shared/calendar'
import type { DayLine } from '@shared/segretario'

import { COMMITMENT_LABELS } from '@renderer/features/segretario/row-work'
import {
  DayLineSourceIcon,
  dayLineKey,
  dayLineSourceWords
} from '@renderer/features/segretario/day-line-source'

import { dayKey, isOnDay, sameDay } from '@renderer/features/calendar/calendar-dates'
import { dotStyle } from './event-style'
import type { CalendarSelection } from './time-grid'
import { calendarOf, type ProposedEvent } from './use-calendar-data'

const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short' })
const MONTH = new Intl.DateTimeFormat('it-IT', { month: 'short' })

/**
 * The days ahead one under the other: each with its events, the deadlines
 * the mail gives it and the events proposed, as a list to read through.
 * Days with nothing are left out, today aside.
 */
export function AgendaList({
  days,
  events,
  calendars,
  due,
  proposals,
  selection,
  onSelect,
  onOpenLine
}: {
  days: ReadonlyArray<Date>
  events: ReadonlyArray<CalendarEvent>
  calendars: ReadonlyArray<CalendarListEntry> | null
  due: ReadonlyArray<DayLine>
  proposals: ReadonlyArray<ProposedEvent>
  selection: CalendarSelection
  onSelect: (selection: CalendarSelection) => void
  onOpenLine: (line: DayLine) => void
}): React.JSX.Element {
  const today = new Date()
  const selectedId =
    selection?.kind === 'event'
      ? selection.key
      : selection?.kind === 'proposal'
        ? selection.id
        : null
  const shown = days
    .map((day) => ({
      day,
      events: events.filter((event) => isOnDay(event, day)),
      proposals: proposals.filter((proposed) => isOnDay(proposed, day)),
      due: due.filter((line) => line.due === dayKey(day))
    }))
    .filter(
      (entry) =>
        entry.events.length + entry.proposals.length + entry.due.length > 0 ||
        sameDay(entry.day, today)
    )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-[760px] flex-col">
        {shown.map(({ day, events: ofDay, proposals: proposedOfDay, due: dueOfDay }) => {
          const isToday = sameDay(day, today)

          return (
            <section
              key={dayKey(day)}
              aria-label={day.toLocaleDateString('it-IT', { dateStyle: 'full' })}
              className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-5 border-b py-4 last:border-b-0"
            >
              <div className="flex flex-col items-start leading-none">
                <span className="eyebrow">{isToday ? 'Oggi' : WEEKDAY.format(day)}</span>
                <span
                  className={cn(
                    'display-title mt-1 text-[26px] tabular-nums',
                    isToday && 'text-primary-text'
                  )}
                >
                  {day.getDate()}
                </span>
                <span className="text-faint-foreground mt-1 text-[11px]">{MONTH.format(day)}</span>
              </div>
              {ofDay.length + proposedOfDay.length + dueOfDay.length === 0 ? (
                <p className="text-muted-foreground self-center text-[13px]">Niente in agenda.</p>
              ) : (
                <ul className="flex min-w-0 flex-col gap-0.5">
                  {ofDay.map((event) => (
                    <li key={event.key}>
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: 'event', key: event.key })}
                        className={cn(
                          'hover:bg-hover focus-visible:ring-ring/60 grid w-full grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 rounded-[7px] px-2 py-1.5 text-left outline-none focus-visible:ring-2',
                          event.key === selectedId && 'bg-selected'
                        )}
                      >
                        <span className="text-muted-foreground flex items-center gap-1.5 text-[12px] tabular-nums">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={dotStyle(calendarOf(event, calendars)?.color ?? null)}
                          />
                          {eventTimeLabel(event, day)}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span
                            className={cn(
                              'text-foreground text-[14px] leading-[1.35] font-medium',
                              event.myResponse === 'declined' && 'line-through opacity-60'
                            )}
                          >
                            {event.title}
                            {event.myResponse &&
                              event.myResponse !== 'accepted' &&
                              event.myResponse !== 'declined' && (
                                <span
                                  className={cn(
                                    'ml-2 text-[11.5px] font-semibold',
                                    event.myResponse === 'needsAction'
                                      ? 'text-urgent'
                                      : 'text-muted-foreground'
                                  )}
                                >
                                  {RESPONSE_LABELS[event.myResponse]}
                                </span>
                              )}
                          </span>
                          {event.location && (
                            <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-[12px]">
                              <MapPin className="size-3 shrink-0" />
                              <span className="truncate">{event.location}</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                  {proposedOfDay.map((proposed) => (
                    <li key={proposed.proposal.id}>
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: 'proposal', id: proposed.proposal.id })}
                        className={cn(
                          'hover:bg-hover focus-visible:ring-ring/60 grid w-full grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 rounded-[7px] px-2 py-1.5 text-left outline-none focus-visible:ring-2',
                          proposed.proposal.id === selectedId && 'bg-selected'
                        )}
                      >
                        <span className="text-ai flex items-center gap-1.5 text-[11.5px] font-semibold">
                          <CompassStar className="text-ai-star size-3" />
                          Proposto
                        </span>
                        <span className="text-muted-foreground truncate text-[14px] italic">
                          {proposed.title}
                        </span>
                      </button>
                    </li>
                  ))}
                  {dueOfDay.map((line) => (
                    <li key={dayLineKey(line)}>
                      <button
                        type="button"
                        onClick={() => onOpenLine(line)}
                        className="hover:bg-hover focus-visible:ring-ring/60 grid w-full grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 rounded-[7px] px-2 py-1.5 text-left outline-none focus-visible:ring-2"
                      >
                        <span className="text-ai flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap">
                          <DayLineSourceIcon line={line} className="size-3 shrink-0" />
                          {line.commitment ? COMMITMENT_LABELS[line.commitment.kind] : 'Scadenza'}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-foreground text-[14px] leading-[1.35]">
                            {line.text}
                          </span>
                          <span className="text-muted-foreground truncate text-[12px]">
                            {dayLineSourceWords(line)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
