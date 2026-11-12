import { hourStyle, languageNow, messagesNow } from '@renderer/lib/i18n'
import type { CalendarConnection } from '@shared/calendar'
import { defineMessages } from '@shared/i18n'
import { REFUSAL_LINES, type AccountConnectionState, type MailAccount } from '@shared/models'

/**
 * How a connection stands, in the four ways the user tells apart (§14):
 * all well; at work — connecting, downloading, reading for the first
 * time; waiting on something that passes by itself — the network, a server
 * that does not answer —, nothing to do; or wanting the user — stopped
 * until it is put right, or a consent to give again.
 */
export type ConnectionHealth = 'ok' | 'working' | 'waiting' | 'attention'

/** One connection's line: in the rail's status and in Settings › Connessioni, the same words. */
export interface ConnectionStanding {
  key: string
  family: 'posta' | 'calendario'
  label: string
  health: ConnectionHealth
  /** How it stands, in a few words, and when it last heard from its server. */
  text: string
}

/** The connections together, as the rail's status says them. */
export interface ConnectionsStatus {
  /** The most pressing of them. */
  health: ConnectionHealth
  title: string
  /** Every connection, the most pressing first. */
  standings: ConnectionStanding[]
  /** How much of the mail the search has read, while it still reads. */
  indexing: { indexed: number; total: number } | null
}

const RANK: Readonly<Record<ConnectionHealth, number>> = {
  attention: 0,
  waiting: 1,
  working: 2,
  ok: 3
}

const MESSAGES = defineMessages({
  atTime: {
    en: (time: string) => `at ${time}`,
    it: (time: string) => `alle ${time}`,
    de: (time: string) => `um ${time}`
  },
  onDay: {
    en: (day: string) => `on ${day}`,
    it: (day: string) => `il ${day}`,
    de: (day: string) => `am ${day}`
  },
  lastContact: {
    en: (when: string) => ` · last contact ${when}`,
    it: (when: string) => ` · ultimo contatto ${when}`,
    de: (when: string) => ` · letzter Kontakt ${when}`
  },
  mailStopped: {
    en: (why: string) => `Stopped · ${why}`,
    it: (why: string) => `Ferma · ${why}`,
    de: (why: string) => `Angehalten · ${why}`
  },
  offline: {
    en: 'No network: it resumes on its own',
    it: 'Senza rete: riprende da sola',
    de: 'Kein Netzwerk: wird von selbst fortgesetzt'
  },
  serverDown: {
    en: 'The server isn’t answering: it tries again on its own',
    it: 'Il server non risponde: riprova da sola',
    de: 'Der Server antwortet nicht: wird von selbst erneut versucht'
  },
  reconnecting: { en: 'Reconnecting…', it: 'Si ricollega…', de: 'Verbindet erneut…' },
  downloading: {
    en: 'Downloading the mail…',
    it: 'Scarica la posta…',
    de: 'E-Mails werden geladen…'
  },
  inStep: {
    en: 'In sync: mail arrives as soon as it’s there',
    it: 'Sincronizzata: la posta arriva appena c’è',
    de: 'Synchronisiert: E-Mails kommen an, sobald sie da sind'
  },
  connecting: { en: 'Connecting…', it: 'Si collega…', de: 'Verbindet…' },
  calendarStopped: {
    en: (why: string) => `Stopped · ${why}`,
    it: (why: string) => `Fermo · ${why}`,
    de: (why: string) => `Angehalten · ${why}`
  },
  reconnect: {
    en: 'Needs reconnecting',
    it: 'Va ricollegato',
    de: 'Muss erneut verbunden werden'
  },
  retries: {
    en: (problem: string) => `${problem} It tries again on its own.`,
    it: (problem: string) => `${problem} Riprova da solo.`,
    de: (problem: string) => `${problem} Wird von selbst erneut versucht.`
  },
  readingMany: {
    en: (count: number) => `${count} calendars · reading them now`,
    it: (count: number) => `${count} calendari · li legge ora`,
    de: (count: number) => `${count} Kalender · werden gerade gelesen`
  },
  readingOne: {
    en: (name: string) => `“${name}” · reading it now`,
    it: (name: string) => `«${name}» · lo legge ora`,
    de: (name: string) => `„${name}“ · wird gerade gelesen`
  },
  readingCalendars: {
    en: 'Reading the calendars…',
    it: 'Legge i calendari…',
    de: 'Kalender werden gelesen…'
  },
  readMany: {
    en: (count: number, when: string) => `${count} calendars · read ${when}`,
    it: (count: number, when: string) => `${count} calendari · letti ${when}`,
    de: (count: number, when: string) => `${count} Kalender · gelesen ${when}`
  },
  readOne: {
    en: (name: string, when: string) => `“${name}” · read ${when}`,
    it: (name: string, when: string) => `«${name}» · letto ${when}`,
    de: (name: string, when: string) => `„${name}“ · gelesen ${when}`
  },
  noCalendar: {
    en: (when: string) => `No calendars · checked ${when}`,
    it: (when: string) => `Nessun calendario · controllato ${when}`,
    de: (when: string) => `Keine Kalender · geprüft ${when}`
  },
  wanting: {
    en: (count: number) =>
      count === 1 ? 'A connection needs you' : `${count} connections need you`,
    it: (count: number) =>
      count === 1 ? 'Una connessione ha bisogno di te' : `${count} connessioni hanno bisogno di te`,
    de: (count: number) =>
      count === 1 ? 'Eine Verbindung braucht Sie' : `${count} Verbindungen brauchen Sie`
  },
  allOffline: {
    en: 'No network: everything resumes on its own when it’s back',
    it: 'Senza rete: tutto riprende da sé appena torna',
    de: 'Kein Netzwerk: Alles läuft von selbst weiter, sobald es zurück ist'
  },
  waitingServer: {
    en: 'Waiting for a server: it sorts itself out',
    it: 'In attesa di un server: si sistema da sé',
    de: 'Warten auf einen Server: Das regelt sich von selbst'
  },
  syncing: { en: 'Syncing…', it: 'Sincronizzazione…', de: 'Synchronisierung…' },
  allInStep: { en: 'All in sync', it: 'Tutto sincronizzato', de: 'Alles synchronisiert' }
})

