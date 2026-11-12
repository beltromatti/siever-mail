import { toast } from 'sonner'

import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import { addDays, dateFormat, eventStartDay } from '@renderer/features/calendar/calendar-dates'
import { guestAddresses, whenWords } from '@renderer/features/calendar/event-words'
import { recurrenceWords } from '@renderer/features/calendar/recurrence-words'
import { useSeriesChoice } from '@renderer/features/calendar/series-choice'
import { eventProposalWords } from '@renderer/features/segretario/proposal-words'
import { IS_MAC, useShortcutOverrides } from '@renderer/lib/command-shortcuts'
import { hourStyle, messagesNow } from '@renderer/lib/i18n'
import {
  calendarKey,
  CALENDAR_ROLES,
  type CalendarEvent,
  type CalendarListEntry,
  type CalendarResponse,
  type CalendarRole,
  type EventChange
} from '@shared/calendar'
import { commandChord, findCommand } from '@shared/commands'
import { defineMessages } from '@shared/i18n'
import type { MessageRef } from '@shared/models'
import type { Commitment, DayLine } from '@shared/segretario'
import { commitmentContextMenu, undoTick } from '@renderer/features/segretario/commitment-row'
import { dayLineLink } from '@renderer/features/segretario/day-line-source'
import { useWorkWords } from '@renderer/features/segretario/work-words'

import {
  calendarMenuItems,
  canEditEvent,
  dayMenuItems,
  eventMenuChoice,
  eventMenuItems,
  moveMenuItems,
  proposalMenuItems,
  slotMenuItems
} from './calendar-menus'
import type { EditorTarget } from './event-editor'
import type { ProposedEvent } from './use-calendar-data'

const MESSAGES = defineMessages({
  failed: { en: 'That didn’t work', it: 'Non è andata', de: 'Das hat nicht geklappt' },
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
  deleteRepeats: {
    en: (then: string) => `It repeats: delete this event only, or the whole series? ${then}`,
    it: (then: string) => `Si ripete: elimini solo questo evento o tutta la serie? ${then}`,
    de: (then: string) =>
      `Er wiederholt sich: nur diesen Termin löschen oder die ganze Serie? ${then}`
  },
  delete: { en: 'Delete', it: 'Elimina', de: 'Löschen' },
  deleted: { en: 'Event deleted', it: 'Evento eliminato', de: 'Termin gelöscht' },
  seriesDeleted: { en: 'Series deleted', it: 'Serie eliminata', de: 'Serie gelöscht' },
  notDeleted: {
    en: 'The event was not deleted',
    it: 'L’evento non è stato eliminato',
    de: 'Der Termin wurde nicht gelöscht'
  },
  respondTitle: {
    en: (title: string) => `Answer “${title}”?`,
    it: (title: string) => `Rispondere a «${title}»?`,
    de: (title: string) => `„${title}“ beantworten?`
  },
  respondSeries: {
    en: 'It repeats: is the answer for this event only, or for the whole series? The organizer is told.',
    it: 'Si ripete: la risposta vale solo per questo evento o per tutta la serie? Chi lo organizza lo saprà.',
    de: 'Er wiederholt sich: Gilt die Antwort nur für diesen Termin oder für die ganze Serie? Wer ihn organisiert, erfährt es.'
  },
  replySent: { en: 'Reply sent', it: 'Risposta mandata', de: 'Antwort gesendet' },
  moveTitle: {
    en: (title: string) => `Move “${title}”?`,
    it: (title: string) => `Spostare «${title}»?`,
    de: (title: string) => `„${title}“ verschieben?`
  },
  guestsUpdated: {
    en: 'The guests get the update.',
    it: 'Gli invitati ricevono l’aggiornamento.',
    de: 'Die Gäste erhalten die Aktualisierung.'
  },
  rescheduleSeries: {
    en: (then: string) =>
      `It repeats: move this event only, or the whole series by as much? ${then}`,
    it: (then: string) =>
      `Si ripete: sposti solo questo evento o tutta la serie, di altrettanto? ${then}`,
    de: (then: string) =>
      `Er wiederholt sich: nur diesen Termin verschieben oder die ganze Serie um ebenso viel? ${then}`
  },
  move: { en: 'Move', it: 'Sposta', de: 'Verschieben' },
  notMoved: {
    en: 'The event was not moved',
    it: 'L’evento non è stato spostato',
    de: 'Der Termin wurde nicht verschoben'
  },
  moveSeriesTitle: {
    en: (title: string, calendar: string) => `Move “${title}” to “${calendar}”?`,
    it: (title: string, calendar: string) => `Spostare «${title}» in «${calendar}»?`,
    de: (title: string, calendar: string) => `„${title}“ nach „${calendar}“ verschieben?`
  },
  moveSeries: {
    en: 'It repeats: the whole series moves, as the calendars move a series.',
    it: 'Si ripete: si sposta tutta la serie, come i calendari spostano una serie.',
    de: 'Er wiederholt sich: Die ganze Serie wird verschoben, so wie Kalender eine Serie verschieben.'
  },
  movedTo: {
    en: (calendar: string) => `Moved to “${calendar}”`,
    it: (calendar: string) => `Spostato in «${calendar}»`,
    de: (calendar: string) => `Nach „${calendar}“ verschoben`
  },
  copied: { en: 'Copied', it: 'Copiato', de: 'Kopiert' },
  copyFailed: {
    en: 'It couldn’t be copied',
    it: 'Non si è potuto copiare',
    de: 'Konnte nicht kopiert werden'
  },
  notSaved: { en: 'It was not saved', it: 'Non è stato salvato', de: 'Es wurde nicht gespeichert' },
  messageGone: {
    en: 'The message is no longer in the mail',
    it: 'Il messaggio non è più nella posta',
    de: 'Die Nachricht ist nicht mehr im Postfach'
  },
  notDone: {
    en: 'The proposal was not carried out',
    it: 'La proposta non è stata eseguita',
    de: 'Der Vorschlag wurde nicht ausgeführt'
  },
  notSetAside: {
    en: 'The proposal was not set aside',
    it: 'La proposta non è stata messa da parte',
    de: 'Der Vorschlag wurde nicht beiseitegelegt'
  },
  markDone: { en: 'Mark as done', it: 'Segna come fatta', de: 'Als erledigt markieren' },
  markArrived: {
    en: 'Mark as arrived',
    it: 'Segna come arrivato',
    de: 'Als eingetroffen markieren'
  },
  markedDone: { en: 'Marked as done', it: 'Segnata come fatta', de: 'Als erledigt markiert' },
  markedArrived: {
    en: 'Marked as arrived',
    it: 'Segnato come arrivato',
    de: 'Als eingetroffen markiert'
  },
  undo: { en: 'Undo', it: 'Annulla', de: 'Rückgängig' },
  notChanged: { en: 'Not changed', it: 'Non è cambiata', de: 'Nicht geändert' },
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  calendarsNotChanged: {
    en: 'The calendars were not changed',
    it: 'I calendari non sono cambiati',
    de: 'Die Kalender wurden nicht geändert'
  }
})

