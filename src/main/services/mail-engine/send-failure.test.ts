import { describe, expect, it } from 'vitest'

import { sendFailureOf } from './send-failure'

/** An error as nodemailer gives a send that failed. */
const smtp = (fields: { code?: string; command?: string; responseCode?: number }): Error =>
  Object.assign(new Error('Send failed'), fields)

describe('sendFailureOf', () => {
  it('keeps for later what never reached the server: the socket, or the token, failed first', () => {
    expect(sendFailureOf(smtp({ code: 'ECONNREFUSED' }), true)).toBe('passing')
    expect(sendFailureOf(smtp({ code: 'ENOTFOUND' }), true)).toBe('passing')
    expect(sendFailureOf(smtp({ code: 'ETIMEDOUT' }), true)).toBe('passing')
    expect(sendFailureOf(smtp({ code: 'ECONNRESET' }), false)).toBe('passing')
    expect(sendFailureOf(new Error('net::ERR_INTERNET_DISCONNECTED'), false)).toBe('passing')
    expect(
      sendFailureOf(Object.assign(new Error('network_error'), { beforeSending: true }), true)
    ).toBe('passing')
  })

  it('keeps for later what the server put off: a 4xx reply, a Graph 429 or 503', () => {
    expect(sendFailureOf(smtp({ code: 'EENVELOPE', responseCode: 421 }), true)).toBe('passing')
    expect(sendFailureOf(smtp({ code: 'EMESSAGE', responseCode: 451 }), true)).toBe('passing')
    expect(sendFailureOf(Object.assign(new Error('Graph'), { status: 429 }), true)).toBe('passing')
    expect(sendFailureOf(Object.assign(new Error('Graph'), { status: 503 }), true)).toBe('passing')
  })

  it('says a refusal: the access, a recipient, the size — and a Graph 4xx', () => {
    expect(sendFailureOf(smtp({ code: 'EAUTH', command: 'AUTH PLAIN' }), true)).toBe('refused')
    expect(sendFailureOf(smtp({ code: 'EENVELOPE', responseCode: 550 }), true)).toBe('refused')
    expect(sendFailureOf(smtp({ code: 'EMESSAGE', responseCode: 552 }), true)).toBe('refused')
    expect(sendFailureOf(Object.assign(new Error('Graph'), { status: 400 }), true)).toBe('refused')
  })

  it('does not send again by itself what broke off within the session: it may have gone', () => {
    // nodemailer says "CONN" for a timeout or a dropped link at any step, the message included.
    expect(sendFailureOf(smtp({ code: 'ETIMEDOUT', command: 'CONN' }), true)).toBe('uncertain')
    expect(sendFailureOf(smtp({ code: 'ECONNECTION', command: 'CONN' }), true)).toBe('uncertain')
    expect(sendFailureOf(smtp({ code: 'ESOCKET', command: 'CONN' }), false)).toBe('uncertain')
    expect(sendFailureOf(smtp({ code: 'ECONNRESET', command: 'GRAPH' }), true)).toBe('uncertain')
    expect(sendFailureOf(Object.assign(new Error('Graph'), { status: 502 }), true)).toBe(
      'uncertain'
    )
    expect(sendFailureOf(new Error('Something odd'), true)).toBe('uncertain')
  })
})
