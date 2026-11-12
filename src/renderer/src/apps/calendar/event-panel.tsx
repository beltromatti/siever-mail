import { useState } from 'react'
import {
  Bell,
  CalendarDays,
  Check,
  Copy,
  CopyPlus,
  ExternalLink,
  HelpCircle,
  Info,
  LoaderCircle,
  Mail,
  MapPin,
  MoreHorizontal,
  PenLine,
  Repeat,
  Trash2,
  Users,
  Video,
  X
} from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { eventStartDay } from '@renderer/features/calendar/calendar-dates'
import { descriptionParts } from '@renderer/features/calendar/description-text'
import { keptByWords, openInProviderWords } from '@renderer/features/calendar/event-limits'
import { RESPONSE_LABELS } from '@renderer/features/calendar/event-line'
import { guestAddresses, whenWords } from '@renderer/features/calendar/event-words'
import { isRecurrence } from '@renderer/features/calendar/recurrence'
import { recurrenceWords, remindersWords } from '@renderer/features/calendar/recurrence-words'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent, CalendarListEntry, CalendarResponse } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import { eventProposalWords } from '@renderer/features/segretario/proposal-words'

import { canEditEvent, isInvitation, proposesNewEvent } from './calendar-menus'
import { dotStyle } from './event-style'
import { EventPrepSection, EventWorkSection } from './event-work'
import type { CalendarActions } from './use-calendar-actions'
import type { ProposedEvent } from './use-calendar-data'

const MESSAGES = defineMessages({
  close: { en: 'Close', it: 'Chiudi', de: 'Schließen' },
  more: { en: 'More', it: 'Altro', de: 'Mehr' },
  proposed: {
    en: 'Proposed by the Segretario: you decide whether to put it in the calendar.',
    it: 'Proposto dal Segretario: decidi tu se metterlo in calendario.',
    de: 'Vom Segretario vorgeschlagen: Sie entscheiden, ob er in den Kalender kommt.'
  },
  moveTo: { en: 'Move to…', it: 'Sposta in…', de: 'Verschieben nach…' },
  copyPlace: { en: 'Copy the location', it: 'Copia il luogo', de: 'Ort kopieren' },
  joinCall: { en: 'Join the call', it: 'Entra nella call', de: 'Dem Anruf beitreten' },
  copyCall: {
    en: 'Copy the call’s link',
    it: 'Copia il link della call',
    de: 'Link zum Anruf kopieren'
  },
  invitationFrom: {
    en: (organizer: string) => `Invitation from ${organizer}`,
    it: (organizer: string) => `Invito di ${organizer}`,
    de: (organizer: string) => `Einladung von ${organizer}`
  },
  invited: { en: 'You’re invited', it: 'Sei invitato', de: 'Sie sind eingeladen' },
  guests: {
    en: (count: number) => (count === 1 ? 'One guest' : `${count} guests`),
    it: (count: number) => (count === 1 ? 'Un invitato' : `${count} invitati`),
    de: (count: number) => (count === 1 ? 'Ein Gast' : `${count} Gäste`)
  },
  organizer: { en: 'organizer', it: 'organizza', de: 'organisiert' },
  writeToGuests: {
    en: 'Write to the guests',
    it: 'Scrivi ai partecipanti',
    de: 'An die Teilnehmenden schreiben'
  },
  reminders: { en: 'Reminders', it: 'Promemoria', de: 'Erinnerungen' },
  description: { en: 'Description', it: 'Descrizione', de: 'Beschreibung' },
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
  editAndAdd: {
    en: 'Edit and add…',
    it: 'Modifica e aggiungi…',
    de: 'Bearbeiten und hinzufügen…'
  },
  ignore: { en: 'Ignore', it: 'Ignora', de: 'Ignorieren' },
  edit: { en: 'Edit', it: 'Modifica', de: 'Bearbeiten' },
  duplicate: { en: 'Duplicate', it: 'Duplica', de: 'Duplizieren' },
  delete: { en: 'Delete', it: 'Elimina', de: 'Löschen' }
})

