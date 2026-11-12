import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Plus, RefreshCw } from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { useCalendarEvents } from '@renderer/features/calendar/use-calendar'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { uiLog } from '@renderer/lib/diagnostics'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry } from '@shared/calendar'
import type { HostCommandId } from '@shared/commands'
import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'
import { PLACES } from '@shared/places'
import type { Commitment, DayLine } from '@shared/segretario'
import { DayLineSourceIcons, dayLineLink } from '@renderer/features/segretario/day-line-source'
import { useOpenLink } from '@renderer/features/segretario/segretario-text'

import { AgendaList } from './agenda-list'
import {
  addDays,
  CALENDAR_VIEW_NAMES,
  CALENDAR_VIEWS,
  dateFormat,
  dayKey,
  dayOfKey,
  eventStartDay,
  sameDay,
  shiftSpan,
  startOfDay,
  startOfWeek,
  stepAnchor,
  viewDays,
  viewTitle,
  weekdayNames,
  type CalendarView
} from '@renderer/features/calendar/calendar-dates'
import { canEditEvent } from './calendar-menus'
import { CalendarSearch } from './calendar-search'
import { EventEditor, type EditorTarget } from './event-editor'
import { EventPanel } from './event-panel'
import { dotStyle } from './event-style'
import { MonthGrid } from './month-grid'
import { TimeGrid, type CalendarSelection } from './time-grid'
import { useCalendarActions, type CalendarMailRequest } from './use-calendar-actions'
import {
  calendarOf,
  useCalendarList,
  useSegretarioLayers,
  type ProposedEvent
} from './use-calendar-data'
import { useCalendarKeys } from './use-calendar-keys'

const MESSAGES = defineMessages({
  sight: {
    en: (calendar: string, view: CalendarView, title: string) =>
      `${calendar}, ${view === 'settimana' ? 'week ' : view === 'agenda' ? 'agenda ' : ''}${title}`,
    it: (calendar: string, view: CalendarView, title: string) =>
      `${calendar}, ${view === 'settimana' ? 'settimana ' : view === 'agenda' ? 'agenda ' : ''}${title}`,
    de: (calendar: string, view: CalendarView, title: string) =>
      `${calendar}, ${view === 'settimana' ? 'Woche ' : view === 'agenda' ? 'Agenda ' : ''}${title}`
  },
  previousMonth: { en: 'Previous month', it: 'Mese prima', de: 'Vorheriger Monat' },
  nextMonth: { en: 'Next month', it: 'Mese dopo', de: 'Nächster Monat' },
  readOnly: { en: 'read-only', it: 'sola lettura', de: 'schreibgeschützt' },
  calendars: { en: 'Calendars', it: 'Calendari', de: 'Kalender' },
  newEvent: { en: 'New event', it: 'Nuovo evento', de: 'Neuer Termin' },
  noCalendar: {
    en: 'No calendar connected.',
    it: 'Nessun calendario collegato.',
    de: 'Kein Kalender verbunden.'
  },
  connectCalendar: {
    en: 'Connect a calendar',
    it: 'Collega un calendario',
    de: 'Kalender verbinden'
  },
  segretario: { en: 'Segretario', it: 'Il Segretario', de: 'Segretario' },
  deadlines: { en: 'Deadlines', it: 'Scadenze', de: 'Fristen' },
  proposedEvents: {
    en: 'Proposed events',
    it: 'Eventi proposti',
    de: 'Vorgeschlagene Termine'
  },
  goToToday: { en: 'Go to today', it: 'Vai a oggi', de: 'Zu heute' },
  today: { en: 'Today', it: 'Oggi', de: 'Heute' },
  previousPeriod: {
    en: 'Previous period',
    it: 'Periodo precedente',
    de: 'Vorheriger Zeitraum'
  },
  nextPeriod: { en: 'Next period', it: 'Periodo successivo', de: 'Nächster Zeitraum' },
  view: { en: 'View', it: 'Vista', de: 'Ansicht' },
  syncNow: {
    en: 'Refresh from the calendars',
    it: 'Aggiorna dai calendari',
    de: 'Aus den Kalendern aktualisieren'
  },
  reading: {
    en: 'Reading the calendars…',
    it: 'Leggo i calendari…',
    de: 'Die Kalender werden gelesen…'
  }
})