/** A message to write about an event, to whoever is in it: in the Posta, from its connection's mailbox when it has one. */
export interface CalendarMailRequest {
  to: string[]
  subject: string
  /** The calendar connection the event is in: its mailbox writes, when it came with one. */
  connectionId: string
}

/** What the Calendario gives its actions to act with. */
export interface CalendarActionsHost {
  calendars: CalendarListEntry[] | null
  aiOn: boolean
  /** An event, on its day, its panel open. */
  show: (event: CalendarEvent) => void
  /** A proposal of the Segretario's, its panel open. */
  showProposal: (proposed: ProposedEvent) => void
  openEditor: (target: EditorTarget) => void
  /** An event taken away — null — or now under another key, moved: what shows it follows. */
  replaced: (key: string, now: CalendarEvent | null) => void
  /** An event dragged elsewhere, shown there until the calendars say it is; null when it did not move. */
  showMoved: (event: CalendarEvent | null) => void
  setHidden: (key: string, hidden: boolean) => void
  setRole: (key: string, role: CalendarRole | null) => Promise<void>
  goToDay: (day: Date) => void
  /** How long a new event lasts. */
  newEventMinutes: number
  /** A new event in a calendar, on the day in sight. */
  newEventIn: (calendarKey: string) => void
  openLine: (line: DayLine) => void
  openMessage: (ref: MessageRef) => void
  /** Impostazioni › Connessioni. */
  openConnections: () => void
  /** A message to the guests, in the Posta; absent without a mailbox. */
  writeTo?: (request: CalendarMailRequest) => void
  /** The Segretario's panel, on the event in sight; absent with the AI off. */
  askSegretario?: (event: CalendarEvent) => void
  /** Asks the Segretario for a reminder to who is awaited; absent where it cannot be asked. */
  remind?: (commitment: Commitment) => void
}

