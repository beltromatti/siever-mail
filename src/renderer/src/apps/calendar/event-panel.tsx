import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Check,
  ExternalLink,
  HelpCircle,
  LoaderCircle,
  Mail,
  MapPin,
  PenLine,
  Trash2,
  Users,
  Video,
  X
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { RESPONSE_LABELS } from '@renderer/features/calendar/event-line'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry, CalendarResponse } from '@shared/calendar'
import type { MessageRef } from '@shared/models'
import type { LinkedText } from '@shared/segretario'
import { eventProposalWords } from '@renderer/features/segretario/proposal-words'
import { LinkedWords } from '@renderer/features/segretario/segretario-text'

import { addDays, dayOfKey } from '@renderer/features/calendar/calendar-dates'
import { dotStyle } from './event-style'
import type { ProposedEvent } from './use-calendar-data'

const DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

/** When an event is, in words: "giovedì 5 novembre, 9:00–10:30", or its days for one all day. */
export function whenWords(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): string {
  if (event.allDay) {
    const first = dayOfKey(event.start.slice(0, 10))
    const last = addDays(dayOfKey(event.end.slice(0, 10)), -1)
    return last.getTime() <= first.getTime()
      ? `${DAY.format(first)}, tutto il giorno`
      : `da ${DAY.format(first)} a ${DAY.format(last)}`
  }

  const start = new Date(event.start)
  const end = new Date(event.end)
  return start.toDateString() === end.toDateString()
    ? `${DAY.format(start)}, ${TIME.format(start)}–${TIME.format(end)}`
    : `da ${DAY.format(start)} ${TIME.format(start)} a ${DAY.format(end)} ${TIME.format(end)}`
}

const RESPONSES: ReadonlyArray<{
  value: Exclude<CalendarResponse, 'needsAction'>
  label: string
  icon: typeof Check
}> = [
  { value: 'accepted', label: 'Partecipo', icon: Check },
  { value: 'tentative', label: 'Forse', icon: HelpCircle },
  { value: 'declined', label: 'No', icon: X }
]

/** Opens the message something came from, when it is still in the mail. */
async function openSource(
  accountId: string | null,
  messageKey: string | null,
  onOpenMessage: (ref: MessageRef) => void
): Promise<void> {
  const ref =
    accountId && messageKey ? await window.segretarioApi.replySource(accountId, messageKey) : null

  if (ref) {
    onOpenMessage(ref)
  } else {
    toast.error('Il messaggio non è più nella posta')
  }
}

/** What the Segretario wrote to prepare for an event, kept current while it writes. */
function useEventPrep(eventKey: string | null): (LinkedText & { writtenAt: number }) | null {
  const [prep, setPrep] = useState<{
    eventKey: string
    value: (LinkedText & { writtenAt: number }) | null
  } | null>(null)

  useEffect(() => {
    if (!eventKey) {
      return
    }

    let current = true
    const load = (): void =>
      void window.segretarioApi
        .eventPrep(eventKey)
        .then((value) => current && setPrep({ eventKey, value }))

    load()
    const unsubscribe = window.segretarioApi.onWorkChanged(load)

    return () => {
      current = false
      unsubscribe()
    }
  }, [eventKey])

  return prep?.eventKey === eventKey ? prep.value : null
}

/**
 * An event beside the calendar, as the reader is beside the mail: when,
 * where, who — with their answers — what it says, where it came from; and
 * what can be done with it: answer, change it, take it away, join its
 * call. A proposal of the Segretario's is added, or set aside, from here.
 */