/** Made when used: the hour is written as the region writes it now. */
const TIME = (): Intl.DateTimeFormatOptions => ({ hour: hourStyle(), minute: '2-digit' })
/** Made when used: the hour is written as the region writes it now. */
const DAY_AND_TIME = (): Intl.DateTimeFormatOptions => ({
  day: 'numeric',
  month: 'short',
  hour: hourStyle(),
  minute: '2-digit'
})

/** When, as one says it: the time today, the day and the time before. */
function when(at: number, now: number): string {
  const m = messagesNow(MESSAGES)
  const { formatLocale } = languageNow()

  return new Date(at).toDateString() === new Date(now).toDateString()
    ? m.atTime(new Intl.DateTimeFormat(formatLocale, TIME()).format(new Date(at)))
    : m.onDay(new Intl.DateTimeFormat(formatLocale, DAY_AND_TIME()).format(new Date(at)))
}

/** A mailbox's line: stopped, waiting for the network or its server, at work, or in step. */
export function mailStanding(
  account: MailAccount,
  state: AccountConnectionState | undefined,
  now = Date.now()
): ConnectionStanding {
  const m = messagesNow(MESSAGES)
  const line = (health: ConnectionHealth, text: string): ConnectionStanding => ({
    key: `posta:${account.id}`,
    family: 'posta',
    label: account.email,
    health,
    text
  })
  const lastHeard = state?.lastContactAt ? m.lastContact(when(state.lastContactAt, now)) : ''

  if (state?.refused) {
    return line('attention', m.mailStopped(messagesNow(REFUSAL_LINES)[state.refused]))
  }

  switch (state?.status) {
    case 'offline':
      return line('waiting', `${m.offline}${lastHeard}`)
    case 'error':
      return line('waiting', `${m.serverDown}${lastHeard}`)
    case 'reconnecting':
      return line('working', m.reconnecting)
    case 'connected':
      return state.syncing ? line('working', m.downloading) : line('ok', m.inStep)
    default:
      return line('working', m.connecting)
  }
}

/** A calendar connection's line: stopped, a consent to renew, waiting, reading, or read. */
export function calendarStanding(
  connection: CalendarConnection,
  now = Date.now()
): ConnectionStanding {
  const m = messagesNow(MESSAGES)
  const line = (health: ConnectionHealth, text: string): ConnectionStanding => ({
    key: `calendario:${connection.id}`,
    family: 'calendario',
    label: connection.label,
    health,
    text
  })
  // The calendar by its name when it is one, as the user knows it; how many, when more.
  const [only] = connection.calendars
  const many = connection.calendars.length > 1

  if (connection.refused) {
    return line('attention', m.calendarStopped(messagesNow(REFUSAL_LINES)[connection.refused]))
  }

  if (connection.renewConsent) {
    return line('attention', connection.problem ?? m.reconnect)
  }

  if (connection.problem) {
    return line('waiting', m.retries(connection.problem))
  }

  if (connection.lastSyncAt === null) {
    return line(
      'working',
      many
        ? m.readingMany(connection.calendars.length)
        : only
          ? m.readingOne(only.name)
          : m.readingCalendars
    )
  }

  const read = when(connection.lastSyncAt, now)
  return line(
    'ok',
    many
      ? m.readMany(connection.calendars.length, read)
      : only
        ? m.readOne(only.name, read)
        : m.noCalendar(read)
  )
}

/**
 * Every connection together, for the rail: the most pressing first, and in
 * a title what the whole comes to — in step, at work, waiting on what
 * passes, or wanting the user. Null with no connection at all.
 */
export function connectionsStatus(
  accounts: ReadonlyArray<MailAccount>,
  mailStates: Readonly<Record<string, AccountConnectionState | undefined>>,
  calendars: ReadonlyArray<CalendarConnection>,
  now = Date.now()
): ConnectionsStatus | null {
  const standings = [
    ...accounts.map((account) => mailStanding(account, mailStates[account.id], now)),
    ...calendars.map((connection) => calendarStanding(connection, now))
  ].sort((left, right) => RANK[left.health] - RANK[right.health])

  if (standings.length === 0) {
    return null
  }

  const health = standings[0].health
  const wanting = standings.filter((standing) => standing.health === 'attention').length
  const offline = accounts.some((account) => mailStates[account.id]?.status === 'offline')
  const counted = accounts
    .map((account) => mailStates[account.id]?.index)
    .filter((index): index is { total: number; indexed: number } => index !== undefined)
  const indexing = counted.reduce(
    (sum, index) => ({ indexed: sum.indexed + index.indexed, total: sum.total + index.total }),
    { indexed: 0, total: 0 }
  )

  const m = messagesNow(MESSAGES)

  return {
    health,
    title:
      health === 'attention'
        ? m.wanting(wanting)
        : health === 'waiting'
          ? offline
            ? m.allOffline
            : m.waitingServer
          : health === 'working'
            ? m.syncing
            : m.allInStep,
    standings,
    indexing: indexing.indexed < indexing.total ? indexing : null
  }
}
