import { Flag } from 'lucide-react'

import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry } from '@shared/calendar'
import type { DayLine } from '@shared/segretario'

import {
  addDays,
  dayKey,
  eventSpan,
  isOnDay,
  sameDay
} from '@renderer/features/calendar/calendar-dates'
import { dotStyle, eventTint } from './event-style'
import type { CalendarSelection, DrawnRange } from './time-grid'
import { calendarOf, type ProposedEvent } from './use-calendar-data'

/** Entries a day's cell lists before it says how many more there are. */
const SHOWN_PER_DAY = 3
const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

type Entry =
  | { kind: 'event'; key: string; event: CalendarEvent; start: number }
  | { kind: 'proposal'; key: string; proposed: ProposedEvent; start: number }
  | { kind: 'due'; key: string; line: DayLine; start: number }

/**
 * A month a week a row: each day with its first events — all day first,
 * then by time — its deadlines and the proposals, and how many more. A
 * day's number opens it; a double click on it draws an event there.
 */
export function MonthGrid({
  days,
  month,
  events,
  calendars,
  due,
  proposals,
  selection,
  onSelect,
  onOpenDay,
  onDraw,
  onOpenLine
}: {
  days: ReadonlyArray<Date>
  /** The month shown: the days of the others are quieter. */
  month: number
  events: ReadonlyArray<CalendarEvent>
  calendars: ReadonlyArray<CalendarListEntry> | null
  due: ReadonlyArray<DayLine>
  proposals: ReadonlyArray<ProposedEvent>
  selection: CalendarSelection
  onSelect: (selection: CalendarSelection) => void
  onOpenDay: (day: Date) => void
  onDraw: (range: DrawnRange) => void
  onOpenLine: (line: DayLine) => void
}): React.JSX.Element {
  const today = new Date()
  const selectedId =
    selection?.kind === 'event'
      ? selection.key
      : selection?.kind === 'proposal'
        ? selection.id
        : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="text-muted-foreground border-l py-2 text-center text-[11.5px] uppercase first:border-l-0"
          >
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const entries: Entry[] = [
            ...events
              .filter((event) => isOnDay(event, day))
              .map((event) => ({
                kind: 'event' as const,
                key: event.key,
                event,
                start: event.allDay ? -Infinity : eventSpan(event).start
              })),
            ...proposals
              .filter((proposed) => isOnDay(proposed, day))
              .map((proposed) => ({
                kind: 'proposal' as const,
                key: proposed.proposal.id,
                proposed,
                start: proposed.allDay ? -Infinity : eventSpan(proposed).start
              })),
            ...due
              .filter((line) => line.due === dayKey(day))
              .map((line) => ({
                kind: 'due' as const,
                key: `${line.messageKey}\u0000${line.commitment?.id ?? ''}`,
                line,
                start: Infinity
              }))
          ].sort((a, b) => a.start - b.start)
          const more = entries.length - SHOWN_PER_DAY
          const inMonth = day.getMonth() === month

          return (
            <div
              key={dayKey(day)}
              className={cn(
                'flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-t border-l p-1 [&:nth-child(7n+1)]:border-l-0',
                !inMonth && 'bg-hover/40'
              )}
              onDoubleClick={(event) => {
                if (event.target === event.currentTarget) {
                  onDraw({ start: day.getTime(), end: addDays(day, 1).getTime(), allDay: true })
                }
              }}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                className={cn(
                  'focus-visible:ring-ring/60 grid size-6 shrink-0 place-items-center self-start rounded-full text-[12px] tabular-nums outline-none hover:underline focus-visible:ring-2',
                  sameDay(day, today)
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : inMonth
                      ? 'text-foreground'
                      : 'text-faint-foreground'
                )}
              >
                {day.getDate()}
              </button>
              {entries.slice(0, SHOWN_PER_DAY).map((entry) =>
                entry.kind === 'due' ? (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => onOpenLine(entry.line)}
                    title={entry.line.text}
                    className="text-ai focus-visible:ring-ring/60 flex min-w-0 items-center gap-1 rounded-[4px] px-1 text-left text-[11px] outline-none hover:underline focus-visible:ring-2"
                  >
                    <Flag className="size-3 shrink-0" />
                    <span className="truncate">{entry.line.text}</span>
                  </button>
                ) : entry.kind === 'proposal' ? (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => onSelect({ kind: 'proposal', id: entry.key })}
                    style={eventTint(null, true)}
                    className={cn(
                      'text-muted-foreground focus-visible:ring-ring/60 min-w-0 truncate rounded-[4px] border-l-[3px] px-1 text-left text-[11px] italic outline-none focus-visible:ring-2',
                      entry.key === selectedId && 'ring-ring ring-2'
                    )}
                  >
                    {entry.proposed.title}
                  </button>
                ) : (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => onSelect({ kind: 'event', key: entry.key })}
                    className={cn(
                      'focus-visible:ring-ring/60 hover:bg-hover flex min-w-0 items-center gap-1 rounded-[4px] px-1 text-left text-[11px] outline-none focus-visible:ring-2',
                      entry.key === selectedId && 'bg-selected',
                      entry.event.myResponse === 'declined' && 'line-through opacity-60'
                    )}
                    style={
                      entry.event.allDay
                        ? eventTint(calendarOf(entry.event, calendars)?.color ?? null)
                        : undefined
                    }
                  >
                    {!entry.event.allDay && (
                      <>
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={dotStyle(calendarOf(entry.event, calendars)?.color ?? null)}
                        />
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {TIME.format(Date.parse(entry.event.start))}
                        </span>
                      </>
                    )}
                    <span className="truncate">{entry.event.title}</span>
                  </button>
                )
              )}
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 self-start rounded-sm px-1 text-[11px] outline-none focus-visible:ring-2"
                >
                  {more === 1 ? 'un altro' : `altri ${more}`}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
