import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { format } from 'node:util'

import type {
  DiagnosticArea,
  DiagnosticFields,
  DiagnosticLevel,
  DiagnosticsInfo
} from '@shared/diagnostics'

/**
 * The diagnostics' log (vision §14.4): one JSON line per event, a file per
 * day, kept as long as the Segretario's diary and within a size. Every part
 * of the app writes through a scope of its area; the console of the main
 * process is caught too, so nothing a library prints is lost. Writing never
 * makes anything else fail: the lines are kept in memory and written
 * together a moment later, in order, all of them before the app quits.
 */

/** Days kept, today's included: as the Segretario's diary, so the log and the sessions it points to go together. */
export const DIAGNOSTICS_KEPT_DAYS = 21
const DAY_MS = 24 * 60 * 60 * 1000
/** The most the log may take on disk: past it, the oldest days go first. */
const KEPT_BYTES = 100 * 1024 * 1024
/**
 * The most a day's file takes before its information lines stop — a
 * library printing in a loop, a page that records without end —; warnings
 * and errors are still written, the stop said once.
 */
const DAY_BYTES = 20 * 1024 * 1024
const FILE_PREFIX = 'registro-'
const FILE_SUFFIX = '.jsonl'
/** How long lines wait to be written together; an error goes at once. */
const FLUSH_MS = 500
/** A warning or an error said again within this time is counted, then written once with how many times. */
const REPEAT_WINDOW_MS = 60_000
/** How Electron prints a channel that failed (`ipcMain.handle`): `handleIpc` writes it, with its level. */
const IPC_FAILURE_PRINTED = 'Error occurred in handler for '
/** Lines kept in memory until the log starts. */
const PENDING_BEFORE_START = 5_000
/** Text longer than this is cut: a message's body or a server's page has no place in a log line. */
const TEXT_LIMIT = 600
const LIST_LIMIT = 30
const DEPTH_LIMIT = 5
const STACK_LINES = 14
/**
 * A field whose name says it holds a secret: `password`, `accessToken`,
 * `apiKey`, `clientSecret` — by how the name ends, so `promptTokens` or
 * `passing` are not taken for one.
 */
const SENSITIVE_KEY =
  /(pass(word|wd|phrase)?|secret|token|api[-_]?key|authorization|cookie|credentials?|bearer)$/i

export interface DiagnosticScope {
  info(ev: string, fields?: DiagnosticFields): void
  warn(ev: string, fields?: DiagnosticFields): void
  /** Something failed that does not pass by itself: `ev` says what, the error why. */
  error(ev: string, error?: unknown, fields?: DiagnosticFields): void
  /**
   * Something failed, of either kind (§14.1): an exception of the program
   * is an error; the world's answer — a server that refuses, the network
   * gone — a warning.
   */
  failed(ev: string, error: unknown, fields?: DiagnosticFields): void
}

/**
 * An exception of the program — a type error, the database —, not the
 * answer of the world or of the user to a request: a server that refuses, a
 * password that is wrong, a link that does not answer (§14.1, §14.3).
 */
export function isProgramError(error: unknown): boolean {
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    error instanceof SyntaxError ||
    error instanceof EvalError ||
    error instanceof URIError
  ) {
    // What the network library calls a failed fetch is the network's.
    return !(error instanceof TypeError && error.message === 'fetch failed')
  }

  const code = (error as { code?: unknown } | null)?.code
  return (
    (error instanceof Error && /prisma|sqlite/i.test(error.name)) ||
    (typeof code === 'string' && code.startsWith('SQLITE_'))
  )
}

interface Writer {
  folder: string
  echo: ((line: string) => void) | null
  timer: NodeJS.Timeout | null
  /** The day being written, how much its file holds, and whether its information lines stopped. */
  day: string
  dayBytes: number
  capped: boolean
}

/** A warning or an error said again: counted until its minute is over, then written with the count. */
interface Repeat {
  since: number
  count: number
  /** What the line of the count says: the event, and what tells it apart. */
  line: Record<string, unknown>
  timer: NodeJS.Timeout
}

/** What a launch writes: its id, the order of its events, what waits to be written. */
const launch = {
  session: randomBytes(4).toString('hex'),
  seq: 0,
  pending: [] as Array<{ day: string; line: string }>,
  repeats: new Map<string, Repeat>()
}
let writer: Writer | null = null

/** Whether a field's name says it holds a secret: its value is never written. */
export function isSecretKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** The id of this launch: every event carries it, so one launch reads apart from the next. */
export function diagnosticsSession(): string {
  return launch.session
}

