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
import type {
  CalendarEvent,
  CalendarListEntry,
  EventChange,
  NewCalendarEvent
} from '@shared/calendar'
import { calendarKey } from '@shared/calendar'

import {
  addDays,
  dayKey,
  dayOfKey,
  eventSpan,
  localDateTime
} from '@renderer/features/calendar/calendar-dates'
import { dotStyle } from './event-style'

/** What the editor opens on: a range drawn on the calendar, or an event to change. */
export type EditorTarget =
  | { mode: 'new'; start: number; end: number; allDay: boolean }
  | { mode: 'edit'; event: CalendarEvent }

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
}

/**
 * The form an editor starts with: the range drawn, or the event as it is. A
 * new event goes to the calendar the user chose for them (Impostazioni ›
 * Preferenze), while it is there to write in; else to the principal one.
 */
function initialForm(
  target: EditorTarget,
  calendars: ReadonlyArray<CalendarListEntry>,
  preferredKey: string | null
): Form {
  const writable = calendars.filter((calendar) => calendar.writable && !calendar.hidden)
  const fallback =
    (
      writable.find((calendar) => calendar.key === preferredKey) ??
      writable.find((calendar) => calendar.primary) ??
      writable[0]
    )?.key ?? ''

  if (target.mode === 'new') {
    const start = localDateTime(target.start)
    // An all-day range's end is the day after its last: the form shows its last.
    const end = localDateTime(
      target.allDay ? addDays(new Date(target.end), -1).getTime() : target.end
    )
    return {
      calendarKey: fallback,
      title: '',
      allDay: target.allDay,
      startDate: start.date,
      startTime: target.allDay ? '09:00' : start.time,
      endDate: end.date,
      endTime: target.allDay ? '10:00' : end.time,
      location: '',
      guests: '',
      description: ''
    }
  }

  const { event } = target
  const span = eventSpan(event)
  const start = localDateTime(span.start)
  const end = localDateTime(event.allDay ? addDays(new Date(span.end), -1).getTime() : span.end)

  return {
    calendarKey: calendarKey(event.connectionId, event.calendarId),
    title: event.title,
    allDay: event.allDay,
    startDate: start.date,
    startTime: event.allDay ? '09:00' : start.time,
    endDate: end.date,
    endTime: event.allDay ? '10:00' : end.time,
    location: event.location ?? '',
    guests: event.attendees
      .filter((attendee) => !attendee.self)
      .map((attendee) => attendee.email)
      .join(', '),
    description: event.description ?? ''
  }
}

/** When an event is and who is invited, as the calendar takes them. */
type EventTiming = Pick<NewCalendarEvent, 'start' | 'end' | 'allDay' | 'attendees'>

/** The form as the calendar takes it — start and end, the guests — or why it cannot be. */
function eventOfForm(form: Form): { value: EventTiming } | { problem: string } {
  const guests = form.guests
    .split(/[,;\s]+/)
    .map((guest) => guest.trim())
    .filter(Boolean)

  if (guests.some((guest) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest))) {
    return { problem: 'Un invitato non ha un indirizzo valido.' }
  }

  if (form.allDay) {
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) {
      return { problem: 'Il giorno di fine viene prima di quello di inizio.' }
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
    return { problem: 'Manca la data o l’ora.' }
  }

  if (end <= start) {
    return { problem: 'La fine deve venire dopo l’inizio.' }
  }

  return {
    value: { start: start.toISOString(), end: end.toISOString(), allDay: false, attendees: guests }
  }
}

/** The addresses of a list of guests, to compare: their case and order do not matter. */
const guestSet = (guests: ReadonlyArray<string>): string =>
  [...new Set(guests.map((guest) => guest.toLowerCase()))].sort().join('\n')

/**
 * What the form changes of the event as it was opened: only that, so what
 * was changed meanwhile elsewhere — the time, the guests, the body — is not
 * written over by the form's copy of it.
 */
function changeOfForm(form: Form, opened: Form, shaped: EventTiming): EventChange {
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
    ...(sameTime ? {} : { start: shaped.start, end: shaped.end, allDay: shaped.allDay }),
    ...(location !== (opened.location.trim() || null) ? { location } : {}),
    ...(description !== (opened.description.trim() || null) ? { description } : {}),
    ...('value' in before && guestSet(before.value.attendees) === guestSet(shaped.attendees)
      ? {}
      : { attendees: shaped.attendees })
  }
}

/** The write of a change to an event; none for a change that changes nothing. */
function changedWrite(key: string, change: EventChange): (() => Promise<CalendarEvent>) | null {
  return Object.keys(change).length > 0 ? () => window.calendarApi.update(key, change) : null
}

