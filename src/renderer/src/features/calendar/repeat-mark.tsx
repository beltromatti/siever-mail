import { Repeat } from 'lucide-react'

import { cn } from '@renderer/lib/utils'
import type { CalendarEvent } from '@shared/calendar'

import { eventStartDay } from './calendar-dates'
import { recurrenceWords } from './recurrence-words'

/** The mark of an event that repeats, beside its title in a line: how, said on hover. */
export function RepeatMark({
  event,
  className
}: {
  event: Pick<CalendarEvent, 'recurrence' | 'start' | 'allDay'>
  className?: string
}): React.JSX.Element | null {
  if (!event.recurrence) {
    return null
  }

  const words = recurrenceWords(event.recurrence, eventStartDay(event))

  return (
    <Repeat
      role="img"
      aria-label={words}
      className={cn('text-faint-foreground inline size-3 shrink-0 align-[-1px]', className)}
    >
      <title>{words}</title>
    </Repeat>
  )
}
