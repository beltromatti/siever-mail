import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  addDays,
  dayKey,
  dayOfKey,
  eventSpan,
  localDateTime,
  startOfDay
} from '@renderer/features/calendar/calendar-dates'
import {
  keptByWords,
  moveBlocked,
  moveLimitWords,
  moveTargets,
  type MoveTarget
} from '@renderer/features/calendar/event-limits'
import {
  changeScope,
  fitRecurrence,
  isRecurrence,
  recurrenceOfCustom,
  sameRecurrence,
  type CustomRepeat
} from '@renderer/features/calendar/recurrence'
import { reminderLimit } from '@renderer/features/calendar/reminders'
import { useSeriesChoice } from '@renderer/features/calendar/series-choice'
import { messagesNow, useMessages } from '@renderer/lib/i18n'
import {
  calendarKey,
  type CalendarEvent,
  type CalendarListEntry,
  type EventChange,
  type EventRecurrence,
  type NewCalendarEvent
} from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

import { dotStyle } from './event-style'
import { customProblemWords, RepeatField } from './repeat-field'
import { RemindersField } from './reminders-field'
import type { ProposedEvent } from './use-calendar-data'

const MESSAGES = defineMessages({
  invalidGuest: {
    en: 'A guest’s address is not valid.',
    it: 'Un invitato non ha un indirizzo valido.',
    de: 'Die Adresse eines Gastes ist ungültig.'
  },
  endDayFirst: {
    en: 'The end day comes before the start day.',
    it: 'Il giorno di fine viene prima di quello di inizio.',
    de: 'Der Endtag liegt vor dem Starttag.'
  },
  noDateOrTime: {
    en: 'The date or the time is missing.',
    it: 'Manca la data o l’ora.',
    de: 'Datum oder Uhrzeit fehlt.'
  },
  endFirst: {
    en: 'The end must come after the start.',
    it: 'La fine deve venire dopo l’inizio.',
    de: 'Das Ende muss nach dem Beginn liegen.'
  },
  noTitle: {
    en: 'Give the event a title.',
    it: 'Dai un titolo all’evento.',
    de: 'Geben Sie dem Termin einen Titel.'
  },
  notSaved: {
    en: 'The event was not saved.',
    it: 'L’evento non è stato salvato.',
    de: 'Der Termin wurde nicht gespeichert.'
  },
  newEvent: { en: 'New event', it: 'Nuovo evento', de: 'Neuer Termin' },
  editEvent: { en: 'Edit the event', it: 'Modifica l’evento', de: 'Termin bearbeiten' },
  duplicateEvent: { en: 'Duplicate the event', it: 'Duplica l’evento', de: 'Termin duplizieren' },
  proposedEvent: {
    en: 'Edit and add',
    it: 'Modifica e aggiungi',
    de: 'Bearbeiten und hinzufügen'
  },
  proposedText: {
    en: 'Proposed by the Segretario: change what you need, then add it to the calendar.',
    it: 'Proposto dal Segretario: cambia ciò che serve, poi mettilo in calendario.',
    de: 'Vom Segretario vorgeschlagen: Ändern Sie, was nötig ist, und tragen Sie ihn dann ein.'
  },
  organizedBy: {
    en: (organizer: string | null) =>
      `Organized by ${organizer ?? 'someone else'}: you answer the invitation, but only the organizer can change it.`,
    it: (organizer: string | null) =>
      `Lo organizza ${organizer ?? 'un’altra persona'}: all’invito rispondi, ma cambiarlo può solo chi lo organizza.`,
    de: (organizer: string | null) =>
      `Organisiert von ${organizer ?? 'einer anderen Person'}: Sie beantworten die Einladung, ändern kann sie nur, wer sie organisiert.`
  },
  guestsUpdated: {
    en: 'The guests get the update.',
    it: 'Gli invitati ricevono l’aggiornamento.',
    de: 'Die Gäste erhalten die Aktualisierung.'
  },
  guestsInvited: {
    en: 'Whoever you invite gets the calendar’s invitation.',
    it: 'Chi inviti riceve l’invito del calendario.',
    de: 'Wen Sie einladen, erhält die Einladung des Kalenders.'
  },
  title: { en: 'Title', it: 'Titolo', de: 'Titel' },
  calendar: { en: 'Calendar', it: 'Calendario', de: 'Kalender' },
  chooseCalendar: { en: 'Choose a calendar', it: 'Scegli un calendario', de: 'Kalender wählen' },
  movesSeries: {
    en: 'It moves there with its whole series.',
    it: 'Si sposta lì con tutta la serie.',
    de: 'Er wird mit der ganzen Serie dorthin verschoben.'
  },
  allDay: { en: 'All day', it: 'Tutto il giorno', de: 'Ganztägig' },
  startDay: { en: 'Start day', it: 'Giorno di inizio', de: 'Starttag' },
  startTime: { en: 'Start time', it: 'Ora di inizio', de: 'Startzeit' },
  endDay: { en: 'End day', it: 'Giorno di fine', de: 'Endtag' },
  endTime: { en: 'End time', it: 'Ora di fine', de: 'Endzeit' },
  repeat: { en: 'Repeat', it: 'Ripeti', de: 'Wiederholen' },
  reminders: { en: 'Reminders', it: 'Promemoria', de: 'Erinnerungen' },
  location: { en: 'Location', it: 'Luogo', de: 'Ort' },
  guests: { en: 'Guests', it: 'Invitati', de: 'Gäste' },
  guestsPlaceholder: {
    en: 'Guests: addresses separated by commas',
    it: 'Invitati: indirizzi separati da una virgola',
    de: 'Gäste: Adressen durch Kommas getrennt'
  },
  description: { en: 'Description', it: 'Descrizione', de: 'Beschreibung' },
  cancel: { en: 'Cancel', it: 'Annulla', de: 'Abbrechen' },
  create: { en: 'Create', it: 'Crea', de: 'Erstellen' },
  add: { en: 'Add to calendar', it: 'Aggiungi al calendario', de: 'Zum Kalender hinzufügen' },
  save: { en: 'Save', it: 'Salva', de: 'Speichern' },
  saveTitle: {
    en: (title: string) => `Save the changes to “${title}”?`,
    it: (title: string) => `Salvare le modifiche a «${title}»?`,
    de: (title: string) => `Änderungen an „${title}“ speichern?`
  },
  saveSeries: {
    en: 'It repeats: are the changes for this event only, or for the whole series?',
    it: 'Si ripete: le modifiche valgono solo per questo evento o per tutta la serie?',
    de: 'Er wiederholt sich: Gelten die Änderungen nur für diesen Termin oder für die ganze Serie?'
  }
})

