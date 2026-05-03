import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'

import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'

import { extractErrorDetails, logMainError } from '@main/utils/error-utils'
import type { AddImapAccountInput, ComposeMailInput, MailAccount } from '@shared/models'

import type { GoogleOAuthService } from '../google-oauth'

export interface AccountWithSecret extends MailAccount {
  secret: string
}

export const IMAP_CONNECTION_TIMEOUT_MS = 20_000
export const IMAP_GREETING_TIMEOUT_MS = 20_000
export const IMAP_SOCKET_TIMEOUT_MS = 5 * 60_000
export const IMAP_MAX_IDLE_TIME_MS = 28 * 60_000

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
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
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
  return secure ? 'SSL/TLS' : 'STARTTLS/TLS opportunistico'
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

export async function verifyImapAccount(
  input: AddImapAccountInput,
  googleOAuthService: GoogleOAuthService
): Promise<void> {
  void googleOAuthService

  const client = new ImapFlow({
    host: input.imapHost,
    port: input.imapPort,
    secure: input.imapSecure,
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
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.smtpSecure,
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
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: {
        user: account.username,
        pass: account.secret
      }
    })
  }

  const accessToken = await googleOAuthService.getAccessToken(account.secret)

  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
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
    from: `${account.displayName} <${account.email}>`,
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
  const composer = new MailComposer(payload)

  return new Promise<Buffer>((resolveBuild, rejectBuild) => {
    composer.compile().build((error, rawMessage) => {
      if (error) {
        rejectBuild(error)
        return
      }

      resolveBuild(Buffer.from(rawMessage))
    })
  })
}
