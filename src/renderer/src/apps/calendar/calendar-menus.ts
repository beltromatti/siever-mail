import { messagesNow } from '@renderer/lib/i18n'
import {
  calendarKey,
  CALENDAR_ROLES,
  type CalendarEvent,
  type CalendarListEntry,
  type CalendarResponse
} from '@shared/calendar'
import type { ContextMenuItem } from '@shared/context-menu'
import { defineMessages } from '@shared/i18n'
import type { EventWhose } from '@shared/segretario'
import { ROLE_WORDS } from '@renderer/features/settings/notifications-section.messages'
import {
  moveBlocked,
  moveLimitWords,
  moveTargets,
  openInProviderWords
} from '@renderer/features/calendar/event-limits'
import { guestAddresses } from '@renderer/features/calendar/event-words'
import { eventProposalWords } from '@renderer/features/segretario/proposal-words'

import type { ProposedEvent } from './use-calendar-data'

/**
 * The Calendario's right-click menus, as the Posta's are (vision §7.3):
 * what can be done with an event, the calendars it can move to, an empty
 * hour, a day, a calendar of the sidebar — built here as native menus'
 * items, each with the chord of its command where it has one; the app
 * runs what is chosen.
 */

const MESSAGES = defineMessages({
  open: { en: 'Open', it: 'Apri', de: 'Öffnen' },
  edit: { en: 'Edit…', it: 'Modifica…', de: 'Bearbeiten…' },
  duplicate: { en: 'Duplicate', it: 'Duplica', de: 'Duplizieren' },
  moveTo: { en: 'Move to', it: 'Sposta in', de: 'Verschieben nach' },
  answer: {
    en: 'Answer the invitation',
    it: 'Rispondi all’invito',
    de: 'Einladung beantworten'
  },
  joinCall: { en: 'Join the call', it: 'Entra nella call', de: 'Dem Anruf beitreten' },
  writeToGuests: {
    en: 'Write to the guests',
    it: 'Scrivi ai partecipanti',
    de: 'An die Teilnehmenden schreiben'
  },
  copy: { en: 'Copy', it: 'Copia', de: 'Kopieren' },
  copySummary: { en: 'Title and time', it: 'Titolo e orario', de: 'Titel und Zeit' },
  copyCall: { en: 'The call’s link', it: 'Il link della call', de: 'Den Link zum Anruf' },
  copyPlace: { en: 'The location', it: 'Il luogo', de: 'Den Ort' },
  mine: { en: 'It’s mine', it: 'È mio', de: 'Das ist meiner' },
  notMine: { en: 'Not mine', it: 'Non è mio', de: 'Nicht meiner' },
  ask: { en: 'Ask the Segretario', it: 'Chiedi al Segretario', de: 'Den Segretario fragen' },
  delete: { en: 'Delete', it: 'Elimina', de: 'Löschen' },
  deleteSeries: { en: 'Delete…', it: 'Elimina…', de: 'Löschen…' },
  newEventAt: {
    en: (time: string) => `New event at ${time}`,
    it: (time: string) => `Nuovo evento alle ${time}`,
    de: (time: string) => `Neuer Termin um ${time}`
  },
  newEvent: { en: 'New event', it: 'Nuovo evento', de: 'Neuer Termin' },
  newAllDay: {
    en: 'New all-day event',
    it: 'Nuovo evento di tutto il giorno',
    de: 'Neuer ganztägiger Termin'
  },
  goToDay: { en: 'Go to the day', it: 'Vai al giorno', de: 'Zum Tag' },
  showOnly: { en: 'Show only this', it: 'Mostra solo questo', de: 'Nur diesen anzeigen' },
  showAll: { en: 'Show all', it: 'Mostra tutti', de: 'Alle anzeigen' },
  hide: { en: 'Hide', it: 'Nascondi', de: 'Ausblenden' },
  show: { en: 'Show', it: 'Mostra', de: 'Anzeigen' },
  newEventHere: {
    en: 'New event in this calendar',
    it: 'Nuovo evento in questo calendario',
    de: 'Neuer Termin in diesem Kalender'
  },
  whose: {
    en: 'Whose events are these',
    it: 'Di chi sono gli eventi',
    de: 'Wessen Termine'
  },
  letSegretarioDecide: {
    en: 'Let the Segretario decide',
    it: 'Lascia decidere al Segretario',
    de: 'Den Segretario entscheiden lassen'
  },
  restoreRole: { en: 'Go back to how it was', it: 'Torna a com’era', de: 'Zurücksetzen' },
  syncNow: {
    en: 'Refresh from the calendars',
    it: 'Aggiorna dai calendari',
    de: 'Aus den Kalendern aktualisieren'
  },
  editAndAdd: {
    en: 'Edit and add…',
    it: 'Modifica e aggiungi…',
    de: 'Bearbeiten und hinzufügen…'
  },
  ignore: { en: 'Ignore', it: 'Ignora', de: 'Ignorieren' },
  openSource: {
    en: 'Open the email it comes from',
    it: 'Apri la mail da cui viene',
    de: 'E-Mail öffnen, aus der er stammt'
  },
  openSettings: {
    en: 'Open in Settings',
    it: 'Apri nelle Impostazioni',
    de: 'In den Einstellungen öffnen'
  }
})

