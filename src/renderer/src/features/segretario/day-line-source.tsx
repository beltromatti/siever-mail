import { CalendarDays, Mail, UserRound, type LucideIcon } from 'lucide-react'

import { hourStyle, languageNow, messagesNow } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'
import type { DayLine, DayLineSource, HandleLink } from '@shared/segretario'

const MESSAGES = defineMessages({
  quoted: {
    en: (text: string) => `“${text}”`,
    it: (text: string) => `«${text}»`,
    de: (text: string) => `„${text}“`
  },
  eventGone: {
    en: 'Event no longer in the calendar',
    it: 'Evento non più nel calendario',
    de: 'Termin nicht mehr im Kalender'
  },
  event: {
    en: (title: string, when: string) => `Event · “${title}” · ${when}`,
    it: (title: string, when: string) => `Evento · «${title}» · ${when}`,
    de: (title: string, when: string) => `Termin · „${title}“ · ${when}`
  },
  saidByYou: { en: 'Said by you', it: 'Detta da te', de: 'Von Ihnen genannt' }
})

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

/**
 * Every place a line can come from, side by side: the mark of the
 * deadlines as a whole — each of them carries one of these.
 */
export function DayLineSourceIcons({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {Object.entries(SOURCE_ICONS).map(([kind, Icon]) => (
        <Icon key={kind} className={className} />
      ))}
    </span>
  )
}

const EVENT_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
/** Made when used: the hour is written as the region writes it now. */
const EVENT_TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })

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
  const m = messagesNow(MESSAGES)

  if (source.kind === 'message') {
    return source.subject ? `${source.from} · ${m.quoted(source.subject)}` : source.from
  }

  if (source.kind === 'event') {
    if (source.title === null || source.start === null) {
      return m.eventGone
    }

    const { formatLocale } = languageNow()
    const start = new Date(source.start)
    const day = new Intl.DateTimeFormat(formatLocale, EVENT_DAY).format(start)
    const when = source.allDay
      ? day
      : `${day} ${new Intl.DateTimeFormat(formatLocale, EVENT_TIME()).format(start)}`
    return m.event(source.title, when)
  }

  return m.saidByYou
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
