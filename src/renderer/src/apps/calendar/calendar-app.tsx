import { useEffect, useMemo, useState, type Ref } from 'react'
import { ChevronLeft, ChevronRight, Flag, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { useCalendarEvents } from '@renderer/features/calendar/use-calendar'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry } from '@shared/calendar'
import type { HostCommandId } from '@shared/commands'
import type { MessageRef } from '@shared/models'
import type { DayLine } from '@shared/segretario'
import { dayLineLink } from '@renderer/features/segretario/day-line-source'
import { useOpenLink } from '@renderer/features/segretario/segretario-text'

import { AgendaList } from './agenda-list'
import {
  addDays,
  CALENDAR_VIEWS,
  eventStartDay,
  sameDay,
  startOfDay,
  startOfWeek,
  stepAnchor,
  viewDays,
  viewTitle,
  type CalendarView
} from '@renderer/features/calendar/calendar-dates'
import { CalendarSearch } from './calendar-search'
import { EventEditor, type EditorTarget } from './event-editor'
import { EventPanel } from './event-panel'
import { dotStyle } from './event-style'
import { MonthGrid } from './month-grid'
import { TimeGrid, type CalendarSelection } from './time-grid'
import { calendarOf, useCalendarList, useSegretarioLayers } from './use-calendar-data'
import { useCalendarKeys } from './use-calendar-keys'

const VIEW_KEY = 'siever-calendar-view'
const LAYERS_KEY = 'siever-calendar-layers'
const MONTH_TITLE = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })

/** What the calendar shows, for the Segretario to know what the user is looking at. */
export interface CalendarSight {
  /** "Calendario, settimana 9 – 15 novembre 2026". */
  label: string
  event: { key: string; title: string } | null
}

const SIGHT_VIEW: Readonly<Record<CalendarView, string>> = {
  giorno: '',
  settimana: 'settimana ',
  mese: '',
  agenda: 'agenda '
}

/** The command that shows each view (Settings › Scorciatoie). */
const VIEW_COMMANDS: Readonly<Record<CalendarView, HostCommandId>> = {
  giorno: 'calendar-view-day',
  settimana: 'calendar-view-week',
  mese: 'calendar-view-month',
  agenda: 'calendar-view-agenda'
}

/** Where the calendar opens, when something asks for a day or an event. */
export interface CalendarFocus {
  day: Date
  eventKey?: string
}

/** A choice of this viewer's, kept in the browser's storage when it can be; the default when not. */
function stored<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(key)
    const value: unknown = raw ? JSON.parse(raw) : null
    return valid(value) ? value : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A choice not kept is chosen again next time: nothing lost.
  }
}

const isView = (value: unknown): value is CalendarView =>
  CALENDAR_VIEWS.some((view) => view.value === value)
const isLayers = (value: unknown): value is { due: boolean; proposals: boolean } =>
  typeof value === 'object' && value !== null && 'due' in value && 'proposals' in value

