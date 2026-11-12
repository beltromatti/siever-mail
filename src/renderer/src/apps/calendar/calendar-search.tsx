import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'

import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { dateFormat, eventStartDay } from '@renderer/features/calendar/calendar-dates'
import { eventTimeLabel } from '@renderer/features/calendar/event-line'
import { HighlightedText } from '@renderer/features/mail/message-list-shared'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { uiLog } from '@renderer/lib/diagnostics'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import {
  calendarSearchWords,
  type CalendarEvent,
  type CalendarListEntry,
  type CalendarSearchResult
} from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import { dotStyle } from './event-style'
import { calendarOf } from './use-calendar-data'

/** How long typing pauses before the events are searched. */
const SEARCH_DELAY_MS = 150
/** A search left as it is this long is the one the user settled on (§14.4). */
const SEARCH_SETTLED_MS = 1_500
/** Events a search lists at most: past them, another word narrows it. */
const RESULTS_SHOWN = 60

const MESSAGES = defineMessages({
  help: {
    en: 'Searches the events of the calendars shown, past ones too: in the title, the location, the description, the guests and the calendar’s name, regardless of capitals and accents. Every word must be there.',
    it: 'Cerca negli eventi dei calendari mostrati, anche passati: nel titolo, nel luogo, nella descrizione, tra gli invitati e nel nome del calendario, senza badare a maiuscole e accenti. Ogni parola deve esserci.',
    de: 'Durchsucht die Termine der angezeigten Kalender, auch vergangene: im Titel, im Ort, in der Beschreibung, unter den Gästen und im Namen des Kalenders, ohne Rücksicht auf Groß- und Kleinschreibung und Akzente. Jedes Wort muss vorkommen.'
  },
  search: { en: 'Search events', it: 'Cerca negli eventi', de: 'Termine durchsuchen' },
  clear: { en: 'Clear search', it: 'Cancella ricerca', de: 'Suche löschen' },
  found: { en: 'Events found', it: 'Eventi trovati', de: 'Gefundene Termine' },
  searching: { en: 'Searching…', it: 'Cerco…', de: 'Suche läuft…' },
  failed: {
    en: (error: string) => `The search failed: ${error}`,
    it: (error: string) => `La ricerca non è riuscita: ${error}`,
    de: (error: string) => `Die Suche ist fehlgeschlagen: ${error}`
  },
  none: {
    en: 'No event with these words.',
    it: 'Nessun evento con queste parole.',
    de: 'Kein Termin mit diesen Wörtern.'
  },
  noneHint: {
    en: 'The search covers the calendars shown, from two months ago to a year ahead: try fewer words, or others.',
    it: 'Si cerca nei calendari mostrati, da due mesi fa a un anno avanti: prova con meno parole o con altre.',
    de: 'Gesucht wird in den angezeigten Kalendern, von vor zwei Monaten bis ein Jahr im Voraus: Versuchen Sie es mit weniger oder anderen Wörtern.'
  },
  upcoming: { en: 'Upcoming', it: 'In arrivo', de: 'Demnächst' },
  past: { en: 'Past', it: 'Passati', de: 'Vergangen' },
  more: {
    en: (count: number) =>
      `${count === 1 ? 'One more, further from today' : `${count} more, further from today`}: add a word to narrow it down.`,
    it: (count: number) =>
      `${count === 1 ? 'Un altro, più lontano da oggi' : `Altri ${count}, più lontani da oggi`}: aggiungi una parola per restringere.`,
    de: (count: number) =>
      `${count === 1 ? 'Ein weiterer, weiter von heute entfernt' : `${count} weitere, weiter von heute entfernt`}: Fügen Sie ein Wort hinzu, um die Suche einzugrenzen.`
  }
})

const DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
const DAY_YEAR: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}

type Found =
  | { text: string; result: CalendarSearchResult; error?: undefined }
  | { text: string; result?: undefined; error: string }

