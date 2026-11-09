/**
 * When an event is to be reminded of (vision §13.3): at the times it sets
 * itself, as its calendar keeps them; one that says nothing of them, at the
 * lead the user chose — not an all-day one, a birthday or a holiday, which
 * has no hour to be on time for. One the user declined, none.
 */

/** An event's start and end as instants: an all-day one's by local midnight. */
export function instantsOf(event: { start: string; end: string; allDay: boolean }): {
  startsAt: number
  endsAt: number
} {
  const instant = (value: string): number => {
    if (!event.allDay) {
      return Date.parse(value)
    }

    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day).getTime()
  }

  return { startsAt: instant(event.start), endsAt: instant(event.end) }
}

/** An event as its reminders are reckoned. */
export interface RemindedEvent {
  key: string
  title: string
  calendarName: string
  allDay: boolean
  startsAt: number
  endsAt: number
  location: string | null
  meetLink: string | null
  /** Its own, in minutes before it starts; none when it has them off; null when it says nothing. */
  reminders: number[] | null
}

export interface Reminder {
  event: RemindedEvent
  /** When it is due. */
  at: number
  minutes: number
  /**
   * Given once: the same reminder of the same occurrence is not given again.
   * Kept on disk, so plain text — an event's key holds characters a stored
   * text would cut at.
   */
  key: string
}

/** Every reminder of these events, the earliest first. */
export function remindersOf(
  events: ReadonlyArray<RemindedEvent>,
  defaultLead: number | null
): Reminder[] {
  return events
    .flatMap((event) => {
      const minutes =
        event.reminders && event.reminders.length > 0
          ? event.reminders
          : event.reminders === null && !event.allDay && defaultLead !== null
            ? [defaultLead]
            : []

      return [...new Set(minutes)].map((lead) => ({
        event,
        at: event.startsAt - lead * 60_000,
        minutes: lead,
        key: JSON.stringify([event.key, event.startsAt, lead])
      }))
    })
    .sort((a, b) => a.at - b.at)
}

const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

function startOfDay(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** «oggi», «domani», or the day in words: «giovedì 14 novembre». */
export function dayWords(at: number, now: number): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)
  return days === 0 ? 'oggi' : days === 1 ? 'domani' : days === -1 ? 'ieri' : DAY.format(at)
}

/** «1 ora e 30 minuti», «10 minuti», «1 minuto». */
function durationWords(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const minuteWords = (count: number): string => (count === 1 ? '1 minuto' : `${count} minuti`)

  if (hours === 0) {
    return minuteWords(minutes)
  }

  const hourWords = hours === 1 ? '1 ora' : `${hours} ore`
  return rest === 0 ? hourWords : `${hourWords} e ${minuteWords(rest)}`
}

/**
 * When an event starts, as a reminder says it: «Fra 10 minuti · 15:00»,
 * «Adesso · 15:00», «Domani alle 9:00» — for an all-day one, its day.
 */
export function startWords(event: Pick<RemindedEvent, 'allDay' | 'startsAt'>, now: number): string {
  const day = dayWords(event.startsAt, now)

  if (event.allDay) {
    return `${day.charAt(0).toUpperCase()}${day.slice(1)}, tutto il giorno`
  }

  const time = TIME.format(event.startsAt)
  const ahead = event.startsAt - now

  if (ahead < 60_000) {
    return `Adesso · ${time}`
  }

  if (ahead <= 12 * 3_600_000) {
    return `Fra ${durationWords(ahead)} · ${time}`
  }

  return `${day.charAt(0).toUpperCase()}${day.slice(1)} alle ${time}`
}

/** When an event is, in a line: «giovedì 14 novembre, 10:00–11:00», «oggi, tutto il giorno». */
export function whenWords(
  event: Pick<RemindedEvent, 'allDay' | 'startsAt' | 'endsAt'>,
  now: number
): string {
  const day = dayWords(event.startsAt, now)

  return event.allDay
    ? `${day}, tutto il giorno`
    : `${day}, ${TIME.format(event.startsAt)}–${TIME.format(event.endsAt)}`
}