/** What the Calendario does with its things (`useCalendarActions`). */
export interface CalendarActions {
  remove: (event: CalendarEvent) => Promise<void>
  respond: (
    event: CalendarEvent,
    response: Exclude<CalendarResponse, 'needsAction'>
  ) => Promise<void>
  reschedule: (
    event: CalendarEvent,
    change: Required<Pick<EventChange, 'start' | 'end'>>
  ) => Promise<void>
  move: (event: CalendarEvent, calendarKey: string) => Promise<void>
  edit: (event: CalendarEvent) => void
  duplicate: (event: CalendarEvent) => void
  writeToGuests: (event: CalendarEvent) => void
  copy: (text: string) => void
  setYours: (event: CalendarEvent, yours: boolean) => Promise<void>
  decideProposal: (proposed: ProposedEvent, accepted: boolean) => Promise<void>
  /** A proposed event in the editor, to change before adding it. */
  editProposal: (proposed: ProposedEvent) => void
  /** The message something came from, when it is still in the mail. */
  openSource: (accountId: string | null, messageKey: string | null) => Promise<void>
  eventMenu: (event: CalendarEvent) => Promise<void>
  moveMenu: (event: CalendarEvent) => Promise<void>
  proposalMenu: (proposed: ProposedEvent) => Promise<void>
  dueMenu: (line: DayLine) => Promise<void>
  slotMenu: (day: Date, minute: number) => Promise<void>
  dayMenu: (day: Date) => Promise<void>
  calendarMenu: (calendar: CalendarListEntry) => Promise<void>
  /** A question of the actions is on screen: the keys rest. */
  asking: boolean
  /** The questions the actions ask, rendered once. */
  dialogs: React.JSX.Element
}

/** Opens the message something came from, when it is still in the mail. */
async function openSource(
  accountId: string | null,
  messageKey: string | null,
  openMessage: (ref: MessageRef) => void
): Promise<void> {
  const ref =
    accountId && messageKey ? await window.segretarioApi.replySource(accountId, messageKey) : null

  if (ref) {
    openMessage(ref)
  } else {
    toast.error(messagesNow(MESSAGES).messageGone)
  }
}

/** Something that went wrong, told as it went. */
function failed(title: string, error: unknown): void {
  toast.error(title, { description: error instanceof Error ? error.message : undefined })
}

/** A minute of a day as the region's clock writes it: "10:30", "10:30 AM". */
function timeOfDay(day: Date, minute: number): string {
  return dateFormat({ hour: hourStyle(), minute: '2-digit' }).format(
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute)
  )
}

/**
 * What the Calendario does with its things, the same from the panel, a
 * right click and the keyboard (vision §7.3): an event opened, changed,
 * copied, moved to another calendar or to another time, answered, written
 * about, copied out, taken away — an instance asking whether alone or with
 * its series —; a proposal accepted, changed first or set aside; an empty
 * hour, a day, a calendar of the sidebar. `dialogs` is rendered once.
 */
