import { refusalOf } from '@main/services/connection-refusal'
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
const REFUSAL_PROBLEMS: Readonly<Record<ConnectionRefusal, string>> = {
  accesso: 'Il server del calendario non accetta più l’accesso: ricollega il calendario.',
  autorizzazione: 'L’autorizzazione a leggere il calendario non vale più: ricollegalo.',
  certificato:
    'Il certificato del server del calendario non è valido: SIEVER Mail non vi si collega.',
  sparito: 'Il calendario non si trova più dove era collegato.'
}

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
      return { refusal, problem: REFUSAL_PROBLEMS[refusal], detail }
    }
  }

  return null
}