/** An invitation's answers, as its menu says them. */
const ANSWERS = defineMessages({
  accepted: { en: 'Accept', it: 'Partecipo', de: 'Zusagen' },
  tentative: { en: 'Maybe', it: 'Forse', de: 'Vielleicht' },
  declined: { en: 'Decline', it: 'Non partecipo', de: 'Absagen' }
}) satisfies Record<Exclude<CalendarResponse, 'needsAction'>, unknown>

const RESPONSES: ReadonlyArray<Exclude<CalendarResponse, 'needsAction'>> = [
  'accepted',
  'tentative',
  'declined'
]

/** What an item of the event's menu asks for. */
export type EventMenuChoice =
  | {
      kind:
        | 'open'
        | 'edit'
        | 'duplicate'
        | 'join'
        | 'write'
        | 'provider'
        | 'mine'
        | 'not-mine'
        | 'ask'
        | 'delete'
    }
  | { kind: 'move'; calendarKey: string }
  | { kind: 'respond'; response: Exclude<CalendarResponse, 'needsAction'> }
  | { kind: 'copy'; what: 'summary' | 'call' | 'place' }

const MOVE = 'move:'
const RESPOND = 'respond:'
const COPY = 'copy:'

/** The choice an item's id stands for; null for an id of no event menu. */
export function eventMenuChoice(id: string): EventMenuChoice | null {
  if (id.startsWith(MOVE)) {
    return { kind: 'move', calendarKey: id.slice(MOVE.length) }
  }

  if (id.startsWith(RESPOND)) {
    const response = id.slice(RESPOND.length)
    return RESPONSES.includes(response as (typeof RESPONSES)[number])
      ? { kind: 'respond', response: response as (typeof RESPONSES)[number] }
      : null
  }

  if (id.startsWith(COPY)) {
    const what = id.slice(COPY.length)
    return what === 'summary' || what === 'call' || what === 'place' ? { kind: 'copy', what } : null
  }

  const plain = [
    'open',
    'edit',
    'duplicate',
    'join',
    'write',
    'provider',
    'mine',
    'not-mine',
    'ask',
    'delete'
  ] as const
  const kind = plain.find((entry) => entry === id)
  return kind ? { kind } : null
}

/** The calendar an event is in, of those listed. */
function calendarOfEvent(
  event: Pick<CalendarEvent, 'connectionId' | 'calendarId'>,
  calendars: ReadonlyArray<CalendarListEntry>
): CalendarListEntry | undefined {
  const key = calendarKey(event.connectionId, event.calendarId)
  return calendars.find((calendar) => calendar.key === key)
}

/**
 * Whether the user may change an event here: in a calendar written in,
 * and not an invitation, which is answered. One another service keeps is
 * changed too — its reminders only (vision §7.5).
 */
export function canEditEvent(
  event: Pick<CalendarEvent, 'connectionId' | 'calendarId' | 'organizedByUser'>,
  calendars: ReadonlyArray<CalendarListEntry> | null
): boolean {
  return (
    Boolean(calendars && calendarOfEvent(event, calendars)?.writable) &&
    event.organizedByUser !== false
  )
}

/**
 * Whether the user may move an event in time by dragging it: one they
 * organise, in a calendar written in, that no other service keeps.
 */
export function canReschedule(
  event: Pick<CalendarEvent, 'connectionId' | 'calendarId' | 'organizedByUser' | 'managedBy'>,
  calendars: ReadonlyArray<CalendarListEntry> | null
): boolean {
  return (
    Boolean(calendars && calendarOfEvent(event, calendars)?.writable) &&
    event.organizedByUser === true &&
    !event.managedBy
  )
}

