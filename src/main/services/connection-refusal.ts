import { currentLanguage, messages } from '@main/i18n'
import { REFUSAL_LINES, type ConnectionRefusal } from '@shared/models'

import { MicrosoftSignInNeeded } from './microsoft-oauth'

/**
 * The answers of an IMAP server that refuse for now, not for good (RFC
 * 5530): the server unavailable, the account busy or at its limit of
 * connections. A login refused with one of these is tried again.
 */
const PASSING_IMAP_CODES = new Set(['UNAVAILABLE', 'INUSE', 'LIMIT', 'SERVERBUG', 'THROTTLED'])

/**
 * The answers of an IMAP server that refuse the login itself, for good (RFC
 * 5530): wrong credentials, no right to this mailbox, a password expired.
 * Any other login refused — Gmail's "[ALERT] Too many simultaneous
 * connections", Office 365's bare "AUTHENTICATE failed" — may be the server's
 * "not now" in disguise.
 */
const DEFINITE_IMAP_CODES = new Set(['AUTHENTICATIONFAILED', 'AUTHORIZATIONFAILED', 'EXPIRED'])

/** Node's codes for a server certificate that cannot be trusted. */
const CERTIFICATE_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH'
])

/** The OAuth answers that withdraw an authorization: only signing in again restores it. */
const WITHDRAWN_GRANTS = /\b(invalid_grant|unauthorized_client|invalid_client)\b/

function field(error: unknown, name: string): unknown {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[name] : undefined
}

/**
 * Whether an error turns a connection down for good — retrying cannot fix
 * it, the user can — and why; null for an error that passes (the network,
 * a server down or busy, a timeout), which is tried again by itself.
 */
export function refusalOf(error: unknown): ConnectionRefusal | null {
  if (error instanceof MicrosoftSignInNeeded) {
    return 'autorizzazione'
  }

  const code = field(error, 'code')

  if (typeof code === 'string' && CERTIFICATE_CODES.has(code)) {
    return 'certificato'
  }

  // Google's token refused, as the library reports it: in the answer's body, or its message.
  const data = field(field(error, 'response'), 'data')
  const grant = field(data, 'error')

  if (
    (typeof grant === 'string' && WITHDRAWN_GRANTS.test(grant)) ||
    (error instanceof Error && WITHDRAWN_GRANTS.test(error.message))
  ) {
    return 'autorizzazione'
  }

  if (field(error, 'authenticationFailed') === true) {
    const answer = field(error, 'serverResponseCode')
    return typeof answer === 'string' && PASSING_IMAP_CODES.has(answer.toUpperCase())
      ? null
      : 'accesso'
  }

  return null
}

/**
 * What the server said, in its own words, for the user to read with the
 * refusal: IMAP's answer with its code, the OAuth server's description, or
 * the error's message.
 */
export function serverWords(error: unknown): string {
  const answer = field(error, 'responseText')
  const code = field(error, 'serverResponseCode')

  if (typeof answer === 'string' && answer.trim()) {
    return typeof code === 'string' ? `${answer.trim()} [${code}]` : answer.trim()
  }

  const data = field(field(error, 'response'), 'data')
  const description = field(data, 'error_description') ?? field(data, 'error')

  if (typeof description === 'string' && description.trim()) {
    return description.trim()
  }

  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a refusal may yet be a passing problem, to be confirmed by trying
 * once more a while later before the connection stops: a login refused
 * without one of the definite answers, or a certificate — on a hotel's
 * Wi-Fi, its sign-in page answers in the server's place. Two failed logins a
 * minute apart lock no account.
 */
export function refusalNeedsConfirming(error: unknown): boolean {
  const refusal = refusalOf(error)

  if (refusal === 'certificato') {
    return true
  }

  if (refusal !== 'accesso') {
    return false
  }

  const answer = field(error, 'serverResponseCode')
  return !(typeof answer === 'string' && DEFINITE_IMAP_CODES.has(answer.toUpperCase()))
}

/**
 * A refusal's line as it goes on after a colon — "stopped: the server no
 * longer accepts the sign-in" — in the interface's language. German keeps
 * its capitals, which its nouns and its «Sie» need.
 */
export function refusalClause(refusal: ConnectionRefusal): string {
  const line = messages(REFUSAL_LINES)[refusal]
  const language = currentLanguage()
  return language === 'de' ? line : `${line.charAt(0).toLocaleLowerCase(language)}${line.slice(1)}`
}