/** What the editor opens on: a range drawn, an event to change or to copy, a proposal to change before adding it. */
export type EditorTarget =
  | {
      mode: 'new'
      start: number
      end: number
      allDay: boolean
      /** The calendar it goes in, when it was chosen already (a calendar's «New event here»). */
      calendarKey?: string
    }
  | { mode: 'edit'; event: CalendarEvent }
  | { mode: 'duplicate'; event: CalendarEvent }
  | { mode: 'proposal'; proposed: ProposedEvent }

interface Form {
  calendarKey: string
  title: string
  allDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  location: string
  guests: string
  description: string
  /** How it repeats; `'other'`, a rule made elsewhere, is left as it is. */
  recurrence: EventRecurrence | null | 'other'
  /** The custom rule being made, in place of `recurrence`. */
  custom: CustomRepeat | null
  /** Minutes before the start; [] none; null the calendar's own. */
  reminders: number[] | null
}

/** The fields of a form for a time span: its days and hours, an all-day one's last day shown. */
function timeFields(
  span: { start: number; end: number },
  allDay: boolean
): Pick<Form, 'allDay' | 'startDate' | 'startTime' | 'endDate' | 'endTime'> {
  const start = localDateTime(span.start)
  // An all-day range's end is the day after its last: the form shows its last.
  const end = localDateTime(allDay ? addDays(new Date(span.end), -1).getTime() : span.end)

  return {
    allDay,
    startDate: start.date,
    startTime: allDay ? '09:00' : start.time,
    endDate: end.date,
    endTime: allDay ? '10:00' : end.time
  }
}

/** The addresses invited, but the user: what the guests field holds. */
const guestsOf = (event: Pick<CalendarEvent, 'attendees'>): string =>
  event.attendees
    .filter((attendee) => !attendee.self)
    .map((attendee) => attendee.email)
    .join(', ')

