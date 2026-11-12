import { Repeat } from 'lucide-react'

import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { dateFormat } from '@renderer/features/calendar/calendar-dates'
import {
  customOf,
  isLastWeekdayOfMonth,
  presetOf,
  recurrenceOfCustom,
  repeatPresets,
  weekdayDate,
  weekdayPlace,
  weekOrder,
  WORKDAYS,
  type CustomRepeat,
  type CustomRepeatProblem
} from '@renderer/features/calendar/recurrence'
import {
  monthlyChoiceWords,
  recurrenceWords,
  weekdayWords
} from '@renderer/features/calendar/recurrence-words'
import { messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { EventRecurrence } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'

const MESSAGES = defineMessages({
  repeat: { en: 'Repeat', it: 'Ripeti', de: 'Wiederholen' },
  noRepeat: { en: 'Doesn’t repeat', it: 'Non si ripete', de: 'Wiederholt sich nicht' },
  workdays: {
    en: (from: string, to: string) => `Every weekday (${from}–${to})`,
    it: (from: string, to: string) => `Ogni giorno feriale (${from}–${to})`,
    de: (from: string, to: string) => `Jeden Werktag (${from}–${to})`
  },
  custom: { en: 'Custom…', it: 'Personalizza…', de: 'Benutzerdefiniert…' },
  every: { en: 'Every', it: 'Ogni', de: 'Alle' },
  interval: { en: 'How often', it: 'Ogni quanto', de: 'Wie oft' },
  unit: { en: 'Unit', it: 'Unità', de: 'Einheit' },
  daily: {
    en: (count: number): string => (count === 1 ? 'day' : 'days'),
    it: (count: number): string => (count === 1 ? 'giorno' : 'giorni'),
    de: (count: number): string => (count === 1 ? 'Tag' : 'Tage')
  },
  weekly: {
    en: (count: number): string => (count === 1 ? 'week' : 'weeks'),
    it: (count: number): string => (count === 1 ? 'settimana' : 'settimane'),
    de: (count: number): string => (count === 1 ? 'Woche' : 'Wochen')
  },
  monthly: {
    en: (count: number): string => (count === 1 ? 'month' : 'months'),
    it: (count: number): string => (count === 1 ? 'mese' : 'mesi'),
    de: (count: number): string => (count === 1 ? 'Monat' : 'Monate')
  },
  yearly: {
    en: (count: number): string => (count === 1 ? 'year' : 'years'),
    it: (count: number): string => (count === 1 ? 'anno' : 'anni'),
    de: (count: number): string => (count === 1 ? 'Jahr' : 'Jahre')
  },
  weekdays: { en: 'On these days', it: 'In questi giorni', de: 'An diesen Tagen' },
  monthDay: { en: 'Which day', it: 'Quale giorno', de: 'Welcher Tag' },
  ends: { en: 'Ends', it: 'Termina', de: 'Endet' },
  never: { en: 'Never', it: 'Mai', de: 'Nie' },
  onDay: { en: 'On', it: 'Il giorno', de: 'Am' },
  after: { en: 'After', it: 'Dopo', de: 'Nach' },
  untilDay: { en: 'Last day', it: 'Ultimo giorno', de: 'Letzter Tag' },
  count: { en: 'How many times', it: 'Quante volte', de: 'Wie oft insgesamt' },
  times: {
    en: (count: number): string => (count === 1 ? 'occurrence' : 'occurrences'),
    it: (count: number): string => (count === 1 ? 'volta' : 'volte'),
    de: (count: number): string => (count === 1 ? 'Termin' : 'Terminen')
  },
  problemInterval: {
    en: 'How often it repeats: a whole number, from 1.',
    it: 'Ogni quanto si ripete: un numero intero, da 1.',
    de: 'Wie oft er sich wiederholt: eine ganze Zahl ab 1.'
  },
  problemCount: {
    en: 'How many times: a whole number, from 1.',
    it: 'Quante volte: un numero intero, da 1.',
    de: 'Wie oft insgesamt: eine ganze Zahl ab 1.'
  },
  problemUntil: {
    en: 'The last day can’t come before the start.',
    it: 'L’ultimo giorno non può venire prima dell’inizio.',
    de: 'Der letzte Tag darf nicht vor dem Beginn liegen.'
  },
  bySeries: {
    en: 'How it repeats belongs to the series: this change is for the whole series.',
    it: 'Come si ripete è della serie: questa modifica vale per tutta la serie.',
    de: 'Wie er sich wiederholt, gehört zur Serie: Diese Änderung gilt für die ganze Serie.'
  }
})

const FREQUENCIES: ReadonlyArray<EventRecurrence['frequency']> = [
  'daily',
  'weekly',
  'monthly',
  'yearly'
]

const NARROW_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'narrow' }
const SHORT_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' }