export function useCalendarActions(host: CalendarActionsHost): CalendarActions {
  const { confirm, dialog: confirmDialog, open: confirmOpen } = useConfirmDialog()
  const seriesChoice = useSeriesChoice()
  const workWords = useWorkWords()
  const overrides = useShortcutOverrides()
  const { calendars } = host

  const chordOf = (id: string): string | undefined => {
    const command = findCommand(id)
    return command ? commandChord(command, overrides) : undefined
  }

  /** Takes an event away, once the user says so — of an instance, alone or with its series. */
  const remove = async (event: CalendarEvent): Promise<void> => {
    const m = messagesNow(MESSAGES)

    if (!canEditEvent(event, calendars)) {
      return
    }

    const then = event.attendees.some((attendee) => !attendee.self) ? m.deleteGuests : m.deleteAlone
    let series = false

    if (event.seriesId !== null) {
      const answer = await seriesChoice.ask({
        title: m.deleteTitle(event.title),
        description: m.deleteRepeats(then),
        destructive: true
      })

      if (!answer) {
        return
      }

      series = answer === 'series'
    } else if (
      !(await confirm({
        title: m.deleteTitle(event.title),
        description: then,
        confirmLabel: m.delete,
        destructive: true
      }))
    ) {
      return
    }

    try {
      await window.calendarApi.remove(event.key, series ? { series } : undefined)
      host.replaced(event.key, null)
      toast(series ? m.seriesDeleted : m.deleted, { description: event.title })
    } catch (error) {
      failed(m.notDeleted, error)
    }
  }

  /** Answers an invitation — of an instance, for it alone or for the series — and the organizer is told. */
  const respond = async (
    event: CalendarEvent,
    response: Exclude<CalendarResponse, 'needsAction'>
  ): Promise<void> => {
    const m = messagesNow(MESSAGES)
    let series = false

    if (event.seriesId !== null) {
      const answer = await seriesChoice.ask({
        title: m.respondTitle(event.title),
        description: m.respondSeries
      })

      if (!answer) {
        return
      }

      series = answer === 'series'
    }

    try {
      await window.calendarApi.respond(event.key, response, series ? { series } : undefined)
      toast(m.replySent)
    } catch (error) {
      failed(m.failed, error)
    }
  }

  /**
   * An event dragged to another time: whoever is invited is told, once the
   * user says so; an instance asks whether the series moves by as much.
   */
  const reschedule = async (
    event: CalendarEvent,
    change: Required<Pick<EventChange, 'start' | 'end'>>
  ): Promise<void> => {
    const m = messagesNow(MESSAGES)
    const guests = event.attendees.some((attendee) => !attendee.self)
    let series = false

    if (event.seriesId !== null) {
      const answer = await seriesChoice.ask({
        title: m.moveTitle(event.title),
        description: m.rescheduleSeries(guests ? m.guestsUpdated : '').trim()
      })

      if (!answer) {
        return
      }

      series = answer === 'series'
    } else if (
      guests &&
      !(await confirm({
        title: m.moveTitle(event.title),
        description: m.guestsUpdated,
        confirmLabel: m.move
      }))
    ) {
      return
    }

    host.showMoved({ ...event, ...change })

    try {
      await window.calendarApi.update(event.key, change, series ? { series } : undefined)
    } catch (error) {
      host.showMoved(null)
      failed(m.notMoved, error)
    }
  }

  /** Moves an event to another calendar (vision §7.5): an instance goes with its series, said first. */
  const move = async (event: CalendarEvent, to: string): Promise<void> => {
    const m = messagesNow(MESSAGES)
    const target = calendars?.find((calendar) => calendar.key === to)

    if (!target || to === calendarKey(event.connectionId, event.calendarId)) {
      return
    }

    const series = event.seriesId !== null

    if (
      series &&
      !(await confirm({
        title: m.moveSeriesTitle(event.title, target.name),
        description: m.moveSeries,
        confirmLabel: m.move
      }))
    ) {
      return
    }

    try {
      const moved = await window.calendarApi.update(
        event.key,
        { calendarKey: to },
        series ? { series } : undefined
      )
      host.replaced(event.key, moved)
      toast(m.movedTo(target.name), { description: event.title })
    } catch (error) {
      failed(m.notMoved, error)
    }
  }

  const copy = (text: string): void => {
    const m = messagesNow(MESSAGES)
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(m.copied, { description: text }))
      .catch(() => toast.error(m.copyFailed))
  }

  /** An event's title, when it is and how it repeats: what «Titolo e orario» copies. */
  const summaryOf = (event: CalendarEvent): string => {
    const when = whenWords(event)
    const repeats = event.recurrence
      ? recurrenceWords(event.recurrence, eventStartDay(event))
      : null

    return [event.title, when.charAt(0).toLocaleUpperCase() + when.slice(1), repeats]
      .filter(Boolean)
      .join('\n')
  }

  const setYours = async (event: CalendarEvent, yours: boolean): Promise<void> => {
    try {
      await window.segretarioApi.setEventYours(event.key, yours)
    } catch (error) {
      failed(messagesNow(MESSAGES).notSaved, error)
    }
  }

  const edit = (event: CalendarEvent): void => {
    if (canEditEvent(event, calendars)) {
      host.openEditor({ mode: 'edit', event })
    }
  }

  const duplicate = (event: CalendarEvent): void => {
    if (calendars?.some((calendar) => calendar.writable)) {
      host.openEditor({ mode: 'duplicate', event })
    }
  }

  const writeToGuests = (event: CalendarEvent): void =>
    host.writeTo?.({
      to: guestAddresses(event),
      subject: event.title,
      connectionId: event.connectionId
    })

  /** The right click on an event: every command, as the Posta's on a message. */
  const eventMenu = async (event: CalendarEvent): Promise<void> => {
    if (!calendars) {
      return
    }

    // Whose it is, where a word counts: the menu offers the other word.
    const whose = host.aiOn
      ? await window.segretarioApi
          .eventWork(event.key)
          .then((work) => work.whose)
          .catch(() => null)
      : null
    const deleteChord = chordOf('calendar-delete-event')
    const chosen = await window.mailApi.showContextMenu(
      eventMenuItems(event, {
        calendars,
        aiOn: host.aiOn,
        whose,
        canWriteMail: host.writeTo !== undefined,
        canAsk: host.askSegretario !== undefined,
        chords: {
          edit: chordOf('calendar-edit-event'),
          duplicate: chordOf('calendar-duplicate-event'),
          // Backspace is a Mac keyboard's delete key; elsewhere the Delete key says it.
          delete: deleteChord === 'Backspace' && !IS_MAC ? 'Delete' : deleteChord
        }
      })
    )
    const choice = chosen ? eventMenuChoice(chosen) : null

    switch (choice?.kind) {
      case 'open':
        host.show(event)
        return
      case 'edit':
        edit(event)
        return
      case 'duplicate':
        duplicate(event)
        return
      case 'move':
        await move(event, choice.calendarKey)
        return
      case 'respond':
        await respond(event, choice.response)
        return
      case 'join':
        if (event.meetLink) {
          void window.mailApi.openExternalUrl(event.meetLink)
        }
        return
      case 'write':
        writeToGuests(event)
        return
      case 'copy':
        copy(
          choice.what === 'summary'
            ? summaryOf(event)
            : choice.what === 'call'
              ? (event.meetLink ?? '')
              : (event.location ?? '')
        )
        return
      case 'provider':
        if (event.htmlLink) {
          void window.mailApi.openExternalUrl(event.htmlLink)
        }
        return
      case 'mine':
      case 'not-mine':
        await setYours(event, choice.kind === 'mine')
        return
      case 'ask':
        host.askSegretario?.(event)
        return
      case 'delete':
        await remove(event)
        return
    }
  }

  /** «Sposta in…» of the panel: the calendars it can go to, as the right click lists them. */
  const moveMenu = async (event: CalendarEvent): Promise<void> => {
    if (!calendars) {
      return
    }

    const chosen = await window.mailApi.showContextMenu(moveMenuItems(event, calendars))
    const choice = chosen ? eventMenuChoice(chosen) : null

    if (choice?.kind === 'move') {
      await move(event, choice.calendarKey)
    }
  }

  /** Accepts a proposal as the Segretario wrote it, or sets it aside. */
  const decideProposal = async (proposed: ProposedEvent, accepted: boolean): Promise<void> => {
    const m = messagesNow(MESSAGES)
    const { proposal } = proposed

    try {
      await window.segretarioApi.decideProposal(proposal.id, accepted, undefined, proposal.revision)

      if (accepted) {
        toast(eventProposalWords(proposal).done, { description: proposed.title })
      }
    } catch (error) {
      failed(accepted ? m.notDone : m.notSetAside, error)
    }
  }

  const openSourceOf = (accountId: string | null, messageKey: string | null): Promise<void> =>
    openSource(accountId, messageKey, host.openMessage)

  const editProposal = (proposed: ProposedEvent): void =>
    host.openEditor({ mode: 'proposal', proposed })

  /** The right click on a proposal: what its card offers. */
  const proposalMenu = async (proposed: ProposedEvent): Promise<void> => {
    const chosen = await window.mailApi.showContextMenu(proposalMenuItems(proposed))

    switch (chosen) {
      case 'open':
        host.showProposal(proposed)
        return
      case 'accept':
      case 'ignore':
        await decideProposal(proposed, chosen === 'accept')
        return
      case 'edit':
        editProposal(proposed)
        return
      case 'source':
        await openSourceOf(proposed.proposal.accountId, proposed.proposal.messageKey)
        return
    }
  }

  /** A deadline ticked off from its menu — it has no box of its own —, with an undo. */
  const tick = async (commitment: Commitment): Promise<void> => {
    const m = messagesNow(MESSAGES)

    try {
      await window.segretarioApi.setCommitmentStatus(commitment.id, 'fatta')
      toast(commitment.kind === 'aspetti' ? m.markedArrived : m.markedDone, {
        description: commitment.text,
        action: { label: m.undo, onClick: () => undoTick(commitment.id) }
      })
    } catch (error) {
      failed(m.notChanged, error)
    }
  }

  /**
   * The right click on a deadline: an open thing's own menu, as everywhere
   * (vision §10.1) — where it comes from, put off, not needed, rewritten,
   * corrected or answered in words — with its tick first; a reply prepared,
   * where it comes from.
   */
  const dueMenu = async (line: DayLine): Promise<void> => {
    const m = messagesNow(MESSAGES)
    const link = dayLineLink(line)
    const { commitment } = line
    const menu = commitment
      ? commitmentContextMenu(commitment, {
          words: workWords,
          onRemind: host.remind,
          onOpenSource: link ? () => host.openLine(line) : undefined
        })
      : null
    const chosen = await window.mailApi.showContextMenu([
      ...(commitment?.status === 'aperta'
        ? [
            {
              id: 'tick',
              label: commitment.kind === 'aspetti' ? m.markArrived : m.markDone
            },
            { type: 'separator' as const }
          ]
        : []),
      ...(menu ? menu.items : link ? [{ id: 'open', label: m.open }] : [])
    ])

    if (!chosen) {
      return
    }

    if (chosen === 'tick' && commitment) {
      await tick(commitment)
    } else if (menu) {
      await menu.run(chosen)
    } else if (chosen === 'open') {
      host.openLine(line)
    }
  }

  const canWrite = Boolean(calendars?.some((calendar) => calendar.writable))

  /** The right click on an empty hour: a new event there, or one all day. */
  const slotMenu = async (day: Date, minute: number): Promise<void> => {
    if (!canWrite) {
      return
    }

    const chosen = await window.mailApi.showContextMenu(slotMenuItems(timeOfDay(day, minute)))
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute).getTime()

    if (chosen === 'new') {
      host.openEditor({
        mode: 'new',
        start,
        end: start + host.newEventMinutes * 60_000,
        allDay: false
      })
    } else if (chosen === 'new-all-day') {
      host.openEditor({
        mode: 'new',
        start: day.getTime(),
        end: addDays(day, 1).getTime(),
        allDay: true
      })
    }
  }

  /** The right click on a day: a new event on it, or the day. */
  const dayMenu = async (day: Date): Promise<void> => {
    const chosen = await window.mailApi.showContextMenu(dayMenuItems(canWrite))

    if (chosen === 'new') {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).getTime()
      host.openEditor({
        mode: 'new',
        start,
        end: start + host.newEventMinutes * 60_000,
        allDay: false
      })
    } else if (chosen === 'new-all-day') {
      host.openEditor({
        mode: 'new',
        start: day.getTime(),
        end: addDays(day, 1).getTime(),
        allDay: true
      })
    } else if (chosen === 'go') {
      host.goToDay(day)
    }
  }

  /** The right click on a calendar of the sidebar. */
  const calendarMenu = async (calendar: CalendarListEntry): Promise<void> => {
    if (!calendars) {
      return
    }

    const chosen = await window.mailApi.showContextMenu(
      calendarMenuItems(calendar, calendars, host.aiOn)
    )

    if (!chosen) {
      return
    }

    if (chosen.startsWith('role:')) {
      const role = chosen.slice('role:'.length)
      await host
        .setRole(
          calendar.key,
          CALENDAR_ROLES.includes(role as CalendarRole) ? (role as CalendarRole) : null
        )
        .catch((error: unknown) => failed(messagesNow(MESSAGES).calendarsNotChanged, error))
      return
    }

    switch (chosen) {
      case 'show-only':
        for (const other of calendars) {
          if (other.key === calendar.key ? other.hidden : !other.hidden) {
            host.setHidden(other.key, other.key !== calendar.key)
          }
        }
        return
      case 'show-all':
        for (const other of calendars.filter((entry) => entry.hidden)) {
          host.setHidden(other.key, false)
        }
        return
      case 'toggle':
        host.setHidden(calendar.key, !calendar.hidden)
        return
      case 'new':
        host.newEventIn(calendar.key)
        return
      case 'sync':
        void window.calendarApi
          .syncNow()
          .catch((error: unknown) => failed(messagesNow(MESSAGES).failed, error))
        return
      case 'settings':
        host.openConnections()
        return
    }
  }

  return {
    remove,
    respond,
    reschedule,
    move,
    edit,
    duplicate,
    writeToGuests,
    copy,
    setYours,
    decideProposal,
    editProposal,
    openSource: openSourceOf,
    eventMenu,
    moveMenu,
    proposalMenu,
    dueMenu,
    slotMenu,
    dayMenu,
    calendarMenu,
    asking: confirmOpen || seriesChoice.open,
    dialogs: (
      <>
        {confirmDialog}
        {seriesChoice.dialog}
        {workWords.dialogs}
      </>
    )
  }
}
