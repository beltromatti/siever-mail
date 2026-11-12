import { useRef, useState } from 'react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { hourStyle, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { DayLine } from '@shared/segretario'
import { DayLineSourceIcon, dayLineKey } from '@renderer/features/segretario/day-line-source'

import {
  addDays,
  dateFormat,
  dayKey,
  eventSpan,
  isOnDay,
  sameDay,
  weekdayNames
} from '@renderer/features/calendar/calendar-dates'
import { canReschedule } from './calendar-menus'
import { dotStyle, eventTint } from './event-style'
import type { CalendarSelection, DrawnRange } from './time-grid'
import { calendarOf, type ProposedEvent } from './use-calendar-data'

/** Entries a day's cell lists before it says how many more there are. */
const SHOWN_PER_DAY = 3
/** How far the pointer goes on an event before a press becomes a move. */
const DRAG_THRESHOLD_PX = 4
/** Made when used: the hour is written as the region writes it now. */
const TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

const MESSAGES = defineMessages({
  more: {
    en: (count: number) => (count === 1 ? 'one more' : `${count} more`),
    it: (count: number) => (count === 1 ? 'un altro' : `altri ${count}`),
    de: (count: number) => (count === 1 ? 'ein weiterer' : `${count} weitere`)
  }
})

type Entry =
  | { kind: 'event'; key: string; event: CalendarEvent; start: number }
  | { kind: 'proposal'; key: string; proposed: ProposedEvent; start: number }
  | { kind: 'due'; key: string; line: DayLine; start: number }

/** An event taken on a day of the month, and the day the pointer is over now. */
interface Drag {
  event: CalendarEvent
  from: Date
  over: Date
  x: number
  y: number
  moving: boolean
}

/**
 * A month a week a row: each day with its first events — all day first,
 * then by time — its deadlines and the proposals, and how many more. A
 * day's number opens it; a double click on it draws an event there. An
 * event the user organises is dragged to another day, at the same hour;
 * everything has its right-click menu, the days too.
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
  onMoveDays,
  onOpenLine,
  onEventMenu,
  onProposalMenu,
  onDueMenu,
  onDayMenu
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
  /** An event dragged to another day: by how many days, the hour kept. */
  onMoveDays: (event: CalendarEvent, days: number) => void
  onOpenLine: (line: DayLine) => void
  onEventMenu: (event: CalendarEvent) => void
  onProposalMenu: (proposed: ProposedEvent) => void
  onDueMenu: (line: DayLine) => void
  onDayMenu: (day: Date) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const time = dateFormat(TIME())
  const today = new Date()
  const [drag, setDrag] = useState<Drag | null>(null)
  // A press that moved an event is not also a click on it.
  const draggedRef = useRef(false)
  const selectedId =
    selection?.kind === 'event'
      ? selection.key
      : selection?.kind === 'proposal'
        ? selection.id
        : null

  /** The day under the pointer: the cell it is over, found by its key. */
  const dayAt = (x: number, y: number): Date | null => {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]')
    return cell?.dataset.day ? (days.find((day) => dayKey(day) === cell.dataset.day) ?? null) : null
  }

  const dragEnd = (): void => {
    if (!drag) {
      return
    }

    draggedRef.current = drag.moving
    setDrag(null)
    const shift = Math.round((drag.over.getTime() - drag.from.getTime()) / 86_400_000)

    if (drag.moving && shift !== 0) {
      onMoveDays(drag.event, shift)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {weekdayNames('short').map((weekday, index) => (
          <div
            key={index}
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
                key: dayLineKey(line),
                line,
                start: Infinity
              }))
          ].sort((a, b) => a.start - b.start)
          const more = entries.length - SHOWN_PER_DAY
          const inMonth = day.getMonth() === month
          const dropHere = drag?.moving && sameDay(drag.over, day) && !sameDay(drag.from, day)

          return (
            <div
              key={dayKey(day)}
              data-day={dayKey(day)}
              className={cn(
                'flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-t border-l p-1 [&:nth-child(7n+1)]:border-l-0',
                !inMonth && 'bg-hover/40',
                dropHere && 'bg-selected'
              )}
              onDoubleClick={(event) => {
                if (event.target === event.currentTarget) {
                  onDraw({ start: day.getTime(), end: addDays(day, 1).getTime(), allDay: true })
                }
              }}
              onContextMenu={(event) => {
                if (event.target === event.currentTarget) {
                  event.preventDefault()
                  onDayMenu(day)
                }
              }}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onDayMenu(day)
                }}
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
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onDueMenu(entry.line)
                    }}
                    title={entry.line.text}
                    className="text-ai focus-visible:ring-ring/60 flex min-w-0 items-center gap-1 rounded-[4px] px-1 text-left text-[11px] outline-none hover:underline focus-visible:ring-2"
                  >
                    <DayLineSourceIcon line={entry.line} className="size-3 shrink-0" />
                    <span className="truncate">{entry.line.text}</span>
                  </button>
                ) : entry.kind === 'proposal' ? (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => onSelect({ kind: 'proposal', id: entry.key })}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onProposalMenu(entry.proposed)
                    }}
                    style={eventTint(null, true)}
                    className={cn(
                      'text-muted-foreground focus-visible:ring-ring/60 flex min-w-0 items-center gap-1 rounded-[4px] border-l-[3px] px-1 text-left text-[11px] italic outline-none focus-visible:ring-2',
                      entry.key === selectedId && 'ring-ring ring-2'
                    )}
                  >
                    <CompassStar className="text-ai-star size-3" />
                    <span className="truncate">{entry.proposed.title}</span>
                  </button>
                ) : (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => {
                      if (draggedRef.current) {
                        draggedRef.current = false
                        return
                      }

                      onSelect({ kind: 'event', key: entry.key })
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onEventMenu(entry.event)
                    }}
                    onPointerDown={(event) => {
                      if (
                        event.button !== 0 ||
                        event.ctrlKey ||
                        !canReschedule(entry.event, calendars)
                      ) {
                        return
                      }

                      event.currentTarget.setPointerCapture(event.pointerId)
                      draggedRef.current = false
                      setDrag({
                        event: entry.event,
                        from: day,
                        over: day,
                        x: event.clientX,
                        y: event.clientY,
                        moving: false
                      })
                    }}
                    onPointerMove={(event) => {
                      if (
                        !drag ||
                        (!drag.moving &&
                          Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <
                            DRAG_THRESHOLD_PX)
                      ) {
                        return
                      }

                      setDrag({
                        ...drag,
                        moving: true,
                        over: dayAt(event.clientX, event.clientY) ?? drag.over
                      })
                    }}
                    onPointerUp={dragEnd}
                    onPointerCancel={() => setDrag(null)}
                    className={cn(
                      'focus-visible:ring-ring/60 hover:bg-hover flex min-w-0 items-center gap-1 rounded-[4px] px-1 text-left text-[11px] outline-none focus-visible:ring-2',
                      entry.key === selectedId && 'bg-selected',
                      entry.event.myResponse === 'declined' && 'line-through opacity-60',
                      canReschedule(entry.event, calendars) && 'cursor-grab',
                      drag?.moving && drag.event.key === entry.key && 'opacity-40'
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
                          {time.format(Date.parse(entry.event.start))}
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
                  {m.more(more)}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
