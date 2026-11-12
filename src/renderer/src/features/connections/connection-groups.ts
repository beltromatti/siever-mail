import type { Provider } from '@renderer/components/ui/provider-logo'
import type { CalendarConnection, CalendarProviderKind } from '@shared/calendar'
import type { MailAccount } from '@shared/models'

/** Who an access is with, as the user knows it: its mark and its name are `ProviderLogo`'s. */
export type AccessKind = Provider

/**
 * One access of the user's — an account, a server, a link — with the
 * connections it brought: its mail, its calendar, or both. They stay
 * connections of their own; the group is how Settings shows them.
 */
export interface ConnectionGroup {
  key: string
  /** The address of the access, or the name of a link. */
  title: string
  kind: AccessKind
  mail: MailAccount | null
  calendars: CalendarConnection[]
}

const ICLOUD_MAIL = /(^|\.)mail\.me\.com$/i
const ICLOUD_CALDAV = /(^|\.)icloud\.com$/i

export function accessOfMail(account: MailAccount): AccessKind {
  if (account.type === 'gmail') {
    return 'google'
  }

  if (account.authType === 'oauth') {
    return 'microsoft'
  }

  if (account.pec) {
    return 'pec'
  }

  return ICLOUD_MAIL.test(account.imapHost) ? 'icloud' : 'imap'
}

export function accessOfCalendar(connection: CalendarConnection): AccessKind {
  if (connection.provider === 'caldav') {
    const host = connection.serverUrl ? hostOf(connection.serverUrl) : ''
    return ICLOUD_CALDAV.test(host) ? 'icloud' : 'caldav'
  }

  return connection.provider
}

/**
 * Who a calendar connection known by its id and provider is with: its
 * access, from the connections once they are read. Until then its provider
 * says it, but for a CalDAV server, which may be iCloud's: unknown, null.
 */
export function accessOfCalendarId(
  connectionId: string,
  provider: CalendarProviderKind,
  connections: ReadonlyArray<CalendarConnection> | null
): AccessKind | null {
  const connection = connections?.find((candidate) => candidate.id === connectionId)

  if (connection) {
    return accessOfCalendar(connection)
  }

  return provider === 'caldav' ? null : provider
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const sameAddress = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The connections by access: each mail connection, with the calendars that
 * came with it — the same consent, or the same address — and the calendars
 * on their own after, a link always apart.
 */
export function connectionGroups(
  accounts: ReadonlyArray<MailAccount>,
  calendars: ReadonlyArray<CalendarConnection>
): ConnectionGroup[] {
  const groups: ConnectionGroup[] = accounts.map((account) => ({
    key: `mail:${account.id}`,
    title: account.email,
    kind: accessOfMail(account),
    mail: account,
    calendars: []
  }))

  for (const calendar of calendars) {
    const home =
      groups.find((group) => group.mail && group.mail.id === calendar.mailAccountId) ??
      (calendar.provider === 'ics'
        ? undefined
        : groups.find((group) => group.mail && sameAddress(group.mail.email, calendar.label)))

    if (home) {
      home.calendars.push(calendar)
    } else {
      groups.push({
        key: `calendar:${calendar.id}`,
        title: calendar.label,
        kind: accessOfCalendar(calendar),
        mail: null,
        calendars: [calendar]
      })
    }
  }

  return groups
}

/** Whether the access can bring a calendar it has not brought yet: a Google or Microsoft account's. */
export function canAddCalendar(group: ConnectionGroup): boolean {
  return (
    (group.kind === 'google' || group.kind === 'microsoft') &&
    group.mail !== null &&
    group.calendars.length === 0
  )
}

/**
 * Whether a calendar connection is signed in again from here though it
 * works: its provider's consent lacks what writing needs. One turned down
 * is put right in the refusal's window (`showConnectionRefused`).
 */
export function canRenewConsent(connection: CalendarConnection): boolean {
  return connection.renewConsent && connection.refused === null
}
