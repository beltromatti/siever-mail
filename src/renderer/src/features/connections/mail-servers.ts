/** The servers of a mailbox as the form holds them: what the user reads and corrects. */
export interface ServersForm {
  username: string
  imapHost: string
  imapPort: string
  imapSecure: boolean
  smtpHost: string
  smtpPort: string
  smtpSecure: boolean
}

export type MailServer = 'imap' | 'smtp'

export const EMPTY_SERVERS: ServersForm = {
  username: '',
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  smtpHost: '',
  smtpPort: '465',
  smtpSecure: true
}

/**
 * The ports each kind of encryption is served on: SSL/TLS from the first
 * byte, or STARTTLS on a plain connection that turns encrypted. Picking one
 * moves a standard port to the other's, and typing a standard port picks
 * its encryption — as Thunderbird does.
 */
const STANDARD_PORTS: Readonly<Record<MailServer, { tls: number; starttls: readonly number[] }>> = {
  imap: { tls: 993, starttls: [143] },
  smtp: { tls: 465, starttls: [587, 25] }
}

const FIELDS = {
  imap: { port: 'imapPort', secure: 'imapSecure' },
  smtp: { port: 'smtpPort', secure: 'smtpSecure' }
} as const

export function withPort(form: ServersForm, server: MailServer, port: string): ServersForm {
  const fields = FIELDS[server]
  const standard = STANDARD_PORTS[server]
  const number = Number(port)
  const secure =
    number === standard.tls
      ? true
      : standard.starttls.includes(number)
        ? false
        : form[fields.secure]

  return { ...form, [fields.port]: port, [fields.secure]: secure }
}

export function withEncryption(
  form: ServersForm,
  server: MailServer,
  secure: boolean
): ServersForm {
  const fields = FIELDS[server]
  const standard = STANDARD_PORTS[server]
  const port = Number(form[fields.port])
  const onStandardPort = port === standard.tls || standard.starttls.includes(port)
  const nextPort = onStandardPort
    ? String(secure ? standard.tls : standard.starttls[0])
    : form[fields.port]

  return { ...form, [fields.port]: nextPort, [fields.secure]: secure }
}

export function serversComplete(form: ServersForm): boolean {
  return Boolean(
    form.username.trim() &&
    form.imapHost.trim() &&
    Number(form.imapPort) > 0 &&
    form.smtpHost.trim() &&
    Number(form.smtpPort) > 0
  )
}
