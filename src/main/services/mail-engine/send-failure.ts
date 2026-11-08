import { refusalOf } from '../connection-refusal'

/**
 * What a failed send means for the message (§14):
 *   • 'passing'   — it never reached the server's hands (no network, the
 *                   server unreachable, a temporary refusal): it waits in
 *                   the outbox and goes by itself when the server answers;
 *   • 'uncertain' — it broke off while the message was going: it may have
 *                   gone, so it is not sent again by itself — the user decides;
 *   • 'refused'   — the server turned it down (the access, a recipient, the
 *                   size): said with the reason, and it stays in Bozze.
 */
export type SendFailure = 'passing' | 'uncertain' | 'refused'

/** Node's codes for a connection that could not open, or broke. */
const NETWORK = new Set([
  'ECONNECTION',
  'EDNS',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNRESET',
  'EPIPE'
])

function field(error: unknown, name: string): unknown {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[name] : undefined
}

/** How a send failed, from nodemailer's error — or Graph's, or the token's — and the network. */
export function sendFailureOf(error: unknown, online: boolean): SendFailure {
  const code = field(error, 'code')
  // Where it broke: nodemailer names the step of its session, Graph's sends say "GRAPH"; none,
  // before anything was handed over.
  const command = String(field(error, 'command') ?? '')

  // The network went: before the session nothing went; within it, the message may have.
  if (!online) {
    return command === '' ? 'passing' : 'uncertain'
  }

  if (refusalOf(error) || code === 'EAUTH') {
    return 'refused'
  }

  // The provider's token not fetched — the network, its server: nothing was handed over yet.
  if (field(error, 'beforeSending') === true) {
    return 'passing'
  }

  const answer = Number(field(error, 'responseCode'))
  const status = Number(field(error, 'status'))

  // A reply in 4xx is the server saying "not now": the message is not taken, at any step.
  if ((answer >= 400 && answer < 500) || status === 429 || status === 503) {
    return 'passing'
  }

  if (answer >= 500 || (status >= 400 && status < 500)) {
    return 'refused'
  }

  // The network failed. Before the SMTP session — the socket SIEVER Mail opens (`openSmtpSocket`),
  // the provider's token — nothing was handed over: those errors carry no command. Within the
  // session nodemailer names a timeout or a dropped link "CONN" whatever the step, the message
  // itself included: it may have gone.
  if (typeof code === 'string' && NETWORK.has(code)) {
    return command === '' ? 'passing' : 'uncertain'
  }

  return 'uncertain'
}
