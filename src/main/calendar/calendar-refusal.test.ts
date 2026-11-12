import { describe, expect, it } from 'vitest'

import { MicrosoftSignInNeeded } from '@main/services/microsoft-oauth'

import { CalendarRequestError, refusalOfCalendar } from './calendar-refusal'
import { readableError } from './google-calendar'

/** An error as gaxios gives Google's answers: the status, the body, the error it came from. */
const gaxios = (message: string, status: number | undefined, extra: object = {}): Error =>
  Object.assign(new Error(message), { status, ...extra })

describe('refusalOfCalendar', () => {
  it('takes the refusal the provider decided, in its words, with what the server said', () => {
    expect(
      refusalOfCalendar(
        new CalendarRequestError('Il calendario non è più a quel link.', {
          status: 410,
          refusal: 'sparito'
        })
      )
    ).toEqual({
      refusal: 'sparito',
      problem: 'Il calendario non è più a quel link.',
      detail: 'Il calendario non è più a quel link. (HTTP 410)'
    })
  })

  it('finds a certificate not trusted at any depth, as Node and as Electron’s network say it', () => {
    const node = new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
    })

    expect(refusalOfCalendar(node)).toMatchObject({
      refusal: 'certificato',
      detail: 'certificate has expired'
    })
    expect(refusalOfCalendar(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toMatchObject({
      refusal: 'certificato',
      detail: 'net::ERR_CERT_AUTHORITY_INVALID'
    })
    expect(refusalOfCalendar(new Error('net::ERR_CERT_COMMON_NAME_INVALID'))?.refusal).toBe(
      'certificato'
    )
    // The revocation that could not be checked is the network's.
    expect(refusalOfCalendar(new Error('net::ERR_CERT_UNABLE_TO_CHECK_REVOCATION'))).toBeNull()
  })

  it('takes a sign-in to do again for the authorization withdrawn', () => {
    expect(refusalOfCalendar(new MicrosoftSignInNeeded())).toMatchObject({
      refusal: 'autorizzazione',
      detail: 'Microsoft asks you to sign in to this account again.'
    })
  })

  it('lets pass what passes: the network, a timeout, a server down or busy', () => {
    for (const passing of [
      new Error('net::ERR_INTERNET_DISCONNECTED'),
      new Error('net::ERR_NAME_NOT_RESOLVED'),
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' })
      }),
      new CalendarRequestError('Il server del calendario ha risposto 503.', { status: 503 })
    ]) {
      expect(refusalOfCalendar(passing)).toBeNull()
    }
  })
})

describe('readableError (Google)', () => {
  it('takes a token refused, withdrawn or without the calendar for the authorization withdrawn', () => {
    for (const withdrawn of [
      gaxios('Invalid Credentials', 401),
      gaxios('invalid_grant', 400, { response: { data: { error: 'invalid_grant' } } }),
      gaxios('Request had insufficient authentication scopes.', 403)
    ]) {
      const error = readableError(withdrawn)

      expect(error).toBeInstanceOf(CalendarRequestError)
      expect(refusalOfCalendar(error)).toMatchObject({
        refusal: 'autorizzazione',
        detail: withdrawn.message
      })
    }
  })

  it('leaves as it came a limit reached, a calendar refused, a server down', () => {
    for (const passing of [
      gaxios('Rate Limit Exceeded', 403),
      gaxios('Forbidden', 403),
      gaxios('Backend Error', 503)
    ]) {
      expect(readableError(passing)).toBe(passing)
      expect(refusalOfCalendar(readableError(passing))).toBeNull()
    }
  })
})
