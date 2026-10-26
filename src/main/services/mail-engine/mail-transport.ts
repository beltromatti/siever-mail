import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connect as connectSocket, type Socket } from 'node:net'

import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'

import { extractErrorDetails, logMainError } from '@main/utils/error-utils'
import type {
  AddImapAccountInput,
  ComposeMailInput,
  MailAccount,
  MailAddress
} from '@shared/models'

import type { GoogleOAuthService } from '../google-oauth'

export interface AccountWithSecret extends MailAccount {
  secret: string
}

export const IMAP_CONNECTION_TIMEOUT_MS = 20_000
export const IMAP_GREETING_TIMEOUT_MS = 20_000
// Silence after which a link counts as dead. During IDLE imapflow answers it
// with a NOOP and goes back to idling, so it doubles as a heartbeat; any
// other command left without a reply this long fails, and the connection is
// rebuilt instead of hanging.
export const IMAP_SOCKET_TIMEOUT_MS = 2 * 60_000
export const IMAP_MAX_IDLE_TIME_MS = 28 * 60_000
/** How long reaching the SMTP server may take, all its addresses tried. */
const SMTP_CONNECTION_TIMEOUT_MS = 20_000

const INLINE_MEDIA_DATA_URL_PATTERN = /<img\b([^>]*?)\bsrc=(['"])(data:[^'"]+)\2([^>]*)>/gi
const INLINE_MEDIA_MIME_TYPE_PATTERN = /^image\/[a-z0-9.+-]+$/i
const INLINE_MEDIA_BASE64_PATTERN = /;base64/i
const INLINE_MEDIA_MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff'
}

export interface OutgoingMessagePayload {
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references?: string[]
  attachments: Array<{
    filename: string
    path?: string
    content?: Buffer
    cid?: string
    contentType?: string
    contentDisposition?: 'inline' | 'attachment'
  }>
  /** Set for a draft's versions; a message sent gets one of its own. */
  messageId?: string
  date?: Date
  headers?: Record<string, string>
  /** A draft keeps its Bcc header; a message sent never carries it. */
  keepBcc?: boolean
}

function parseInlineMediaDataUrl(dataUrl: string): { mimeType: string; content: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+)((?:;[^,]*)*),(.*)$/i)

  if (!match) {
    return null
  }

  const mimeType = (match[1] || '').trim().toLowerCase()

  if (!mimeType || !INLINE_MEDIA_MIME_TYPE_PATTERN.test(mimeType) || mimeType === 'image/svg+xml') {
    return null
  }

  const metadata = match[2] || ''
  const payload = match[3] || ''
  const isBase64 = INLINE_MEDIA_BASE64_PATTERN.test(metadata)

  try {
    const content = isBase64
      ? Buffer.from(payload.replace(/\s+/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')

    if (content.length === 0) {
      return null
    }

    return { mimeType, content }
  } catch {
    return null
  }
}

function resolveInlineMediaExtension(mimeType: string): string {
  return INLINE_MEDIA_MIME_TO_EXTENSION[mimeType] || mimeType.split('/')[1] || 'bin'
}

export function extractInlineMediaAttachments(html: string): {
  html: string
  attachments: OutgoingMessagePayload['attachments']
} {
  if (!html.includes('data:image/')) {
    return { html, attachments: [] }
  }

  const attachments: OutgoingMessagePayload['attachments'] = []
  const cidByDataUrl = new Map<string, string>()
  let index = 0

  const nextHtml = html.replace(
    INLINE_MEDIA_DATA_URL_PATTERN,
    (fullMatch, leftChunk: string, quote: string, dataUrl: string, rightChunk: string) => {
      const parsed = parseInlineMediaDataUrl(dataUrl)

      if (!parsed) {
        return fullMatch
      }

      let cid = cidByDataUrl.get(dataUrl)

      if (!cid) {
        cid = `${randomUUID()}@inline-media.local`
        cidByDataUrl.set(dataUrl, cid)

        const extension = resolveInlineMediaExtension(parsed.mimeType)
        index += 1
        attachments.push({
          filename: `inline-media-${index}.${extension}`,
          content: parsed.content,
          cid,
          contentType: parsed.mimeType,
          contentDisposition: 'inline'
        })
      }

      return `<img${leftChunk}src=${quote}cid:${cid}${quote}${rightChunk}>`
    }
  )

  return { html: nextHtml, attachments }
}

function formatConnectionMode(secure: boolean): string {
  return secure ? 'SSL/TLS' : 'STARTTLS'
}

export function composeImapVerificationError(input: AddImapAccountInput, error: unknown): Error {
  const details = extractErrorDetails(error)

  const lines = [
    `Connessione IMAP fallita su ${input.imapHost}:${input.imapPort} (${formatConnectionMode(input.imapSecure)}).`,
    `Utente: ${input.username}`
  ]

  if (details.serverResponseCode) {
    lines.push(`Codice server: ${details.serverResponseCode}`)
  }

  if (details.executedCommand) {
    lines.push(`Comando IMAP: ${details.executedCommand}`)
  }

  if (details.responseText) {
    lines.push(`Risposta server: ${details.responseText}`)
  } else if (details.message) {
    lines.push(`Dettaglio: ${details.message}`)
  }

  if (details.authenticationFailed || details.serverResponseCode === 'AUTHENTICATIONFAILED') {
    lines.push(
      'Suggerimento: credenziali non accettate dal server IMAP o account bloccato/disabilitato lato provider.'
    )
  }

  return new Error(lines.join('\n'))
}

export function composeSmtpVerificationError(input: AddImapAccountInput, error: unknown): Error {
  const details = extractErrorDetails(error)

  const lines = [
    `Connessione SMTP fallita su ${input.smtpHost}:${input.smtpPort} (${formatConnectionMode(input.smtpSecure)}).`,
    `Utente: ${input.username}`
  ]

  if (details.code) {
    lines.push(`Codice errore: ${details.code}`)
  }

  if (details.response) {
    lines.push(`Risposta server: ${details.response}`)
  } else if (details.message) {
    lines.push(`Dettaglio: ${details.message}`)
  }

  if (details.code === 'ETIMEDOUT') {
    lines.push(
      'Suggerimento: porta SMTP bloccata/firewall oppure porta/modalità SSL errata (prova 465 SSL o 587 STARTTLS).'
    )
  }

  return new Error(lines.join('\n'))
}

/**
 * An account's connection is encrypted one way or the other: SSL/TLS from
 * the first byte (`secure`), or STARTTLS — which is then required, so a
 * server that stops offering it is refused rather than spoken to in clear.
 */
export function imapEncryption(secure: boolean): { secure: boolean; doSTARTTLS?: true } {
  return secure ? { secure } : { secure, doSTARTTLS: true }
}

function smtpEncryption(secure: boolean): { secure: boolean; requireTLS?: true } {
  return secure ? { secure } : { secure, requireTLS: true }
}

/**
 * The connection a message goes out on, opened by Node rather than by
 * nodemailer. Nodemailer connects to one of the server's addresses picked
 * at random, IPv6 ones too wherever the machine has an IPv6 interface — and
 * the link-local one nearly every Mac and PC has is enough — so on a
 * network without IPv6 a message could wait out the whole connection
 * timeout before going. Node tries the addresses in turn, IPv6 and IPv4
 * interleaved (Happy Eyeballs, RFC 8305), as it does for imapflow's IMAP
 * connections; nodemailer speaks TLS and SMTP over the socket it is given.
 */
function openSmtpSocket(
  options: { host: string; port: number },
  callback: (error: Error | null, socketOptions?: { connection: Socket }) => void
): void {
  let settled = false
  const socket = connectSocket({ host: options.host, port: options.port, autoSelectFamily: true })
  const settle = (error: Error | null): void => {
    if (settled) {
      return
    }

    settled = true
    clearTimeout(timer)

    if (error) {
      socket.destroy()
      callback(error)
    } else {
      callback(null, { connection: socket })
    }
  }
  const timer = setTimeout(
    () =>
      settle(
        Object.assign(new Error(`Nessuna risposta da ${options.host}:${options.port}.`), {
          code: 'ETIMEDOUT'
        })
      ),
    SMTP_CONNECTION_TIMEOUT_MS
  )

  // Stays on once connected: an error nodemailer no longer listens for —
  // the plain socket under TLS — is not left to bring the app down.
  socket.on('error', (error) => settle(error))
  socket.once('connect', () => settle(null))
}

/** How every SMTP connection is made: see `openSmtpSocket`. */
function smtpConnection(
  host: string,
  port: number,
  secure: boolean
): {
  host: string
  port: number
  secure: boolean
  requireTLS?: true
  getSocket: typeof openSmtpSocket
} {
  return { host, port, ...smtpEncryption(secure), getSocket: openSmtpSocket }
}

export async function verifyImapAccount(
  input: AddImapAccountInput,
  googleOAuthService: GoogleOAuthService
): Promise<void> {
  void googleOAuthService

  const client = new ImapFlow({
    host: input.imapHost,
    port: input.imapPort,
    ...imapEncryption(input.imapSecure),
    auth: {
      user: input.username,
      pass: input.password
    },
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    disableAutoIdle: true,
    logger: false
  })

  try {
    try {
      await client.connect()
    } catch (error) {
      logMainError('IMAP account verification failed', error, {
        host: input.imapHost,
        port: input.imapPort,
        secure: input.imapSecure,
        username: input.username
      })
      throw composeImapVerificationError(input, error)
    }
  } finally {
    await client.logout().catch(() => undefined)
  }

  const transport = nodemailer.createTransport({
    ...smtpConnection(input.smtpHost, input.smtpPort, input.smtpSecure),
    auth: {
      user: input.username,
      pass: input.password
    }
  })

  try {
    await transport.verify()
  } catch (error) {
    logMainError('SMTP account verification failed', error, {
      host: input.smtpHost,
      port: input.smtpPort,
      secure: input.smtpSecure,
      username: input.username
    })
    throw composeSmtpVerificationError(input, error)
  } finally {
    transport.close()
  }
}

export async function resolveImapAuth(
  account: AccountWithSecret,
  googleOAuthService: GoogleOAuthService
): Promise<{ user: string; pass?: string; accessToken?: string }> {
  if (account.authType === 'password') {
    return {
      user: account.username,
      pass: account.secret
    }
  }

  const accessToken = await googleOAuthService.getAccessToken(account.secret)

  return {
    user: account.username,
    accessToken
  }
}

export async function createSmtpTransport(
  account: AccountWithSecret,
  googleOAuthService: GoogleOAuthService
): Promise<nodemailer.Transporter> {
  if (account.authType === 'password') {
    return nodemailer.createTransport({
      ...smtpConnection(account.smtpHost, account.smtpPort, account.smtpSecure),
      auth: {
        user: account.username,
        pass: account.secret
      }
    })
  }

  const accessToken = await googleOAuthService.getAccessToken(account.secret)

  return nodemailer.createTransport({
    ...smtpConnection(account.smtpHost, account.smtpPort, account.smtpSecure),
    auth: {
      type: 'OAuth2',
      user: account.username,
      accessToken
    }
  })
}

export function createOutgoingMessagePayload(
  account: AccountWithSecret,
  input: ComposeMailInput
): OutgoingMessagePayload {
  const inlineMedia = extractInlineMediaAttachments(input.html)

  return {
    // An object, not "Name <address>": a name with a comma read as two senders.
    from: { name: account.displayName, address: account.email },
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: inlineMedia.html,
    text: input.text,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: [
      ...input.attachments.map((attachment) => ({
        filename: attachment.name || basename(attachment.path),
        path: attachment.path,
        contentDisposition: 'attachment' as const
      })),
      ...inlineMedia.attachments
    ]
  }
}

export async function buildRawOutgoingMessage(payload: OutgoingMessagePayload): Promise<Buffer> {
  const message = new MailComposer(payload).compile()
  // nodemailer reads it off the built message, as its own file transports set it.
  message.keepBcc = payload.keepBcc ?? false

  return new Promise<Buffer>((resolveBuild, rejectBuild) => {
    message.build((error, rawMessage) => {
      if (error) {
        rejectBuild(error)
        return
      }

      resolveBuild(Buffer.from(rawMessage))
    })
  })
}