/**
 * The form an editor starts with: the range drawn, the event as it is, its
 * copy, the proposal as the Segretario wrote it. A new event goes to the
 * calendar asked for, or the one the user chose for them (Impostazioni ›
 * Preferenze), while it is there to write in; else to the principal one.
 */
function initialForm(
  target: EditorTarget,
  calendars: ReadonlyArray<CalendarListEntry>,
  preferredKey: string | null
): Form {
  const writable = calendars.filter((calendar) => calendar.writable && !calendar.hidden)
  const writableKey = (key: string | null | undefined): string | undefined =>
    writable.find((calendar) => calendar.key === key)?.key
  const fallback =
    writableKey(preferredKey) ??
    writable.find((calendar) => calendar.primary)?.key ??
    writable[0]?.key ??
    ''
  const empty = { location: '', guests: '', description: '', recurrence: null, custom: null }

  switch (target.mode) {
    case 'new':
      return {
        ...empty,
        calendarKey: writableKey(target.calendarKey) ?? fallback,
        title: '',
        ...timeFields(target, target.allDay),
        reminders: null
      }
    case 'proposal': {
      const { proposed } = target
      const { payload } = proposed.proposal
      const named = typeof payload.calendar === 'string' ? payload.calendar.toLowerCase() : null

      return {
        ...empty,
        // The calendar it names — found when it was proposed, or by the name the Segretario said.
        calendarKey:
          writableKey(typeof payload.calendarKey === 'string' ? payload.calendarKey : null) ??
          ((named &&
            writable.find((calendar) =>
              `${calendar.name} ${calendar.connection}`.toLowerCase().includes(named)
            )?.key) ||
            fallback),
        title: proposed.title,
        ...timeFields(eventSpan(proposed), proposed.allDay),
        location: typeof payload.location === 'string' ? payload.location : '',
        guests: Array.isArray(payload.attendees)
          ? payload.attendees.filter((guest) => typeof guest === 'string').join(', ')
          : '',
        description: typeof payload.description === 'string' ? payload.description : '',
        recurrence: isRecurrence(payload.recurrence) ? payload.recurrence : null,
        reminders: Array.isArray(payload.reminders)
          ? payload.reminders.filter((minutes): minutes is number => Number.isInteger(minutes))
          : null
      }
    }
    case 'edit':
    case 'duplicate': {
      const { event } = target
      const own = calendarKey(event.connectionId, event.calendarId)
      const copy = target.mode === 'duplicate'

      return {
        calendarKey: copy ? (writableKey(own) ?? fallback) : own,
        title: event.title,
        ...timeFields(eventSpan(event), event.allDay),
        location: event.location ?? '',
        // A copy of an invitation is the user's own: its organizer's guests are not invited to it.
        guests: copy && event.organizedByUser === false ? '' : guestsOf(event),
        description: event.description ?? '',
        recurrence: copy && event.recurrence === 'other' ? null : (event.recurrence ?? null),
        custom: null,
        reminders: event.reminders ?? null
      }
    }
  }
}

/** When an event is and who is invited, as the calendar takes them. */
type EventTiming = Pick<NewCalendarEvent, 'start' | 'end' | 'allDay' | 'attendees'>

/** The form as the calendar takes it — start and end, the guests — or why it cannot be. */
function eventOfForm(form: Form): { value: EventTiming } | { problem: string } {
  const m = messagesNow(MESSAGES)
  const guests = form.guests
    .split(/[,;\s]+/)
    .map((guest) => guest.trim())
    .filter(Boolean)

  if (guests.some((guest) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest))) {
    return { problem: m.invalidGuest }
  }

  if (form.allDay) {
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) {
      return { problem: m.endDayFirst }
    }

    return {
      value: {
        start: form.startDate,
        end: dayKey(addDays(dayOfKey(form.endDate), 1)),
        allDay: true,
        attendees: guests
      }
    }
  }

  const start = new Date(`${form.startDate}T${form.startTime}`)
  const end = new Date(`${form.endDate}T${form.endTime}`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { problem: m.noDateOrTime }
  }

  if (end <= start) {
    return { problem: m.endFirst }
  }

  return {
    value: { start: start.toISOString(), end: end.toISOString(), allDay: false, attendees: guests }
  }
}

/** The day a form's event starts on, at its midnight: what its repeating is counted from. */
function startDayOf(form: Pick<Form, 'startDate'>): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(form.startDate)
    ? dayOfKey(form.startDate)
    : startOfDay(new Date())
}

