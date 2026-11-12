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
import { hourStyle, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry, CalendarResponse } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'
import type { LinkedText } from '@shared/segretario'
import { eventProposalWords } from '@renderer/features/segretario/proposal-words'
import { LinkedWords } from '@renderer/features/segretario/segretario-text'

import { addDays, dateFormat, dayOfKey } from '@renderer/features/calendar/calendar-dates'
import { dotStyle } from './event-style'
import { EventWorkSection } from './event-work'
import type { ProposedEvent } from './use-calendar-data'

const MESSAGES = defineMessages({
  allDay: {
    en: (day: string) => `${day}, all day`,
    it: (day: string) => `${day}, tutto il giorno`,
    de: (day: string) => `${day}, ganztägig`
  },
  fromTo: {
    en: (from: string, to: string) => `from ${from} to ${to}`,
    it: (from: string, to: string) => `da ${from} a ${to}`,
    de: (from: string, to: string) => `von ${from} bis ${to}`
  },
  messageGone: {
    en: 'The message is no longer in the mail',
    it: 'Il messaggio non è più nella posta',
    de: 'Die Nachricht ist nicht mehr im Postfach'
  },
  failed: { en: 'That didn’t work', it: 'Non è andata', de: 'Das hat nicht geklappt' },
  close: { en: 'Close', it: 'Chiudi', de: 'Schließen' },
  proposed: {
    en: 'Proposed by the Segretario: you decide whether to put it in the calendar.',
    it: 'Proposto dal Segretario: decidi tu se metterlo in calendario.',
    de: 'Vom Segretario vorgeschlagen: Sie entscheiden, ob er in den Kalender kommt.'
  },
  joinCall: { en: 'Join the call', it: 'Entra nella call', de: 'Dem Anruf beitreten' },
  invitationFrom: {
    en: (organizer: string) => `Invitation from ${organizer}`,
    it: (organizer: string) => `Invito di ${organizer}`,
    de: (organizer: string) => `Einladung von ${organizer}`
  },
  invited: { en: 'You’re invited', it: 'Sei invitato', de: 'Sie sind eingeladen' },
  replySent: { en: 'Reply sent', it: 'Risposta mandata', de: 'Antwort gesendet' },
  guests: {
    en: (count: number) => (count === 1 ? 'One guest' : `${count} guests`),
    it: (count: number) => (count === 1 ? 'Un invitato' : `${count} invitati`),
    de: (count: number) => (count === 1 ? 'Ein Gast' : `${count} Gäste`)
  },
  prepare: { en: 'To prepare', it: 'Per prepararti', de: 'Zur Vorbereitung' },
  putBySegretario: {
    en: 'Put in the calendar by the Segretario',
    it: 'Messo in calendario dal Segretario',
    de: 'Vom Segretario in den Kalender eingetragen'
  },
  openSource: {
    en: 'Open the email it comes from',
    it: 'Apri la mail da cui viene',
    de: 'E-Mail öffnen, aus der er stammt'
  },
  ignore: { en: 'Ignore', it: 'Ignora', de: 'Ignorieren' },
  edit: { en: 'Edit', it: 'Modifica', de: 'Bearbeiten' },
  deleteTitle: {
    en: (title: string) => `Delete “${title}”?`,
    it: (title: string) => `Eliminare «${title}»?`,
    de: (title: string) => `„${title}“ löschen?`
  },
  deleteGuests: {
    en: 'The guests get the cancellation.',
    it: 'Gli invitati ricevono la cancellazione.',
    de: 'Die Gäste erhalten die Absage.'
  },
  deleteAlone: {
    en: 'It comes off the calendar.',
    it: 'Lo togli dal calendario.',
    de: 'Er wird aus dem Kalender entfernt.'
  },
  delete: { en: 'Delete', it: 'Elimina', de: 'Löschen' },
  deleted: { en: 'Event deleted', it: 'Evento eliminato', de: 'Termin gelöscht' },
  openInProvider: {
    en: 'Open in the provider’s calendar',
    it: 'Apri nel calendario del fornitore',
    de: 'Im Kalender des Anbieters öffnen'
  }
})

/** The answers the panel gives, as its buttons say them. */
const ANSWER_LABELS = defineMessages({
  accepted: { en: 'Yes', it: 'Partecipo', de: 'Zusagen' },
  tentative: { en: 'Maybe', it: 'Forse', de: 'Vielleicht' },
  declined: { en: 'No', it: 'No', de: 'Absagen' }
}) satisfies Record<Exclude<CalendarResponse, 'needsAction'>, unknown>