/** The folder the log is in, once started. */
export function diagnosticsFolder(): string | null {
  return writer?.folder ?? null
}

/**
 * Starts writing — what was recorded before is written first — and catches
 * the console. `echo` prints each event to the terminal too, for
 * development.
 */
export function startDiagnostics(options: {
  folder: string
  echo: boolean
  /** Off only in the tests: the console is the process's, caught once. */
  catchConsole?: boolean
}): void {
  if (writer) {
    return
  }

  mkdirSync(options.folder, { recursive: true })
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }
  const today = localDay()

  writer = {
    folder: options.folder,
    echo: options.echo ? (line) => original.log(line) : null,
    timer: null,
    day: today,
    dayBytes: sizeOf(join(options.folder, fileOf(today))),
    capped: false
  }
  pruneOldDays()

  for (const level of options.catchConsole === false
    ? []
    : (['log', 'info', 'warn', 'error'] as const)) {
    console[level] = (...args: unknown[]): void => {
      original[level](...args)

      // Electron's own line for a channel that failed: the channel wrote it already, as what it is.
      if (typeof args[0] === 'string' && args[0].startsWith(IPC_FAILURE_PRINTED)) {
        return
      }

      write(
        level === 'log' ? 'info' : level,
        'console',
        'console',
        { text: format(...args) },
        undefined,
        false
      )
    }
  }

  scheduleFlush(true)
}

/**
 * Writes all that waits, at once — the counts of what was said again
 * included —: the app is quitting, or the log is being exported.
 */
export function flushDiagnostics(): void {
  for (const key of [...launch.repeats.keys()]) {
    settleRepeat(key)
  }

  flush()
}

/** A scope for an area: what its part of the app writes through. */
export function diagnostics(area: DiagnosticArea): DiagnosticScope {
  return {
    info: (ev, fields) => write('info', area, ev, fields),
    warn: (ev, fields) => write('warn', area, ev, fields),
    error: (ev, error, fields) => write('error', area, ev, fields, error),
    failed: (ev, error, fields) =>
      isProgramError(error)
        ? write('error', area, ev, fields, error)
        : write('warn', area, ev, { ...fields, err: error })
  }
}

/** Records an event of any area — the page's, through IPC. */
export function recordDiagnostic(
  level: DiagnosticLevel,
  area: DiagnosticArea,
  ev: string,
  fields?: DiagnosticFields,
  error?: unknown
): void {
  write(level, area, ev, fields, error)
}

/** The log's files from a day on (AAAA-MM-GG), the oldest first, with all that waits written. */
export function diagnosticsFiles(sinceDay: string): Array<{ name: string; path: string }> {
  if (!writer) {
    return []
  }

  flushDiagnostics()
  const { folder } = writer
  return logFiles(folder)
    .filter((file) => file.day >= sinceDay)
    .map((file) => ({ name: file.name, path: join(folder, file.name) }))
}

/** The log as Settings shows it. */
export function diagnosticsInfo(): DiagnosticsInfo {
  const folder = writer?.folder ?? ''
  const files = writer ? logFiles(folder) : []

  return {
    folder,
    keptDays: DIAGNOSTICS_KEPT_DAYS,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    since: files[0]?.day ?? null
  }
}

/** The local day of a moment, AAAA-MM-GG: a file holds a day as the user lives it. */
export function localDay(at: Date = new Date()): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

function write(
  level: DiagnosticLevel,
  area: DiagnosticArea,
  ev: string,
  fields: DiagnosticFields | undefined,
  error?: unknown,
  echo = true
): void {
  try {
    const now = Date.now()
    const err = error === undefined ? undefined : errorOf(error)

    // A warning or an error said again and again — a loop that keeps failing — is written once,
    // then counted, and the count written when its minute is over. Of what kind it is — a
    // notification's, say — tells one from another, as its connection, run or channel does.
    if (level !== 'info') {
      const said = saidIn(err, fields)
      const kind = typeof fields?.kind === 'string' ? fields.kind : undefined
      const key = [area, ev, said, fields?.run, fields?.conn, fields?.channel, kind].join('\u0000')
      const seen = launch.repeats.get(key)

      if (seen && now - seen.since < REPEAT_WINDOW_MS) {
        seen.count += 1
        return
      }

      if (seen) {
        settleRepeat(key)
      }

      const timer = setTimeout(() => settleRepeat(key), REPEAT_WINDOW_MS)
      timer.unref?.()
      launch.repeats.set(key, {
        since: now,
        count: 0,
        line: {
          lvl: level,
          area,
          ev: clip(ev),
          ...(fields?.conn ? { conn: fields.conn } : {}),
          ...(fields?.run ? { run: fields.run } : {}),
          ...(fields?.channel ? { channel: fields.channel } : {}),
          ...(kind ? { kind: clip(kind) } : {}),
          ...(said ? { said: clip(said) } : {})
        },
        timer
      })
    } else if (writer && !roomForInformation()) {
      return
    }

    const details = {
      ...(fields ? (clean(fields, 0) as Record<string, unknown>) : {}),
      ...(err ? { err } : {})
    }
    append({ lvl: level, area, ev: clip(ev), ...details }, now)

    if (echo && writer?.echo) {
      const said = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ''
      writer.echo(`[${area}] ${clip(ev)}${level === 'info' ? '' : ` (${level})`}${said}`)
    }

    scheduleFlush(level === 'error')
  } catch {
    // An event that could not be written is lost; what it was about goes on.
  }
}