/** How the form repeats, as the calendar takes it — or what is wrong with the custom rule. */
function recurrenceOfForm(
  form: Form
): { recurrence: EventRecurrence | null | 'other' } | { problem: string } {
  const start = startDayOf(form)

  if (form.custom) {
    const made = recurrenceOfCustom(form.custom, start)
    return 'problem' in made ? { problem: customProblemWords(made.problem) } : made
  }

  return {
    recurrence:
      form.recurrence && form.recurrence !== 'other'
        ? fitRecurrence(form.recurrence, start)
        : form.recurrence
  }
}

/**
 * Whether the form's rule repeats otherwise than the one the event had —
 * that one kept true to the form's start, as the form's is. A rule made
 * elsewhere is never changed here.
 */
function repeatChangedFrom(
  recurrence: EventRecurrence | null | 'other',
  opened: EventRecurrence | null | 'other',
  start: Date
): recurrence is EventRecurrence | null {
  return (
    recurrence !== 'other' &&
    opened !== 'other' &&
    !sameRecurrence(recurrence, opened && fitRecurrence(opened, start), start)
  )
}

/** The addresses of a list of guests, to compare: their case and order do not matter. */
const guestSet = (guests: ReadonlyArray<string>): string =>
  [...new Set(guests.map((guest) => guest.toLowerCase()))].sort().join('\n')

/** Two lists of reminders alike: the same times, whatever their order; or both the calendar's own. */
const sameReminders = (a: number[] | null, b: number[] | null): boolean =>
  a === null || b === null
    ? a === b
    : guestSet(a.map(String)) === guestSet(b.map(String)) && a.length === b.length

/**
 * What the form changes of the event as it was opened: only that, so what
 * was changed meanwhile elsewhere — the time, the guests, the body — is not
 * written over by the form's copy of it. Of an event another service keeps,
 * only its reminders.
 */
function changeOfForm(
  form: Form,
  opened: Form,
  shaped: EventTiming,
  recurrence: EventRecurrence | null | 'other',
  managed: boolean
): EventChange {
  const reminders = sameReminders(form.reminders, opened.reminders)
    ? {}
    : { reminders: form.reminders }

  if (managed) {
    return reminders
  }

  const before = eventOfForm(opened)
  const location = form.location.trim() || null
  const description = form.description.trim() || null
  const sameTime =
    'value' in before &&
    before.value.allDay === shaped.allDay &&
    before.value.start === shaped.start &&
    before.value.end === shaped.end

  return {
    ...(form.title.trim() !== opened.title.trim() ? { title: form.title.trim() } : {}),
    ...(form.calendarKey !== opened.calendarKey ? { calendarKey: form.calendarKey } : {}),
    ...(sameTime ? {} : { start: shaped.start, end: shaped.end, allDay: shaped.allDay }),
    ...(location !== (opened.location.trim() || null) ? { location } : {}),
    ...(description !== (opened.description.trim() || null) ? { description } : {}),
    ...('value' in before && guestSet(before.value.attendees) === guestSet(shaped.attendees)
      ? {}
      : { attendees: shaped.attendees }),
    ...(repeatChangedFrom(recurrence, opened.recurrence, startDayOf(form)) ? { recurrence } : {}),
    ...reminders
  }
}

/** A calendar in a list to choose from: its colour, its name, its connection. */
function CalendarOption({ calendar }: { calendar: CalendarListEntry }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={dotStyle(calendar.color)} />
      <span className="truncate">{calendar.name}</span>
      {calendar.connection !== calendar.name && (
        <span className="text-muted-foreground truncate">{calendar.connection}</span>
      )}
    </span>
  )
}

/**
 * A new event, or one changed, copied, or proposed by the Segretario: its
 * calendar — for one that is there, where it moves (vision §7.5), where it
 * can —, title, when, how it repeats, its reminders, where, who is invited
 * — they get the provider's invitation, or its update —, what it is about.
 * An instance of a series asks, saving, whether the change is its own or
 * the series'. An event another service keeps changes only its reminders;
 * one the user is invited to is answered, not changed: the form says so
 * and saves nothing. Mounted anew at each opening.
 */