/**
 * A new event, or one changed: its calendar, title, when, where, who is
 * invited — they get the provider's invitation, or its update — what it
 * is about. An event the user is invited to is answered, not changed: the
 * form says so and saves nothing. Mounted anew at each opening.
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
  const [opened] = useState<Form>(() => initialForm(target, calendars, preferredCalendarKey))
  const [form, setForm] = useState<Form>(opened)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // An invitation, opened here: it is answered, not changed.
  const invitedTo =
    target.mode === 'edit' && target.event.organizedByUser !== true ? target.event : null
  const writable = calendars.filter(
    (calendar) => calendar.writable && (!calendar.hidden || calendar.key === form.calendarKey)
  )
  const set = (patch: Partial<Form>): void => setForm((current) => ({ ...current, ...patch }))

  const save = async (): Promise<void> => {
    const shaped = eventOfForm(form)

    if ('problem' in shaped) {
      setProblem(shaped.problem)
      return
    }

    if (!form.title.trim()) {
      setProblem('Dai un titolo all’evento.')
      return
    }

    const write =
      target.mode === 'new'
        ? (): Promise<CalendarEvent> =>
            window.calendarApi.create({
              ...shaped.value,
              calendarKey: form.calendarKey,
              title: form.title.trim(),
              location: form.location.trim() || null,
              description: form.description.trim() || null
            })
        : changedWrite(target.event.key, changeOfForm(form, opened, shaped.value))

    // Nothing changed: there is nothing to tell anyone.
    if (!write) {
      onClose()
      return
    }

    setSaving(true)
    setProblem(null)

    try {
      onSaved(await write())
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'L’evento non è stato salvato.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{target.mode === 'new' ? 'Nuovo evento' : 'Modifica l’evento'}</DialogTitle>
          <DialogDescription>
            {invitedTo
              ? `Lo organizza ${invitedTo.organizer ?? 'un’altra persona'}: all’invito rispondi, ma cambiarlo può solo chi lo organizza.`
              : target.mode === 'edit' && target.event.attendees.some((attendee) => !attendee.self)
                ? 'Gli invitati ricevono l’aggiornamento.'
                : 'Chi inviti riceve l’invito del calendario.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <Input
            autoFocus
            aria-label="Titolo"
            placeholder="Titolo"
            value={form.title}
            onChange={(event) => set({ title: event.target.value })}
            className="text-[14px]"
          />

          {target.mode === 'new' && (
            <div className="flex flex-col gap-1.5">
              <Label>Calendario</Label>
              <Select
                value={form.calendarKey}
                onValueChange={(value) => set({ calendarKey: value })}
              >
                <SelectTrigger aria-label="Calendario">
                  <SelectValue placeholder="Scegli un calendario" />
                </SelectTrigger>
                <SelectContent>
                  {writable.map((calendar) => (
                    <SelectItem key={calendar.key} value={calendar.key}>
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={dotStyle(calendar.color)} />
                        {calendar.name}
                        {calendar.connection !== calendar.name && (
                          <span className="text-muted-foreground">{calendar.connection}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <label className="flex items-center gap-2 text-[12.5px]">
            <Switch checked={form.allDay} onCheckedChange={(allDay) => set({ allDay })} />
            Tutto il giorno
          </label>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              type="date"
              aria-label="Giorno di inizio"
              value={form.startDate}
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
                aria-label="Ora di inizio"
                value={form.startTime}
                onChange={(event) => set({ startTime: event.target.value })}
              />
            )}
            <Input
              type="date"
              aria-label="Giorno di fine"
              value={form.endDate}
              onChange={(event) => set({ endDate: event.target.value })}
            />
            {!form.allDay && (
              <Input
                type="time"
                aria-label="Ora di fine"
                value={form.endTime}
                onChange={(event) => set({ endTime: event.target.value })}
              />
            )}
          </div>

          <Input
            aria-label="Luogo"
            placeholder="Luogo"
            value={form.location}
            onChange={(event) => set({ location: event.target.value })}
          />
          <Input
            aria-label="Invitati"
            placeholder="Invitati: indirizzi separati da una virgola"
            value={form.guests}
            onChange={(event) => set({ guests: event.target.value })}
          />
          <Textarea
            aria-label="Descrizione"
            placeholder="Descrizione"
            value={form.description}
            onChange={(event) => set({ description: event.target.value })}
            className="min-h-20 text-[13px]"
          />

          {problem && <p className="text-destructive-soft-foreground text-[12.5px]">{problem}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              Annulla
            </Button>
            <Button
              type="submit"
              disabled={
                saving || invitedTo !== null || (target.mode === 'new' && !form.calendarKey)
              }
            >
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              {target.mode === 'new' ? 'Crea' : 'Salva'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
