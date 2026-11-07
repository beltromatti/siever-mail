import { CALENDAR_HELD_DAYS } from '@shared/calendar'
import {
  CALENDAR_LOOK_AHEAD_DAYS,
  calendarLearningKey,
  READING_DAYS,
  type TaskKind
} from '@shared/segretario'

import { fileSources } from '../../files/file-sources'
import { PROMPTS } from '../prompts'
import type { StoredReading } from '../ai-store'
import {
  numberArg,
  requireString,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { eventStart, lookWindow } from '../tasks/calendar'
import { countOf } from './format'

const ACTIONS = ['elenco', 'lettura'] as const
/** The periods the list counts a mailbox's messages over, in days. */
const PERIODS = [14, 30, 60, 90, 180, 365, 730] as const
/** Who decides how far a connection is read: Conoscimi, which has just got to know it, and the user in chat. */
const DECIDING: ReadonlyArray<TaskKind> = ['conoscimi', 'richiesta']
const DAY_MS = 24 * 60 * 60 * 1000
/** The readings whose spending tells what reading a message costs. */
const COST_LOOKBACK_MS = 30 * DAY_MS

const SET_ON = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'numeric' })

/** A connection the tool can be told of: a mailbox, or a calendar connection. */
interface Connection {
  key: string
  kind: 'posta' | 'calendario'
  label: string
  names: string[]
}

async function connectionsOf(context: ToolContext): Promise<Connection[]> {
  const [accounts, calendars] = await Promise.all([
    context.mail.listAccounts(),
    context.calendar.connections().catch(() => [])
  ])

  return [
    ...accounts.map((account) => ({
      key: account.id,
      kind: 'posta' as const,
      label: account.email,
      names: [account.id, account.email]
    })),
    ...calendars.map((connection) => ({
      key: calendarLearningKey(connection.id),
      kind: 'calendario' as const,
      label: connection.label,
      names: [
        connection.id,
        connection.label,
        ...connection.calendars.map((calendar) => calendar.name)
      ]
    }))
  ]
}

/** How far back a connection is read, in words: decided by whom and when, and why — or the default. */
function decidedWords(reading: StoredReading | undefined): string {
  if (!reading || reading.days === null) {
    return `${READING_DAYS.default} giorni, di base`
  }

  const by = reading.setBy === 'utente' ? "l'ha chiesto l'utente" : 'deciso da te'
  const when = reading.setAt !== null ? ` il ${SET_ON.format(reading.setAt)}` : ''
  return `${reading.days} giorni, ${by}${when}${reading.reason ? `: «${reading.reason}»` : ''}`
}

function money(amount: number): string {
  return `${amount < 0.1 ? amount.toFixed(3) : amount.toFixed(2)} $`.replace('.', ',')
}

async function mailLine(
  context: ToolContext,
  connection: Connection,
  reading: StoredReading | undefined
): Promise<string> {
  const days = reading?.days ?? READING_DAYS.default
  const since = (period: number): string => new Date(Date.now() - period * DAY_MS).toISOString()
  const now = await context.mail.readingProgress(() => since(days), [connection.key])
  const counts = await Promise.all([
    ...PERIODS.map(
      async (period) =>
        `${period} g ${(await context.mail.readingProgress(() => since(period), [connection.key])).total}`
    ),
    (async () =>
      `tutti ${(await context.mail.readingProgress(() => new Date(0).toISOString(), [connection.key])).total}`)()
  ])

  return [
    `- ${connection.label} — si legge uno per uno indietro di ${decidedWords(reading)}: ${countOf(now.total, 'messaggio', 'messaggi')}, ${now.read} letti.`,
    `  Messaggi per periodo: ${counts.join(' · ')}.`
  ].join('\n')
}

async function calendarLine(
  context: ToolContext,
  connection: Connection,
  reading: StoredReading | undefined
): Promise<string> {
  const connectionId = connection.names[0]
  const days = reading?.days ?? READING_DAYS.default
  const window = lookWindow(days)
  const events = (
    await context.calendar.events(
      new Date(window.today - CALENDAR_HELD_DAYS.back * DAY_MS).toISOString(),
      new Date(window.to).toISOString()
    )
  ).filter((event) => event.connectionId === connectionId)
  const within = events.filter((event) => eventStart(event) >= window.from)
  const looked = within.filter((event) => {
    const start = eventStart(event)
    return (
      reading?.lookedFrom != null &&
      reading.lookedUntil != null &&
      start >= reading.lookedFrom &&
      start < reading.lookedUntil
    )
  }).length
  const back = [14, 30, CALENDAR_HELD_DAYS.back].map(
    (period) =>
      `${period} g ${events.filter((event) => eventStart(event) >= window.today - period * DAY_MS && eventStart(event) < window.today).length}`
  )

  return [
    `- Calendario ${connection.label} — gli eventi si guardano uno per uno da ${decidedWords(reading)} fa ai prossimi ${CALENDAR_LOOK_AHEAD_DAYS}: ${countOf(within.length, 'evento', 'eventi')}, ${looked} guardati.`,
    `  Eventi passati per periodo: ${back.join(' · ')} (il calendario ne tiene ${CALENDAR_HELD_DAYS.back} giorni).`
  ].join('\n')
}

