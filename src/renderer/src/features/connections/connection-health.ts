import type { CalendarConnection } from '@shared/calendar'
import { REFUSAL_LINES, type AccountConnectionState, type MailAccount } from '@shared/models'

/**
 * How a connection stands, in the four ways the user tells apart (§13ter):
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

const TIME = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const DAY_AND_TIME = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/** When, as one says it: the time today, the day and the time before. */
function when(at: number, now: number): string {
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? `alle ${TIME.format(new Date(at))}`
    : `il ${DAY_AND_TIME.format(new Date(at))}`
}

/** A mailbox's line: stopped, waiting for the network or its server, at work, or in step. */
export function mailStanding(
  account: MailAccount,
  state: AccountConnectionState | undefined,
  now = Date.now()
): ConnectionStanding {
  const line = (health: ConnectionHealth, text: string): ConnectionStanding => ({
    key: `posta:${account.id}`,
    family: 'posta',
    label: account.email,
    health,
    text
  })
  const lastHeard = state?.lastContactAt
    ? ` · ultimo contatto ${when(state.lastContactAt, now)}`
    : ''

  if (state?.refused) {
    return line('attention', `Ferma · ${REFUSAL_LINES[state.refused]}`)
  }

  switch (state?.status) {
    case 'offline':
      return line('waiting', `Senza rete: riprende da sola${lastHeard}`)
    case 'error':
      return line('waiting', `Il server non risponde: riprova da sola${lastHeard}`)
    case 'reconnecting':
      return line('working', 'Si ricollega…')
    case 'connected':
      return state.syncing
        ? line('working', 'Scarica la posta…')
        : line('ok', 'Sincronizzata: la posta arriva appena c’è')
    default:
      return line('working', 'Si collega…')
  }
}

/** A calendar connection's line: stopped, a consent to renew, waiting, reading, or read. */
export function calendarStanding(
  connection: CalendarConnection,
  now = Date.now()
): ConnectionStanding {
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
    return line('attention', `Fermo · ${REFUSAL_LINES[connection.refused]}`)
  }

  if (connection.renewConsent) {
    return line('attention', connection.problem ?? 'Va ricollegato')
  }

  if (connection.problem) {
    return line('waiting', `${connection.problem} Riprova da solo.`)
  }

  if (connection.lastSyncAt === null) {
    return line(
      'working',
      many
        ? `${connection.calendars.length} calendari · li legge ora`
        : only
          ? `«${only.name}» · lo legge ora`
          : 'Legge i calendari…'
    )
  }

  const read = when(connection.lastSyncAt, now)
  return line(
    'ok',
    many
      ? `${connection.calendars.length} calendari · letti ${read}`
      : only
        ? `«${only.name}» · letto ${read}`
        : `Nessun calendario · controllato ${read}`
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

  return {
    health,
    title:
      health === 'attention'
        ? wanting === 1
          ? 'Una connessione ha bisogno di te'
          : `${wanting} connessioni hanno bisogno di te`
        : health === 'waiting'
          ? offline
            ? 'Senza rete: tutto riprende da sé appena torna'
            : 'In attesa di un server: si sistema da sé'
          : health === 'working'
            ? 'Sincronizzazione…'
            : 'Tutto sincronizzato',
    standings,
    indexing: indexing.indexed < indexing.total ? indexing : null
  }
}
