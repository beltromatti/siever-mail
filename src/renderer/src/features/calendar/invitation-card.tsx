import { useEffect, useState } from 'react'
import { CalendarDays, Check, LoaderCircle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { CalendarResponse, MessageInvitation } from '@shared/calendar'
import type { MessageRef } from '@shared/models'

import { RESPONSE_LABELS } from './event-line'

const WHEN = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit'
})
const WHEN_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

const ANSWERS: ReadonlyArray<{
  response: Exclude<CalendarResponse, 'needsAction'>
  label: string
}> = [
  { response: 'accepted', label: 'Partecipo' },
  { response: 'tentative', label: 'Forse' },
  { response: 'declined', label: 'Non partecipo' }
]

/**
 * The invitation a message carries, at the top of the reader: what and
 * when, and the answer given in the account's calendar — the organizer is
 * told, as Google Calendar tells them.
 */
export function InvitationCard({
  messageRef
}: {
  messageRef: MessageRef
}): React.JSX.Element | null {
  const [invitation, setInvitation] = useState<MessageInvitation | null>(null)
  const [answering, setAnswering] = useState<CalendarResponse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const { accountId, folderPath, uid } = messageRef

  useEffect(() => {
    let current = true
    const load = (): void =>
      void window.calendarApi
        .invitation({ accountId, folderPath, uid })
        .then((loaded) => current && setInvitation(loaded))
        .catch(() => undefined)

    load()
    const unsubscribe = window.calendarApi.onChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [accountId, folderPath, uid])

  if (!invitation) {
    return null
  }

  const event = invitation.event
  const cancelled = invitation.method === 'CANCEL'
  const title = event?.title ?? invitation.summary ?? 'Invito'

  return (
    <section
      aria-label="Invito"
      className="sheet mb-4 flex flex-col gap-2 rounded-[10px] px-3.5 py-3 text-[12.5px]"
    >
      <div className="flex items-center gap-2">
        <CalendarDays className="text-ai size-4 shrink-0" />
        <span className="text-foreground min-w-0 flex-1 truncate font-semibold">{title}</span>
        {event?.myResponse && (
          <span
            className={cn(
              'shrink-0 text-[11.5px] font-semibold',
              event.myResponse === 'needsAction' ? 'text-urgent' : 'text-muted-foreground'
            )}
          >
            {RESPONSE_LABELS[event.myResponse]}
          </span>
        )}
      </div>
      {event && (
        <p className="text-muted-foreground first-letter:uppercase">
          {event.allDay
            ? WHEN_DAY.format(new Date(`${event.start}T00:00`))
            : WHEN.format(new Date(event.start))}
          {event.location && ` · ${event.location}`}
        </p>
      )}
      {cancelled ? (
        <p className="text-muted-foreground">L’evento è stato annullato dall’organizzatore.</p>
      ) : !invitation.calendarConnected ? (
        <p className="text-muted-foreground">
          Collega il calendario di questo account in Impostazioni › Account per rispondere da qui.
        </p>
      ) : !event ? (
        <p className="text-muted-foreground">
          Non è ancora nel calendario: compare al prossimo aggiornamento.
        </p>
      ) : (
        event.myResponse !== null && (
          <div className="flex flex-wrap items-center gap-1.5">
            {ANSWERS.map(({ response, label }) => (
              <Button
                key={response}
                size="sm"
                variant={event.myResponse === response ? 'default' : 'outline'}
                disabled={answering !== null}
                onClick={() => {
                  setAnswering(response)
                  setProblem(null)
                  void window.calendarApi
                    .respond(event.key, response)
                    .then((answered) => setInvitation({ ...invitation, event: answered }))
                    .catch((error: unknown) =>
                      setProblem(error instanceof Error ? error.message : 'Non è andata.')
                    )
                    .finally(() => setAnswering(null))
                }}
              >
                {answering === response ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  event.myResponse === response && <Check className="size-3.5" />
                )}
                {label}
              </Button>
            ))}
          </div>
        )
      )}
      {problem && <p className="text-destructive-soft-foreground text-[11.5px]">{problem}</p>}
    </section>
  )
}
