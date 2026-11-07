import { describe, expect, it } from 'vitest'

import { refusalNeedsConfirming, refusalOf, serverWords } from './connection-refusal'
import { MicrosoftSignInNeeded } from './microsoft-oauth'

/** An error as imapflow gives a login the server turned down. */
const imapLogin = (serverResponseCode?: string): Error =>
  Object.assign(new Error('Command failed'), { authenticationFailed: true, serverResponseCode })

describe('refusalOf', () => {
  it('stops a mailbox whose login is refused, but not one the server only holds off for now', () => {
    expect(refusalOf(imapLogin())).toBe('accesso')
    expect(refusalOf(imapLogin('AUTHENTICATIONFAILED'))).toBe('accesso')
    expect(refusalOf(imapLogin('EXPIRED'))).toBe('accesso')

    for (const passing of ['UNAVAILABLE', 'INUSE', 'LIMIT', 'SERVERBUG', 'THROTTLED', 'inuse']) {
      expect(refusalOf(imapLogin(passing))).toBeNull()
    }
  })

  it('asks to sign in again when Google or Microsoft withdrew the authorization', () => {
    expect(refusalOf(new MicrosoftSignInNeeded())).toBe('autorizzazione')
    expect(
      refusalOf(
        Object.assign(new Error('Request failed'), {
          response: { status: 400, data: { error: 'invalid_grant' } }
        })
      )
    ).toBe('autorizzazione')
    expect(refusalOf(new Error('unauthorized_client: the client is not authorized'))).toBe(
      'autorizzazione'
    )
  })

  it('does not send the password to a server whose certificate cannot be trusted', () => {
    for (const code of [
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID'
    ]) {
      expect(refusalOf(Object.assign(new Error('TLS'), { code }))).toBe('certificato')
    }
  })

  it('lets what passes pass: the network, a server down or slow, a 5xx', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']) {
      expect(refusalOf(Object.assign(new Error('network'), { code }))).toBeNull()
    }

    expect(
      refusalOf(Object.assign(new Error('Server error'), { response: { status: 503, data: {} } }))
    ).toBeNull()
    expect(refusalOf('something odd')).toBeNull()
    expect(refusalOf(null)).toBeNull()
  })
})

describe('serverWords', () => {
  it('says what the server said: its answer and code, the OAuth description, or the message', () => {
    expect(
      serverWords(
        Object.assign(new Error('Command failed'), {
          responseText: 'Authentication failed.',
          serverResponseCode: 'AUTHENTICATIONFAILED'
        })
      )
    ).toBe('Authentication failed. [AUTHENTICATIONFAILED]')
    expect(
      serverWords(
        Object.assign(new Error('Request failed'), {
          response: {
            data: {
              error: 'invalid_grant',
              error_description: 'Token has been expired or revoked.'
            }
          }
        })
      )
    ).toBe('Token has been expired or revoked.')
    expect(serverWords(new Error('connect ECONNREFUSED 127.0.0.1:993'))).toBe(
      'connect ECONNREFUSED 127.0.0.1:993'
    )
  })
})

describe('refusalNeedsConfirming', () => {
  it('stops at once on a definite answer, and tries once more on one that may be "not now"', () => {
    expect(refusalNeedsConfirming(imapLogin('AUTHENTICATIONFAILED'))).toBe(false)
    expect(refusalNeedsConfirming(imapLogin('EXPIRED'))).toBe(false)
    // Gmail's "[ALERT] Too many simultaneous connections", Office 365's bare "AUTHENTICATE failed".
    expect(refusalNeedsConfirming(imapLogin('ALERT'))).toBe(true)
    expect(refusalNeedsConfirming(imapLogin())).toBe(true)
    // A hotel Wi-Fi's sign-in page answers in the server's place.
    expect(
      refusalNeedsConfirming(Object.assign(new Error('TLS'), { code: 'CERT_HAS_EXPIRED' }))
    ).toBe(true)
    expect(refusalNeedsConfirming(new MicrosoftSignInNeeded())).toBe(false)
    expect(refusalNeedsConfirming(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(
      false
    )
  })
})