/** The answers the panel gives, as its buttons say them. */
const ANSWER_LABELS = defineMessages({
  accepted: { en: 'Yes', it: 'Partecipo', de: 'Zusagen' },
  tentative: { en: 'Maybe', it: 'Forse', de: 'Vielleicht' },
  declined: { en: 'No', it: 'No', de: 'Absagen' }
}) satisfies Record<Exclude<CalendarResponse, 'needsAction'>, unknown>

/** Each guest's answer, beside their name. */
const GUEST_RESPONSES = defineMessages({
  accepted: { en: 'going', it: 'partecipa', de: 'zugesagt' },
  tentative: { en: 'maybe', it: 'forse', de: 'vielleicht' },
  declined: { en: 'not going', it: 'non partecipa', de: 'abgesagt' },
  needsAction: { en: 'no reply yet', it: 'non ha risposto', de: 'noch keine Antwort' }
}) satisfies Record<CalendarResponse, unknown>

const RESPONSES: ReadonlyArray<{
  value: Exclude<CalendarResponse, 'needsAction'>
  icon: typeof Check
}> = [
  { value: 'accepted', icon: Check },
  { value: 'tentative', icon: HelpCircle },
  { value: 'declined', icon: X }
]

/** A description's words, its links opening in the browser. */
function Description({ text }: { text: string }): React.JSX.Element {
  const m = useMessages(MESSAGES)

  return (
    <p
      aria-label={m.description}
      className="text-muted-foreground max-h-72 shrink-0 overflow-y-auto text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap select-text"
    >
      {descriptionParts(text).map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            onClick={(click) => {
              click.preventDefault()
              void window.mailApi.openExternalUrl(part.href)
            }}
            className="text-foreground underline decoration-[hsl(var(--input))] underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </p>
  )
}

/** A line of the panel: an icon, what it says, what can be done with it. */
function Line({
  icon: Icon,
  children,
  className
}: {
  icon: typeof Check
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 items-start gap-2', className)}>
      <Icon className="text-faint-foreground mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">{children}</div>
    </div>
  )
}

/** The link that opens a message something came from. */
function SourceLink({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const m = useMessages(MESSAGES)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-foreground focus-visible:ring-ring/60 flex items-center gap-1.5 self-start rounded-sm text-[12px] outline-none hover:underline focus-visible:ring-2"
    >
      <Mail className="size-3.5" />
      {m.openSource}
    </button>
  )
}

/**
 * An event beside the calendar, as the reader is beside the mail (vision
 * §7.3): when, and how it repeats; its calendar, with where it can move;
 * where, the call, who organises and who is invited — with their answers,
 * and a message to them —; its reminders; what it says, with its links;
 * who keeps it, when another service does. Then the Segretario's part,
 * and what can be done: answer, change, copy, take away; the rest, a
 * right click's, under «⋯». A proposal of the Segretario's is added,
 * changed first, or set aside from here.
 */
export function EventPanel({
  event,
  proposed,
  calendar,
  calendars,
  aiOn,
  canWriteMail,
  actions,
  onClose
}: {
  event: CalendarEvent | null
  proposed: ProposedEvent | null
  calendar: CalendarListEntry | undefined
  calendars: ReadonlyArray<CalendarListEntry> | null
  aiOn: boolean
  /** A mailbox to write from, for «Scrivi ai partecipanti». */
  canWriteMail: boolean
  actions: CalendarActions
  onClose: () => void
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const answers = useMessages(ANSWER_LABELS)
  const responses = useMessages(RESPONSE_LABELS)
  const guestResponses = useMessages(GUEST_RESPONSES)
  const [working, setWorking] = useState<string | null>(null)
  const closeKeys = useCommandKeys('calendar-close-event')

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setWorking(label)

    try {
      await action()
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
  const editable = event !== null && canEditEvent(event, calendars)
  // Somewhere else to go: another calendar written in, for one that is the user's to move.
  const movable =
    event !== null &&
    editable &&
    !event.managedBy &&
    Boolean(calendars?.some((other) => other.writable && other.key !== calendar?.key))
  const canWriteToGuests = event !== null && canWriteMail && guestAddresses(event).length > 0
  const origin = event?.origin ?? null
  // How it repeats: the event's, or what the proposal would make of it.
  const repeats =
    event?.recurrence ??
    (proposed && isRecurrence(proposed.proposal.payload.recurrence)
      ? proposed.proposal.payload.recurrence
      : null)

  return (
    <aside aria-label={title} className="flex h-full min-h-0 w-[340px] shrink-0 flex-col border-l">
      <div className="flex items-start gap-1 border-b py-3 pr-2 pl-4">
        <span
          className="mt-1.5 mr-1 size-2.5 shrink-0 rounded-full"
          style={dotStyle(event ? (calendar?.color ?? null) : null)}
        />
        <h2
          className={cn(
            'min-w-0 flex-1 text-[16px] leading-snug font-semibold break-words',
            proposed && 'italic'
          )}
        >
          {title}
        </h2>
        {event && (
          <IconButton
            label={m.more}
            className="text-faint-foreground size-[26px] shrink-0"
            onClick={() => void actions.eventMenu(event)}
          >
            <MoreHorizontal className="size-4" />
          </IconButton>
        )}
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
        <div className="flex flex-col gap-1">
          <p className="text-foreground first-letter:uppercase">{whenWords(shown)}</p>
          {repeats && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
              <Repeat className="size-3.5 shrink-0" />
              {recurrenceWords(repeats, eventStartDay(shown))}
            </p>
          )}
        </div>

        {event?.managedBy && (
          <p className="text-muted-foreground bg-hover/60 flex items-start gap-2 rounded-[8px] px-3 py-2 text-[12px] leading-[1.45]">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {keptByWords(event.managedBy)}
          </p>
        )}

        {event && calendar && (
          <Line icon={CalendarDays} className="text-[12px]">
            <span className="text-muted-foreground min-w-0">
              {calendar.name}
              {calendar.connection && calendar.connection !== calendar.name
                ? ` · ${calendar.connection}`
                : ''}
            </span>
            {movable && (
              <button
                type="button"
                onClick={() => void actions.moveMenu(event)}
                className="text-foreground focus-visible:ring-ring/60 rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2"
              >
                {m.moveTo}
              </button>
            )}
          </Line>
        )}

        {proposed && (
          <p className="text-ai flex items-center gap-2 text-[12px] font-semibold">
            <CompassStar className="text-ai-star size-3.5" />
            {m.proposed}
          </p>
        )}

        {location && (
          <Line icon={MapPin}>
            <span className="min-w-0 break-words select-text">{location}</span>
            <IconButton
              label={m.copyPlace}
              className="text-faint-foreground -my-1 size-[22px]"
              onClick={() => actions.copy(location)}
            >
              <Copy className="size-3" />
            </IconButton>
          </Line>
        )}

        {event?.meetLink && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => event.meetLink && void window.mailApi.openExternalUrl(event.meetLink)}
            >
              <Video className="size-3.5" />
              {m.joinCall}
            </Button>
            <IconButton
              label={m.copyCall}
              className="text-faint-foreground size-[26px]"
              onClick={() => event.meetLink && actions.copy(event.meetLink)}
            >
              <Copy className="size-3.5" />
            </IconButton>
          </div>
        )}

        {event?.myResponse && isInvitation(event) && (
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
                      void run(response.value, () => actions.respond(event, response.value))
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
            <div className="text-muted-foreground flex items-center gap-2 text-[12px]">
              <Users className="size-3.5" />
              <span className="flex-1">{m.guests(attendees.length)}</span>
              {event && canWriteToGuests && (
                <button
                  type="button"
                  onClick={() => actions.writeToGuests(event)}
                  className="text-foreground focus-visible:ring-ring/60 flex items-center gap-1 rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2"
                >
                  <Mail className="size-3.5" />
                  {m.writeToGuests}
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-0.5 pl-5.5 text-[12.5px]">
              {attendees.map((attendee) => (
                <li
                  key={attendee.email}
                  title={attendee.email}
                  className="flex min-w-0 items-baseline gap-2"
                >
                  <span className="min-w-0 truncate">{attendee.name ?? attendee.email}</span>
                  {attendee.organizer && (
                    <span className="text-faint-foreground shrink-0 text-[11px]">
                      {m.organizer}
                    </span>
                  )}
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

        {event && (
          <Line icon={Bell} className="text-[12px]">
            <span className="text-muted-foreground min-w-0" title={m.reminders}>
              {remindersWords(event.reminders ?? null, event.allDay)}
            </span>
          </Line>
        )}

        {proposed && eventProposalWords(proposed.proposal).changes.length > 0 && (
          <ul className="text-foreground flex flex-col gap-0.5 text-[12.5px] leading-[1.5]">
            {eventProposalWords(proposed.proposal).changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {description && <Description text={description} />}

        {aiOn && event && <EventPrepSection eventKey={event.key} />}

        {aiOn && event && <EventWorkSection event={event} />}

        {aiOn && origin && (
          <div className="bg-ai-soft/45 flex flex-col gap-1.5 rounded-[8px] px-3 py-2">
            <p className="text-ai flex items-center gap-1.5 text-[12px] font-semibold">
              <CompassStar className="text-ai-star size-3.5" />
              {m.putBySegretario}
            </p>
            {origin.messageKey && (
              <SourceLink
                onOpen={() => void actions.openSource(origin.accountId, origin.messageKey)}
              />
            )}
          </div>
        )}

        {proposed?.proposal.messageKey && (
          <SourceLink
            onOpen={() =>
              void actions.openSource(proposed.proposal.accountId, proposed.proposal.messageKey)
            }
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-3">
        {proposed ? (
          <>
            <Button
              size="sm"
              disabled={working !== null}
              onClick={() =>
                void run('accept', () => actions.decideProposal(proposed, true)).then(onClose)
              }
            >
              {working === 'accept' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {eventProposalWords(proposed.proposal).action}
            </Button>
            {proposesNewEvent(proposed) && (
              <Button
                variant="outline"
                size="sm"
                disabled={working !== null}
                onClick={() => actions.editProposal(proposed)}
              >
                <PenLine className="size-3.5" />
                {m.editAndAdd}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={working !== null}
              onClick={() =>
                void run('ignore', () => actions.decideProposal(proposed, false)).then(onClose)
              }
            >
              {m.ignore}
            </Button>
          </>
        ) : (
          event && (
            <>
              {/* An invitation is answered, not changed: only what the user organises is theirs to edit. */}
              {editable && (
                <ActionTooltip label={m.edit} commandId="calendar-edit-event">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working !== null}
                    onClick={() => actions.edit(event)}
                  >
                    <PenLine className="size-3.5" />
                    {m.edit}
                  </Button>
                </ActionTooltip>
              )}
              <ActionTooltip label={m.duplicate} commandId="calendar-duplicate-event">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={working !== null || !calendars?.some((entry) => entry.writable)}
                  onClick={() => actions.duplicate(event)}
                >
                  <CopyPlus className="size-3.5" />
                  {m.duplicate}
                </Button>
              </ActionTooltip>
              {editable && (
                <ActionTooltip label={m.delete} commandId="calendar-delete-event">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hover:text-destructive"
                    disabled={working !== null}
                    onClick={() => void run('remove', () => actions.remove(event))}
                  >
                    <Trash2 className="size-3.5" />
                    {m.delete}
                  </Button>
                </ActionTooltip>
              )}
              <div className="flex-1" />
              {event.htmlLink && (
                <IconButton
                  label={openInProviderWords(calendar?.provider)}
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
    </aside>
  )
}
