import { useState } from 'react'
import { CalendarDays, LoaderCircle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import type { CalendarConnection } from '@shared/calendar'

const SYNCED_AT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/**
 * An account's calendar in its card: connect it — Google asks, in its own
 * window — or see how it stands, and disconnect it.
 */
export function CalendarConnectionLine({
  connection,
  onChange
}: {
  connection: CalendarConnection
  onChange: (connections: CalendarConnection[]) => void
}): React.JSX.Element {
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const run = async (action: () => Promise<CalendarConnection[]>): Promise<void> => {
    setWorking(true)
    setProblem(null)

    try {
      onChange(await action())
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Non è andata.')
    } finally {
      setWorking(false)
    }
  }

  const connected = connection.state === 'connected'
  const shown = problem ?? connection.problem

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11.5px]">
        <CalendarDays className="text-faint-foreground size-3.5 shrink-0" />
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {connected
            ? `Calendario collegato${connection.calendars.length > 1 ? ` (${connection.calendars.length} calendari)` : ''}${
                connection.lastSyncAt
                  ? ` · letto ${SYNCED_AT.format(new Date(connection.lastSyncAt))}`
                  : ''
              }`
            : 'Calendario non collegato'}
        </span>
        <Button
          type="button"
          size="sm"
          variant={connected ? 'ghost' : 'outline'}
          className="h-7 text-[11.5px]"
          disabled={working}
          onClick={() =>
            void run(() =>
              connected
                ? window.calendarApi.disconnect(connection.accountId)
                : window.calendarApi.connect(connection.accountId)
            )
          }
        >
          {working && <LoaderCircle className="size-3.5 animate-spin" />}
          {connected ? 'Scollega' : 'Collega il calendario'}
        </Button>
      </div>
      {shown && <p className="text-destructive-soft-foreground text-[11px]">{shown}</p>}
    </div>
  )
}
