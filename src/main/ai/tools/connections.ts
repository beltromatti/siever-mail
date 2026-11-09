import { CALENDAR_HELD_DAYS, type CalendarRole } from '@shared/calendar'
import { calendarLearningKey, READING_DAYS, type TaskKind } from '@shared/segretario'

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
import { firstLookDone, heldWindow, lookItems } from '../tasks/calendar'
import { countOf } from './format'

const ACTIONS = ['elenco', 'lettura', 'di_chi'] as const
/** The periods the list counts a mailbox's messages over, in days. */
const PERIODS = [14, 30, 60, 90, 180, 365, 730] as const
/** Who decides how far a connection is read: Conoscimi, which has just got to know it, and the user in chat. */
const DECIDING: ReadonlyArray<TaskKind> = ['conoscimi', 'richiesta']
/** Who decides whose a calendar's events are: Conoscimi, a look at a calendar that came after it, the user in chat. */
const DECIDING_ROLES: ReadonlyArray<TaskKind> = ['conoscimi', 'calendario', 'richiesta']
const ROLES: ReadonlyArray<CalendarRole> = ['tutti', 'propri', 'nessuno']

/** A calendar's role, as the Segretario reads it (§7.4). */
const ROLE_WORDS: Record<CalendarRole, string> = {
  tutti: "tutti i suoi eventi sono dell'utente",
  propri:
    "solo quelli dell'utente (invitato, li organizza o li ha creati lui, o li hai riconosciuti tu)",
  nessuno: "nessuno dei suoi eventi è dell'utente"
}
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

/** A calendar's line: what it holds, a series once, and whether the first look is done. */
async function calendarLine(
  context: ToolContext,
  connection: Connection,
  reading: StoredReading | undefined,
  calendars: Awaited<ReturnType<ToolContext['calendar']['calendars']>>
): Promise<string> {
  const connectionId = connection.names[0]
  const window = heldWindow()
  const items = lookItems(
    (
      await context.calendar.events(
        new Date(window.from).toISOString(),
        new Date(window.to).toISOString()
      )
    ).filter((event) => event.connectionId === connectionId),
    window.today
  )
  const past = items.filter((item) => item.at < window.today).length

  return [
    `- Calendario ${connection.label} — si guarda tutto ciò che tiene, da ${CALENDAR_HELD_DAYS.back} giorni fa a un anno avanti: ${countOf(items.length, 'evento', 'eventi')} (una serie ricorrente conta per uno), ${past} passati e ${items.length - past} in arrivo; ${
      firstLookDone(reading)
        ? 'li hai guardati tutti, e da qui guardi ciò che vi appare o cambia'
        : 'la prima occhiata non è ancora finita'
    }.`,
    ...calendars
      .filter((calendar) => calendar.connectionId === connectionId)
      .map(
        (calendar) =>
          `  «${calendar.name}»${calendar.primary ? ' (il principale)' : ''}${calendar.writable ? '' : ', in sola lettura'}: ${ROLE_WORDS[calendar.role]} — ${roleDecided(calendar)}.`
      )
  ].join('\n')
}

/** Who decided a calendar's role, and why. */
function roleDecided(calendar: {
  roleBy: 'utente' | 'segretario' | null
  roleReason: string | null
}): string {
  if (calendar.roleBy === 'utente') {
    return "l'ha scelto l'utente"
  }

  return calendar.roleBy === 'segretario'
    ? `deciso da te${calendar.roleReason ? `: «${calendar.roleReason}»` : ''}`
    : 'di base'
}