/** What is wrong with a custom rule, in words. */
export function customProblemWords(problem: CustomRepeatProblem): string {
  const m = messagesNow(MESSAGES)
  return problem === 'interval'
    ? m.problemInterval
    : problem === 'count'
      ? m.problemCount
      : m.problemUntil
}

/** How an event repeats, as the editor holds it: a rule, none, one made elsewhere; or the custom one being made. */
export interface RepeatValue {
  recurrence: EventRecurrence | null | 'other'
  custom: CustomRepeat | null
}

/**
 * «Ripeti»: the ready choices of a calendar, from the event's start, and a
 * custom rule — every so many days, weeks, months or years; the weekdays
 * of a week in the region's order; a month's day by its date or by its
 * weekday's place; until a day or so many times — said in words as it is
 * made. A rule made elsewhere is shown, not changed here.
 */
export function RepeatField({
  value,
  start,
  disabled,
  seriesNote,
  onChange
}: {
  value: RepeatValue
  /** The start's day: the choices are made from it. */
  start: Date
  disabled: boolean
  /** An instance whose rule changed: the change is the series'. */
  seriesNote: boolean
  onChange: (value: RepeatValue) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { recurrence, custom } = value
  const presets = repeatPresets(start)
  const other = recurrence === 'other'
  const preset = other || custom ? null : presetOf(recurrence, start)
  const selected = other ? 'other' : custom ? 'custom' : preset === 'custom' ? 'current' : preset!
  const short = dateFormat(SHORT_WEEKDAY)
  const made = custom ? recurrenceOfCustom(custom, start) : null

  const setCustom = (patch: Partial<CustomRepeat>): void =>
    onChange({ recurrence: recurrence, custom: { ...custom!, ...patch } })

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={selected}
        disabled={disabled || other}
        onValueChange={(choice) => {
          if (choice === 'custom') {
            onChange({ recurrence, custom: customOf(other ? null : recurrence, start) })
            return
          }

          const chosen = presets.find((entry) => entry.id === choice)

          if (chosen) {
            onChange({ recurrence: chosen.recurrence, custom: null })
          }
        }}
      >
        <SelectTrigger aria-label={m.repeat} className="h-8">
          {/* A div: the trigger clamps a span child to one line, which would undo the row. */}
          <div className="flex min-w-0 items-center gap-2">
            <Repeat className="text-faint-foreground size-3.5 shrink-0" />
            <span className="truncate">
              <SelectValue />
            </span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {other && <SelectItem value="other">{recurrenceWords('other', start)}</SelectItem>}
          {selected === 'current' && recurrence && recurrence !== 'other' && (
            <SelectItem value="current">{recurrenceWords(recurrence, start)}</SelectItem>
          )}
          {presets.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.recurrence === null
                ? m.noRepeat
                : entry.id === 'workdays'
                  ? m.workdays(
                      short.format(weekdayDate(WORKDAYS[0])),
                      short.format(weekdayDate(WORKDAYS[WORKDAYS.length - 1]))
                    )
                  : recurrenceWords(entry.recurrence, start)}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value="custom">{m.custom}</SelectItem>
        </SelectContent>
      </Select>

      {custom && (
        <CustomRepeatEditor
          custom={custom}
          start={start}
          disabled={disabled}
          onChange={setCustom}
        />
      )}

      {made &&
        ('problem' in made ? (
          <p className="text-destructive-soft-foreground text-[12px]">
            {customProblemWords(made.problem)}
          </p>
        ) : (
          <p className="text-muted-foreground text-[12px]">
            {recurrenceWords(made.recurrence, start)}
          </p>
        ))}

      {seriesNote && <p className="text-muted-foreground text-[12px]">{m.bySeries}</p>}
    </div>
  )
}

