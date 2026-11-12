import { messages } from '@main/i18n'
import { refusalOf } from '@main/services/connection-refusal'
import { defineMessages } from '@shared/i18n'
import type { ConnectionRefusal } from '@shared/models'

/**
 * A provider's request that failed, in the user's words, with what tells
 * how it failed: the server's status, and — decided by the provider, who
 * knows what was asked — whether it turns the whole connection down
 * (`refusal`): its access, its authorization, its source. One that fails a
 * calendar or an event alone, or passes, has none. What the server said,
 * when it said more, is the `cause`.
 */
export class CalendarRequestError extends Error {
  readonly status: number | null
  readonly refusal: ConnectionRefusal | null

  constructor(
    message: string,
    options: { status?: number | null; refusal?: ConnectionRefusal | null; cause?: unknown }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CalendarRequestError'
    this.status = options.status ?? null
    this.refusal = options.refusal ?? null
  }
}

/**
 * Chromium's certificate errors, as Electron's `net.fetch` rejects with
 * them (`net::ERR_CERT_DATE_INVALID`…) — but for the revocation that could
 * not be checked, which is the network's, not the certificate's.
 */
const CHROMIUM_CERTIFICATE =
  /\bnet::ERR_CERT(?:IFICATE)?_(?!UNABLE_TO_CHECK_REVOCATION\b|NO_REVOCATION_MECHANISM\b)[A-Z_]+/

/** What the user is told of a connection turned down, where its error is not in their words. */
const REFUSAL_PROBLEMS = defineMessages({
  accesso: {
    en: 'The calendar’s server no longer accepts the sign-in: reconnect the calendar.',
    it: 'Il server del calendario non accetta più l’accesso: ricollega il calendario.',
    de: 'Der Server des Kalenders akzeptiert die Anmeldung nicht mehr: Verbinden Sie den Kalender erneut.'
  },
  autorizzazione: {
    en: 'The authorization to read the calendar is no longer valid: reconnect it.',
    it: 'L’autorizzazione a leggere il calendario non vale più: ricollegalo.',
    de: 'Die Berechtigung, den Kalender zu lesen, ist nicht mehr gültig: Verbinden Sie ihn erneut.'
  },
  certificato: {
    en: 'The certificate of the calendar’s server isn’t valid: SIEVER Mail won’t connect to it.',
    it: 'Il certificato del server del calendario non è valido: SIEVER Mail non vi si collega.',
    de: 'Das Zertifikat des Kalenderservers ist nicht gültig: SIEVER Mail verbindet sich nicht damit.'
  },
  sparito: {
    en: 'The calendar is no longer where it was connected.',
    it: 'Il calendario non si trova più dove era collegato.',
    de: 'Der Kalender ist nicht mehr dort, wo er verbunden war.'
  }
}) satisfies Record<ConnectionRefusal, unknown>

function causeOf(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined
}

/** The error and the ones it came from, the outermost first. */
function chainOf(error: unknown): unknown[] {
  const chain = [error]

  for (let cause = causeOf(error); cause != null && chain.length < 6; cause = causeOf(cause)) {
    chain.push(cause)
  }

  return chain
}

function messageOf(error: unknown): string {
  const message =
    error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  return typeof message === 'string' ? message : String(error)
}

/** A calendar connection turned down for good: why, what the user is told, what the server said. */
export interface CalendarRefusalFound {
  refusal: ConnectionRefusal
  problem: string
  detail: string
}

/**
 * Whether an error turns a calendar connection down for good — retrying
 * cannot fix it, the user can — and why: as its provider decided
 * (`CalendarRequestError`), or as any connection is turned down
 * (`refusalOf`: a sign-in withdrawn, a certificate not trusted) at any
 * depth of what it came from. Null for one that passes — the network, a
 * server down or busy, a timeout — or that fails its request alone.
 */
export function refusalOfCalendar(error: unknown): CalendarRefusalFound | null {
  const chain = chainOf(error)
  const innermost = chain[chain.length - 1]
  const detail =
    innermost instanceof CalendarRequestError && innermost.status !== null
      ? `${innermost.message} (HTTP ${innermost.status})`
      : messageOf(innermost)

  for (const link of chain) {
    if (link instanceof CalendarRequestError && link.refusal) {
      return { refusal: link.refusal, problem: link.message, detail }
    }

    const refusal =
      refusalOf(link) ?? (CHROMIUM_CERTIFICATE.test(messageOf(link)) ? 'certificato' : null)

    if (refusal) {
      return { refusal, problem: messages(REFUSAL_PROBLEMS)[refusal], detail }
    }
  }

  return null
}