export function EventEditor({
  target,
  calendars,
  preferredCalendarKey,
  onClose,
  onSaved
}: {
  target: EditorTarget
  calendars: ReadonlyArray<CalendarListEntry>
  /** Where the user wants new events, by calendar key; null: the principal calendar. */
  preferredCalendarKey: string | null
  onClose: () => void
  onSaved: (event: CalendarEvent) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [opened] = useState<Form>(() => initialForm(target, calendars, preferredCalendarKey))
  const [form, setForm] = useState<Form>(opened)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const seriesChoice = useSeriesChoice()
  const editing = target.mode === 'edit' ? target.event : null
  // An invitation, opened here: it is answered, not changed.
  const invitedTo =
    editing && editing.organizedByUser !== true && !editing.managedBy ? editing : null
  // Put there by another service, which keeps it: only its reminders change.
  const managed = editing?.managedBy ?? null
  const locked = invitedTo !== null || managed !== null
  const set = (patch: Partial<Form>): void => setForm((current) => ({ ...current, ...patch }))
  const start = startDayOf(form)

  // Where it can go: for an event there, the calendars it can move to, each with what stops it.
  const targets: MoveTarget[] = editing
    ? moveTargets(editing, calendars).filter(
        (entry) => !entry.calendar.hidden || entry.calendar.key === opened.calendarKey
      )
    : calendars
        .filter(
          (calendar) => calendar.writable && (!calendar.hidden || calendar.key === form.calendarKey)
        )
        .map((calendar) => ({ calendar, limit: null }))
  const blocked = editing ? moveBlocked(targets) : null
  const chosenCalendar = calendars.find((calendar) => calendar.key === form.calendarKey)
  const isInstance = editing !== null && editing.seriesId !== null
  const repeatOfForm = recurrenceOfForm(form)
  const repeatChanged =
    isInstance &&
    'recurrence' in repeatOfForm &&
    repeatChangedFrom(repeatOfForm.recurrence, opened.recurrence, start)

  const save = async (): Promise<void> => {
    const shaped = eventOfForm(form)

    if ('problem' in shaped) {
      setProblem(shaped.problem)
      return
    }

    if (!form.title.trim()) {
      setProblem(m.noTitle)
      return
    }

    const repeat = recurrenceOfForm(form)

    if ('problem' in repeat) {
      setProblem(repeat.problem)
      return
    }

    const recurrence = repeat.recurrence === 'other' ? null : repeat.recurrence
    let write: (() => Promise<CalendarEvent>) | null

    if (target.mode === 'edit') {
      const change = changeOfForm(form, opened, shaped.value, repeat.recurrence, managed !== null)

      // Nothing changed: there is nothing to tell anyone.
      if (Object.keys(change).length === 0) {
        onClose()
        return
      }

      const scope = changeScope(target.event, change)
      let series = scope === 'series'

      if (scope === 'ask') {
        const answer = await seriesChoice.ask({
          title: m.saveTitle(target.event.title),
          description: m.saveSeries
        })

        if (!answer) {
          return
        }

        series = answer === 'series'
      }

      write = () =>
        window.calendarApi.update(target.event.key, change, series ? { series } : undefined)
    } else {
      const created: NewCalendarEvent = {
        ...shaped.value,
        calendarKey: form.calendarKey,
        title: form.title.trim(),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
        ...(recurrence ? { recurrence } : {}),
        ...(form.reminders !== null ? { reminders: form.reminders } : {})
      }

      write =
        target.mode === 'proposal'
          ? async () => {
              const event = await window.calendarApi.create(created)
              // The proposal is answered with what the user made of it, for the Segretario to learn.
              await window.segretarioApi.decideProposal(
                target.proposed.proposal.id,
                true,
                { eventKey: event.key, edited: true },
                target.proposed.proposal.revision
              )
              return event
            }
          : () => window.calendarApi.create(created)
    }

    setSaving(true)
    setProblem(null)

    try {
      onSaved(await write())
    } catch (error) {
      setProblem(error instanceof Error ? error.message : messagesNow(MESSAGES).notSaved)
    } finally {
      setSaving(false)
    }
  }

  const title =
    target.mode === 'new'
      ? m.newEvent
      : target.mode === 'duplicate'
        ? m.duplicateEvent
        : target.mode === 'proposal'
          ? m.proposedEvent
          : m.editEvent
  const intro = managed
    ? keptByWords(managed)
    : invitedTo
      ? m.organizedBy(invitedTo.organizer)
      : target.mode === 'proposal'
        ? m.proposedText
        : editing?.attendees.some((attendee) => !attendee.self)
          ? m.guestsUpdated
          : m.guestsInvited

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{intro}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1 pb-1">
            <Input
              autoFocus={!locked}
              aria-label={m.title}
              placeholder={m.title}
              value={form.title}
              disabled={locked}
              onChange={(event) => set({ title: event.target.value })}
              className="text-[14px]"
            />

            <div className="flex flex-col gap-1.5">
              <Label>{m.calendar}</Label>
              <Select
                value={form.calendarKey}
                disabled={locked || blocked !== null || targets.length === 0}
                onValueChange={(value) => set({ calendarKey: value })}
              >
                <SelectTrigger aria-label={m.calendar}>
                  <SelectValue placeholder={m.chooseCalendar} />
                </SelectTrigger>
                <SelectContent>
                  {targets.map(({ calendar, limit }) => (
                    <SelectItem
                      key={calendar.key}
                      value={calendar.key}
                      disabled={limit !== null && limit !== 'same'}
                    >
                      <span className="flex min-w-0 flex-col">
                        <CalendarOption calendar={calendar} />
                        {limit !== null && limit !== 'same' && editing && (
                          <span className="text-muted-foreground text-[11px] whitespace-normal">
                            {moveLimitWords(limit, editing)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {blocked && editing && !invitedTo && (
                <p className="text-muted-foreground text-[12px]">
                  {moveLimitWords(blocked, editing)}
                </p>
              )}
              {isInstance && form.calendarKey !== opened.calendarKey && (
                <p className="text-muted-foreground text-[12px]">{m.movesSeries}</p>
              )}
            </div>

            <label className="flex items-center gap-2 text-[12.5px]">
              <Switch
                checked={form.allDay}
                disabled={locked}
                onCheckedChange={(allDay) => set({ allDay })}
              />
              {m.allDay}
            </label>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                type="date"
                aria-label={m.startDay}
                value={form.startDate}
                disabled={locked}
                onChange={(event) =>
                  set({
                    startDate: event.target.value,
                    endDate: form.endDate < event.target.value ? event.target.value : form.endDate
                  })
                }
              />
              {!form.allDay && (
                <Input
                  type="time"
                  aria-label={m.startTime}
                  value={form.startTime}
                  disabled={locked}
                  onChange={(event) => set({ startTime: event.target.value })}
                />
              )}
              <Input
                type="date"
                aria-label={m.endDay}
                value={form.endDate}
                disabled={locked}
                onChange={(event) => set({ endDate: event.target.value })}
              />
              {!form.allDay && (
                <Input
                  type="time"
                  aria-label={m.endTime}
                  value={form.endTime}
                  disabled={locked}
                  onChange={(event) => set({ endTime: event.target.value })}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{m.repeat}</Label>
              <RepeatField
                value={{ recurrence: form.recurrence, custom: form.custom }}
                start={start}
                disabled={locked}
                seriesNote={repeatChanged}
                onChange={(value) => set(value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{m.reminders}</Label>
              <RemindersField
                value={form.reminders}
                allDay={form.allDay}
                limit={reminderLimit(chosenCalendar?.provider)}
                disabled={invitedTo !== null}
                onChange={(reminders) => set({ reminders })}
              />
            </div>

            <Input
              aria-label={m.location}
              placeholder={m.location}
              value={form.location}
              disabled={locked}
              onChange={(event) => set({ location: event.target.value })}
            />
            <Input
              aria-label={m.guests}
              placeholder={m.guestsPlaceholder}
              value={form.guests}
              disabled={locked}
              onChange={(event) => set({ guests: event.target.value })}
            />
            <Textarea
              aria-label={m.description}
              placeholder={m.description}
              value={form.description}
              disabled={locked}
              onChange={(event) => set({ description: event.target.value })}
              className="min-h-20 text-[13px]"
            />

            {problem && <p className="text-destructive-soft-foreground text-[12.5px]">{problem}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              {m.cancel}
            </Button>
            <Button
              type="submit"
              disabled={saving || invitedTo !== null || (!editing && !form.calendarKey)}
            >
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              {target.mode === 'edit' ? m.save : target.mode === 'proposal' ? m.add : m.create}
            </Button>
          </DialogFooter>
        </form>
        {seriesChoice.dialog}
      </DialogContent>
    </Dialog>
  )
}