/** The custom rule's fields: how often, on which days, until when. */
function CustomRepeatEditor({
  custom,
  start,
  disabled,
  onChange
}: {
  custom: CustomRepeat
  start: Date
  disabled: boolean
  onChange: (patch: Partial<CustomRepeat>) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const narrow = dateFormat(NARROW_WEEKDAY)
  const every = Number(custom.interval) || 1
  const count = Number(custom.count) || 1
  const monthly: Array<CustomRepeat['monthlyBy']> = [
    'day',
    ...(weekdayPlace(start) <= 4 ? (['weekday'] as const) : []),
    ...(isLastWeekdayOfMonth(start) ? (['lastWeekday'] as const) : [])
  ]

  return (
    <div className="bg-hover/50 flex flex-col gap-2.5 rounded-[8px] px-3 py-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-16 shrink-0">{m.every}</span>
        <Input
          inputMode="numeric"
          aria-label={m.interval}
          value={custom.interval}
          disabled={disabled}
          onChange={(event) => onChange({ interval: event.target.value })}
          className="h-8 w-14 text-center tabular-nums"
        />
        <Select
          value={custom.frequency}
          disabled={disabled}
          onValueChange={(frequency) =>
            onChange({ frequency: frequency as CustomRepeat['frequency'] })
          }
        >
          <SelectTrigger aria-label={m.unit} className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCIES.map((frequency) => (
              <SelectItem key={frequency} value={frequency}>
                {m[frequency](every)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {custom.frequency === 'weekly' && (
        <div role="group" aria-label={m.weekdays} className="flex items-center gap-1 pl-[72px]">
          {weekOrder().map((weekday) => {
            const on = custom.weekdays.includes(weekday)

            return (
              <button
                key={weekday}
                type="button"
                aria-pressed={on}
                aria-label={weekdayWords(weekday)}
                title={weekdayWords(weekday)}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    weekdays: on
                      ? custom.weekdays.filter((day) => day !== weekday)
                      : [...custom.weekdays, weekday]
                  })
                }
                className={cn(
                  'focus-visible:ring-ring/60 grid size-7 place-items-center rounded-full text-[11.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-45',
                  on
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-hover shadow-[inset_0_0_0_1px_hsl(var(--input))]'
                )}
              >
                {narrow.format(weekdayDate(weekday))}
              </button>
            )
          })}
        </div>
      )}

      {custom.frequency === 'monthly' && (
        <div className="pl-[72px]">
          <Select
            value={monthly.includes(custom.monthlyBy) ? custom.monthlyBy : 'day'}
            disabled={disabled}
            onValueChange={(by) => onChange({ monthlyBy: by as CustomRepeat['monthlyBy'] })}
          >
            <SelectTrigger aria-label={m.monthDay} className="h-8 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthly.map((by) => (
                <SelectItem key={by} value={by}>
                  {monthlyChoiceWords(by, start)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-16 shrink-0">{m.ends}</span>
        <Select
          value={custom.ends}
          disabled={disabled}
          onValueChange={(ends) => onChange({ ends: ends as CustomRepeat['ends'] })}
        >
          <SelectTrigger aria-label={m.ends} className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">{m.never}</SelectItem>
            <SelectItem value="until">{m.onDay}</SelectItem>
            <SelectItem value="count">{m.after}</SelectItem>
          </SelectContent>
        </Select>
        {custom.ends === 'until' && (
          <Input
            type="date"
            aria-label={m.untilDay}
            value={custom.until}
            disabled={disabled}
            onChange={(event) => onChange({ until: event.target.value })}
            className="h-8 w-40"
          />
        )}
        {custom.ends === 'count' && (
          <>
            <Input
              inputMode="numeric"
              aria-label={m.count}
              value={custom.count}
              disabled={disabled}
              onChange={(event) => onChange({ count: event.target.value })}
              className="h-8 w-14 text-center tabular-nums"
            />
            <span className="text-muted-foreground">{m.times(count)}</span>
          </>
        )}
      </div>
    </div>
  )
}
