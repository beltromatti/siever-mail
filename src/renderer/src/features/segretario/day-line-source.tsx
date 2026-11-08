import { CalendarDays, Mail, UserRound, type LucideIcon } from 'lucide-react'

import type { DayLine, DayLineSource, HandleLink } from '@shared/segretario'

const SOURCE_ICONS: Readonly<Record<DayLineSource['kind'], LucideIcon>> = {
  message: Mail,
  event: CalendarDays,
  user: UserRound
}

/** Where a line comes from, as an icon beside it: a message, an event, the user's own word. */
export function DayLineSourceIcon({
  line,
  className
}: {
  line: DayLine
  className?: string
}): React.JSX.Element {
  const Icon = SOURCE_ICONS[line.source.kind]
  return <Icon className={className} />
}

const EVENT_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short'
})
const EVENT_TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

/** A line's key: where it comes from, and the thing open there or the reply prepared. */
export function dayLineKey(line: DayLine): string {
  const { source } = line
  const place =
    source.kind === 'message'
      ? `m\u0000${source.ref.accountId}\u0000${source.messageKey}`
      : source.kind === 'event'
        ? `e\u0000${source.eventKey}`
        : 'u'

  return `${place}\u0000${line.commitment?.id ?? line.readyKind ?? ''}`
}

/**
 * Where a line comes from, in a few words under it: who wrote the message
 * and its subject, the event and when it is, or that the user said it.
 */
export function dayLineSourceWords(line: DayLine): string {
  const { source } = line

  if (source.kind === 'message') {
    return source.subject ? `${source.from} · «${source.subject}»` : source.from
  }

  if (source.kind === 'event') {
    if (source.title === null || source.start === null) {
      return 'Evento non più nel calendario'
    }

    const start = new Date(source.start)
    const when = source.allDay
      ? EVENT_DAY.format(start)
      : `${EVENT_DAY.format(start)} ${EVENT_TIME.format(start)}`
    return `Evento · «${source.title}» · ${when}`
  }

  return 'Detta da te'
}

/** Since when a line has been waiting: its message, or when the thing was opened. */
export function dayLineSince(line: DayLine): string {
  return line.source.kind === 'message' || line.source.kind === 'user'
    ? line.source.date
    : new Date(line.commitment?.createdAt ?? Date.now()).toISOString()
}

/**
 * What a line opens, as a link: its message or its event — and, for the
 * user's word or an event no longer in the calendar, the open thing itself,
 * which leads to where it is kept (Oggi) or says it is gone.
 */
export function dayLineLink(line: DayLine): HandleLink | null {
  const { source, commitment } = line

  if (source.kind === 'message') {
    return { handle: '', kind: 'message', ref: source.ref, messageKey: source.messageKey }
  }

  if (source.kind === 'event' && source.title !== null) {
    return { handle: '', kind: 'event', eventKey: source.eventKey, title: source.title }
  }

  return commitment ? { handle: '', kind: 'commitment', commitmentId: commitment.id } : null
}