/** One event found: its day and time, its title and place with the words marked, its calendar. */
function FoundEvent({
  event,
  words,
  calendars,
  id,
  active,
  onHover,
  onChoose
}: {
  event: CalendarEvent
  words: readonly string[]
  calendars: ReadonlyArray<CalendarListEntry> | null
  id: string
  active: boolean
  onHover: () => void
  onChoose: () => void
}): React.JSX.Element {
  const day = eventStartDay(event)

  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        'grid w-full grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 rounded-[6px] px-2 py-1.5 text-left',
        active && 'bg-selected'
      )}
    >
      <span className="flex flex-col text-[11.5px] leading-[1.35] tabular-nums">
        <span className="text-foreground font-medium first-letter:uppercase">
          {dateFormat(day.getFullYear() === new Date().getFullYear() ? DAY : DAY_YEAR).format(day)}
        </span>
        <span className="text-muted-foreground">{eventTimeLabel(event, day)}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'text-foreground truncate text-[13px] leading-[1.35] font-medium',
            event.myResponse === 'declined' && 'line-through opacity-60'
          )}
        >
          <HighlightedText text={event.title} terms={words} />
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11.5px]">
          <span
            className="size-2 shrink-0 rounded-full"
            style={dotStyle(calendarOf(event, calendars)?.color ?? null)}
          />
          <span className="truncate">
            {event.calendarName}
            {event.location && (
              <>
                {' · '}
                <HighlightedText text={event.location} terms={words} />
              </>
            )}
          </span>
        </span>
      </span>
    </button>
  )
}

/**
 * The Calendario's search, as the mail's: words, case and accents aside,
 * looked for in every event kept of the calendars shown — the past ones
 * too — listed under the field, those to come first. Arrows move, Enter or
 * a click goes to the event's day with the event open; Esc empties the
 * field, and a second Esc leaves it.
 */