/** Each guest's answer, beside their name. */
const GUEST_RESPONSES = defineMessages({
  accepted: { en: 'going', it: 'partecipi', de: 'zugesagt' },
  tentative: { en: 'maybe', it: 'forse', de: 'vielleicht' },
  declined: { en: 'not going', it: 'non partecipi', de: 'abgesagt' },
  needsAction: { en: 'no reply yet', it: 'da rispondere', de: 'noch keine Antwort' }
}) satisfies Record<CalendarResponse, unknown>

const DAY: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
/** Made when used: the hour is written as the region writes it now. */
const TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

/** When an event is, in words: "Thursday 5 November, 9:00–10:30", or its days for one all day. */
export function whenWords(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): string {
  const m = messagesNow(MESSAGES)
  const day = dateFormat(DAY)

  if (event.allDay) {
    const first = dayOfKey(event.start.slice(0, 10))
    const last = addDays(dayOfKey(event.end.slice(0, 10)), -1)
    return last.getTime() <= first.getTime()
      ? m.allDay(day.format(first))
      : m.fromTo(day.format(first), day.format(last))
  }

  const time = dateFormat(TIME())
  const start = new Date(event.start)
  const end = new Date(event.end)
  return start.toDateString() === end.toDateString()
    ? `${day.format(start)}, ${time.format(start)}–${time.format(end)}`
    : m.fromTo(
        `${day.format(start)} ${time.format(start)}`,
        `${day.format(end)} ${time.format(end)}`
      )
}

const RESPONSES: ReadonlyArray<{
  value: Exclude<CalendarResponse, 'needsAction'>
  icon: typeof Check
}> = [
  { value: 'accepted', icon: Check },
  { value: 'tentative', icon: HelpCircle },
  { value: 'declined', icon: X }
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
    toast.error(messagesNow(MESSAGES).messageGone)
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
  const m = useMessages(MESSAGES)
  const answers = useMessages(ANSWER_LABELS)
  const responses = useMessages(RESPONSE_LABELS)
  const guestResponses = useMessages(GUEST_RESPONSES)
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
      toast.error(m.failed, {
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
          label={m.close}
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
            {m.proposed}
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
            {m.joinCall}
          </Button>
        )}

        {event && event.myResponse !== null && (
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-[12px]">
              {event.organizer ? m.invitationFrom(event.organizer) : m.invited} ·{' '}
              <span
                className={cn(event.myResponse === 'needsAction' && 'text-urgent font-semibold')}
              >
                {responses[event.myResponse]}
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
                        m.replySent
                      )
                    }
                  >
                    {working === response.value ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Icon className="size-3.5" />
                    )}
                    {answers[response.value]}
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
              {m.guests(attendees.length)}
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
                      {guestResponses[attendee.response]}
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
              {m.prepare}
            </p>
            <LinkedWords
              text={prep.text}
              links={prep.links}
              className="text-foreground border-ai-line border-l-2 pl-2.5 text-[13.5px] leading-[1.5]"
            />
          </div>
        )}

        {aiOn && event && <EventWorkSection event={event} />}

        {aiOn && event?.origin && (
          <div className="bg-ai-soft/45 flex flex-col gap-1.5 rounded-[8px] px-3 py-2">
            <p className="text-ai flex items-center gap-1.5 text-[12px] font-semibold">
              <CompassStar className="text-ai-star size-3.5" />
              {m.putBySegretario}
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
                {m.openSource}
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
            {m.openSource}
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
              {m.ignore}
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
                    {m.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={working !== null}
                    onClick={() =>
                      void confirm({
                        title: m.deleteTitle(event.title),
                        description: attendees.length > 0 ? m.deleteGuests : m.deleteAlone,
                        confirmLabel: m.delete,
                        destructive: true
                      }).then(
                        (confirmed) =>
                          confirmed &&
                          void run(
                            'remove',
                            () => window.calendarApi.remove(event.key),
                            m.deleted
                          ).then(onClose)
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                    {m.delete}
                  </Button>
                </>
              )}
              <div className="flex-1" />
              {event.htmlLink && (
                <IconButton
                  label={m.openInProvider}
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