/** The month at a glance, to move through the calendar by days. */
function MiniMonth({
  anchor,
  days,
  onPick
}: {
  anchor: Date
  /** The days the calendar shows, marked. */
  days: ReadonlyArray<Date>
  onPick: (day: Date) => void
}): React.JSX.Element {
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const [shownFor, setShownFor] = useState(anchor)

  // The calendar moved to another month: the small one follows.
  if (shownFor !== anchor) {
    setShownFor(anchor)

    if (anchor.getMonth() !== month.getMonth() || anchor.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    }
  }

  const first = startOfWeek(month)
  const cells = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  const shownFrom = days[0]?.getTime() ?? 0
  const shownTo = days.length > 0 ? addDays(days[days.length - 1], 1).getTime() : 0
  const today = new Date()

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[12.5px] font-semibold first-letter:uppercase">
          {MONTH_TITLE.format(month)}
        </span>
        <div className="flex">
          <IconButton
            label="Mese prima"
            className="text-faint-foreground size-[24px]"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <IconButton
            label="Mese dopo"
            className="text-faint-foreground size-[24px]"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((weekday, index) => (
          <span key={index} className="text-faint-foreground py-0.5">
            {weekday}
          </span>
        ))}
        {cells.map((day) => {
          const shown = day.getTime() >= shownFrom && day.getTime() < shownTo

          return (
            <button
              key={day.getTime()}
              type="button"
              onClick={() => onPick(day)}
              className={cn(
                'focus-visible:ring-ring/60 mx-auto grid size-6 place-items-center rounded-full tabular-nums outline-none focus-visible:ring-2',
                sameDay(day, today)
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : shown
                    ? 'bg-selected text-foreground'
                    : day.getMonth() === month.getMonth()
                      ? 'text-foreground hover:bg-hover'
                      : 'text-faint-foreground hover:bg-hover'
              )}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The calendars of each connection, each to show or hide. */
function CalendarsList({
  calendars,
  onSetHidden
}: {
  calendars: ReadonlyArray<CalendarListEntry>
  onSetHidden: (key: string, hidden: boolean) => void
}): React.JSX.Element {
  const accounts = [...new Set(calendars.map((calendar) => calendar.connection))]

  return (
    <div className="flex flex-col gap-3">
      {accounts.map((account) => (
        <section key={account} aria-label={account} className="flex flex-col gap-0.5">
          <h3 className="eyebrow truncate px-1 pb-0.5">{account}</h3>
          {calendars
            .filter((calendar) => calendar.connection === account)
            .map((calendar) => (
              <label
                key={calendar.key}
                className="hover:bg-hover flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-1 text-[12.5px]"
              >
                <input
                  type="checkbox"
                  checked={!calendar.hidden}
                  onChange={(event) => onSetHidden(calendar.key, !event.target.checked)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'grid size-3.5 shrink-0 place-items-center rounded-[4px] border-2',
                    calendar.hidden && 'bg-transparent'
                  )}
                  style={{
                    borderColor: dotStyle(calendar.color).backgroundColor,
                    backgroundColor: calendar.hidden
                      ? undefined
                      : dotStyle(calendar.color).backgroundColor
                  }}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    calendar.hidden && 'text-muted-foreground'
                  )}
                >
                  {calendar.name}
                </span>
                {!calendar.writable && (
                  <span className="text-faint-foreground shrink-0 text-[10.5px]">sola lettura</span>
                )}
              </label>
            ))}
        </section>
      ))}
    </div>
  )
}

/**
 * The Calendario app: the calendars of every connection on one axis of
 * time — a day, a week, a month, the agenda — with the Segretario's
 * layers, when it is on: what the mail says is due, and the events it
 * proposes. An event opens beside it; a drag on the grid makes one. The
 * events are searched, past ones too, from the header; and moved through
 * from the keyboard, its keys a letter each (`useCalendarKeys`).
 */
export function CalendarApp({
  aiOn,
  focus,
  onSight,
  atWindowTopRight,
  onOpenMessage,
  onOpenConnections,
  searchInputRef,
  keysEnabled
}: {
  aiOn: boolean
  /** Where the calendar opens: a day, and an event of it to show. Today when not given. */
  focus?: CalendarFocus
  /** Told what the calendar shows, as it changes. */
  onSight: (sight: CalendarSight) => void
  atWindowTopRight: boolean
  onOpenMessage: (ref: MessageRef) => void
  /** No calendar connected: where to connect one. */
  onOpenConnections: () => void
  /** The search field, for the window's "Cerca" command while the calendar is in front. */
  searchInputRef?: Ref<HTMLInputElement>
  /** Whether its keys answer: not while something of the shell is over it, a message being written. */
  keysEnabled: boolean
}): React.JSX.Element {
  const [view, setView] = useState<CalendarView>(() => stored(VIEW_KEY, 'settimana', isView))
  const [layers, setLayers] = useState(() =>
    stored(LAYERS_KEY, { due: true, proposals: true }, isLayers)
  )
  const [anchor, setAnchor] = useState(() => startOfDay(focus?.day ?? new Date()))
  const [selection, setSelection] = useState<CalendarSelection>(() =>
    focus?.eventKey ? { kind: 'event', key: focus.eventKey } : null
  )
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [syncing, setSyncing] = useState(false)
  const { calendars, setHidden } = useCalendarList()
  const days = useMemo(() => viewDays(view, anchor), [view, anchor])
  const from = days[0]
  const to = addDays(days[days.length - 1], 1)
  const allEvents = useCalendarEvents(from.toISOString(), to.toISOString())
  // An event just moved shows where it went until the calendar's own list comes back with it.
  const [moved, setMoved] = useState<{ event: CalendarEvent; over: CalendarEvent[] | null } | null>(
    null
  )
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const events = useMemo(
    () =>
      (allEvents ?? [])
        .map((event) =>
          moved?.over === allEvents && moved.event.key === event.key ? moved.event : event
        )
        .filter((event) => !calendarOf(event, calendars)?.hidden),
    [allEvents, calendars, moved]
  )
  const segretario = useSegretarioLayers(from, to, aiOn && (layers.due || layers.proposals))
  const due = layers.due ? segretario.due : []
  const proposals = layers.proposals ? segretario.proposals : []
  const selectedEvent =
    selection?.kind === 'event'
      ? (events.find((event) => event.key === selection.key) ?? null)
      : null
  const selectedProposal =
    selection?.kind === 'proposal'
      ? (proposals.find((proposed) => proposed.proposal.id === selection.id) ?? null)
      : null

  useEffect(() => store(VIEW_KEY, view), [view])

  const sightLabel = `Calendario, ${SIGHT_VIEW[view]}${viewTitle(view, anchor)}`
  const sightKey = selectedEvent?.key ?? null
  const sightTitle = selectedEvent?.title ?? null

  useEffect(() => {
    onSight({
      label: sightLabel,
      event: sightKey && sightTitle !== null ? { key: sightKey, title: sightTitle } : null
    })
  }, [onSight, sightKey, sightLabel, sightTitle])
  useEffect(() => store(LAYERS_KEY, layers), [layers])

  // A deadline opens where it comes from: its message, or its event.
  const openLink = useOpenLink()
  const openLine = (line: DayLine): void => {
    const link = dayLineLink(line)

    if (link) {
      openLink(link)
    }
  }

  /** An event dragged to another time: whoever is invited is told, once the user says so. */
  const moveEvent = async (event: CalendarEvent, start: number, end: number): Promise<void> => {
    if (
      event.attendees.some((attendee) => !attendee.self) &&
      !(await confirm({
        title: `Spostare «${event.title}»?`,
        description: 'Gli invitati ricevono l’aggiornamento.',
        confirmLabel: 'Sposta'
      }))
    ) {
      return
    }

    const change = { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
    setMoved({ event: { ...event, ...change }, over: allEvents })

    try {
      await window.calendarApi.update(event.key, change)
    } catch (error) {
      setMoved(null)
      toast.error('L’evento non è stato spostato', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }
  const canWrite = Boolean(calendars?.some((calendar) => calendar.writable))
  const newEvent = (): void => {
    const start = new Date()
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0)
    const base = sameDay(anchor, new Date())
      ? start
      : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 9)
    setEditor({
      mode: 'new',
      start: base.getTime(),
      end: base.getTime() + 60 * 60_000,
      allDay: false
    })
  }
  /** An event, on its day, open beside the calendar. */
  const showEvent = (event: CalendarEvent): void => {
    setAnchor(eventStartDay(event))
    setSelection({ kind: 'event', key: event.key })
  }
  const previousKeys = useCommandKeys('calendar-previous')
  const nextKeys = useCommandKeys('calendar-next')

  // Each command does the same whether pressed once or held, but the steps through time,
  // which a held key repeats.
  useCalendarKeys((commandId) => {
    const shownView = CALENDAR_VIEWS.find((option) => VIEW_COMMANDS[option.value] === commandId)

    if (shownView) {
      setView(shownView.value)
      return true
    }

    switch (commandId) {
      case 'calendar-today':
        setAnchor(startOfDay(new Date()))
        return true
      case 'calendar-previous':
      case 'calendar-next':
        setAnchor((current) => stepAnchor(view, current, commandId === 'calendar-next' ? 1 : -1))
        return true
      case 'calendar-new-event':
        if (!canWrite) {
          return false
        }

        newEvent()
        return true
      case 'calendar-close-event':
        if (!selection) {
          return false
        }

        setSelection(null)
        return true
      default:
        return false
    }
  }, keysEnabled)

  return (
    <div className="paper flex h-full min-h-0">
      <aside
        aria-label="Calendari"
        className="flex w-[232px] shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 pt-[var(--titlebar-band)] pb-4"
      >
        <ActionTooltip label="Nuovo evento" commandId="calendar-new-event">
          <Button className="mt-2 w-full" onClick={newEvent} disabled={!canWrite}>
            <Plus className="size-4" />
            Nuovo evento
          </Button>
        </ActionTooltip>
        <MiniMonth anchor={anchor} days={days} onPick={(day) => setAnchor(day)} />
        {calendars && calendars.length > 0 ? (
          <CalendarsList calendars={calendars} onSetHidden={setHidden} />
        ) : (
          calendars && (
            <div className="text-muted-foreground flex flex-col gap-2 px-1 text-[12px]">
              <p>Nessun calendario collegato.</p>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={onOpenConnections}
              >
                Collega un calendario
              </Button>
            </div>
          )
        )}
        {aiOn && (
          <section aria-label="Il Segretario" className="flex flex-col gap-0.5">
            <h3 className="eyebrow px-1 pb-0.5">Il Segretario</h3>
            <label className="hover:bg-hover flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-1 text-[12.5px]">
              <input
                type="checkbox"
                className="accent-[hsl(var(--ai))]"
                checked={layers.due}
                onChange={(event) =>
                  setLayers((current) => ({ ...current, due: event.target.checked }))
                }
              />
              <Flag className="text-ai size-3.5" />
              Scadenze
            </label>
            <label className="hover:bg-hover flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-1 text-[12.5px]">
              <input
                type="checkbox"
                className="accent-[hsl(var(--ai))]"
                checked={layers.proposals}
                onChange={(event) =>
                  setLayers((current) => ({ ...current, proposals: event.target.checked }))
                }
              />
              <CompassStar className="text-ai-star size-3.5" />
              Eventi proposti
            </label>
          </section>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-4',
            atWindowTopRight && !selection ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-3'
          )}
        >
          <ActionTooltip label="Vai a oggi" commandId="calendar-today">
            <Button
              variant="outline"
              size="sm"
              className="window-no-drag"
              onClick={() => setAnchor(startOfDay(new Date()))}
            >
              Oggi
            </Button>
          </ActionTooltip>
          <div className="window-no-drag flex">
            <IconButton
              label="Periodo precedente"
              shortcutKeys={previousKeys}
              className="size-[28px]"
              onClick={() => setAnchor(stepAnchor(view, anchor, -1))}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton
              label="Periodo successivo"
              shortcutKeys={nextKeys}
              className="size-[28px]"
              onClick={() => setAnchor(stepAnchor(view, anchor, 1))}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
          <h1 className="display-title min-w-0 truncate text-[16px] first-letter:uppercase">
            {viewTitle(view, anchor)}
          </h1>
          <div className="flex-1" />
          <CalendarSearch calendars={calendars} inputRef={searchInputRef} onOpen={showEvent} />
          <div
            role="tablist"
            aria-label="Vista"
            className="window-no-drag bg-hover flex rounded-[8px] p-0.5"
          >
            {CALENDAR_VIEWS.map((option) => (
              <ActionTooltip
                key={option.value}
                label={`Vista ${option.label}`}
                commandId={VIEW_COMMANDS[option.value]}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === option.value}
                  onClick={() => setView(option.value)}
                  className={cn(
                    'focus-visible:ring-ring/60 rounded-[6px] px-2.5 py-1 text-[12px] font-medium outline-none focus-visible:ring-2',
                    view === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option.label}
                </button>
              </ActionTooltip>
            ))}
          </div>
          <IconButton
            label="Aggiorna dai calendari"
            className="window-no-drag text-faint-foreground size-[28px]"
            disabled={syncing}
            onClick={() => {
              setSyncing(true)
              void window.calendarApi.syncNow().finally(() => setSyncing(false))
            }}
          >
            {syncing ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {allEvents === null ? (
              <p className="text-muted-foreground flex items-center gap-2 p-6 text-[13px]">
                <LoaderCircle className="size-4 animate-spin" />
                Leggo i calendari…
              </p>
            ) : view === 'mese' ? (
              <MonthGrid
                days={days}
                month={anchor.getMonth()}
                events={events}
                calendars={calendars}
                due={due}
                proposals={proposals}
                selection={selection}
                onSelect={setSelection}
                onOpenDay={(day) => {
                  setAnchor(day)
                  setView('giorno')
                }}
                onDraw={(range) => setEditor({ mode: 'new', ...range })}
                onOpenLine={openLine}
              />
            ) : view === 'agenda' ? (
              <AgendaList
                days={days}
                events={events}
                calendars={calendars}
                due={due}
                proposals={proposals}
                selection={selection}
                onSelect={setSelection}
                onOpenLine={openLine}
              />
            ) : (
              <TimeGrid
                days={days}
                events={events}
                calendars={calendars}
                due={due}
                proposals={proposals}
                selection={selection}
                onSelect={setSelection}
                onDraw={(range) => setEditor({ mode: 'new', ...range })}
                onMove={(event, start, end) => void moveEvent(event, start, end)}
                onOpenLine={openLine}
              />
            )}
          </div>

          {(selectedEvent || selectedProposal) && (
            <EventPanel
              key={selectedEvent?.key ?? selectedProposal?.proposal.id}
              event={selectedEvent}
              proposed={selectedProposal}
              calendar={selectedEvent ? calendarOf(selectedEvent, calendars) : undefined}
              aiOn={aiOn}
              onEdit={(event) => setEditor({ mode: 'edit', event })}
              onClose={() => setSelection(null)}
              onOpenMessage={onOpenMessage}
            />
          )}
        </div>
      </div>

      {editor && calendars && (
        <EventEditor
          target={editor}
          calendars={calendars}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null)
            showEvent(saved)
          }}
        />
      )}
      {confirmDialog}
    </div>
  )
}
