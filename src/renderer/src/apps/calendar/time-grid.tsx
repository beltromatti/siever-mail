import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { hourStyle, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { DayLine } from '@shared/segretario'
import {
  DayLineSourceIcon,
  dayLineKey,
  dayLineSourceWords
} from '@renderer/features/segretario/day-line-source'

import {
  addDays,
  dateFormat,
  dayKey,
  eventSpan,
  inTopBand,
  isOnDay,
  layoutDay,
  minutesInto,
  sameDay,
  shiftSpan
} from '@renderer/features/calendar/calendar-dates'
import { eventTint } from './event-style'
import { calendarOf, type ProposedEvent } from './use-calendar-data'

/** One hour's height on the grid. */
const HOUR_PX = 52
/** What a click or a drag on the grid snaps to. */
const SLOT_MINUTES = 15
/** How far the pointer goes on an event before a press becomes a move. */
const DRAG_THRESHOLD_PX = 4
/** The hour the grid opens on, when now is not on it. */
const FIRST_HOUR_SHOWN = 7
/** Entries a day shows in the band on top before it says how many more there are. */
const BAND_SHOWN = 3
/**
 * The header, the band and the hours line up only if they leave the same
 * room on the right: the scrollbar's, kept by the hours and reserved by the others.
 */
const SAME_GUTTER = 'overflow-y-hidden [scrollbar-gutter:stable]'

const MESSAGES = defineMessages({
  allDay: { en: 'all day', it: 'tutto il giorno', de: 'ganztägig' },
  showLess: { en: 'Show less', it: 'Mostra meno', de: 'Weniger anzeigen' },
  showAll: { en: 'Show all', it: 'Mostra tutto', de: 'Alle anzeigen' },
  more: {
    en: (count: number) => (count === 1 ? 'one more' : `${count} more`),
    it: (count: number) => (count === 1 ? 'un altro' : `altri ${count}`),
    de: (count: number) => (count === 1 ? 'ein weiterer' : `${count} weitere`)
  }
})

const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' }
/** Made when used: the hour is written as the region writes it now. */
const TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

/** An hour on the grid's edge, as the region's clock says it: "09:00", or "9 AM". */
function hourLabel(hour: number): string {
  const { hourCycle } = dateFormat({ hour: 'numeric' }).resolvedOptions()
  const twelveHour = hourCycle === 'h11' || hourCycle === 'h12'
  return dateFormat(twelveHour ? { hour: 'numeric' } : TIME()).format(new Date(2000, 0, 1, hour))
}

/** What is selected on the calendar: an event, or a proposal of one. */
export type CalendarSelection =
  { kind: 'event'; key: string } | { kind: 'proposal'; id: string } | null

/** A range the user drew on the grid, to make an event of. */
export interface DrawnRange {
  start: number
  end: number
  allDay: boolean
}

interface Placed {
  id: string
  /** The event itself when the user may move it on the grid; null for a proposal, an invitation. */
  movable: CalendarEvent | null
  start: number
  end: number
  title: string
  color: string | null
  proposed: boolean
  select: CalendarSelection
  declined: boolean
}

/** A deadline the Segretario found — in the mail, an event, the user's word — on its day. */
function DueChip({
  line,
  onOpen
}: {
  line: DayLine
  onOpen: (line: DayLine) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(line)}
      title={`${line.text} — ${dayLineSourceWords(line)}`}
      className="text-ai bg-ai-soft/60 hover:bg-ai-soft focus-visible:ring-ring/60 flex w-full min-w-0 shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-left text-[11px] font-medium outline-none focus-visible:ring-2"
    >
      <DayLineSourceIcon line={line} className="size-3 shrink-0" />
      <span className="truncate">{line.text}</span>
    </button>
  )
}

/** An event being moved on the grid: where it was taken, and where it is now. */
interface Move {
  item: Placed
  /** The column it was taken in, and where the pointer was. */
  dayIndex: number
  x: number
  y: number
  /** Whether the pointer went far enough for this to be a move, not a click. */
  moving: boolean
  start: number
  end: number
}