export function EventPanel({
  event,
  proposed,
  calendar,
  aiOn,
  onEdit,
  onClose,
  onOpenMessage
}: {
  event: CalendarEvent | null
  proposed: ProposedEvent | null
  calendar: CalendarListEntry | undefined
  aiOn: boolean
  onEdit: (event: CalendarEvent) => void
  onClose: () => void
  onOpenMessage: (ref: MessageRef) => void
}): React.JSX.Element | null {
  const [working, setWorking] = useState<string | null>(null)
  const { confirm, dialog } = useConfirmDialog()
  const prep = useEventPrep(aiOn && event ? event.key : null)
  const closeKeys = useCommandKeys('calendar-close-event')

  const run = async (
    label: string,
    action: () => Promise<unknown>,
    done?: string
  ): Promise<void> => {
    setWorking(label)

    try {
      await action()

      if (done) {
        toast(done)
      }
    } catch (error) {
      toast.error('Non è andata', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setWorking(null)
    }
  }

  if (!event && !proposed) {
    return null
  }

  const shown = event ?? proposed!
  const title = event?.title ?? proposed!.title
  const attendees = event
    ? event.attendees.filter((attendee) => !attendee.self)
    : Array.isArray(proposed!.proposal.payload.attendees)
      ? (proposed!.proposal.payload.attendees as string[]).map((email) => ({
          email,
          name: null,
          response: 'needsAction' as const,
          self: false,
          organizer: false
        }))
      : []
  const location =
    event?.location ??
    (typeof proposed?.proposal.payload.location === 'string'
      ? proposed.proposal.payload.location
      : null)
  const description =
    event?.description ??
    (typeof proposed?.proposal.payload.description === 'string'
      ? proposed.proposal.payload.description
      : null)

  return (
    <aside aria-label={title} className="flex h-full min-h-0 w-[340px] shrink-0 flex-col border-l">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={dotStyle(event ? (calendar?.color ?? null) : null)}
        />
        <h2
          className={cn(
            'min-w-0 flex-1 text-[16px] leading-snug font-semibold',
            proposed && 'italic'
          )}
        >
          {title}
        </h2>
        <IconButton
          label="Chiudi"
          shortcutKeys={closeKeys}
          className="text-faint-foreground size-[26px] shrink-0"
          onClick={onClose}
        >
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-[13px]">
        <p className="text-foreground first-letter:uppercase">{whenWords(shown)}</p>

        {event && calendar && (
          <p className="text-muted-foreground flex items-center gap-2 text-[12px]">
            <CalendarDays className="size-3.5 shrink-0" />
            {calendar.name}
            {calendar.connection && calendar.connection !== calendar.name
              ? ` · ${calendar.connection}`
              : ''}
          </p>
        )}

        {proposed && (
          <p className="text-ai flex items-center gap-2 text-[12px] font-semibold">
            <CompassStar className="text-ai-star size-3.5" />
            Proposto dal Segretario: decidi tu se metterlo in calendario.
          </p>
        )}

        {location && (
          <p className="flex items-start gap-2">
            <MapPin className="text-faint-foreground mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{location}</span>
          </p>
        )}

        {event?.meetLink && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => event.meetLink && void window.mailApi.openExternalUrl(event.meetLink)}
          >
            <Video className="size-3.5" />
            Entra nella call
          </Button>
        )}

        {event && event.myResponse !== null && (
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-[12px]">
              {event.organizer ? `Invito di ${event.organizer}` : 'Sei invitato'} ·{' '}
              <span
                className={cn(event.myResponse === 'needsAction' && 'text-urgent font-semibold')}
              >
                {RESPONSE_LABELS[event.myResponse]}
              </span>
            </p>
            <div className="flex gap-1.5">
              {RESPONSES.map((response) => {
                const Icon = response.icon

                return (
                  <Button
                    key={response.value}
                    size="sm"
                    variant={event.myResponse === response.value ? 'default' : 'outline'}
                    disabled={working !== null}
                    onClick={() =>
                      void run(
                        response.value,
                        () => window.calendarApi.respond(event.key, response.value),
                        'Risposta mandata'
                      )
                    }
                  >
                    {working === response.value ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Icon className="size-3.5" />
                    )}
                    {response.label}
                  </Button>
                )
              })}
            </div>
          </div>
        )}

        {attendees.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground flex items-center gap-2 text-[12px]">
              <Users className="size-3.5" />
              {attendees.length === 1 ? 'Un invitato' : `${attendees.length} invitati`}
            </p>
            <ul className="flex flex-col gap-0.5 pl-5.5 text-[12.5px]">
              {attendees.map((attendee) => (
                <li key={attendee.email} className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 truncate">{attendee.name ?? attendee.email}</span>
                  {event && (
                    <span
                      className={cn(
                        'shrink-0 text-[11px]',
                        attendee.response === 'accepted'
                          ? 'text-status-online'
                          : attendee.response === 'declined'
                            ? 'text-destructive-soft-foreground'
                            : 'text-faint-foreground'
                      )}
                    >
                      {RESPONSE_LABELS[attendee.response].toLowerCase()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {proposed && eventProposalWords(proposed.proposal).changes.length > 0 && (
          <ul className="text-foreground flex flex-col gap-0.5 text-[12.5px] leading-[1.5]">
            {eventProposalWords(proposed.proposal).changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {description && (
          <p className="text-muted-foreground max-h-60 shrink-0 overflow-y-auto text-[12.5px] leading-[1.5] whitespace-pre-wrap">
            {description}
          </p>
        )}

        {prep && (
          <div className="flex flex-col gap-1.5">
            <p className="text-ai flex items-center gap-1.5 text-[12px] font-semibold">
              <CompassStar className="text-ai-star size-3.5" />
              Per prepararti
            </p>
            <LinkedWords
              text={prep.text}
              links={prep.links}
              className="text-foreground border-ai-line border-l-2 pl-2.5 text-[13.5px] leading-[1.5]"
            />
          </div>
        )}

        {aiOn && event?.origin && (
          <div className="bg-ai-soft/45 flex flex-col gap-1.5 rounded-[8px] px-3 py-2">
            <p className="text-ai flex items-center gap-1.5 text-[12px] font-semibold">
              <CompassStar className="text-ai-star size-3.5" />
              Messo in calendario dal Segretario
            </p>
            {event.origin.messageKey && (
              <button
                type="button"
                onClick={() =>
                  void openSource(event.origin!.accountId, event.origin!.messageKey, onOpenMessage)
                }
                className="text-foreground focus-visible:ring-ring/60 flex items-center gap-1.5 self-start rounded-sm text-[12px] outline-none hover:underline focus-visible:ring-2"
              >
                <Mail className="size-3.5" />
                Apri la mail da cui viene
              </button>
            )}
          </div>
        )}

        {proposed?.proposal.messageKey && (
          <button
            type="button"
            onClick={() =>
              void openSource(
                proposed.proposal.accountId,
                proposed.proposal.messageKey,
                onOpenMessage
              )
            }
            className="text-foreground focus-visible:ring-ring/60 flex items-center gap-1.5 self-start rounded-sm text-[12px] outline-none hover:underline focus-visible:ring-2"
          >
            <Mail className="size-3.5" />
            Apri la mail da cui viene
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3">
        {proposed ? (
          <>
            <Button
              size="sm"
              disabled={working !== null}
              onClick={() =>
                void run(
                  'accept',
                  () =>
                    window.segretarioApi.decideProposal(
                      proposed.proposal.id,
                      true,
                      undefined,
                      proposed.proposal.revision
                    ),
                  eventProposalWords(proposed.proposal).done
                ).then(onClose)
              }
            >
              {working === 'accept' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {eventProposalWords(proposed.proposal).action}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={working !== null}
              onClick={() =>
                void run('ignore', () =>
                  window.segretarioApi.decideProposal(
                    proposed.proposal.id,
                    false,
                    undefined,
                    proposed.proposal.revision
                  )
                ).then(onClose)
              }
            >
              Ignora
            </Button>
          </>
        ) : (
          event && (
            <>
              {/* An invitation is answered, not changed: only what the user organises is theirs to edit. */}
              {calendar?.writable && event.organizedByUser !== false && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working !== null}
                    onClick={() => onEdit(event)}
                  >
                    <PenLine className="size-3.5" />
                    Modifica
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={working !== null}
                    onClick={() =>
                      void confirm({
                        title: `Eliminare «${event.title}»?`,
                        description:
                          attendees.length > 0
                            ? 'Gli invitati ricevono la cancellazione.'
                            : 'Lo togli dal calendario.',
                        confirmLabel: 'Elimina',
                        destructive: true
                      }).then(
                        (confirmed) =>
                          confirmed &&
                          void run(
                            'remove',
                            () => window.calendarApi.remove(event.key),
                            'Evento eliminato'
                          ).then(onClose)
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                    Elimina
                  </Button>
                </>
              )}
              <div className="flex-1" />
              {event.htmlLink && (
                <IconButton
                  label="Apri nel calendario del fornitore"
                  className="text-faint-foreground size-[28px]"
                  onClick={() =>
                    event.htmlLink && void window.mailApi.openExternalUrl(event.htmlLink)
                  }
                >
                  <ExternalLink className="size-3.5" />
                </IconButton>
              )}
            </>
          )
        )}
      </div>
      {dialog}
    </aside>
  )
}
