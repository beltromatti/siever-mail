import { useEffect, useState } from 'react'
import { CalendarDays, Check, LoaderCircle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { hourStyle, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarResponse, MessageInvitation } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'

import { dateFormat } from './calendar-dates'
import { RESPONSE_LABELS } from './event-line'

const MESSAGES = defineMessages({
  invitation: { en: 'Invitation', it: 'Invito', de: 'Einladung' },
  failed: { en: 'That didn’t work.', it: 'Non è andata.', de: 'Das hat nicht geklappt.' },
  cancelled: {
    en: 'The organizer cancelled the event.',
    it: 'L’evento è stato annullato dall’organizzatore.',
    de: 'Der Termin wurde vom Organisator abgesagt.'
  },
  mailed: {
    en: (organizer: string | null) => `Reply sent by email to ${organizer}.`,
    it: (organizer: string | null) => `Risposta mandata per mail a ${organizer}.`,
    de: (organizer: string | null) => `Antwort per E-Mail an ${organizer} gesendet.`
  },
  answerByMail: {
    en: (organizer: string | null) =>
      `No connected calendar answers for you: the reply goes by email to ${organizer}.`,
    it: (organizer: string | null) =>
      `Nessun calendario collegato risponde per te: la risposta va per mail a ${organizer}.`,
    de: (organizer: string | null) =>
      `Kein verbundener Kalender antwortet für Sie: Die Antwort geht per E-Mail an ${organizer}.`
  },
  notYetInCalendar: {
    en: 'It’s not in the calendar yet: it shows at the next update.',
    it: 'Non è ancora nel calendario: compare al prossimo aggiornamento.',
    de: 'Er ist noch nicht im Kalender: Er erscheint bei der nächsten Aktualisierung.'
  },
  connectCalendar: {
    en: 'Connect a calendar to see it here.',
    it: 'Collega un calendario per vederlo qui.',
    de: 'Verbinden Sie einen Kalender, um ihn hier zu sehen.'
  }
})

/** The three answers, as the buttons say them. */
const ANSWER_LABELS = defineMessages({
  accepted: { en: 'Going', it: 'Partecipo', de: 'Zusagen' },
  tentative: { en: 'Maybe', it: 'Forse', de: 'Vielleicht' },
  declined: { en: 'Not going', it: 'Non partecipo', de: 'Absagen' }
}) satisfies Record<Exclude<CalendarResponse, 'needsAction'>, unknown>

/** Made when used: the hour is written as the region writes it now. */
const WHEN = (): Intl.DateTimeFormatOptions => ({
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: hourStyle(),
  minute: '2-digit'
})
const WHEN_DAY: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
}

const ANSWERS: ReadonlyArray<Exclude<CalendarResponse, 'needsAction'>> = [
  'accepted',
  'tentative',
  'declined'
]

/**
 * The invitation a message carries, at the top of the reader: what and
 * when, and the answer — given in the calendar the event is in, which
 * tells the organizer; or, where no calendar connected takes it (none has
 * the event, or only one the user reads, or where they are not named),
 * sent to the organizer by mail, as calendars answer one another.
 */
export function InvitationCard({
  messageRef
}: {
  messageRef: MessageRef
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const responses = useMessages(RESPONSE_LABELS)
  const [invitation, setInvitation] = useState<MessageInvitation | null>(null)
  const [answering, setAnswering] = useState<CalendarResponse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // The answer sent by mail, here: the event is in no calendar that would show it.
  const [mailed, setMailed] = useState<Exclude<CalendarResponse, 'needsAction'> | null>(null)

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

  const answer = (
    response: Exclude<CalendarResponse, 'needsAction'>,
    send: () => Promise<void>
  ): void => {
    setAnswering(response)
    setProblem(null)
    void send()
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : messagesNow(MESSAGES).failed)
      )
      .finally(() => setAnswering(null))
  }

  const event = invitation.event
  const timing = event ?? invitation.when
  const cancelled = invitation.method === 'CANCEL'
  const title = event?.title ?? invitation.summary ?? m.invitation

  return (
    <section
      aria-label={m.invitation}
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
            {responses[event.myResponse]}
          </span>
        )}
      </div>
      {timing && (
        <p className="text-muted-foreground first-letter:uppercase">
          {timing.allDay
            ? dateFormat(WHEN_DAY).format(new Date(`${timing.start}T00:00`))
            : dateFormat(WHEN()).format(new Date(timing.start))}
          {timing.location && ` · ${timing.location}`}
        </p>
      )}
      {cancelled ? (
        <p className="text-muted-foreground">{m.cancelled}</p>
      ) : event && event.myResponse !== null ? (
        <Answers
          given={event.myResponse}
          answering={answering}
          onAnswer={(response) =>
            answer(response, async () => {
              // An invitation to a series is answered for the series, not for the instance found.
              const answered = await window.calendarApi.respond(event.key, response, {
                series: invitation.series
              })
              setInvitation({ ...invitation, event: answered })
            })
          }
        />
      ) : invitation.answerByMail ? (
        <>
          <Answers
            given={mailed}
            answering={answering}
            onAnswer={(response) =>
              answer(response, async () => {
                await window.calendarApi.respondByMail(messageRef, response)
                setMailed(response)
              })
            }
          />
          <p className="text-muted-foreground text-[11.5px]">
            {mailed ? m.mailed(invitation.organizer) : m.answerByMail(invitation.organizer)}
          </p>
        </>
      ) : event ? null : (
        <p className="text-muted-foreground">
          {invitation.calendarConnected ? m.notYetInCalendar : m.connectCalendar}
        </p>
      )}
      {problem && <p className="text-destructive-soft-foreground text-[11.5px]">{problem}</p>}
    </section>
  )
}

/** The three answers, the one given marked. */
function Answers({
  given,
  answering,
  onAnswer
}: {
  given: CalendarResponse | null
  answering: CalendarResponse | null
  onAnswer: (response: Exclude<CalendarResponse, 'needsAction'>) => void
}): React.JSX.Element {
  const labels = useMessages(ANSWER_LABELS)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ANSWERS.map((response) => (
        <Button
          key={response}
          size="sm"
          variant={given === response ? 'default' : 'outline'}
          disabled={answering !== null}
          onClick={() => onAnswer(response)}
        >
          {answering === response ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            given === response && <Check className="size-3.5" />
          )}
          {labels[response]}
        </Button>
      ))}
    </div>
  )
}
