import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, LoaderCircle, RefreshCw } from 'lucide-react'

import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { cn } from '@renderer/lib/utils'
import type { MessageRef } from '@shared/models'
import type { DayLine } from '@shared/segretario'

import { COMMITMENT_LABELS } from '@renderer/features/segretario/row-work'

import { isOn, startOfDay } from './calendar-days'
import { EventLine } from './event-line'
import { useCalendarEvents } from './use-calendar'

/** How many days ahead the agenda lists. */
const AGENDA_DAYS = 14

const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short' })
const MONTH = new Intl.DateTimeFormat('it-IT', { month: 'short' })

/** A day as the deadlines are written: AAAA-MM-GG, local. */
function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/** A deadline the Segretario found in the mail, on its day beside the events: it opens its message. */
function DueLine({
  item,
  onOpen
}: {
  item: DayLine
  onOpen: (ref: MessageRef) => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.ref)}
        className="hover:bg-hover focus-visible:ring-ring/60 -mx-2 grid w-[calc(100%+1rem)] grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 rounded-[7px] px-2 py-1.5 text-left outline-none focus-visible:ring-2"
      >
        <span className="text-ai flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap">
          <CompassStar className="text-ai-star size-3" />
          {item.commitment ? COMMITMENT_LABELS[item.commitment.kind] : 'Dalla posta'}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-foreground text-[14px] leading-[1.35]">{item.text}</span>
          <span className="text-muted-foreground truncate text-[12px]">
            {item.from}
            {item.subject && ` · «${item.subject}»`}
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * "Agenda": the next two weeks a day at a time — the events of every
 * connected calendar and, beside them, what the mail says is due that day,
 * as the Segretario read it. Without a calendar, the deadlines alone.
 */
export function AgendaPage({
  atWindowTopRight,
  calendarConnected,
  showDue,
  onOpenMessage
}: {
  atWindowTopRight: boolean
  /** Without one, the agenda is the mail's deadlines alone, and says how to add the events. */
  calendarConnected: boolean
  /** The Segretario reads the mail: its deadlines go on their days. */
  showDue: boolean
  onOpenMessage: (ref: MessageRef) => void
}): React.JSX.Element {
  const [now] = useState(() => Date.now())
  const today = useMemo(() => startOfDay(new Date(now)), [now])
  const days = useMemo(
    () =>
      Array.from(
        { length: AGENDA_DAYS },
        (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + index)
      ),
    [today]
  )
  const events = useCalendarEvents(
    today.toISOString(),
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + AGENDA_DAYS).toISOString()
  )
  const [due, setDue] = useState<DayLine[]>([])
  const [syncing, setSyncing] = useState(false)

  // The deadlines follow the work as it changes.
  useEffect(() => {
    if (!showDue) {
      return
    }

    let current = true
    const throughDay = dayKey(days[days.length - 1])
    const load = (): void =>
      void window.segretarioApi.getDue(throughDay).then((items) => current && setDue(items))
    let timer: number | null = null

    load()
    const unsubscribe = window.segretarioApi.onWorkChanged(() => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }

      timer = window.setTimeout(load, 1500)
    })

    return () => {
      current = false
      unsubscribe()

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [days, showDue])

  const byDay = useMemo(
    () =>
      days
        .map((day) => ({
          day,
          events: (events ?? []).filter((event) => isOn(event, day)),
          due: showDue ? due.filter((item) => item.due === dayKey(day)) : []
        }))
        .filter(
          (entry) =>
            entry.events.length > 0 ||
            entry.due.length > 0 ||
            entry.day.getTime() === today.getTime()
        ),
    [days, due, events, showDue, today]
  )

  return (
    <div className="paper flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'window-drag-region flex h-[52px] shrink-0 items-center gap-2 border-b pl-6',
          atWindowTopRight ? 'pr-[calc(var(--titlebar-controls)+8px)]' : 'pr-3'
        )}
      >
        <h1 className="display-title text-[15px]">Agenda</h1>
        <div className="flex-1" />
        <IconButton
          label="Aggiorna dal calendario"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <article className="letter mx-auto flex max-w-[720px] flex-col rounded-[14px] px-7 pt-7 pb-12 sm:px-12">
          <div className="flex items-center gap-2 border-b pb-3">
            <CalendarDays className="text-primary-text size-[15px]" />
            <span className="eyebrow">Le prossime due settimane</span>
          </div>
          {!calendarConnected && (
            <p className="text-muted-foreground pt-4 text-[12.5px]">
              Qui ci sono le scadenze che il Segretario trova nella posta. Per vedere anche gli
              appuntamenti, collega il calendario in Impostazioni › Account.
            </p>
          )}
          {events === null ? (
            <p className="text-muted-foreground flex items-center gap-2 pt-6 text-[13px]">
              <LoaderCircle className="size-4 animate-spin" />
              Leggo il calendario…
            </p>
          ) : (
            byDay.map(({ day, events: ofDay, due: dueOfDay }) => {
              const isToday = day.getTime() === today.getTime()

              return (
                <section
                  key={day.toISOString()}
                  aria-label={day.toLocaleDateString('it-IT', { dateStyle: 'full' })}
                  className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-5 border-b py-5 last:border-b-0"
                >
                  <div className="flex flex-col items-start leading-none">
                    <span className="eyebrow">{isToday ? 'Oggi' : WEEKDAY.format(day)}</span>
                    <span
                      className={cn(
                        'display-title mt-1 text-[28px] tabular-nums',
                        isToday && 'text-primary-text'
                      )}
                    >
                      {day.getDate()}
                    </span>
                    <span className="text-faint-foreground mt-1 text-[11px]">
                      {MONTH.format(day)}
                    </span>
                  </div>
                  {ofDay.length > 0 || dueOfDay.length > 0 ? (
                    <ul className="flex min-w-0 flex-col">
                      {ofDay.map((event) => (
                        <EventLine key={event.key} event={event} day={day} now={now} />
                      ))}
                      {dueOfDay.map((item) => (
                        <DueLine
                          key={`${item.ref.accountId}\u0000${item.messageKey}\u0000${item.commitment?.id ?? ''}`}
                          item={item}
                          onOpen={onOpenMessage}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground self-center text-[13px]">
                      Niente in agenda.
                    </p>
                  )}
                </section>
              )
            })
          )}
        </article>
      </div>
    </div>
  )
}
