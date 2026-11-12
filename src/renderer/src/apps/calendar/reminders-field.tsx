import { Bell, X } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { REMINDER_MODES, reminderWords } from '@renderer/features/calendar/recurrence-words'
import { ALL_DAY_REMINDERS, TIMED_REMINDERS } from '@renderer/features/calendar/reminders'
import { useMessages } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  reminders: { en: 'Reminders', it: 'Promemoria', de: 'Erinnerungen' },
  add: { en: 'Add a reminder', it: 'Aggiungi un promemoria', de: 'Erinnerung hinzufügen' },
  remove: {
    en: (reminder: string) => `Remove “${reminder}”`,
    it: (reminder: string) => `Togli «${reminder}»`,
    de: (reminder: string) => `„${reminder}“ entfernen`
  },
  onlyOne: {
    en: 'This calendar keeps one reminder: a new one takes its place.',
    it: 'Questo calendario tiene un promemoria solo: uno nuovo prende il suo posto.',
    de: 'Dieser Kalender behält nur eine Erinnerung: Eine neue ersetzt sie.'
  },
  atMost: {
    en: (limit: number) => `At most ${limit}.`,
    it: (limit: number) => `Al massimo ${limit}.`,
    de: (limit: number) => `Höchstens ${limit}.`
  }
})

/**
 * «Promemoria»: the calendar's own, none, or the times chosen — of the
 * usual ones, for an event with a time or one all day, and any its
 * calendar already had — up to as many as the calendar keeps.
 */
export function RemindersField({
  value,
  allDay,
  limit,
  disabled,
  onChange
}: {
  /** Minutes before the start; [] none; null the calendar's own. */
  value: number[] | null
  allDay: boolean
  /** How many the calendar keeps (`reminderLimit`). */
  limit: number
  disabled: boolean
  onChange: (reminders: number[] | null) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const modes = useMessages(REMINDER_MODES)
  const chosen = value ? [...value].sort((a, b) => a - b) : []
  const choices = (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).filter(
    (minutes) => !chosen.includes(minutes)
  )
  // One kept, one more takes its place; with room left, it is added.
  const replaces = limit === 1 && chosen.length >= 1
  const full = chosen.length >= limit && !replaces

  const choose = (choice: string): void => {
    if (choice === 'calendars') {
      onChange(null)
    } else if (choice === 'none') {
      onChange([])
    } else {
      const minutes = Number(choice)
      onChange(replaces ? [minutes] : [...chosen, minutes])
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((minutes) => {
            const words = reminderWords(minutes, allDay)

            return (
              <li
                key={minutes}
                className="bg-hover text-foreground flex h-7 items-center gap-1 rounded-full pr-1 pl-2.5 text-[12px]"
              >
                {words}
                <button
                  type="button"
                  aria-label={m.remove(words)}
                  title={m.remove(words)}
                  disabled={disabled}
                  onClick={() => onChange(chosen.filter((other) => other !== minutes))}
                  className="text-faint-foreground hover:text-foreground focus-visible:ring-ring/60 grid size-5 place-items-center rounded-full outline-none focus-visible:ring-2"
                >
                  <X className="size-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Select
        value={value === null ? 'calendars' : chosen.length === 0 ? 'none' : ''}
        disabled={disabled}
        onValueChange={choose}
      >
        <SelectTrigger aria-label={m.reminders} className="h-8">
          {/* A div: the trigger clamps a span child to one line, which would undo the row. */}
          <div className="flex min-w-0 items-center gap-2">
            <Bell className="text-faint-foreground size-3.5 shrink-0" />
            <span className="truncate">
              <SelectValue placeholder={m.add} />
            </span>
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="calendars">{modes.calendars}</SelectItem>
          <SelectItem value="none">{modes.none}</SelectItem>
          {choices.length > 0 && <SelectSeparator />}
          {choices.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)} disabled={full}>
              {reminderWords(minutes, allDay)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {replaces ? (
        <p className="text-muted-foreground text-[11.5px]">{m.onlyOne}</p>
      ) : (
        full && <p className="text-muted-foreground text-[11.5px]">{m.atMost(limit)}</p>
      )}
    </div>
  )
}