async function list(context: ToolContext): Promise<string> {
  const [connections, readings, files, cost, calendarList] = await Promise.all([
    connectionsOf(context),
    context.store.readings(),
    fileSources(),
    context.store.readingCostPerMessage(Date.now() - COST_LOOKBACK_MS),
    context.calendar.calendars().catch(() => [])
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
      .map((connection) =>
        calendarLine(context, connection, byKey.get(connection.key), calendarList)
      )
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

  if (connection.kind === 'calendario') {
    throw new ToolInputError(
      `Un calendario non ha un orizzonte da decidere: di ${connection.label} si guarda tutto ciò che tiene, da ${CALENDAR_HELD_DAYS.back} giorni fa a un anno avanti, quando un evento appare e quando cambia.`
    )
  }

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

/** The calendar a call names: by its name, with its connection when two have it, or by its key. */
async function calendarNamed(
  context: ToolContext,
  written: string
): Promise<Awaited<ReturnType<ToolContext['calendar']['calendars']>>[number]> {
  const calendars = await context.calendar.calendars()
  const wanted = written.trim().toLowerCase()
  const named = (calendar: (typeof calendars)[number]): string[] => [
    calendar.key.toLowerCase(),
    calendar.name.toLowerCase(),
    `${calendar.name} ${calendar.connection}`.toLowerCase(),
    `${calendar.connection} ${calendar.name}`.toLowerCase()
  ]
  const found = calendars.filter((calendar) => named(calendar).includes(wanted))

  if (found.length === 1) {
    return found[0]
  }

  throw new ToolInputError(
    `${found.length > 1 ? `Più calendari si chiamano «${written}»: aggiungi la connessione` : `Nessun calendario «${written}»`} — ${calendars
      .map((calendar) => `«${calendar.name}» di ${calendar.connection}`)
      .join(', ')}.`
  )
}

/**
 * Whose a calendar's events are (§7.4): Conoscimi decides it once it knows
 * the calendars, the look at a calendar for one that came after; what the
 * user says in chat is their choice, as in Settings, and stands.
 */
async function setRole(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<{ content: string; summary: string }> {
  if (!DECIDING_ROLES.includes(context.run.task)) {
    throw new ToolInputError(
      "Di chi sono gli eventi di un calendario si decide in Conoscimi, guardando un calendario nuovo, o in chat quando l'utente te lo dice."
    )
  }

  const calendar = await calendarNamed(context, requireString(args, 'calendario'))
  const role = stringArg(args, 'eventi')

  if (!ROLES.includes(role as CalendarRole)) {
    throw new ToolInputError(
      `Indica \`eventi\`: \`tutti\` (è il calendario dell'utente), \`propri\` (condiviso, o di altri: solo i suoi eventi) o \`nessuno\` (un abbonamento, un calendario che guarda soltanto).`
    )
  }

  const chosen = role as CalendarRole
  const words = `«${calendar.name}» di ${calendar.connection}: ${ROLE_WORDS[chosen]}`

  if (context.run.task === 'richiesta') {
    await context.calendar.setRole(calendar.key, chosen)
    return {
      content: `Da ora ${words}, come ha detto l'utente: lo vede anche in Impostazioni › Notifiche.`,
      summary: `${calendar.name}: ${ROLE_WORDS[chosen]}`
    }
  }

  // What the user chose stands: the Segretario does not decide it again.
  if (calendar.roleBy === 'utente') {
    throw new ToolInputError(
      `Per «${calendar.name}» l'utente ha scelto lui: ${ROLE_WORDS[calendar.role]}. Resta così.`
    )
  }

  if (calendar.role === chosen && calendar.roleBy === 'segretario') {
    return { content: `Già così: ${words}.`, summary: 'Già così' }
  }

  const change = await context.registry.decideCalendarRole(
    calendar,
    chosen,
    stringArg(args, 'motivo')?.trim() || null,
    context.run.actor
  )
  return {
    content: `Da ora ${words}: i promemoria, le novità e la giornata di Oggi seguono questo.`,
    summary: change.label
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
      calendario: { type: 'string' },
      eventi: { type: 'string', enum: [...ROLES] },
      motivo: { type: 'string' }
    },
    required: ['azione']
  },
  running: (args) =>
    args.azione === 'lettura'
      ? 'Decido fin dove leggere…'
      : args.azione === 'di_chi'
        ? 'Decido di chi sono gli eventi…'
        : 'Guardo le connessioni…',
  async execute(args, context) {
    const action = requireString(args, 'azione')

    if (action === 'elenco') {
      return { content: await list(context), summary: 'Guardate le connessioni' }
    }

    if (action === 'lettura') {
      return setReading(context, args)
    }

    if (action === 'di_chi') {
      return setRole(context, args)
    }

    throw new ToolInputError(`Azione sconosciuta «${action}»: ${ACTIONS.join(', ')}.`)
  }
}