/** A line, in the launch's order, waiting to be written. */
function append(fields: Record<string, unknown>, at: number): void {
  const line = `${JSON.stringify({ t: new Date(at).toISOString(), seq: ++launch.seq, s: launch.session, ...fields })}\n`
  const day = localDay(new Date(at))
  launch.pending.push({ day, line })

  // Before the log starts — or in a process where it never does, a test — the oldest go.
  if (!writer) {
    if (launch.pending.length > PENDING_BEFORE_START) {
      launch.pending.shift()
    }

    return
  }

  if (day !== writer.day) {
    writer.day = day
    writer.dayBytes = 0
    writer.capped = false
  }

  writer.dayBytes += Buffer.byteLength(line)
}

/** Whether today's file has room for another information line: past its size, they stop, said once. */
function roomForInformation(): boolean {
  if (!writer) {
    return true
  }

  if (writer.day !== localDay()) {
    return true
  }

  if (writer.dayBytes < DAY_BYTES) {
    return true
  }

  if (!writer.capped) {
    writer.capped = true
    append({ lvl: 'warn', area: 'app', ev: 'log.capped', bytes: writer.dayBytes }, Date.now())
  }

  return false
}

/** A repeat's minute is over: the count written, if it came again, and the repeat let go. */
function settleRepeat(key: string): void {
  const repeat = launch.repeats.get(key)

  if (!repeat) {
    return
  }

  clearTimeout(repeat.timer)
  launch.repeats.delete(key)

  if (repeat.count > 0) {
    append({ ...repeat.line, repeated: repeat.count }, Date.now())
    scheduleFlush(false)
  }
}

/**
 * What an event said, to tell one from another: its error's message, an
 * error in its fields (a run that failed), or what was printed.
 */
function saidIn(
  err: Record<string, unknown> | undefined,
  fields: DiagnosticFields | undefined
): string {
  const inFields = fields?.err

  if (typeof err?.message === 'string') {
    return err.message
  }

  if (inFields && typeof inFields === 'object' && 'message' in inFields) {
    return String(inFields.message)
  }

  return typeof fields?.text === 'string' ? fields.text : ''
}

function scheduleFlush(now: boolean): void {
  if (!writer) {
    return
  }

  if (now) {
    if (writer.timer) {
      clearTimeout(writer.timer)
    }

    writer.timer = setTimeout(flush, 0)
    return
  }

  writer.timer ??= setTimeout(flush, FLUSH_MS)
}

/**
 * Writes what waits, in order, a file per day. A moment's lines are a few
 * kilobytes: written at once, they never interleave with another write, and
 * none is left in flight when the app quits.
 */
function flush(): void {
  if (!writer) {
    return
  }

  if (writer.timer) {
    clearTimeout(writer.timer)
    writer.timer = null
  }

  const days = new Map<string, string>()

  for (const entry of launch.pending.splice(0)) {
    days.set(entry.day, (days.get(entry.day) ?? '') + entry.line)
  }

  for (const [day, lines] of days) {
    try {
      appendFileSync(join(writer.folder, fileOf(day)), lines)
    } catch {
      // A disk that refuses a write loses those lines, not the app.
    }
  }

  if (days.size > 0 && writer.day !== prunedDay) {
    pruneOldDays()
  }
}

/** The day the oldest files were last let go: it happens once a day. */
let prunedDay = ''