/**
 * The days of a week — or one — hour by hour: the events where they fall,
 * side by side where they overlap; all-day ones, deadlines and proposals
 * in the band on top; now as a line. A click or a drag on the free grid
 * draws a new event; an event the user organises, in a calendar that can
 * be written, is moved by dragging it.
 */
export function TimeGrid({
  days,
  events,
  calendars,
  due,
  proposals,
  selection,
  newEventMinutes,
  onSelect,
  onDraw,
  onMove,
  onOpenLine
}: {
  days: ReadonlyArray<Date>
  events: ReadonlyArray<CalendarEvent>
  calendars: ReadonlyArray<CalendarListEntry> | null
  due: ReadonlyArray<DayLine>
  proposals: ReadonlyArray<ProposedEvent>
  selection: CalendarSelection
  /** How long a new event made with a click lasts. */
  newEventMinutes: number
  onSelect: (selection: CalendarSelection) => void
  onDraw: (range: DrawnRange) => void
  /** An event dragged elsewhere: its new start and end. */
  onMove: (event: CalendarEvent, start: number, end: number) => void
  onOpenLine: (line: DayLine) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const time = dateFormat(TIME())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [move, setMove] = useState<Move | null>(null)
  // A press that moved an event is not also a click on it.
  const movedRef = useRef(false)
  const [now, setNow] = useState(() => Date.now())
  const [drawing, setDrawing] = useState<{ day: Date; from: number; to: number } | null>(null)
  // The band shows a few entries a day; opened, all of them, scrolling past a height.
  const [bandOpen, setBandOpen] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Opens on now, when it is on the grid, or on the start of the working day — when the days change.
  const firstDay = dayKey(days[0])
  const showsToday = days.some((day) => sameDay(day, new Date()))

  useLayoutEffect(() => {
    const hour = showsToday ? Math.max(0, new Date().getHours() - 1) : FIRST_HOUR_SHOWN
    // A little above the hour, so its label is not cut.
    scrollRef.current?.scrollTo({ top: Math.max(0, hour * HOUR_PX - 8) })
  }, [firstDay, showsToday])

  const placed = useMemo((): Placed[] => {
    const own: Placed[] = events
      .filter((event) => !inTopBand(event))
      .map((event) => ({
        id: event.key,
        // Moved only by who organises it, in a calendar written in: an invitation is answered.
        movable:
          calendarOf(event, calendars)?.writable && event.organizedByUser === true ? event : null,
        ...eventSpan(event),
        title: event.title,
        color: calendarOf(event, calendars)?.color ?? null,
        proposed: false,
        select: { kind: 'event', key: event.key } as const,
        declined: event.myResponse === 'declined'
      }))
    const suggested: Placed[] = proposals
      .filter((proposed) => !inTopBand(proposed))
      .map((proposed) => ({
        id: proposed.proposal.id,
        movable: null,
        ...eventSpan(proposed),
        title: proposed.title,
        color: null,
        proposed: true,
        select: { kind: 'proposal', id: proposed.proposal.id } as const,
        declined: false
      }))

    return [...own, ...suggested]
  }, [calendars, events, proposals])

  /** The minute of a day a pointer is at in its column, snapped to a slot. */
  const minuteAt = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    const minutes = ((event.clientY - rect.top) / HOUR_PX) * 60
    return Math.min(24 * 60, Math.max(0, Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES))
  }

  /** The column of the day the pointer is over, by where it is across the grid. */
  const dayIndexAt = (clientX: number): number => {
    const rect = gridRef.current?.getBoundingClientRect()

    if (!rect) {
      return 0
    }

    const column = (rect.width - 56) / days.length
    return Math.min(days.length - 1, Math.max(0, Math.floor((clientX - rect.left - 56) / column)))
  }

  const dragMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!move) {
      return
    }

    const dx = event.clientX - move.x
    const dy = event.clientY - move.y

    if (!move.moving && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return
    }

    const minutes = Math.round(((dy / HOUR_PX) * 60) / SLOT_MINUTES) * SLOT_MINUTES
    const shifted = shiftSpan(move.item, dayIndexAt(event.clientX) - move.dayIndex, minutes)
    setMove({ ...move, moving: true, ...shifted })
  }

  const dragEnd = (): void => {
    if (!move) {
      return
    }

    movedRef.current = move.moving
    setMove(null)

    if (move.moving && move.item.movable && move.start !== move.item.start) {
      onMove(move.item.movable, move.start, move.end)
    }
  }

  const finishDrawing = (): void => {
    if (!drawing) {
      return
    }

    const from = Math.min(drawing.from, drawing.to)
    const to = Math.max(drawing.from, drawing.to)
    // A click is a new event's length from the half hour it fell in; a drag, what was drawn.
    const start = to - from < SLOT_MINUTES ? Math.floor(from / 30) * 30 : from
    const end = to - from < SLOT_MINUTES ? Math.min(24 * 60, start + newEventMinutes) : to

    setDrawing(null)
    onDraw({
      start: drawing.day.getTime() + start * 60_000,
      end: drawing.day.getTime() + end * 60_000,
      allDay: false
    })
  }

  const selectedId =
    selection?.kind === 'event'
      ? selection.key
      : selection?.kind === 'proposal'
        ? selection.id
        : null

  // The event chosen — from a link, just saved — is scrolled into sight once, when it is out of it.
  const revealedRef = useRef<string | null>(null)

  useEffect(() => {
    const scroller = scrollRef.current
    const element =
      selectedId && revealedRef.current !== selectedId
        ? scroller?.querySelector<HTMLElement>(`[data-item="${CSS.escape(selectedId)}"]`)
        : null

    if (!scroller || !element) {
      return
    }

    revealedRef.current = selectedId
    const top = element.offsetTop
    const bottom = top + element.offsetHeight

    if (top < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTo({ top: Math.max(0, top - HOUR_PX), behavior: 'smooth' })
    }
  }, [placed, selectedId])

  const columns = `56px repeat(${days.length}, minmax(0, 1fr))`
  // Each day's entries in the band: its all-day events, the proposals, then the deadlines.
  const band = days.map((day) => ({
    day,
    entries: [
      ...events
        .filter((event) => inTopBand(event) && isOnDay(event, day))
        .map((event) => (
          <button
            key={event.key}
            type="button"
            onClick={() => onSelect({ kind: 'event', key: event.key })}
            style={eventTint(calendarOf(event, calendars)?.color ?? null)}
            className={cn(
              'focus-visible:ring-ring/60 w-full min-w-0 shrink-0 truncate rounded-[4px] border-l-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium outline-none focus-visible:ring-2',
              event.key === selectedId && 'ring-ring ring-2',
              event.myResponse === 'declined' && 'line-through opacity-60'
            )}
          >
            {event.title}
          </button>
        )),
      ...proposals
        .filter((proposed) => inTopBand(proposed) && isOnDay(proposed, day))
        .map((proposed) => (
          <button
            key={proposed.proposal.id}
            type="button"
            onClick={() => onSelect({ kind: 'proposal', id: proposed.proposal.id })}
            style={eventTint(null, true)}
            className={cn(
              'text-muted-foreground focus-visible:ring-ring/60 flex w-full min-w-0 shrink-0 items-center gap-1 rounded-[4px] border-l-[3px] px-1.5 py-0.5 text-left text-[11px] italic outline-none focus-visible:ring-2',
              proposed.proposal.id === selectedId && 'ring-ring ring-2'
            )}
          >
            <CompassStar className="text-ai-star size-3" />
            <span className="truncate">{proposed.title}</span>
          </button>
        )),
      ...due
        .filter((line) => line.due === dayKey(day))
        .map((line) => <DueChip key={dayLineKey(line)} line={line} onOpen={onOpenLine} />)
    ]
  }))
  const bandOverflows = band.some(({ entries }) => entries.length > BAND_SHOWN)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn('grid shrink-0 border-b', SAME_GUTTER)}
        style={{ gridTemplateColumns: columns }}
      >
        <div />
        {days.map((day) => {
          const today = sameDay(day, new Date(now))

          return (
            <div
              key={dayKey(day)}
              className="flex items-baseline justify-center gap-1.5 border-l py-2 text-[12px]"
            >
              <span className="text-muted-foreground uppercase">
                {dateFormat(WEEKDAY).format(day)}
              </span>
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-full text-[13px] font-semibold tabular-nums',
                  today && 'bg-primary text-primary-foreground'
                )}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* The band on top: all day, across midnight, deadlines, proposals for the day. */}
      <div
        className={cn(
          'grid shrink-0 border-b',
          bandOpen ? 'max-h-[40vh] [scrollbar-gutter:stable] overflow-y-auto' : SAME_GUTTER
        )}
        style={{ gridTemplateColumns: columns }}
      >
        <div className="text-faint-foreground flex flex-col items-end gap-1 px-2 py-1.5 text-right text-[10.5px]">
          {m.allDay}
          {bandOverflows && (
            <button
              type="button"
              aria-label={bandOpen ? m.showLess : m.showAll}
              aria-expanded={bandOpen}
              onClick={() => setBandOpen((open) => !open)}
              className="hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 grid size-5 place-items-center rounded-[4px] outline-none focus-visible:ring-2"
            >
              {bandOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          )}
        </div>
        {band.map(({ day, entries }) => (
          <div
            key={dayKey(day)}
            className="flex min-h-[30px] min-w-0 flex-col gap-0.5 border-l p-1"
            onDoubleClick={(event) => {
              if (event.target === event.currentTarget) {
                onDraw({ start: day.getTime(), end: addDays(day, 1).getTime(), allDay: true })
              }
            }}
          >
            {bandOpen ? entries : entries.slice(0, BAND_SHOWN)}
            {!bandOpen && entries.length > BAND_SHOWN && (
              <button
                type="button"
                onClick={() => setBandOpen(true)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 self-start rounded-sm px-1.5 text-[11px] outline-none focus-visible:ring-2"
              >
                {m.more(entries.length - BAND_SHOWN)}
              </button>
            )}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">
        <div
          ref={gridRef}
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}
        >
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="text-faint-foreground absolute right-2 -translate-y-1/2 text-[10.5px] tabular-nums"
                style={{ top: hour * HOUR_PX }}
              >
                {hour === 0 ? '' : hourLabel(hour)}
              </span>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const ofDay = placed.filter(
              (item) => item.start < addDays(day, 1).getTime() && item.end > day.getTime()
            )
            const laid = layoutDay(ofDay)
            const nowOnDay = sameDay(day, new Date(now))
            const ghost = drawing && sameDay(drawing.day, day) ? drawing : null
            const movedHere =
              move?.moving && move.start < addDays(day, 1).getTime() && move.end > day.getTime()
                ? move
                : null

            return (
              <div
                key={dayKey(day)}
                className="relative border-l"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, hsl(var(--border)) ${HOUR_PX - 1}px, hsl(var(--border)) ${HOUR_PX}px)`
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || event.target !== event.currentTarget) {
                    return
                  }

                  event.currentTarget.setPointerCapture(event.pointerId)
                  const minute = minuteAt(event)
                  setDrawing({ day, from: minute, to: minute })
                }}
                onPointerMove={(event) => {
                  if (drawing && sameDay(drawing.day, day)) {
                    const minute = minuteAt(event)
                    setDrawing((current) => (current ? { ...current, to: minute } : current))
                  }
                }}
                onPointerUp={finishDrawing}
              >
                {laid.map(({ item, column, columns: count }) => {
                  const top = (minutesInto(day, item.start) / 60) * HOUR_PX
                  const bottom = (minutesInto(day, item.end) / 60) * HOUR_PX
                  const height = Math.max(20, bottom - top - 2)

                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-item={item.id}
                      onClick={() => {
                        if (movedRef.current) {
                          movedRef.current = false
                          return
                        }

                        onSelect(item.select)
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || !item.movable) {
                          return
                        }

                        event.currentTarget.setPointerCapture(event.pointerId)
                        movedRef.current = false
                        setMove({
                          item,
                          dayIndex,
                          x: event.clientX,
                          y: event.clientY,
                          moving: false,
                          start: item.start,
                          end: item.end
                        })
                      }}
                      onPointerMove={dragMove}
                      onPointerUp={dragEnd}
                      onPointerCancel={() => setMove(null)}
                      style={{
                        ...eventTint(item.color, item.proposed),
                        top,
                        height,
                        left: `calc(${(column / count) * 100}% + 2px)`,
                        width: `calc(${100 / count}% - 4px)`
                      }}
                      className={cn(
                        'focus-visible:ring-ring/60 absolute flex flex-col overflow-hidden rounded-[5px] border-l-[3px] px-1.5 py-0.5 text-left text-[11.5px] leading-tight outline-none focus-visible:ring-2',
                        item.proposed && 'text-muted-foreground italic',
                        item.declined && 'line-through opacity-60',
                        item.id === selectedId && 'ring-ring z-10 ring-2',
                        item.movable && 'cursor-grab active:cursor-grabbing',
                        move?.moving && move.item.id === item.id && 'opacity-40'
                      )}
                    >
                      {item.proposed ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <CompassStar className="text-ai-star size-3" />
                          <span className="truncate font-semibold">{item.title}</span>
                        </span>
                      ) : (
                        <span className="truncate font-semibold">{item.title}</span>
                      )}
                      {height > 30 && (
                        <span className="text-muted-foreground truncate text-[10.5px] tabular-nums">
                          {time.format(item.start)}–{time.format(item.end)}
                        </span>
                      )}
                    </button>
                  )
                })}

                {ghost && (
                  <div
                    className="bg-primary/15 border-primary pointer-events-none absolute inset-x-1 rounded-[5px] border"
                    style={{
                      top: (Math.min(ghost.from, ghost.to) / 60) * HOUR_PX,
                      height: Math.max(
                        HOUR_PX / 4,
                        (Math.abs(ghost.to - ghost.from) / 60) * HOUR_PX
                      )
                    }}
                  />
                )}

                {movedHere && (
                  <div
                    style={{
                      ...eventTint(movedHere.item.color),
                      top: (minutesInto(day, movedHere.start) / 60) * HOUR_PX,
                      height: Math.max(
                        20,
                        ((minutesInto(day, movedHere.end) - minutesInto(day, movedHere.start)) /
                          60) *
                          HOUR_PX -
                          2
                      )
                    }}
                    className="ring-ring pointer-events-none absolute inset-x-[2px] z-30 flex flex-col overflow-hidden rounded-[5px] border-l-[3px] px-1.5 py-0.5 text-[11.5px] leading-tight shadow-md ring-2"
                  >
                    <span className="truncate font-semibold">{movedHere.item.title}</span>
                    <span className="text-muted-foreground truncate text-[10.5px] tabular-nums">
                      {time.format(movedHere.start)}–{time.format(movedHere.end)}
                    </span>
                  </div>
                )}

                {nowOnDay && (
                  <div
                    className="bg-urgent pointer-events-none absolute inset-x-0 z-20 h-[2px]"
                    style={{ top: (minutesInto(day, now) / 60) * HOUR_PX }}
                  >
                    <span className="bg-urgent absolute -top-[3px] -left-[4px] size-2 rounded-full" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
