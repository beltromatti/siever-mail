import { useMemo, useState } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'

import { IconButton } from '@renderer/components/ui/icon-button'
import { cn } from '@renderer/lib/utils'

import { isOn, startOfDay } from './calendar-days'
import { EventLine } from './event-line'
import { useCalendarEvents } from './use-calendar'

/** How many days ahead the agenda lists. */
const AGENDA_DAYS = 14

const DAY_TITLE = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

function dayTitle(day: Date, today: Date): string {
  const offset = Math.round((day.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  return offset === 0 ? 'Oggi' : offset === 1 ? 'Domani' : DAY_TITLE.format(day)
}

/**
 * "Agenda": the next two weeks of every connected calendar, a day at a
 * time, with what is still to answer marked.
 */
export function AgendaPage({ atWindowTopRight }: { atWindowTopRight: boolean }): React.JSX.Element {
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
  const [syncing, setSyncing] = useState(false)

  const byDay = useMemo(
    () =>
      days.map((day) => ({
        day,
        events: (events ?? []).filter((event) => isOn(event, day))
      })),
    [days, events]
  )

  return (
    <div className="page flex h-full min-h-0 flex-col">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-6 px-8 pt-8 pb-16">
          {events === null ? (
            <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
              <LoaderCircle className="size-4 animate-spin" />
              Leggo il calendario…
            </p>
          ) : (
            byDay
              .filter(
                ({ day, events: ofDay }) => ofDay.length > 0 || day.getTime() === today.getTime()
              )
              .map(({ day, events: ofDay }) => (
                <section key={day.toISOString()} className="flex flex-col gap-1">
                  <h2 className="eyebrow first-letter:uppercase">{dayTitle(day, today)}</h2>
                  {ofDay.length > 0 ? (
                    <ul className="flex flex-col">
                      {ofDay.map((event) => (
                        <EventLine key={event.key} event={event} day={day} now={now} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-[13px]">Niente in agenda.</p>
                  )}
                </section>
              ))
          )}
        </div>
      </div>
    </div>
  )
}