/** The days past those kept go, then the oldest until the log fits its size; today's never. */
function pruneOldDays(): void {
  if (!writer) {
    return
  }

  const today = localDay()
  prunedDay = today
  const cutoff = localDay(new Date(Date.now() - (DIAGNOSTICS_KEPT_DAYS - 1) * DAY_MS))
  const files = logFiles(writer.folder)
  let total = files.reduce((sum, file) => sum + file.bytes, 0)

  for (const file of files) {
    if (file.day === today || (file.day >= cutoff && total <= KEPT_BYTES)) {
      continue
    }

    try {
      unlinkSync(join(writer.folder, file.name))
      total -= file.bytes
    } catch {
      // Kept until the next try.
    }
  }
}

function logFiles(folder: string): Array<{ name: string; day: string; bytes: number }> {
  try {
    return readdirSync(folder)
      .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
      .map((name) => ({
        name,
        day: name.slice(FILE_PREFIX.length, -FILE_SUFFIX.length),
        bytes: sizeOf(join(folder, name))
      }))
      .sort((a, b) => a.day.localeCompare(b.day))
  } catch {
    return []
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    // Not there yet, or gone meanwhile: counted as empty.
    return 0
  }
}

function fileOf(day: string): string {
  return `${FILE_PREFIX}${day}${FILE_SUFFIX}`
}

function clip(text: string): string {
  return text.length > TEXT_LIMIT
    ? `${text.slice(0, TEXT_LIMIT)}… (+${text.length - TEXT_LIMIT})`
    : text
}

/**
 * A value as a log line can hold it: what names a secret is taken out, long
 * text cut, deep or long structures shortened, errors as errors.
 */
export function clean(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value ?? null
  }

  if (typeof value === 'string') {
    return clip(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return errorOf(value)
  }

  if (typeof value !== 'object') {
    return undefined
  }

  if (depth >= DEPTH_LIMIT) {
    return '[…]'
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, LIST_LIMIT).map((item) => clean(item, depth + 1))
    return value.length > LIST_LIMIT ? [...items, `… (+${value.length - LIST_LIMIT})`] : items
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && typeof entry !== 'function')
      .map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? '[tolto]' : clean(entry, depth + 1)])
  )
}

/** An error as the log keeps it: what it is, what the server said, where it came from. */
export function errorOf(error: unknown, depth = 0): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: clip(typeof error === 'string' ? error : String(error)) }
  }

  const record = error as Record<string, unknown>
  const text = (key: string): string | undefined =>
    typeof record[key] === 'string' && record[key] ? clip(record[key]) : undefined
  const stack =
    typeof record.stack === 'string'
      ? record.stack
          .split('\n')
          .slice(1, STACK_LINES)
          .map((line) => line.trim())
      : undefined

  return Object.fromEntries(
    Object.entries({
      name: text('name'),
      message: text('message') ?? 'Errore senza messaggio',
      code:
        typeof record.code === 'string' || typeof record.code === 'number'
          ? record.code
          : undefined,
      status:
        typeof record.status === 'number'
          ? record.status
          : typeof record.statusCode === 'number'
            ? record.statusCode
            : undefined,
      response: text('response') ?? text('responseText'),
      // What an IMAP server said, in its words: `NO`, `AUTHENTICATIONFAILED`.
      responseStatus: text('responseStatus'),
      serverCode: text('serverResponseCode'),
      // The command's words, never its arguments: an IMAP search carries what was searched.
      command: commandWords(text('executedCommand') ?? text('command')),
      authenticationFailed:
        typeof record.authenticationFailed === 'boolean' ? record.authenticationFailed : undefined,
      cause:
        record.cause !== undefined && record.cause !== error && depth < 3
          ? errorOf(record.cause, depth + 1)
          : undefined,
      stack
    }).filter(([, entry]) => entry !== undefined)
  )
}

/** A value with every field that names a secret taken out, all else as it is: what a state tells. */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutSecrets)
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[tolto]' : withoutSecrets(entry)
      ])
    )
  }

  return value
}

/** The words of a server command — `UID SEARCH`, `RCPT` —, without what it was given. */
function commandWords(command: string | undefined): string | undefined {
  const words = command
    ?.split(/\s+/)
    .filter((word) => /^[A-Z][A-Z0-9-]*$/.test(word))
    .slice(0, 3)
  return words && words.length > 0 ? words.join(' ') : undefined
}

/** For the tests: forget what this module holds. */
export function resetDiagnosticsForTests(): void {
  if (writer?.timer) {
    clearTimeout(writer.timer)
  }

  for (const repeat of launch.repeats.values()) {
    clearTimeout(repeat.timer)
  }

  writer = null
  prunedDay = ''
  launch.seq = 0
  launch.pending = []
  launch.repeats.clear()
}
