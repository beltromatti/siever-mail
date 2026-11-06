import type { DayLine, HandleLink } from '@shared/segretario'

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

/** What a line opens, as a link: its message or its event; the user's word opens nothing. */
export function dayLineLink(line: DayLine): HandleLink | null {
  const { source } = line
  return source.kind === 'message'
    ? { handle: '', kind: 'message', ref: source.ref, messageKey: source.messageKey }
    : source.kind === 'event'
      ? { handle: '', kind: 'event', eventKey: source.eventKey, title: source.title }
      : null
}