/** Whether an event is an invitation to the user, to answer. */
export function isInvitation(event: Pick<CalendarEvent, 'myResponse'>): boolean {
  return event.myResponse !== null
}

/**
 * The calendars an event can move to, by connection — each connection its
 * own submenu when there are several —, the one it is in marked; those it
 * cannot go to are there, disabled, with why. Where nothing can move it at
 * all (another service keeps it, someone else organises it), the reason
 * alone.
 */
export function moveMenuItems(
  event: CalendarEvent,
  calendars: ReadonlyArray<CalendarListEntry>
): ContextMenuItem[] {
  const targets = moveTargets(event, calendars).filter(
    (target) => !target.calendar.hidden || target.limit === 'same'
  )
  const blocked = moveBlocked(targets)

  if (blocked) {
    return [{ id: 'move-blocked', label: moveLimitWords(blocked, event), enabled: false }]
  }

  const connections = [...new Set(targets.map((target) => target.calendar.connectionId))]
  const itemsOf = (connectionId: string): ContextMenuItem[] => {
    const own = targets.filter((target) => target.calendar.connectionId === connectionId)
    const guests = own.some((target) => target.limit === 'guests')

    return [
      ...own.map((target): ContextMenuItem => ({
        id: `${MOVE}${target.calendar.key}`,
        label: target.calendar.name,
        enabled: target.limit === null,
        ...(target.limit === 'same' ? { checked: true } : {})
      })),
      ...(guests
        ? [
            { type: 'separator' } as const,
            { id: 'move-guests', label: moveLimitWords('guests', event), enabled: false }
          ]
        : [])
    ]
  }

  if (connections.length === 1) {
    return itemsOf(connections[0])
  }

  return connections.map((connectionId) => ({
    id: `connection:${connectionId}`,
    label: targets.find((target) => target.calendar.connectionId === connectionId)!.calendar
      .connection,
    submenu: itemsOf(connectionId)
  }))
}

/** What the event's menu knows beyond the event. */
export interface EventMenuContext {
  calendars: ReadonlyArray<CalendarListEntry>
  aiOn: boolean
  /** Whose the event is, where a word counts (§7.4); null where the calendar says it, or with the AI off. */
  whose: EventWhose | null
  /** A mailbox to write from: «Scrivi ai partecipanti» is there. */
  canWriteMail: boolean
  /** The Segretario's panel is there to ask. */
  canAsk: boolean
  /** The chords of the Calendario's commands, as the user set them. */
  chords: { edit?: string; duplicate?: string; delete?: string }
}

/**
 * An event's right-click menu, as complete as a message's: open, edit,
 * duplicate, move to another calendar; an invitation's answers; the call,
 * the guests, what to copy, the provider's own page; with the AI, whose it
 * is and the Segretario; and taking it away — an instance asking, after,
 * whether alone or with its series.
 */
export function eventMenuItems(event: CalendarEvent, context: EventMenuContext): ContextMenuItem[] {
  const m = messagesNow(MESSAGES)
  const answers = messagesNow(ANSWERS)
  const { calendars } = context
  const calendar = calendarOfEvent(event, calendars)
  const editable = canEditEvent(event, calendars)
  const move = calendar ? moveMenuItems(event, calendars) : []
  const guests = guestAddresses(event)

  return [
    { id: 'open', label: m.open },
    { type: 'separator' },
    { id: 'edit', label: m.edit, enabled: editable, chord: context.chords.edit },
    {
      id: 'duplicate',
      label: m.duplicate,
      enabled: calendars.some((entry) => entry.writable),
      chord: context.chords.duplicate
    },
    move.length > 0
      ? { id: 'move', label: m.moveTo, submenu: move }
      : { id: 'move', label: m.moveTo, enabled: false },
    { type: 'separator' },
    ...(isInvitation(event)
      ? [
          {
            id: 'answer',
            label: m.answer,
            submenu: RESPONSES.map((response) => ({
              id: `${RESPOND}${response}`,
              label: answers[response],
              checked: event.myResponse === response
            }))
          }
        ]
      : []),
    ...(event.meetLink ? [{ id: 'join', label: m.joinCall }] : []),
    ...(context.canWriteMail && guests.length > 0 ? [{ id: 'write', label: m.writeToGuests }] : []),
    { type: 'separator' },
    {
      id: 'copy',
      label: m.copy,
      submenu: [
        { id: `${COPY}summary`, label: m.copySummary },
        ...(event.meetLink ? [{ id: `${COPY}call`, label: m.copyCall }] : []),
        ...(event.location ? [{ id: `${COPY}place`, label: m.copyPlace }] : [])
      ]
    },
    ...(event.htmlLink ? [{ id: 'provider', label: openInProviderWords(calendar?.provider) }] : []),
    { type: 'separator' },
    ...(context.aiOn && context.whose
      ? [context.whose.yours ? { id: 'not-mine', label: m.notMine } : { id: 'mine', label: m.mine }]
      : []),
    ...(context.canAsk ? [{ id: 'ask', label: m.ask }] : []),
    { type: 'separator' },
    {
      id: 'delete',
      label: event.seriesId !== null ? m.deleteSeries : m.delete,
      enabled: editable,
      chord: context.chords.delete
    }
  ]
}