/** Each view's switch, as its tooltip names it (and Settings › Scorciatoie its command). */
const VIEW_TOOLTIPS = defineMessages({
  agenda: { en: 'Agenda view', it: 'Vista Agenda', de: 'Agenda-Ansicht' },
  day: { en: 'Day view', it: 'Vista Giorno', de: 'Tagesansicht' },
  week: { en: 'Week view', it: 'Vista Settimana', de: 'Wochenansicht' },
  month: { en: 'Month view', it: 'Vista Mese', de: 'Monatsansicht' }
}) satisfies Record<keyof typeof CALENDAR_VIEW_NAMES, unknown>

const VIEW_KEY = 'siever-calendar-view'
const LAYERS_KEY = 'siever-calendar-layers'
const MONTH_TITLE: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }

/** What the calendar shows, for the Segretario to know what the user is looking at. */
export interface CalendarSight {
  /** "Calendar, week 9–15 November 2026", as the user reads it. */
  label: string
  event: { key: string; title: string } | null
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
  onPick,
  onDayMenu
}: {
  anchor: Date
  /** The days the calendar shows, marked. */
  days: ReadonlyArray<Date>
  onPick: (day: Date) => void
  onDayMenu: (day: Date) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
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
          {dateFormat(MONTH_TITLE).format(month)}
        </span>
        <div className="flex">
          <IconButton
            label={m.previousMonth}
            className="text-faint-foreground size-[24px]"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <IconButton
            label={m.nextMonth}
            className="text-faint-foreground size-[24px]"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {weekdayNames('narrow').map((weekday, index) => (
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
              onContextMenu={(event) => {
                event.preventDefault()
                onDayMenu(day)
              }}
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

/** The calendars of each connection, each to show or hide, and its right-click menu. */
function CalendarsList({
  calendars,
  onSetHidden,
  onMenu
}: {
  calendars: ReadonlyArray<CalendarListEntry>
  onSetHidden: (key: string, hidden: boolean) => void
  onMenu: (calendar: CalendarListEntry) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
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
                onContextMenu={(event) => {
                  event.preventDefault()
                  onMenu(calendar)
                }}
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
                  <span className="text-faint-foreground shrink-0 text-[10.5px]">{m.readOnly}</span>
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
 * from the keyboard, its keys a letter each (`useCalendarKeys`). Every
 * thing on it has its right-click menu, as the Posta's (vision §7.3).
 */
export function CalendarApp({
  aiOn,
  newEventDefaults,
  focus,
  onSight,
  atWindowTopRight,
  onOpenMessage,
  onOpenConnections,
  onOpenConnectionSettings,
  onWriteTo,
  onAskSegretario,
  onRemind,
  searchInputRef,
  keysEnabled
}: {
  aiOn: boolean
  /** Where a new event goes and how long it lasts, as the user chose (Impostazioni › Preferenze). */
  newEventDefaults: { calendarKey: string | null; minutes: number }
  /** Where the calendar opens: a day, and an event of it to show. Today when not given. */
  focus?: CalendarFocus
  /** Told what the calendar shows, as it changes. */
  onSight: (sight: CalendarSight) => void
  atWindowTopRight: boolean
  onOpenMessage: (ref: MessageRef) => void
  /** No calendar connected: where to connect one. */
  onOpenConnections: () => void
  /** Impostazioni › Connessioni, where the calendars' connections stand. */
  onOpenConnectionSettings: () => void
  /** A message to an event's guests, in the Posta; absent with no mailbox. */
  onWriteTo?: (request: CalendarMailRequest) => void
  /** The Segretario's panel, opened on what the calendar shows; absent with the AI off. */
  onAskSegretario?: () => void
  /** Asks the Segretario for a reminder to who is awaited, from a deadline's menu. */
  onRemind?: (commitment: Commitment) => void
  /** The search field, for the window's "Cerca" command while the calendar is in front. */
  searchInputRef?: Ref<HTMLInputElement>
  /** Whether its keys answer: not while something of the shell is over it, a message being written. */
  keysEnabled: boolean
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const viewNames = useMessages(CALENDAR_VIEW_NAMES)
  const viewTooltips = useMessages(VIEW_TOOLTIPS)
  const places = useMessages(PLACES)
  const [view, setView] = useState<CalendarView>(() => stored(VIEW_KEY, 'agenda', isView))
  const [layers, setLayers] = useState(() =>
    stored(LAYERS_KEY, { due: true, proposals: true }, isLayers)
  )
  const [anchor, setAnchor] = useState(() => startOfDay(focus?.day ?? new Date()))
  const [selection, setSelection] = useState<CalendarSelection>(() =>
    focus?.eventKey ? { kind: 'event', key: focus.eventKey } : null
  )
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [syncing, setSyncing] = useState(false)
  const { calendars, setHidden, setRole } = useCalendarList()
  // Drawn anew each time, not kept: a week starts where the language's region says (§13.5).
  const days = viewDays(view, anchor)
  const from = days[0]
  const to = addDays(days[days.length - 1], 1)
  const allEvents = useCalendarEvents(from.toISOString(), to.toISOString())
  // An event just moved shows where it went until the calendar's own list comes back with it.
  const [moved, setMoved] = useState<{ event: CalendarEvent; over: CalendarEvent[] | null } | null>(
    null
  )
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

  // The view the user moves to (§14.4); the one it opens on is kept, not told again.
  const viewToldRef = useRef(view)
  useEffect(() => {
    store(VIEW_KEY, view)

    if (viewToldRef.current !== view) {
      viewToldRef.current = view
      uiLog.info('calendar.view', { view })
    }
  }, [view])

  const sightLabel = m.sight(places.calendar, view, viewTitle(view, anchor))
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

  const canWrite = Boolean(calendars?.some((calendar) => calendar.writable))
  /** A new event on the day in sight — today from the next half hour — in a calendar, or the usual one. */
  const newEvent = (calendarKey?: string): void => {
    const start = new Date()
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0)
    const base = sameDay(anchor, new Date())
      ? start
      : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 9)
    setEditor({
      mode: 'new',
      start: base.getTime(),
      end: base.getTime() + newEventDefaults.minutes * 60_000,
      allDay: false,
      calendarKey
    })
  }
  /** An event, on its day, open beside the calendar. */
  const showEvent = (event: CalendarEvent): void => {
    setAnchor(eventStartDay(event))
    setSelection({ kind: 'event', key: event.key })
  }
  const actions = useCalendarActions({
    calendars,
    aiOn,
    show: showEvent,
    showProposal: (proposed) => {
      setAnchor(eventStartDay(proposed))
      setSelection({ kind: 'proposal', id: proposed.proposal.id })
    },
    openEditor: setEditor,
    replaced: (key, now) =>
      setSelection((current) =>
        current?.kind === 'event' && current.key === key
          ? now
            ? { kind: 'event', key: now.key }
            : null
          : current
      ),
    showMoved: (event) => setMoved(event ? { event, over: allEvents } : null),
    setHidden,
    setRole,
    goToDay: (day) => {
      setAnchor(startOfDay(day))
      setView('giorno')
    },
    newEventMinutes: newEventDefaults.minutes,
    newEventIn: newEvent,
    openLine,
    openMessage: onOpenMessage,
    openConnections: onOpenConnectionSettings,
    writeTo: onWriteTo,
    askSegretario: onAskSegretario
      ? (event) => {
          showEvent(event)
          onAskSegretario()
        }
      : undefined,
    remind: onRemind
  })
  /** An event dragged to another day of the month: its days, or its hours on the new day. */
  const moveDays = (event: CalendarEvent, shift: number): void => {
    if (event.allDay) {
      void actions.reschedule(event, {
        start: dayKey(addDays(dayOfKey(event.start.slice(0, 10)), shift)),
        end: dayKey(addDays(dayOfKey(event.end.slice(0, 10)), shift))
      })
      return
    }

    const span = shiftSpan({ start: Date.parse(event.start), end: Date.parse(event.end) }, shift, 0)
    void actions.reschedule(event, {
      start: new Date(span.start).toISOString(),
      end: new Date(span.end).toISOString()
    })
  }
  /** What each thing of the grids does on a right click. */
  const menus = {
    onEventMenu: (event: CalendarEvent) => void actions.eventMenu(event),
    onProposalMenu: (proposed: ProposedEvent) => void actions.proposalMenu(proposed),
    onDueMenu: (line: DayLine) => void actions.dueMenu(line),
    onDayMenu: (day: Date) => void actions.dayMenu(day)
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
      case 'calendar-edit-event':
        if (!selectedEvent || !canEditEvent(selectedEvent, calendars)) {
          return false
        }

        actions.edit(selectedEvent)
        return true
      case 'calendar-duplicate-event':
        if (!selectedEvent || !canWrite) {
          return false
        }

        actions.duplicate(selectedEvent)
        return true
      case 'calendar-delete-event':
        if (!selectedEvent || !canEditEvent(selectedEvent, calendars)) {
          return false
        }

        void actions.remove(selectedEvent)
        return true
      default:
        return false
    }
  }, keysEnabled && !actions.asking)

  return (
    <div className="paper flex h-full min-h-0">
      <aside
        aria-label={m.calendars}
        className="flex w-[232px] shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 pt-[var(--titlebar-band)] pb-4"
      >
        <ActionTooltip label={m.newEvent} commandId="calendar-new-event">
          <Button className="mt-2 w-full" onClick={() => newEvent()} disabled={!canWrite}>
            <Plus className="size-4" />
            {m.newEvent}
          </Button>
        </ActionTooltip>
        <MiniMonth
          anchor={anchor}
          days={days}
          onPick={(day) => setAnchor(day)}
          onDayMenu={(day) => void actions.dayMenu(day)}
        />
        {calendars && calendars.length > 0 ? (
          <CalendarsList
            calendars={calendars}
            onSetHidden={setHidden}
            onMenu={(calendar) => void actions.calendarMenu(calendar)}
          />
        ) : (
          calendars && (
            <div className="text-muted-foreground flex flex-col gap-2 px-1 text-[12px]">
              <p>{m.noCalendar}</p>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={onOpenConnections}
              >
                {m.connectCalendar}
              </Button>
            </div>
          )
        )}
        {aiOn && (
          <section aria-label={m.segretario} className="flex flex-col gap-0.5">
            <h3 className="eyebrow px-1 pb-0.5">{m.segretario}</h3>
            <label className="hover:bg-hover flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-1 text-[12.5px]">
              <input
                type="checkbox"
                className="accent-[hsl(var(--ai))]"
                checked={layers.due}
                onChange={(event) =>
                  setLayers((current) => ({ ...current, due: event.target.checked }))
                }
              />
              <DayLineSourceIcons className="text-ai size-3.5" />
              {m.deadlines}
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
              {m.proposedEvents}
            </label>
          </section>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-4',
            atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-3'
          )}
        >
          <ActionTooltip label={m.goToToday} commandId="calendar-today">
            <Button
              variant="outline"
              size="sm"
              className="window-no-drag"
              onClick={() => setAnchor(startOfDay(new Date()))}
            >
              {m.today}
            </Button>
          </ActionTooltip>
          <div className="window-no-drag flex">
            <IconButton
              label={m.previousPeriod}
              shortcutKeys={previousKeys}
              className="size-[28px]"
              onClick={() => setAnchor(stepAnchor(view, anchor, -1))}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton
              label={m.nextPeriod}
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
          <CalendarSearch
            calendars={calendars}
            inputRef={searchInputRef}
            onOpen={showEvent}
            onEventMenu={menus.onEventMenu}
          />
          <div
            role="tablist"
            aria-label={m.view}
            className="window-no-drag bg-hover flex rounded-[8px] p-0.5"
          >
            {CALENDAR_VIEWS.map((option) => (
              <ActionTooltip
                key={option.value}
                label={viewTooltips[option.name]}
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
                  {viewNames[option.name]}
                </button>
              </ActionTooltip>
            ))}
          </div>
          <IconButton
            label={m.syncNow}
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
                {m.reading}
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
                onMoveDays={moveDays}
                onOpenLine={openLine}
                {...menus}
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
                {...menus}
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
                newEventMinutes={newEventDefaults.minutes}
                onDraw={(range) => setEditor({ mode: 'new', ...range })}
                onMove={(event, start, end) =>
                  void actions.reschedule(event, {
                    start: new Date(start).toISOString(),
                    end: new Date(end).toISOString()
                  })
                }
                onOpenLine={openLine}
                onSlotMenu={(day, minute) => void actions.slotMenu(day, minute)}
                {...menus}
              />
            )}
          </div>

          {(selectedEvent || selectedProposal) && (
            <EventPanel
              key={selectedEvent?.key ?? selectedProposal?.proposal.id}
              event={selectedEvent}
              proposed={selectedProposal}
              calendar={selectedEvent ? calendarOf(selectedEvent, calendars) : undefined}
              calendars={calendars}
              aiOn={aiOn}
              canWriteMail={onWriteTo !== undefined}
              actions={actions}
              onClose={() => setSelection(null)}
            />
          )}
        </div>
      </div>

      {editor && calendars && (
        <EventEditor
          target={editor}
          calendars={calendars}
          preferredCalendarKey={newEventDefaults.calendarKey}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null)
            showEvent(saved)
          }}
        />
      )}
      {actions.dialogs}
    </div>
  )
}