export function CalendarSearch({
  calendars,
  inputRef,
  onOpen
}: {
  calendars: ReadonlyArray<CalendarListEntry> | null
  /** For the window's "Cerca" command, which puts the cursor here. */
  inputRef?: Ref<HTMLInputElement>
  onOpen: (event: CalendarEvent) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [active, setActive] = useState(0)
  const ownInputRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()
  const searchKeys = useCommandKeys('search')
  const text = query.trim()
  const words = useMemo(() => calendarSearchWords(text), [text])
  // The calendars shown, by content: a list read again the same does not search again.
  const shown = calendars
    ? JSON.stringify(
        calendars.filter((calendar) => !calendar.hidden).map((calendar) => calendar.key)
      )
    : null

  useImperativeHandle(inputRef, () => ownInputRef.current as HTMLInputElement, [])

  // Searched as typing pauses, and again whenever the events change while words are there.
  useEffect(() => {
    if (!text || shown === null) {
      return
    }

    let current = true
    // Searches asked in a burst of changes answer in any order: only the last one asked counts.
    let asked = 0
    const calendarKeys = JSON.parse(shown) as string[]
    const search = (): void => {
      const mine = (asked += 1)
      const latest = (): boolean => current && mine === asked
      void window.calendarApi
        .search({ text, calendarKeys, limit: RESULTS_SHOWN })
        .then((result) => latest() && setFound({ text, result }))
        .catch(
          (error: unknown) =>
            latest() &&
            setFound({ text, error: error instanceof Error ? error.message : String(error) })
        )
    }
    const timer = window.setTimeout(search, SEARCH_DELAY_MS)
    const unsubscribe = window.calendarApi.onChanged(search)

    return () => {
      current = false
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [shown, text])

  // A search the user settled on (§14.4): how many words, never which.
  useEffect(() => {
    if (!text) {
      return
    }

    const timer = window.setTimeout(
      () => uiLog.info('search', { app: 'calendar', words: text.split(/\s+/).length }),
      SEARCH_SETTLED_MS
    )
    return () => window.clearTimeout(timer)
  }, [text])

  // While the words change, what the last ones found stays until the new search answers.
  const result = text ? found : null
  const events = useMemo(
    () => (result?.result ? [...result.result.upcoming, ...result.result.past] : []),
    [result]
  )
  const activeIndex = Math.min(active, events.length - 1)
  const open = focused && text !== ''

  useEffect(() => {
    if (activeIndex >= 0) {
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, listId])

  const choose = (event: CalendarEvent | undefined): void => {
    if (event) {
      ownInputRef.current?.blur()
      onOpen(event)
    }
  }

  const option = (event: CalendarEvent, index: number): React.JSX.Element => (
    <FoundEvent
      key={event.key}
      event={event}
      words={words}
      calendars={calendars}
      id={`${listId}-${index}`}
      active={index === activeIndex}
      onHover={() => setActive(index)}
      onChoose={() => choose(event)}
    />
  )

  return (
    <div className="window-no-drag relative w-[240px] min-w-[150px] shrink">
      <label className="field flex h-[30px] items-center gap-2 rounded-md pr-1.5 pl-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Search className="text-faint-foreground size-3.5 shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-72 font-normal">
            {m.help}
          </TooltipContent>
        </Tooltip>
        <input
          ref={ownInputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)

            if (!event.target.value.trim()) {
              setFound(null)
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && events.length > 0) {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActive((Math.max(activeIndex, 0) + step + events.length) % events.length)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(events[activeIndex])
            } else if (event.key === 'Escape') {
              // First Escape empties the field, the next one leaves it.
              event.preventDefault()

              if (query) {
                setQuery('')
                setFound(null)
              } else {
                event.currentTarget.blur()
              }
            }
          }}
          placeholder={m.search}
          aria-label={m.search}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          spellCheck={false}
          autoComplete="off"
          className="placeholder:text-faint-foreground min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
        />
        {query ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setFound(null)
                  ownInputRef.current?.focus()
                }}
                aria-label={m.clear}
                className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 grid size-5 shrink-0 place-items-center rounded-[4px] outline-none focus-visible:ring-2"
              >
                <X className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{m.clear}</TooltipContent>
          </Tooltip>
        ) : (
          searchKeys && <ShortcutKeys keys={searchKeys} className="shrink-0" />
        )}
      </label>

      {open && (
        // The list refuses the mouse-down that would take focus from the field, so the keys
        // keep moving through it.
        <div
          id={listId}
          role="listbox"
          aria-label={m.found}
          onMouseDown={(event) => event.preventDefault()}
          className="sheet absolute top-full right-0 z-40 mt-1.5 max-h-[min(480px,70vh)] w-[420px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg p-1"
        >
          {!result ? (
            <p className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-[12px]">
              <LoaderCircle className="size-3.5 animate-spin" />
              {m.searching}
            </p>
          ) : result.error !== undefined ? (
            <p className="text-destructive px-2 py-2 text-[12px]">{m.failed(result.error)}</p>
          ) : events.length === 0 ? (
            <div className="px-2 py-2 text-[12px]">
              <p className="text-foreground">{m.none}</p>
              <p className="text-muted-foreground mt-0.5 text-[11.5px]">{m.noneHint}</p>
            </div>
          ) : (
            <>
              {result.result.upcoming.length > 0 && (
                <>
                  <p className="eyebrow px-2 pt-1.5 pb-0.5">{m.upcoming}</p>
                  {result.result.upcoming.map((event, index) => option(event, index))}
                </>
              )}
              {result.result.past.length > 0 && (
                <>
                  <p className="eyebrow px-2 pt-1.5 pb-0.5">{m.past}</p>
                  {result.result.past.map((event, index) =>
                    option(event, result.result.upcoming.length + index)
                  )}
                </>
              )}
              {result.result.more > 0 && (
                <p className="text-faint-foreground px-2 pt-1 pb-1.5 text-[11px]">
                  {m.more(result.result.more)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