/** An empty hour of the grid: a new event there, or one all day. */
export function slotMenuItems(time: string): ContextMenuItem[] {
  const m = messagesNow(MESSAGES)
  return [
    { id: 'new', label: m.newEventAt(time) },
    { id: 'new-all-day', label: m.newAllDay }
  ]
}

/** A day — of the month, of the small month, an agenda's —: a new event on it, or the day itself. */
export function dayMenuItems(canWrite: boolean): ContextMenuItem[] {
  const m = messagesNow(MESSAGES)
  return [
    { id: 'new', label: m.newEvent, enabled: canWrite },
    { id: 'new-all-day', label: m.newAllDay, enabled: canWrite },
    { type: 'separator' },
    { id: 'go', label: m.goToDay }
  ]
}

/**
 * A calendar of the sidebar: which are shown, a new event in it, whose its
 * events are (§7.4, as Settings › Notifiche sets it), the calendars read
 * again, its connection in Settings.
 */
export function calendarMenuItems(
  calendar: CalendarListEntry,
  calendars: ReadonlyArray<CalendarListEntry>,
  aiOn: boolean
): ContextMenuItem[] {
  const m = messagesNow(MESSAGES)
  const roles = messagesNow(ROLE_WORDS)

  return [
    {
      id: 'show-only',
      label: m.showOnly,
      enabled: calendars.some((other) => other.key !== calendar.key && !other.hidden)
    },
    { id: 'show-all', label: m.showAll, enabled: calendars.some((other) => other.hidden) },
    { id: 'toggle', label: calendar.hidden ? m.show : m.hide },
    { type: 'separator' },
    { id: 'new', label: m.newEventHere, enabled: calendar.writable },
    { type: 'separator' },
    {
      id: 'role',
      label: m.whose,
      submenu: [
        ...CALENDAR_ROLES.map((role) => ({
          id: `role:${role}`,
          label: roles[role],
          checked: calendar.role === role
        })),
        // The user's word gives way to the default, or to the Segretario, as in Settings.
        ...(calendar.roleBy === 'utente'
          ? [
              { type: 'separator' as const },
              { id: 'role:default', label: aiOn ? m.letSegretarioDecide : m.restoreRole }
            ]
          : [])
      ]
    },
    { type: 'separator' },
    { id: 'sync', label: m.syncNow },
    { id: 'settings', label: m.openSettings }
  ]
}

/** Whether a proposal puts a new event in the calendar — not a change, not an answer —: one to edit before adding. */
export function proposesNewEvent(proposed: ProposedEvent): boolean {
  const { payload } = proposed.proposal
  return !payload.eventKey && typeof payload.response !== 'string'
}

/**
 * An event the Segretario proposes, as its card has it: accept it as it
 * is, change it first — a new event —, or set it aside; and the mail it
 * comes from.
 */
export function proposalMenuItems(proposed: ProposedEvent): ContextMenuItem[] {
  const m = messagesNow(MESSAGES)

  return [
    { id: 'open', label: m.open },
    { type: 'separator' },
    { id: 'accept', label: eventProposalWords(proposed.proposal).action },
    ...(proposesNewEvent(proposed) ? [{ id: 'edit', label: m.editAndAdd }] : []),
    { id: 'ignore', label: m.ignore },
    ...(proposed.proposal.messageKey
      ? [{ type: 'separator' } as const, { id: 'source', label: m.openSource }]
      : [])
  ]
}