async function list(context: ToolContext): Promise<string> {
  const [connections, readings, files, cost] = await Promise.all([
    connectionsOf(context),
    context.store.readings(),
    fileSources(),
    context.store.readingCostPerMessage(Date.now() - COST_LOOKBACK_MS)
  ])
  const byKey = new Map(readings.map((reading) => [reading.key, reading]))
  const mail = await Promise.all(
    connections
      .filter((connection) => connection.kind === 'posta')
      .map((connection) => mailLine(context, connection, byKey.get(connection.key)))
  )
  const calendars = await Promise.all(
    connections
      .filter((connection) => connection.kind === 'calendario')
      .map((connection) => calendarLine(context, connection, byKey.get(connection.key)))
  )

  return [
    mail.length > 0 ? `Posta\n${mail.join('\n')}` : null,
    calendars.length > 0 ? `Calendario\n${calendars.join('\n')}` : null,
    files.length > 0
      ? `File\n- ${files.map((source) => source.label).join(', ')}: i file non si leggono uno per uno; li leggi quando il lavoro ti porta lì.`
      : null,
    cost !== null
      ? `Leggere un messaggio costa in media ${money(cost)}, dalle letture dell'ultimo mese.`
      : null
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The connection a call names: by its address, its name, a calendar's name, or its id. */
async function connectionNamed(context: ToolContext, written: string): Promise<Connection> {
  const connections = await connectionsOf(context)
  const wanted = written
    .trim()
    .toLowerCase()
    .replace(/^(posta|calendario)\s+/, '')
  const found = connections.filter((connection) =>
    connection.names.some((name) => name.toLowerCase() === wanted)
  )

  if (found.length === 1) {
    return found[0]
  }

  throw new ToolInputError(
    `${found.length > 1 ? `«${written}» può essere più di una connessione` : `Nessuna connessione «${written}»`}: indica una di queste — ${connections
      .map((connection) => `${connection.kind} ${connection.label}`)
      .join(', ')}.`
  )
}

async function setReading(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<{ content: string; summary: string }> {
  if (!DECIDING.includes(context.run.task)) {
    throw new ToolInputError(
      "Fin dove leggere una connessione si decide in Conoscimi, quando la conosci, o in chat quando l'utente te lo chiede."
    )
  }

  const connection = await connectionNamed(context, requireString(args, 'connessione'))
  const asked = numberArg(args, 'giorni')

  if (asked === undefined || !Number.isFinite(asked)) {
    throw new ToolInputError(
      `Indica \`giorni\`: quanto indietro leggere ${connection.label}, almeno ${READING_DAYS.min}.`
    )
  }

  const days = Math.max(READING_DAYS.min, Math.round(asked))
  const before = await context.store.reading(connection.key)
  const byUser = context.run.task === 'richiesta'

  // What the user asked for stands: Conoscimi does not decide it again.
  if (!byUser && before?.setBy === 'utente' && before.days !== null) {
    throw new ToolInputError(
      `Per ${connection.label} l'utente ha chiesto lui ${before.days} giorni: resta così.`
    )
  }

  const reason = stringArg(args, 'motivo')?.trim() || null
  await context.store.setReadingDays(connection.key, days, reason, byUser ? 'utente' : 'segretario')
  const was = before?.days ?? READING_DAYS.default
  const clamped =
    days !== Math.round(asked)
      ? ` (non meno di ${READING_DAYS.min}: le funzioni partono piene)`
      : ''

  if (connection.kind === 'calendario') {
    return {
      content: `Da ora gli eventi di ${connection.label} si guardano uno per uno da ${days} giorni fa${clamped}${days > CALENDAR_HELD_DAYS.back ? ` — il calendario ne tiene ${CALENDAR_HELD_DAYS.back}: da lì` : ''} ai prossimi ${CALENDAR_LOOK_AHEAD_DAYS}; prima ${was}. Quelli che non hai guardato li guardi a blocchi, nel compito del calendario.`,
      summary: `Calendario ${connection.label}: ${days} giorni indietro`
    }
  }

  const since = new Date(Date.now() - days * DAY_MS).toISOString()
  const progress = await context.mail.readingProgress(() => since, [connection.key])
  const missing = progress.total - progress.read
  const cost = await context.store.readingCostPerMessage(Date.now() - COST_LOOKBACK_MS)

  return {
    content: `Da ora ${connection.label} si legge uno per uno dagli ultimi ${days} giorni${clamped}; prima ${was}. Sono ${countOf(progress.total, 'messaggio', 'messaggi')}, ${progress.read} già letti${
      missing > 0
        ? `: ${missing === 1 ? 'quello che manca si legge' : `i ${missing} che mancano si leggono`} uno per uno${cost !== null ? `, circa ${money(missing * cost)}` : ''}.`
        : '.'
    }${days < was ? ' Ciò che era già letto resta com’è.' : ''}`,
    summary: `Posta ${connection.label}: ${days} giorni`
  }
}

export const connectionsTool: SegretarioTool = {
  name: 'connessioni',
  description: PROMPTS.tools.connessioni,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: [...ACTIONS] },
      connessione: { type: 'string' },
      giorni: { type: 'integer' },
      motivo: { type: 'string' }
    },
    required: ['azione']
  },
  running: (args) =>
    args.azione === 'lettura' ? 'Decido fin dove leggere…' : 'Guardo le connessioni…',
  async execute(args, context) {
    const action = requireString(args, 'azione')

    if (action === 'elenco') {
      return { content: await list(context), summary: 'Guardate le connessioni' }
    }

    if (action === 'lettura') {
      return setReading(context, args)
    }

    throw new ToolInputError(`Azione sconosciuta «${action}»: ${ACTIONS.join(', ')}.`)
  }
}
