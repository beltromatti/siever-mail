import { createHash } from 'node:crypto'

import { SyncTokenExpired, type CalendarProvider, type ProviderEvent } from './calendar-provider'
import { CalendarRequestError } from './calendar-refusal'
import { occurrencesOf } from './icalendar'

/** A link's one calendar, by this id. */
export const FEED_CALENDAR_ID = 'feed'
/** The most a calendar's file may weigh: past it, it is not a calendar to subscribe to. */
const MAX_FEED_BYTES = 20 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** A calendar file's text, read while it stays within a calendar's weight. */
export async function calendarText(response: Response): Promise<string> {
  const tooLarge = (): Error => new Error('Il file del calendario è troppo grande.')

  if (Number(response.headers.get('content-length') ?? 0) > MAX_FEED_BYTES) {
    throw tooLarge()
  }

  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength

    if (size > MAX_FEED_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }

    chunks.push(read.value)
  }

  return Buffer.concat(chunks).toString('utf8')
}

/** A calendar's link as it is fetched: `webcal://` is `https://`. */
export function feedUrl(link: string): string {
  const trimmed = link.trim()
  const url = new URL(
    /^webcals?:\/\//i.test(trimmed) ? trimmed.replace(/^webcals?/i, 'https') : trimmed
  )

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Il link di un calendario comincia con https:// o webcal://.')
  }

  return url.toString()
}

/**
 * What the token of a link's last read says: its ETag, its Last-Modified,
 * or — when the server gives neither — a fingerprint of the file.
 */
type Validator = { kind: 'etag' | 'lm' | 'sha'; value: string }

function validatorOf(token: string): Validator | null {
  const [kind, ...rest] = token.split(':')
  return kind === 'etag' || kind === 'lm' || kind === 'sha' ? { kind, value: rest.join(':') } : null
}

/**
 * A calendar published at a link (an .ics file, `webcal://`): read only,
 * read again as a whole when it changed — asked of the server with its
 * ETag or date, so an unchanged calendar is not downloaded again.
 */
export class IcsCalendarProvider implements CalendarProvider {
  /** The file read to find out it changed, kept for the read in full that follows. */
  private read: { text: string; token: string } | null = null

  constructor(
    private readonly url: string,
    private readonly name: string,
    private readonly fetch: Fetch
  ) {}

  async listCalendars(): Promise<
    Array<{
      calendarId: string
      name: string
      primary: boolean
      writable: boolean
      color: string | null
    }>
  > {
    return [
      {
        calendarId: FEED_CALENDAR_ID,
        name: this.name,
        primary: false,
        writable: false,
        color: null
      }
    ]
  }

  async changes(
    calendarId: string,
    since: { syncToken: string } | { fromIso: string; toIso: string }
  ): Promise<{ events: ProviderEvent[]; syncToken: string | null }> {
    if ('syncToken' in since) {
      const validator = validatorOf(since.syncToken)
      const fetched = await this.download(validator)

      if (!fetched || (validator?.kind === 'sha' && fetched.token === since.syncToken)) {
        return { events: [], syncToken: since.syncToken }
      }

      // Changed: read again in full, with the file already here.
      this.read = fetched
      throw new SyncTokenExpired()
    }

    const read = this.read ?? (await this.download(null))
    this.read = null

    if (!read) {
      throw new Error('Il calendario non ha risposto.')
    }

    const events = occurrencesOf(read.text, {
      from: Date.parse(since.fromIso),
      to: Date.parse(since.toIso)
    }).map((occurrence): ProviderEvent => {
      const { recurrenceId, ...event } = occurrence
      const uid =
        occurrence.iCalUid ??
        createHash('sha256')
          .update(`${occurrence.title}\u0000${occurrence.start}`)
          .digest('hex')
          .slice(0, 24)

      return { ...event, calendarId, eventId: recurrenceId ? `${uid}/${recurrenceId}` : uid }
    })

    return { events, syncToken: read.token }
  }

  /** The file, or null when the server says it has not changed since `validator`. */
  private async download(
    validator: Validator | null
  ): Promise<{ text: string; token: string } | null> {
    const headers: Record<string, string> = { Accept: 'text/calendar, */*;q=0.5' }

    if (validator?.kind === 'etag') {
      headers['If-None-Match'] = validator.value
    } else if (validator?.kind === 'lm') {
      headers['If-Modified-Since'] = validator.value
    }

    const response = await this.fetch(this.url, {
      headers,
      // The browser's cache would answer for the server: a read asks the server, every time.
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })

    if (response.status === 304) {
      return null
    }

    // Not at the link any more: the link is the whole calendar, gone with it.
    if (!response.ok) {
      const gone = response.status === 404 || response.status === 410
      throw new CalendarRequestError(
        gone
          ? 'Il calendario non è più a quel link.'
          : `Il server del calendario ha risposto ${response.status}.`,
        { status: response.status, refusal: gone ? 'sparito' : null }
      )
    }

    const text = await calendarText(response)

    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('A quel link non c’è un calendario (.ics).')
    }

    const etag = response.headers.get('etag')
    const modified = response.headers.get('last-modified')
    const token = etag
      ? `etag:${etag}`
      : modified
        ? `lm:${modified}`
        : `sha:${createHash('sha256').update(text).digest('hex')}`

    return { text, token }
  }

  async create(): Promise<ProviderEvent> {
    throw readOnly()
  }

  async update(): Promise<ProviderEvent> {
    throw readOnly()
  }

  async remove(): Promise<void> {
    throw readOnly()
  }

  async respond(): Promise<ProviderEvent> {
    throw readOnly()
  }
}

function readOnly(): Error {
  return new Error('Un calendario da un link si legge soltanto.')
}
